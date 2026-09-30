"""Position sizing (pure, architecture layer L2). Spec: ARCHITECTURE §6.6, STRATEGY §8 step 8.

    per_lot     = loss_per_lot + commission_per_lot     (account currency, one lot, entry -> stop)
    budget      = equity_base × risk_pct / 100
    volume      = floor(budget / per_lot / step) × step    ALWAYS rounded DOWN
    rejected if volume < volume_min                        never bumped up to the minimum
    capped at   min(volume_max, max_volume_per_trade) and at the margin allowance
    verified    volume × per_lot <= budget × 1.001

The spread is not added to ``per_lot``: the stop distance is measured from the executable price
(ask for a LONG; the SHORT stop carries a spread buffer), so the spread is already inside the loss.
Sizing takes no input about past results except an optional risk multiplier <= 1 (P5: no martingale).
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from core.types import SymbolSpec

RISK_TOLERANCE = 1.001  # actual risk may exceed the budget by rounding noise only
EQUITY_BASES = ("equity", "balance", "min_balance_equity")


def equity_base(balance: float, equity: float, mode: str) -> float:
    """The amount risk_pct applies to. Default ``min_balance_equity`` is the conservative choice."""
    if mode == "equity":
        return equity
    if mode == "balance":
        return balance
    if mode == "min_balance_equity":
        return min(balance, equity)
    raise ValueError(f"unknown sizing_equity_base {mode!r} (use one of {EQUITY_BASES})")


def _floor_to_step(volume: float, step: float) -> float:
    """Largest multiple of ``step`` <= volume (a 1e-9 guard absorbs float noise like 0.3/0.01 = 29.999…)."""
    if volume <= 0:
        return 0.0
    steps = math.floor(volume / step + 1e-9)
    decimals = max(0, -math.floor(math.log10(step))) + 2
    return round(steps * step, decimals)


@dataclass(frozen=True, slots=True)
class SizingResult:
    approved: bool
    volume: float  # lots; 0 when rejected
    budget: float  # account currency the trade may lose (equity base × risk %)
    per_lot: float  # loss at the stop + round-trip commission, for one lot
    risk_amount: float  # volume × per_lot
    risk_pct: float  # risk_amount as % of the equity base
    reasons: tuple[str, ...]


def size_position(
    spec: SymbolSpec,
    *,
    loss_per_lot: float,
    commission_per_lot: float,
    base: float,
    risk_pct: float,
    max_volume_per_trade: float,
    margin_per_lot: float,
    free_margin: float,
    max_margin_usage: float,
) -> SizingResult:
    """Lot size for one trade. Every input is in account currency; ``risk_pct`` is a percentage (0.5 = 0.5 %)."""
    reasons: list[str] = []
    budget = base * risk_pct / 100.0
    per_lot = loss_per_lot + commission_per_lot

    def reject(reason: str) -> SizingResult:
        return SizingResult(False, 0.0, budget, per_lot, 0.0, 0.0, (*reasons, reason))

    for name, value in (("loss_per_lot", loss_per_lot), ("commission_per_lot", commission_per_lot),
                        ("margin_per_lot", margin_per_lot), ("base", base), ("free_margin", free_margin)):
        if not math.isfinite(value) or value < 0:
            return reject(f"invalid {name}: {value!r}")
    if base <= 0 or budget <= 0:
        return reject(f"no equity to risk (base {base:.2f}, risk {risk_pct}%)")
    if loss_per_lot <= 0:
        return reject("loss per lot at the stop must be > 0")

    volume = _floor_to_step(budget / per_lot, spec.volume_step)
    cap = min(spec.volume_max, max_volume_per_trade)
    if volume > cap:
        volume = _floor_to_step(cap, spec.volume_step)
        reasons.append(f"capped at {volume:g} lots (volume_max / max_volume_per_trade)")
    if margin_per_lot > 0:
        allowance = free_margin * max_margin_usage
        if volume * margin_per_lot > allowance:
            volume = _floor_to_step(allowance / margin_per_lot, spec.volume_step)
            reasons.append(f"reduced to {volume:g} lots by margin (max {max_margin_usage:.0%} of free margin)")
    if volume < spec.volume_min - 1e-12:
        return reject(f"size {volume:g} lots is below the broker minimum {spec.volume_min:g} "
                      f"(budget {budget:.2f} / {per_lot:.2f} per lot); never rounded up")
    risk_amount = volume * per_lot
    if risk_amount > budget * RISK_TOLERANCE:
        return reject(f"internal check failed: risk {risk_amount:.2f} > budget {budget:.2f}")
    reasons.append(f"{volume:g} lots risk {risk_amount:.2f} = {100 * risk_amount / base:.3f}% "
                   f"(budget {budget:.2f}, {per_lot:.2f} per lot)")
    return SizingResult(True, volume, budget, per_lot, risk_amount, 100.0 * risk_amount / base, tuple(reasons))
