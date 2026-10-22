"""Đóng gói CamNAS thành file .spk cho Package Center của Synology (DSM 7.2.1 trở lên).

Gói không chứa chương trình chạy trực tiếp: nó khai báo một project Docker
(cơ chế "docker-project" của DSM), Container Manager sẽ tải image và chạy container.

    python spk/build.py --image ghcr.io/tvphi/camnas   # dùng image dựng sẵn (bản phát hành)
    python spk/build.py                                # kèm mã nguồn, NAS tự build image khi cài

File .spk được ghi vào thư mục dist/.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import tarfile
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPK = ROOT / "spk"
PACKAGE = "CamNAS"
APP_ID = "com.tvphi.camnas"
PORT = 8090
REPO_URL = "https://github.com/tvPhi/CamNAS"
ICON_SIZES = (16, 24, 32, 48, 64, 72, 256)
SCRIPTS = ("preinst", "postinst", "preuninst", "postuninst", "preupgrade", "postupgrade", "start-stop-status")


def app_version() -> str:
    text = (ROOT / "app" / "nvr" / "__init__.py").read_text(encoding="utf-8")
    return re.search(r'__version__\s*=\s*"([^"]+)"', text).group(1)


def compose(image: str, source: bool, spk_version: str) -> str:
    build = "    build: ../app\n" if source else ""
    return f"""# Tạo bởi spk/build.py - project Docker của gói CamNAS (Container Manager quản lý)
services:
  camnas:
    image: {image}
{build}    container_name: CamNAS
    restart: unless-stopped
    ports:
      - "{PORT}:8080"
    environment:
      ADMIN_PASSWORD: admin
      CAMNAS_INSTALL: spk
      CAMNAS_SPK_VERSION: "{spk_version}"
      CAMNAS_SPK_VARIANT: "{'build-on-nas' if source else ''}"
      DATA_DIR: /camnas/data
      RECORDINGS_DIR: /volume1/camnas
    volumes:
      - /var/packages/{PACKAGE}/var:/camnas/data
      - /volume1:/volume1
      - /etc/localtime:/etc/localtime:ro
      - /var/log:/host-log:ro  # nhật ký cài đặt gói của DSM: xem lỗi cập nhật ngay trong CamNAS
    stop_grace_period: 30s
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "3"
"""


def ui_config() -> str:
    return json.dumps({
        ".url": {
            APP_ID: {
                "type": "url",
                "title": "CamNAS",
                "desc": "Camera recording (NVR)",
                "icon": "images/camnas_{0}.png",
                "protocol": "http",
                "port": str(PORT),
                "url": "/",
                "allUsers": True,
                "grantPrivilege": "all",
                "advanceGrantPrivilege": True,
            }
        }
    }, indent=2) + "\n"


def resource(source: bool) -> str:
    return json.dumps({
        "docker-project": {
            "projects": [{
                "name": "camnas",
                "path": "compose",
                "build_params": {"build": source, "force_pull": False, "force_recreate": True},
            }]
        },
        # thư mục chia sẻ "camnas" để lưu bản ghi; gỡ gói không xoá thư mục này
        # tài khoản của gói (System internal user "CamNAS") được ghi vào thư mục này
        "data-share": {"shares": [{"name": "camnas", "permission": {"rw": ["CamNAS"]}}]},
        # Không khai báo "port-config": Container Manager đã tự đăng ký cổng của container (docker_CamNAS.sc).
        # Khai báo thêm làm cổng 8090 bị đăng ký hai lần, và khi nâng cấp DSM báo "Port conflict" rồi không dựng được project.
        # dịch vụ "CamNAS" trong Web Station (Web Portal → Create → Package service portal): HTTPS bằng chứng chỉ của DSM
        "webservice": {
            "services": [{
                "service": "camnas",
                "display_name": "CamNAS",
                "support_alias": False,  # giao diện dùng đường dẫn tuyệt đối (/static, /api) nên chỉ chạy ở gốc portal
                "support_server": True,
                "type": "reverse_proxy",
                "icon": "ui/images/camnas_{0}.png",
                "proxy_target": f"http://127.0.0.1:{PORT}",
                "proxy_headers": [
                    {"name": "Upgrade", "value": "$http_upgrade"},  # WebSocket cho xem trực tiếp
                    {"name": "Connection", "value": "$connection_upgrade"},
                    {"name": "X-Forwarded-For", "value": "$proxy_add_x_forwarded_for"},
                    {"name": "X-Forwarded-Proto", "value": "$scheme"},
                ],
                "connect_timeout": 60,
                "read_timeout": 3600,
                "send_timeout": 60,
            }],
            "portals": [],
            "pkg_dir_prepare": [],
        },
    }, indent=2) + "\n"


def info(version: str, checksum: str) -> str:
    fields = {
        "package": PACKAGE,
        "version": version,
        "os_min_ver": "7.2-69057",  # DSM 7.2.1: Container Manager hỗ trợ docker-project từ bản 1432
        "install_dep_packages": "ContainerManager>=20.10.23-1432:WebStation",  # Web Station: cổng HTTPS cho CamNAS
        "arch": "noarch",
        "displayname": "CamNAS",
        "description": "Free 24/7 recorder (NVR) for IP cameras: live view, timeline playback and clip export, "
                       "with no per-camera licenses. Runs in Container Manager.",
        "maintainer": "tvPhi",
        "maintainer_url": REPO_URL,
        "distributor": "tvPhi",
        "distributor_url": REPO_URL,
        "helpurl": f"{REPO_URL}#readme",
        "dsmuidir": "ui",
        "dsmappname": APP_ID,
        "adminprotocol": "http",
        "adminport": str(PORT),
        "checkport": "no",
        "ctl_stop": "yes",
        "thirdparty": "yes",
        "checksum": checksum,
    }
    return "".join(f'{k}="{v}"\n' for k, v in fields.items())


def text(content: str) -> bytes:
    return content.replace("\r\n", "\n").encode("utf-8")


class Archive:
    """Gom file vào một tar trong bộ nhớ, đặt quyền đúng kiểu Linux."""

    def __init__(self, mode: str):
        self.buf = io.BytesIO()
        self.tar = tarfile.open(fileobj=self.buf, mode=mode, format=tarfile.GNU_FORMAT)
        self.now = int(time.time())
        self.dirs: set[str] = set()

    def _dir(self, name: str) -> None:
        parent = name.rpartition("/")[0]
        if not parent or parent in self.dirs:
            return
        self._dir(parent)
        self.dirs.add(parent)
        info = tarfile.TarInfo(parent)
        info.type, info.mode, info.mtime = tarfile.DIRTYPE, 0o755, self.now
        self.tar.addfile(info)

    def add(self, name: str, data: bytes, mode: int = 0o644) -> None:
        self._dir(name)
        info = tarfile.TarInfo(name)
        info.size, info.mode, info.mtime = len(data), mode, self.now
        self.tar.addfile(info, io.BytesIO(data))

    def close(self) -> bytes:
        self.tar.close()
        return self.buf.getvalue()


def build(version: str, build_no: int, image: str | None, out: Path) -> Path:
    source = image is None
    image_ref = f"camnas:{version}" if source else image

    spk_version = f"{version.split('-')[0]}-{build_no:04d}"
    pkg = Archive("w:gz")
    pkg.add("compose/docker-compose.yml", text(compose(image_ref, source, spk_version)))
    if source:
        for f in sorted((ROOT / "app").rglob("*")):
            if f.is_file() and "__pycache__" not in f.parts and f.suffix != ".pyc":
                rel = f.relative_to(ROOT).as_posix()
                data = f.read_bytes()
                pkg.add(rel, data.replace(b"\r\n", b"\n") if f.suffix in {".py", ".js", ".css", ".html", ".txt", ""} else data)
    pkg.add("ui/config", text(ui_config()))
    for size in ICON_SIZES:
        pkg.add(f"ui/images/camnas_{size}.png", (SPK / "icons" / f"camnas_{size}.png").read_bytes())
    package_tgz = pkg.close()

    spk = Archive("w")
    spk.add("INFO", text(info(spk_version, hashlib.md5(package_tgz).hexdigest())))
    spk.add("package.tgz", package_tgz)
    for name in SCRIPTS:
        spk.add(f"scripts/{name}", text((SPK / "scripts" / name).read_text(encoding="utf-8")), 0o755)
    spk.add("conf/privilege", text((SPK / "conf" / "privilege").read_text(encoding="utf-8")))
    spk.add("conf/resource", text(resource(source)))
    spk.add("PACKAGE_ICON.PNG", (SPK / "icons" / "camnas_64.png").read_bytes())
    spk.add("PACKAGE_ICON_256.PNG", (SPK / "icons" / "camnas_256.png").read_bytes())
    spk.add("LICENSE", text((ROOT / "LICENSE").read_text(encoding="utf-8")))

    out.mkdir(parents=True, exist_ok=True)
    suffix = "" if not source else "-build-on-nas"
    path = out / f"{PACKAGE}-{spk_version}{suffix}.spk"
    path.write_bytes(spk.close())
    return path


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--version", default=app_version(), help="phiên bản CamNAS (mặc định lấy từ app/nvr/__init__.py)")
    ap.add_argument("--build", type=int, default=1, help="số build của gói, phải tăng dần qua mỗi lần phát hành")
    ap.add_argument("--image", help="image dựng sẵn, ví dụ ghcr.io/tvphi/camnas (bỏ trống = NAS tự build từ mã nguồn)")
    ap.add_argument("--image-tag", help="tag của image (mặc định = --version)")
    ap.add_argument("--out", type=Path, default=ROOT / "dist")
    args = ap.parse_args()
    image = f"{args.image}:{args.image_tag or args.version}" if args.image else None
    path = build(args.version, args.build, image, args.out)
    print(path)


if __name__ == "__main__":
    main()
