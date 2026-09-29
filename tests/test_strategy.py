"""STEP 5 tests: S1 entry rules, invalidations, stop/target/costs (STRATEGY §3–6, §8, §13).

Every scenario is the STRATEGY §8 worked example with one thing changed; each runs LONG and as its
exact SHORT mirror.
"""

from __future__ import annotations

import json
from dataclasses import replace
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from core.config import load_settings
from core.market_structure import AnalysisSnapshot, StructState
from core.strategy import MarketCosts, S1Evaluation, S1Params, S1Strategy, scan_pullback
from core.types import (
    ContractViolation,
    Direction,
    Quote,
    SymbolSpec,
    Timeframe,
    make_setup_id,
)
from tests.s1_fixtures import M5, M15, K, Scenario, at, build

CFG = Path(__file__).resolve().parents[1] / "config" / "settings.yaml"
SETTINGS = load_settings(CFG)
PARAMS = S1Params.from_settings(SETTINGS)
BOTH = pytest.mark.parametrize("direction", [Direction.LONG, Direction.SHORT], ids=["long", "short"])
WORKED_EXAMPLE = Scenario()


def evaluate(sc: Scenario = WORKED_EXAMPLE, direction: Direction = Direction.LONG,
             params: S1Params = PARAMS) -> S1Evaluation:
    snap, frames, market = build(sc, direction)
    evaluations = S1Strategy(params).evaluate(snap, frames, market)
    assert len(evaluations) == 1 and evaluations[0].direction is direction
    return evaluations[0]


def failed(ev: S1Evaluation) -> set[str]:
    return {c.gate for c in ev.failed_checks}


def mp(direction: Direction, price: float) -> float:
    return price if direction is Direction.LONG else K - price


# ----------------------------------------------------------------------------- the worked example


def test_params_from_settings() -> None:
    assert PARAMS.version == "S1 1.0.0"
    assert (PARAMS.context_tf, PARAMS.structure_tf, PARAMS.entry_tf) == (Timeframe.H1, M15, M5)
    assert PARAMS.max_leg_age_entry_bars == 144  # 48 M15 bars = 144 M5 bars
    assert PARAMS.max_cost_R == 0.20 and PARAMS.min_net_rr == 1.5 and PARAMS.htf_mode == "veto_opposite"
    with pytest.raises(ValueError):
        replace(PARAMS, structure_tf=Timeframe.M30, entry_tf=Timeframe.H1)


def test_worked_example_long_matches_strategy_section_8() -> None:
    ev = evaluate()
    assert ev.valid and ev.summary == "valid"
    m, c = ev.measures, ev.candidate
    assert c is not None
    assert m.extreme == pytest.approx(1.10600) and m.extreme_time == at("10:30")
    assert m.pullback == pytest.approx(1.10240)
    assert m.retracement == pytest.approx(0.60)
    assert m.impulse_atr == pytest.approx(5.0)
    assert m.entry == pytest.approx(1.10380)
    assert m.stop == pytest.approx(1.10225)
    assert m.risk == pytest.approx(0.00155)
    assert m.target == pytest.approx(1.10690)
    assert m.obstacle == pytest.approx(1.10900) and m.room_R == pytest.approx(3.3548, abs=1e-4)
    assert m.cost_R == pytest.approx(0.1032, abs=1e-4)
    assert m.rr_net == pytest.approx(1.835, abs=1e-3)
    assert m.sweep == "entry" and m.htf_bars_since_break == 10
    assert m.leg_age_m15 == pytest.approx(9.0)  # B bar 10:25 -> trigger bar 12:40 = 27 M5 bars
    assert m.trigger_body_atr == pytest.approx(0.9) and m.trigger_clv == pytest.approx(0.8769, abs=1e-4)
    # candidate
    assert (c.entry_ref, c.stop, c.target) == (m.entry, m.stop, m.target)
    assert c.invalidation_price == 1.10000 and c.timeframe is M15
    assert c.detected_at_utc == at("12:45") and c.expires_at_utc == at("12:50")
    assert c.setup_id == make_setup_id("S1 1.0.0", "EURUSD", Direction.LONG, (at("08:30").isoformat(),
                                                                             at("10:15").isoformat()))
    assert c.context["retracement"] == pytest.approx(0.6)
    json.dumps(m.as_dict())  # journal-ready


def test_worked_example_short_mirror() -> None:
    long, short = evaluate(), evaluate(direction=Direction.SHORT)
    assert short.valid and short.candidate is not None and long.candidate is not None
    s = short.measures
    assert s.entry == pytest.approx(K - 1.10380)  # SELL at the bid
    assert s.pullback == pytest.approx(K - 1.10240)
    # SHORT stops trigger on the ask: SL = PH + 0.25 ATR5 + typical spread, so D grows by the spread
    assert s.stop == pytest.approx(K - 1.10240 + 0.25 * 0.0006 + 0.00007)
    assert s.risk is not None and long.measures.risk is not None
    assert s.risk == pytest.approx(long.measures.risk + 0.00007)
    assert s.target == pytest.approx(s.entry - 2.0 * s.risk)
    assert s.retracement == pytest.approx(0.60) and s.impulse_atr == pytest.approx(5.0)
    assert [c.gate for c in short.checks] == [c.gate for c in long.checks]
    assert short.candidate.setup_id != long.candidate.setup_id


# ----------------------------------------------------------------------------- invalidations (STRATEGY §4)


@BOTH
def test_pullback_erasing_the_leg_invalidates(direction: Direction) -> None:
    ev = evaluate(Scenario().with_bar("12:10", low=1.09950), direction)  # §8: r = 1.083
    assert "L4_pullback" in failed(ev)
    assert "erased" in next(c.reason for c in ev.checks if c.gate == "L4_pullback")


@BOTH
def test_leg_resuming_restarts_the_pullback(direction: Direction) -> None:
    # a new extreme after the trigger swing formed: B moves, the swing now predates B -> L6 fails
    ev = evaluate(Scenario().with_bar("12:30", high=1.10700), direction)
    m = ev.measures
    assert m.extreme == pytest.approx(mp(direction, 1.10700)) and m.extreme_time == at("12:35")
    assert m.pullback == pytest.approx(mp(direction, 1.10300))  # only bars after the new B count
    assert failed(ev) == {"L6_trigger"}


@BOTH
def test_new_extreme_before_the_trigger_swing_keeps_setup_valid(direction: Direction) -> None:
    ev = evaluate(Scenario().with_bar("11:50", high=1.10700), direction)
    assert ev.valid
    assert ev.measures.retracement == pytest.approx((1.10700 - 1.10240) / (1.10700 - 1.10000))


@BOTH
def test_stale_leg(direction: Direction) -> None:
    ev = evaluate(direction=direction, params=replace(PARAMS, max_leg_age_m15_bars=8))  # 24 M5 bars < 27
    assert failed(ev) == {"L5_fresh"}


@BOTH
def test_staleness_is_permanent_even_if_price_makes_a_new_extreme(direction: Direction) -> None:
    sc = Scenario().with_bar("12:35", high=1.10700)  # new B after the leg went stale at 12:30
    ev = evaluate(sc, direction, replace(PARAMS, max_leg_age_m15_bars=8))
    assert "L5_fresh" in failed(ev)
    assert "12:30" in next(c.reason for c in ev.checks if c.gate == "L5_fresh")


@BOTH
def test_no_evaluation_without_an_active_leg_in_trigger_direction(direction: Direction) -> None:
    snap, frames, market = build(Scenario(), direction)
    flipped = StructState.BEAR if direction is Direction.LONG else StructState.BULL
    frames_state = dict(snap.frames)
    frames_state[M15] = replace(snap.frames[M15], state=flipped)  # invalidation 4: M15 flipped
    snap2 = AnalysisSnapshot(snap.symbol, snap.decision_time, frames_state, snap.daily)
    assert S1Strategy(PARAMS).evaluate(snap2, frames, market) == []
    frames_state[M15] = replace(snap.frames[M15], leg=None)
    snap3 = AnalysisSnapshot(snap.symbol, snap.decision_time, frames_state, snap.daily)
    assert S1Strategy(PARAMS).evaluate(snap3, frames, market) == []


# ----------------------------------------------------------------------------- entry rules L0–L9


@BOTH
def test_l0_not_ready(direction: Direction) -> None:
    ev = evaluate(replace(Scenario(), not_ready=frozenset({Timeframe.H1})), direction)
    assert failed(ev) == {"L0_ready"}


@BOTH
def test_l2_small_impulse(direction: Direction) -> None:
    ev = evaluate(replace(Scenario(), atr15=0.0045), direction)  # I = 1.33
    assert "L2_impulse" in failed(ev)


@BOTH
def test_l3_htf_veto_and_score_only(direction: Direction) -> None:
    sc = replace(Scenario(), htf_state=StructState.BEAR)  # opposite to the LONG-world trade
    assert failed(evaluate(sc, direction)) == {"L3_htf"}
    assert evaluate(sc, direction, replace(PARAMS, htf_mode="score_only")).valid
    assert evaluate(replace(Scenario(), htf_state=StructState.NONE), direction).valid


@BOTH
def test_l4_shallow_pullback(direction: Direction) -> None:
    ev = evaluate(direction=direction, params=replace(PARAMS, pullback_r_min=0.618))  # r = 0.60
    assert failed(ev) == {"L4_pullback"}


@BOTH
def test_l6_trigger_swing_formed_before_b(direction: Direction) -> None:
    ev = evaluate(replace(Scenario(), trigger_pivot="10:20"), direction)
    assert failed(ev) == {"L6_trigger"}


@BOTH
def test_l7_stop_too_wide(direction: Direction) -> None:
    ev = evaluate(Scenario().with_bar("12:10", low=1.10055), direction)  # §8: D = 0.00340 > 2.5 ATR15
    assert failed(ev) == {"L7_stop"}
    assert ev.measures.risk == pytest.approx(0.00340 + (0.00007 if direction is Direction.SHORT else 0.0))


@BOTH
def test_l7_stop_inside_broker_stops_level(direction: Direction) -> None:
    ev = evaluate(replace(Scenario(), stops_level=0.0016), direction)
    assert failed(ev) == {"L7_stop"}


@BOTH
def test_l7_price_already_beyond_stop(direction: Direction) -> None:
    ev = evaluate(replace(Scenario(), bid=1.10200, ask=1.10207), direction)
    assert {"L7_stop", "L8_room", "L9_costs"} <= failed(ev)
    assert ev.measures.risk is not None and ev.measures.risk <= 0


@BOTH
def test_l8_obstacle_within_one_r(direction: Direction) -> None:
    ev = evaluate(replace(Scenario(), htf_obstacles=(1.10450,)), direction)  # §8: 0.45 R
    assert failed(ev) == {"L8_room"}


@BOTH
def test_l8_nearest_obstacle_among_swings_and_previous_day_week(direction: Direction) -> None:
    ev = evaluate(replace(Scenario(), pdh=1.10600), direction)
    assert ev.valid and ev.measures.obstacle == pytest.approx(mp(direction, 1.10600))
    ev = evaluate(replace(Scenario(), htf_obstacles=(), pdh=None, pwh=None), direction)
    assert ev.valid and ev.measures.obstacle is None and ev.measures.room_R is None


@BOTH
def test_l9_wide_spread(direction: Direction) -> None:
    ev = evaluate(replace(Scenario(), bid=1.10350, ask=1.10380), direction)  # §8: 3-pip spread
    assert failed(ev) == {"L9_costs"} and ev.measures.risk is not None
    assert ev.measures.cost_R == pytest.approx((0.0003 + 0.00007 + 0.00002) / ev.measures.risk)


@BOTH
def test_l9_net_rr(direction: Direction) -> None:
    ev = evaluate(direction=direction, params=replace(PARAMS, target_rr=1.5))
    assert failed(ev) == {"L9_costs"} and ev.measures.rr_net is not None and ev.measures.rr_net < 1.5


@BOTH
def test_all_rules_are_recorded_even_after_failures(direction: Direction) -> None:
    ev = evaluate(replace(Scenario(), htf_state=StructState.BEAR, htf_obstacles=(1.10450,)), direction)
    assert failed(ev) == {"L3_htf", "L8_room"}
    assert [c.gate for c in ev.checks] == ["L0_ready", "L1_leg", "L2_impulse", "L3_htf", "L4_pullback", "L5_fresh",
                                           "L6_trigger", "L7_stop", "L8_room", "L9_costs"]
    assert ev.candidate is None and "L3_htf" in ev.summary


# ----------------------------------------------------------------------------- trigger timing & look-ahead


@BOTH
def test_trigger_expires_after_one_entry_bar(direction: Direction) -> None:
    assert evaluate(replace(Scenario(), decision="12:49"), direction).valid
    snap, frames, market = build(replace(Scenario(), decision="12:50"), direction)
    assert S1Strategy(PARAMS).evaluate(snap, frames, market) == []


@BOTH
def test_bars_after_decision_time_are_never_read(direction: Direction) -> None:
    base = evaluate(direction=direction)
    snap, frames, market = build(Scenario(), direction)
    future = {}
    for tf, df in frames.items():
        extra = df.iloc[[-1]].copy()
        extra["time_open_utc"] = extra["time_open_utc"] + tf.delta
        extra[["high", "low", "close"]] = [mp(direction, 1.2), mp(direction, 1.0), mp(direction, 1.0)]
        future[tf] = pd.concat([df, extra], ignore_index=True)
    ev = S1Strategy(PARAMS).evaluate(snap, future, market)[0]
    assert ev.measures == base.measures and ev.checks == base.checks


def test_evaluation_invariant() -> None:
    ev = evaluate(replace(Scenario(), htf_obstacles=(1.10450,)))
    with pytest.raises(ContractViolation):
        replace(ev, candidate=evaluate().candidate)
    with pytest.raises(ContractViolation):
        replace(evaluate(), candidate=None)


# ----------------------------------------------------------------------------- pullback scan


def test_scan_pullback_basic_and_new_extreme_restarts() -> None:
    s = scan_pullback([1, 2, 3, 2.5, 2.2], [0.5, 1.5, 2.5, 2.0, 1.8], +1, origin=0.0, max_age_bars=10)
    assert s is not None
    assert (s.extreme, s.extreme_bar, s.pullback, s.bars_since_extreme) == (3, 2, 1.8, 2)
    assert s.retracement(0.0) == pytest.approx(0.4) and s.erased_bar is None and s.stale_bar is None
    s = scan_pullback([3, 2.5, 4, 3.5], [2, 1.5, 3, 3.2], +1, origin=0.0, max_age_bars=10)
    assert s is not None and (s.extreme, s.pullback) == (4, 3.2)  # the 1.5 low predates the new B
    s = scan_pullback([3, 2.5], [2, 2.4], +1, origin=0.0, max_age_bars=10)
    assert s is not None and s.pullback == 2.4  # the B bar's own low (2) is not part of the pullback
    assert scan_pullback([4.0], [3.0], +1, 0.0, 10).pullback is None  # type: ignore[union-attr]
    assert scan_pullback([], [], +1, 0.0, 10) is None


def test_scan_pullback_invalidations_are_permanent() -> None:
    s = scan_pullback([3, 2.5, 4], [2, 1.5, 3.5], +1, origin=1.6, max_age_bars=10)
    assert s is not None and s.erased_bar == 1 and s.extreme == 4  # reached A, later new high: still dead
    s = scan_pullback([3, 2.9, 2.8, 5], [2.5, 2.5, 2.5, 4], +1, origin=0.0, max_age_bars=1)
    assert s is not None and s.stale_bar == 2 and s.bars_since_extreme == 0


def test_scan_pullback_short_is_exact_mirror() -> None:
    rng = np.random.default_rng(3)
    low = 1.1 + np.cumsum(rng.normal(0, 0.001, 300))
    high = low + np.abs(rng.normal(0, 0.001, 300))
    a = float(low.min()) - 0.001
    long = scan_pullback(high, low, +1, a, 40)
    short = scan_pullback(K - low, K - high, -1, K - a, 40)
    assert long is not None and short is not None
    assert short.extreme == pytest.approx(K - long.extreme)
    assert short.pullback == pytest.approx(K - long.pullback)  # type: ignore[operator]
    assert (short.extreme_bar, short.erased_bar, short.stale_bar) == (long.extreme_bar, long.erased_bar,
                                                                       long.stale_bar)


# ----------------------------------------------------------------------------- costs


def _spec(symbol: str = "EURUSD", digits: int = 5, stops: int = 0) -> SymbolSpec:
    return SymbolSpec(symbol, digits, 10 ** -digits, 10 ** -digits, 100_000, 0.01, 100, 0.01, stops, 0, "EUR", "USD",
                      "EUR", True)


def test_market_costs_from_broker_facts() -> None:
    q = Quote("EURUSD", at("12:45"), 1.10373, 1.10380)
    mc = MarketCosts.build(q, _spec(stops=10), SETTINGS.costs, value_per_price_unit=100_000, typical_spread_points=6)
    assert mc.commission == pytest.approx(0.00007)  # 2 x 3.5 USD per lot / 100,000 USD per 1.0 price move
    assert mc.slippage == pytest.approx(0.00002) and mc.typical_spread == pytest.approx(0.00006)
    assert mc.stops_level == pytest.approx(0.0001) and mc.spread == pytest.approx(0.00007)
    assert mc.entry(Direction.LONG) == 1.10380 and mc.entry(Direction.SHORT) == 1.10373
    no_typical = MarketCosts.build(q, _spec(), SETTINGS.costs, 100_000, None)
    assert no_typical.typical_spread == pytest.approx(q.spread)  # falls back to the current spread
    jpy = MarketCosts.build(Quote("USDJPY", at("12:45"), 150.000, 150.008), _spec("USDJPY", 3), SETTINGS.costs,
                            value_per_price_unit=100_000 / 150.0, typical_spread_points=None)
    assert jpy.commission == pytest.approx(0.0105)  # ~1 pip on a JPY pair
    with pytest.raises(ContractViolation):
        MarketCosts.build(q, _spec(), SETTINGS.costs, 0.0, None)
    with pytest.raises(ContractViolation):
        MarketCosts(bid=1.1, ask=1.0, typical_spread=0, commission=0, slippage=0, stops_level=0)
