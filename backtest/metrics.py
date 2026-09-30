"""Performance statistics and the STRATEGY §0 falsification verdict.

R = the trade's net result divided by the money it risked at entry (so -1 R is a full stop-loss).
Expectancy = average R per trade; its t-statistic = mean / (standard deviation / sqrt(n)).
"""

from __future__ import annotations

import math
from collections.abc import Callable, Iterable, Sequence
from dataclasses import asdict, dataclass
from datetime import datetime

import numpy as np
import pandas as pd

from core.types import ClosedTrade

# STRATEGY §0 — decided before any test was run
MIN_EXPECTANCY_R = 0.05
MIN_T_STAT = 2.0
MIN_DEV_TRADES = 300


@dataclass(frozen=True)
class Stats:
    trades: int
    win_rate: float
    expectancy_r: float
    std_r: float
    t_stat: float
    total_r: float
    avg_win_r: float
    avg_loss_r: float
    profit_factor: float
    net_profit: float
    return_pct: float
    max_drawdown_pct: float
    longest_losing_streak: int
    avg_hold_hours: float
    trades_per_year: float
    sharpe_daily: float

    def as_dict(self) -> dict[str, float | int]:
        return {k: (round(v, 4) if isinstance(v, float) and math.isfinite(v) else v) for k, v in asdict(self).items()}


def _finite(x: float) -> float:
    return x if math.isfinite(x) else float("nan")


def trade_stats(trades: Sequence[ClosedTrade], initial_balance: float, equity_ns: np.ndarray | None = None,
                equity: np.ndarray | None = None, years: float | None = None) -> Stats:
    r = np.array([t.r_multiple for t in trades], dtype=float)
    net = np.array([t.net_pnl for t in trades], dtype=float)
    n = len(r)
    wins, losses = r[r > 0], r[r <= 0]
    std = float(r.std(ddof=1)) if n > 1 else float("nan")
    t_stat = float(r.mean() / (std / math.sqrt(n))) if n > 1 and std > 0 else float("nan")
    gross_win, gross_loss = float(net[net > 0].sum()), float(-net[net < 0].sum())
    streak = longest = 0
    for x in r:
        streak = streak + 1 if x < 0 else 0
        longest = max(longest, streak)
    holds = [(t.close_time_utc - t.open_time_utc).total_seconds() / 3600 for t in trades]
    dd = max_drawdown_pct(equity) if equity is not None and len(equity) else float("nan")
    sharpe = daily_sharpe(equity_ns, equity) if equity_ns is not None and equity is not None else float("nan")
    return Stats(
        trades=n, win_rate=float(len(wins) / n) if n else float("nan"),
        expectancy_r=float(r.mean()) if n else float("nan"), std_r=std, t_stat=t_stat,
        total_r=float(r.sum()), avg_win_r=float(wins.mean()) if len(wins) else float("nan"),
        avg_loss_r=float(losses.mean()) if len(losses) else float("nan"),
        profit_factor=_finite(gross_win / gross_loss) if gross_loss > 0 else float("inf") if gross_win > 0 else float("nan"),
        net_profit=float(net.sum()), return_pct=100.0 * float(net.sum()) / initial_balance,
        max_drawdown_pct=dd, longest_losing_streak=longest,
        avg_hold_hours=float(np.mean(holds)) if holds else float("nan"),
        trades_per_year=n / years if years else float("nan"), sharpe_daily=sharpe,
    )


def max_drawdown_pct(equity: np.ndarray) -> float:
    if len(equity) == 0:
        return float("nan")
    peak = np.maximum.accumulate(equity)
    return float(np.max((peak - equity) / peak) * 100.0)


def daily_sharpe(equity_ns: np.ndarray, equity: np.ndarray) -> float:
    """Annualised Sharpe of daily equity changes (days end at 17:00 New York), risk-free rate 0."""
    if len(equity) < 3:
        return float("nan")
    s = pd.Series(equity, index=pd.to_datetime(equity_ns, utc=True))
    # trading day = New York date after shifting the 17:00 roll to midnight (vectorised, DST-aware)
    days = (s.index.tz_convert("America/New_York") - pd.Timedelta(hours=17)).date
    daily = s.groupby(days).last()
    rets = daily.pct_change().dropna()
    if len(rets) < 2 or rets.std() == 0:
        return float("nan")
    return float(rets.mean() / rets.std() * math.sqrt(252))


def breakdown(trades: Sequence[ClosedTrade], key: Callable[[ClosedTrade], object]) -> list[dict[str, object]]:
    groups: dict[object, list[ClosedTrade]] = {}
    for t in trades:
        groups.setdefault(key(t), []).append(t)
    rows = []
    for k in sorted(groups, key=str):
        g = groups[k]
        r = np.array([t.r_multiple for t in g])
        rows.append({"group": str(k), "trades": len(g), "win_rate": round(float((r > 0).mean()), 3),
                     "expectancy_r": round(float(r.mean()), 3), "total_r": round(float(r.sum()), 2),
                     "net_profit": round(sum(t.net_pnl for t in g), 2)})
    return rows


def score_bucket(score: float | None) -> str:
    if score is None:
        return "n/a"
    if score >= 80:
        return "80+"
    if score >= 70:
        return "70-80"
    return "60-70"


# ----------------------------------------------------------------------------- verdict


@dataclass(frozen=True)
class Check:
    name: str
    rule: str
    value: str
    passed: bool | None  # None = not run


def falsification_checks(development: Stats | None, stress: Stats | None, validation: Stats | None,
                         stress_multiplier: float = 1.5) -> list[Check]:
    """STRATEGY §0: the edge is rejected if ANY of these fails. Thresholds were fixed before testing."""
    def fmt(x: float, digits: int = 3) -> str:
        return "n/a" if not math.isfinite(x) else f"{x:+.{digits}f}"

    checks = []
    if development is not None:
        d = development
        checks.append(Check("Development expectancy", f"> +{MIN_EXPECTANCY_R} R per trade", f"{fmt(d.expectancy_r)} R",
                            math.isfinite(d.expectancy_r) and d.expectancy_r > MIN_EXPECTANCY_R))
        checks.append(Check("Development t-statistic", f">= {MIN_T_STAT}", fmt(d.t_stat, 2),
                            math.isfinite(d.t_stat) and d.t_stat >= MIN_T_STAT))
        checks.append(Check("Development trade count", f">= {MIN_DEV_TRADES}", str(d.trades), d.trades >= MIN_DEV_TRADES))
    else:
        checks.append(Check("Development period", "must be run", "not run", None))
    checks.append(Check(f"Costs x{stress_multiplier:g} (development)", "expectancy > 0",
                        "not run" if stress is None else f"{fmt(stress.expectancy_r)} R",
                        None if stress is None else math.isfinite(stress.expectancy_r) and stress.expectancy_r > 0))
    checks.append(Check("Validation 2024 expectancy", "> 0",
                        "not run" if validation is None else f"{fmt(validation.expectancy_r)} R",
                        None if validation is None else math.isfinite(validation.expectancy_r)
                        and validation.expectancy_r > 0))
    return checks


def verdict_text(checks: Iterable[Check]) -> str:
    checks = list(checks)
    if any(c.passed is False for c in checks):
        return ("NO EDGE: S1 fails at least one pre-registered check. It must not be traded, and its settings must "
                "not be tuned until it passes (that is how backtests lie). Next: a new hypothesis.")
    if any(c.passed is None for c in checks):
        return "INCOMPLETE: run the missing checks (python main.py backtest --check)."
    return ("PASSES the STRATEGY §0 checks. That is necessary, not sufficient: next come walk-forward, Monte Carlo "
            "and robustness tests (STEP 12), then weeks of demo trading. Nothing here proves future profit.")


def years_between(start: datetime, end: datetime) -> float:
    return max((end - start).total_seconds() / (365.25 * 86400), 1e-9)
