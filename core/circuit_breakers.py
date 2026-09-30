"""Circuit breakers (pure latching state machine, architecture §6.4). Time and equity are passed in.

| Breaker          | Trips when                                          | Resets              |
|------------------|-----------------------------------------------------|---------------------|
| CONSEC_LOSSES    | consecutive losing closes >= max_consecutive_losses | next trading day    |
| DAILY_DD         | (day-start equity - equity) / day-start >= max %    | next trading day    |
| WEEKLY_DD        | same against the week-start equity                  | next trading week   |
| TOTAL_DD         | (high-water mark - equity) / high-water >= max %    | manual only         |
| MAX_TRADES_DAY   | entries today >= max_trades_per_day                 | next trading day    |
| EXCEPTION_RATE   | unhandled exceptions in 60 min >= limit             | manual only         |
| ORDER_FAILURES   | failed/unknown order sends in 60 min >= limit       | manual only         |

Trading days roll at 17:00 New York (DST-aware); weeks at the Sunday 17:00 open. Any active trip blocks
NEW entries only; open positions keep being managed. STEP 9's safety manager persists this state and
rebuilds it from MT5 deal history after a restart; the backtester drives the same object.
"""

from __future__ import annotations

from collections import deque
from datetime import datetime, timedelta

from core.config import CircuitBreakersCfg
from core.timeutils import trading_day_start, trading_week_start
from core.types import BreakerName, BreakerTrip, GateResult

WINDOW = timedelta(minutes=60)
MANUAL = "manual reset only"


class CircuitBreakers:
    def __init__(self, cfg: CircuitBreakersCfg, max_trades_per_day: int, day_zone: str = "America/New_York",
                 day_boundary: str = "17:00") -> None:
        self.cfg = cfg
        self.max_trades_per_day = max_trades_per_day
        self._day = (day_zone, day_boundary)
        self.day_start: datetime | None = None
        self.next_day: datetime | None = None
        self.week_start: datetime | None = None
        self.next_week: datetime | None = None
        self.day_start_equity: float | None = None
        self.week_start_equity: float | None = None
        self.high_water: float | None = None
        self.equity: float | None = None
        self.consecutive_losses = 0
        self.entries_today = 0
        self.trips: dict[BreakerName, BreakerTrip] = {}
        self.history: list[BreakerTrip] = []
        self._exceptions: deque[datetime] = deque()
        self._order_failures: deque[datetime] = deque()

    # ------------------------------------------------------------------ inputs
    def update(self, t: datetime, equity: float) -> list[BreakerTrip]:
        """Call every cycle with the current equity (balance + floating P&L). Returns new trips."""
        self._roll(t, equity)
        self.equity = equity
        self.high_water = equity if self.high_water is None else max(self.high_water, equity)
        new: list[BreakerTrip] = []
        assert self.day_start_equity is not None and self.week_start_equity is not None
        for name, ref, limit, resets in (
            (BreakerName.DAILY_DD, self.day_start_equity, self.cfg.max_daily_drawdown_pct, self._next_day_text()),
            (BreakerName.WEEKLY_DD, self.week_start_equity, self.cfg.max_weekly_drawdown_pct, self._next_week_text()),
            (BreakerName.TOTAL_DD, self.high_water, self.cfg.max_total_drawdown_pct, MANUAL),
        ):
            dd = 100.0 * (ref - equity) / ref if ref > 0 else 0.0
            if dd >= limit:
                new += self._trip(name, dd, limit, t, resets)
        return new

    def on_entry(self, t: datetime, equity: float) -> list[BreakerTrip]:
        self._roll(t, equity)
        self.entries_today += 1
        if self.entries_today >= self.max_trades_per_day:
            return self._trip(BreakerName.MAX_TRADES_DAY, self.entries_today, self.max_trades_per_day, t,
                              self._next_day_text())
        return []

    def on_trade_closed(self, t: datetime, net_pnl: float, equity_after: float) -> list[BreakerTrip]:
        self._roll(t, equity_after - net_pnl)  # a close after the roll belongs to the new day
        self.consecutive_losses = self.consecutive_losses + 1 if net_pnl < 0 else 0
        if self.consecutive_losses >= self.cfg.max_consecutive_losses:
            return self._trip(BreakerName.CONSEC_LOSSES, self.consecutive_losses, self.cfg.max_consecutive_losses, t,
                              self._next_day_text())
        return []

    def on_exception(self, t: datetime) -> list[BreakerTrip]:
        return self._rate(self._exceptions, t, BreakerName.EXCEPTION_RATE, self.cfg.max_exceptions_per_hour)

    def on_order_failure(self, t: datetime) -> list[BreakerTrip]:
        return self._rate(self._order_failures, t, BreakerName.ORDER_FAILURES, self.cfg.max_order_failures_per_hour)

    def reset(self, breaker: BreakerName) -> bool:
        """Manual reset (dashboard RESET_BREAKER). Resetting TOTAL_DD re-bases the high-water mark on the
        current equity, otherwise it would trip again at once."""
        if breaker not in self.trips:
            return False
        del self.trips[breaker]
        if breaker is BreakerName.TOTAL_DD and self.equity is not None:
            self.high_water = self.equity
        return True

    # ------------------------------------------------------------------ outputs
    @property
    def can_open_new(self) -> bool:
        return not self.trips

    @property
    def drawdown_pct(self) -> float:
        """Current drawdown from the high-water mark, % (for the optional risk reduction)."""
        if self.high_water is None or self.equity is None or self.high_water <= 0:
            return 0.0
        return max(0.0, 100.0 * (self.high_water - self.equity) / self.high_water)

    def gate(self) -> GateResult:
        if not self.trips:
            return GateResult("safety", True, "no circuit breaker tripped")
        text = "; ".join(f"{b.value} tripped ({trip.measured:.2f} >= {trip.threshold:g}), resets {trip.resets}"
                         for b, trip in self.trips.items())
        return GateResult("safety", False, text, {"tripped": ", ".join(b.value for b in self.trips)})

    # ------------------------------------------------------------------ internals
    def _trip(self, name: BreakerName, measured: float, threshold: float, t: datetime,
              resets: str) -> list[BreakerTrip]:
        if name in self.trips:
            return []
        trip = BreakerTrip(name, float(measured), float(threshold), t, resets)
        self.trips[name] = trip
        self.history.append(trip)
        return [trip]

    def _rate(self, q: deque[datetime], t: datetime, name: BreakerName, limit: int) -> list[BreakerTrip]:
        q.append(t)
        while q and t - q[0] > WINDOW:
            q.popleft()
        return self._trip(name, len(q), limit, t, MANUAL) if len(q) >= limit else []

    def _roll(self, t: datetime, equity: float) -> None:
        if self.next_day is None or t >= self.next_day:
            self.day_start = trading_day_start(t, *self._day)
            self.next_day = trading_day_start(self.day_start + timedelta(hours=26), *self._day)
            self.day_start_equity = equity
            self.entries_today = 0
            self.consecutive_losses = 0
            for b in (BreakerName.CONSEC_LOSSES, BreakerName.DAILY_DD, BreakerName.MAX_TRADES_DAY):
                self.trips.pop(b, None)
        if self.next_week is None or t >= self.next_week:
            self.week_start = trading_week_start(t)
            self.next_week = trading_week_start(self.week_start + timedelta(days=7, hours=2))
            self.week_start_equity = equity
            self.trips.pop(BreakerName.WEEKLY_DD, None)
        if self.high_water is None:
            self.high_water = equity

    def _next_day_text(self) -> str:
        return f"next trading day {self.next_day.isoformat()}" if self.next_day else "next trading day"

    def _next_week_text(self) -> str:
        return f"next trading week {self.next_week.isoformat()}" if self.next_week else "next trading week"
