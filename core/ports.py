"""Ports: the interfaces that separate trading logic from the outside world (layer L1).

Live trading injects ``MT5Gateway`` + ``LiveClock`` + SQLite ``Journal``.
Backtests inject ``SimBroker`` + ``SimClock`` + research ``Journal``.
Strategy, risk, safety and position-management code depends ONLY on these
protocols, which is what guarantees backtest and live share one code path.

Conventions for every BrokerGateway implementation:
* All timestamps returned are timezone-aware UTC (broker server time is converted
  inside the adapter, never by callers).
* A method that cannot obtain an answer raises ``BrokerUnavailable``; it must never
  return an empty list to mean "I don't know". An empty list means "confirmed none".
* ``closed_bars`` never includes the currently forming bar.
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass
from datetime import datetime
from typing import TYPE_CHECKING, Protocol, runtime_checkable

from core.types import (
    AccountSnapshot,
    ClosedTrade,
    DecisionRecord,
    Direction,
    ExecutionResult,
    FeedStatus,
    OrderIntent,
    PositionState,
    Quote,
    SymbolSpec,
    Timeframe,
)

if TYPE_CHECKING:
    import pandas as pd


class BrokerUnavailable(RuntimeError):
    """The broker/terminal could not answer. Callers must treat state as UNKNOWN."""


@dataclass(frozen=True, slots=True)
class DealRecord:
    """A broker deal (fill) — used by the reconciler to rebuild closed trades."""

    ticket: int
    position_id: int
    symbol: str
    time_utc: datetime
    entry: str  # "in" | "out" | "inout" | "out_by"
    direction: Direction
    volume: float
    price: float
    profit: float
    commission: float
    swap: float
    fee: float
    magic: int
    comment: str
    reason: str  # e.g. "sl", "tp", "expert", "client"


@dataclass(frozen=True, slots=True)
class OrderCheck:
    """Result of a broker-side pre-validation (mt5.order_check or simulated)."""

    ok: bool
    retcode: int
    margin_required: float
    free_margin_after: float
    comment: str


@dataclass(frozen=True, slots=True)
class EconomicEvent:
    event_id: str
    time_utc: datetime
    currency: str
    importance: str  # "high" | "medium" | "low"
    title: str


@dataclass(frozen=True, slots=True)
class ControlCommand:
    command_id: int
    command: str  # START | STOP | PAUSE | RESUME | CLOSE_ALL | RESET_BREAKER
    argument: str
    nonce: str
    created_at_utc: datetime
    expires_at_utc: datetime


@runtime_checkable
class Clock(Protocol):
    def now_utc(self) -> datetime:
        """Current time (real in live, simulated in backtest). Always tz-aware UTC."""


@runtime_checkable
class BrokerGateway(Protocol):
    # --- connection / account
    def is_connected(self) -> bool: ...
    def terminal_trade_allowed(self) -> bool: ...
    def account(self) -> AccountSnapshot: ...
    def server_utc_offset_seconds(self) -> int:
        """Observed offset of broker server clock from true UTC (for the DST/offset check)."""

    # --- instruments / prices
    def symbol_spec(self, symbol: str) -> SymbolSpec: ...
    def quote(self, symbol: str) -> Quote: ...
    def closed_bars(self, symbol: str, timeframe: Timeframe, count: int) -> pd.DataFrame:
        """Most recent ``count`` CLOSED bars, ascending, columns per MarketSnapshot."""

    # --- state (authoritative)
    def positions(self, magics: Sequence[int]) -> list[PositionState]: ...
    def deals(self, since_utc: datetime, until_utc: datetime, magics: Sequence[int]) -> list[DealRecord]: ...

    # --- risk helpers (broker-exact where possible)
    def loss_per_lot(self, symbol: str, direction: Direction, entry: float, stop: float) -> float:
        """Account-currency loss for 1.0 lot moving from entry to stop (positive number)."""

    def margin_required(self, symbol: str, direction: Direction, volume: float, price: float) -> float: ...

    # --- orders
    def check_order(self, intent: OrderIntent) -> OrderCheck: ...
    def send_market_order(self, intent: OrderIntent) -> ExecutionResult:
        """Single attempt. Retry policy lives in core.execution, not in the adapter."""

    def modify_position(self, ticket: int, sl: float, tp: float | None) -> int:
        """Returns the MT5 retcode of the modification attempt."""

    def close_position(self, ticket: int, volume: float, max_deviation_points: int) -> int:
        """Returns the MT5 retcode of the close attempt."""


@runtime_checkable
class Journal(Protocol):
    """Persistence port. Implementations must fall back to the emergency log on failure."""

    def is_healthy(self) -> bool: ...
    def consume_setup(self, setup_id: str) -> bool:
        """Atomically mark a setup as used. Returns False if it was already consumed."""

    def consumed_setups(self) -> set[str]: ...
    def record_decision(self, record: DecisionRecord) -> None: ...
    def record_execution(self, result: ExecutionResult) -> None: ...
    def record_trade(self, trade: ClosedTrade) -> None: ...
    def record_safety_event(self, kind: str, detail: dict[str, object]) -> None: ...
    def record_heartbeat(self, status: dict[str, object]) -> None: ...
    def pending_commands(self, now_utc: datetime) -> list[ControlCommand]: ...
    def acknowledge_command(self, command_id: int, outcome: str) -> None: ...


@runtime_checkable
class CalendarSource(Protocol):
    def status(self, now_utc: datetime) -> FeedStatus: ...
    def events_between(self, start_utc: datetime, end_utc: datetime) -> list[EconomicEvent]: ...
