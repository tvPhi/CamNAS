"""Link chia sẻ một camera: xem trực tiếp camera đó mà không cần tài khoản CamNAS.

Mỗi link là một mã ngẫu nhiên khó đoán, có thể kèm mật khẩu và ngày hết hạn. Người xem chỉ đi được tới
luồng của đúng camera trong link, không gọi được API quản trị nào.
"""
from __future__ import annotations

import secrets
import time
from datetime import date, datetime, timedelta

from .config import Share

MAX_SESSION = 30 * 24 * 3600  # người xem nhập mật khẩu một lần, dùng tối đa 30 ngày (không quá ngày hết hạn)


def new_id() -> str:
    return secrets.token_urlsafe(16)


def expired(share: Share) -> bool:
    return bool(share.expires) and date.today().isoformat() > share.expires


def seconds_left(share: Share) -> float | None:
    """Số giây còn lại tới hết ngày hết hạn (giờ NAS); None nếu không hết hạn."""
    if not share.expires:
        return None
    end = datetime.combine(date.fromisoformat(share.expires) + timedelta(days=1), datetime.min.time())
    return end.timestamp() - time.time()


def session_seconds(share: Share) -> int:
    left = seconds_left(share)
    return int(MAX_SESSION if left is None else max(60, min(left, MAX_SESSION)))


def cookie_name(share: Share) -> str:
    return f"camnas_share_{share.id}"


def share_out(share: Share) -> dict:
    return {
        "id": share.id,
        "camera": share.camera,
        "label": share.label,
        "expires": share.expires,
        "password": bool(share.password_hash),
        "created": share.created,
        "expired": expired(share),
        "path": f"/s/{share.id}",
    }
