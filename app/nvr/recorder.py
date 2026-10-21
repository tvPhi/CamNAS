"""Ghi hình 24/7.

Mỗi camera một tiến trình ffmpeg đọc luồng từ go2rtc, sao chép nguyên video
(không mã hoá lại nên gần như không tốn CPU) và cắt thành file mp4 theo giờ đồng hồ:
    <thư mục lưu>/<camera>/<YYYY-MM-DD>/<HH-MM-SS>.mp4
"""
from __future__ import annotations

import asyncio
import os
import re
import signal
import sys
import time
from collections import deque
from datetime import datetime, timedelta

from .config import CAMERA_MARKER, FFMPEG, GO2RTC_RTSP, Camera, Settings, recordings_dir
from .events import EventLog
from .i18n import msg, render

STALL_SECONDS = 30
BACKOFF_MAX = 15
WINDOWS = sys.platform == "win32"


class RecordingsDirMissing(OSError):
    pass


def ensure_day_dirs(cam_id: str) -> None:
    root = recordings_dir()
    if not root.is_dir():
        raise RecordingsDirMissing(str(root))
    cam_dir = root / cam_id
    # Bộ cắt file của ffmpeg không tự tạo thư mục, nên tạo sẵn cả thư mục của ngày mai.
    now = datetime.now()
    for d in (now, now + timedelta(days=1)):
        (cam_dir / d.strftime("%Y-%m-%d")).mkdir(parents=True, exist_ok=True)
    marker = cam_dir / CAMERA_MARKER
    if not marker.exists():
        marker.write_text("CamNAS camera folder\n", encoding="utf-8")


def signature(cam: Camera, settings: Settings) -> tuple:
    return cam.url, cam.audio, settings.segment_minutes, str(recordings_dir())


def friendly_error(line: str) -> str | dict:
    low = line.lower()
    if "404" in low or "not found" in low:
        return msg("Không lấy được hình từ camera (camera đang tắt/mất mạng, hoặc sai địa chỉ RTSP/mật khẩu)")
    if any(s in low for s in ("error during demuxing", "timed out", "end of file", "connection reset", "-138", "-110")):
        return msg("Mất tín hiệu từ camera (mất mạng wifi hoặc camera đang khởi động lại)")
    if "could not write header" in low or "incorrect codec parameters" in low:
        return msg("Camera chưa gửi được hình (có thể đang mất kết nối)")
    line = re.sub(r"\[[^\]]*@ ?(0x)?[0-9a-fA-F]+\]\s*", "", line)  # bỏ tiền tố "[rtsp @ 0x55d...]" của ffmpeg
    if "401" in low or "unauthorized" in low:
        return msg("Sai tên đăng nhập hoặc mật khẩu camera")
    if "connection refused" in low:
        return msg("Dịch vụ go2rtc chưa sẵn sàng")
    if "no space left" in low:
        return msg("Ổ cứng đã đầy")
    if "permission denied" in low:
        return msg("Không có quyền ghi vào thư mục lưu bản ghi")
    return line


class CameraRecorder:
    def __init__(self, cam: Camera, settings: Settings, events: EventLog):
        self.cam = cam
        self.signature = signature(cam, settings)
        self.segment_seconds = settings.segment_minutes * 60
        self.events = events
        self.state = "connecting"
        self.since = time.time()
        self.error: str | dict = ""  # mẫu thông báo (dịch lúc hiển thị) hoặc dòng lỗi gốc của ffmpeg
        self.restarts = 0
        self.fps = 0.0
        self.kbps = 0
        self.file = ""
        self._proc: asyncio.subprocess.Process | None = None
        self._task: asyncio.Task | None = None
        self._stopping = False
        self._wake = asyncio.Event()
        self._stderr: deque[str] = deque(maxlen=20)
        self._last_frame = 0
        self._last_frame_at = 0.0
        self._down_since: float | None = None
        self._stalled = False
        self._logged_error = ""

    def status(self) -> dict:
        return {
            "state": self.state,
            "since": self.since,
            "error": render(self.error) if self.error else "",
            "restarts": self.restarts,
            "fps": round(self.fps, 1),
            "kbps": self.kbps,
            "file": self.file,
        }

    def start(self) -> None:
        self._task = asyncio.create_task(self._run())

    async def stop(self) -> None:
        self._stopping = True
        self._wake.set()
        await self._terminate()
        if self._task:
            try:
                await asyncio.wait_for(self._task, 15)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self._task.cancel()

    def _args(self) -> list[str]:
        out = recordings_dir() / self.cam.id / "%Y-%m-%d" / "%H-%M-%S.mp4"
        args = [FFMPEG, "-hide_banner", "-loglevel", "error", "-nostats", "-progress", "pipe:1"]
        if not WINDOWS:
            args.append("-nostdin")
        args += [
            "-rtsp_transport", "tcp",
            "-timeout", "15000000",
            "-i", f"{GO2RTC_RTSP}/{self.cam.id}",
            "-map", "0:v:0",
            "-c:v", "copy",
        ]
        if self.cam.audio:
            # Camera thường gửi âm thanh G.711 mà mp4/trình duyệt không hỗ trợ, nên đổi sang AAC (rất nhẹ).
            args += ["-map", "0:a:0?", "-c:a", "aac", "-b:a", "32k"]
        args += [
            "-f", "segment",
            "-segment_time", str(self.segment_seconds),
            "-segment_atclocktime", "1",
            "-reset_timestamps", "1",
            "-strftime", "1",
            "-segment_format", "mp4",
            "-segment_format_options", "movflags=+faststart",
            str(out),
        ]
        return args

    def _set_state(self, state: str, error: str | dict = "") -> None:
        if state != self.state:
            self.since = time.time()
        self.state = state
        self.error = error

    async def _run(self) -> None:
        backoff = 2
        while not self._stopping:
            try:
                ensure_day_dirs(self.cam.id)
            except RecordingsDirMissing as e:
                self._fail(msg("Thư mục lưu bản ghi {path} không tồn tại - vào Cài đặt để chọn thư mục lưu", path=str(e)))
                await self._sleep(BACKOFF_MAX)
                continue
            except OSError as e:
                self._fail(msg("Không tạo được thư mục ghi hình: {error}", error=str(e)))
                await self._sleep(BACKOFF_MAX)
                continue

            if self.state != "error":
                self._set_state("connecting")
            self._stderr.clear()
            self._stalled = False
            self._last_frame = 0
            self._last_frame_at = time.monotonic()
            started = time.monotonic()
            try:
                self._proc = await asyncio.create_subprocess_exec(
                    *self._args(),
                    stdin=asyncio.subprocess.PIPE if WINDOWS else asyncio.subprocess.DEVNULL,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
            except OSError as e:
                self._fail(msg("Không chạy được ffmpeg: {error}", error=str(e)))
                await self._sleep(BACKOFF_MAX)
                continue

            tasks = [
                asyncio.create_task(self._read_progress(self._proc.stdout)),
                asyncio.create_task(self._read_stderr(self._proc.stderr)),
            ]
            watchdog = asyncio.create_task(self._watchdog())
            code = await self._proc.wait()
            watchdog.cancel()
            await asyncio.gather(watchdog, *tasks, return_exceptions=True)
            self._proc = None
            self.fps = 0.0
            self.kbps = 0
            if self._stopping:
                break

            if self._last_frame and time.monotonic() - started > 60:
                backoff = 2
            self.restarts += 1
            if self._stalled:
                self._fail(msg("Không nhận được hình ảnh trong {n} giây", n=STALL_SECONDS))
            elif self._stderr:
                self._fail(friendly_error(self._stderr[-1]))
            else:
                self._fail(msg("ffmpeg dừng (mã {code})", code=code))
            await self._sleep(backoff)
            backoff = min(backoff * 2, BACKOFF_MAX)

        self._set_state("stopped")

    def _fail(self, message: str | dict) -> None:
        was_recording = self.state == "recording"
        self._set_state("error", message)
        if was_recording:
            self._down_since = time.time()
            self._logged_error = message
            self.events.add("warn", "Mất kết nối, đang thử lại: {error}", self.cam.id, error=message)
        elif message != self._logged_error:
            # chỉ ghi nhật ký khi lỗi đổi nội dung, tránh lặp lại mỗi lần thử lại
            self._logged_error = message
            self.events.add("error", "Không ghi được: {error}", self.cam.id, error=message)

    def _on_recording(self) -> None:
        if self._down_since:
            self.events.add("info", "Đã kết nối lại, tiếp tục ghi (gián đoạn {gap})", self.cam.id,
                            gap={"dur": time.time() - self._down_since})
        else:
            self.events.add("info", "Bắt đầu ghi hình", self.cam.id)
        self._down_since = None
        self._logged_error = ""
        self._set_state("recording")

    async def _sleep(self, seconds: float) -> None:
        self._wake.clear()
        if self._stopping:
            return
        try:
            await asyncio.wait_for(self._wake.wait(), seconds)
        except asyncio.TimeoutError:
            pass

    async def _read_progress(self, stream: asyncio.StreamReader) -> None:
        frame = None
        prev: tuple[int, float] | None = None
        while line := await stream.readline():
            key, _, value = line.decode(errors="ignore").strip().partition("=")
            if key == "frame":
                frame = int(value) if value.isdigit() else None
            elif key == "progress" and frame is not None and frame > self._last_frame:
                now = time.monotonic()
                if prev and now > prev[1]:
                    fps = (frame - prev[0]) / (now - prev[1])
                    self.fps = fps if not self.fps else self.fps * 0.7 + fps * 0.3
                prev = (frame, now)
                self._last_frame = frame
                self._last_frame_at = now
                if self.state != "recording":
                    self._on_recording()

    async def _read_stderr(self, stream: asyncio.StreamReader) -> None:
        while line := await stream.readline():
            text = line.decode(errors="ignore").strip()
            if text:
                self._stderr.append(text)

    async def _watchdog(self) -> None:
        size_prev: tuple[str, int, float] | None = None
        while True:
            await asyncio.sleep(5)
            now = time.monotonic()
            if now - self._last_frame_at > STALL_SECONDS:
                self._stalled = True
                await self._terminate()
                return
            path = self._newest_file()
            if path:
                size = os.path.getsize(path)
                self.file = os.path.relpath(path, recordings_dir() / self.cam.id).replace(os.sep, "/")
                if size_prev and size_prev[0] == path and size >= size_prev[1]:
                    self.kbps = int((size - size_prev[1]) * 8 / 1000 / (now - size_prev[2]))
                size_prev = (path, size, now)

    def _newest_file(self) -> str | None:
        base = recordings_dir() / self.cam.id
        now = datetime.now()
        for day in (now, now - timedelta(days=1)):
            try:
                names = [n for n in os.listdir(base / day.strftime("%Y-%m-%d")) if n.endswith(".mp4")]
            except OSError:
                continue
            if names:
                return str(base / day.strftime("%Y-%m-%d") / max(names))
        return None

    async def _terminate(self) -> None:
        proc = self._proc
        if proc is None or proc.returncode is not None:
            return
        # Dừng nhẹ nhàng để ffmpeg kịp đóng file mp4 đang ghi (không thì mất đoạn cuối).
        try:
            if WINDOWS:
                proc.stdin.write(b"q")
                await proc.stdin.drain()
            else:
                proc.send_signal(signal.SIGINT)
        except (OSError, ProcessLookupError):
            pass
        try:
            await asyncio.wait_for(proc.wait(), 10)
        except asyncio.TimeoutError:
            proc.kill()
            await proc.wait()


class RecorderManager:
    def __init__(self, events: EventLog):
        self.events = events
        self.recorders: dict[str, CameraRecorder] = {}

    async def sync(self, cameras: list[Camera], settings: Settings) -> None:
        wanted = {c.id: c for c in cameras if c.record}
        for cam_id, rec in list(self.recorders.items()):
            cam = wanted.get(cam_id)
            if cam is None or signature(cam, settings) != rec.signature:
                del self.recorders[cam_id]
                await rec.stop()
                if cam is None:
                    self.events.add("info", "Đã dừng ghi hình", cam_id)
            else:
                rec.cam = cam
        for cam_id, cam in wanted.items():
            if cam_id not in self.recorders:
                rec = CameraRecorder(cam, settings, self.events)
                self.recorders[cam_id] = rec
                rec.start()

    async def stop_all(self) -> None:
        recs = list(self.recorders.values())
        self.recorders.clear()
        await asyncio.gather(*(r.stop() for r in recs), return_exceptions=True)

    def status(self, cam_id: str) -> dict:
        rec = self.recorders.get(cam_id)
        return rec.status() if rec else {"state": "off"}

    def active_files(self) -> set[str]:
        files = set()
        for rec in self.recorders.values():
            path = rec._newest_file()
            if path:
                files.add(os.path.normpath(path))
        return files

    async def maintain(self) -> None:
        while True:
            await asyncio.sleep(60)
            for cam_id in list(self.recorders):
                try:
                    ensure_day_dirs(cam_id)
                except OSError:
                    pass
