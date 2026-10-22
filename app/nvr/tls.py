"""HTTPS bằng chứng chỉ có sẵn trên NAS.

DSM lưu mỗi chứng chỉ trong /usr/syno/etc/certificate/_archive/<mã>/ (cert.pem, fullchain.pem,
privkey.pem); file _archive/DEFAULT ghi mã của chứng chỉ mặc định. Thư mục này được gắn chỉ-đọc
vào container ở /certs. CamNAS mở thêm cổng HTTPS (mặc định 8443) và tự nạp lại chứng chỉ khi
DSM gia hạn, không cần khởi động lại.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import socket
import ssl
from pathlib import Path

import uvicorn

from .events import EventLog
from .i18n import msg

CERT_ROOT = Path(os.environ.get("CERT_DIR", "/certs"))
HTTPS_PORT = int(os.environ.get("HTTPS_PORT", "8443"))
CERT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,64}$")
RELOAD_CHECK_SECONDS = int(os.environ.get("CERT_CHECK_SECONDS", "300"))  # chu kỳ kiểm tra chứng chỉ được gia hạn


def _describe(cert: Path) -> tuple[list[str], float | None]:
    """Tên miền và ngày hết hạn của chứng chỉ."""
    try:
        info = ssl._ssl._test_decode_cert(str(cert))  # noqa: SLF001 - thư viện chuẩn không có hàm công khai tương đương
    except (AttributeError, ssl.SSLError, OSError, ValueError):
        return [], None
    names = [v for k, v in info.get("subjectAltName", ()) if k == "DNS"]
    if not names:
        names = [v for rdn in info.get("subject", ()) for k, v in rdn if k == "commonName"]
    try:
        expires = ssl.cert_time_to_seconds(info["notAfter"])
    except (KeyError, ValueError):
        expires = None
    return names, expires


def _archive() -> Path:
    return CERT_ROOT / "_archive"


def default_cert_id() -> str:
    try:
        return (_archive() / "DEFAULT").read_text(encoding="utf-8").strip()
    except OSError:
        return ""


def list_certs() -> list[dict]:
    try:
        info = json.loads((_archive() / "INFO").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        info = {}
    default = default_cert_id()
    out = []
    try:
        dirs = sorted(p for p in _archive().iterdir() if p.is_dir() and CERT_ID_RE.match(p.name))
    except OSError:
        return out
    for d in dirs:
        if not (d / "privkey.pem").exists():
            continue
        names, expires = _describe(d / "cert.pem")
        desc = info.get(d.name, {}).get("desc", "") if isinstance(info.get(d.name), dict) else ""
        out.append({"id": d.name, "desc": desc, "names": names, "expires": expires, "default": d.name == default})
    return out


def cert_files(cert_id: str) -> tuple[Path, Path] | None:
    """(fullchain, privkey) của chứng chỉ đã chọn; cert_id trống = chứng chỉ mặc định của DSM."""
    candidates = []
    if cert_id and CERT_ID_RE.match(cert_id):
        candidates.append(_archive() / cert_id)
    else:
        if default_cert_id() and CERT_ID_RE.match(default_cert_id()):
            candidates.append(_archive() / default_cert_id())
        candidates.append(CERT_ROOT / "system" / "default")
    for d in candidates:
        chain = d / "fullchain.pem" if (d / "fullchain.pem").exists() else d / "cert.pem"
        key = d / "privkey.pem"
        if chain.exists() and key.exists():
            return chain, key
    return None


class HttpsServer:
    """Máy chủ HTTPS thứ hai chạy song song với cổng HTTP, dùng chung ứng dụng."""

    def __init__(self, app, events: EventLog):
        self.app = app
        self.events = events
        self.server: uvicorn.Server | None = None
        self.task: asyncio.Task | None = None
        self.watch_task: asyncio.Task | None = None
        self.context: ssl.SSLContext | None = None
        self.files: tuple[Path, Path] | None = None
        self.mtimes: tuple[float, float] | None = None
        self.error: str | dict = ""
        self.cert_id = ""

    @property
    def running(self) -> bool:
        return self.server is not None and self.server.started and self.task is not None and not self.task.done()

    def status(self) -> dict:
        names, expires = _describe(self.files[0]) if self.files else ([], None)
        return {"running": self.running, "port": HTTPS_PORT, "names": names, "expires": expires, "error": self.error}

    async def apply(self, enabled: bool, cert_id: str) -> None:
        await self.stop()
        self.error = ""
        if enabled:
            await self.start(cert_id)

    async def start(self, cert_id: str) -> None:
        self.cert_id = cert_id
        files = cert_files(cert_id)
        if not files:
            self.error = msg("Không tìm thấy chứng chỉ của NAS (thư mục {path})", path=str(CERT_ROOT))
            return
        try:
            context = ssl.create_default_context(ssl.Purpose.CLIENT_AUTH)
            context.load_cert_chain(str(files[0]), str(files[1]))
        except (OSError, ssl.SSLError) as e:
            self.error = msg("Không đọc được chứng chỉ: {error}", error=str(e))
            self.events.add("error", "Không bật được HTTPS: {error}", error=self.error)
            return
        # Tự giữ cổng trước: nếu cổng bận, uvicorn sẽ gọi sys.exit() và làm dừng cả ứng dụng
        sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        if os.name != "nt":  # trên Windows tuỳ chọn này cho phép chiếm luôn cổng đang có chương trình khác dùng
            sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        try:
            sock.bind(("0.0.0.0", HTTPS_PORT))
        except OSError as e:
            sock.close()
            self.error = msg("Không mở được cổng HTTPS {port}: {error}", port=HTTPS_PORT, error=str(e))
            self.events.add("error", "Không bật được HTTPS: {error}", error=self.error)
            return
        config = uvicorn.Config(
            self.app, lifespan="off", log_level="warning", proxy_headers=True,
            ssl_context_factory=lambda _config, _default: context,
        )
        self.server = uvicorn.Server(config)
        self.context, self.files = context, files
        self.mtimes = self._mtimes()
        self.task = asyncio.create_task(self._run(self.server, sock))
        for _ in range(50):
            if self.server.started or self.task.done():
                break
            await asyncio.sleep(0.1)
        names, _ = _describe(files[0])
        self.events.add("info", "HTTPS đang chạy ở cổng {port} (chứng chỉ {names})",
                        port=HTTPS_PORT, names=", ".join(names) or "?")
        self.watch_task = asyncio.create_task(self._watch())

    @staticmethod
    async def _run(server: uvicorn.Server, sock: socket.socket) -> None:
        try:
            # _serve() thay vì serve(): serve() giành tín hiệu dừng (SIGTERM) của máy chủ HTTP chính
            await server._serve(sockets=[sock])  # noqa: SLF001
        except SystemExit:
            pass
        finally:
            sock.close()

    def _mtimes(self) -> tuple[float, float] | None:
        try:
            return self.files[0].stat().st_mtime, self.files[1].stat().st_mtime
        except (OSError, TypeError):
            return None

    async def _watch(self) -> None:
        """DSM gia hạn Let's Encrypt thì ghi đè file: nạp lại cho các kết nối mới."""
        while True:
            await asyncio.sleep(RELOAD_CHECK_SECONDS)
            files = cert_files(self.cert_id)
            if not files or not self.context:
                continue
            if files == self.files and self._mtimes() == self.mtimes:
                continue
            try:
                self.context.load_cert_chain(str(files[0]), str(files[1]))
            except (OSError, ssl.SSLError):
                continue
            self.files = files
            self.mtimes = self._mtimes()
            self.events.add("info", "Đã nạp chứng chỉ HTTPS mới")

    async def stop(self) -> None:
        if self.watch_task:
            self.watch_task.cancel()
            self.watch_task = None
        if self.server and self.task:
            self.server.should_exit = True
            try:
                await asyncio.wait_for(self.task, 10)
            except (asyncio.TimeoutError, asyncio.CancelledError):
                self.task.cancel()
        self.server = self.task = None
        self.context = self.files = self.mtimes = None
