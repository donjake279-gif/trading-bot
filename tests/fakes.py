"""A minimal in-memory stand-in for the MetaTrader5 module, for tests on any OS.

Times given to the fake are TRUE UTC; the fake encodes them as broker server wall time
(ny_close rule) exactly like a real MT5 terminal would.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from typing import Any

import numpy as np

from core.timeutils import BrokerTimeRule

UTC = timezone.utc
RULE = BrokerTimeRule.parse("ny_close")
RATE_DTYPE = [("time", "<i8"), ("open", "<f8"), ("high", "<f8"), ("low", "<f8"), ("close", "<f8"),
              ("tick_volume", "<u8"), ("spread", "<i4"), ("real_volume", "<u8")]


def server_seconds(ts_utc: datetime) -> int:
    return int(RULE.utc_to_server_naive(ts_utc).replace(tzinfo=UTC).timestamp())


class FakeMT5:
    TIMEFRAME_M1, TIMEFRAME_M5, TIMEFRAME_M15, TIMEFRAME_M30 = 1, 5, 15, 30
    TIMEFRAME_H1, TIMEFRAME_H4, TIMEFRAME_D1 = 1 | 0x4000, 4 | 0x4000, 24 | 0x4000
    ACCOUNT_MARGIN_MODE_RETAIL_HEDGING = 2
    SYMBOL_TRADE_MODE_FULL = 4
    POSITION_TYPE_BUY, POSITION_TYPE_SELL = 0, 1
    ORDER_TYPE_BUY, ORDER_TYPE_SELL = 0, 1
    DEAL_TYPE_BUY, DEAL_TYPE_SELL = 0, 1
    __version__ = "fake"

    def __init__(self) -> None:
        self.initialized = False
        self.fail_next: set[str] = set()
        self.error = (1, "Success")
        self.account = SimpleNamespace(login=12345, server="Fake-Demo", currency="USD", trade_mode=0, balance=10000.0,
                                       equity=10000.0, margin=0.0, margin_free=10000.0, leverage=500, trade_allowed=True,
                                       trade_expert=True, margin_mode=2)
        self.symbols: dict[str, SimpleNamespace] = {}
        self.ticks: dict[str, SimpleNamespace] = {}
        self.rates: dict[tuple[str, int], np.ndarray] = {}
        self.positions: list[SimpleNamespace] = []
        self.deals: list[SimpleNamespace] | None = []
        self.selected: set[str] = set()

    # --- helpers for tests
    def add_symbol(self, name: str, digits: int = 5, profit_ccy: str = "USD", base: str = "EUR", trade_mode: int = 4) -> None:
        point = 10 ** -digits
        self.symbols[name] = SimpleNamespace(
            name=name, digits=digits, point=point, trade_tick_size=point, trade_contract_size=100000.0,
            volume_min=0.01, volume_max=100.0, volume_step=0.01, trade_stops_level=0, trade_freeze_level=0,
            currency_base=base, currency_profit=profit_ccy, currency_margin=base, trade_mode=trade_mode, filling_mode=3,
        )

    def set_tick(self, name: str, at_utc: datetime, bid: float, ask: float) -> None:
        s = server_seconds(at_utc)
        self.ticks[name] = SimpleNamespace(time=s, time_msc=s * 1000, bid=bid, ask=ask)

    def set_bars(self, name: str, tf: int, first_open_utc: datetime, minutes: int, n: int, start_price: float = 1.1) -> None:
        arr = np.zeros(n, dtype=RATE_DTYPE)
        for i in range(n):
            t = first_open_utc + timedelta(minutes=minutes * i)
            p = start_price + 0.0001 * i
            arr[i] = (server_seconds(t), p, p + 0.0003, p - 0.0002, p + 0.0001, 10 + i, 6, 0)
        self.rates[(name, tf)] = arr

    def _maybe_fail(self, name: str) -> bool:
        if name in self.fail_next:
            self.fail_next.discard(name)
            self.error = (-10004, "No IPC connection")
            return True
        return False

    # --- MetaTrader5 API surface used by MT5Gateway
    def initialize(self, **kwargs: Any) -> bool:
        if self._maybe_fail("initialize"):
            return False
        self.initialized = True
        return True

    def shutdown(self) -> None:
        self.initialized = False

    def last_error(self) -> tuple[int, str]:
        return self.error

    def version(self) -> tuple[int, int, str]:
        return (500, 6231, "fake")

    def terminal_info(self) -> Any:
        if self._maybe_fail("terminal_info"):
            return None
        return SimpleNamespace(connected=True, trade_allowed=False, company="Fake", path="C:/fake", maxbars=100000000)

    def account_info(self) -> Any:
        return None if self._maybe_fail("account_info") else self.account

    def symbol_info(self, name: str) -> Any:
        return self.symbols.get(name)

    def symbols_get(self, group: str | None = None) -> Any:
        return tuple(self.symbols.values())

    def symbol_select(self, name: str, enable: bool) -> bool:
        if name not in self.symbols:
            return False
        self.selected.add(name)
        return True

    def symbol_info_tick(self, name: str) -> Any:
        return None if self._maybe_fail("symbol_info_tick") else self.ticks.get(name)

    def copy_rates_from_pos(self, name: str, tf: int, start: int, count: int) -> Any:
        if self._maybe_fail("copy_rates_from_pos"):
            return None
        arr = self.rates.get((name, tf))
        if arr is None:
            return None
        end = len(arr) - start
        return arr[max(0, end - count):end]

    def copy_rates_range(self, name: str, tf: int, date_from: datetime, date_to: datetime) -> Any:
        arr = self.rates.get((name, tf))
        if arr is None:
            return None
        lo, hi = int(date_from.timestamp()), int(date_to.timestamp())
        return arr[(arr["time"] >= lo) & (arr["time"] <= hi)]

    def positions_get(self) -> Any:
        return None if self._maybe_fail("positions_get") else tuple(self.positions)

    def history_deals_get(self, date_from: datetime, date_to: datetime) -> Any:
        if self.deals is None:
            return None
        return tuple(self.deals)

    def order_calc_profit(self, action: int, symbol: str, volume: float, price_open: float, price_close: float) -> Any:
        sign = 1 if action == self.ORDER_TYPE_BUY else -1
        return sign * (price_close - price_open) * self.symbols[symbol].trade_contract_size * volume

    def order_calc_margin(self, action: int, symbol: str, volume: float, price: float) -> Any:
        return volume * self.symbols[symbol].trade_contract_size * price / self.account.leverage
