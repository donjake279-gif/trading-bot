"""Indicators and candle measures (pure, architecture layer L2). Definitions: docs/STRATEGY.md §2.

Everything here is STREAMING: objects are fed one closed bar at a time and can only ever
see the past. Batch helpers are thin loops over the same streaming objects, so live and
backtest compute identical numbers.
"""

from __future__ import annotations

import bisect
import math
from collections import deque
from dataclasses import dataclass
from statistics import median

import numpy as np


def lin(x: float, lo: float, hi: float) -> float:
    """Linear ramp 0..1: 0 at/below lo, 1 at/above hi (STRATEGY §1)."""
    if hi <= lo:
        raise ValueError("lin() requires hi > lo")
    return min(1.0, max(0.0, (x - lo) / (hi - lo)))


# ----------------------------------------------------------------------------- ATR


def true_range(high: float, low: float, prev_close: float | None) -> float:
    if prev_close is None:
        return high - low
    return max(high - low, abs(high - prev_close), abs(low - prev_close))


class WilderATR:
    """Wilder ATR(n): seed = mean of the first n true ranges, then ATR += (TR - ATR) / n."""

    def __init__(self, period: int = 14) -> None:
        if period < 2:
            raise ValueError("ATR period must be >= 2")
        self.period = period
        self._prev_close: float | None = None
        self._seed: list[float] = []
        self.value: float | None = None

    def update(self, high: float, low: float, close: float) -> float | None:
        tr = true_range(high, low, self._prev_close)
        self._prev_close = close
        if self.value is None:
            self._seed.append(tr)
            if len(self._seed) == self.period:
                self.value = sum(self._seed) / self.period
                self._seed.clear()
        else:
            self.value += (tr - self.value) / self.period
        return self.value


def atr_series(high: np.ndarray, low: np.ndarray, close: np.ndarray, period: int = 14) -> np.ndarray:
    """ATR at every bar (NaN during warm-up). Same arithmetic as WilderATR."""
    atr = WilderATR(period)
    out = np.full(len(close), np.nan)
    for i in range(len(close)):
        v = atr.update(float(high[i]), float(low[i]), float(close[i]))
        if v is not None:
            out[i] = v
    return out


# ----------------------------------------------------------------------------- rolling percentile


class RollingPercentile:
    """Percentage of the last `lookback` values (including the newest) that are <= the newest."""

    def __init__(self, lookback: int) -> None:
        if lookback < 2:
            raise ValueError("lookback must be >= 2")
        self.lookback = lookback
        self._window: deque[float] = deque()
        self._sorted: list[float] = []

    def update(self, value: float) -> float | None:
        """Returns the percentile rank once the window is full, else None."""
        self._window.append(value)
        bisect.insort(self._sorted, value)
        if len(self._window) > self.lookback:
            old = self._window.popleft()
            del self._sorted[bisect.bisect_left(self._sorted, old)]
        if len(self._window) < self.lookback:
            return None
        return 100.0 * bisect.bisect_right(self._sorted, value) / len(self._sorted)


# ----------------------------------------------------------------------------- candles


@dataclass(frozen=True, slots=True)
class Candle:
    open: float
    high: float
    low: float
    close: float

    @property
    def range(self) -> float:
        return self.high - self.low

    @property
    def body(self) -> float:
        return abs(self.close - self.open)

    @property
    def clv(self) -> float:
        """Close location value (C-L)/(H-L); 0.5 for a zero-range bar."""
        return 0.5 if self.range <= 0 else (self.close - self.low) / self.range


def is_displacement(c: Candle, direction: int, atr_prev: float, body_atr: float = 1.0, body_ratio: float = 0.6) -> bool:
    """STRATEGY §2.9: directional body >= body_atr * ATR(prev bar) and body/range >= body_ratio."""
    if atr_prev <= 0 or c.range <= 0:
        return False
    directional = c.close > c.open if direction > 0 else c.close < c.open
    return directional and c.body >= body_atr * atr_prev and c.body / c.range >= body_ratio


def is_rejection(c: Candle, direction: int) -> bool:
    """Bullish: lower wick >= 50% of range and CLV >= 0.66. Bearish: mirrored."""
    if c.range <= 0:
        return False
    if direction > 0:
        return (min(c.open, c.close) - c.low) >= 0.5 * c.range and c.clv >= 0.66
    return (c.high - max(c.open, c.close)) >= 0.5 * c.range and c.clv <= 0.34


# ----------------------------------------------------------------------------- momentum / volume


class Momentum:
    """MOM = (C_t - C_{t-n}) / ATR_t (STRATEGY §2.11)."""

    def __init__(self, bars: int) -> None:
        self._closes: deque[float] = deque(maxlen=bars + 1)

    def update(self, close: float, atr: float | None) -> float | None:
        self._closes.append(close)
        if len(self._closes) < (self._closes.maxlen or 0) or not atr:
            return None
        return (self._closes[-1] - self._closes[0]) / atr


class RelativeTickVolume:
    """RTV = V_t / median(V_{t-20..t-1}); None until 20 prior bars exist or median is 0."""

    def __init__(self, lookback: int = 20) -> None:
        self._prev: deque[float] = deque(maxlen=lookback)

    def update(self, volume: float) -> float | None:
        result: float | None = None
        if len(self._prev) == self._prev.maxlen:
            med = median(self._prev)
            result = volume / med if med > 0 else None
        self._prev.append(volume)
        return result


def is_finite(x: float | None) -> bool:
    return x is not None and math.isfinite(x)
