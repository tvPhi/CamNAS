"""Web server: giao diện, API quản lý camera, xem lại bản ghi và chuyển tiếp luồng xem trực tiếp."""
from __future__ import annotations

import asyncio
import logging
import re
import secrets
import shutil
import time
from contextlib import asynccontextmanager, suppress
from datetime import date, datetime
from pathlib import Path

import httpx
from fastapi import APIRouter, Depends, FastAPI, HTTPException, Request, Response, WebSocket
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from starlette.background import BackgroundTask
from websockets.asyncio.client import connect as ws_connect
from websockets.exceptions import WebSocketException

from . import __version__, storage
from .auth import COOKIE, SESSION_SECONDS, Auth
from .config import (
    CAMERA_ID_RE, DATA_DIR, DEFAULT_RECORDINGS_DIR, GO2RTC_URL, Camera, ConfigStore, Settings,
    recordings_dir, set_recordings_dir, storage_roots,
)
from .events import EventLog
from .go2rtc import Go2rtc, stream_names
from .i18n import LangMiddleware, UserError, msg, render, tr
from .recorder import RecorderManager

log = logging.getLogger("camnas")
WEB_DIR = Path(__file__).parent / "web"
URL_RE = re.compile(r"^[a-z][a-z0-9+.-]*://\S+$", re.I)
RETENTION_INTERVAL = 300


class Ctx:
    store: ConfigStore
    auth: Auth
    events: EventLog
    go2rtc: Go2rtc
    recorders: RecorderManager
    storage: storage.Storage
    started: float
    apply_lock: asyncio.Lock
    retention_now: asyncio.Event


ctx = Ctx()


async def apply_changes() -> None:
    """Đồng bộ go2rtc và các bộ ghi với cấu hình hiện tại."""
    async with ctx.apply_lock:
        await _sync_services()


async def _sync_services() -> None:
    cfg = ctx.store.config
    if ctx.go2rtc.needs_update(cfg.cameras):
        # dừng bộ ghi trước để file mp4 đang ghi được đóng đúng cách
        await ctx.recorders.stop_all()
        await ctx.go2rtc.apply(cfg.cameras)
    await ctx.recorders.sync(cfg.cameras, cfg.settings)


async def retention_loop() -> None:
    while True:
        try:
            msgs = await asyncio.to_thread(
                ctx.storage.enforce, ctx.store.config.settings, ctx.recorders.active_files()
            )
            for level, m in msgs:
                ctx.events.add(level, m)
        except Exception:  # noqa: BLE001 - vòng lặp nền không được chết
            log.exception("retention")
        ctx.retention_now.clear()
        with suppress(asyncio.TimeoutError):
            await asyncio.wait_for(ctx.retention_now.wait(), RETENTION_INTERVAL)


@asynccontextmanager
async def lifespan(_: FastAPI):
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    storage.clean_exports()
    ctx.store = ConfigStore(DATA_DIR / "config.json")
    ctx.auth = Auth(ctx.store)
    ctx.events = EventLog(DATA_DIR / "events.jsonl")
    ctx.go2rtc = Go2rtc(ctx.events)
    ctx.recorders = RecorderManager(ctx.events)
    ctx.storage = storage.Storage()
    ctx.started = time.time()
    ctx.apply_lock = asyncio.Lock()
    ctx.retention_now = asyncio.Event()

    ctx.events.add("info", "CamNAS {version} khởi động với {n} camera", version=__version__, n=len(ctx.store.config.cameras))
    saved_dir = ctx.store.config.settings.recordings_dir
    set_recordings_dir(Path(saved_dir) if saved_dir else DEFAULT_RECORDINGS_DIR)
    try:
        await asyncio.to_thread(storage.prepare_recordings_dir, str(recordings_dir()), False)
        storage.mark_camera_dirs([c.id for c in ctx.store.config.cameras])
        if not saved_dir:
            # ghi nhớ thư mục đang dùng: sau này đổi RECORDINGS_DIR trong docker-compose.yml
            # cũng không làm bản ghi "biến mất" khỏi trang Xem lại
            ctx.store.config.settings.recordings_dir = str(recordings_dir())
            ctx.store.save()
    except UserError as e:
        ctx.events.add("error", "Thư mục lưu bản ghi {path} chưa dùng được: {error}. Vào Cài đặt để chọn thư mục khác.",
                       path=str(recordings_dir()), error=e.msg)
    await ctx.go2rtc.start(ctx.store.config.cameras)
    await apply_changes()
    tasks = [asyncio.create_task(retention_loop()), asyncio.create_task(ctx.recorders.maintain())]
    try:
        yield
    finally:
        for t in tasks:
            t.cancel()
        await ctx.recorders.stop_all()
        await ctx.go2rtc.stop()
        ctx.events.add("info", "CamNAS đã dừng")


app = FastAPI(title="CamNAS", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
app.add_middleware(LangMiddleware)


@app.middleware("http")
async def no_cache_ui(request: Request, call_next):
    response = await call_next(request)
    if request.url.path == "/" or request.url.path.startswith("/static/"):
        response.headers["Cache-Control"] = "no-cache"
    return response


def require_auth(request: Request) -> None:
    if not ctx.auth.valid_token(request.cookies.get(COOKIE)):
        raise HTTPException(401, tr("Chưa đăng nhập"))


# ---------- đăng nhập ----------

class LoginIn(BaseModel):
    password: str


@app.post("/api/login")
def login(body: LoginIn, request: Request, response: Response):
    ip = request.client.host if request.client else "?"
    wait = ctx.auth.locked_for(ip)
    if wait:
        raise HTTPException(429, tr("Sai mật khẩu quá nhiều lần, thử lại sau {wait} giây", wait=wait))
    ok = ctx.auth.check_password(body.password)
    ctx.auth.register_attempt(ip, ok)
    if not ok:
        ctx.events.add("warn", "Đăng nhập sai mật khẩu từ {ip}", ip=ip)
        raise HTTPException(401, tr("Sai mật khẩu"))
    response.set_cookie(COOKIE, ctx.auth.make_token(), max_age=SESSION_SECONDS, httponly=True, samesite="lax")
    return {"ok": True}


@app.post("/api/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE)
    return {"ok": True}


@app.get("/api/me")
def me(request: Request):
    authenticated = ctx.auth.valid_token(request.cookies.get(COOKIE))
    return {
        "authenticated": authenticated,
        "default_password": authenticated and ctx.auth.is_default_password(),
        "version": __version__,
    }


api = APIRouter(dependencies=[Depends(require_auth)])


# ---------- camera ----------

class CameraIn(BaseModel):
    name: str = Field(min_length=1, max_length=60)
    url: str
    sub_url: str = ""
    record: bool = True
    audio: bool = True


class CameraPatch(BaseModel):
    name: str | None = Field(None, min_length=1, max_length=60)
    url: str | None = None
    sub_url: str | None = None
    record: bool | None = None
    audio: bool | None = None


def _check_urls(url: str | None, sub_url: str | None) -> None:
    if url is not None and not URL_RE.match(url.strip()):
        raise HTTPException(400, tr("Địa chỉ luồng chính không hợp lệ (ví dụ rtsp://...)"))
    if sub_url and not URL_RE.match(sub_url.strip()):
        raise HTTPException(400, tr("Địa chỉ luồng phụ không hợp lệ"))


def camera_out(cam: Camera) -> dict:
    return {**cam.model_dump(), "status": ctx.recorders.status(cam.id)}


def get_camera(cam_id: str) -> Camera:
    cam = ctx.store.camera(cam_id)
    if not cam:
        raise HTTPException(404, tr("Không tìm thấy camera"))
    return cam


@api.get("/api/cameras")
def list_cameras():
    return [camera_out(c) for c in ctx.store.config.cameras]


@api.post("/api/cameras")
async def add_camera(body: CameraIn):
    _check_urls(body.url, body.sub_url)
    cam = Camera(id=ctx.store.new_camera_id(body.name), **{k: v.strip() if isinstance(v, str) else v for k, v in body.model_dump().items()})
    ctx.store.config.cameras.append(cam)
    ctx.store.save()
    ctx.events.add("info", "Thêm camera \"{name}\"", cam.id, name=cam.name)
    await apply_changes()
    return camera_out(cam)


@api.put("/api/cameras/{cam_id}")
async def update_camera(cam_id: str, body: CameraPatch):
    cam = get_camera(cam_id)
    _check_urls(body.url, body.sub_url)
    changes = {k: v.strip() if isinstance(v, str) else v for k, v in body.model_dump(exclude_none=True).items()}
    updated = cam.model_copy(update=changes)
    cams = ctx.store.config.cameras
    cams[cams.index(cam)] = updated
    ctx.store.save()
    if "record" in changes and changes["record"] != cam.record:
        ctx.events.add("info", "Bật ghi hình" if updated.record else "Tắt ghi hình", cam_id)
    elif changes:
        ctx.events.add("info", "Cập nhật cài đặt camera", cam_id)
    await apply_changes()
    return camera_out(updated)


@api.delete("/api/cameras/{cam_id}")
async def delete_camera(cam_id: str, purge: bool = False):
    cam = get_camera(cam_id)
    ctx.store.config.cameras.remove(cam)
    ctx.store.save()
    await apply_changes()
    if purge:
        await asyncio.to_thread(shutil.rmtree, recordings_dir() / cam_id, True)
    ctx.events.add("info", "Xoá camera \"{name}\" và toàn bộ bản ghi" if purge else "Xoá camera \"{name}\"", cam_id, name=cam.name)
    return {"ok": True}


class ProbeIn(BaseModel):
    url: str


@api.post("/api/probe")
async def probe_camera(body: ProbeIn):
    _check_urls(body.url, None)
    return await storage.probe(body.url.strip())


@api.get("/api/cameras/{cam_id}/snapshot")
async def snapshot(cam_id: str, hq: bool = False):
    cam = get_camera(cam_id)
    names = stream_names(cam)
    data = await ctx.go2rtc.snapshot(names[0] if hq else names[-1])
    if data is None:
        raise HTTPException(503, tr("Không lấy được ảnh từ camera"))
    return Response(data, media_type="image/jpeg", headers={"Cache-Control": "no-store"})


# ---------- xem lại ----------

@api.get("/api/days")
def recording_days():
    return {"days": storage.list_days([c.id for c in ctx.store.config.cameras])}


@api.get("/api/timeline")
def get_timeline(day: str):
    if not storage.DAY_RE.match(day):
        raise HTTPException(400, tr("Ngày không hợp lệ"))
    return {
        "day": day,
        "start": storage.day_start(day),
        "now": time.time(),
        "cameras": storage.timeline([c.id for c in ctx.store.config.cameras], day),
    }


@api.get("/media/{cam_id}/{day}/{name}")
def media(cam_id: str, day: str, name: str, download: bool = False):
    path = storage.segment_path(cam_id, day, name) if CAMERA_ID_RE.match(cam_id) else None
    if not path:
        raise HTTPException(404, tr("Không tìm thấy file"))
    filename = f"{cam_id}_{day}_{name}" if download else None
    return FileResponse(path, media_type="video/mp4", filename=filename, content_disposition_type="attachment" if download else "inline")


class ExportIn(BaseModel):
    cam: str
    start: float
    end: float


_exports: dict[str, tuple[Path, str]] = {}


@api.post("/api/export")
async def export(body: ExportIn):
    """Ghép các đoạn ghi thành 1 file; tải về bằng GET /api/export/{token}."""
    get_camera(body.cam)
    storage.clean_exports(max_age=3600)
    try:
        path = await storage.export_clip(body.cam, body.start, body.end)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    token = secrets.token_urlsafe(12)
    name = f"{body.cam}_{datetime.fromtimestamp(body.start):%Y-%m-%d_%H-%M-%S}.mp4"
    _exports[token] = (path, name)
    return {"token": token, "name": name, "size": path.stat().st_size}


@api.get("/api/export/{token}")
def export_download(token: str):
    path, name = _exports.pop(token, (None, None))
    if not path or not path.exists():
        raise HTTPException(404, tr("File xuất đã hết hạn, hãy xuất lại"))
    return FileResponse(path, media_type="video/mp4", filename=name, background=BackgroundTask(path.unlink, missing_ok=True))


# ---------- hệ thống ----------

@api.get("/api/system")
def system():
    settings = ctx.store.config.settings
    return {
        "version": __version__,
        "uptime": time.time() - ctx.started,
        "go2rtc": ctx.go2rtc.running,
        "default_password": ctx.auth.is_default_password(),
        "settings": settings.model_dump(),
        "storage": ctx.storage.stats(settings),
        "today": date.today().isoformat(),
        "recordings_dir": str(recordings_dir()),
        "storage_roots": [str(r) for r in storage_roots()],
    }


class StoragePathIn(BaseModel):
    path: str


@api.put("/api/storage-path")
async def set_storage_path(body: StoragePathIn):
    """Đổi thư mục lưu bản ghi: tạo thư mục nếu chưa có, chuyển bản ghi cũ (nếu cùng ổ) rồi ghi tiếp ở đó."""
    try:
        new = await asyncio.to_thread(storage.prepare_recordings_dir, body.path)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    old = recordings_dir()
    if new == old:
        return {"path": str(new), "notice": None}
    async with ctx.apply_lock:
        await ctx.recorders.stop_all()  # đóng file đang ghi trước khi chuyển
        try:
            notice = await asyncio.to_thread(storage.move_recordings, old, new)
        except OSError as e:
            notice = msg("Không chuyển được bản ghi cũ ({error}), chúng vẫn nằm ở {old}", error=str(e), old=str(old))
        set_recordings_dir(new)
        ctx.storage.reset()
        ctx.store.config.settings.recordings_dir = str(new)
        ctx.store.save()
        ctx.events.add("info", "Đổi thư mục lưu bản ghi: {old} → {new}", old=str(old), new=str(new))
        if notice:
            ctx.events.add("info", notice)
        await _sync_services()
    return {"path": str(new), "notice": render(notice) if notice else None}


@api.get("/api/fs/dirs")
def browse_dirs(path: str = ""):
    try:
        return storage.list_dirs(path)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@api.put("/api/settings")
async def update_settings(body: Settings):
    # thư mục lưu chỉ đổi qua /api/storage-path (có kiểm tra và chuyển bản ghi)
    body.recordings_dir = ctx.store.config.settings.recordings_dir
    ctx.store.config.settings = body
    ctx.store.save()
    if body.retention_days:
        ctx.events.add("info", "Cập nhật cài đặt lưu trữ: giữ {days} ngày, file {minutes} phút",
                       days=body.retention_days, minutes=body.segment_minutes)
    else:
        ctx.events.add("info", "Cập nhật cài đặt lưu trữ: giữ đến khi ổ gần đầy, file {minutes} phút", minutes=body.segment_minutes)
    await apply_changes()
    ctx.retention_now.set()
    return body


class PasswordIn(BaseModel):
    current: str
    new: str = Field(min_length=6, max_length=128)


@api.post("/api/password")
def change_password(body: PasswordIn, response: Response):
    if not ctx.auth.check_password(body.current):
        raise HTTPException(400, tr("Mật khẩu hiện tại không đúng"))
    ctx.auth.set_password(body.new)
    ctx.events.add("info", "Đã đổi mật khẩu đăng nhập")
    response.set_cookie(COOKIE, ctx.auth.make_token(), max_age=SESSION_SECONDS, httponly=True, samesite="lax")
    return {"ok": True}


@api.get("/api/events")
def events(limit: int = 300, camera: str | None = None, level: str | None = None):
    return ctx.events.list(min(limit, 2000), camera, level)


# ---------- xem trực tiếp (chuyển tiếp go2rtc) ----------

@api.get("/live/{name}")
async def live_asset(name: str):
    if name not in ("video-rtc.js", "video-stream.js"):
        raise HTTPException(404)
    data = await ctx.go2rtc.asset(name)
    if data is None:
        raise HTTPException(503, tr("Dịch vụ xem trực tiếp (go2rtc) chưa chạy"))
    return Response(data, media_type="application/javascript")


@api.get("/api/live/hls/{path:path}")
async def live_hls(path: str, request: Request):
    # Dự phòng cho iPhone đời cũ chưa có MSE
    async with httpx.AsyncClient(base_url=GO2RTC_URL, timeout=20) as client:
        r = await client.get(f"/api/hls/{path}", params=request.query_params)
    return Response(r.content, status_code=r.status_code, media_type=r.headers.get("content-type"))


@app.websocket("/api/live/ws")
async def live_ws(ws: WebSocket, src: str = ""):
    if not ctx.auth.valid_token(ws.cookies.get(COOKIE)) or src not in ctx.go2rtc.streams:
        await ws.close(code=4401)
        return
    await ws.accept()
    upstream_url = GO2RTC_URL.replace("http", "ws", 1) + f"/api/ws?src={src}"
    try:
        async with ws_connect(upstream_url, max_size=None, compression=None) as upstream:

            async def client_to_upstream():
                while True:
                    msg = await ws.receive()
                    if msg["type"] == "websocket.disconnect":
                        return
                    if msg.get("text") is not None:
                        await upstream.send(msg["text"])
                    elif msg.get("bytes") is not None:
                        await upstream.send(msg["bytes"])

            async def upstream_to_client():
                async for msg in upstream:
                    if isinstance(msg, bytes):
                        await ws.send_bytes(msg)
                    else:
                        await ws.send_text(msg)

            tasks = [asyncio.create_task(client_to_upstream()), asyncio.create_task(upstream_to_client())]
            _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
            for t in pending:
                t.cancel()
            await asyncio.gather(*pending, return_exceptions=True)
    except (OSError, WebSocketException):
        pass
    with suppress(Exception):
        await ws.close()


app.include_router(api)


@app.exception_handler(HTTPException)
async def http_error(_: Request, exc: HTTPException):
    return JSONResponse({"error": exc.detail}, status_code=exc.status_code)


@app.get("/")
def index():
    return FileResponse(WEB_DIR / "index.html")


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")
