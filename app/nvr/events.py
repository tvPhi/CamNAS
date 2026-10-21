"""Nhật ký sự kiện: mất kết nối, bắt đầu ghi, xoá bản ghi cũ..."""
from __future__ import annotations

import json
import logging
import threading
import time
from collections import deque
from pathlib import Path

from .i18n import msg, render

log = logging.getLogger("camnas")

KEEP = 2000


class EventLog:
    def __init__(self, path: Path):
        self.path = path
        self._lock = threading.Lock()
        self._items: deque[dict] = deque(maxlen=KEEP)
        self._appended = 0
        if path.exists():
            lines = path.read_text(encoding="utf-8", errors="ignore").splitlines()
            for line in lines[-KEEP:]:
                try:
                    self._items.append(json.loads(line))
                except ValueError:
                    pass
            if len(lines) > KEEP * 2:
                self._rewrite()

    def _rewrite(self) -> None:
        self.path.write_text("".join(json.dumps(e, ensure_ascii=False) + "\n" for e in self._items), encoding="utf-8")

    def add(self, level: str, message: str | dict, camera: str | None = None, **params) -> None:
        """message là mẫu tiếng Việt (kèm tham số) hoặc msg(...); lưu cả mẫu để dịch khi xem."""
        m = message if isinstance(message, dict) else msg(message, **params)
        text = render(m, "vi")
        event = {"ts": time.time(), "level": level, "camera": camera, "message": text, "tpl": m["tpl"], "params": m["params"]}
        getattr(log, "warning" if level == "warn" else level, log.info)(f"[{camera or '-'}] {text}")
        with self._lock:
            self._items.append(event)
            self._appended += 1
            try:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                if self._appended >= KEEP:
                    self._appended = 0
                    self._rewrite()
                else:
                    with self.path.open("a", encoding="utf-8") as f:
                        f.write(json.dumps(event, ensure_ascii=False) + "\n")
            except OSError:
                pass

    def list(self, limit: int = 300, camera: str | None = None, level: str | None = None) -> list[dict]:
        with self._lock:
            items = list(self._items)
        if camera:
            items = [e for e in items if e.get("camera") == camera]
        if level:
            items = [e for e in items if e.get("level") == level]
        return [
            {
                "ts": e["ts"],
                "level": e.get("level"),
                "camera": e.get("camera"),
                # sự kiện cũ (chưa có mẫu) giữ nguyên câu tiếng Việt đã lưu
                "message": render({"tpl": e["tpl"], "params": e.get("params")}) if "tpl" in e else e.get("message", ""),
            }
            for e in items[-limit:][::-1]
        ]
