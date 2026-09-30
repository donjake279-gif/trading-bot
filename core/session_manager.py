"""Trading sessions (pure, architecture layer L2). Spec: ARCHITECTURE §6.5.

Sessions are defined in the LOCAL time of their financial centre (London in Europe/London, …), so the
IANA database handles DST and nothing is hard-coded as a UTC offset. Sessions run Monday–Friday local.
Entries are also blocked for ``avoid_minutes_around_day_roll`` either side of the FX day roll
(17:00 New York), when spreads widen.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from core.config import SessionsCfg
from core.timeutils import parse_hhmm, trading_day_start
from core.types import GateResult

OVERLAP_LONDON_NY = "overlap_london_ny"


@dataclass(frozen=True, slots=True)
class SessionWindow:
    name: str
    zone: ZoneInfo
    start: time
    end: time

    def contains(self, t_utc: datetime) -> bool:
        local = t_utc.astimezone(self.zone)
        if local.weekday() >= 5:
            return False
        now = local.time()
        if self.start < self.end:
            return self.start <= now < self.end
        return now >= self.start or now < self.end  # window crossing local midnight

    def instance(self, t_utc: datetime) -> str:
        """Identifies one occurrence of the session, e.g. 'london@2024-07-16' (local date of its start)."""
        local = t_utc.astimezone(self.zone)
        day = local.date()
        if not self.start < self.end and local.time() < self.end:
            day -= timedelta(days=1)
        return f"{self.name}@{day.isoformat()}"


class SessionManager:
    def __init__(self, cfg: SessionsCfg, day_zone: str = "America/New_York", day_boundary: str = "17:00") -> None:
        self.cfg = cfg
        self.windows = {name: SessionWindow(name, ZoneInfo(d.timezone), parse_hhmm(d.start), parse_hhmm(d.end))
                        for name, d in cfg.definitions.items()}
        self._day = (day_zone, day_boundary)

    def active(self, t_utc: datetime) -> tuple[str, ...]:
        return tuple(name for name, w in self.windows.items() if w.contains(t_utc))

    def label(self, t_utc: datetime) -> str:
        """Session name for reporting: 'overlap_london_ny', 'london', 'asia+london', or 'off'."""
        names = self.active(t_utc)
        if self.cfg.overlap_london_ny and {"london", "new_york"} <= set(names):
            return OVERLAP_LONDON_NY
        return "+".join(names) if names else "off"

    def entry_sessions(self, t_utc: datetime) -> tuple[str, ...]:
        """Instances of the ALLOWED sessions active at t (an entry counts toward each of them)."""
        return tuple(self.windows[n].instance(t_utc) for n in self.active(t_utc) if n in self.cfg.allowed_for_entries)

    def minutes_to_day_roll(self, t_utc: datetime) -> float:
        prev = trading_day_start(t_utc, *self._day)
        nxt = trading_day_start(prev + timedelta(hours=26), *self._day)
        return min((t_utc - prev).total_seconds(), (nxt - t_utc).total_seconds()) / 60.0

    def gate(self, t_utc: datetime) -> GateResult:
        allowed = [n for n in self.active(t_utc) if n in self.cfg.allowed_for_entries]
        to_roll = self.minutes_to_day_roll(t_utc)
        near_roll = to_roll < self.cfg.avoid_minutes_around_day_roll
        passed = bool(allowed) and not near_roll
        if near_roll:
            reason = f"{to_roll:.0f} min from the 17:00 New York day roll (avoid {self.cfg.avoid_minutes_around_day_roll})"
        elif not allowed:
            reason = f"session '{self.label(t_utc)}' not allowed for entries ({', '.join(self.cfg.allowed_for_entries)})"
        else:
            reason = f"in {self.label(t_utc)}"
        return GateResult("session", passed, reason, {"session": self.label(t_utc), "minutes_to_roll": round(to_roll, 1)})
