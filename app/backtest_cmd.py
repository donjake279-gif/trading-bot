"""`python main.py backtest` — replay downloaded history through the strategy (research only, never trades).

    python main.py backtest                       development period 2020–2023, all symbols
    python main.py backtest --costs 1.5           cost stress test
    python main.py backtest --period validation   2024
    python main.py backtest --check               the three STRATEGY §0 checks + verdict

The final out-of-sample period (2025 onward) is SEALED: it can only be opened once, for a frozen
configuration, in STEP 12 (ARCHITECTURE §11.2).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from pathlib import Path

from backtest.backtester import Backtester, BacktestOptions, BacktestResult
from backtest.metrics import Stats, falsification_checks, trade_stats, years_between
from backtest.reports import (
    append_experiment,
    checks_table,
    console_summary,
    distinct_configs,
    write_outputs,
)
from core.config import Settings

UTC = timezone.utc
STRESS_MULTIPLIER = 1.5  # STRATEGY §0


def _bounds(settings: Settings, period: str) -> tuple[datetime, datetime]:
    p = getattr(settings.backtest.splits, period)
    assert isinstance(p.end, date)  # only final_oos may be 'latest'
    return (datetime.combine(p.start, datetime.min.time(), UTC),
            datetime.combine(p.end + timedelta(days=1), datetime.min.time(), UTC))


def run_backtest(settings: Settings, project_root: Path, *, period: str, symbols: list[str] | None,
                 cost_multiplier: float, start: datetime | None, end: datetime | None, check: bool,
                 open_report: bool = False) -> int:
    symbols = symbols or settings.symbol_names
    unknown = sorted(set(symbols) - set(settings.symbol_names))
    if unknown:
        print(f"Unknown symbols (not in config/settings.yaml): {', '.join(unknown)}")
        return 2
    plan = ([("development", 1.0), ("development", STRESS_MULTIPLIER), ("validation", 1.0)] if check
            else [(period, cost_multiplier)])
    stamp = datetime.now(UTC).strftime("%Y%m%d_%H%M%S")
    reports = project_root / "reports"
    log = reports / "experiments.jsonl"
    done: dict[tuple[str, float], tuple[BacktestResult, Stats, Path]] = {}
    for name, mult in plan:
        lo, hi = _bounds(settings, name)
        if not check:
            lo, hi = max(lo, start or lo), min(hi, end or hi)
            if lo >= hi:
                print(f"--start/--end must overlap the {name} period {lo.date()} .. {hi.date()}")
                return 2
        options = BacktestOptions(lo, hi, tuple(symbols), mult, label=f"{name} costs x{mult:g}")
        print(f"\nRunning {options.label}: {lo.date()} -> {hi.date()} ({', '.join(symbols)}). "
              "This takes a few minutes per year of data.")
        try:
            bt = Backtester.from_history(settings, project_root, options, progress=lambda m: print("  " + m, flush=True))
        except FileNotFoundError as exc:
            print(f"ERROR: {exc}\nDownload history first: 2_download_history.bat (MetaTrader 5 must be open).")
            return 1
        except (KeyError, ValueError) as exc:
            print(f"ERROR: {exc}")
            return 1
        result = bt.run()
        stats = trade_stats(result.trades, result.initial_balance, result.equity_ns, result.equity,
                            years_between(lo, hi))
        out = reports / f"{stamp}_{name}_costs_x{mult:g}"
        paths = write_outputs(result, stats, out)
        append_experiment(log, result, stats)
        print(console_summary(result, stats))
        print(f"  report: {paths['report.html']}")
        done[(name, mult)] = (result, stats, out)
    if check:
        dev, stress, val = (done[k][1] for k in (("development", 1.0), ("development", STRESS_MULTIPLIER),
                                                 ("validation", 1.0)))
        checks = falsification_checks(dev, stress, val, STRESS_MULTIPLIER)
        text = checks_table(checks)
        print(text)
        result, stats, out = done[("development", 1.0)]
        paths = write_outputs(result, stats, out, checks)  # the development report carries the verdict
        (reports / f"{stamp}_S1_verdict.txt").write_text(text + "\n", encoding="utf-8")
        print(f"\nFull report with the verdict: {paths['report.html']}")
    if open_report and done:
        import webbrowser

        target = done[("development", 1.0)][2] if check else next(iter(done.values()))[2]
        webbrowser.open((target / "report.html").resolve().as_uri())
    n = distinct_configs(log)
    print(f"\nConfigurations tested so far: {n}. Every extra configuration tried raises the chance that a good "
          "result is luck (ARCHITECTURE §11.3).")
    return 0
