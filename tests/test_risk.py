"""STEP 6 tests: position sizing, currency/correlation exposure, risk manager (ARCHITECTURE §6.6)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pytest

from core.config import DrawdownReductionCfg
from core.exposure import (
    CorrelationTable,
    RiskExposure,
    check_correlated_exposure,
    check_currency_exposure,
    compute_correlations,
    currency_legs,
)
from core.position_sizer import equity_base, size_position
from core.risk_manager import RiskContext, RiskManager
from core.signal_engine import SignalEngine
from core.types import AccountSnapshot, AccountTradeMode, Direction, SymbolSpec
from tests.test_strategy import SETTINGS, evaluate

UTC = timezone.utc
T = datetime(2024, 7, 16, 12, 45, tzinfo=UTC)
LONG, SHORT = Direction.LONG, Direction.SHORT


def spec(symbol: str = "EURUSD", digits: int = 5, vmin: float = 0.01, vmax: float = 100.0,
         step: float = 0.01) -> SymbolSpec:
    return SymbolSpec(symbol, digits, 10 ** -digits, 10 ** -digits, 100_000, vmin, vmax, step, 0, 0,
                      symbol[:3], symbol[3:], symbol[:3], True)


def size(**kw: float) -> object:
    args = dict(loss_per_lot=155.0, commission_per_lot=7.0, base=10_000.0, risk_pct=0.5, max_volume_per_trade=5.0,
                margin_per_lot=0.0, free_margin=10_000.0, max_margin_usage=0.3)
    args.update(kw)
    return size_position(spec(), **args)  # type: ignore[arg-type]


# ----------------------------------------------------------------------------- sizing


def test_worked_example_sizes_to_030_lots() -> None:
    """STRATEGY §8 step 8: 155 + 7 = 162 USD per lot; 50 / 162 = 0.3086 -> 0.30 lots, risk 48.60 (0.486 %)."""
    r = size()
    assert r.approved and r.volume == 0.30  # type: ignore[attr-defined]
    assert r.risk_amount == pytest.approx(48.60) and r.risk_pct == pytest.approx(0.486)  # type: ignore[attr-defined]


def test_volume_always_rounds_down_and_is_never_bumped_to_minimum() -> None:
    assert size(loss_per_lot=100.0, commission_per_lot=0.0, base=6_000.0).volume == 0.30  # type: ignore[attr-defined]
    assert size(base=1_000.0).volume == 0.03  # type: ignore[attr-defined]  # 5 / 162 = 0.0309
    tiny = size(base=200.0)  # 1 / 162 = 0.006 lots < 0.01 minimum
    assert not tiny.approved and "never rounded up" in tiny.reasons[-1]  # type: ignore[attr-defined]


@pytest.mark.parametrize(("loss", "expected"), [(200.0, 0.24), (132.0, 0.35)], ids=["USDJPY", "EURAUD"])
def test_jpy_and_cross_pairs(loss: float, expected: float) -> None:
    # USDJPY 30-pip stop: 100,000 x 0.30 JPY = 30,000 JPY / 150 = 200 USD; EURAUD 20 pips: 200 AUD x 0.66 = 132 USD
    assert size(loss_per_lot=loss).volume == expected  # type: ignore[attr-defined]


def test_caps_and_margin_only_reduce() -> None:
    capped = size(loss_per_lot=1.0, commission_per_lot=0.0)  # 50 lots wanted
    assert capped.volume == 5.0 and "capped" in capped.reasons[0]  # type: ignore[attr-defined]
    margin = size(margin_per_lot=2_200.0, free_margin=1_000.0)  # 30 % of 1,000 = 300 -> 0.13 lots
    assert margin.volume == 0.13 and "margin" in margin.reasons[0]  # type: ignore[attr-defined]
    assert margin.risk_amount < margin.budget  # type: ignore[attr-defined]


def test_invalid_inputs_are_rejected() -> None:
    assert not size(loss_per_lot=float("nan")).approved  # type: ignore[attr-defined]
    assert not size(loss_per_lot=0.0).approved  # type: ignore[attr-defined]
    assert not size(base=0.0).approved  # type: ignore[attr-defined]


def test_equity_base_modes() -> None:
    assert equity_base(10_000, 9_000, "min_balance_equity") == 9_000
    assert equity_base(10_000, 9_000, "equity") == 9_000
    assert equity_base(10_000, 9_000, "balance") == 10_000
    with pytest.raises(ValueError):
        equity_base(1, 1, "bogus")


# ----------------------------------------------------------------------------- exposure


def x(symbol: str, direction: Direction, pct: float = 0.5) -> RiskExposure:
    return RiskExposure(symbol, direction, pct, symbol[:3], symbol[3:])


def test_currency_legs() -> None:
    legs = currency_legs([x("EURUSD", LONG), x("USDJPY", SHORT)])
    assert legs == pytest.approx({"EUR": 0.5, "USD": -1.0, "JPY": 0.5})


def test_currency_limit() -> None:
    book = [x("EURUSD", LONG), x("GBPUSD", LONG)]
    ok, reason, measured = check_currency_exposure(book, x("AUDUSD", LONG), 1.0)
    assert not ok and "USD" in reason and measured["net_USD"] == pytest.approx(-1.5)
    assert check_currency_exposure(book[:1], x("GBPUSD", LONG), 1.0)[0]  # USD -1.0: exactly at the limit
    assert check_currency_exposure(book, x("AUDUSD", SHORT), 1.0)[0]  # short AUDUSD offsets USD


def test_correlated_exposure_uses_effective_direction() -> None:
    table = CorrelationTable(T, {("EURUSD", "GBPUSD"): 0.85, ("EURUSD", "USDCHF"): -0.9, ("AUDUSD", "GBPUSD"): 0.8,
                                 ("AUDUSD", "EURUSD"): 0.75})
    ok, _, m = check_correlated_exposure([x("EURUSD", LONG)], x("GBPUSD", LONG), table, 0.7, 1.0)
    assert ok and m["correlated_risk_pct"] == pytest.approx(1.0)
    ok, _, _ = check_correlated_exposure([x("EURUSD", LONG), x("AUDUSD", LONG)], x("GBPUSD", LONG), table, 0.7, 1.0)
    assert not ok
    # long USDCHF is effectively SHORT EURUSD -> not stacked; short USDCHF is stacked
    assert check_correlated_exposure([x("EURUSD", LONG)], x("USDCHF", LONG), table, 0.7, 0.5)[0]
    assert not check_correlated_exposure([x("EURUSD", LONG)], x("USDCHF", SHORT), table, 0.7, 0.5)[0]
    # unknown correlation fails closed (counted as same direction)
    ok, reason, _ = check_correlated_exposure([x("USDJPY", LONG)], x("EURUSD", LONG), table, 0.7, 0.5)
    assert not ok and "unknown" in reason


def h1_frame(returns: np.ndarray, start: datetime) -> pd.DataFrame:
    closes = 1.1 * np.exp(np.cumsum(returns))
    times = pd.date_range(start, periods=len(closes), freq="1h", tz=UTC)
    return pd.DataFrame({"time_open_utc": times, "open": closes, "high": closes, "low": closes, "close": closes})


def test_compute_correlations_closed_bars_only() -> None:
    rng = np.random.default_rng(1)
    r = rng.normal(0, 0.001, 24 * 90)
    start = datetime(2024, 1, 1, tzinfo=UTC)
    frames = {"AAA": h1_frame(r, start), "BBB": h1_frame(r, start), "CCC": h1_frame(-r, start),
              "DDD": h1_frame(rng.normal(0, 0.001, len(r)), start), "EEE": h1_frame(r[:50], start)}
    as_of = start + timedelta(days=80)
    table = compute_correlations(frames, as_of, lookback_days=60)
    assert table.rho("AAA", "BBB") == pytest.approx(1.0)
    assert table.rho("CCC", "AAA") == pytest.approx(-1.0)
    assert abs(table.rho("AAA", "DDD") or 1.0) < 0.2
    assert table.rho("AAA", "EEE") is None  # too little history
    shocked = dict(frames)
    later = frames["BBB"].copy()
    later.loc[later["time_open_utc"] >= pd.Timestamp(as_of), "close"] *= 1.5  # data after as_of must not matter
    shocked["BBB"] = later
    assert compute_correlations(shocked, as_of, 60).rho("AAA", "BBB") == pytest.approx(1.0)


# ----------------------------------------------------------------------------- risk manager


def account(balance: float = 10_000.0, equity: float = 10_000.0, hedging: bool = True) -> AccountSnapshot:
    return AccountSnapshot(1, "Demo", "USD", AccountTradeMode.DEMO, balance, equity, 0.0, equity, 500, True, True,
                           hedging, T)


def context(open_positions: list[RiskExposure] | None = None, **kw: object) -> RiskContext:
    args: dict[str, object] = dict(account=account(), spec=spec(), loss_per_lot=155.0, margin_per_lot=220.0,
                                   open_positions=open_positions or [], correlations=CorrelationTable.empty())
    args.update(kw)
    return RiskContext(**args)  # type: ignore[arg-type]


SIGNAL = SignalEngine(SETTINGS.scoring).score(evaluate())
MANAGER = RiskManager(SETTINGS.risk, SETTINGS.correlation, SETTINGS.costs)


def test_risk_manager_approves_worked_example() -> None:
    a = MANAGER.assess(SIGNAL, context(), rr_net=1.835)
    d = a.decision
    assert a.approved and d.volume == 0.30 and d.risk_amount == pytest.approx(48.60)
    assert d.risk_pct == pytest.approx(0.486) and d.rr_gross == pytest.approx(2.0) and d.rr_net == 1.835
    assert [name for name, _, _ in a.checks] == ["max_open_positions", "max_positions_per_symbol", "sizing",
                                                 "currency_exposure", "correlated_exposure"]


def test_risk_manager_portfolio_limits_all_reported() -> None:
    table = CorrelationTable(T, {("EURUSD", "USDJPY"): 0.0, ("EURUSD", "AUDNZD"): 0.0, ("EURUSD", "CADCHF"): 0.0})
    book = [x("USDJPY", LONG, 0.1), x("AUDNZD", LONG, 0.1), x("CADCHF", LONG, 0.1)]
    a = MANAGER.assess(SIGNAL, context(book, correlations=table), 1.8)
    assert not a.approved and a.decision.volume == 0
    assert [n for n, ok, _ in a.checks if not ok] == ["max_open_positions"]
    b = MANAGER.assess(SIGNAL, context([x("EURUSD", SHORT, 0.1)], correlations=table), 1.8)
    assert [n for n, ok, _ in b.checks if not ok] == ["max_positions_per_symbol"]
    c = MANAGER.assess(SIGNAL, context(account=account(balance=150.0, equity=150.0)), 1.8)
    assert [n for n, ok, _ in c.checks if not ok] == ["sizing"] and c.decision.reasons


def test_netting_account_allows_one_position_per_symbol() -> None:
    manager = RiskManager(SETTINGS.risk.model_copy(update={"max_positions_per_symbol": 2}), SETTINGS.correlation,
                          SETTINGS.costs)
    hedged = manager.assess(SIGNAL, context([x("EURUSD", LONG, 0.1)]), 1.8)
    netted = manager.assess(SIGNAL, context([x("EURUSD", LONG, 0.1)], account=account(hedging=False)), 1.8)
    assert next(ok for n, ok, _ in hedged.checks if n == "max_positions_per_symbol")
    assert not next(ok for n, ok, _ in netted.checks if n == "max_positions_per_symbol")


def test_drawdown_reduction_only_lowers_risk() -> None:
    cfg = SETTINGS.risk.model_copy(update={"drawdown_risk_reduction": DrawdownReductionCfg(
        enabled=True, drawdown_pct_threshold=4.0, risk_multiplier=0.5)})
    manager = RiskManager(cfg, SETTINGS.correlation, SETTINGS.costs)
    assert manager.assess(SIGNAL, context(drawdown_pct=3.9), 1.8).decision.volume == 0.30
    reduced = manager.assess(SIGNAL, context(drawdown_pct=5.0), 1.8)
    assert reduced.decision.volume == 0.15 and "risk reduced to 0.25%" in reduced.decision.reasons[0]
    assert MANAGER.risk_pct(50.0) == SETTINGS.risk.risk_per_trade_pct  # disabled by default
