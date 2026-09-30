"""Risk manager (pure decision logic, architecture §6.6): sizing + portfolio limits + exposure -> RiskDecision.

Broker-derived numbers (loss per lot, margin per lot) are passed in, so live trading (MT5Gateway) and
backtests (SimBroker) share this code unchanged. Every check runs and is reported, even after one fails.
Risk can only ever be REDUCED by history (optional drawdown multiplier <= 1), never increased (P5).
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass

from core.config import CorrelationCfg, CostsCfg, RiskCfg
from core.exposure import (
    CorrelationTable,
    RiskExposure,
    check_correlated_exposure,
    check_currency_exposure,
)
from core.position_sizer import equity_base, size_position
from core.types import AccountSnapshot, RiskDecision, ScoredSignal, SymbolSpec


@dataclass(frozen=True, slots=True)
class RiskContext:
    account: AccountSnapshot
    spec: SymbolSpec
    loss_per_lot: float  # account currency, 1.0 lot from entry to stop (broker-exact live)
    margin_per_lot: float  # account currency for 1.0 lot at the entry price
    open_positions: Sequence[RiskExposure]  # initial risk of every open position, % of equity base
    correlations: CorrelationTable
    drawdown_pct: float = 0.0  # from the equity high-water mark, for the optional risk reduction


@dataclass(frozen=True, slots=True)
class RiskAssessment:
    decision: RiskDecision
    checks: tuple[tuple[str, bool, str], ...]  # (check, passed, reason), all of them

    @property
    def approved(self) -> bool:
        return self.decision.approved


class RiskManager:
    def __init__(self, risk: RiskCfg, correlation: CorrelationCfg, costs: CostsCfg) -> None:
        self.risk = risk
        self.correlation = correlation
        self.costs = costs

    @property
    def commission_per_lot(self) -> float:
        """Round-trip commission for one lot, account currency."""
        return 2.0 * self.costs.commission_per_lot_per_side

    def risk_pct(self, drawdown_pct: float) -> float:
        """Configured risk per trade, reduced (never increased) while in a deep drawdown."""
        pct = self.risk.risk_per_trade_pct
        red = self.risk.drawdown_risk_reduction
        if red.enabled and drawdown_pct >= red.drawdown_pct_threshold:
            pct *= min(1.0, red.risk_multiplier)
        return pct

    def assess(self, signal: ScoredSignal, ctx: RiskContext, rr_net: float) -> RiskAssessment:
        cand = signal.candidate
        acct, spec = ctx.account, ctx.spec
        checks: list[tuple[str, bool, str]] = []
        open_now = list(ctx.open_positions)

        n_open = len(open_now)
        checks.append(("max_open_positions", n_open < self.risk.max_open_positions,
                       f"{n_open} open (max {self.risk.max_open_positions})"))
        same_symbol = sum(1 for p in open_now if p.symbol == cand.symbol)
        per_symbol_cap = self.risk.max_positions_per_symbol if acct.hedging else 1
        checks.append(("max_positions_per_symbol", same_symbol < per_symbol_cap,
                       f"{same_symbol} open on {cand.symbol} (max {per_symbol_cap}"
                       + ("" if acct.hedging else ", netting account") + ")"))

        base = equity_base(acct.balance, acct.equity, self.risk.sizing_equity_base)
        pct = self.risk_pct(ctx.drawdown_pct)
        sizing = size_position(
            spec, loss_per_lot=ctx.loss_per_lot, commission_per_lot=self.commission_per_lot, base=base,
            risk_pct=pct, max_volume_per_trade=self.risk.max_volume_per_trade, margin_per_lot=ctx.margin_per_lot,
            free_margin=acct.free_margin, max_margin_usage=self.risk.max_margin_usage,
        )
        size_note = "; ".join(sizing.reasons)
        if pct < self.risk.risk_per_trade_pct:
            size_note = f"risk reduced to {pct:g}% (drawdown {ctx.drawdown_pct:.2f}%); " + size_note
        checks.append(("sizing", sizing.approved, size_note))

        exposure_pct = sizing.risk_pct if sizing.approved else pct
        me = RiskExposure(cand.symbol, cand.direction, exposure_pct, spec.currency_base, spec.currency_profit)
        ok, reason, _ = check_currency_exposure(open_now, me, self.risk.max_currency_risk_pct)
        checks.append(("currency_exposure", ok, reason))
        ok, reason, _ = check_correlated_exposure(open_now, me, ctx.correlations, self.correlation.threshold_abs,
                                                  self.risk.max_correlated_risk_pct)
        checks.append(("correlated_exposure", ok, reason))

        approved = all(passed for _, passed, _ in checks)
        failed = tuple(f"{name}: {why}" for name, passed, why in checks if not passed)
        decision = RiskDecision(
            approved=approved,
            volume=sizing.volume if approved else 0.0,
            risk_amount=sizing.risk_amount if approved else 0.0,
            risk_pct=sizing.risk_pct if approved else 0.0,
            rr_gross=cand.gross_rr,
            rr_net=rr_net,
            reasons=(size_note,) if approved else failed,
        )
        return RiskAssessment(decision, tuple(checks))
