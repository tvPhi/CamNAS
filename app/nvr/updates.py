"""Kiểm tra phiên bản mới và làm "nguồn gói" (package source) cho Package Center.

Bản mới được tìm trong package công khai của CamNAS trên ghcr.io (nơi NAS vẫn tải image), nên
không cần quyền đọc kho mã trên GitHub. Mỗi bản phát hành có thêm tag "<phiên bản>-spk" chứa các
file .spk của bản đó (do GitHub Actions đẩy lên bằng oras).

Package Center của DSM có thể thêm nguồn gói bên thứ ba: nó gửi yêu cầu tới một địa chỉ và nhận
về danh sách gói dạng JSON. CamNAS tự trả lời yêu cầu đó với bản mới nhất, nhờ vậy Package Center hiện
nút "Update" cho CamNAS như các gói khác. File .spk cũng do CamNAS phát (đã tải sẵn khi kiểm tra):
Package Center tải xong file rồi mới dừng gói để nâng cấp.
"""
from __future__ import annotations

import asyncio
import hashlib
import io
import os
import re
import tarfile
import time
from collections import deque
from contextlib import suppress
from pathlib import Path

import httpx

from . import __version__
from .config import INSTALL
from .events import EventLog
from .i18n import msg

IMAGE = os.environ.get("UPDATE_IMAGE", "ghcr.io/tvphi/camnas")
REGISTRY, _, IMAGE_NAME = IMAGE.partition("/")
SPK_TAG_SUFFIX = "-spk"
SPK_VERSION = os.environ.get("CAMNAS_SPK_VERSION", "")  # ví dụ 1.4.0-0002, do spk/build.py ghi vào
SPK_VARIANT = os.environ.get("CAMNAS_SPK_VARIANT", "")  # "build-on-nas" nếu gói tự build image trên NAS
CHECK_EVERY = 6 * 3600
MIN_MANUAL_GAP = 30
VERSION_RE = re.compile(r"^\d+\.\d+\.\d+(?:-[a-z]+\d*)?$")
SPK_RE = re.compile(r"^CamNAS-(\d+\.\d+\.\d+-\d+)(?:-([a-z-]+))?\.spk$")
REPO_URL = "https://github.com/tvPhi/CamNAS"
HOST_LOG = Path(os.environ.get("HOST_LOG_DIR", "/host-log"))  # /var/log của DSM, gói .spk gắn vào chỉ đọc


def _numbers(version: str) -> tuple:
    """1.4.0 / 1.4.0-rc2 / 1.4.0-0002 -> bộ số để so sánh; bản thử nghiệm (rc) đứng trước bản chính thức."""
    m = re.match(r"^v?(\d+)\.(\d+)\.(\d+)(?:-(.*))?$", version or "")
    if not m:
        return (0, 0, 0, 0, 0)
    major, minor, patch, suffix = int(m[1]), int(m[2]), int(m[3]), m[4] or ""
    if suffix.isdigit():  # số build của gói .spk
        return (major, minor, patch, 1, int(suffix))
    rc = re.search(r"(\d+)$", suffix)
    return (major, minor, patch, 0 if suffix else 1, int(rc[1]) if rc and suffix else 0)


def is_newer(latest: dict, current_version: str, current_spk: str) -> bool:
    if current_spk and latest.get("spk"):
        return _numbers(latest["spk"]["spk_version"]) > _numbers(current_spk)
    return _numbers(latest["tag"]) > _numbers(current_version)


def package_log(limit: int = 150) -> list[dict]:
    """Phần cuối nhật ký cài đặt gói của DSM có nhắc tới CamNAS: để xem vì sao cập nhật hỏng mà không cần SSH.

    Ngoài synopkg.log và log riêng của gói, quét cả log của các gói khác (Container Manager khởi động
    container, Web Station bật dịch vụ): lỗi lúc khởi động gói thường chỉ được ghi ở đó.
    """
    files = [("synopkg.log", True), ("packages/CamNAS.log", False)]
    with suppress(OSError):
        files += [(f"packages/{p.name}", True) for p in sorted((HOST_LOG / "packages").glob("*.log")) if p.name != "CamNAS.log"]
    out = []
    for name, only_camnas in files:
        try:
            with open(HOST_LOG / name, encoding="utf-8", errors="replace") as f:
                lines = deque((line.rstrip("\n") for line in f if not only_camnas or "camnas" in line.lower()), maxlen=limit)
        except OSError as e:
            out.append({"name": name, "lines": [], "error": e.strerror or str(e)})
            continue
        if lines or name in ("synopkg.log", "packages/CamNAS.log"):  # log của gói khác: chỉ hiện khi có nhắc tới CamNAS
            out.append({"name": name, "lines": list(lines), "error": ""})
    return out


def spk_icon(data: bytes) -> bytes | None:
    """Biểu tượng nằm sẵn trong file .spk: dùng làm ảnh của gói trong Package Center."""
    with suppress(tarfile.TarError, KeyError, AttributeError), tarfile.open(fileobj=io.BytesIO(data)) as tar:
        return tar.extractfile("PACKAGE_ICON_256.PNG").read()
    return None


class UpdateChecker:
    def __init__(self, events: EventLog):
        self.events = events
        self.latest: dict | None = None
        self.checked_at: float | None = None
        self.error: str | dict = ""
        self.prerelease = False
        self.source_seen: dict | None = None  # lần cuối Package Center đọc nguồn gói (từ lúc CamNAS khởi động)
        self._lock = asyncio.Lock()
        self._announced = ""

    async def loop(self, prerelease: bool) -> None:
        self.prerelease = prerelease
        await asyncio.sleep(20)  # đợi mạng / go2rtc khởi động xong
        while True:
            await self.check()
            await asyncio.sleep(CHECK_EVERY)

    async def check(self, force: bool = False) -> None:
        async with self._lock:
            if not force and self.checked_at and time.time() - self.checked_at < MIN_MANUAL_GAP:
                return
            try:
                self.latest = await self._fetch()
                self.error = ""
            except httpx.HTTPStatusError as e:
                if e.response.status_code in (401, 403, 404):
                    self.error = msg("Không đọc được {image}. Package này trên GitHub cần để Public.", image=IMAGE)
                else:
                    self.error = msg("Không kiểm tra được phiên bản mới: {error}", error=f"HTTP {e.response.status_code}")
            except (httpx.HTTPError, ValueError, KeyError) as e:
                self.error = msg("Không kiểm tra được phiên bản mới: {error}", error=(str(e) or type(e).__name__).splitlines()[0])
            self.checked_at = time.time()
            if self.latest and self.update_available() and self._announced != self.latest["tag"]:
                self._announced = self.latest["tag"]
                self.events.add("info", "Đã có phiên bản mới {version}", version=self.latest["tag"])

    async def _fetch(self) -> dict | None:
        base = f"https://{REGISTRY}/v2/{IMAGE_NAME}"
        async with httpx.AsyncClient(timeout=20, follow_redirects=True, headers={"User-Agent": f"CamNAS/{__version__}"}) as client:
            # package công khai: registry cấp token đọc không cần đăng nhập
            r = await client.get(f"https://{REGISTRY}/token", params={"scope": f"repository:{IMAGE_NAME}:pull"})
            client.headers["Authorization"] = f"Bearer {r.raise_for_status().json()['token']}"
            tags = set((await client.get(f"{base}/tags/list", params={"n": 1000})).raise_for_status().json().get("tags") or [])
            releases = [t for t in tags if VERSION_RE.match(t) and t + SPK_TAG_SUFFIX in tags
                        and (self.prerelease or "-" not in t)]
            if not releases:
                return None
            tag = max(releases, key=_numbers)
            if self.latest and self.latest["tag"] == tag:
                return self.latest
            latest = {"tag": tag, "prerelease": "-" in tag, "spk": None}
            r = await client.get(f"{base}/manifests/{tag}{SPK_TAG_SUFFIX}",
                                 headers={"Accept": "application/vnd.oci.image.manifest.v1+json"})
            for layer in r.raise_for_status().json().get("layers", []):
                name = layer.get("annotations", {}).get("org.opencontainers.image.title", "")
                m = SPK_RE.match(name)
                if not m or (m[2] or "") != SPK_VARIANT:  # cùng kiểu với gói đang cài (image dựng sẵn / build-on-nas)
                    continue
                # tải sẵn file .spk: Package Center cần md5 và sẽ tải file này từ CamNAS
                data = (await client.get(f"{base}/blobs/{layer['digest']}")).raise_for_status().content
                if f"sha256:{hashlib.sha256(data).hexdigest()}" != layer["digest"]:
                    raise ValueError(f"{name}: checksum mismatch")
                latest["spk"] = {"name": name, "data": data, "md5": hashlib.md5(data).hexdigest(),
                                 "spk_version": m[1], "icon": spk_icon(data)}
                break
            return latest

    def source_requested(self, params: dict) -> None:
        """Ghi lại yêu cầu của Package Center (luôn kèm build và arch của DSM) để biết nguồn gói có được dùng không."""
        if "build" not in params:
            return  # mở bằng trình duyệt hoặc curl, không phải Package Center
        if self.source_seen is None:
            self.events.add("info", "Package Center đã đọc nguồn gói CamNAS (DSM build {build}, {arch})",
                            build=params["build"], arch=params.get("arch", "?"))
        self.source_seen = {"at": time.time(), "build": params["build"], "arch": params.get("arch", "")}

    def update_available(self) -> bool:
        return bool(self.latest) and is_newer(self.latest, __version__, SPK_VERSION)

    def status(self) -> dict:
        return {
            "current": __version__,
            "current_spk": SPK_VERSION,
            "install": INSTALL,
            "latest": self.latest and {k: v for k, v in self.latest.items() if k != "spk"},
            "update_available": self.update_available(),
            "checked_at": self.checked_at,
            "error": self.error,
            "prerelease": self.prerelease,
            "source_seen": self.source_seen,
        }

    def package_file(self, name: str) -> tuple[bytes, str] | None:
        """File .spk hoặc biểu tượng mà Package Center tải từ nguồn gói."""
        spk = self.latest and self.latest.get("spk")
        if not spk:
            return None
        if name == spk["name"]:
            return spk["data"], "application/octet-stream"
        if name == "icon.png" and spk["icon"]:
            return spk["icon"], "image/png"
        return None

    def package_source(self, base_url: str) -> dict:
        """Định dạng JSON mà Package Center của DSM chờ từ một nguồn gói; base_url là địa chỉ Package Center đã gọi."""
        spk = self.latest and self.latest.get("spk")
        if not spk:
            return {"packages": []}
        # cùng bộ trường với kho gói SynoCommunity (spkrepo), vốn dùng được với Package Center của DSM 7
        return {"packages": [{
            "package": "CamNAS",
            "version": spk["spk_version"],
            "dname": "CamNAS",
            "desc": "Free 24/7 recorder (NVR) for IP cameras: live view, timeline playback and clip export.",
            "link": f"{base_url}pkgsrc/{spk['name']}",
            "thumbnail": [f"{base_url}pkgsrc/icon.png"] if spk["icon"] else [],
            "snapshot": [],
            "qinst": True,
            "qupgrade": True,
            "qstart": True,
            "deppkgs": None,
            "conflictpkgs": None,
            "download_count": 0,
            "recent_download_count": 0,
            "md5": spk["md5"],
            "size": len(spk["data"]),
            "maintainer": "tvPhi",
            "maintainer_url": REPO_URL,
            "distributor": "tvPhi",
            "distributor_url": REPO_URL,
            "startable": "yes",
        }]}
