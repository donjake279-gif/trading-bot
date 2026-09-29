"""STEP 5 tests: signal score breakdown (STRATEGY §7) and the min-score gate (L10)."""

from __future__ import annotations

from dataclasses import replace

import pytest

from core.config import ScoringCfg
from core.market_structure import StructState
from core.signal_engine import COMPONENTS, SignalEngine, min_score_gate
from core.strategy import S1Evaluation
from core.types import ContractViolation, Direction
from tests.s1_fixtures import Scenario
from tests.test_strategy import SETTINGS, evaluate

ENGINE = SignalEngine(SETTINGS.scoring)


def points(ev: S1Evaluation, engine: SignalEngine = ENGINE) -> dict[str, float]:
    return {c.name: c.points for c in engine.score(ev).components}


def with_measures(ev: S1Evaluation, **changes: object) -> S1Evaluation:
    return replace(ev, measures=replace(ev.measures, **changes))  # type: ignore[arg-type]


@pytest.mark.parametrize("direction", [Direction.LONG, Direction.SHORT], ids=["long", "short"])
def test_worked_example_breakdown(direction: Direction) -> None:
    """STRATEGY §8 step 7: 20 + 15 + 10 + 12.34 + 10 + 10 + 10 = 87.3."""
    scored = ENGINE.score(evaluate(direction=direction))
    got = {c.name: c.points for c in scored.components}
    assert got == pytest.approx({"market_structure": 20, "trend_alignment": 15, "liquidity_event": 10,
                                 "entry_confirmation": 12.34, "volatility": 10, "risk_reward": 10,
                                 "htf_confirmation": 10}, abs=0.01)
    assert scored.total == pytest.approx(87.34, abs=0.01) and scored.max_total == 100
    assert tuple(c.name for c in scored.components) == COMPONENTS
    assert all(c.reason for c in scored.components)
    entry = next(c for c in scored.components if c.name == "entry_confirmation")
    assert entry.inputs["body_atr"] == pytest.approx(0.9) and entry.inputs["clv"] == pytest.approx(0.8769, abs=1e-4)
    gate = min_score_gate(scored, SETTINGS.strategy.min_score)
    assert gate.passed and gate.measured["score"] == pytest.approx(87.34, abs=0.01)


def test_market_structure_ramp() -> None:
    ev = evaluate()
    assert points(with_measures(ev, impulse_atr=1.5))["market_structure"] == 0
    assert points(with_measures(ev, impulse_atr=2.5))["market_structure"] == pytest.approx(10)
    assert points(with_measures(ev, impulse_atr=9.0))["market_structure"] == 20


def test_trend_alignment() -> None:
    ev = evaluate()
    assert points(with_measures(ev, htf_state=StructState.NONE))["trend_alignment"] == pytest.approx(7)
    assert points(with_measures(ev, htf_state=StructState.BEAR))["trend_alignment"] == 0  # score_only mode case
    short = evaluate(direction=Direction.SHORT)
    assert points(with_measures(short, htf_state=StructState.BEAR))["trend_alignment"] == 15


def test_liquidity_event() -> None:
    assert points(evaluate(replace(Scenario(), m15_sweeps=((1.10260, "11:15", "12:15"),))))["liquidity_event"] == 15
    assert points(evaluate(replace(Scenario(), m5_sweeps=())))["liquidity_event"] == 0
    # sweeps before B (or on the M15 bar that contains B) are not part of the pullback
    assert points(evaluate(replace(Scenario(), m5_sweeps=((1.10200, "10:05", "10:25"),))))["liquidity_event"] == 0
    assert points(evaluate(replace(Scenario(), m5_sweeps=(), m15_sweeps=((1.10100, "09:00", "10:30"),)))
                  )["liquidity_event"] == 0


def test_entry_confirmation_components() -> None:
    ev = evaluate()
    assert points(with_measures(ev, trigger_body_atr=1.5, trigger_clv=0.9))["entry_confirmation"] == 20
    assert points(with_measures(ev, trigger_body_atr=0.5, trigger_clv=0.5))["entry_confirmation"] == 0
    assert points(with_measures(ev, trigger_body_atr=None, trigger_clv=0.9))["entry_confirmation"] == 8


@pytest.mark.parametrize(("pct", "expected"), [(None, 0), (10, 0), (20, 0), (25, 5), (30, 10), (55, 10), (80, 10),
                                               (87.5, 5), (95, 0), (100, 0)])
def test_volatility_band(pct: float | None, expected: float) -> None:
    assert points(with_measures(evaluate(), atr_percentile=pct))["volatility"] == pytest.approx(expected)


@pytest.mark.parametrize(("room", "expected"), [(None, 10), (1.0, 0), (2.0, 5), (3.0, 10), (6.0, 10)])
def test_risk_reward_quality(room: float | None, expected: float) -> None:
    assert points(with_measures(evaluate(), room_R=room))["risk_reward"] == pytest.approx(expected)


@pytest.mark.parametrize(("bars", "expected"), [(None, 0), (0, 10), (24, 10), (25, 5), (48, 5), (49, 0)])
def test_htf_confirmation(bars: int | None, expected: float) -> None:
    assert points(with_measures(evaluate(), htf_bars_since_break=bars))["htf_confirmation"] == expected


def test_weights_come_from_config_and_zero_weight_is_omitted() -> None:
    weights = ScoringCfg(market_structure=40, trend_alignment=15, liquidity_event=15, entry_confirmation=20,
                         volatility=0, risk_reward=10, htf_confirmation=0)
    scored = SignalEngine(weights).score(evaluate())
    names = {c.name for c in scored.components}
    assert "volatility" not in names and "htf_confirmation" not in names
    assert scored.max_total == 100
    assert next(c.points for c in scored.components if c.name == "market_structure") == 40


def test_only_valid_setups_are_scored() -> None:
    with pytest.raises(ContractViolation):
        ENGINE.score(evaluate(replace(Scenario(), htf_obstacles=(1.10450,))))


def test_min_score_gate_rejects_low_scores() -> None:
    low = with_measures(evaluate(), impulse_atr=1.5, htf_state=StructState.NONE, trigger_body_atr=0.5,
                        trigger_clv=0.5, atr_percentile=20.0, sweep="none")
    scored = ENGINE.score(low)
    gate = min_score_gate(scored, 60)
    assert scored.total == pytest.approx(7 + 10 + 10) and not gate.passed and "min 60" in gate.reason
