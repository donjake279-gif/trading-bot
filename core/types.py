"""Immutable message types exchanged between modules (architecture layer L1).

Every object that crosses a module boundary is defined here as a frozen dataclass.
Invariants that protect capital (e.g. "every order has a stop loss on the correct
side") are validated in ``__post_init__`` so an invalid object cannot exist.

This module has no third-party dependencies and performs no I/O.
"""

from __future__ import annotations

import hashlib
import math
from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from enum import Enum, IntEnum
from typing import TYPE_CHECKING, Any

if TYPE_CHECKING:  # pandas is only needed for type checking here
    import pandas as pd

MT5_COMMENT_MAX_LEN = 31
"""MqlTradeRequest.comment is limited to 31 characters by MT5."""

SIGNAL_SHORT_ID_LEN = 12
"""Length of the hex signal-id prefix written into the MT5 order comment."""


class ContractViolation(ValueError):
    """Raised when a message object would violate a safety invariant."""


# --------------------------------------------------------------------------- helpers


def _require(condition: bool, message: str) -> None:
    if not condition:
        raise ContractViolation(message)


def _require_utc(ts: datetime, name: str) -> None:
    _require(
        ts.tzinfo is not None and ts.utcoffset() == timedelta(0),
        f"{name} must be timezone-aware UTC, got {ts!r}",
    )


def _require_finite(value: float, name: str) -> None:
    _require(isinstance(value, (int, float)) and math.isfinite(value), f"{name} must be finite, got {value!r}")


def _require_positive(value: float, name: str) -> None:
    _require_finite(value, name)
    _require(value > 0, f"{name} must be > 0, got {value!r}")


# --------------------------------------------------------------------------- enums


class RunMode(str, Enum):
    """How the process is allowed to interact with a broker."""

    BACKTEST = "backtest"
    SHADOW = "shadow"  # live data, full pipeline, orders never sent
    DEMO = "demo"
    LIVE = "live"


class AccountTradeMode(str, Enum):
    """Mirror of MT5 ACCOUNT_TRADE_MODE_* as observed on the connected account."""

    DEMO = "demo"
    CONTEST = "contest"
    REAL = "real"


class Direction(IntEnum):
    """Trade direction. The integer value is the sign of a profitable price move."""

    LONG = 1
    SHORT = -1

    @property
    def opposite(self) -> Direction:
        return Direction.SHORT if self is Direction.LONG else Direction.LONG


class Timeframe(Enum):
    """Supported bar timeframes; value = bar length in minutes."""

    M1 = 1
    M5 = 5
    M15 = 15
    M30 = 30
    H1 = 60
    H4 = 240
    D1 = 1440

    @property
    def minutes(self) -> int:
        return int(self.value)

    @property
    def delta(self) -> timedelta:
        return timedelta(minutes=self.minutes)

    @classmethod
    def parse(cls, text: str) -> Timeframe:
        try:
            return cls[text.strip().upper()]
        except KeyError as exc:
            raise ContractViolation(f"Unsupported timeframe {text!r}") from exc


class BotState(str, Enum):
    STOPPED = "stopped"
    RUNNING = "running"
    ENTRIES_BLOCKED = "entries_blocked"  # breaker tripped or PAUSE: manage only
    HALTED = "halted"  # fatal / account changed / manual stop: no actions


class BreakerName(str, Enum):
    CONSEC_LOSSES = "consec_losses"
    DAILY_DD = "daily_dd"
    WEEKLY_DD = "weekly_dd"
    TOTAL_DD = "total_dd"
    MAX_TRADES_DAY = "max_trades_day"
    EXCEPTION_RATE = "exception_rate"
    ORDER_FAILURES = "order_failures"


class ExecutionStatus(str, Enum):
    FILLED = "filled"
    REJECTED_PRECHECK = "rejected_precheck"
    REJECTED = "rejected"
    UNKNOWN = "unknown"  # outcome not confirmed; must be VERIFIED, never blindly resent
    SKIPPED_DUPLICATE = "skipped_duplicate"
    SKIPPED_SHADOW = "skipped_shadow"


class ActionKind(str, Enum):
    MODIFY_SL = "modify_sl"
    MODIFY_TP = "modify_tp"
    PARTIAL_CLOSE = "partial_close"
    CLOSE = "close"


class ExitReason(str, Enum):
    STOP_LOSS = "stop_loss"
    TAKE_PROFIT = "take_profit"
    BREAK_EVEN_STOP = "break_even_stop"
    TRAILING_STOP = "trailing_stop"
    PARTIAL = "partial"
    MANUAL = "manual"
    CLOSE_ALL_COMMAND = "close_all_command"
    CIRCUIT_BREAKER = "circuit_breaker"
    INVALIDATION = "invalidation"
    TIME_EXIT = "time_exit"
    MISSING_SL_PROTECTION = "missing_sl_protection"
    END_OF_TEST = "end_of_test"  # backtest only: still open when the test period ended
    UNKNOWN = "unknown"


class FeedStatus(str, Enum):
    OK = "ok"
    STALE = "stale"
    UNAVAILABLE = "unavailable"
    DISABLED = "disabled"


# --------------------------------------------------------------------------- broker facts


@dataclass(frozen=True, slots=True)
class SymbolSpec:
    """Static-ish trading properties of a symbol as reported by the broker."""

    symbol: str
    digits: int
    point: float
    tick_size: float
    contract_size: float
    volume_min: float
    volume_max: float
    volume_step: float
    stops_level_points: int
    freeze_level_points: int
    currency_base: str
    currency_profit: str
    currency_margin: str
    trade_allowed: bool
    filling_modes: frozenset[str] = frozenset()

    def __post_init__(self) -> None:
        for name in ("point", "tick_size", "contract_size", "volume_min", "volume_max", "volume_step"):
            _require_positive(getattr(self, name), f"{self.symbol}.{name}")
        _require(self.volume_min <= self.volume_max, f"{self.symbol}: volume_min > volume_max")
        _require(self.stops_level_points >= 0 and self.freeze_level_points >= 0, "levels must be >= 0")

    @property
    def currencies(self) -> tuple[str, str]:
        """(base, quote) — used to decompose exposure into currency legs."""
        return self.currency_base, self.currency_profit


@dataclass(frozen=True, slots=True)
class Quote:
    symbol: str
    time_utc: datetime
    bid: float
    ask: float

    def __post_init__(self) -> None:
        _require_utc(self.time_utc, "Quote.time_utc")
        _require_positive(self.bid, "bid")
        _require_positive(self.ask, "ask")
        _require(self.ask >= self.bid, f"{self.symbol}: ask < bid ({self.ask} < {self.bid})")

    @property
    def spread(self) -> float:
        return self.ask - self.bid

    def entry_price(self, direction: Direction) -> float:
        """Market-order fill reference: buy at ask, sell at bid."""
        return self.ask if direction is Direction.LONG else self.bid

    def exit_price(self, direction: Direction) -> float:
        """Price at which an existing position would be closed."""
        return self.bid if direction is Direction.LONG else self.ask


@dataclass(frozen=True, slots=True)
class AccountSnapshot:
    login: int
    server: str
    currency: str
    trade_mode: AccountTradeMode
    balance: float
    equity: float
    margin: float
    free_margin: float
    leverage: int
    trade_allowed: bool  # account-level permission
    expert_trading_allowed: bool  # account allows EAs / API trading
    hedging: bool
    time_utc: datetime

    def __post_init__(self) -> None:
        _require_utc(self.time_utc, "AccountSnapshot.time_utc")
        for name in ("balance", "equity", "margin", "free_margin"):
            _require_finite(getattr(self, name), name)
        _require(self.login > 0, "login must be positive")


@dataclass(frozen=True, slots=True)
class PositionState:
    """An open position as reported by the broker (authoritative)."""

    ticket: int
    symbol: str
    direction: Direction
    volume: float
    open_price: float
    sl: float  # 0.0 means "no SL" in MT5 — detected and repaired by the reconciler
    tp: float
    open_time_utc: datetime
    magic: int
    comment: str
    profit: float
    swap: float

    def __post_init__(self) -> None:
        _require_utc(self.open_time_utc, "PositionState.open_time_utc")
        _require_positive(self.volume, "volume")

    @property
    def has_stop_loss(self) -> bool:
        return self.sl > 0.0


# --------------------------------------------------------------------------- market data


@dataclass(frozen=True, slots=True)
class MarketSnapshot:
    """All information the analysis layer may see at ``decision_time_utc``.

    ``frames`` hold CLOSED bars only (columns: time_open_utc, open, high, low, close,
    tick_volume, spread_points). The constructor enforces that no frame contains a
    bar whose close time lies after the decision time — the primary look-ahead guard.
    """

    symbol: str
    decision_time_utc: datetime
    frames: Mapping[Timeframe, pd.DataFrame]
    quote: Quote | None = None

    def __post_init__(self) -> None:
        _require_utc(self.decision_time_utc, "MarketSnapshot.decision_time_utc")
        for tf, df in self.frames.items():
            if len(df) == 0:
                continue
            last_open = df["time_open_utc"].iloc[-1]
            last_close = last_open + tf.delta  # works for datetime and pandas.Timestamp
            _require(
                last_close <= self.decision_time_utc,
                f"LOOK-AHEAD: {self.symbol} {tf.name} bar closing {last_close} is after decision time "
                f"{self.decision_time_utc}",
            )


# --------------------------------------------------------------------------- signals


def make_setup_id(strategy_version: str, symbol: str, direction: Direction, event_keys: tuple[str, ...]) -> str:
    """Deterministic setup id: the same market-structure event always yields the same id.

    ``event_keys`` identify the structure event(s) that define the setup (for example the
    confirmed swing being broken and the bar of the break), so a re-evaluation on a later
    bar cannot create a second entry from the same event.
    """
    _require(len(event_keys) > 0, "event_keys must not be empty")
    raw = "|".join((strategy_version, symbol, direction.name, *event_keys))
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class SetupCandidate:
    """A structurally valid setup produced by the strategy (before scoring and gates)."""

    setup_id: str
    strategy_version: str
    symbol: str
    direction: Direction
    timeframe: Timeframe
    detected_at_utc: datetime
    entry_ref: float  # reference entry (e.g. next-bar open estimate); execution re-prices
    stop: float
    target: float
    invalidation_price: float
    expires_at_utc: datetime
    context: Mapping[str, Any] = field(default_factory=dict)

    def __post_init__(self) -> None:
        _require_utc(self.detected_at_utc, "detected_at_utc")
        _require_utc(self.expires_at_utc, "expires_at_utc")
        _require(self.expires_at_utc > self.detected_at_utc, "expiry must be after detection")
        for name in ("entry_ref", "stop", "target", "invalidation_price"):
            _require_positive(getattr(self, name), name)
        _check_bracket(self.direction, self.entry_ref, self.stop, self.target, "SetupCandidate")

    @property
    def stop_distance(self) -> float:
        return abs(self.entry_ref - self.stop)

    @property
    def gross_rr(self) -> float:
        return abs(self.target - self.entry_ref) / self.stop_distance


def _check_bracket(direction: Direction, entry: float, stop: float, target: float | None, where: str) -> None:
    if direction is Direction.LONG:
        _require(stop < entry, f"{where}: LONG stop {stop} must be below entry {entry}")
        if target is not None:
            _require(target > entry, f"{where}: LONG target {target} must be above entry {entry}")
    else:
        _require(stop > entry, f"{where}: SHORT stop {stop} must be above entry {entry}")
        if target is not None:
            _require(target < entry, f"{where}: SHORT target {target} must be below entry {entry}")


@dataclass(frozen=True, slots=True)
class ScoreComponent:
    """One measurable scoring component with the evidence that produced it."""

    name: str
    points: float
    max_points: float
    reason: str
    inputs: Mapping[str, float | str | bool] = field(default_factory=dict)

    def __post_init__(self) -> None:
        _require_finite(self.points, f"{self.name}.points")
        _require_positive(self.max_points, f"{self.name}.max_points")
        _require(0 <= self.points <= self.max_points, f"{self.name}: points {self.points} not in [0, {self.max_points}]")
        _require(bool(self.reason.strip()), f"{self.name}: a reason is mandatory")


@dataclass(frozen=True, slots=True)
class ScoredSignal:
    candidate: SetupCandidate
    components: tuple[ScoreComponent, ...]

    def __post_init__(self) -> None:
        names = [c.name for c in self.components]
        _require(len(names) == len(set(names)), f"duplicate score components: {names}")

    @property
    def total(self) -> float:
        return sum(c.points for c in self.components)

    @property
    def max_total(self) -> float:
        return sum(c.max_points for c in self.components)


@dataclass(frozen=True, slots=True)
class GateResult:
    """Outcome of one pre-trade filter. All gates run; all results are journaled."""

    gate: str
    passed: bool
    reason: str
    measured: Mapping[str, float | str | bool] = field(default_factory=dict)


# --------------------------------------------------------------------------- risk & orders


@dataclass(frozen=True, slots=True)
class RiskDecision:
    approved: bool
    volume: float
    risk_amount: float  # account currency, including modelled costs
    risk_pct: float  # of the equity base used for sizing
    rr_gross: float
    rr_net: float  # after spread/commission/slippage estimate
    reasons: tuple[str, ...]

    def __post_init__(self) -> None:
        if self.approved:
            _require_positive(self.volume, "approved RiskDecision.volume")
            _require_positive(self.risk_amount, "approved RiskDecision.risk_amount")
        else:
            _require(len(self.reasons) > 0, "a rejected RiskDecision must state its reasons")


@dataclass(frozen=True, slots=True)
class OrderIntent:
    """A fully specified market order. Cannot be constructed without a valid stop loss."""

    signal_id: str
    strategy_version: str
    symbol: str
    direction: Direction
    volume: float
    entry_ref: float
    sl: float
    tp: float | None
    max_deviation_points: int
    magic: int
    comment: str

    def __post_init__(self) -> None:
        _require_positive(self.volume, "volume")
        _require_positive(self.entry_ref, "entry_ref")
        _require_positive(self.sl, "sl (every trade MUST have a stop loss)")
        if self.tp is not None:
            _require_positive(self.tp, "tp")
        _check_bracket(self.direction, self.entry_ref, self.sl, self.tp, "OrderIntent")
        _require(self.max_deviation_points >= 0, "max_deviation_points must be >= 0")
        _require(self.magic > 0, "magic must be > 0")
        _require(len(self.comment) <= MT5_COMMENT_MAX_LEN, f"comment exceeds {MT5_COMMENT_MAX_LEN} chars")

    @staticmethod
    def build_comment(strategy_code: str, signal_id: str) -> str:
        """Compact comment, e.g. 'S1v1:3f9a0c1b22de'. Secondary link only (brokers may alter it)."""
        comment = f"{strategy_code}:{signal_id[:SIGNAL_SHORT_ID_LEN]}"
        _require(len(comment) <= MT5_COMMENT_MAX_LEN, "strategy_code too long for MT5 comment")
        return comment


@dataclass(frozen=True, slots=True)
class ExecutionResult:
    intent: OrderIntent
    status: ExecutionStatus
    attempts: int
    time_utc: datetime
    retcode: int | None = None
    ticket: int | None = None
    fill_price: float | None = None
    fill_volume: float | None = None
    message: str = ""

    def __post_init__(self) -> None:
        _require_utc(self.time_utc, "ExecutionResult.time_utc")
        if self.status is ExecutionStatus.FILLED:
            _require(self.ticket is not None and self.fill_price is not None, "FILLED needs ticket and fill_price")


@dataclass(frozen=True, slots=True)
class ManagementAction:
    ticket: int
    symbol: str
    direction: Direction
    kind: ActionKind
    reason: str
    current_sl: float = 0.0
    new_sl: float | None = None
    new_tp: float | None = None
    close_volume: float | None = None

    def __post_init__(self) -> None:
        if self.kind is ActionKind.MODIFY_SL:
            new_sl = self.new_sl
            _require(new_sl is not None and new_sl > 0, "MODIFY_SL requires new_sl")
            assert new_sl is not None  # narrowing for type checkers; guaranteed by _require above
            if self.current_sl > 0:
                # Central invariant: a stop may only move in the protective direction.
                improves = (new_sl > self.current_sl) if self.direction is Direction.LONG else (new_sl < self.current_sl)
                _require(improves, f"SL may only tighten: {self.current_sl} -> {self.new_sl} ({self.direction.name})")
        if self.kind is ActionKind.PARTIAL_CLOSE:
            _require(self.close_volume is not None and self.close_volume > 0, "PARTIAL_CLOSE requires close_volume")


@dataclass(frozen=True, slots=True)
class ClosedTrade:
    trade_id: str
    signal_id: str
    strategy_version: str
    symbol: str
    direction: Direction
    open_time_utc: datetime
    close_time_utc: datetime
    entry_price: float
    exit_price: float  # volume-weighted across partial exits
    initial_sl: float
    initial_tp: float | None
    volume: float
    risk_amount: float  # initial risk in account currency
    risk_pct: float
    gross_pnl: float
    commission: float
    swap: float
    mfe_price: float  # maximum favourable excursion, price units
    mae_price: float  # maximum adverse excursion, price units (positive number)
    exit_reason: ExitReason

    def __post_init__(self) -> None:
        _require_utc(self.open_time_utc, "open_time_utc")
        _require_utc(self.close_time_utc, "close_time_utc")
        _require(self.close_time_utc >= self.open_time_utc, "close before open")
        _require_positive(self.risk_amount, "risk_amount")

    @property
    def net_pnl(self) -> float:
        return self.gross_pnl + self.commission + self.swap  # commission/swap are signed as MT5 reports them

    @property
    def r_multiple(self) -> float:
        """Net result in units of INITIAL risk (never recomputed from a moved stop)."""
        return self.net_pnl / self.risk_amount

    @property
    def holding_time(self) -> timedelta:
        return self.close_time_utc - self.open_time_utc


# --------------------------------------------------------------------------- health & safety


@dataclass(frozen=True, slots=True)
class HealthReport:
    time_utc: datetime
    connected: bool
    terminal_trade_allowed: bool
    account_verified: bool
    account_unchanged: bool
    server_time_offset_ok: bool
    storage_ok: bool
    news_status: FeedStatus
    stale_symbols: frozenset[str] = frozenset()
    problems: tuple[str, ...] = ()

    @property
    def entries_allowed_globally(self) -> bool:
        return all(
            (
                self.connected,
                self.terminal_trade_allowed,
                self.account_verified,
                self.account_unchanged,
                self.server_time_offset_ok,
                self.storage_ok,
            )
        )


@dataclass(frozen=True, slots=True)
class BreakerTrip:
    breaker: BreakerName
    measured: float
    threshold: float
    tripped_at_utc: datetime
    resets: str  # human-readable reset condition, e.g. "next trading day 2026-09-29T21:00Z"


@dataclass(frozen=True, slots=True)
class SafetyStatus:
    state: BotState
    trips: tuple[BreakerTrip, ...] = ()
    paused_by_user: bool = False

    @property
    def can_open_new(self) -> bool:
        return self.state is BotState.RUNNING and not self.trips and not self.paused_by_user

    @property
    def can_manage(self) -> bool:
        return self.state in (BotState.RUNNING, BotState.ENTRIES_BLOCKED)


@dataclass(frozen=True, slots=True)
class DecisionRecord:
    """Complete audit trail of one candidate setup, accepted or rejected."""

    signal: ScoredSignal
    gates: tuple[GateResult, ...]
    risk: RiskDecision | None
    execution: ExecutionResult | None
    accepted: bool
    summary_reason: str
    session: str
    regime: str
    spread_points: float
    equity: float
    decided_at_utc: datetime

    def __post_init__(self) -> None:
        _require_utc(self.decided_at_utc, "decided_at_utc")
        if self.accepted:
            _require(all(g.passed for g in self.gates), "accepted decision with a failed gate")
            _require(self.risk is not None and self.risk.approved, "accepted decision without approved risk")

    @property
    def failed_gates(self) -> tuple[GateResult, ...]:
        return tuple(g for g in self.gates if not g.passed)
