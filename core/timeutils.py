"""Time handling: broker server time <-> UTC, DST, trading-day and trading-week boundaries.

MT5 reports bar/tick/deal times as *broker server wall-clock time* encoded as Unix seconds
(i.e. NOT true UTC). Everything inside this project is timezone-aware UTC, so every MT5
timestamp passes through ``BrokerTimeRule`` exactly once, inside the MT5 adapter.

Supported rules (config ``broker_time.rule``):
* ``ny_close``        server wall time = New York wall time + 7h  (UTC+2 winter / UTC+3 summer,
                      switching on US DST dates — the most common FX broker convention)
* ``iana:<Zone>``     server wall time follows an IANA zone, e.g. ``iana:Europe/Athens``
* ``fixed:<hours>``   constant offset, e.g. ``fixed:+2`` or ``fixed:0``

This module never reads the wall clock; callers pass ``now`` explicitly.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone
from zoneinfo import ZoneInfo

import pandas as pd

from core.errors import ConfigError

UTC = timezone.utc
NEW_YORK = ZoneInfo("America/New_York")
_NY_CLOSE_SHIFT = timedelta(hours=7)
_EPOCH = datetime(1970, 1, 1)
OFFSET_ROUNDING = timedelta(minutes=30)
FX_WEEK_BOUNDARY = time(17, 0)  # Sunday open / Friday close, New York time


def _require_utc(ts: datetime) -> None:
    if ts.tzinfo is None or ts.utcoffset() != timedelta(0):
        raise ValueError(f"expected tz-aware UTC datetime, got {ts!r}")


@dataclass(frozen=True, slots=True)
class BrokerTimeRule:
    """Converts between broker server wall time and true UTC for any date (DST-aware)."""

    kind: str  # "ny_close" | "iana" | "fixed"
    zone: ZoneInfo | None = None
    fixed_offset: timedelta = timedelta(0)

    # ------------------------------------------------------------------ construction
    @classmethod
    def parse(cls, rule: str) -> BrokerTimeRule:
        text = rule.strip()
        if text == "ny_close":
            return cls(kind="ny_close", zone=NEW_YORK)
        if text.startswith("iana:"):
            name = text.removeprefix("iana:")
            try:
                return cls(kind="iana", zone=ZoneInfo(name))
            except Exception as exc:  # ZoneInfoNotFoundError / ValueError
                raise ConfigError(f"Unknown IANA zone in broker_time.rule: {name!r}") from exc
        if text.startswith("fixed:"):
            try:
                hours = float(text.removeprefix("fixed:"))
            except ValueError as exc:
                raise ConfigError(f"Bad fixed offset in broker_time.rule: {text!r}") from exc
            if not -14 <= hours <= 14:
                raise ConfigError(f"Fixed offset out of range: {hours}")
            return cls(kind="fixed", fixed_offset=timedelta(hours=hours))
        raise ConfigError(f"Unsupported broker_time.rule {rule!r} (use ny_close | iana:<Zone> | fixed:<h>)")

    # ------------------------------------------------------------------ scalar conversions
    def offset_at_utc(self, ts_utc: datetime) -> timedelta:
        """Server-minus-UTC offset in force at the given UTC instant."""
        _require_utc(ts_utc)
        if self.kind == "ny_close":
            assert self.zone is not None
            ny_offset = ts_utc.astimezone(self.zone).utcoffset()
            assert ny_offset is not None
            return ny_offset + _NY_CLOSE_SHIFT
        if self.kind == "iana":
            assert self.zone is not None
            offset = ts_utc.astimezone(self.zone).utcoffset()
            assert offset is not None
            return offset
        return self.fixed_offset

    def server_naive_to_utc(self, server_naive: datetime) -> datetime:
        if server_naive.tzinfo is not None:
            raise ValueError("server wall time must be naive")
        if self.kind == "ny_close":
            assert self.zone is not None
            return (server_naive - _NY_CLOSE_SHIFT).replace(tzinfo=self.zone).astimezone(UTC)
        if self.kind == "iana":
            assert self.zone is not None
            return server_naive.replace(tzinfo=self.zone).astimezone(UTC)
        return (server_naive - self.fixed_offset).replace(tzinfo=UTC)

    def utc_to_server_naive(self, ts_utc: datetime) -> datetime:
        return (ts_utc + self.offset_at_utc(ts_utc)).replace(tzinfo=None)

    def from_mt5_seconds(self, seconds: float) -> datetime:
        """MT5 'time' field (server wall time as epoch seconds) -> true UTC."""
        return self.server_naive_to_utc(_EPOCH + timedelta(seconds=float(seconds)))

    def to_mt5_request_datetime(self, ts_utc: datetime) -> datetime:
        """UTC instant -> datetime to pass to copy_rates_range/history_deals_get.

        The MT5 API interprets the given instant's epoch seconds as *server* wall time,
        so we pass the server wall time labelled as UTC.
        """
        return self.utc_to_server_naive(ts_utc).replace(tzinfo=UTC)

    # ------------------------------------------------------------------ vectorised
    def mt5_seconds_to_utc_index(self, seconds: pd.Series) -> pd.Series:
        """Vectorised conversion for bar arrays. Rows that fall in a DST gap/overlap of the
        rule's reference zone become NaT (FX is closed at those times); callers drop them."""
        naive = pd.to_datetime(seconds.astype("int64"), unit="s")
        if self.kind == "fixed":
            return (naive - self.fixed_offset).dt.tz_localize(UTC)
        assert self.zone is not None
        shifted = naive - _NY_CLOSE_SHIFT if self.kind == "ny_close" else naive
        local = shifted.dt.tz_localize(self.zone.key, ambiguous="NaT", nonexistent="NaT")
        return local.dt.tz_convert(UTC)


# ---------------------------------------------------------------------- offset verification


@dataclass(frozen=True, slots=True)
class OffsetCheck:
    status: str  # "ok" | "mismatch" | "unverified"
    observed: timedelta | None
    expected: timedelta
    detail: str


def check_server_offset(
    rule: BrokerTimeRule, latest_tick_server_seconds: int | None, now_utc: datetime
) -> OffsetCheck:
    """Compare the configured rule with the offset implied by the freshest tick.

    observed_raw = tick_server_time - true_now = offset - tick_age.  Rounding to 30 min is
    correct while the tick is younger than 15 minutes, so the check is only conclusive
    while the FX market is open; otherwise it reports "unverified" (never "ok").
    """
    expected = rule.offset_at_utc(now_utc)
    if latest_tick_server_seconds is None:
        return OffsetCheck("unverified", None, expected, "no tick available")
    now_as_epoch = (now_utc - datetime(1970, 1, 1, tzinfo=UTC)).total_seconds()
    raw = timedelta(seconds=float(latest_tick_server_seconds) - now_as_epoch)
    step = OFFSET_ROUNDING.total_seconds()
    observed = timedelta(seconds=round(raw.total_seconds() / step) * step)
    if not fx_market_open(now_utc):
        return OffsetCheck("unverified", observed, expected, "FX market closed; ticks may be old")
    if observed == expected:
        return OffsetCheck("ok", observed, expected, "server offset matches rule")
    return OffsetCheck(
        "mismatch", observed, expected,
        f"observed server offset {observed} != rule offset {expected}. Fix broker_time.rule "
        "or check the PC clock (Windows: Settings > Time > Sync now).",
    )


# ---------------------------------------------------------------------- calendar boundaries


def _combine(local_date: date, at: time, zone: ZoneInfo) -> datetime:
    return datetime.combine(local_date, at).replace(tzinfo=zone)


def parse_hhmm(text: str) -> time:
    try:
        hour, minute = (int(p) for p in text.split(":"))
        return time(hour, minute)
    except (ValueError, TypeError) as exc:
        raise ConfigError(f"Expected HH:MM, got {text!r}") from exc


def trading_day_start(ts_utc: datetime, zone_name: str = "America/New_York", boundary: str = "17:00") -> datetime:
    """Most recent trading-day boundary <= ts (UTC). Default: FX day roll at 17:00 New York."""
    _require_utc(ts_utc)
    zone = ZoneInfo(zone_name)
    local = ts_utc.astimezone(zone)
    candidate = _combine(local.date(), parse_hhmm(boundary), zone)
    if candidate > local:
        candidate = _combine(local.date() - timedelta(days=1), parse_hhmm(boundary), zone)
    return candidate.astimezone(UTC)


def trading_week_start(ts_utc: datetime) -> datetime:
    """Most recent Sunday 17:00 New York <= ts (UTC)."""
    _require_utc(ts_utc)
    local = ts_utc.astimezone(NEW_YORK)
    days_since_sunday = (local.weekday() - 6) % 7
    candidate = _combine(local.date() - timedelta(days=days_since_sunday), FX_WEEK_BOUNDARY, NEW_YORK)
    if candidate > local:
        candidate = _combine(candidate.date() - timedelta(days=7), FX_WEEK_BOUNDARY, NEW_YORK)
    return candidate.astimezone(UTC)


def fx_market_open(ts_utc: datetime) -> bool:
    """Regular FX week: Sunday 17:00 to Friday 17:00 New York. Holidays are not modelled
    here — tick staleness catches those."""
    _require_utc(ts_utc)
    local = ts_utc.astimezone(NEW_YORK)
    wd, t = local.weekday(), local.time()
    if wd == 5:  # Saturday
        return False
    if wd == 4 and t >= FX_WEEK_BOUNDARY:  # Friday after close
        return False
    if wd == 6 and t < FX_WEEK_BOUNDARY:  # Sunday before open
        return False
    return True
