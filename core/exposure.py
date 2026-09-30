"""Currency-leg and correlation exposure (pure, architecture layer L2). Spec: ARCHITECTURE §6.6.

* Currency legs: each position is split into signed currency legs weighted by its risk
  (long EURUSD at 0.5 % risk -> EUR +0.5, USD -0.5). After adding a candidate, the absolute net
  risk per currency must stay <= ``max_currency_risk_pct``.
* Correlation: for a candidate c, the risk of every open position i with |rho(c, i)| >= threshold
  whose EFFECTIVE direction sign(rho) × dir_i equals dir_c, plus the candidate's own risk, must stay
  <= ``max_correlated_risk_pct``. rho = Pearson correlation of H1 log returns over the lookback,
  from closed bars only. An unknown rho counts as fully correlated in the same direction (fail closed).
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from core.types import Direction

MIN_RETURNS_FOR_CORRELATION = 100


@dataclass(frozen=True, slots=True)
class RiskExposure:
    """Risk that one (open or proposed) position puts on the book, in % of the equity base."""

    symbol: str
    direction: Direction
    risk_pct: float
    base_ccy: str
    quote_ccy: str


def currency_legs(positions: Iterable[RiskExposure]) -> dict[str, float]:
    legs: dict[str, float] = {}
    for p in positions:
        sign = int(p.direction)
        legs[p.base_ccy] = legs.get(p.base_ccy, 0.0) + sign * p.risk_pct
        legs[p.quote_ccy] = legs.get(p.quote_ccy, 0.0) - sign * p.risk_pct
    return legs


def check_currency_exposure(open_positions: Iterable[RiskExposure], candidate: RiskExposure,
                            max_pct: float) -> tuple[bool, str, dict[str, float]]:
    legs = currency_legs([*open_positions, candidate])
    touched = {c: legs[c] for c in (candidate.base_ccy, candidate.quote_ccy)}
    worst = max(touched, key=lambda c: abs(touched[c]))
    ok = abs(touched[worst]) <= max_pct + 1e-9
    reason = (f"net {worst} risk {touched[worst]:+.2f}% " + ("within" if ok else "exceeds")
              + f" the {max_pct:g}% currency limit")
    return ok, reason, {f"net_{c}": round(v, 6) for c, v in touched.items()}


# ----------------------------------------------------------------------------- correlation


@dataclass(frozen=True, slots=True)
class CorrelationTable:
    """Pairwise correlations of H1 log returns, computed from bars closed at or before ``as_of``."""

    as_of: datetime | None
    values: Mapping[tuple[str, str], float]

    def rho(self, a: str, b: str) -> float | None:
        if a == b:
            return 1.0
        return self.values.get((a, b), self.values.get((b, a)))

    @classmethod
    def empty(cls) -> CorrelationTable:
        return cls(None, {})


def compute_correlations(h1: Mapping[str, pd.DataFrame], as_of: datetime, lookback_days: int,
                         bar: timedelta = timedelta(hours=1)) -> CorrelationTable:
    """Pearson correlation of log returns of CLOSED H1 bars in (as_of - lookback, as_of].

    Pairs with fewer than MIN_RETURNS_FOR_CORRELATION common returns are left out (unknown)."""
    start = pd.Timestamp(as_of - timedelta(days=lookback_days))
    end = pd.Timestamp(as_of) - pd.Timedelta(bar)  # last bar whose close is <= as_of
    returns: dict[str, pd.Series] = {}
    for symbol, df in h1.items():
        if df.empty:
            continue
        times = df["time_open_utc"]
        window = df[(times >= start) & (times <= end)]
        closes = pd.Series(window["close"].to_numpy(float), index=window["time_open_utc"])
        returns[symbol] = np.log(closes).diff().dropna()
    values: dict[tuple[str, str], float] = {}
    names = sorted(returns)
    for i, a in enumerate(names):
        for b in names[i + 1:]:
            joined = pd.concat([returns[a], returns[b]], axis=1, join="inner").dropna()
            if len(joined) < MIN_RETURNS_FOR_CORRELATION:
                continue
            rho = float(np.corrcoef(joined.iloc[:, 0], joined.iloc[:, 1])[0, 1])
            if np.isfinite(rho):
                values[(a, b)] = rho
    return CorrelationTable(as_of, values)


def check_correlated_exposure(open_positions: Iterable[RiskExposure], candidate: RiskExposure,
                              table: CorrelationTable, threshold: float,
                              max_pct: float) -> tuple[bool, str, dict[str, float | str]]:
    total = candidate.risk_pct
    counted: list[str] = []
    for p in open_positions:
        rho = table.rho(candidate.symbol, p.symbol)
        if rho is None:
            same_way, label = True, f"{p.symbol}(rho unknown)"
        else:
            same_way = abs(rho) >= threshold and (1 if rho > 0 else -1) * int(p.direction) == int(candidate.direction)
            label = f"{p.symbol}(rho {rho:+.2f})"
        if same_way:
            total += p.risk_pct
            counted.append(label)
    ok = total <= max_pct + 1e-9
    reason = (f"correlated risk {total:.2f}% " + ("within" if ok else "exceeds") + f" the {max_pct:g}% limit"
              + (f" with {', '.join(counted)}" if counted else ""))
    return ok, reason, {"correlated_risk_pct": round(total, 6), "counted": ", ".join(counted)}
