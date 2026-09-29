"""Market-data service (architecture layer L3).

* builds MarketSnapshots containing CLOSED bars only (double-checked here and in the type)
* validates bar integrity (duplicates, ordering, OHLC consistency, alignment)
* judges data freshness (stale ticks / stale bars / market closed)
* tracks typical spread per symbol (rolling median)
* detects "a new closed bar appeared" events that drive the trading loop
"""

from __future__ import annotations

import logging
from collections import deque
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime, timedelta
from statistics import median

import pandas as pd

from core.config import Settings
from core.errors import DataIntegrityError
from core.ports import BrokerGateway, BrokerUnavailable, Clock
from core.timeutils import fx_market_open
from core.types import MarketSnapshot, Quote, Timeframe

log = logging.getLogger(__name__)


# ----------------------------------------------------------------------------- integrity


def validate_bars(df: pd.DataFrame, tf: Timeframe) -> list[str]:
    """Return a list of integrity problems (empty list = clean)."""
    issues: list[str] = []
    if df.empty:
        return issues
    t = df["time_open_utc"]
    if t.duplicated().any():
        issues.append(f"{int(t.duplicated().sum())} duplicate timestamps")
    if not t.is_monotonic_increasing:
        issues.append("timestamps not increasing")
    body_hi = df[["open", "close"]].max(axis=1)
    body_lo = df[["open", "close"]].min(axis=1)
    bad = (df["high"] < body_hi) | (df["low"] > body_lo) | (df["low"] > df["high"])
    if bad.any():
        issues.append(f"{int(bad.sum())} bars with inconsistent OHLC")
    if (df[["open", "high", "low", "close"]] <= 0).any().any():
        issues.append("non-positive prices")
    if tf.minutes <= 60:  # server offsets are whole hours, so <=H1 bars align in UTC too
        minutes = t.dt.hour * 60 + t.dt.minute
        misaligned = (minutes % tf.minutes != 0) | (t.dt.second != 0)
        if misaligned.any():
            issues.append(f"{int(misaligned.sum())} bars not aligned to {tf.name} boundaries")
    return issues


def closed_only(df: pd.DataFrame, tf: Timeframe, decision_time: datetime) -> pd.DataFrame:
    """Keep only bars whose close time is <= decision_time."""
    if df.empty:
        return df
    return df.loc[df["time_open_utc"] + tf.delta <= decision_time].reset_index(drop=True)


# ----------------------------------------------------------------------------- spread


class SpreadTracker:
    """Rolling median of observed spreads (points) per symbol over a time window."""

    def __init__(self, window: timedelta) -> None:
        self._window = window
        self._samples: dict[str, deque[tuple[datetime, float]]] = {}

    def add(self, symbol: str, at_utc: datetime, spread_points: float) -> None:
        q = self._samples.setdefault(symbol, deque())
        q.append((at_utc, float(spread_points)))
        cutoff = at_utc - self._window
        while q and q[0][0] < cutoff:
            q.popleft()

    def typical(self, symbol: str, min_samples: int = 30) -> float | None:
        """Median spread, or None while there are too few samples to be meaningful."""
        q = self._samples.get(symbol)
        if not q or len(q) < min_samples:
            return None
        return float(median(v for _, v in q))

    def count(self, symbol: str) -> int:
        return len(self._samples.get(symbol, ()))


# ----------------------------------------------------------------------------- new bars


class NewBarDetector:
    """Emits True exactly once per newly closed bar per (symbol, timeframe)."""

    def __init__(self) -> None:
        self._last: dict[tuple[str, Timeframe], datetime] = {}

    def update(self, symbol: str, tf: Timeframe, last_closed_open_utc: datetime) -> bool:
        key = (symbol, tf)
        prev = self._last.get(key)
        if prev is not None and last_closed_open_utc <= prev:
            return False
        self._last[key] = last_closed_open_utc
        return prev is not None  # first observation initialises; it is not a "new" bar event


# ----------------------------------------------------------------------------- freshness


@dataclass(frozen=True, slots=True)
class DataStatus:
    symbol: str
    fresh: bool
    market_open: bool
    reason: str
    tick_age_seconds: float | None
    last_bar_close_utc: datetime | None


# ----------------------------------------------------------------------------- service


class MarketDataService:
    def __init__(self, broker: BrokerGateway, clock: Clock, settings: Settings) -> None:
        self._broker = broker
        self._clock = clock
        self._settings = settings
        self.spreads = SpreadTracker(timedelta(minutes=settings.spread.window_minutes))
        self.new_bars = NewBarDetector()
        self._points: dict[str, float] = {}

    def _bars(self, symbol: str, tf: Timeframe, count: int, decision_time: datetime) -> pd.DataFrame:
        df = self._broker.closed_bars(symbol, tf, count)
        issues = validate_bars(df, tf)
        if issues:
            raise DataIntegrityError(f"{symbol} {tf.name}: " + "; ".join(issues))
        return closed_only(df, tf, decision_time)

    def snapshot(self, symbol: str, timeframes: Iterable[Timeframe] | None = None) -> MarketSnapshot:
        """Closed bars for every requested timeframe, as of now. Raises on bad data."""
        decision_time = self._clock.now_utc()
        tfs = list(timeframes) if timeframes is not None else list(self._settings.timeframes.roles().values())
        counts: dict[str, int] = {str(k): v for k, v in self._settings.timeframes.bars_to_load.items()}
        frames = {tf: self._bars(symbol, tf, counts.get(tf.name, 500), decision_time) for tf in dict.fromkeys(tfs)}
        quote = self.sample_quote(symbol)
        return MarketSnapshot(symbol=symbol, decision_time_utc=decision_time, frames=frames, quote=quote)

    def sample_quote(self, symbol: str) -> Quote:
        quote = self._broker.quote(symbol)
        spec_point = self._point(symbol)
        self.spreads.add(symbol, self._clock.now_utc(), round(quote.spread / spec_point))
        return quote

    def _point(self, symbol: str) -> float:
        if symbol not in self._points:
            self._points[symbol] = self._broker.symbol_spec(symbol).point
        return self._points[symbol]

    def data_status(self, symbol: str, tf: Timeframe) -> DataStatus:
        """Fresh = market open, recent tick, and last closed bar not older than tf + grace."""
        now = self._clock.now_utc()
        if not fx_market_open(now):
            return DataStatus(symbol, False, False, "market closed (weekend)", None, None)
        try:
            quote = self._broker.quote(symbol)
            bars = self._broker.closed_bars(symbol, tf, 2)
        except BrokerUnavailable as exc:
            return DataStatus(symbol, False, True, f"broker unavailable: {exc}", None, None)
        tick_age = (now - quote.time_utc).total_seconds()
        last_close = bars["time_open_utc"].iloc[-1] + tf.delta if not bars.empty else None
        if tick_age > self._settings.data.max_tick_age_seconds:
            return DataStatus(symbol, False, True, f"stale tick ({tick_age:.0f}s old)", tick_age, last_close)
        if last_close is None:
            return DataStatus(symbol, False, True, "no closed bars", tick_age, None)
        max_age = tf.delta + timedelta(seconds=self._settings.data.bar_grace_seconds)
        if now - last_close > max_age:
            return DataStatus(symbol, False, True, f"stale {tf.name} bar (closed {last_close.isoformat()})",
                              tick_age, last_close)
        return DataStatus(symbol, True, True, "ok", tick_age, last_close)
