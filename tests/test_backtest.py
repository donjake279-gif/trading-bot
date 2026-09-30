"""STEP 11 (fast-tracked) tests: broker facts, cost model, SimBroker fills, the backtest loop, metrics, reports.

Every money figure in the known-outcome tests is computed by hand in the comments.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import datetime, timedelta, timezone
from itertools import pairwise
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from backtest.backtester import Backtester, BacktestOptions, BacktestResult
from backtest.cost_model import Converter, CostModel, PriceSeries, to_ns
from backtest.metrics import (
    falsification_checks,
    max_drawdown_pct,
    trade_stats,
    verdict_text,
    years_between,
)
from backtest.reports import append_experiment, distinct_configs, write_outputs
from backtest.sim_broker import SimBroker, SimPosition, rollover_nights
from backtest.specs import (
    BrokerFacts,
    SwapTerms,
    load_broker_facts,
    save_broker_facts,
    standard_fx_spec,
)
from core.market_structure import AnalysisSnapshot
from core.strategy import MarketCosts, S1Evaluation
from core.types import ClosedTrade, Direction, ExitReason, Timeframe
from tests.test_strategy import SETTINGS, evaluate

UTC = timezone.utc
T_DEC = datetime(2024, 7, 16, 12, 45, tzinfo=UTC)  # the worked example's decision time (Tuesday, London/NY)
LONG, SHORT = Direction.LONG, Direction.SHORT


def m1(start: datetime, prices: list[tuple[float, float, float, float]], spread: int = 7) -> pd.DataFrame:
    times = pd.date_range(start, periods=len(prices), freq="1min", tz=UTC)
    o, h, lo, c = (np.array(x, dtype=float) for x in zip(*prices, strict=True))
    return pd.DataFrame({"time_open_utc": times, "open": o, "high": h, "low": lo, "close": c, "tick_volume": 10,
                         "spread_points": spread})


def flat(n: int, price: float) -> list[tuple[float, float, float, float]]:
    return [(price, price, price, price)] * n


def broker_for(df: pd.DataFrame, symbol: str = "EURUSD", multiplier: float = 1.0,
               swaps: SwapTerms | None = None) -> SimBroker:
    spec = standard_fx_spec(symbol)
    series = {symbol: PriceSeries(symbol, df, spec.point, 6, multiplier, 1440)}
    costs = CostModel(3.5, 2, multiplier)
    return SimBroker("USD", 100, {symbol: spec}, {symbol: swaps or SwapTerms()}, series, Converter("USD", series), costs, 10_000.0)


# ----------------------------------------------------------------------------- broker facts & costs


def test_standard_specs_and_saved_facts(tmp_path: Path) -> None:
    assert standard_fx_spec("USDJPY").digits == 3 and standard_fx_spec("EURUSD").point == pytest.approx(1e-5)
    missing = load_broker_facts(tmp_path, ["EURUSD"])
    assert missing.account_currency == "USD" and any("not found" in w for w in missing.warnings)
    spec = standard_fx_spec("GBPUSD")
    save_broker_facts(tmp_path / "symbol_specs.json", "EUR", 30, {"GBPUSD": spec},
                      {"GBPUSD": {"swap_mode": 1, "swap_long": -6.1, "swap_short": 1.2, "swap_rollover3days": 3}})
    facts = load_broker_facts(tmp_path, ["GBPUSD"])
    assert (facts.account_currency, facts.leverage) == ("EUR", 30)
    assert facts.specs["GBPUSD"] == spec and facts.swaps["GBPUSD"] == SwapTerms(1, -6.1, 1.2, 3)


def test_spread_floor_multiplier_and_conversion() -> None:
    df = m1(T_DEC, flat(3, 150.0), spread=4)
    s = PriceSeries("USDJPY", df, 0.001, 8, 1.5, 1440)
    assert s.spread_points.tolist() == [12.0, 12.0, 12.0]  # max(4, 8) x 1.5
    conv = Converter("USD", {"USDJPY": s})
    assert conv.rate("USD", to_ns(T_DEC)) == 1.0
    assert conv.rate("JPY", to_ns(T_DEC + timedelta(minutes=2))) == pytest.approx(1 / 150.0)  # inverse pair
    with pytest.raises(KeyError):
        conv.rate("AUD", to_ns(T_DEC))


def test_rollover_nights_and_triple_wednesday() -> None:
    ny = timezone(timedelta(hours=-4))  # EDT in July
    assert rollover_nights(datetime(2024, 7, 15, 10, tzinfo=ny), datetime(2024, 7, 15, 16, tzinfo=ny)) == 0
    assert rollover_nights(datetime(2024, 7, 15, 10, tzinfo=ny), datetime(2024, 7, 16, 10, tzinfo=ny)) == 1
    assert rollover_nights(datetime(2024, 7, 16, 10, tzinfo=ny), datetime(2024, 7, 18, 10, tzinfo=ny)) == 4  # Tue+Wed x3
    assert rollover_nights(datetime(2024, 7, 19, 10, tzinfo=ny), datetime(2024, 7, 22, 10, tzinfo=ny)) == 1  # Fri only


# ----------------------------------------------------------------------------- SimBroker fills


def open_long(b: SimBroker, sl: float = 1.09900, tp: float = 1.10300) -> SimPosition:
    pos = b.open_position("EURUSD", LONG, 0.30, sl, tp, T_DEC, risk_amount=50.0, risk_pct=0.5, signal_id="x",
                          strategy_version="S1 1.0.0")
    assert isinstance(pos, SimPosition)
    return pos


def test_long_take_profit_hand_computed() -> None:
    bars = flat(5, 1.10000) + [(1.1000, 1.10310, 1.1000, 1.1030)] + flat(5, 1.10300)
    b = broker_for(m1(T_DEC, bars))
    pos = open_long(b)
    # fill = bid open 1.10000 + spread max(7, 6) pts + slippage 2 pts = 1.10009
    assert pos.entry_price == pytest.approx(1.10009) and pos.entry_time == T_DEC
    assert pos.exit_reason is ExitReason.TAKE_PROFIT and pos.exit_price == 1.10300
    assert pos.exit_time == T_DEC + timedelta(minutes=6)  # the TP bar opened 12:50, counted at its close
    trade = b.settle(b.due_exits(pos.exit_time)[0])
    # gross (1.10300 - 1.10009) x 100,000 x 0.30 = 87.30; commission 3.5 x 0.30 x 2 = 2.10
    assert trade.gross_pnl == pytest.approx(87.30) and trade.commission == pytest.approx(-2.10)
    assert trade.net_pnl == pytest.approx(85.20) and b.balance == pytest.approx(10_085.20)
    assert trade.r_multiple == pytest.approx(85.20 / 50.0)
    assert trade.mfe_price == pytest.approx(1.10310 - 1.10009)


def test_stop_first_when_both_in_one_bar_and_stop_slippage() -> None:
    b = broker_for(m1(T_DEC, flat(3, 1.1) + [(1.1, 1.1040, 1.0980, 1.1)] + flat(3, 1.1)))
    pos = open_long(b)
    assert pos.exit_reason is ExitReason.STOP_LOSS and pos.exit_price == pytest.approx(1.09898)  # SL - 2 pts


def test_gap_through_stop_fills_at_the_open() -> None:
    b = broker_for(m1(T_DEC, flat(3, 1.1) + [(1.0970, 1.0975, 1.0960, 1.0970)] + flat(3, 1.097)))
    pos = open_long(b)
    assert pos.exit_price == pytest.approx(1.09698)  # open 1.0970 - slippage, worse than the stop
    assert pos.exit_time == T_DEC + timedelta(minutes=3)  # at the bar's open


def test_short_is_stopped_on_the_ask() -> None:
    # bid high 1.10095 never reaches the 1.10100 stop, but the ask (bid + 7 pts) does
    b = broker_for(m1(T_DEC, flat(2, 1.1) + [(1.1, 1.10095, 1.1, 1.1)] + flat(2, 1.1)))
    pos = b.open_position("EURUSD", SHORT, 0.1, 1.10100, 1.09800, T_DEC, risk_amount=10.0, risk_pct=0.1,
                          signal_id="s", strategy_version="v")
    assert isinstance(pos, SimPosition) and pos.entry_price == pytest.approx(1.09998)  # bid - slippage
    assert pos.exit_reason is ExitReason.STOP_LOSS and pos.exit_price == pytest.approx(1.10102)


def test_rejects_fill_beyond_stop_and_closed_market() -> None:
    b = broker_for(m1(T_DEC, flat(3, 1.0980)))
    assert "no valid stop" in str(b.open_position("EURUSD", LONG, 0.1, 1.0990, 1.1030, T_DEC, risk_amount=1,
                                                  risk_pct=0.1, signal_id="x", strategy_version="v"))
    assert b.open_position("EURUSD", LONG, 0.1, 1.0, 1.2, T_DEC + timedelta(hours=1), risk_amount=1, risk_pct=0.1,
                           signal_id="x", strategy_version="v") == "market closed"
    assert b.quote("EURUSD", T_DEC - timedelta(hours=1)) is None


def test_equity_marks_open_positions_and_end_of_test_close() -> None:
    b = broker_for(m1(T_DEC, flat(2, 1.1) + flat(8, 1.1005)))
    pos = open_long(b)
    assert pos.exit_reason is ExitReason.END_OF_TEST
    # after the entry commission (1.05), floating (1.1005 - 1.10009) x 30,000 = 12.30
    assert b.equity(T_DEC + timedelta(minutes=5)) == pytest.approx(10_000 - 1.05 + 12.30)
    trades = b.close_at_end(T_DEC + timedelta(minutes=6))
    assert trades[0].exit_reason is ExitReason.END_OF_TEST and b.balance == pytest.approx(10_000 - 2.10 + 12.30)


def test_swap_in_points_with_conversion() -> None:
    start = datetime(2024, 7, 16, 20, 50, tzinfo=UTC)  # 16:50 New York
    bars = flat(20, 1.1) + [(1.1, 1.1031, 1.1, 1.103)]
    b = broker_for(m1(start, bars), swaps=SwapTerms(1, -6.0, 1.0, 3))
    pos = b.open_position("EURUSD", LONG, 1.0, 1.099, 1.103, start, risk_amount=100, risk_pct=1, signal_id="x",
                          strategy_version="v")
    assert isinstance(pos, SimPosition)
    trade = b.settle(pos)
    assert trade.swap == pytest.approx(-6.0 * 1e-5 * 100_000)  # one 17:00 roll: -6 points on 1 lot = -6 USD


# ----------------------------------------------------------------------------- the backtest loop


class ScriptedS1:
    """Stands in for S1: emits the STRATEGY §8 worked-example setup once, at T_DEC, on EURUSD."""

    def __init__(self) -> None:
        self.setup = evaluate()

    def triggered(self, snap: AnalysisSnapshot) -> bool:
        return snap.decision_time == T_DEC and snap.symbol == "EURUSD"

    def evaluate(self, snap: AnalysisSnapshot, frames: Mapping[Timeframe, pd.DataFrame],
                 market: MarketCosts) -> list[S1Evaluation]:
        return [self.setup] if self.triggered(snap) else []


def scripted_run(move: list[tuple[float, float, float, float]]) -> tuple[Backtester, BacktestResult]:
    start = T_DEC - timedelta(days=2)
    minutes_before = int((T_DEC - start).total_seconds() // 60)
    bars = flat(minutes_before, 1.10373) + flat(30, 1.10373) + move + flat(60, move[-1][3])
    facts = BrokerFacts("USD", 100, {"EURUSD": standard_fx_spec("EURUSD")}, {"EURUSD": SwapTerms()}, ())
    opts = BacktestOptions(T_DEC - timedelta(hours=1), T_DEC + timedelta(hours=3), ("EURUSD",), label="scripted")
    bt = Backtester(SETTINGS, {"EURUSD": m1(start, bars)}, facts, opts, strategy=ScriptedS1())
    return bt, bt.run()


def test_known_outcome_winning_trade_through_the_whole_loop() -> None:
    bt, res = scripted_run([(1.10373, 1.10700, 1.10370, 1.10690)])
    assert len(res.trades) == 1 and len(res.decisions) == 1 and res.decisions[0]["outcome"] == "filled"
    t = res.trades[0]
    # risk manager: 155 USD loss at the stop + 7 commission per lot -> 0.30 lots risking 48.60
    assert t.volume == 0.30 and t.risk_amount == pytest.approx(48.60)
    # fill at the 12:45 open: bid 1.10373 + 7 pts spread + 2 pts slippage = 1.10382
    assert t.entry_price == pytest.approx(1.10382) and t.exit_reason is ExitReason.TAKE_PROFIT
    # (1.10690 - 1.10382) x 100,000 x 0.30 = 92.40 gross; minus 2.10 commission = 90.30 = 1.858 R
    assert t.net_pnl == pytest.approx(90.30) and t.r_multiple == pytest.approx(90.30 / 48.60)
    assert res.final_balance == pytest.approx(10_090.30)
    assert res.trade_info[t.trade_id]["score"] == pytest.approx(87.34, abs=0.01)
    assert bt.cooldown.consumed == {evaluate().candidate.setup_id}  # type: ignore[union-attr]


def test_known_outcome_losing_trade() -> None:
    _, res = scripted_run([(1.10373, 1.10373, 1.10200, 1.10210)])
    t = res.trades[0]
    # stop 1.10225 slips 2 pts to 1.10223: (1.10223 - 1.10382) x 30,000 = -47.70; minus 2.10 = -49.80
    assert t.exit_reason is ExitReason.STOP_LOSS and t.net_pnl == pytest.approx(-49.80)
    assert t.r_multiple == pytest.approx(-49.80 / 48.60)


def synth(start: datetime, days: int, seed: int, price: float) -> pd.DataFrame:
    """Random walk with 4-hour drift regimes; FX weekend hours removed."""
    n = 1440 * days
    rng = np.random.default_rng(seed)
    scale = price / 1.1
    drift = np.repeat(rng.normal(0, 0.00004, n // 240 + 1), 240)[:n] * scale
    close = price + np.cumsum(rng.normal(0, 0.00012 * scale, n) + drift)
    open_ = np.concatenate([[close[0]], close[:-1]])
    high = np.maximum(open_, close) + np.abs(rng.normal(0, 0.00008 * scale, n))
    low = np.minimum(open_, close) - np.abs(rng.normal(0, 0.00008 * scale, n))
    t = pd.date_range(start, periods=n, freq="1min", tz=UTC)
    ny = t.tz_convert("America/New_York")
    closed = (ny.weekday == 5) | ((ny.weekday == 4) & (ny.hour >= 17)) | ((ny.weekday == 6) & (ny.hour < 17))
    df = pd.DataFrame({"time_open_utc": t, "open": open_, "high": high, "low": low, "close": close,
                       "tick_volume": rng.integers(1, 50, n), "spread_points": rng.integers(2, 12, n)})
    return df[~closed].reset_index(drop=True)


@pytest.fixture(scope="module")
def real_run() -> BacktestResult:
    start = datetime(2023, 1, 2, tzinfo=UTC)
    data = {"EURUSD": synth(start, 75, 1, 1.10), "GBPUSD": synth(start, 75, 2, 1.27), "USDJPY": synth(start, 75, 3, 150)}
    facts = BrokerFacts("USD", 100, {s: standard_fx_spec(s) for s in data}, {s: SwapTerms(1, -5, 1, 3) for s in data},
                        ())
    opts = BacktestOptions(start + timedelta(days=25), start + timedelta(days=75), tuple(data), label="synthetic",
                           structure_warmup_bars=200)
    return Backtester(SETTINGS, data, facts, opts).run()


def test_real_pipeline_accounting_and_rules(real_run: BacktestResult) -> None:
    res = real_run
    trades: list[ClosedTrade] = res.trades
    assert len(trades) >= 5 and res.triggers > len(res.decisions) >= len(trades)
    assert res.final_balance == pytest.approx(res.initial_balance + sum(t.net_pnl for t in trades))
    budget = SETTINGS.risk.risk_per_trade_pct / 100 * 1.001
    info = res.trade_info
    for t in trades:
        assert t.risk_amount <= budget * 12_000  # never more than 0.5 % of an equity this test cannot exceed
        assert t.open_time_utc >= info[t.trade_id]["decision_time"]  # fills never precede the decision
        assert info[t.trade_id]["session"] in ("london", "new_york", "overlap_london_ny")
        if t.exit_reason is ExitReason.STOP_LOSS and t.close_time_utc.weekday() not in (6, 0):
            assert -1.3 < t.r_multiple < -0.95  # a stop costs ~1 R plus commission and slippage
        if t.exit_reason is ExitReason.TAKE_PROFIT:
            assert t.r_multiple > 1.0
    by_symbol: dict[str, list[ClosedTrade]] = {}
    for t in trades:
        by_symbol.setdefault(t.symbol, []).append(t)
    for group in by_symbol.values():  # one position per symbol, 30-minute pause after every close
        group.sort(key=lambda t: t.open_time_utc)
        for a, b in pairwise(group):
            assert b.open_time_utc >= a.close_time_utc + timedelta(minutes=SETTINGS.cooldown.minutes_after_close)
    fills = [d["setup_id"] for d in res.decisions if d["outcome"] == "filled"]
    assert len(fills) == len(set(fills)) == len(trades)


# ----------------------------------------------------------------------------- metrics & reports


def closed(r: float, day: int, risk: float = 50.0) -> ClosedTrade:
    t = datetime(2024, 1, day, 10, tzinfo=UTC)
    return ClosedTrade(f"t{day}", "s", "v", "EURUSD", LONG, t, t + timedelta(hours=2), 1.1, 1.1, 1.09, 1.12, 0.1, risk,
                       0.5, gross_pnl=r * risk, commission=0.0, swap=0.0, mfe_price=0.0, mae_price=0.0,
                       exit_reason=ExitReason.TAKE_PROFIT if r > 0 else ExitReason.STOP_LOSS)


def test_trade_stats_hand_computed() -> None:
    trades = [closed(r, i + 1) for i, r in enumerate([2, -1, 2, -1, -1])]
    s = trade_stats(trades, 10_000, years=1.0)
    assert s.trades == 5 and s.win_rate == pytest.approx(0.4) and s.expectancy_r == pytest.approx(0.2)
    std = float(np.std([2, -1, 2, -1, -1], ddof=1))
    assert s.t_stat == pytest.approx(0.2 / (std / np.sqrt(5)))
    assert s.profit_factor == pytest.approx(200 / 150) and s.longest_losing_streak == 2
    assert s.net_profit == pytest.approx(50) and s.return_pct == pytest.approx(0.5)
    assert max_drawdown_pct(np.array([100, 110, 99, 120, 90.0])) == pytest.approx(25.0)


def test_falsification_checks() -> None:
    good = trade_stats([closed(r, (i % 28) + 1) for i, r in enumerate([2.0, -1.0, 2.0] * 120)], 10_000, years=4)
    bad = trade_stats([closed(r, i + 1) for i, r in enumerate([-1.0, 1.0, -1.0])], 10_000)
    checks = falsification_checks(good, good, good)
    assert all(c.passed for c in checks) and "PASSES" in verdict_text(checks)
    checks = falsification_checks(good, bad, good)
    assert [c.passed for c in checks].count(False) == 1 and "NO EDGE" in verdict_text(checks)
    assert "INCOMPLETE" in verdict_text(falsification_checks(good, None, None))


def test_reports_and_experiment_log(tmp_path: Path, real_run: BacktestResult) -> None:
    res = real_run
    stats = trade_stats(res.trades, res.initial_balance, res.equity_ns, res.equity,
                        years_between(res.options.start, res.options.end))
    paths = write_outputs(res, stats, tmp_path / "run", falsification_checks(stats, None, None))
    summary = json.loads(paths["summary.json"].read_text())
    assert summary["stats"]["trades"] == stats.trades
    assert summary["verdict"].startswith("NO EDGE")  # 13 trades < 300: a failed check outranks the missing runs
    assert {c["name"]: c["passed"] for c in summary["checks"]}["Development trade count"] is False
    assert len(pd.read_csv(paths["trades.csv"])) == stats.trades
    assert "S1 backtest" in paths["report.html"].read_text(encoding="utf-8")
    log = tmp_path / "experiments.jsonl"
    assert append_experiment(log, res, stats) == 1 and append_experiment(log, res, stats) == 2  # type: ignore[arg-type]
    assert distinct_configs(log) == 1


def test_cli_seals_final_oos_and_reports_missing_history() -> None:
    from main import main

    assert main(["backtest", "--period", "final_oos"]) == 2
    assert main(["backtest", "--symbols", "NOPE"]) == 2


def test_user_flow_from_parquet_files_to_report(tmp_path: Path) -> None:
    """What `python main.py backtest` does on your PC: parquet history + saved broker facts -> report files."""
    from app.backtest_cmd import run_backtest

    root = tmp_path
    hist = root / "data" / "history"
    start = datetime(2022, 12, 20, tzinfo=UTC)
    for sym, seed, price in (("EURUSD", 1, 1.10), ("USDJPY", 3, 150.0)):
        df = synth(start, 70, seed, price)
        (hist / sym).mkdir(parents=True)
        for year, part in df.groupby(df["time_open_utc"].dt.year):
            part.to_parquet(hist / sym / f"M1_{year}.parquet", index=False)
    save_broker_facts(hist / "symbol_specs.json", "USD", 500,
                      {s: standard_fx_spec(s) for s in ("EURUSD", "USDJPY")}, {})
    code = run_backtest(SETTINGS, root, period="development", symbols=["EURUSD", "USDJPY"], cost_multiplier=1.0,
                        start=datetime(2023, 2, 15, tzinfo=UTC), end=datetime(2023, 3, 1, tzinfo=UTC), check=False)
    assert code == 0
    runs = [p for p in (root / "reports").iterdir() if p.is_dir()]
    assert len(runs) == 1 and (runs[0] / "report.html").exists() and (runs[0] / "trades.csv").exists()
    assert (root / "reports" / "experiments.jsonl").read_text().count("\n") == 1
    assert run_backtest(SETTINGS, root / "empty", period="development", symbols=["EURUSD"], cost_multiplier=1.0,
                        start=None, end=None, check=False) == 1  # no history -> a clear message, exit 1
