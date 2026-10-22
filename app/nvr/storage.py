"""Danh sách đoạn ghi cho dòng thời gian, thống kê dung lượng, tự xoá bản ghi cũ, xuất clip."""
from __future__ import annotations

import asyncio
import errno
import json
import os
import re
import shutil
import time
from contextlib import suppress
from datetime import date, datetime, timedelta
from pathlib import Path

from .config import (CAMERA_MARKER, DATA_DIR, FFMPEG, FFPROBE, INSTALL, PACKAGE_USER, Settings, process_user,
                     recordings_dir, storage_roots)
from .i18n import UserError, msg, tr

GB = 1024**3
SEG_RE = re.compile(r"^(\d{2})-(\d{2})-(\d{2})\.mp4$")
DAY_RE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})$")
RECENT_SECONDS = 90  # file vừa được ghi trong khoảng này được coi là "đang ghi"
PROTECT_SECONDS = 24 * 3600  # không bao giờ xoá bản ghi 24 giờ gần nhất chỉ vì thiếu chỗ
EXPORT_DIR = DATA_DIR / "tmp"
MAX_EXPORT_SECONDS = 3 * 3600

_playable: dict[str, tuple[float, int, bool]] = {}


def _has_moov(path: str, size: int) -> bool:
    """File mp4 chỉ xem được khi đã có hộp 'moov' (ffmpeg ghi nó lúc đóng file)."""
    try:
        with open(path, "rb") as f:
            pos = 0
            for _ in range(16):
                f.seek(pos)
                hdr = f.read(16)
                if len(hdr) < 8:
                    return False
                box, kind = int.from_bytes(hdr[:4], "big"), hdr[4:8]
                if kind == b"moov":
                    return True
                if box == 1 and len(hdr) == 16:
                    box = int.from_bytes(hdr[8:16], "big")
                if box < 8:  # 0 = hộp kéo dài tới cuối file, tức là file đang ghi dở
                    return False
                pos += box
                if pos >= size:
                    return False
    except OSError:
        return False
    return False


def is_playable(path: str, size: int, mtime: float) -> bool:
    cached = _playable.get(path)
    if cached and cached[0] == mtime and cached[1] == size:
        return cached[2]
    ok = _has_moov(path, size)
    _playable[path] = (mtime, size, ok)
    return ok


def day_start(day: str) -> float:
    return datetime.strptime(day, "%Y-%m-%d").timestamp()


def list_segments(cam_id: str, day: str) -> list[dict]:
    m = DAY_RE.match(day)
    if not m:
        return []
    y, mo, d = map(int, m.groups())
    items = []
    try:
        entries = os.scandir(recordings_dir() / cam_id / day)
    except OSError:
        return []
    with entries:
        for e in entries:
            sm = SEG_RE.match(e.name)
            if not sm:
                continue
            try:
                st = e.stat()
            except OSError:
                continue
            h, mi, s = map(int, sm.groups())
            items.append((datetime(y, mo, d, h, mi, s).timestamp(), st.st_mtime, e.name, st.st_size, e.path))
    items.sort()
    now = time.time()
    out = []
    for i, (start, mtime, name, size, path) in enumerate(items):
        end = mtime
        if i + 1 < len(items):
            end = min(end, items[i + 1][0])
        end = max(end, start + 1)
        if is_playable(path, size, mtime):
            status = "ok"
        elif i == len(items) - 1 and now - mtime < RECENT_SECONDS:
            # chỉ file mới nhất mới có thể đang ghi; file dở dang ở giữa là do mất điện/tắt đột ngột
            status = "rec"
            end = max(end, now)
        else:
            status = "bad"
        out.append({"s": round(start, 2), "e": round(end, 2), "f": f"{day}/{name}", "st": status, "sz": size})
    return out


def timeline(cam_ids: list[str], day: str) -> dict[str, list[dict]]:
    start = day_start(day)
    prev_day = (datetime.strptime(day, "%Y-%m-%d") - timedelta(days=1)).strftime("%Y-%m-%d")
    result = {}
    for cam_id in cam_ids:
        segs = list_segments(cam_id, day)
        # đoạn ghi bắt đầu trước nửa đêm nằm trong thư mục ngày hôm trước
        prev = list_segments(cam_id, prev_day)
        if prev and prev[-1]["e"] > start:
            segs.insert(0, prev[-1])
        result[cam_id] = segs
    return result


def list_days(cam_ids: list[str]) -> list[str]:
    days: set[str] = set()
    for cam_id in cam_ids:
        base = recordings_dir() / cam_id
        if not base.is_dir():
            continue
        for e in os.scandir(base):
            if e.is_dir() and DAY_RE.match(e.name) and e.name not in days:
                if any(n.endswith(".mp4") for n in os.listdir(e.path)):
                    days.add(e.name)
    return sorted(days)


def segment_path(cam_id: str, day: str, name: str) -> Path | None:
    if not DAY_RE.match(day) or not SEG_RE.match(name):
        return None
    path = recordings_dir() / cam_id / day / name
    return path if path.is_file() else None


def disk_usage(path: Path):
    # thư mục lưu có thể chưa được tạo hoặc chưa được cấp quyền: lấy dung lượng của thư mục cha gần nhất
    while True:
        try:
            return shutil.disk_usage(path)
        except OSError:
            if path.parent == path:
                raise
            path = path.parent


def _dir_size(path: str) -> int:
    total = 0
    with suppress(OSError), os.scandir(path) as it:
        for e in it:
            try:
                total += e.stat().st_size
            except OSError:
                pass
    return total


class Storage:
    def __init__(self):
        self._sizes: dict[tuple[str, str], int] = {}  # cache dung lượng các ngày đã ghi xong

    def reset(self) -> None:
        self._sizes.clear()

    def _day_dirs(self) -> list[tuple[str, str, str]]:
        """[(ngày, camera, đường dẫn)] của mọi thư mục ngày, kể cả camera đã xoá.

        Chỉ tính thư mục camera có file đánh dấu của CamNAS, để không bao giờ đụng vào
        dữ liệu khác nếu người dùng chọn thư mục lưu dùng chung với thứ khác.
        """
        out = []
        try:
            cams = list(os.scandir(recordings_dir()))
        except OSError:  # thư mục chưa có hoặc CamNAS chưa được cấp quyền đọc
            return out
        for cam in cams:
            if not cam.is_dir() or not os.path.exists(os.path.join(cam.path, CAMERA_MARKER)):
                continue
            with suppress(OSError):
                for day in os.scandir(cam.path):
                    if day.is_dir() and DAY_RE.match(day.name):
                        out.append((day.name, cam.name, day.path))
        out.sort()
        return out

    def _size(self, cam_id: str, day: str, path: str) -> int:
        key = (cam_id, day)
        if key in self._sizes:
            return self._sizes[key]
        size = _dir_size(path)
        # ngày hôm qua có thể vẫn đang đóng file cuối, chỉ cache từ hôm kia trở về trước
        if day < (date.today() - timedelta(days=1)).isoformat():
            self._sizes[key] = size
        return size

    def usage(self) -> dict[str, dict[str, int]]:
        """{camera: {ngày: bytes}}"""
        result: dict[str, dict[str, int]] = {}
        for day, cam_id, path in self._day_dirs():
            result.setdefault(cam_id, {})[day] = self._size(cam_id, day, path)
        return result

    def stats(self, settings: Settings) -> dict:
        disk = disk_usage(recordings_dir())
        usage = self.usage()
        per_camera = {cam: sum(days.values()) for cam, days in usage.items()}
        total = sum(per_camera.values())
        by_day: dict[str, int] = {}
        for days in usage.values():
            for day, size in days.items():
                by_day[day] = by_day.get(day, 0) + size
        recorded_days = sorted(d for d, s in by_day.items() if s > 0)
        today = date.today().isoformat()
        full_days = [d for d in recorded_days if d < today][-7:]
        avg_daily = sum(by_day[d] for d in full_days) / len(full_days) if full_days else 0
        if not avg_daily and today in by_day:
            # chưa có ngày nào trọn vẹn: ước lượng theo tốc độ ghi từ lúc bắt đầu ghi hôm nay
            starts = [
                min(names)
                for cam in usage
                if (names := [n for n in os.listdir(recordings_dir() / cam / today) if SEG_RE.match(n)]
                    if (recordings_dir() / cam / today).is_dir() else [])
            ]
            if starts:
                first = datetime.strptime(f"{today} {min(starts)[:8]}", "%Y-%m-%d %H-%M-%S").timestamp()
                elapsed = time.time() - first
                avg_daily = by_day[today] / elapsed * 86400 if elapsed > 300 else 0
        capacity = total + disk.free - settings.min_free_gb * GB
        if settings.max_storage_gb:
            capacity = min(capacity, settings.max_storage_gb * GB)
        est_days = capacity / avg_daily if avg_daily else None
        if est_days is not None and settings.retention_days:
            est_days = min(est_days, settings.retention_days + 1)
        return {
            "disk_total": disk.total,
            "disk_used": disk.used,
            "disk_free": disk.free,
            "recordings": total,
            "per_camera": per_camera,
            "oldest_day": recorded_days[0] if recorded_days else None,
            "avg_daily": int(avg_daily),
            "est_days": round(est_days, 1) if est_days is not None else None,
        }

    def enforce(self, settings: Settings, protected: set[str]) -> list[tuple[str, dict]]:
        """Xoá bản ghi quá hạn hoặc khi thiếu chỗ. Trả về [(mức, thông báo)] để ghi nhật ký."""
        messages = []
        today = date.today().isoformat()

        if settings.retention_days > 0:
            cutoff = (date.today() - timedelta(days=settings.retention_days)).isoformat()
            removed, freed = 0, 0
            for day, cam_id, path in self._day_dirs():
                if day >= cutoff:
                    continue
                freed += _dir_size(path)
                removed += 1
                shutil.rmtree(path, ignore_errors=True)
                self._sizes.pop((cam_id, day), None)
            if removed:
                messages.append(("info", msg("Xoá {n} thư mục ngày quá hạn {days} ngày (giải phóng {gb} GB)",
                                    n=removed, days=settings.retention_days, gb=f"{freed / GB:.1f}")))

        need = self._over_limit(settings)
        if need > 0:
            freed, count = 0, 0
            newest_allowed = time.time() - PROTECT_SECONDS
            dirs = self._day_dirs()
            for day in sorted({d for d, _, _ in dirs}):
                files = []
                for d, cam_id, path in dirs:
                    if d != day:
                        continue
                    for e in os.scandir(path):
                        if SEG_RE.match(e.name):
                            files.append((e.name, cam_id, e.path))
                files.sort()
                for name, cam_id, path in files:
                    try:
                        st = os.stat(path)
                    except OSError:
                        continue
                    if os.path.normpath(path) in protected or st.st_mtime > newest_allowed:
                        continue
                    os.remove(path)
                    _playable.pop(path, None)
                    self._sizes.pop((cam_id, day), None)
                    freed += st.st_size
                    count += 1
                    if freed >= need:
                        break
                if day < today:
                    for d, _, path in dirs:
                        if d == day and not os.listdir(path):
                            try:
                                os.rmdir(path)
                            except OSError:
                                pass
                if freed >= need:
                    break
            if count:
                messages.append(("info", msg("Đã xoá {n} file cũ nhất (giải phóng {gb} GB) để giữ dung lượng trong giới hạn đã đặt",
                                    n=count, gb=f"{freed / GB:.1f}")))
            if freed < need:
                messages.append(("warn", msg("CẢNH BÁO: ổ cứng gần đầy nhưng không còn bản ghi cũ (trên 24 giờ) để xoá")))
        return messages

    def _over_limit(self, settings: Settings) -> int:
        need = 0
        if settings.min_free_gb:
            need = max(need, settings.min_free_gb * GB - disk_usage(recordings_dir()).free)
        if settings.max_storage_gb:
            total = sum(sum(days.values()) for days in self.usage().values())
            need = max(need, total - settings.max_storage_gb * GB)
        return need


async def export_clip(cam_id: str, start: float, end: float) -> Path:
    if end <= start:
        raise UserError("Thời điểm kết thúc phải sau thời điểm bắt đầu")
    if end - start > MAX_EXPORT_SECONDS:
        raise UserError("Mỗi lần chỉ xuất tối đa 3 giờ")
    first = datetime.fromtimestamp(start) - timedelta(days=1)
    days = []
    while first.date() <= datetime.fromtimestamp(end).date():
        days.append(first.strftime("%Y-%m-%d"))
        first += timedelta(days=1)
    segs = [s for day in days for s in list_segments(cam_id, day) if s["st"] == "ok" and s["e"] > start and s["s"] < end]
    if not segs:
        raise UserError("Không có bản ghi nào trong khoảng thời gian này")

    EXPORT_DIR.mkdir(parents=True, exist_ok=True)
    stamp = f"{os.getpid()}-{time.monotonic_ns()}"
    list_file = EXPORT_DIR / f"{stamp}.txt"
    out_file = EXPORT_DIR / f"{stamp}.mp4"
    lines = []
    for i, s in enumerate(segs):
        lines.append(f"file '{(recordings_dir() / cam_id / s['f']).as_posix()}'")
        if i == 0 and start > s["s"]:
            lines.append(f"inpoint {start - s['s']:.3f}")
        if i == len(segs) - 1 and end < s["e"]:
            lines.append(f"outpoint {end - s['s']:.3f}")
    list_file.write_text("\n".join(lines) + "\n", encoding="utf-8")
    proc = await asyncio.create_subprocess_exec(
        FFMPEG, "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0", "-i", str(list_file),
        "-c", "copy", "-movflags", "+faststart", str(out_file),
        stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
    )
    try:
        _, err = await asyncio.wait_for(proc.communicate(), 600)
    except asyncio.TimeoutError:
        proc.kill()
        raise UserError("Xuất clip quá lâu, hãy chọn khoảng ngắn hơn")
    finally:
        list_file.unlink(missing_ok=True)
    if proc.returncode != 0 or not out_file.exists():
        out_file.unlink(missing_ok=True)
        raise UserError("Xuất clip lỗi: {error}", error=err.decode(errors="ignore").strip()[-300:])
    return out_file


def clean_exports(max_age: float = 0) -> None:
    if EXPORT_DIR.is_dir():
        for p in EXPORT_DIR.iterdir():
            if not max_age or time.time() - p.stat().st_mtime > max_age:
                p.unlink(missing_ok=True)


async def probe(url: str) -> dict:
    """Kiểm tra thử địa chỉ camera: codec, độ phân giải, âm thanh."""
    args = [FFPROBE, "-v", "error"]
    if url.startswith("rtsp"):
        args += ["-rtsp_transport", "tcp", "-timeout", "8000000"]
    args += ["-show_entries", "stream=codec_type,codec_name,width,height,avg_frame_rate,sample_rate", "-of", "json", url]
    proc = await asyncio.create_subprocess_exec(
        *args, stdin=asyncio.subprocess.DEVNULL, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
    )
    try:
        out, err = await asyncio.wait_for(proc.communicate(), 20)
    except asyncio.TimeoutError:
        proc.kill()
        return {"ok": False, "error": tr("Hết thời gian chờ - camera không phản hồi (kiểm tra IP, cổng 554)")}
    if proc.returncode != 0:
        lines = err.decode(errors="ignore").strip().splitlines()
        text = lines[-1] if lines else tr("không rõ lỗi")
        if "401" in text or "Unauthorized" in text:
            text = tr("Sai tên đăng nhập hoặc mật khẩu (với Ezviz: mật khẩu là mã xác minh 6 chữ in hoa dưới đáy camera)")
        elif "404" in text or "Not Found" in text:
            text = tr("Sai đường dẫn luồng RTSP")
        elif "Connection refused" in text:
            text = tr("Camera từ chối kết nối - có thể RTSP chưa được bật")
        return {"ok": False, "error": text}

    streams = json.loads(out or b"{}").get("streams", [])
    video = next((s for s in streams if s.get("codec_type") == "video"), None)
    audio = next((s for s in streams if s.get("codec_type") == "audio"), None)
    warnings = []
    fps = None
    if video:
        try:
            n, d = video.get("avg_frame_rate", "0/1").split("/")
            fps = round(int(n) / int(d), 1) if int(d) else None
        except ValueError:
            pass
        if video.get("codec_name") == "hevc":
            warnings.append(tr(
                "Camera đang nén H.265: vẫn ghi được, nhưng nhiều trình duyệt (Firefox, Chrome trên máy không có "
                "giải mã phần cứng) không xem được. Nên chuyển camera sang H.264 trong ứng dụng/EZVIZ Studio."
            ))
    else:
        warnings.append(tr("Không thấy luồng video"))
    return {
        "ok": True,
        "video": video and {
            "codec": video.get("codec_name"),
            "width": video.get("width"),
            "height": video.get("height"),
            "fps": fps,
        },
        "audio": audio and {"codec": audio.get("codec_name"), "sample_rate": audio.get("sample_rate")},
        "warnings": warnings,
    }


# ---------- chọn thư mục lưu bản ghi ----------

HIDDEN_PREFIXES = ("@", "#", ".")  # thư mục hệ thống của Synology (@eaDir, #recycle...) và thư mục ẩn


def _root_of(path: Path) -> Path | None:
    return next((r for r in storage_roots() if path == r or r in path.parents), None)


def prepare_recordings_dir(raw: str, from_ui: bool = True) -> Path:
    """Kiểm tra đường dẫn, tạo thư mục nếu chưa có và thử ghi vào đó."""
    raw = raw.strip()
    if not raw:
        raise UserError("Hãy nhập đường dẫn thư mục, ví dụ /volume1/camera")
    path = Path(os.path.normpath(raw))
    if not path.is_absolute():
        raise UserError("Hãy nhập đường dẫn đầy đủ, ví dụ /volume1/camera")
    root = _root_of(path)
    if root is None and from_ui:
        roots = storage_roots()
        if not roots:
            raise UserError("Container chưa được cấp quyền vào ổ NAS. Hãy dùng docker-compose.yml bản mới "
                            "(có dòng /volume1:/volume1) rồi build lại Project.")
        raise UserError("Chỉ chọn được thư mục nằm trong: {roots}", roots=", ".join(str(r) for r in roots))
    if root is not None:
        rel = path.relative_to(root).parts
        if not rel:
            raise UserError("Hãy chọn một thư mục con (ví dụ {example}), không chọn cả ổ {root}",
                            example=str(root / "camera"), root=str(root))
        if any(part.startswith(HIDDEN_PREFIXES) for part in rel):
            raise UserError("Không dùng thư mục hệ thống hoặc thư mục ẩn (tên bắt đầu bằng @, # hoặc .)")
        if not (root / rel[0]).is_dir():
            # thư mục cấp đầu trên volume phải là thư mục chia sẻ tạo bằng DSM thì mới hiện trong File Station
            raise UserError("Chưa có thư mục chia sẻ \"{name}\". Hãy tạo nó trong DSM (Control Panel → Shared Folder) "
                            "hoặc chọn thư mục nằm trong một thư mục chia sẻ có sẵn.", name=rel[0])
    if path == DATA_DIR or DATA_DIR in path.parents:
        raise UserError("Không lưu bản ghi bên trong thư mục cấu hình của CamNAS")
    try:
        path.mkdir(parents=True, exist_ok=True)
        test = path / ".camnas-write-test"
        test.write_bytes(b"ok")
        test.unlink()
    except OSError as e:
        if e.errno in (errno.EACCES, errno.EPERM) and INSTALL == "spk":
            share = rel[0] if root is not None else str(path)
            raise UserError("Gói CamNAS chưa được cấp quyền ghi vào {path}. Trong DSM vào Control Panel → Shared Folder → "
                            "chọn \"{share}\" → Edit → Permissions, đổi ô Local users thành System internal user, "
                            "rồi tick Read/Write cho {user}.", path=str(path), share=share, user=PACKAGE_USER) from e
        if e.errno in (errno.EACCES, errno.EPERM):
            raise UserError("Không ghi được vào {path}: CamNAS (chạy bằng {user}) chưa có quyền ghi vào thư mục này.",
                            path=str(path), user=process_user()) from e
        raise UserError("Không tạo hoặc không ghi được vào {path}: {error}", path=str(path), error=str(e.strerror or e)) from e
    return path


def move_recordings(old: Path, new: Path) -> dict | None:
    """Chuyển bản ghi sang thư mục mới. Cùng ổ đĩa thì chỉ là đổi tên nên xong ngay."""
    if old == new or not old.is_dir():
        return None
    cams = [p for p in old.iterdir() if p.is_dir() and (p / CAMERA_MARKER).exists() and p != new]
    if not cams:
        return None
    if os.stat(old).st_dev != os.stat(new).st_dev:
        return msg("Bản ghi cũ vẫn nằm ở {old} (khác ổ đĩa nên không tự chuyển). Có thể chuyển bằng File Station nếu cần.", old=str(old))
    for cam in cams:
        dest = new / cam.name
        if not dest.exists():
            os.rename(cam, dest)
            continue
        # camera đã có thư mục ở chỗ mới: gộp từng ngày, từng file
        for day in cam.iterdir():
            if not day.is_dir():
                continue
            day_dest = dest / day.name
            if not day_dest.exists():
                os.rename(day, day_dest)
                continue
            for f in day.iterdir():
                if not (day_dest / f.name).exists():
                    os.rename(f, day_dest / f.name)
            with suppress(OSError):
                day.rmdir()
        with suppress(OSError):
            (cam / CAMERA_MARKER).unlink()
            cam.rmdir()
    _playable.clear()
    return msg("Đã chuyển bản ghi của {n} camera từ {old} sang {new}", n=len(cams), old=str(old), new=str(new))


def list_dirs(raw: str) -> dict:
    """Liệt kê thư mục con để người dùng chọn chỗ lưu (chỉ trong các ổ được phép)."""
    roots = storage_roots()
    if not raw:
        return {"path": "", "parent": None, "dirs": [{"name": str(r), "path": str(r)} for r in roots]}
    path = Path(os.path.normpath(raw))
    root = _root_of(path)
    if root is None:
        raise UserError("Thư mục nằm ngoài các ổ được phép")
    try:
        with os.scandir(path) as it:
            names = sorted((e.name for e in it if e.is_dir() and not e.name.startswith(HIDDEN_PREFIXES)), key=str.lower)
    except OSError as e:
        raise UserError("Không mở được thư mục {path}", path=str(path)) from e
    return {
        "path": str(path),
        "parent": "" if path == root else str(path.parent),
        "dirs": [{"name": n, "path": str(path / n)} for n in names],
    }


def mark_camera_dirs(cam_ids: list[str]) -> None:
    """Đánh dấu thư mục của các camera đang có (bản ghi từ trước khi có file đánh dấu)."""
    for cam_id in cam_ids:
        d = recordings_dir() / cam_id
        if d.is_dir() and not (d / CAMERA_MARKER).exists():
            with suppress(OSError):
                (d / CAMERA_MARKER).write_text("CamNAS camera folder\n", encoding="utf-8")
