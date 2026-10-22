"""Đường dẫn, cấu hình camera và cài đặt lưu trữ (lưu trong /data/config.json)."""
from __future__ import annotations

import json
import os
import re
import threading
import unicodedata
from pathlib import Path

from pydantic import BaseModel, Field

DATA_DIR = Path(os.environ.get("DATA_DIR", "/data"))
DEFAULT_RECORDINGS_DIR = Path(os.environ.get("RECORDINGS_DIR", "/recordings"))
# File đánh dấu thư mục camera do CamNAS tạo: chỉ những thư mục có file này mới bị tự dọn
CAMERA_MARKER = ".camnas"
INSTALL = os.environ.get("CAMNAS_INSTALL", "docker")  # "spk" khi chạy bằng gói cài đặt
PACKAGE_USER = "CamNAS"  # tài khoản hệ thống DSM tạo cho gói (System internal user)
FFMPEG = os.environ.get("FFMPEG", "ffmpeg")
FFPROBE = os.environ.get("FFPROBE", "ffprobe")
GO2RTC_BIN = os.environ.get("GO2RTC_BIN", "go2rtc")
GO2RTC_API_PORT = int(os.environ.get("GO2RTC_API_PORT", "1984"))
GO2RTC_RTSP_PORT = int(os.environ.get("GO2RTC_RTSP_PORT", "8554"))
GO2RTC_URL = f"http://127.0.0.1:{GO2RTC_API_PORT}"
GO2RTC_RTSP = f"rtsp://127.0.0.1:{GO2RTC_RTSP_PORT}"
HTTP_PORT = int(os.environ.get("HTTP_PORT", "8080"))

CAMERA_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,31}$")

_recordings_dir = DEFAULT_RECORDINGS_DIR


def recordings_dir() -> Path:
    """Thư mục lưu bản ghi hiện tại (đổi được trong trang Cài đặt)."""
    return _recordings_dir


def set_recordings_dir(path: Path) -> None:
    global _recordings_dir
    _recordings_dir = path


def process_user() -> str:
    """Tài khoản đang chạy CamNAS (gói .spk không chạy bằng root)."""
    if not hasattr(os, "getuid"):
        return ""
    uid = os.getuid()
    if uid == 0:
        return "root"
    if INSTALL == "spk":
        return f"{PACKAGE_USER} (uid {uid})"
    return f"uid {uid}"


def storage_roots() -> list[Path]:
    """Các ổ (volume) của NAS được gắn vào container, người dùng chọn thư mục lưu bên trong."""
    env = os.environ.get("STORAGE_ROOTS")
    if env:
        roots = [Path(p) for p in env.split(os.pathsep) if p]
    else:
        roots = sorted(p for p in Path("/").glob("volume*") if re.fullmatch(r"volume(USB)?\d+", p.name))
    return [r for r in roots if r.is_dir()]


class Camera(BaseModel):
    id: str
    name: str = Field(min_length=1, max_length=60)
    url: str = Field(min_length=8)
    sub_url: str = ""
    record: bool = True
    audio: bool = True


class Settings(BaseModel):
    retention_days: int = Field(30, ge=0, le=3650)  # 0 = không giới hạn theo ngày
    max_storage_gb: int = Field(0, ge=0)  # 0 = không giới hạn dung lượng
    min_free_gb: int = Field(50, ge=0)  # luôn chừa trống ổ cứng ít nhất ngần này
    segment_minutes: int = Field(5, ge=1, le=60)
    recordings_dir: str = ""  # trống = dùng biến môi trường RECORDINGS_DIR
    https_enabled: bool = True  # mở cổng HTTPS bằng chứng chỉ của NAS (nếu tìm thấy)
    public_url: str = ""  # địa chỉ HTTPS dùng từ xa qua reverse proxy, ví dụ https://nas.ten-mien.com:8443
    https_cert: str = ""  # mã chứng chỉ trong /usr/syno/etc/certificate/_archive; trống = chứng chỉ mặc định
    update_prerelease: bool = False  # báo cả bản thử nghiệm (pre-release) khi kiểm tra cập nhật


class Config(BaseModel):
    cameras: list[Camera] = []
    settings: Settings = Settings()
    password_hash: str = ""


def slugify(name: str) -> str:
    s = name.replace("đ", "d").replace("Đ", "D")
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^a-zA-Z0-9]+", "-", s).strip("-").lower()
    return s[:24].strip("-") or "camera"


class ConfigStore:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self.config = self._load()

    def _load(self) -> Config:
        if self.path.exists():
            return Config.model_validate_json(self.path.read_text(encoding="utf-8"))
        return Config()

    def save(self) -> None:
        with self._lock:
            self.path.parent.mkdir(parents=True, exist_ok=True)
            tmp = self.path.with_suffix(".tmp")
            tmp.write_text(json.dumps(self.config.model_dump(), ensure_ascii=False, indent=2), encoding="utf-8")
            os.replace(tmp, self.path)

    def camera(self, cam_id: str) -> Camera | None:
        return next((c for c in self.config.cameras if c.id == cam_id), None)

    def new_camera_id(self, name: str) -> str:
        base = slugify(name)
        taken = {c.id for c in self.config.cameras}
        # Thư mục ghi hình của camera đã xoá vẫn có thể còn, tránh trộn bản ghi
        if recordings_dir().is_dir():
            taken |= {p.name for p in recordings_dir().iterdir() if p.is_dir()}
        cam_id, n = base, 2
        while cam_id in taken:
            cam_id = f"{base}-{n}"
            n += 1
        return cam_id
