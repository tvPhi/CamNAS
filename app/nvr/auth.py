"""Đăng nhập bằng mật khẩu, phiên lưu trong cookie có ký HMAC."""
from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import time

from .config import DATA_DIR, ConfigStore

COOKIE = "camnas_session"
SESSION_SECONDS = 30 * 24 * 3600
DEFAULT_PASSWORD = "admin"
MAX_FAILS = 5
LOCK_SECONDS = 60


def hash_password(password: str) -> str:
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), salt, 200_000)
    return f"pbkdf2${salt.hex()}${dk.hex()}"


def _verify_hash(password: str, stored: str) -> bool:
    try:
        _, salt, digest = stored.split("$")
    except ValueError:
        return False
    dk = hashlib.pbkdf2_hmac("sha256", password.encode(), bytes.fromhex(salt), 200_000)
    return hmac.compare_digest(dk.hex(), digest)


class Auth:
    def __init__(self, store: ConfigStore):
        self.store = store
        key_file = DATA_DIR / "secret.key"
        if not key_file.exists():
            key_file.parent.mkdir(parents=True, exist_ok=True)
            key_file.write_bytes(secrets.token_bytes(32))
        self._secret = key_file.read_bytes()
        self._fails: dict[str, tuple[int, float]] = {}

    def _env_password(self) -> str:
        return os.environ.get("ADMIN_PASSWORD") or DEFAULT_PASSWORD

    def is_default_password(self) -> bool:
        return not self.store.config.password_hash and self._env_password() == DEFAULT_PASSWORD

    def check_password(self, password: str) -> bool:
        stored = self.store.config.password_hash
        if stored:
            return _verify_hash(password, stored)
        return hmac.compare_digest(password.encode(), self._env_password().encode())

    def set_password(self, password: str) -> None:
        self.store.config.password_hash = hash_password(password)
        self.store.save()

    def locked_for(self, ip: str) -> int:
        fails, until = self._fails.get(ip, (0, 0.0))
        return max(0, int(until - time.time())) if fails >= MAX_FAILS else 0

    def register_attempt(self, ip: str, ok: bool) -> None:
        if ok:
            self._fails.pop(ip, None)
            return
        fails, _ = self._fails.get(ip, (0, 0.0))
        fails += 1
        self._fails[ip] = (fails, time.time() + LOCK_SECONDS)

    # Đổi mật khẩu sẽ làm mọi phiên cũ hết hiệu lực vì khoá ký phụ thuộc vào mật khẩu.
    def _signing_key(self) -> bytes:
        material = self.store.config.password_hash or self._env_password()
        return hmac.new(self._secret, material.encode(), hashlib.sha256).digest()

    def make_token(self) -> str:
        payload = f"{int(time.time()) + SESSION_SECONDS}.{secrets.token_hex(8)}"
        sig = hmac.new(self._signing_key(), payload.encode(), hashlib.sha256).digest()
        return payload + "." + base64.urlsafe_b64encode(sig).decode().rstrip("=")

    def valid_token(self, token: str | None) -> bool:
        if not token:
            return False
        try:
            expires, nonce, sig = token.split(".")
            if int(expires) < time.time():
                return False
        except ValueError:
            return False
        expected = hmac.new(self._signing_key(), f"{expires}.{nonce}".encode(), hashlib.sha256).digest()
        return hmac.compare_digest(base64.urlsafe_b64encode(expected).decode().rstrip("="), sig)
