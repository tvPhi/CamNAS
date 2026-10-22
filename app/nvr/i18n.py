"""Đa ngôn ngữ phía máy chủ (Tiếng Việt / English).

Chuỗi tiếng Việt trong code là khoá, bảng EN là bản dịch. Ngôn ngữ của mỗi yêu cầu lấy
từ header X-Lang mà giao diện gửi lên. Thông báo sinh ra ở nền (nhật ký, trạng thái camera)
được giữ dạng "mẫu + tham số" để hiển thị đúng ngôn ngữ của người đang xem.
"""
from __future__ import annotations

from contextvars import ContextVar

LANGS = ("vi", "en")
current_lang: ContextVar[str] = ContextVar("lang", default="vi")


def msg(tpl: str, **params) -> dict:
    """Thông báo để dịch về sau, lúc hiển thị."""
    return {"tpl": tpl, "params": params}


def render(m, lang: str | None = None) -> str:
    lang = lang or current_lang.get()
    if isinstance(m, dict) and "tpl" in m:
        text = EN.get(m["tpl"], m["tpl"]) if lang == "en" else m["tpl"]
        params = {k: _param(v, lang) for k, v in (m.get("params") or {}).items()}
        try:
            return text.format(**params)
        except (KeyError, IndexError, ValueError):
            return text
    if isinstance(m, str):
        return EN.get(m, m) if lang == "en" else m
    return str(m)


def _param(v, lang: str):
    if isinstance(v, dict) and "dur" in v:
        return fmt_duration(v["dur"], lang)
    if isinstance(v, dict) and "tpl" in v:
        return render(v, lang)
    if isinstance(v, str):
        return EN.get(v, v) if lang == "en" else v
    return v


def tr(tpl: str, **params) -> str:
    """Dịch ngay theo ngôn ngữ của yêu cầu hiện tại."""
    return render(msg(tpl, **params))


def fmt_duration(seconds: float, lang: str) -> str:
    s = int(seconds)
    if lang == "en":
        if s < 60:
            return f"{s}s"
        if s < 3600:
            return f"{s // 60} min"
        return f"{s // 3600}h {s % 3600 // 60}m"
    if s < 60:
        return f"{s} giây"
    if s < 3600:
        return f"{s // 60} phút"
    return f"{s // 3600} giờ {s % 3600 // 60} phút"


class UserError(ValueError):
    """Lỗi báo cho người dùng; tự dịch theo ngôn ngữ của yêu cầu khi in ra."""

    def __init__(self, tpl: str, **params):
        super().__init__(tpl)
        self.msg = msg(tpl, **params)

    def __str__(self) -> str:
        return render(self.msg)


class LangMiddleware:
    """Đọc ngôn ngữ từ header X-Lang cho từng yêu cầu."""

    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] in ("http", "websocket"):
            lang = dict(scope.get("headers") or []).get(b"x-lang", b"").decode()
            current_lang.set(lang if lang in LANGS else "vi")
        await self.app(scope, receive, send)


EN: dict[str, str] = {
    # đăng nhập, hệ thống
    "Chưa đăng nhập": "Not signed in",
    "Sai mật khẩu": "Wrong password",
    "Sai mật khẩu quá nhiều lần, thử lại sau {wait} giây": "Too many wrong passwords, try again in {wait} seconds",
    "Đăng nhập sai mật khẩu từ {ip}": "Failed sign-in with a wrong password from {ip}",
    "Mật khẩu hiện tại không đúng": "The current password is incorrect",
    "Đã đổi mật khẩu đăng nhập": "Sign-in password changed",
    "File sao lưu không hợp lệ": "Invalid backup file",
    # HTTPS
    "Không tìm thấy chứng chỉ của NAS (thư mục {path})": "No NAS certificate found (folder {path})",
    "Không đọc được chứng chỉ: {error}": "Cannot read the certificate: {error}",
    "Không bật được HTTPS: {error}": "Could not turn on HTTPS: {error}",
    "Không mở được cổng HTTPS {port}: {error}": "Cannot open HTTPS port {port}: {error}",
    "HTTPS đang chạy ở cổng {port} (chứng chỉ {names})": "HTTPS is running on port {port} (certificate {names})",
    "Đã nạp chứng chỉ HTTPS mới": "Loaded the renewed HTTPS certificate",
    "Đã tắt HTTPS": "HTTPS turned off",
    # cập nhật
    "Không kiểm tra được phiên bản mới: {error}": "Could not check for updates: {error}",
    "Đã có phiên bản mới {version}": "Version {version} is available",
    "Package Center đã đọc nguồn gói CamNAS (DSM build {build}, {arch})":
        "Package Center read the CamNAS package source (DSM build {build}, {arch})",
    "Không đọc được {image}. Package này trên GitHub cần để Public.":
        "Could not read {image}. This package must be public on GitHub.",
    "Địa chỉ HTTPS không hợp lệ, ví dụ: https://nas.ten-mien.com:8443":
        "Invalid HTTPS address, for example: https://nas.your-domain.com:8443",
    "Gói CamNAS chưa được cấp quyền ghi vào {path}. Trong DSM vào Control Panel → Shared Folder → chọn \"{share}\" → "
    "Edit → Permissions, đổi ô Local users thành System internal user, rồi tick Read/Write cho {user}.":
        "The CamNAS package may not write to {path} yet. In DSM open Control Panel → Shared Folder → select \"{share}\" → "
        "Edit → Permissions, switch Local users to System internal user, then tick Read/Write for {user}.",
    "Không ghi được vào {path}: CamNAS (chạy bằng {user}) chưa có quyền ghi vào thư mục này.":
        "Cannot write to {path}: CamNAS (running as {user}) has no write permission on this folder.",
    "Đã khôi phục cấu hình từ bản sao lưu ({n} camera)": "Configuration restored from a backup ({n} camera(s))",
    "CamNAS {version} khởi động với {n} camera": "CamNAS {version} started with {n} camera(s)",
    "CamNAS đã dừng": "CamNAS stopped",
    "Không chạy được go2rtc ({error}) - xem trực tiếp và ghi hình sẽ không hoạt động":
        "Cannot start go2rtc ({error}) - live view and recording will not work",
    "go2rtc dừng bất thường (mã {code}), đang khởi động lại": "go2rtc stopped unexpectedly (code {code}), restarting",
    "Dịch vụ xem trực tiếp (go2rtc) chưa chạy": "The live view service (go2rtc) is not running",
    # camera
    "Không tìm thấy camera": "Camera not found",
    "Địa chỉ luồng chính không hợp lệ (ví dụ rtsp://...)": "Invalid main stream address (e.g. rtsp://...)",
    "Địa chỉ luồng phụ không hợp lệ": "Invalid sub stream address",
    'Thêm camera "{name}"': 'Added camera "{name}"',
    'Xoá camera "{name}"': 'Deleted camera "{name}"',
    'Xoá camera "{name}" và toàn bộ bản ghi': 'Deleted camera "{name}" and all its recordings',
    "Bật ghi hình": "Recording enabled",
    "Tắt ghi hình": "Recording disabled",
    "Cập nhật cài đặt camera": "Camera settings updated",
    "Không lấy được ảnh từ camera": "Could not get an image from the camera",
    "Hết thời gian chờ - camera không phản hồi (kiểm tra IP, cổng 554)": "Timed out - the camera is not responding (check the IP and port 554)",
    "không rõ lỗi": "unknown error",
    "Sai tên đăng nhập hoặc mật khẩu (với Ezviz: mật khẩu là mã xác minh 6 chữ in hoa dưới đáy camera)":
        "Wrong username or password (for EZVIZ: the password is the 6-letter verification code under the camera)",
    "Sai đường dẫn luồng RTSP": "Wrong RTSP stream path",
    "Camera từ chối kết nối - có thể RTSP chưa được bật": "The camera refused the connection - RTSP may be turned off",
    "Camera đang nén H.265: vẫn ghi được, nhưng nhiều trình duyệt (Firefox, Chrome trên máy không có giải mã phần cứng) "
    "không xem được. Nên chuyển camera sang H.264 trong ứng dụng/EZVIZ Studio.":
        "The camera uses H.265: recording works, but many browsers (Firefox, Chrome without hardware decoding) cannot "
        "play it. Switch the camera to H.264 in its app or EZVIZ Studio.",
    "Không thấy luồng video": "No video stream found",
    # ghi hình
    "Bắt đầu ghi hình": "Recording started",
    "Đã dừng ghi hình": "Recording stopped",
    "Mất kết nối, đang thử lại: {error}": "Connection lost, retrying: {error}",
    "Không ghi được: {error}": "Cannot record: {error}",
    "Đã kết nối lại, tiếp tục ghi (gián đoạn {gap})": "Reconnected, recording resumed (gap of {gap})",
    "Không lấy được hình từ camera (camera đang tắt/mất mạng, hoặc sai địa chỉ RTSP/mật khẩu)":
        "Cannot get video from the camera (camera off or offline, or wrong RTSP address/password)",
    "Mất tín hiệu từ camera (mất mạng wifi hoặc camera đang khởi động lại)":
        "Lost the camera signal (Wi-Fi dropped or the camera is restarting)",
    "Camera chưa gửi được hình (có thể đang mất kết nối)": "The camera is not sending video yet (it may be offline)",
    "Sai tên đăng nhập hoặc mật khẩu camera": "Wrong camera username or password",
    "Dịch vụ go2rtc chưa sẵn sàng": "The go2rtc service is not ready",
    "Ổ cứng đã đầy": "The disk is full",
    "Không có quyền ghi vào thư mục lưu bản ghi": "No permission to write to the recordings folder",
    "Không nhận được hình ảnh trong {n} giây": "No video received for {n} seconds",
    "ffmpeg dừng (mã {code})": "ffmpeg stopped (code {code})",
    "Không chạy được ffmpeg: {error}": "Cannot start ffmpeg: {error}",
    "Không tạo được thư mục ghi hình: {error}": "Cannot create the recording folder: {error}",
    "Thư mục lưu bản ghi {path} không tồn tại - vào Cài đặt để chọn thư mục lưu":
        "The recordings folder {path} does not exist - choose one in Settings",
    # lưu trữ
    "Cập nhật cài đặt lưu trữ: giữ {days} ngày, file {minutes} phút":
        "Storage settings updated: keep {days} days, {minutes}-minute files",
    "Cập nhật cài đặt lưu trữ: giữ đến khi ổ gần đầy, file {minutes} phút":
        "Storage settings updated: keep until the disk is nearly full, {minutes}-minute files",
    "Xoá {n} thư mục ngày quá hạn {days} ngày (giải phóng {gb} GB)":
        "Deleted {n} day folder(s) older than {days} days (freed {gb} GB)",
    "Đã xoá {n} file cũ nhất (giải phóng {gb} GB) để giữ dung lượng trong giới hạn đã đặt":
        "Deleted the {n} oldest file(s) (freed {gb} GB) to stay within the storage limits",
    "CẢNH BÁO: ổ cứng gần đầy nhưng không còn bản ghi cũ (trên 24 giờ) để xoá":
        "WARNING: the disk is nearly full but there are no recordings older than 24 hours left to delete",
    "Ngày không hợp lệ": "Invalid date",
    "Không tìm thấy file": "File not found",
    "Thời điểm kết thúc phải sau thời điểm bắt đầu": "The end time must be after the start time",
    "Mỗi lần chỉ xuất tối đa 3 giờ": "You can export at most 3 hours at a time",
    "Không có bản ghi nào trong khoảng thời gian này": "There are no recordings in this time range",
    "Xuất clip quá lâu, hãy chọn khoảng ngắn hơn": "The export took too long, choose a shorter range",
    "Xuất clip lỗi: {error}": "Clip export failed: {error}",
    "File xuất đã hết hạn, hãy xuất lại": "The exported file has expired, please export again",
    # thư mục lưu
    "Hãy nhập đường dẫn thư mục, ví dụ /volume1/camera": "Enter a folder path, e.g. /volume1/camera",
    "Hãy nhập đường dẫn đầy đủ, ví dụ /volume1/camera": "Enter a full path, e.g. /volume1/camera",
    "Container chưa được cấp quyền vào ổ NAS. Hãy dùng docker-compose.yml bản mới (có dòng /volume1:/volume1) "
    "rồi build lại Project.":
        "The container has no access to the NAS volumes. Use the new docker-compose.yml (with the "
        "/volume1:/volume1 line) and rebuild the project.",
    "Chỉ chọn được thư mục nằm trong: {roots}": "You can only choose folders inside: {roots}",
    "Hãy chọn một thư mục con (ví dụ {example}), không chọn cả ổ {root}":
        "Choose a subfolder (e.g. {example}), not the whole volume {root}",
    "Không dùng thư mục hệ thống hoặc thư mục ẩn (tên bắt đầu bằng @, # hoặc .)":
        "System or hidden folders (names starting with @, # or .) cannot be used",
    'Chưa có thư mục chia sẻ "{name}". Hãy tạo nó trong DSM (Control Panel → Shared Folder) '
    "hoặc chọn thư mục nằm trong một thư mục chia sẻ có sẵn.":
        'There is no shared folder "{name}". Create it in DSM (Control Panel → Shared Folder) '
        "or choose a folder inside an existing shared folder.",
    "Không lưu bản ghi bên trong thư mục cấu hình của CamNAS": "Recordings cannot be stored inside the CamNAS config folder",
    "Không tạo hoặc không ghi được vào {path}: {error}": "Cannot create or write to {path}: {error}",
    "Thư mục nằm ngoài các ổ được phép": "This folder is outside the allowed volumes",
    "Không mở được thư mục {path}": "Cannot open the folder {path}",
    "Đổi thư mục lưu bản ghi: {old} → {new}": "Recordings folder changed: {old} → {new}",
    "Đã chuyển bản ghi của {n} camera từ {old} sang {new}": "Moved the recordings of {n} camera(s) from {old} to {new}",
    "Bản ghi cũ vẫn nằm ở {old} (khác ổ đĩa nên không tự chuyển). Có thể chuyển bằng File Station nếu cần.":
        "Existing recordings stay in {old} (a different volume, so they were not moved). You can move them with File Station if needed.",
    "Không chuyển được bản ghi cũ ({error}), chúng vẫn nằm ở {old}": "Could not move existing recordings ({error}); they are still in {old}",
    "Thư mục lưu bản ghi {path} chưa dùng được: {error}. Vào Cài đặt để chọn thư mục khác.":
        "The recordings folder {path} cannot be used: {error}. Choose another folder in Settings.",
}
