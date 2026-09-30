"""Market-structure engine (pure, architecture layer L2). Definitions: docs/STRATEGY.md §2.2–2.12.

Design: every tracker is STREAMING. It receives one CLOSED bar at a time and updates its state,
so it is impossible for it to use a future bar. Live trading and backtests feed the same
trackers through ``AnalysisEngine.advance_to(decision_time, frames)``, which only pushes
bars whose close time is <= decision_time.

Main objects
* FractalDetector      – k-left/k-right fractals, emitted only when confirmed (bar p+k)
* SignificantSwings    – alternating high/low sequence with the lambda*ATR noise filter + labels
* StructureTracker     – one timeframe: ATR, swings, BOS/CHoCH state machine, impulse leg,
                         liquidity sweeps, regime, compression, momentum, tick volume
* DailyLevels          – previous-day / previous-week high & low on the 17:00 New York roll
* AnalysisEngine       – one symbol, several timeframes, fed in close-time order
"""

from __future__ import annotations

import hashlib
from collections import deque
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta, timezone
from enum import Enum

import numpy as np
import pandas as pd

from core.config import StrategyCfg, VolatilityFilterCfg
from core.indicators import Candle, Momentum, RelativeTickVolume, RollingPercentile, WilderATR
from core.timeutils import trading_day_start, trading_week_start
from core.types import Timeframe


_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


def _epoch_ns(ts: datetime) -> int:
    """Exact nanoseconds since the epoch for a tz-aware datetime (no float rounding)."""
    delta = ts - _EPOCH
    return ((delta.days * 86_400 + delta.seconds) * 1_000_000 + delta.microseconds) * 1_000


class SwingKind(str, Enum):
    HIGH = "high"
    LOW = "low"


class StructState(str, Enum):
    BULL = "bull"
    BEAR = "bear"
    NONE = "none"


class Regime(str, Enum):
    TREND_UP = "trend_up"
    TREND_DOWN = "trend_down"
    RANGE = "range"


@dataclass(frozen=True, slots=True)
class Bar:
    index: int
    time_open: datetime
    time_close: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float = 0.0

    @property
    def candle(self) -> Candle:
        return Candle(self.open, self.high, self.low, self.close)


@dataclass(frozen=True, slots=True)
class Swing:
    kind: SwingKind
    price: float
    pivot_index: int
    pivot_time: datetime
    confirm_index: int  # bar at which the swing became KNOWN (pivot_index + k)
    confirm_time: datetime  # close time of the confirming bar
    atr: float
    label: str  # HH/LH/EH, HL/LL/EL, or FIRST

    @property
    def key(self) -> tuple[str, int]:
        return (self.kind.value, self.pivot_index)


@dataclass(frozen=True, slots=True)
class BreakEvent:
    timeframe: Timeframe
    direction: int  # +1 bullish, -1 bearish
    kind: str  # "BOS" | "CHoCH"
    bar_index: int
    time_close: datetime
    close: float
    level: Swing
    prev_state: StructState


@dataclass(frozen=True, slots=True)
class SweepEvent:
    timeframe: Timeframe
    direction: int  # +1 = swept a LOW and closed back above (bullish); -1 = swept a HIGH
    level: Swing
    bar_index: int
    time_close: datetime
    extreme: float  # the wick low (bullish) / high (bearish)
    depth_atr: float


@dataclass(frozen=True, slots=True)
class Leg:
    """Impulse leg created by a structural break (STRATEGY §2.6)."""

    timeframe: Timeframe
    direction: int
    origin: Swing  # A
    break_index: int
    break_time: datetime
    extreme: float  # B = running max high (bull) / min low (bear) since the break bar
    extreme_index: int
    extreme_time: datetime  # close time of the bar that made B
    leg_id: str

    def size_atr(self, atr: float) -> float:
        return abs(self.extreme - self.origin.price) / atr if atr > 0 else 0.0


def make_leg_id(symbol: str, tf: Timeframe, direction: int, origin: Swing, break_time: datetime) -> str:
    raw = f"{symbol}|{tf.name}|{direction}|{origin.pivot_time.isoformat()}|{break_time.isoformat()}"
    return hashlib.sha1(raw.encode()).hexdigest()[:16]


# ----------------------------------------------------------------------------- fractals


class FractalDetector:
    """Bar p is a fractal high if H_p > H_j for j in [p-k, p-1] and H_p >= H_j for j in [p+1, p+k].
    It is reported when bar p+k closes (never earlier)."""

    def __init__(self, k: int) -> None:
        if k < 1:
            raise ValueError("k must be >= 1")
        self.k = k
        self._bars: deque[tuple[Bar, float | None]] = deque(maxlen=2 * k + 1)

    def update(self, bar: Bar, atr: float | None) -> list[tuple[SwingKind, Bar, float | None]]:
        self._bars.append((bar, atr))
        if len(self._bars) < 2 * self.k + 1:
            return []
        k = self.k
        pivot, pivot_atr = self._bars[k]
        left = [b for b, _ in list(self._bars)[:k]]
        right = [b for b, _ in list(self._bars)[k + 1:]]
        found: list[tuple[SwingKind, Bar, float | None]] = []
        if all(pivot.high > b.high for b in left) and all(pivot.high >= b.high for b in right):
            found.append((SwingKind.HIGH, pivot, pivot_atr))
        if all(pivot.low < b.low for b in left) and all(pivot.low <= b.low for b in right):
            found.append((SwingKind.LOW, pivot, pivot_atr))
        return found


# ----------------------------------------------------------------------------- significant swings


class SignificantSwings:
    """Alternating swing sequence (STRATEGY §2.3) with HH/LH/EH/HL/LL/EL labels (§2.4)."""

    def __init__(self, min_atr: float, equal_atr: float, keep: int = 200) -> None:
        self.min_atr = min_atr
        self.equal_atr = equal_atr
        self.swings: deque[Swing] = deque(maxlen=keep)

    def _label(self, kind: SwingKind, price: float, atr: float) -> str:
        prev = next((s for s in reversed(self.swings) if s.kind is kind), None)
        if prev is None:
            return "FIRST"
        eps = self.equal_atr * atr
        if kind is SwingKind.HIGH:
            return "HH" if price > prev.price + eps else ("LH" if price < prev.price - eps else "EH")
        return "HL" if price > prev.price + eps else ("LL" if price < prev.price - eps else "EL")

    def process(self, kind: SwingKind, pivot: Bar, atr: float | None, confirm: Bar) -> tuple[Swing | None, Swing | None]:
        """Returns (accepted_swing, replaced_swing). Fractals during ATR warm-up are ignored."""
        if atr is None or atr <= 0:
            return None, None
        price = pivot.high if kind is SwingKind.HIGH else pivot.low
        last = self.swings[-1] if self.swings else None
        replaced: Swing | None = None
        if last is not None and last.kind is kind:
            more_extreme = price > last.price if kind is SwingKind.HIGH else price < last.price
            if not more_extreme:
                return None, None
            replaced = self.swings.pop()
        elif last is not None and abs(price - last.price) < self.min_atr * atr:
            return None, None
        swing = Swing(kind, price, pivot.index, pivot.time_open, confirm.index, confirm.time_close, atr,
                      self._label(kind, price, atr))
        self.swings.append(swing)
        return swing, replaced

    def last_of(self, kind: SwingKind, before_index: int | None = None) -> Swing | None:
        for s in reversed(self.swings):
            if s.kind is kind and (before_index is None or s.pivot_index < before_index):
                return s
        return None


# ----------------------------------------------------------------------------- tracker


@dataclass(frozen=True, slots=True)
class StructureParams:
    k: int = 3
    atr_period: int = 14
    swing_min_atr: float = 1.0
    equal_level_atr: float = 0.1
    sweep_max_depth_atr: float = 1.0
    regime_trend_max_bars: int = 48
    compression_bars: int = 20
    compression_atr: float = 3.0
    momentum_bars: int = 12
    atr_percentile_lookback: int = 500
    max_levels: int = 30
    max_level_age_bars: int = 500  # older resting levels are forgotten: keeps live (finite warm-up) == backtest
    warmup_bars: int = 1100  # measured: live and backtest states agree exactly after this many bars
    keep_events: int = 100


@dataclass(frozen=True, slots=True)
class StructureState:
    """Immutable snapshot of one timeframe's structure after its last closed bar."""

    timeframe: Timeframe
    bar_index: int
    time_close: datetime | None
    state: StructState
    last_break: BreakEvent | None
    leg: Leg | None
    atr: float | None
    atr_prev: float | None
    atr_percentile: float | None
    regime: Regime
    compression: bool
    momentum: float | None
    rel_tick_volume: float | None
    last_bar: Bar | None
    swings: tuple[Swing, ...]
    unbroken_highs: tuple[Swing, ...]
    unbroken_lows: tuple[Swing, ...]
    recent_breaks: tuple[BreakEvent, ...]
    recent_sweeps: tuple[SweepEvent, ...]
    warm: bool

    @property
    def ready(self) -> bool:
        """True once enough bars were processed that the state no longer depends on where feeding
        started. The strategy must not act on a timeframe that is not ready."""
        return self.warm and self.atr is not None and len(self.swings) >= 2

    def bars_since_break(self) -> int | None:
        return None if self.last_break is None else self.bar_index - self.last_break.bar_index


class StructureTracker:
    """Streaming structure analysis for one symbol and one timeframe."""

    def __init__(self, symbol: str, timeframe: Timeframe, params: StructureParams) -> None:
        self.symbol = symbol
        self.tf = timeframe
        self.p = params
        self._atr = WilderATR(params.atr_period)
        self._atr_pct = RollingPercentile(params.atr_percentile_lookback)
        self._fractals = FractalDetector(params.k)
        self.swings = SignificantSwings(params.swing_min_atr, params.equal_level_atr)
        self._mom = Momentum(params.momentum_bars)
        self._rtv = RelativeTickVolume()
        self._hl: deque[tuple[float, float]] = deque(maxlen=params.compression_bars)
        self._highs: list[Swing] = []  # unbroken, oldest first
        self._lows: list[Swing] = []
        self._swept: set[tuple[str, int]] = set()
        self._breaks: deque[BreakEvent] = deque(maxlen=params.keep_events)
        self._sweeps: deque[SweepEvent] = deque(maxlen=params.keep_events)
        self.state = StructState.NONE
        self.last_break: BreakEvent | None = None
        self.leg: Leg | None = None
        self._atr_prev: float | None = None
        self._atr_percentile: float | None = None
        self._momentum: float | None = None
        self._rel_vol: float | None = None
        self.last_bar: Bar | None = None
        self.index = -1
        self._count = 0

    # ------------------------------------------------------------------ update
    def update(self, bar: Bar) -> list[BreakEvent | SweepEvent]:
        if self.last_bar is not None and bar.time_open <= self.last_bar.time_open:
            raise ValueError(f"{self.symbol} {self.tf.name}: bars must be fed in increasing time order")
        self.index = bar.index
        self._count += 1
        self._atr_prev = self._atr.value
        atr = self._atr.update(bar.high, bar.low, bar.close)
        events: list[BreakEvent | SweepEvent] = []

        # 1) newly CONFIRMED fractals -> significant swings -> resting levels
        for kind, pivot, pivot_atr in self._order_outside_pivot(self._fractals.update(bar, atr)):
            accepted, replaced = self.swings.process(kind, pivot, pivot_atr, bar)
            if accepted is None:
                continue
            levels = self._highs if kind is SwingKind.HIGH else self._lows
            if replaced is not None and replaced in levels:
                levels.remove(replaced)
            levels.append(accepted)
            del levels[: max(0, len(levels) - self.p.max_levels)]

        # forget resting levels older than max_level_age_bars
        cutoff = bar.index - self.p.max_level_age_bars
        if self._highs and self._highs[0].pivot_index < cutoff:
            self._highs[:] = [x for x in self._highs if x.pivot_index >= cutoff]
        if self._lows and self._lows[0].pivot_index < cutoff:
            self._lows[:] = [x for x in self._lows if x.pivot_index >= cutoff]

        # 2) breaks of structure (close beyond the most recent unbroken swing)
        events.extend(self._check_breaks(bar))

        # 3) the active leg's extreme (B) extends (a leg created on this bar already starts at it)
        if self.leg is not None and not events:
            self._extend_leg(bar)

        # 4) liquidity sweeps of resting levels, depth measured in ATR of the PREVIOUS bar so a huge
        #    sweep bar cannot inflate its own allowance (STRATEGY §2.8)
        if self._atr_prev:
            events.extend(self._check_sweeps(bar, self._atr_prev))

        # 5) descriptors
        if atr is not None:
            self._atr_percentile = self._atr_pct.update(atr)
        self._momentum = self._mom.update(bar.close, atr)
        self._rel_vol = self._rtv.update(bar.volume)
        self._hl.append((bar.high, bar.low))
        self.last_bar = bar
        return events

    def _order_outside_pivot(
        self, found: list[tuple[SwingKind, Bar, float | None]]
    ) -> list[tuple[SwingKind, Bar, float | None]]:
        """A pivot that is both a fractal high and a fractal low (an outside bar) is processed in the order
        its extremes were most likely printed, so LONG and SHORT stay exact mirrors (STRATEGY §2.2):
        up bar -> low first; down bar -> high first; doji -> the extreme nearer the open first; still tied ->
        the kind opposite to the last significant swing first (with no swing yet the pivot is ambiguous and
        dropped; that can only happen at the very start of the data, inside warm-up)."""
        if len(found) < 2:
            return found
        pivot = found[0][1]
        low_first_votes = (pivot.close - pivot.open, (pivot.high - pivot.open) - (pivot.open - pivot.low))
        low_first = next((v > 0 for v in low_first_votes if v != 0), None)
        if low_first is None:
            if not self.swings.swings:
                return []
            low_first = self.swings.swings[-1].kind is SwingKind.HIGH
        first = SwingKind.LOW if low_first else SwingKind.HIGH
        return sorted(found, key=lambda f: f[0] is not first)

    def _check_breaks(self, bar: Bar) -> list[BreakEvent]:
        out: list[BreakEvent] = []
        for direction, levels in ((1, self._highs), (-1, self._lows)):
            if not levels:
                continue
            ref = levels[-1]  # most recent unbroken level (SH* / SL*)
            crossed = bar.close > ref.price if direction > 0 else bar.close < ref.price
            # Every level closed through is no longer resting liquidity, event or not.
            survivors = [s for s in levels if not (bar.close > s.price if direction > 0 else bar.close < s.price)]
            levels[:] = survivors
            if not crossed:
                continue
            want = StructState.BULL if direction > 0 else StructState.BEAR
            kind = "BOS" if self.state is want else "CHoCH"
            event = BreakEvent(self.tf, direction, kind, bar.index, bar.time_close, bar.close, ref, self.state)
            self.state = want
            self.last_break = event
            self._breaks.append(event)
            out.append(event)
            origin = self.swings.last_of(SwingKind.LOW if direction > 0 else SwingKind.HIGH, before_index=bar.index)
            if origin is None:
                self.leg = None
            else:
                extreme = bar.high if direction > 0 else bar.low
                self.leg = Leg(self.tf, direction, origin, bar.index, bar.time_close, extreme, bar.index,
                               bar.time_close, make_leg_id(self.symbol, self.tf, direction, origin, bar.time_close))
        return out

    def _extend_leg(self, bar: Bar) -> None:
        assert self.leg is not None
        if self.leg.direction > 0 and bar.high > self.leg.extreme:
            self.leg = replace(self.leg, extreme=bar.high, extreme_index=bar.index, extreme_time=bar.time_close)
        elif self.leg.direction < 0 and bar.low < self.leg.extreme:
            self.leg = replace(self.leg, extreme=bar.low, extreme_index=bar.index, extreme_time=bar.time_close)

    def _check_sweeps(self, bar: Bar, atr: float) -> list[SweepEvent]:
        out: list[SweepEvent] = []
        max_depth = self.p.sweep_max_depth_atr * atr
        for s in self._lows:  # cheap price test first; the swept-set lookup only for real candidates
            depth = s.price - bar.low
            if bar.low < s.price and bar.close > s.price and depth <= max_depth and s.key not in self._swept:
                self._swept.add(s.key)
                ev = SweepEvent(self.tf, 1, s, bar.index, bar.time_close, bar.low, depth / atr)
                self._sweeps.append(ev)
                out.append(ev)
        for s in self._highs:
            depth = bar.high - s.price
            if bar.high > s.price and bar.close < s.price and depth <= max_depth and s.key not in self._swept:
                self._swept.add(s.key)
                ev = SweepEvent(self.tf, -1, s, bar.index, bar.time_close, bar.high, depth / atr)
                self._sweeps.append(ev)
                out.append(ev)
        return out

    # ------------------------------------------------------------------ snapshot
    def _regime(self) -> Regime:
        if self.last_break is None or self.index - self.last_break.bar_index > self.p.regime_trend_max_bars:
            return Regime.RANGE
        if self.state is StructState.BULL:
            return Regime.TREND_UP
        if self.state is StructState.BEAR:
            return Regime.TREND_DOWN
        return Regime.RANGE

    def _compression(self) -> bool:
        atr = self._atr.value
        if atr is None or len(self._hl) < self.p.compression_bars:
            return False
        hi = max(h for h, _ in self._hl)
        lo = min(low for _, low in self._hl)
        return (hi - lo) < self.p.compression_atr * atr

    def snapshot(self) -> StructureState:
        return StructureState(
            timeframe=self.tf, bar_index=self.index,
            time_close=self.last_bar.time_close if self.last_bar else None,
            state=self.state, last_break=self.last_break, leg=self.leg,
            atr=self._atr.value, atr_prev=self._atr_prev, atr_percentile=self._atr_percentile,
            regime=self._regime(), compression=self._compression(), momentum=self._momentum,
            rel_tick_volume=self._rel_vol, last_bar=self.last_bar,
            swings=tuple(self.swings.swings)[-12:], unbroken_highs=tuple(self._highs),
            unbroken_lows=tuple(self._lows), recent_breaks=tuple(self._breaks), recent_sweeps=tuple(self._sweeps),
            warm=self._count >= self.p.warmup_bars,
        )


# ----------------------------------------------------------------------------- daily levels


@dataclass(frozen=True, slots=True)
class DailyLevelsState:
    pdh: float | None
    pdl: float | None
    pwh: float | None
    pwl: float | None
    day_high: float | None
    day_low: float | None
    day_start: datetime | None


class DailyLevels:
    """Previous trading day / week high & low. Days roll at 17:00 New York (DST-aware)."""

    def __init__(self, zone: str = "America/New_York", boundary: str = "17:00") -> None:
        self._zone, self._boundary = zone, boundary
        self._day_start: datetime | None = None
        self._next_day: datetime | None = None
        self._week_start: datetime | None = None
        self._next_week: datetime | None = None
        self._dh: float | None = None
        self._dl: float | None = None
        self._wh: float | None = None
        self._wl: float | None = None
        self.pdh: float | None = None
        self.pdl: float | None = None
        self.pwh: float | None = None
        self.pwl: float | None = None

    def update(self, bar: Bar) -> None:
        t = bar.time_open
        if self._next_day is None or t >= self._next_day:
            if self._day_start is not None and self._dh is not None:
                self.pdh, self.pdl = self._dh, self._dl
            self._day_start = trading_day_start(t, self._zone, self._boundary)
            self._next_day = trading_day_start(self._day_start + timedelta(hours=26), self._zone, self._boundary)
            self._dh = self._dl = None
        if self._next_week is None or t >= self._next_week:
            if self._week_start is not None and self._wh is not None:
                self.pwh, self.pwl = self._wh, self._wl
            self._week_start = trading_week_start(t)
            self._next_week = trading_week_start(self._week_start + timedelta(days=7, hours=2))
            self._wh = self._wl = None
        self._dh = bar.high if self._dh is None else max(self._dh, bar.high)
        self._dl = bar.low if self._dl is None else min(self._dl, bar.low)
        self._wh = bar.high if self._wh is None else max(self._wh, bar.high)
        self._wl = bar.low if self._wl is None else min(self._wl, bar.low)

    def snapshot(self) -> DailyLevelsState:
        return DailyLevelsState(self.pdh, self.pdl, self.pwh, self.pwl, self._dh, self._dl, self._day_start)


def nearest_obstacle(price: float, direction: int, levels: Iterable[float | None]) -> float | None:
    """Nearest level strictly beyond `price` in the trade direction (STRATEGY §2.12)."""
    beyond = [lv for lv in levels if lv is not None and ((lv > price) if direction > 0 else (lv < price))]
    if not beyond:
        return None
    return min(beyond) if direction > 0 else max(beyond)


# ----------------------------------------------------------------------------- engine


@dataclass(frozen=True, slots=True)
class AnalysisSnapshot:
    symbol: str
    decision_time: datetime
    frames: Mapping[Timeframe, StructureState]
    daily: DailyLevelsState
    events: tuple[BreakEvent | SweepEvent, ...] = field(default=())  # produced during the last advance

    def obstacles(self, direction: int, context_tf: Timeframe) -> list[float]:
        ctx = self.frames[context_tf]
        swings = ctx.unbroken_highs if direction > 0 else ctx.unbroken_lows
        extra = (self.daily.pdh, self.daily.pwh) if direction > 0 else (self.daily.pdl, self.daily.pwl)
        return [s.price for s in swings] + [x for x in extra if x is not None]


class AnalysisEngine:
    """All timeframes of one symbol. Feeds only bars CLOSED at or before the decision time."""

    def __init__(self, symbol: str, params: Mapping[Timeframe, StructureParams], daily_tf: Timeframe,
                 day_zone: str = "America/New_York", day_boundary: str = "17:00") -> None:
        if daily_tf not in params:
            raise ValueError("daily_tf must be one of the tracked timeframes")
        self.symbol = symbol
        self._params = dict(params)
        self.daily_tf = daily_tf
        self._day_args = (day_zone, day_boundary)
        self.trackers: dict[Timeframe, StructureTracker] = {}
        self.daily = DailyLevels(*self._day_args)
        self._last_open: dict[Timeframe, np.datetime64] = {}
        self._cache: dict[int, tuple[pd.DataFrame, tuple[np.ndarray, ...]]] = {}
        self.resets = 0
        self.reset()

    def reset(self) -> None:
        self.trackers = {tf: StructureTracker(self.symbol, tf, p) for tf, p in self._params.items()}
        self.daily = DailyLevels(*self._day_args)
        self._last_open = {}

    def _arrays(self, df: pd.DataFrame) -> tuple[np.ndarray, ...]:
        """Column arrays for a frame, cached while the SAME object is passed again (backtests).
        The cache holds a reference to the frame, so its id() cannot be reused by another frame."""
        key = id(df)
        hit = self._cache.get(key)
        if hit is not None and hit[0] is df and len(hit[1][0]) == len(df):
            return hit[1]
        times = df["time_open_utc"].dt.tz_convert("UTC").dt.tz_localize(None).to_numpy(dtype="datetime64[ns]")
        vol = df["tick_volume"].to_numpy(dtype=float) if "tick_volume" in df else np.zeros(len(df))
        arrays = (times, df["open"].to_numpy(float), df["high"].to_numpy(float), df["low"].to_numpy(float),
                  df["close"].to_numpy(float), vol)
        self._cache[key] = (df, arrays)
        while len(self._cache) > 16:
            self._cache.pop(next(iter(self._cache)))
        return arrays

    def advance_to(self, decision_time: datetime, frames: Mapping[Timeframe, pd.DataFrame]) -> AnalysisSnapshot:
        """Push every not-yet-seen bar with close <= decision_time, in close-time order.

        If a frame no longer overlaps the bars already processed (e.g. the bot was offline
        longer than the live window), all trackers are rebuilt from the frames (``resets`` += 1).
        """
        decision_np = np.datetime64(_epoch_ns(decision_time), "ns")
        pending: list[tuple[np.datetime64, int, Timeframe, int, tuple[np.ndarray, ...]]] = []
        for tf in self.trackers:
            if tf not in frames:
                raise KeyError(f"missing frame for {tf.name}")
            arrays = self._arrays(frames[tf])
            times = arrays[0]
            if len(times) == 0:
                continue
            step = np.timedelta64(tf.minutes, "m")
            last = self._last_open.get(tf)
            start = 0
            if last is not None:
                start = int(np.searchsorted(times, last, side="right"))
                if start == 0 and times[0] > last + step:
                    self.resets += 1
                    self.reset()
                    return self.advance_to(decision_time, frames)
            end = int(np.searchsorted(times, decision_np - step, side="right"))  # close <= decision
            for j in range(start, end):
                pending.append((times[j] + step, -tf.minutes, tf, j, arrays))
        pending.sort(key=lambda x: (x[0], x[1]))
        events: list[BreakEvent | SweepEvent] = []
        for _, _, tf, j, (times, o, h, low, c, v) in pending:
            tracker = self.trackers[tf]
            t_open = _EPOCH + timedelta(microseconds=int(times[j].astype(np.int64)) // 1000)
            bar = Bar(tracker.index + 1, t_open, t_open + tf.delta, float(o[j]), float(h[j]), float(low[j]),
                      float(c[j]), float(v[j]))
            events.extend(tracker.update(bar))
            if tf is self.daily_tf:
                self.daily.update(bar)
            self._last_open[tf] = times[j]
        return AnalysisSnapshot(
            symbol=self.symbol, decision_time=decision_time,
            frames={tf: tr.snapshot() for tf, tr in self.trackers.items()},
            daily=self.daily.snapshot(), events=tuple(events),
        )


def params_from_settings(strategy: StrategyCfg, vol: VolatilityFilterCfg, tf: Timeframe) -> StructureParams:
    """Build StructureParams for one timeframe from the validated config."""
    return StructureParams(
        k=int(strategy.swing_k[tf.name]),  # type: ignore[index]
        atr_period=strategy.atr_period,
        swing_min_atr=strategy.swing_min_atr,
        equal_level_atr=strategy.equal_level_atr,
        sweep_max_depth_atr=strategy.sweep_max_depth_atr,
        regime_trend_max_bars=strategy.regime_trend_max_bars,
        compression_bars=strategy.compression_bars,
        compression_atr=strategy.compression_atr,
        momentum_bars=strategy.momentum_bars,
        atr_percentile_lookback=vol.atr_percentile_lookback,
    )
