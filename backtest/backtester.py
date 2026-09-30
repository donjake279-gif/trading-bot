"""Backtester (ARCHITECTURE §4 and §11). Replays history through the SAME decision code as live trading:
AnalysisEngine -> S1Strategy -> SignalEngine -> Gatekeeper (all gates) -> RiskManager -> Cooldown and
CircuitBreakers. Only the fills are simulated (SimBroker).

For every M5 close t (all symbols merged, in time order):
 1. settle exits that happened up to t;
 2. mark equity -> circuit breakers; correlations refreshed once per trading day;
 3. for each symbol with a new M5 bar: advance its analysis to t and evaluate S1;
 4. valid setups in descending score, then symbol, order: gates -> risk -> setup consumed -> fill at
    the next M1 open. The portfolio is updated after each fill, so the next setup sees it.
"""

from __future__ import annotations

import hashlib
import time as wallclock
from collections import Counter
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field, replace
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

import numpy as np
import pandas as pd

from backtest.cost_model import Converter, CostModel, PriceSeries, from_ns, to_ns
from backtest.data_loader import load_history, resample_m1
from backtest.sim_broker import SimBroker, SimPosition
from backtest.specs import BrokerFacts, load_broker_facts, standard_fx_spec
from core.circuit_breakers import CircuitBreakers
from core.config import Settings
from core.cooldown import Cooldown
from core.exposure import CorrelationTable, RiskExposure, compute_correlations
from core.gates import Gatekeeper
from core.market_structure import AnalysisEngine, AnalysisSnapshot, params_from_settings
from core.risk_manager import RiskContext, RiskManager
from core.signal_engine import SignalEngine
from core.strategy import MarketCosts, S1Evaluation, S1Params, S1Strategy
from core.timeutils import trading_day_start
from core.types import (
    BreakerName,
    BreakerTrip,
    ClosedTrade,
    FeedStatus,
    ScoredSignal,
    Timeframe,
)

DEFAULT_WARMUP_DAYS = 100  # >= 1,100 H1 bars of warm-up before the first decision (STRATEGY §2.13)


class Strategy(Protocol):
    def triggered(self, snap: AnalysisSnapshot) -> bool: ...
    def evaluate(self, snap: AnalysisSnapshot, frames: Mapping[Timeframe, pd.DataFrame],
                 market: MarketCosts) -> list[S1Evaluation]: ...


@dataclass(frozen=True)
class BacktestOptions:
    start: datetime
    end: datetime
    symbols: tuple[str, ...]
    cost_multiplier: float = 1.0
    label: str = "backtest"
    warmup_days: int = DEFAULT_WARMUP_DAYS
    structure_warmup_bars: int | None = None  # tests only; production uses the measured 1,100


@dataclass
class BacktestResult:
    options: BacktestOptions
    account_currency: str
    initial_balance: float
    final_balance: float
    trades: list[ClosedTrade]
    trade_info: dict[str, dict[str, Any]]  # trade_id -> decision details (score, session, …)
    decisions: list[dict[str, Any]]  # every VALID setup and what happened to it
    triggers: int  # S1 evaluations (triggers inside an active leg)
    rule_failures: Counter[str]  # how many evaluations each S1 rule rejected
    gate_failures: Counter[str]
    equity_ns: np.ndarray
    equity: np.ndarray
    breaker_trips: list[dict[str, Any]]
    warnings: list[str]
    settings_hash: str
    data_summary: dict[str, dict[str, Any]]
    runtime_seconds: float = 0.0
    notes: list[str] = field(default_factory=list)


def settings_hash(settings: Settings) -> str:
    return hashlib.sha1(settings.model_dump_json().encode()).hexdigest()[:12]


class Backtester:
    def __init__(self, settings: Settings, m1: Mapping[str, pd.DataFrame], facts: BrokerFacts, options: BacktestOptions,
                 strategy: Strategy | None = None, progress: Callable[[str], None] | None = None) -> None:
        self.warnings: list[str] = list(facts.warnings)
        if settings.news.enabled:
            self.warnings.append("news filter enabled in config but cannot be backtested (no historical calendar): "
                                 "treated as disabled here")
            settings = settings.model_copy(update={"news": settings.news.model_copy(update={"enabled": False})})
        self.settings = settings
        self.options = options
        self.facts = facts
        self.progress = progress
        roles = settings.timeframes.roles()
        self.entry_tf, self.structure_tf, self.context_tf = roles["entry"], roles["structure"], roles["context"]
        self.corr_tf = Timeframe.parse(settings.correlation.timeframe)
        self.symbols = tuple(options.symbols)
        specs = dict(facts.specs)
        for name in m1:
            specs.setdefault(name, standard_fx_spec(name))
        self.specs = specs

        costs = CostModel(settings.costs.commission_per_lot_per_side, settings.costs.expected_slippage_points,
                          options.cost_multiplier)
        min_spread = {s.name: s.backtest_min_spread_points for s in settings.symbols}
        self.series = {name: PriceSeries(name, df, specs[name].point, min_spread.get(name, 0), options.cost_multiplier,
                                         settings.spread.window_minutes) for name, df in m1.items()}
        converter = Converter(facts.account_currency, self.series)
        for name in self.symbols:
            if not converter.available(specs[name].currency_profit):
                raise ValueError(f"{name}: no history to convert {specs[name].currency_profit} P&L into "
                                 f"{facts.account_currency}. Run `python main.py download-data`.")
        self.costs = costs
        self.broker = SimBroker(facts.account_currency, facts.leverage, specs, facts.swaps, self.series, converter, costs,
                                settings.backtest.initial_balance)

        tfs = sorted({self.entry_tf, self.structure_tf, self.context_tf, self.corr_tf}, key=lambda tf: tf.minutes)
        self.frames = {s: {tf: resample_m1(m1[s], tf) for tf in tfs} for s in self.symbols}
        params = {}
        for tf in {self.entry_tf, self.structure_tf, self.context_tf}:
            p = params_from_settings(settings.strategy, settings.volatility_filter, tf)
            params[tf] = p if options.structure_warmup_bars is None else replace(p, warmup_bars=options.structure_warmup_bars)
        self.engines = {s: AnalysisEngine(s, params, daily_tf=self.entry_tf,
                                          day_zone=settings.trading_day.boundary_timezone,
                                          day_boundary=settings.trading_day.boundary_time) for s in self.symbols}
        self.strategy: Strategy = strategy or S1Strategy(S1Params.from_settings(settings))
        self.scorer = SignalEngine(settings.scoring)
        self.cooldown = Cooldown(settings.cooldown)
        self.breakers = CircuitBreakers(settings.circuit_breakers, settings.risk.max_trades_per_day,
                                        settings.trading_day.boundary_timezone, settings.trading_day.boundary_time)
        self.gatekeeper = Gatekeeper(settings, self.cooldown, self.breakers)
        self.risk = RiskManager(settings.risk, settings.correlation, settings.costs)
        self.correlations = CorrelationTable.empty()
        self._corr_day: datetime | None = None

        self.trades: list[ClosedTrade] = []
        self.trade_info: dict[str, dict[str, Any]] = {}
        self.decisions: list[dict[str, Any]] = []
        self.rule_failures: Counter[str] = Counter()
        self.gate_failures: Counter[str] = Counter()
        self.triggers = 0
        self.trips: list[dict[str, Any]] = []
        self._check_coverage(m1)

    # ------------------------------------------------------------------ construction from disk
    @classmethod
    def from_history(cls, settings: Settings, project_root: Path, options: BacktestOptions,
                     progress: Callable[[str], None] | None = None) -> Backtester:
        root = project_root / settings.backtest.history_dir
        facts = load_broker_facts(root, list(options.symbols))
        load_from = options.start - timedelta(days=options.warmup_days)
        data: dict[str, pd.DataFrame] = {}
        for sym in options.symbols:
            data[sym] = load_history(root, sym, load_from, options.end)
        extra = []
        for sym in options.symbols:
            ccy = facts.specs[sym].currency_profit
            if ccy == facts.account_currency:
                continue
            for pair in (f"{ccy}{facts.account_currency}", f"{facts.account_currency}{ccy}"):
                if pair in data:
                    break
                if (root / pair).exists():
                    data[pair] = load_history(root, pair, load_from, options.end)
                    extra.append(pair)
                    break
        if extra and progress:
            progress(f"conversion pairs loaded: {', '.join(extra)}")
        conversion_facts = load_broker_facts(root, sorted(set(data) - set(options.symbols)))
        facts = BrokerFacts(facts.account_currency, facts.leverage, {**conversion_facts.specs, **facts.specs},
                            {**conversion_facts.swaps, **facts.swaps}, facts.warnings)
        return cls(settings, data, facts, options, progress=progress)

    def _check_coverage(self, m1: Mapping[str, pd.DataFrame]) -> None:
        for sym in self.symbols:
            df = m1[sym]
            if df.empty:
                raise ValueError(f"{sym}: no history in the requested range")
            first = df["time_open_utc"].iloc[0].to_pydatetime()
            lead = (self.options.start - first).days
            if lead < 60:
                self.warnings.append(f"{sym}: only {lead} days of history before the test start; the analysis needs "
                                     "~65 days of warm-up, so early setups may be missing (download from earlier)")

    # ------------------------------------------------------------------ run
    def run(self) -> BacktestResult:
        started = wallclock.monotonic()
        start_ns, end_ns = to_ns(self.options.start), to_ns(self.options.end)
        step = int(pd.Timedelta(self.entry_tf.delta).value)
        closes: dict[str, np.ndarray] = {}
        for sym in self.symbols:
            opens = self.frames[sym][self.entry_tf]["time_open_utc"].dt.as_unit("ns").astype("int64").to_numpy()
            c = opens + step
            closes[sym] = c[(c >= start_ns) & (c < end_ns)]
        timeline = np.unique(np.concatenate(list(closes.values()))) if closes else np.array([], dtype=np.int64)
        members = {sym: set(closes[sym].tolist()) for sym in self.symbols}
        eq_ns = np.empty(len(timeline), dtype=np.int64)
        eq_val = np.empty(len(timeline), dtype=float)
        last_month = None
        for k, t_ns in enumerate(timeline):
            t = from_ns(int(t_ns))
            for pos in self.broker.due_exits(t):
                self._close(self.broker.settle(pos))
            equity = self.broker.equity(t)
            for trip in self.breakers.update(t, equity):
                self._on_trip(trip)
            self._refresh_correlations(t)
            candidates: list[tuple[ScoredSignal, S1Evaluation]] = []
            for sym in self.symbols:
                if int(t_ns) in members[sym]:
                    candidates += self._analyse(sym, t)
            for scored, ev in sorted(candidates, key=lambda c: (-c[0].total, c[0].candidate.symbol)):
                self._decide(scored, ev, t)
            eq_ns[k], eq_val[k] = t_ns, equity
            if self.progress and (t.year, t.month) != last_month:
                last_month = (t.year, t.month)
                self.progress(f"{t:%Y-%m}  trades {len(self.trades):>4}  balance {self.broker.balance:>12,.2f}")
        for trade in self.broker.close_at_end(self.options.end):
            self._close(trade)
        return BacktestResult(
            options=self.options, account_currency=self.facts.account_currency,
            initial_balance=self.settings.backtest.initial_balance, final_balance=self.broker.balance,
            trades=self.trades, trade_info=self.trade_info, decisions=self.decisions, triggers=self.triggers,
            rule_failures=self.rule_failures, gate_failures=self.gate_failures, equity_ns=eq_ns, equity=eq_val,
            breaker_trips=self.trips, warnings=self.warnings, settings_hash=settings_hash(self.settings),
            data_summary=self._data_summary(), runtime_seconds=wallclock.monotonic() - started,
        )

    # ------------------------------------------------------------------ steps
    def _analyse(self, sym: str, t: datetime) -> list[tuple[ScoredSignal, S1Evaluation]]:
        snap = self.engines[sym].advance_to(t, self.frames[sym])
        if not self.strategy.triggered(snap):
            return []  # nothing to evaluate on this bar: skip pricing
        quote = self.broker.quote(sym, t)
        if quote is None:
            return []  # market closed
        spec = self.specs[sym]
        typical = self.broker.typical_spread_points(sym, t)
        market = MarketCosts(
            bid=quote.bid, ask=quote.ask, typical_spread=quote.spread if typical is None else typical * spec.point,
            commission=self.costs.commission_round_trip_per_lot() / self.broker.value_per_price_unit(sym, t),
            slippage=self.costs.slippage_price(spec.point), stops_level=spec.stops_level_points * spec.point,
        )
        out = []
        for ev in self.strategy.evaluate(snap, self.frames[sym], market):
            self.triggers += 1
            for check in ev.failed_checks:
                self.rule_failures[check.gate] += 1
            if ev.valid:
                out.append((self.scorer.score(ev), ev))
        return out

    def _decide(self, scored: ScoredSignal, ev: S1Evaluation, t: datetime) -> None:
        cand, m = scored.candidate, ev.measures
        sym = cand.symbol
        spec = self.specs[sym]
        quote = self.broker.quote(sym, t)
        assert quote is not None
        equity = self.broker.equity(t)
        gates = self.gatekeeper.evaluate(
            ev, scored, t, spread_points=round(quote.spread / spec.point, 1),
            typical_spread_points=self.broker.typical_spread_points(sym, t),
            currencies=(spec.currency_base, spec.currency_profit), news_status=FeedStatus.DISABLED)
        exposures = [RiskExposure(p.symbol, p.direction, p.risk_pct, self.specs[p.symbol].currency_base,
                                  self.specs[p.symbol].currency_profit) for p in self.broker.open.values()]
        ctx = RiskContext(account=self.broker.account(t, equity), spec=spec,
                          loss_per_lot=self.broker.loss_per_lot(sym, cand.entry_ref, cand.stop, t),
                          margin_per_lot=self.broker.margin_per_lot(sym, cand.entry_ref, t), open_positions=exposures,
                          correlations=self.correlations, drawdown_pct=self.breakers.drawdown_pct)
        assessment = self.risk.assess(scored, ctx, rr_net=m.rr_net or 0.0)
        failed_gates = [g.gate for g in gates if not g.passed]
        for name in failed_gates:
            self.gate_failures[name] += 1
        if not assessment.approved:
            self.gate_failures["risk"] += 1
        outcome = "rejected"
        ticket = None
        if not failed_gates and assessment.approved:
            self.cooldown.consume(cand.setup_id)  # before the order: an attempt uses the setup, filled or not
            d = assessment.decision
            res = self.broker.open_position(sym, cand.direction, d.volume, cand.stop, cand.target, t,
                                            risk_amount=d.risk_amount, risk_pct=d.risk_pct, signal_id=cand.setup_id,
                                            strategy_version=cand.strategy_version)
            if isinstance(res, SimPosition):
                outcome, ticket = "filled", res.ticket
                self.cooldown.record_entry(sym, self.gatekeeper.sessions.entry_sessions(t))
                for trip in self.breakers.on_entry(t, equity):
                    self._on_trip(trip)
                self.trade_info[str(res.ticket)] = {
                    "decision_time": t, "score": scored.total, "session": self.gatekeeper.sessions.label(t),
                    "regime": m.regime, "setup_id": cand.setup_id, "planned_entry": cand.entry_ref,
                    "retracement": m.retracement, "impulse_atr": m.impulse_atr, "sweep": m.sweep,
                    "cost_R": m.cost_R, "components": {c.name: round(c.points, 2) for c in scored.components},
                }
            else:
                outcome = res
        self.decisions.append({
            "time": t, "symbol": sym, "direction": cand.direction.name, "setup_id": cand.setup_id,
            "score": round(scored.total, 2), "entry": cand.entry_ref, "stop": cand.stop, "target": cand.target,
            "failed_gates": ";".join(failed_gates),
            "risk": "approved" if assessment.approved else "; ".join(assessment.decision.reasons),
            "volume": assessment.decision.volume, "outcome": outcome, "ticket": ticket,
        })

    def _close(self, trade: ClosedTrade) -> None:
        self.trades.append(trade)
        self.cooldown.record_close(trade.symbol, trade.close_time_utc, trade.net_pnl)
        for trip in self.breakers.on_trade_closed(trade.close_time_utc, trade.net_pnl, self.broker.balance):
            self._on_trip(trip)

    def _on_trip(self, trip: BreakerTrip) -> None:
        self.trips.append({"time": trip.tripped_at_utc, "breaker": trip.breaker.value,
                           "measured": round(trip.measured, 3), "threshold": trip.threshold})
        if trip.breaker is BreakerName.TOTAL_DD:
            # Live, this halts trading until you reset it by hand. The research run notes it and continues,
            # so the rest of the period is still measured (the report lists every such halt).
            self.breakers.reset(BreakerName.TOTAL_DD)

    def _refresh_correlations(self, t: datetime) -> None:
        day = trading_day_start(t, self.settings.trading_day.boundary_timezone, self.settings.trading_day.boundary_time)
        if self._corr_day == day:
            return
        self._corr_day = day
        h1 = {s: self.frames[s][self.corr_tf] for s in self.symbols}
        self.correlations = compute_correlations(h1, t, self.settings.correlation.lookback_days,
                                                 bar=self.corr_tf.delta)

    def _data_summary(self) -> dict[str, dict[str, Any]]:
        out = {}
        for name, s in self.series.items():
            out[name] = {"bars": len(s), "first": from_ns(int(s.times[0])).isoformat() if len(s) else None,
                         "last": from_ns(int(s.times[-1])).isoformat() if len(s) else None,
                         "median_spread_points": float(np.median(s.spread_points)) if len(s) else None}
        return out
