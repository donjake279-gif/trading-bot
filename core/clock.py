"""Clocks. The only place in core/ allowed to read the wall clock is LiveClock."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from core.types import ContractViolation


class LiveClock:
    """Real time, timezone-aware UTC."""

    def now_utc(self) -> datetime:
        return datetime.now(timezone.utc)


class SimClock:
    """Deterministic clock for backtests and tests. Time may only move forward."""

    def __init__(self, start_utc: datetime) -> None:
        self._check(start_utc)
        self._now = start_utc

    @staticmethod
    def _check(ts: datetime) -> None:
        if ts.tzinfo is None or ts.utcoffset() != timedelta(0):
            raise ContractViolation(f"SimClock requires tz-aware UTC, got {ts!r}")

    def now_utc(self) -> datetime:
        return self._now

    def set(self, ts: datetime) -> None:
        self._check(ts)
        if ts < self._now:
            raise ContractViolation(f"SimClock cannot move backwards: {self._now} -> {ts}")
        self._now = ts

    def advance(self, delta: timedelta) -> None:
        self.set(self._now + delta)
