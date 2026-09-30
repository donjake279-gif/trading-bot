"""Market-condition gates (pure, architecture layer L2). Spec: ARCHITECTURE §6.5, STRATEGY L9/L11.

The cost-vs-RR gate lives in the strategy (rule L9) because it needs the stop distance.
"""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Protocol

from core.types import FeedStatus, GateResult


def spread_gate(spread_points: float, typical_points: float | None, max_spread_points: float,
                max_multiple_of_typical: float) -> GateResult:
    """Reject if spread > min(absolute cap, multiple × typical). Without a typical spread yet, only the cap applies."""
    limit = float(max_spread_points)
    note = "absolute cap"
    if typical_points is not None and typical_points > 0 and max_multiple_of_typical * typical_points < limit:
        limit = max_multiple_of_typical * typical_points
        note = f"{max_multiple_of_typical:g} × typical {typical_points:g}"
    passed = spread_points <= limit
    measured: dict[str, float | str | bool] = {"spread_points": spread_points, "limit_points": limit}
    if typical_points is not None:
        measured["typical_points"] = typical_points
    return GateResult("spread", passed, f"spread {spread_points:g} pts vs limit {limit:g} ({note})", measured)


def volatility_gate(atr_percentile: float | None, min_pct: float, max_pct: float) -> GateResult:
    """ATR percentile (structure timeframe, STRATEGY §2.11) must lie within [min, max]."""
    if atr_percentile is None:
        return GateResult("volatility", False, "ATR percentile unavailable (warm-up)")
    passed = min_pct <= atr_percentile <= max_pct
    return GateResult("volatility", passed, f"ATR percentile {atr_percentile:.1f} (allowed {min_pct:g}–{max_pct:g})",
                      {"atr_percentile": atr_percentile})


# ----------------------------------------------------------------------------- news


class NewsEvent(Protocol):
    @property
    def time_utc(self) -> datetime: ...
    @property
    def currency(self) -> str: ...
    @property
    def importance(self) -> str: ...
    @property
    def title(self) -> str: ...


def news_gate(*, enabled: bool, status: FeedStatus, events: list[NewsEvent], currencies: tuple[str, str],
              t_utc: datetime, importance: list[str], before_minutes: int, after_minutes: int,
              on_unavailable: str) -> GateResult:
    """Block entries from ``before`` minutes ahead of to ``after`` minutes after a listed event in either
    currency of the pair. Only scheduled times are used, never actual values (no leakage)."""
    if not enabled:
        return GateResult("news", True, "news filter disabled in config", {"status": FeedStatus.DISABLED.value})
    if status is not FeedStatus.OK:
        blocked = on_unavailable == "block_entries"
        return GateResult("news", not blocked, f"calendar feed {status.value}: "
                          + ("entries blocked (fail closed)" if blocked else "IGNORED by config — risk accepted"),
                          {"status": status.value})
    for ev in events:
        if ev.currency not in currencies or ev.importance not in importance:
            continue
        if ev.time_utc - timedelta(minutes=before_minutes) <= t_utc <= ev.time_utc + timedelta(minutes=after_minutes):
            return GateResult("news", False, f"{ev.currency} {ev.importance} '{ev.title}' at {ev.time_utc.isoformat()}",
                              {"status": status.value, "event_time": ev.time_utc.isoformat()})
    return GateResult("news", True, "no listed event in the blackout window", {"status": status.value})
