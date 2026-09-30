"""Pre-trade gates, run together in one fixed order (ARCHITECTURE §4 step 7, STRATEGY L10–L11).

ALL gates are evaluated even after one fails, so research can measure what each one removes.
The live orchestrator and the backtester both call ``Gatekeeper.evaluate``; only the inputs differ.
"""

from __future__ import annotations

from datetime import datetime

from core.circuit_breakers import CircuitBreakers
from core.config import Settings
from core.cooldown import Cooldown
from core.filters import NewsEvent, news_gate, spread_gate, volatility_gate
from core.session_manager import SessionManager
from core.signal_engine import min_score_gate
from core.strategy import S1Evaluation
from core.types import FeedStatus, GateResult, ScoredSignal

GATE_ORDER = ("session", "spread", "volatility", "news", "cooldown", "min_score", "safety")


class Gatekeeper:
    def __init__(self, settings: Settings, cooldown: Cooldown, breakers: CircuitBreakers) -> None:
        self.settings = settings
        self.sessions = SessionManager(settings.sessions, settings.trading_day.boundary_timezone,
                                       settings.trading_day.boundary_time)
        self.cooldown = cooldown
        self.breakers = breakers

    def evaluate(self, evaluation: S1Evaluation, scored: ScoredSignal, t_utc: datetime, *, spread_points: float,
                 typical_spread_points: float | None, currencies: tuple[str, str],
                 news_status: FeedStatus = FeedStatus.DISABLED, news_events: list[NewsEvent] | None = None,
                 health: GateResult | None = None) -> tuple[GateResult, ...]:
        s = self.settings
        cand = scored.candidate
        gates = [
            self.sessions.gate(t_utc),
            spread_gate(spread_points, typical_spread_points, s.symbol_cfg(cand.symbol).max_spread_points,
                        s.spread.max_multiple_of_typical),
            volatility_gate(evaluation.measures.atr_percentile, s.volatility_filter.min_percentile,
                            s.volatility_filter.max_percentile),
            news_gate(enabled=s.news.enabled, status=news_status, events=news_events or [], currencies=currencies,
                      t_utc=t_utc, importance=list(s.news.importance), before_minutes=s.news.before_minutes,
                      after_minutes=s.news.after_minutes, on_unavailable=s.news.on_unavailable),
            self.cooldown.gate(cand.setup_id, cand.symbol, t_utc, self.sessions.entry_sessions(t_utc)),
            min_score_gate(scored, s.strategy.min_score),
            self.breakers.gate(),
        ]
        if health is not None:
            gates.append(health)
        return tuple(gates)
