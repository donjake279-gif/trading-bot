"""Structured logging: JSON lines to logs/bot.jsonl + readable console output.

Usage:  log = logging.getLogger(__name__); log.info("bar closed", extra={"ctx": {...}})
Anything placed in ``extra={"ctx": {...}}`` is emitted as structured fields.
"""

from __future__ import annotations

import json
import logging
import logging.handlers
from datetime import datetime, timezone
from pathlib import Path

_CONFIGURED = False


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, tz=timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": record.getMessage(),
        }
        ctx = getattr(record, "ctx", None)
        if isinstance(ctx, dict):
            payload.update({k: _jsonable(v) for k, v in ctx.items()})
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, ensure_ascii=False)


def _jsonable(value: object) -> object:
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    if isinstance(value, datetime):
        return value.isoformat()
    return str(value)


class ConsoleFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        base = f"{datetime.fromtimestamp(record.created).strftime('%H:%M:%S')} {record.levelname:<7} {record.getMessage()}"
        ctx = getattr(record, "ctx", None)
        if isinstance(ctx, dict) and ctx:
            base += "  " + " ".join(f"{k}={_jsonable(v)}" for k, v in ctx.items())
        if record.exc_info:
            base += "\n" + self.formatException(record.exc_info)
        return base


def configure_logging(log_dir: Path | str = "logs", level: int = logging.INFO, console: bool = True) -> None:
    """Idempotent. Rotates bot.jsonl at 20 MB, keeps 10 files."""
    global _CONFIGURED
    if _CONFIGURED:
        return
    log_path = Path(log_dir)
    log_path.mkdir(parents=True, exist_ok=True)
    root = logging.getLogger()
    root.setLevel(level)
    file_handler = logging.handlers.RotatingFileHandler(
        log_path / "bot.jsonl", maxBytes=20 * 1024 * 1024, backupCount=10, encoding="utf-8"
    )
    file_handler.setFormatter(JsonFormatter())
    root.addHandler(file_handler)
    if console:
        stream = logging.StreamHandler()
        stream.setFormatter(ConsoleFormatter())
        root.addHandler(stream)
    _CONFIGURED = True
