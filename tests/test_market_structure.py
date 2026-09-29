"""STEP 4 tests: hand-checked definitions, look-ahead (truncation) tests, multi-timeframe feeding."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pytest

from backtest.data_loader import resample_m1
from core.indicators import Candle, RollingPercentile, WilderATR, is_displacement, is_rejection, lin
from core.market_structure import (
    AnalysisEngine,
    Bar,
    BreakEvent,
    DailyLevels,
    FractalDetector,
    SignificantSwings,
    StructState,
    StructureParams,
    StructureTracker,
    SweepEvent,
    SwingKind,
    nearest_obstacle,
)
from core.types import Timeframe

UTC = timezone.utc
T0 = datetime(2024, 7, 15, 0, 0, tzinfo=UTC)  # Monday


def bars_from(ohlc: list[tuple[float, float, float, float]], tf: Timeframe = Timeframe.M15, start: datetime = T0) -> list[Bar]:
    out = []
    for i, (o, h, lo, c) in enumerate(ohlc):
        t = start + tf.delta * i
        out.append(Bar(i, t, t + tf.delta, o, h, lo, c, 100))
    return out


def path_bars(points: list[float], step: float = 0.001, wick: float = 0.0001) -> list[Bar]:
    """Bars walking linearly between pivot prices, one `step` per bar."""
    closes: list[float] = [points[0]]
    for a, b in zip(points, points[1:], strict=False):
        n = max(1, round(abs(b - a) / step))
        closes += [a + (b - a) * (i + 1) / n for i in range(n)]
    ohlc = []
    for prev, cur in zip(closes, closes[1:], strict=False):
        ohlc.append((prev, max(prev, cur) + wick, min(prev, cur) - wick, cur))
    return bars_from(ohlc)


# ----------------------------------------------------------------------------- indicators


def test_wilder_atr_hand_computed() -> None:
    atr = WilderATR(3)
    # TRs: first bar H-L = 2 ; then max(H-L,|H-Cp|,|L-Cp|)
    assert atr.update(12, 10, 11) is None           # TR 2
    assert atr.update(15, 11, 14) is None           # TR 4
    assert atr.update(20, 14, 19) == pytest.approx(4.0)   # TR 6 -> seed (2+4+6)/3
    assert atr.update(19.5, 18.5, 19) == pytest.approx(4 + (1 - 4) / 3)


def test_rolling_percentile() -> None:
    rp = RollingPercentile(4)
    assert [rp.update(x) for x in (1, 2, 3)] == [None, None, None]
    assert rp.update(4) == 100.0
    assert rp.update(0) == 25.0  # window [2,3,4,0]


def test_candle_measures_match_strategy_worked_example() -> None:
    c = Candle(1.10318, 1.10380, 1.10315, 1.10372)
    assert c.body / 0.0006 == pytest.approx(0.9)
    assert c.clv == pytest.approx(0.8769, abs=1e-4)
    entry_points = 12 * lin(c.body / 0.0006, 0.5, 1.5) + 8 * lin(c.clv, 0.5, 0.9)
    assert entry_points == pytest.approx(12.34, abs=0.01)
    assert not is_displacement(c, +1, atr_prev=0.0006)        # body 0.9 ATR < 1.0 ATR
    assert is_displacement(Candle(1.0, 1.0012, 0.9999, 1.0011), +1, atr_prev=0.001)
    assert is_rejection(Candle(1.0008, 1.0010, 1.0000, 1.0009), +1)


# ----------------------------------------------------------------------------- fractals & swings


def test_fractal_strict_left_nonstrict_right_and_confirmation_delay() -> None:
    det = FractalDetector(k=2)
    highs = [1, 2, 5, 5, 4, 3]
    found = []
    for b in bars_from([(h - 0.5, h, h - 1, h - 0.2) for h in highs]):
        for kind, pivot, _ in det.update(b, 1.0):
            if kind is SwingKind.HIGH:
                found.append((pivot.index, b.index))
    # pivot 2 (first of the equal highs) is a fractal, confirmed only when bar 4 closes;
    # pivot 3 is not (left side must be strictly lower)
    assert found == [(2, 4)]


def test_significant_swings_filter_and_replacement() -> None:
    sw = SignificantSwings(min_atr=1.0, equal_atr=0.1)
    b = bars_from([(1, 1, 1, 1)] * 10)
    assert sw.process(SwingKind.HIGH, replace_hl(b[0], 10.0, 9.0), 1.0, b[2])[0] is not None
    assert sw.process(SwingKind.LOW, replace_hl(b[3], 9.8, 9.5), 1.0, b[5])[0] is None       # only 0.5 ATR away
    accepted, replaced = sw.process(SwingKind.HIGH, replace_hl(b[4], 10.5, 9.9), 1.0, b[6])  # higher high replaces
    assert accepted is not None and replaced is not None and accepted.price == 10.5
    low, _ = sw.process(SwingKind.LOW, replace_hl(b[6], 9.6, 9.0), 1.0, b[8])
    assert low is not None and low.label == "FIRST"
    assert [s.kind for s in sw.swings] == [SwingKind.HIGH, SwingKind.LOW]


def replace_hl(bar: Bar, high: float, low: float) -> Bar:
    return Bar(bar.index, bar.time_open, bar.time_close, low, high, low, high, bar.volume)


@pytest.mark.parametrize("pivot", [
    (1.01, 1.05, 0.98, 1.04),   # up bar: the low was printed first
    (1.03, 1.05, 0.98, 1.01),   # down bar: the high was printed first
    (1.02, 1.05, 0.98, 1.02),   # doji: the extreme nearer the open first (here the high)
], ids=["up", "down", "doji"])
def test_outside_pivot_is_processed_mirror_symmetrically(pivot: tuple[float, float, float, float]) -> None:
    """A pivot that is both a fractal high and a fractal low must give the exact mirror structure for
    mirrored prices (STRATEGY §1: every SHORT rule mirrors the LONG rule)."""
    ohlc = [(1.00, 1.01, 0.99, 1.00), (1.00, 1.02, 0.995, 1.01), pivot, (1.04, 1.045, 0.985, 1.00),
            (1.00, 1.03, 0.99, 1.02)]
    k_mirror = 2.0
    mirrored = [(k_mirror - o, k_mirror - lo, k_mirror - h, k_mirror - c) for o, h, lo, c in ohlc]
    params = StructureParams(k=2, atr_period=2, swing_min_atr=0.1)
    a, _ = run(bars_from(ohlc), params)
    b, _ = run(bars_from(mirrored), params)
    seq_a = [(s.kind, s.price) for s in a.swings.swings]
    seq_b = [(SwingKind.HIGH if s.kind is SwingKind.LOW else SwingKind.LOW, k_mirror - s.price) for s in b.swings.swings]
    assert len(seq_a) == 2 and [k for k, _ in seq_a] == [k for k, _ in seq_b]
    assert [p for _, p in seq_a] == pytest.approx([p for _, p in seq_b])
    o, h, lo, c = pivot
    low_first = c > o or (c == o and o - lo < h - o)
    assert seq_a[0][0] is (SwingKind.LOW if low_first else SwingKind.HIGH)


# ----------------------------------------------------------------------------- BOS / CHoCH / legs


PARAMS = StructureParams(k=2, atr_period=3, swing_min_atr=1.0, equal_level_atr=0.1, sweep_max_depth_atr=1.0)


def run(bars: list[Bar], params: StructureParams = PARAMS) -> tuple[StructureTracker, list[BreakEvent | SweepEvent]]:
    tr = StructureTracker("TEST", Timeframe.M15, params)
    events: list[BreakEvent | SweepEvent] = []
    for b in bars:
        events.extend(tr.update(b))
    return tr, events


def test_choch_bos_choch_sequence_and_leg() -> None:
    bars = path_bars([1.000, 1.010, 1.005, 1.015, 1.008, 1.020, 1.004])
    tr, events = run(bars)
    breaks = [e for e in events if isinstance(e, BreakEvent)]
    # the final drop to 1.004 also closes below the older 1.005 low -> a bearish BOS after the CHoCH
    assert [(e.kind, e.direction) for e in breaks] == [("CHoCH", 1), ("BOS", 1), ("CHoCH", -1), ("BOS", -1)]
    assert breaks[0].level.price == pytest.approx(1.0101)   # first swing high (top + wick)
    assert breaks[1].level.price == pytest.approx(1.0151)
    assert breaks[2].level.price == pytest.approx(1.0079)   # higher low at 1.008 - wick
    assert breaks[3].level.price == pytest.approx(1.0049)   # older low at 1.005 - wick
    for e in breaks:  # a level can only be broken after it was known
        assert e.level.confirm_index < e.bar_index
    assert tr.state is StructState.BEAR


def test_leg_origin_and_extreme_during_bull_leg() -> None:
    bars = path_bars([1.000, 1.010, 1.005, 1.015, 1.008, 1.020, 1.016])
    tr, _ = run(bars)
    leg = tr.leg
    assert leg is not None and leg.direction == 1
    assert leg.origin.kind is SwingKind.LOW and leg.origin.price == pytest.approx(1.0079)  # A
    assert leg.extreme == pytest.approx(1.0201)                                           # B = top of the move
    assert leg.extreme_index < tr.index


def test_liquidity_sweep_and_depth_limit() -> None:
    base = path_bars([1.000, 1.010, 1.004, 1.009])  # swing low ~1.0039 established
    tr, _ = run(base)
    low = tr.snapshot().unbroken_lows[-1]
    atr = tr.snapshot().atr
    assert atr is not None
    last = base[-1]
    def mk(i: int, lo: float, c: float) -> Bar:
        t = last.time_open + Timeframe.M15.delta * i
        return Bar(last.index + i, t, t + Timeframe.M15.delta, 1.0085, 1.0086, lo, c, 1)
    ev = tr.update(mk(1, low.price - 0.5 * atr, 1.0070))       # wick below, close back above -> sweep
    assert any(isinstance(e, SweepEvent) and e.direction == 1 for e in ev)
    tr2, _ = run(base)
    ev2 = tr2.update(mk(1, low.price - 3.0 * atr, 1.0070))     # too deep (> 1 ATR) -> not a sweep
    assert not any(isinstance(e, SweepEvent) for e in ev2)


# ----------------------------------------------------------------------------- look-ahead


def random_walk_m1(n: int, seed: int = 7, start: datetime = T0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    close = 1.10 + np.cumsum(rng.normal(0, 0.00012, n))
    open_ = np.concatenate([[1.10], close[:-1]])
    spread = np.abs(rng.normal(0, 0.00008, n))
    high = np.maximum(open_, close) + spread
    low = np.minimum(open_, close) - np.abs(rng.normal(0, 0.00008, n))
    times = pd.date_range(start, periods=n, freq="1min", tz=UTC)
    return pd.DataFrame({"time_open_utc": times, "open": open_, "high": high, "low": low, "close": close,
                         "tick_volume": rng.integers(1, 50, n), "spread_points": 6})


def fingerprint(tr: StructureTracker) -> tuple:  # type: ignore[type-arg]
    s = tr.snapshot()
    return (s.bar_index, s.state, s.last_break.bar_index if s.last_break else None,
            s.leg.leg_id if s.leg else None, s.leg.extreme if s.leg else None, s.atr,
            tuple(x.key for x in s.unbroken_highs), tuple(x.key for x in s.unbroken_lows), len(s.recent_sweeps))


def test_truncation_no_lookahead() -> None:
    """State after bar t must be identical whether or not later bars exist."""
    m15 = resample_m1(random_walk_m1(15 * 1500), Timeframe.M15)
    bars = [Bar(i, r.time_open_utc.to_pydatetime(), r.time_open_utc.to_pydatetime() + Timeframe.M15.delta,
                r.open, r.high, r.low, r.close, r.tick_volume) for i, r in enumerate(m15.itertuples())]
    full = StructureTracker("X", Timeframe.M15, PARAMS)
    history = []
    for b in bars:
        full.update(b)
        history.append(fingerprint(full))
        snap = full.snapshot()
        assert all(s.confirm_index <= snap.bar_index for s in snap.swings)
    for cut in (50, 333, 777, 1200, len(bars) - 1):
        part = StructureTracker("X", Timeframe.M15, PARAMS)
        for b in bars[: cut + 1]:
            part.update(b)
        assert fingerprint(part) == history[cut]


# ----------------------------------------------------------------------------- engine / MTF


def engine() -> AnalysisEngine:
    p = {tf: StructureParams(k=3 if tf is not Timeframe.M5 else 2) for tf in (Timeframe.M5, Timeframe.M15, Timeframe.H1)}
    return AnalysisEngine("EURUSD", p, daily_tf=Timeframe.M5)


def frames_from(m1: pd.DataFrame) -> dict[Timeframe, pd.DataFrame]:
    return {tf: resample_m1(m1, tf) for tf in (Timeframe.M5, Timeframe.M15, Timeframe.H1)}


def test_engine_only_feeds_closed_bars() -> None:
    frames = frames_from(random_walk_m1(60 * 24 * 3))
    eng = engine()
    t = T0 + timedelta(days=2, hours=10, minutes=45)
    snap = eng.advance_to(t, frames)
    assert snap.frames[Timeframe.M5].last_bar.time_close == t                              # 10:40-10:45 bar
    assert snap.frames[Timeframe.M15].last_bar.time_close == t                             # 10:30-10:45 bar
    assert snap.frames[Timeframe.H1].last_bar.time_close == t.replace(minute=0)            # 09:00-10:00 bar, NOT 10:00-11:00
    for tf, st in snap.frames.items():
        assert st.time_close is not None and st.time_close <= t, tf


def test_engine_incremental_equals_one_shot_and_live_windows() -> None:
    m1 = random_walk_m1(60 * 24 * 4)
    frames = frames_from(m1)
    end = T0 + timedelta(days=3, hours=23)
    one = engine()
    final_one = one.advance_to(end, frames)
    inc = engine()
    live = engine()
    t = T0 + timedelta(hours=12)
    while t <= end:
        inc.advance_to(t, frames)
        # live: only the most recent 600 bars of each timeframe are available at each poll
        window = {tf: df[df["time_open_utc"] + tf.delta <= t].tail(600) for tf, df in frames.items()}
        live.advance_to(t, window)
        t += timedelta(minutes=5)
    for tf in frames:
        a, b, c = final_one.frames[tf], inc.trackers[tf].snapshot(), live.trackers[tf].snapshot()
        assert (a.state, a.leg, a.unbroken_highs, a.atr) == (b.state, b.leg, b.unbroken_highs, b.atr)
        assert (a.state, a.leg, a.unbroken_highs) == (c.state, c.leg, c.unbroken_highs)
    assert live.resets == 0


def test_engine_rebuilds_after_long_gap() -> None:
    frames = frames_from(random_walk_m1(60 * 24 * 4))
    eng = engine()
    t1 = T0 + timedelta(days=1)
    eng.advance_to(t1, {tf: df[df["time_open_utc"] + tf.delta <= t1].tail(300) for tf, df in frames.items()})
    t2 = T0 + timedelta(days=3, hours=20)   # "bot offline" much longer than the 300-bar live window
    eng.advance_to(t2, {tf: df[df["time_open_utc"] + tf.delta <= t2].tail(300) for tf, df in frames.items()})
    assert eng.resets == 1


def test_daily_levels_roll_at_new_york_17() -> None:
    dl = DailyLevels()
    # 2024-07-15 (EDT): 17:00 NY = 21:00 UTC
    def b(h: int, m: int, high: float, low: float) -> Bar:
        t = datetime(2024, 7, 15, h, m, tzinfo=UTC)
        return Bar(0, t, t + timedelta(minutes=5), low, high, low, high)
    dl.update(b(20, 50, 1.20, 1.10))   # belongs to the Monday trading day
    dl.update(b(20, 55, 1.25, 1.15))
    assert dl.pdh is None
    dl.update(b(21, 0, 1.22, 1.21))    # first bar of the next trading day
    assert (dl.pdh, dl.pdl) == (1.25, 1.10)


def test_nearest_obstacle() -> None:
    assert nearest_obstacle(1.1038, 1, [1.1090, 1.1045, None, 1.1000]) == 1.1045
    assert nearest_obstacle(1.1038, -1, [1.1090, 1.1045, 1.1000, 1.1020]) == 1.1020
    assert nearest_obstacle(1.1038, 1, [1.1000]) is None


def test_warmup_convergence_live_equals_backtest() -> None:
    """A tracker started 1500 bars late (like live trading with a finite history window) must
    agree EXACTLY with one fed from the beginning once it reports warm."""
    m15 = resample_m1(random_walk_m1(15 * 3200, seed=11), Timeframe.M15)
    bars = [Bar(i, r.time_open_utc.to_pydatetime(), r.time_open_utc.to_pydatetime() + Timeframe.M15.delta,
                r.open, r.high, r.low, r.close, r.tick_volume) for i, r in enumerate(m15.itertuples())]
    p = StructureParams(k=3)

    def fp(tr: StructureTracker) -> tuple:  # type: ignore[type-arg]
        s = tr.snapshot()
        return (s.state, s.leg, s.last_break, s.unbroken_highs, s.unbroken_lows, s.atr, s.atr_percentile)

    full = StructureTracker("X", Timeframe.M15, p)
    ref = []
    for b in bars:
        full.update(b)
        ref.append(fp(full))
    late = StructureTracker("X", Timeframe.M15, p)
    for i, b in enumerate(bars[1500:], 1500):
        late.update(b)
        if late.snapshot().warm:
            assert fp(late) == ref[i], f"diverged at bar {i}"
    assert late.snapshot().warm
