"""MT5Gateway behaviour against a fake terminal: closed bars only, unknown != empty, suffixes, timezones."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from core.clock import SimClock
from core.config import Credentials, load_settings
from core.errors import NotYetImplemented, SymbolResolutionError
from core.market_data import MarketDataService
from core.mt5_connection import MT5Gateway
from core.ports import BrokerUnavailable
from core.types import AccountTradeMode, Direction, Timeframe
from tests.fakes import FakeMT5

UTC = timezone.utc
CFG = Path(__file__).resolve().parents[1] / "config" / "settings.yaml"
T0 = datetime(2024, 7, 17, 10, 0, tzinfo=UTC)  # Wednesday, market open


def _gw(now: datetime, fake: FakeMT5 | None = None) -> tuple[MT5Gateway, FakeMT5, SimClock]:
    fake = fake or FakeMT5()
    for s, b, q, d in [("EURUSD.i", "EUR", "USD", 5), ("USDJPY.i", "USD", "JPY", 3)]:
        fake.add_symbol(s, digits=d, profit_ccy=q, base=b)
    clock = SimClock(now)
    gw = MT5Gateway(load_settings(CFG), Credentials(), clock, mt5_module=fake)
    return gw, fake, clock


def test_connect_and_account() -> None:
    gw, fake, _ = _gw(T0)
    gw.connect()
    acct = gw.account()
    assert acct.trade_mode is AccountTradeMode.DEMO and acct.hedging and gw.startup_identity == (12345, "Fake-Demo")


def test_connect_failure_is_broker_unavailable() -> None:
    gw, fake, _ = _gw(T0)
    fake.fail_next.add("initialize")
    with pytest.raises(BrokerUnavailable, match="initialize failed"):
        gw.connect()


def test_suffix_resolution() -> None:
    gw, fake, _ = _gw(T0)
    mapping = gw.resolve_symbols(["EURUSD", "USDJPY"])
    assert mapping == {"EURUSD": "EURUSD.i", "USDJPY": "USDJPY.i"}
    assert gw.symbol_spec("EURUSD").symbol == "EURUSD"
    fake.add_symbol("GBPUSD.a")
    fake.add_symbol("GBPUSD.b")
    with pytest.raises(SymbolResolutionError, match="exactly one"):
        gw.resolve_symbols(["GBPUSD"])


def test_forming_bar_is_never_returned() -> None:
    gw, fake, clock = _gw(T0 + timedelta(minutes=7))  # 10:07 -> the 10:05 M5 bar is still forming
    fake.set_bars("EURUSD.i", fake.TIMEFRAME_M5, T0 - timedelta(minutes=45), 5, 11)  # last bar opens 10:05
    gw.resolve_symbols(["EURUSD"])
    bars = gw.closed_bars("EURUSD", Timeframe.M5, 5)
    assert bars["time_open_utc"].iloc[-1].to_pydatetime() == T0  # 10:00 bar (closed 10:05)
    assert len(bars) == 5
    # quiet market: no new bar opened, but the 10:05 bar ended at 10:10 and settle time has passed
    clock.set(T0 + timedelta(minutes=10, seconds=6))
    bars = gw.closed_bars("EURUSD", Timeframe.M5, 5)
    assert bars["time_open_utc"].iloc[-1].to_pydatetime() == T0 + timedelta(minutes=5)
    # ...but not before the settle time
    clock2 = _gw(T0 + timedelta(minutes=10, seconds=2), fake)
    gw2 = clock2[0]
    gw2.resolve_symbols(["EURUSD"])
    assert gw2.closed_bars("EURUSD", Timeframe.M5, 5)["time_open_utc"].iloc[-1].to_pydatetime() == T0


def test_bar_times_converted_from_server_time_to_utc() -> None:
    gw, fake, _ = _gw(T0 + timedelta(hours=2))
    fake.set_bars("EURUSD.i", fake.TIMEFRAME_H1, T0 - timedelta(hours=3), 60, 4)
    gw.resolve_symbols(["EURUSD"])
    bars = gw.closed_bars("EURUSD", Timeframe.H1, 10)
    assert bars["time_open_utc"].iloc[0].to_pydatetime() == T0 - timedelta(hours=3)
    assert str(bars["time_open_utc"].dt.tz) == "UTC"


def test_none_means_unknown_not_empty() -> None:
    gw, fake, _ = _gw(T0)
    fake.fail_next.add("positions_get")
    with pytest.raises(BrokerUnavailable):
        gw.positions([731001])
    assert gw.positions([731001]) == []  # a successful empty answer is "confirmed none"


def test_loss_per_lot_and_sign_check() -> None:
    gw, fake, _ = _gw(T0)
    gw.resolve_symbols(["EURUSD"])
    assert gw.loss_per_lot("EURUSD", Direction.LONG, 1.10380, 1.10225) == pytest.approx(155.0)
    assert gw.loss_per_lot("EURUSD", Direction.SHORT, 1.10000, 1.10100) == pytest.approx(100.0)
    with pytest.raises(ValueError):
        gw.loss_per_lot("EURUSD", Direction.LONG, 1.1000, 1.1010)  # "stop" above entry is not a loss


def test_orders_disabled_until_step7() -> None:
    gw, _, _ = _gw(T0)
    with pytest.raises(NotYetImplemented):
        gw.send_market_order(None)  # type: ignore[arg-type]


def test_market_data_snapshot_and_status() -> None:
    gw, fake, clock = _gw(T0 + timedelta(seconds=30))
    for tf, minutes in [(fake.TIMEFRAME_M5, 5), (fake.TIMEFRAME_M15, 15), (fake.TIMEFRAME_H1, 60)]:
        fake.set_bars("EURUSD.i", tf, T0 - timedelta(minutes=minutes * 50), minutes, 50)
    fake.set_tick("EURUSD.i", T0 + timedelta(seconds=29), 1.10000, 1.10007)
    gw.resolve_symbols(["EURUSD"])
    md = MarketDataService(gw, clock, gw._settings)
    snap = md.snapshot("EURUSD", [Timeframe.M5, Timeframe.M15, Timeframe.H1])
    for tf, df in snap.frames.items():
        assert (df["time_open_utc"] + tf.delta <= snap.decision_time_utc).all()
    assert md.spreads.count("EURUSD") == 1
    assert md.data_status("EURUSD", Timeframe.M5).fresh
    clock.advance(timedelta(minutes=2))  # tick now 2.5 min old
    assert "stale tick" in md.data_status("EURUSD", Timeframe.M5).reason
