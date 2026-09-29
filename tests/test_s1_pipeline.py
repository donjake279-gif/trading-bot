"""STEP 5 integration: the real AnalysisEngine + S1 + SignalEngine on a synthetic random walk.

* SHORT is the exact mirror of LONG through the whole pipeline (every price mirrored p -> K - p);
* the strategy never reads a bar after the decision time, and the live bar windows
  (``timeframes.bars_to_load``) give exactly the same verdicts as the full backtest history;
* every evaluation and every candidate satisfies the spec's invariants.

Prices are multiples of 2**-20, so mirroring is exact in floating point and every comparison in the
pipeline mirrors exactly — any asymmetry is a real bug, never rounding.
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import pytest

from backtest.data_loader import resample_m1
from core.market_structure import AnalysisEngine, StructState, StructureParams
from core.signal_engine import SignalEngine
from core.strategy import MarketCosts, S1Evaluation, S1Strategy
from core.types import Direction, ScoredSignal, Timeframe
from tests.test_strategy import PARAMS, SETTINGS

UTC = timezone.utc
TICK = 2.0 ** -20
K_MIRROR = 2.25
DAYS = 60
TFS = (Timeframe.M5, Timeframe.M15, Timeframe.H1)

Frames = dict[Timeframe, pd.DataFrame]
Result = list[tuple[S1Evaluation, ScoredSignal | None]]


def walk(days: int, seed: int) -> pd.DataFrame:
    """M1 random walk with 4-hour drift regimes (so trends, pullbacks and reversals all occur)."""
    n = 60 * 24 * days
    rng = np.random.default_rng(seed)
    drift = np.repeat(rng.normal(0, 0.00004, n // 240 + 1), 240)[:n]
    close = np.round((1.10 + np.cumsum(rng.normal(0, 0.00012, n) + drift)) / TICK) * TICK
    open_ = np.concatenate([[close[0]], close[:-1]])
    high = np.maximum(open_, close) + np.round(np.abs(rng.normal(0, 0.00008, n)) / TICK) * TICK
    low = np.minimum(open_, close) - np.round(np.abs(rng.normal(0, 0.00008, n)) / TICK) * TICK
    times = pd.date_range(datetime(2024, 7, 1, tzinfo=UTC), periods=n, freq="1min", tz=UTC)
    return pd.DataFrame({"time_open_utc": times, "open": open_, "high": high, "low": low, "close": close,
                         "tick_volume": rng.integers(1, 50, n), "spread_points": 6})


def mirror(m1: pd.DataFrame) -> pd.DataFrame:
    out = m1.copy()
    out["open"], out["close"] = K_MIRROR - m1["open"], K_MIRROR - m1["close"]
    out["high"], out["low"] = K_MIRROR - m1["low"], K_MIRROR - m1["high"]
    return out


def run_pipeline(m1: pd.DataFrame, on_trigger: Callable[[S1Strategy, object, Frames, MarketCosts, list[S1Evaluation]],
                                                        None] | None = None) -> Result:
    frames = {tf: resample_m1(m1, tf) for tf in TFS}
    params = {tf: StructureParams(k=SETTINGS.strategy.swing_k[tf.name],  # type: ignore[index]
                                  warmup_bars=150) for tf in TFS}
    engine = AnalysisEngine("EURUSD", params, daily_tf=Timeframe.M5)
    strategy, scorer = S1Strategy(PARAMS), SignalEngine(SETTINGS.scoring)
    out: Result = []
    for row in frames[Timeframe.M5].itertuples():
        t = row.time_open_utc.to_pydatetime() + Timeframe.M5.delta
        snap = engine.advance_to(t, frames)
        # zero spread keeps the mirror exact (with a spread, SHORT stops are wider by design)
        market = MarketCosts(bid=row.close, ask=row.close, typical_spread=0.0, commission=0.00002, slippage=0.00001,
                             stops_level=0.0)
        evaluations = strategy.evaluate(snap, frames, market)
        if evaluations and on_trigger is not None:
            on_trigger(strategy, snap, frames, market, evaluations)
        out += [(ev, scorer.score(ev) if ev.valid else None) for ev in evaluations]
    return out


@pytest.fixture(scope="module")
def m1() -> pd.DataFrame:
    return walk(DAYS, seed=5)


@pytest.fixture(scope="module")
def original(m1: pd.DataFrame) -> Result:
    return run_pipeline(m1)


def test_pipeline_produces_enough_cases(original: Result) -> None:
    valid = [ev for ev, _ in original if ev.valid]
    assert len(original) >= 80 and len(valid) >= 8, (len(original), len(valid))
    assert {ev.direction for ev in valid} == {Direction.LONG, Direction.SHORT}
    rejected_by = {c.gate for ev, _ in original for c in ev.failed_checks}
    assert {"L4_pullback", "L6_trigger", "L7_stop", "L8_room"} <= rejected_by  # the rules really bite


def test_short_is_exact_mirror_of_long(m1: pd.DataFrame, original: Result) -> None:
    mirrored = run_pipeline(mirror(m1))
    assert len(mirrored) == len(original)
    for (a, sa), (b, sb) in zip(original, mirrored, strict=True):
        assert (b.decision_time_utc, b.direction) == (a.decision_time_utc, a.direction.opposite)
        assert [(c.gate, c.passed) for c in b.checks] == [(c.gate, c.passed) for c in a.checks]
        ma, mb = a.measures, b.measures
        for name in ("extreme", "pullback", "entry", "stop", "target", "obstacle"):
            va, vb = getattr(ma, name), getattr(mb, name)
            assert (va is None and vb is None) or vb == pytest.approx(K_MIRROR - va, abs=1e-10), name
        for name in ("retracement", "impulse_atr", "risk", "room_R", "cost_R", "rr_net", "trigger_clv",
                     "leg_age_m15", "atr_percentile", "htf_bars_since_break", "sweep"):
            va, vb = getattr(ma, name), getattr(mb, name)
            assert vb == (pytest.approx(va, rel=1e-9, abs=1e-12) if isinstance(va, float) else va), name
        assert (sa is None) == (sb is None)
        if sa is not None and sb is not None:
            assert sb.total == pytest.approx(sa.total, abs=1e-9)


def test_no_lookahead_and_live_windows_give_identical_verdicts(m1: pd.DataFrame) -> None:
    checked = []

    def recheck(strategy: S1Strategy, snap: object, frames: Frames, market: MarketCosts,
                evaluations: list[S1Evaluation]) -> None:
        t = evaluations[0].decision_time_utc
        closed = {tf: df[df["time_open_utc"] + tf.delta <= t] for tf, df in frames.items()}
        window = {str(k): v for k, v in SETTINGS.timeframes.bars_to_load.items()}
        live = {tf: df.tail(window[tf.name]) for tf, df in closed.items()}
        for view in (closed, live):
            again = strategy.evaluate(snap, view, market)  # type: ignore[arg-type]
            assert [(e.measures, e.checks) for e in again] == [(e.measures, e.checks) for e in evaluations]
        checked.append(t)

    run_pipeline(m1, recheck)
    assert len(checked) >= 80


def test_every_evaluation_obeys_the_spec(original: Result) -> None:
    p = PARAMS
    setup_ids: dict[str, str] = {}
    for ev, scored in original:
        m, d = ev.measures, int(ev.direction)
        assert m.trigger_time == ev.decision_time_utc  # decided on the close of the trigger bar
        assert next(c for c in ev.checks if c.gate == "L1_leg").passed
        if not ev.valid:
            assert scored is None and ev.failed_checks
            continue
        c = ev.candidate
        assert c is not None and scored is not None
        assert m.risk is not None and m.atr_structure is not None and m.retracement is not None
        assert p.stop_min_atr15 * m.atr_structure <= m.risk <= p.stop_max_atr15 * m.atr_structure
        assert p.pullback_r_min <= m.retracement < 1.0
        assert m.impulse_atr is not None and m.impulse_atr >= p.min_impulse_atr15
        assert m.leg_age_m15 is not None and m.leg_age_m15 <= p.max_leg_age_m15_bars
        assert m.cost_R is not None and m.cost_R <= p.max_cost_R
        assert m.rr_net is not None and m.rr_net >= p.min_net_rr
        assert m.room_R is None or m.room_R >= p.min_obstacle_R
        assert m.htf_state is not (StructState.BEAR if d > 0 else StructState.BULL)
        assert m.extreme_time is not None and m.trigger_level_time >= m.extreme_time
        assert m.pullback is not None and d * (m.pullback - c.stop) > 0  # stop beyond the pullback extreme
        assert d * (c.target - c.entry_ref) == pytest.approx(p.target_rr * m.risk)
        assert c.expires_at_utc == m.trigger_time + p.entry_tf.delta
        assert 0 <= scored.total <= 100
        assert setup_ids.setdefault(m.leg_id, c.setup_id) == c.setup_id  # one setup id per leg
    assert len(set(setup_ids.values())) == len(setup_ids)
