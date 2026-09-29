"""MT5Gateway: the ONLY module that imports MetaTrader5 (architecture layer L0).

Responsibilities in STEP 3: connect, identify terminal/account, resolve symbols (incl. broker
suffixes), read quotes, read CLOSED bars, read positions/deals, broker-exact loss-per-lot.

Order sending is deliberately DISABLED until STEP 7 (raises NotYetImplemented), so nothing
built so far can place a trade.

Conventions (see core/ports.py):
* every MT5 call that returns None raises BrokerUnavailable — "unknown" is never "empty";
* all returned timestamps are true UTC (converted with BrokerTimeRule);
* the currently forming bar is never returned.
"""

from __future__ import annotations

import logging
from collections.abc import Callable, Sequence
from datetime import datetime, timedelta
from types import ModuleType
from typing import Any

import pandas as pd

from core.config import Credentials, Settings
from core.errors import NotYetImplemented, SymbolResolutionError
from core.ports import BrokerGateway, BrokerUnavailable, Clock, DealRecord, OrderCheck
from core.timeutils import BrokerTimeRule
from core.types import (
    AccountSnapshot,
    AccountTradeMode,
    Direction,
    ExecutionResult,
    OrderIntent,
    PositionState,
    Quote,
    SymbolSpec,
    Timeframe,
)

log = logging.getLogger(__name__)

BAR_COLUMNS = ["time_open_utc", "open", "high", "low", "close", "tick_volume", "spread_points"]

# symbol_info().filling_mode bit flags (MQL5 SYMBOL_FILLING_*; not exported by the Python package)
_SYMBOL_FILLING_FOK = 1
_SYMBOL_FILLING_IOC = 2
_RES_S_OK = 1  # mt5.last_error() code meaning "no error"
_MAX_SUFFIX_LEN = 5

_DEAL_ENTRY = {0: "in", 1: "out", 2: "inout", 3: "out_by"}
_DEAL_REASON = {0: "client", 1: "mobile", 2: "web", 3: "expert", 4: "sl", 5: "tp", 6: "stop_out",
                7: "rollover", 8: "vmargin", 9: "split"}
_ACCOUNT_MODE = {0: AccountTradeMode.DEMO, 1: AccountTradeMode.CONTEST, 2: AccountTradeMode.REAL}


class MT5Gateway(BrokerGateway):
    """Live/demo adapter implementing the BrokerGateway port."""

    def __init__(self, settings: Settings, creds: Credentials, clock: Clock, mt5_module: ModuleType | Any = None):
        self._settings = settings
        self._creds = creds
        self._clock = clock
        self._mt5 = mt5_module
        self._rule: BrokerTimeRule = settings.broker_time.parsed_rule()
        self._to_broker: dict[str, str] = {}
        self._from_broker: dict[str, str] = {}
        self.startup_identity: tuple[int, str] | None = None

    # ------------------------------------------------------------------ plumbing
    @property
    def time_rule(self) -> BrokerTimeRule:
        return self._rule

    def _module(self) -> Any:
        if self._mt5 is None:
            try:
                import MetaTrader5
            except ImportError as exc:
                raise BrokerUnavailable(
                    "MetaTrader5 package not installed (Windows only): python -m pip install MetaTrader5"
                ) from exc
            self._mt5 = MetaTrader5
        return self._mt5

    def _last_error(self) -> tuple[int, str]:
        try:
            err = self._module().last_error()
            return int(err[0]), str(err[1])
        except Exception:  # pragma: no cover - diagnostics must never mask the original problem
            return (-1, "last_error() unavailable")

    def _call(self, name: str, *args: Any, allow_none_if_ok: bool = False, **kwargs: Any) -> Any:
        fn: Callable[..., Any] = getattr(self._module(), name)
        result = fn(*args, **kwargs)
        if result is None:
            code, msg = self._last_error()
            if allow_none_if_ok and code == _RES_S_OK:
                return ()
            raise BrokerUnavailable(f"mt5.{name} returned None (last_error={code}: {msg})")
        return result

    def _tf(self, tf: Timeframe) -> int:
        return int(getattr(self._module(), f"TIMEFRAME_{tf.name}"))

    # ------------------------------------------------------------------ connection
    def connect(self) -> None:
        mt5 = self._module()
        kwargs: dict[str, Any] = {"timeout": self._settings.mt5.connect_timeout_ms}
        if self._creds.terminal_path:
            kwargs["path"] = self._creds.terminal_path
        if not self._settings.mt5.attach_to_running_terminal:
            if not (self._creds.login and self._creds.password and self._creds.server):
                raise BrokerUnavailable("attach_to_running_terminal is false but MT5_LOGIN/PASSWORD/SERVER are not all set")
            kwargs.update(login=self._creds.login, password=self._creds.password, server=self._creds.server)
        if not mt5.initialize(**kwargs):
            code, msg = self._last_error()
            raise BrokerUnavailable(f"mt5.initialize failed ({code}: {msg}). Is MetaTrader 5 open and logged in?")
        acct = self.account()
        self.startup_identity = (acct.login, acct.server)
        log.info("connected to MT5", extra={"ctx": {"login": acct.login, "server": acct.server,
                                                    "trade_mode": acct.trade_mode.value}})

    def shutdown(self) -> None:
        if self._mt5 is not None:
            self._mt5.shutdown()

    def is_connected(self) -> bool:
        info = self._module().terminal_info()
        return bool(info is not None and getattr(info, "connected", False))

    def terminal_trade_allowed(self) -> bool:
        return bool(getattr(self._call("terminal_info"), "trade_allowed", False))

    def terminal_summary(self) -> dict[str, Any]:
        info = self._call("terminal_info")
        version = self._module().version()
        return {
            "package_version": getattr(self._module(), "__version__", "?"),
            "terminal_build": version[1] if version else "?",
            "connected": bool(info.connected),
            "algo_trading_button": bool(info.trade_allowed),
            "company": info.company,
            "path": info.path,
            "max_bars_in_chart": getattr(info, "maxbars", None),
        }

    def account(self) -> AccountSnapshot:
        a = self._call("account_info")
        mode = _ACCOUNT_MODE.get(int(a.trade_mode))
        if mode is None:
            raise BrokerUnavailable(f"unknown account trade_mode {a.trade_mode}")
        return AccountSnapshot(
            login=int(a.login), server=str(a.server), currency=str(a.currency), trade_mode=mode,
            balance=float(a.balance), equity=float(a.equity), margin=float(a.margin),
            free_margin=float(a.margin_free), leverage=int(a.leverage),
            trade_allowed=bool(a.trade_allowed), expert_trading_allowed=bool(a.trade_expert),
            hedging=int(a.margin_mode) == int(self._module().ACCOUNT_MARGIN_MODE_RETAIL_HEDGING),
            time_utc=self._clock.now_utc(),
        )

    # ------------------------------------------------------------------ symbols
    def resolve_symbols(self, names: Sequence[str]) -> dict[str, str]:
        """Map configured names (EURUSD) to broker names (EURUSD or EURUSD.i) and select them."""
        all_symbols: list[Any] | None = None
        for name in names:
            info = self._module().symbol_info(name)
            if info is not None:
                broker = name
            else:
                if not self._settings.mt5.auto_resolve_symbol_suffix:
                    raise SymbolResolutionError(f"{name}: not offered by broker (auto suffix resolution disabled)")
                if all_symbols is None:
                    all_symbols = list(self._call("symbols_get"))
                candidates = [s for s in all_symbols
                              if s.name.startswith(name) and 0 < len(s.name) - len(name) <= _MAX_SUFFIX_LEN]
                full = [s for s in candidates
                        if int(s.trade_mode) == int(self._module().SYMBOL_TRADE_MODE_FULL)]
                pool = full or candidates
                if len(pool) != 1:
                    found = [s.name for s in candidates]
                    raise SymbolResolutionError(
                        f"{name}: expected exactly one broker symbol, found {found or 'none'}. "
                        "Put the exact broker name in config/settings.yaml symbols."
                    )
                broker = pool[0].name
            if not self._module().symbol_select(broker, True):
                code, msg = self._last_error()
                raise SymbolResolutionError(f"{broker}: symbol_select failed ({code}: {msg})")
            self._to_broker[name] = broker
            self._from_broker[broker] = name
        return dict(self._to_broker)

    def _b(self, symbol: str) -> str:
        return self._to_broker.get(symbol, symbol)

    def _c(self, broker_symbol: str) -> str:
        return self._from_broker.get(broker_symbol, broker_symbol)

    def symbol_spec(self, symbol: str) -> SymbolSpec:
        s = self._call("symbol_info", self._b(symbol))
        filling: set[str] = set()
        if int(s.filling_mode) & _SYMBOL_FILLING_FOK:
            filling.add("FOK")
        if int(s.filling_mode) & _SYMBOL_FILLING_IOC:
            filling.add("IOC")
        if not filling:
            filling.add("RETURN")
        return SymbolSpec(
            symbol=symbol, digits=int(s.digits), point=float(s.point), tick_size=float(s.trade_tick_size),
            contract_size=float(s.trade_contract_size), volume_min=float(s.volume_min),
            volume_max=float(s.volume_max), volume_step=float(s.volume_step),
            stops_level_points=int(s.trade_stops_level), freeze_level_points=int(s.trade_freeze_level),
            currency_base=str(s.currency_base), currency_profit=str(s.currency_profit),
            currency_margin=str(s.currency_margin),
            trade_allowed=int(s.trade_mode) == int(self._module().SYMBOL_TRADE_MODE_FULL),
            filling_modes=frozenset(filling),
        )

    # ------------------------------------------------------------------ prices
    def quote(self, symbol: str) -> Quote:
        t = self._call("symbol_info_tick", self._b(symbol))
        if float(t.bid) <= 0 or float(t.ask) <= 0:
            raise BrokerUnavailable(f"{symbol}: no valid quote (bid={t.bid}, ask={t.ask})")
        seconds = float(t.time_msc) / 1000.0 if getattr(t, "time_msc", 0) else float(t.time)
        return Quote(symbol, self._rule.from_mt5_seconds(seconds), float(t.bid), float(t.ask))

    def latest_tick_server_seconds(self, symbols: Sequence[str]) -> int | None:
        latest: int | None = None
        for sym in symbols:
            t = self._module().symbol_info_tick(self._b(sym))
            if t is not None and int(t.time) > 0:
                latest = max(latest or 0, int(t.time))
        return latest

    def server_utc_offset_seconds(self) -> int:
        latest = self.latest_tick_server_seconds(list(self._to_broker))
        if latest is None:
            raise BrokerUnavailable("no ticks available to measure server offset")
        now = self._clock.now_utc()
        return int(latest - now.timestamp())

    def _rates_to_frame(self, rates: Any) -> pd.DataFrame:
        if rates is None or len(rates) == 0:
            return pd.DataFrame(columns=BAR_COLUMNS)
        raw = pd.DataFrame(rates)
        times = self._rule.mt5_seconds_to_utc_index(raw["time"])
        df = pd.DataFrame({
            "time_open_utc": times,
            "open": raw["open"].astype(float), "high": raw["high"].astype(float),
            "low": raw["low"].astype(float), "close": raw["close"].astype(float),
            "tick_volume": raw["tick_volume"].astype("int64"), "spread_points": raw["spread"].astype("int64"),
        })
        dropped = int(df["time_open_utc"].isna().sum())
        if dropped:
            log.warning("dropped bars in DST gap/overlap", extra={"ctx": {"count": dropped}})
            df = df.dropna(subset=["time_open_utc"])
        return df.reset_index(drop=True)

    def _drop_forming(self, df: pd.DataFrame, tf: Timeframe) -> pd.DataFrame:
        """All bars except the newest have a successor, so they are closed. The newest bar is
        closed only if its period ended at least `closed_bar_settle_seconds` ago (no newer tick
        has opened a new bar yet, e.g. quiet market). Otherwise it is still forming."""
        if df.empty:
            return df
        settle = timedelta(seconds=self._settings.data.closed_bar_settle_seconds)
        last_close = df["time_open_utc"].iloc[-1] + tf.delta
        if self._clock.now_utc() < last_close + settle:
            return df.iloc[:-1].reset_index(drop=True)
        return df

    def closed_bars(self, symbol: str, timeframe: Timeframe, count: int) -> pd.DataFrame:
        if count <= 0:
            raise ValueError("count must be > 0")
        rates = self._call("copy_rates_from_pos", self._b(symbol), self._tf(timeframe), 0, count + 1)
        df = self._drop_forming(self._rates_to_frame(rates), timeframe)
        return df.tail(count).reset_index(drop=True)

    def history_bars(self, symbol: str, timeframe: Timeframe, start_utc: datetime, end_utc: datetime) -> pd.DataFrame:
        """Closed bars whose open time lies in [start_utc, end_utc). Used by the data downloader."""
        rates = self._call(
            "copy_rates_range", self._b(symbol), self._tf(timeframe),
            self._rule.to_mt5_request_datetime(start_utc), self._rule.to_mt5_request_datetime(end_utc),
        )
        df = self._drop_forming(self._rates_to_frame(rates), timeframe)
        mask = (df["time_open_utc"] >= start_utc) & (df["time_open_utc"] < end_utc)
        return df.loc[mask].reset_index(drop=True)

    # ------------------------------------------------------------------ state
    def positions(self, magics: Sequence[int]) -> list[PositionState]:
        raw = self._call("positions_get")
        wanted = set(magics)
        out: list[PositionState] = []
        for p in raw:
            if int(p.magic) not in wanted:
                continue
            out.append(PositionState(
                ticket=int(p.ticket), symbol=self._c(str(p.symbol)),
                direction=Direction.LONG if int(p.type) == int(self._module().POSITION_TYPE_BUY) else Direction.SHORT,
                volume=float(p.volume), open_price=float(p.price_open), sl=float(p.sl), tp=float(p.tp),
                open_time_utc=self._rule.from_mt5_seconds(float(p.time_msc) / 1000.0 if getattr(p, "time_msc", 0) else p.time),
                magic=int(p.magic), comment=str(p.comment), profit=float(p.profit), swap=float(p.swap),
            ))
        return out

    def deals(self, since_utc: datetime, until_utc: datetime, magics: Sequence[int]) -> list[DealRecord]:
        raw = self._call("history_deals_get", self._rule.to_mt5_request_datetime(since_utc),
                         self._rule.to_mt5_request_datetime(until_utc), allow_none_if_ok=True)
        wanted = set(magics)
        buy, sell = int(self._module().DEAL_TYPE_BUY), int(self._module().DEAL_TYPE_SELL)
        out: list[DealRecord] = []
        for d in raw:
            if int(d.magic) not in wanted or int(d.type) not in (buy, sell):
                continue  # skip balance/credit/other non-trade deals
            out.append(DealRecord(
                ticket=int(d.ticket), position_id=int(d.position_id), symbol=self._c(str(d.symbol)),
                time_utc=self._rule.from_mt5_seconds(float(d.time_msc) / 1000.0 if getattr(d, "time_msc", 0) else d.time),
                entry=_DEAL_ENTRY.get(int(d.entry), "unknown"),
                direction=Direction.LONG if int(d.type) == buy else Direction.SHORT,
                volume=float(d.volume), price=float(d.price), profit=float(d.profit),
                commission=float(d.commission), swap=float(d.swap), fee=float(getattr(d, "fee", 0.0)),
                magic=int(d.magic), comment=str(d.comment), reason=_DEAL_REASON.get(int(d.reason), "other"),
            ))
        return out

    # ------------------------------------------------------------------ risk helpers
    def loss_per_lot(self, symbol: str, direction: Direction, entry: float, stop: float) -> float:
        action = self._module().ORDER_TYPE_BUY if direction is Direction.LONG else self._module().ORDER_TYPE_SELL
        pnl = float(self._call("order_calc_profit", action, self._b(symbol), 1.0, entry, stop))
        if pnl >= 0:
            raise ValueError(f"{symbol}: stop {stop} is not a loss for {direction.name} from {entry} (pnl={pnl})")
        return -pnl

    def margin_required(self, symbol: str, direction: Direction, volume: float, price: float) -> float:
        action = self._module().ORDER_TYPE_BUY if direction is Direction.LONG else self._module().ORDER_TYPE_SELL
        return float(self._call("order_calc_margin", action, self._b(symbol), volume, price))

    # ------------------------------------------------------------------ orders (STEP 7)
    def check_order(self, intent: OrderIntent) -> OrderCheck:
        raise NotYetImplemented("order functions are disabled until STEP 7")

    def send_market_order(self, intent: OrderIntent) -> ExecutionResult:
        raise NotYetImplemented("order functions are disabled until STEP 7")

    def modify_position(self, ticket: int, sl: float, tp: float | None) -> int:
        raise NotYetImplemented("order functions are disabled until STEP 7")

    def close_position(self, ticket: int, volume: float, max_deviation_points: int) -> int:
        raise NotYetImplemented("order functions are disabled until STEP 7")
