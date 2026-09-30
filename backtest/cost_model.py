"""Backtest prices and costs (ARCHITECTURE §11.1).

* MT5 bars are BID bars. The ask is bid + spread, where the spread of a bar is
  max(bar spread field, symbol.backtest_min_spread_points): the MT5 field is often the MINIMUM spread
  of the bar, so it is only a floor.
* Commission per lot per side and a fixed expected slippage come from ``costs`` in the config.
* A cost multiplier (1.5, 2.0) scales spread, commission and slippage together for stress tests.
* Profit in a foreign currency is converted to the account currency with the historical price of
  the conversion pair at that moment (e.g. AUDUSD for EURAUD in a USD account).
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

import numpy as np
import pandas as pd

MINUTE_NS = 60_000_000_000


def to_ns(t: datetime) -> int:
    return int(pd.Timestamp(t).value)


def from_ns(ns: int) -> datetime:
    return pd.Timestamp(ns, tz="UTC").to_pydatetime()


@dataclass(frozen=True, slots=True)
class CostModel:
    commission_per_lot_side: float  # account currency
    slippage_points: float
    multiplier: float = 1.0

    def commission(self, volume: float) -> float:
        """Commission for ONE side of a trade of ``volume`` lots (positive number)."""
        return self.commission_per_lot_side * self.multiplier * volume

    def commission_round_trip_per_lot(self) -> float:
        return 2.0 * self.commission_per_lot_side * self.multiplier

    def slippage_price(self, point: float) -> float:
        return self.slippage_points * self.multiplier * point


class PriceSeries:
    """One symbol's M1 bid bars as numpy arrays, with the modelled spread (price) per bar."""

    def __init__(self, symbol: str, m1: pd.DataFrame, point: float, min_spread_points: float, multiplier: float,
                 typical_window_minutes: int) -> None:
        self.symbol = symbol
        self.point = point
        times = pd.to_datetime(m1["time_open_utc"], utc=True)
        self.times = times.astype("int64").to_numpy() if times.dt.unit == "ns" else times.dt.as_unit("ns").astype(
            "int64").to_numpy()
        self.open = m1["open"].to_numpy(float)
        self.high = m1["high"].to_numpy(float)
        self.low = m1["low"].to_numpy(float)
        self.close = m1["close"].to_numpy(float)
        raw = m1["spread_points"].to_numpy(float) if "spread_points" in m1 else np.zeros(len(m1))
        self.spread_points = np.maximum(raw, float(min_spread_points)) * multiplier
        self.spread = self.spread_points * point
        # typical spread = rolling median of the modelled spread over the configured window (trailing only)
        rolled = pd.Series(self.spread_points, index=times).rolling(f"{typical_window_minutes}min").median()
        self.typical_points = rolled.to_numpy(float)

    def __len__(self) -> int:
        return len(self.times)

    def first_at_or_after(self, t_ns: int) -> int:
        return int(np.searchsorted(self.times, t_ns, side="left"))

    def last_closed(self, t_ns: int) -> int:
        """Index of the last bar whose close (open + 1 min) is <= t, or -1."""
        return int(np.searchsorted(self.times, t_ns - MINUTE_NS, side="right")) - 1


class Converter:
    """Account-currency value of one unit of another currency at a moment in time."""

    def __init__(self, account_currency: str, series: dict[str, PriceSeries]) -> None:
        self.account = account_currency
        self.series = series

    def rate(self, currency: str, t_ns: int) -> float:
        if currency == self.account:
            return 1.0
        direct, inverse = f"{currency}{self.account}", f"{self.account}{currency}"
        if direct in self.series:
            return self._price(direct, t_ns)
        if inverse in self.series:
            return 1.0 / self._price(inverse, t_ns)
        raise KeyError(f"no {direct} or {inverse} history to convert {currency} into {self.account}; "
                       "run `python main.py download-data` (it downloads conversion pairs)")

    def available(self, currency: str) -> bool:
        return currency == self.account or f"{currency}{self.account}" in self.series or \
            f"{self.account}{currency}" in self.series

    def _price(self, symbol: str, t_ns: int) -> float:
        s = self.series[symbol]
        i = s.last_closed(t_ns)
        return float(s.close[max(i, 0)])
