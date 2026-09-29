"""Signal scoring (pure, architecture layer L2). Spec: docs/STRATEGY.md §7.

The score only RANKS setups that already passed L1–L9; a hard requirement is never turned into
points. Component weights come from config (fixed a priori, never optimized) and the thresholds
inside each component are part of the specification, fixed here. Each component reports its
points, its raw inputs and a plain-text reason, so every score can be audited.

The score is a hypothesis in its own right: research checks whether higher buckets really have
higher out-of-sample expectancy (ARCHITECTURE §6.3).
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass

from core.config import ScoringCfg
from core.indicators import lin
from core.market_structure import StructState
from core.strategy import S1Evaluation, S1Measures
from core.types import (
    ContractViolation,
    Direction,
    GateResult,
    ScoreComponent,
    ScoredSignal,
)

# Component thresholds (STRATEGY §7). Shares are fractions of each component's configured weight.
IMPULSE_ATR_RANGE = (1.5, 3.5)  # market structure: lin(I, 1.5, 3.5)
TREND_NEUTRAL_SHARE = 7 / 15  # context state NONE: 7 of 15 points
LIQUIDITY_M5_SHARE = 10 / 15  # only an M5 swing swept: 10 of 15 points
ENTRY_BODY_SHARE, ENTRY_CLV_SHARE = 12 / 20, 8 / 20  # 12·lin(body/ATR5) + 8·lin(CLV)
ENTRY_BODY_ATR_RANGE = (0.5, 1.5)
ENTRY_CLV_RANGE = (0.5, 0.9)
VOLATILITY_BAND = (30.0, 80.0)  # full points inside the band
VOLATILITY_LOW_RAMP = (20.0, 30.0)
VOLATILITY_HIGH_RAMP = (80.0, 95.0)
ROOM_R_RANGE = (1.0, 3.0)
HTF_FULL_BARS, HTF_HALF_BARS = 24, 48

COMPONENTS = ("market_structure", "trend_alignment", "liquidity_event", "entry_confirmation", "volatility",
              "risk_reward", "htf_confirmation")


@dataclass(frozen=True, slots=True)
class Share:
    """A component's result before weighting: share of the weight in [0, 1], reason, raw inputs."""

    share: float
    reason: str
    inputs: Mapping[str, float | str | bool]


def _inputs(**values: float | str | bool | None) -> dict[str, float | str | bool]:
    return {k: v for k, v in values.items() if v is not None}


# ----------------------------------------------------------------------------- components (pure)


def market_structure(m: S1Measures) -> Share:
    if m.impulse_atr is None:
        return Share(0.0, "impulse size unavailable", {})
    return Share(lin(m.impulse_atr, *IMPULSE_ATR_RANGE),
                 f"impulse {m.impulse_atr:.2f} ATR15 on the ramp {IMPULSE_ATR_RANGE[0]}–{IMPULSE_ATR_RANGE[1]}",
                 _inputs(impulse_atr=m.impulse_atr))


def trend_alignment(m: S1Measures) -> Share:
    aligned = StructState.BULL if m.direction is Direction.LONG else StructState.BEAR
    if m.htf_state is aligned:
        share, reason = 1.0, f"context trend {m.htf_state.value} is aligned"
    elif m.htf_state is StructState.NONE:
        share, reason = TREND_NEUTRAL_SHARE, "context trend undefined (NONE)"
    else:
        share, reason = 0.0, f"context trend {m.htf_state.value} opposes the trade"
    return Share(share, reason, _inputs(htf_state=m.htf_state.value))


def liquidity_event(m: S1Measures) -> Share:
    if m.sweep == "structure":
        return Share(1.0, "pullback swept an unbroken structure-timeframe (M15) swing", _inputs(sweep=m.sweep))
    if m.sweep == "entry":
        return Share(LIQUIDITY_M5_SHARE, "pullback swept only an entry-timeframe (M5) swing", _inputs(sweep=m.sweep))
    return Share(0.0, "no liquidity sweep during the pullback", _inputs(sweep=m.sweep))


def entry_confirmation(m: S1Measures) -> Share:
    body = lin(m.trigger_body_atr, *ENTRY_BODY_ATR_RANGE) if m.trigger_body_atr is not None else 0.0
    clv = lin(m.trigger_clv, *ENTRY_CLV_RANGE)
    body_txt = "n/a" if m.trigger_body_atr is None else f"{m.trigger_body_atr:.2f}"
    return Share(ENTRY_BODY_SHARE * body + ENTRY_CLV_SHARE * clv,
                 f"trigger bar body {body_txt} ATR5, close location {m.trigger_clv:.3f}",
                 _inputs(body_atr=m.trigger_body_atr, clv=m.trigger_clv))


def volatility(m: S1Measures) -> Share:
    p = m.atr_percentile
    if p is None:
        return Share(0.0, "ATR percentile unavailable", {})
    lo, hi = VOLATILITY_BAND
    if lo <= p <= hi:
        share = 1.0
    elif p < lo:
        share = lin(p, *VOLATILITY_LOW_RAMP)
    else:
        share = 1.0 - lin(p, *VOLATILITY_HIGH_RAMP)
    return Share(share, f"ATR percentile {p:.1f} (full points {lo:g}–{hi:g})", _inputs(atr_percentile=p))


def risk_reward(m: S1Measures) -> Share:
    if m.room_R is None:
        return Share(1.0, "no obstacle in the trade direction", {})
    return Share(lin(m.room_R, *ROOM_R_RANGE), f"nearest obstacle {m.room_R:.2f} R away",
                 _inputs(room_R=m.room_R, obstacle=m.obstacle))


def htf_confirmation(m: S1Measures) -> Share:
    bars = m.htf_bars_since_break
    if bars is None:
        return Share(0.0, "no context-timeframe break in the trade direction on record", {})
    if bars <= HTF_FULL_BARS:
        share = 1.0
    elif bars <= HTF_HALF_BARS:
        share = 0.5
    else:
        share = 0.0
    return Share(share, f"last context break in the trade direction {bars} bars ago", _inputs(bars_since=bars))


_RULES = {
    "market_structure": market_structure,
    "trend_alignment": trend_alignment,
    "liquidity_event": liquidity_event,
    "entry_confirmation": entry_confirmation,
    "volatility": volatility,
    "risk_reward": risk_reward,
    "htf_confirmation": htf_confirmation,
}


# ----------------------------------------------------------------------------- engine


class SignalEngine:
    """Weights each component and assembles the ScoredSignal. Zero-weight components are left out."""

    def __init__(self, weights: ScoringCfg) -> None:
        self.weights = {name: float(getattr(weights, name)) for name in COMPONENTS}

    def score(self, evaluation: S1Evaluation) -> ScoredSignal:
        if evaluation.candidate is None:
            raise ContractViolation("only valid setups are scored (STRATEGY §7): " + evaluation.summary)
        components = []
        for name in COMPONENTS:
            weight = self.weights[name]
            if weight <= 0:
                continue
            part = _RULES[name](evaluation.measures)
            points = min(weight, max(0.0, weight * part.share))
            components.append(ScoreComponent(name, points, weight, part.reason, part.inputs))
        return ScoredSignal(evaluation.candidate, tuple(components))


def min_score_gate(signal: ScoredSignal, min_score: float) -> GateResult:
    """L10: the score must reach ``strategy.min_score``."""
    total = signal.total
    return GateResult("min_score", total >= min_score, f"score {total:.1f} (min {min_score:g})",
                      {"score": total, "min_score": min_score})
