"""Tests for sessions, spread/volatility/news filters, cooldown, circuit breakers and the gatekeeper."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

import pytest

from core.circuit_breakers import CircuitBreakers
from core.cooldown import Cooldown
from core.filters import news_gate, spread_gate, volatility_gate
from core.gates import GATE_ORDER, Gatekeeper
from core.session_manager import SessionManager
from core.signal_engine import SignalEngine
from core.types import BreakerName, FeedStatus
from tests.test_strategy import SETTINGS, evaluate

UTC = timezone.utc


def utc(y: int, mo: int, d: int, h: int, mi: int = 0) -> datetime:
    return datetime(y, mo, d, h, mi, tzinfo=UTC)


SESSIONS = SessionManager(SETTINGS.sessions)


# ----------------------------------------------------------------------------- sessions


@pytest.mark.parametrize(("t", "label", "passed"), [
    (utc(2024, 7, 16, 12, 45), "overlap_london_ny", True),    # summer: London 07-15:30 UTC, NY 12-21 UTC
    (utc(2024, 7, 16, 7, 30), "london", True),
    (utc(2024, 7, 16, 3, 0), "asia", False),                   # Tokyo 00-06 UTC: not allowed for entries
    (utc(2024, 7, 16, 6, 30), "off", False),
    (utc(2024, 7, 16, 20, 45), "new_york", False),             # 15 min before the 17:00 NY day roll
    (utc(2024, 1, 16, 7, 30), "off", False),                   # winter: London opens 08:00 UTC
    (utc(2024, 3, 12, 12, 30), "overlap_london_ny", True),     # US already on DST, UK not yet
    (utc(2024, 7, 20, 12, 0), "off", False),                   # Saturday
])
def test_session_windows_follow_each_centre_local_time(t: datetime, label: str, passed: bool) -> None:
    assert SESSIONS.label(t) == label
    assert SESSIONS.gate(t).passed is passed


def test_entry_session_instances() -> None:
    assert SESSIONS.entry_sessions(utc(2024, 7, 16, 12, 45)) == ("london@2024-07-16", "new_york@2024-07-16")
    assert SESSIONS.minutes_to_day_roll(utc(2024, 7, 16, 21, 10)) == pytest.approx(10)


# ----------------------------------------------------------------------------- filters


def test_spread_gate() -> None:
    assert spread_gate(7, 6, 15, 2.0).passed
    assert not spread_gate(13, 6, 15, 2.0).passed           # 2 x typical = 12
    assert spread_gate(14, None, 15, 2.0).passed            # no typical yet: absolute cap only
    assert not spread_gate(16, 10, 15, 2.0).passed          # the cap binds (2 x 10 = 20 > 15)


@pytest.mark.parametrize(("p", "ok"), [(None, False), (19.9, False), (20, True), (55, True), (95, True), (95.1, False)])
def test_volatility_gate(p: float | None, ok: bool) -> None:
    assert volatility_gate(p, 20, 95).passed is ok


@dataclass(frozen=True)
class Ev:
    time_utc: datetime
    currency: str
    importance: str = "high"
    title: str = "NFP"


def test_news_gate() -> None:
    t = utc(2024, 7, 5, 12, 20)
    base = dict(currencies=("EUR", "USD"), t_utc=t, importance=["high"], before_minutes=30, after_minutes=15,
                on_unavailable="block_entries")
    assert news_gate(enabled=False, status=FeedStatus.DISABLED, events=[], **base).passed  # type: ignore[arg-type]
    nfp = [Ev(utc(2024, 7, 5, 12, 30), "USD")]
    assert not news_gate(enabled=True, status=FeedStatus.OK, events=nfp, **base).passed  # type: ignore[arg-type]
    jpy = [Ev(utc(2024, 7, 5, 12, 30), "JPY")]
    assert news_gate(enabled=True, status=FeedStatus.OK, events=jpy, **base).passed  # type: ignore[arg-type]
    assert not news_gate(enabled=True, status=FeedStatus.STALE, events=[], **base).passed  # type: ignore[arg-type]
    base["on_unavailable"] = "ignore"
    assert news_gate(enabled=True, status=FeedStatus.UNAVAILABLE, events=[], **base).passed  # type: ignore[arg-type]


# ----------------------------------------------------------------------------- cooldown


def test_cooldown_rules() -> None:
    cd = Cooldown(SETTINGS.cooldown)
    t = utc(2024, 7, 16, 12, 45)
    sessions = ("london@2024-07-16", "new_york@2024-07-16")
    assert cd.gate("s1", "EURUSD", t, sessions).passed
    assert cd.consume("s1") and not cd.consume("s1")
    cd.record_entry("EURUSD", sessions)
    g = cd.gate("s2", "EURUSD", t, sessions)
    assert not g.passed and "max 1" in g.reason
    assert cd.gate("s2", "EURUSD", t, ("new_york@2024-07-17",)).passed   # next session
    assert not cd.gate("s1", "GBPUSD", t, ()).passed                    # a used setup id stays used
    cd.record_close("GBPUSD", t, net_pnl=-10)
    assert not cd.gate("s3", "GBPUSD", t + timedelta(minutes=45), ()).passed   # 60 min after a loss
    assert cd.gate("s3", "GBPUSD", t + timedelta(minutes=60), ()).passed
    cd.record_close("AUDUSD", t, net_pnl=+10)
    assert not cd.gate("s4", "AUDUSD", t + timedelta(minutes=29), ()).passed  # 30 min after any close
    assert cd.gate("s4", "AUDUSD", t + timedelta(minutes=30), ()).passed


# ----------------------------------------------------------------------------- circuit breakers


def breakers() -> CircuitBreakers:
    return CircuitBreakers(SETTINGS.circuit_breakers, SETTINGS.risk.max_trades_per_day)


MON = utc(2024, 7, 15, 13)  # Monday; the trading day runs 21:00 UTC Sun -> 21:00 UTC Mon (EDT)


def test_daily_drawdown_trips_and_resets_next_trading_day() -> None:
    cb = breakers()
    cb.update(MON, 10_000)
    assert cb.update(MON + timedelta(hours=1), 9_850) == []
    trips = cb.update(MON + timedelta(hours=2), 9_800)  # 2.0 %
    assert [x.breaker for x in trips] == [BreakerName.DAILY_DD] and not cb.can_open_new
    assert "next trading day 2024-07-15T21:00:00+00:00" in cb.gate().reason
    cb.update(utc(2024, 7, 15, 21, 5), 9_800)  # after the 17:00 New York roll
    assert cb.can_open_new and cb.day_start_equity == 9_800


def test_weekly_and_total_drawdown() -> None:
    cb = breakers()
    cb.update(MON, 10_000)
    for day, eq in enumerate((9_850, 9_700, 9_600)):  # each day loses < 2 %
        cb.update(MON + timedelta(days=day, hours=1), eq)
    assert BreakerName.WEEKLY_DD in cb.trips  # 4 % from the week start
    cb.update(utc(2024, 7, 21, 21, 30), 9_600)  # Sunday 17:30 New York: new week
    assert BreakerName.WEEKLY_DD not in cb.trips
    cb.update(utc(2024, 7, 22, 12), 9_200)  # 8 % below the 10,000 high-water mark
    assert BreakerName.TOTAL_DD in cb.trips
    cb.update(utc(2024, 7, 29, 12), 9_300)  # days and weeks later: still latched
    assert BreakerName.TOTAL_DD in cb.trips and not cb.can_open_new
    assert cb.reset(BreakerName.TOTAL_DD) and cb.high_water == 9_300  # manual reset re-bases the mark
    cb.update(utc(2024, 7, 29, 13), 9_300)
    assert BreakerName.TOTAL_DD not in cb.trips


def test_consecutive_losses_and_max_trades() -> None:
    cb = breakers()
    cb.update(MON, 10_000)
    cb.on_trade_closed(MON, -50, 9_950)
    cb.on_trade_closed(MON, +80, 10_030)   # a win resets the streak
    for _ in range(2):
        assert cb.on_trade_closed(MON, -50, 9_980) == []
    assert [x.breaker for x in cb.on_trade_closed(MON, -50, 9_930)] == [BreakerName.CONSEC_LOSSES]
    cb.update(utc(2024, 7, 16, 13), 9_930)
    assert cb.can_open_new and cb.consecutive_losses == 0
    for i in range(3):
        assert cb.on_entry(utc(2024, 7, 16, 13, i), 9_930) == []
    assert cb.on_entry(utc(2024, 7, 16, 14), 9_930)[0].breaker is BreakerName.MAX_TRADES_DAY


def test_rate_breakers_use_a_sliding_hour() -> None:
    cb = breakers()
    for minute in (0, 20, 40, 60, 61):  # at 61 the minute-0 exception has left the window: still 4
        assert cb.on_exception(MON + timedelta(minutes=minute)) == []
    assert cb.on_exception(MON + timedelta(minutes=62))[0].breaker is BreakerName.EXCEPTION_RATE  # 5 within an hour


# ----------------------------------------------------------------------------- gatekeeper


def test_gatekeeper_runs_every_gate_in_order() -> None:
    ev = evaluate()
    scored = SignalEngine(SETTINGS.scoring).score(ev)
    cb = breakers()
    cb.update(utc(2024, 7, 16, 12, 45), 10_000)
    keeper = Gatekeeper(SETTINGS, Cooldown(SETTINGS.cooldown), cb)
    t = utc(2024, 7, 16, 12, 45)
    gates = keeper.evaluate(ev, scored, t, spread_points=7, typical_spread_points=7, currencies=("EUR", "USD"))
    assert tuple(g.gate for g in gates) == GATE_ORDER and all(g.passed for g in gates)
    cb.update(utc(2024, 7, 16, 12, 50), 9_700)
    gates = keeper.evaluate(ev, scored, t, spread_points=40, typical_spread_points=7, currencies=("EUR", "USD"))
    assert {g.gate for g in gates if not g.passed} == {"spread", "safety"}
