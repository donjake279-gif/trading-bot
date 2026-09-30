"""Simulated broker for backtests (ARCHITECTURE §11.1). Pessimistic by design.

* Decision at an M5 close t; the order fills at the open of the first M1 bar at/after t:
  LONG at ask + slippage, SHORT at bid - slippage. That bar's open is also the quote the decision saw.
* Longs are stopped / take profit on the BID, shorts on the ASK (= bid + modelled spread).
* A bar that touches both SL and TP counts as a STOP. A bar that OPENS beyond the stop fills at that
  open (worse than the stop). Stops slip by the expected slippage; take-profits fill exactly at TP.
* Commission is charged per side; swap per rollover (17:00 New York, Mon–Fri), triple on the broker's
  triple-swap weekday.
* Baseline exits (STRATEGY §9, M0) are fixed SL/TP, so each exit is known at entry and computed with a
  vectorised scan. Management variants (STEP 8) will re-scan after each modification.
"""

from __future__ import annotations

import heapq
import itertools
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

import numpy as np

from backtest.cost_model import (
    MINUTE_NS,
    Converter,
    CostModel,
    PriceSeries,
    from_ns,
    to_ns,
)
from backtest.specs import SWAP_CURRENCY_DEPOSIT, SWAP_POINTS, SwapTerms
from core.types import (
    AccountSnapshot,
    AccountTradeMode,
    ClosedTrade,
    Direction,
    ExitReason,
    Quote,
    SymbolSpec,
)

NEW_YORK = ZoneInfo("America/New_York")
MAX_QUOTE_DELAY_NS = 5 * MINUTE_NS  # no M1 bar within 5 minutes after t = market closed, no quote


@dataclass
class SimPosition:
    ticket: int
    symbol: str
    direction: Direction
    volume: float
    entry_price: float
    entry_time: datetime
    sl: float
    tp: float
    risk_amount: float
    risk_pct: float
    signal_id: str
    strategy_version: str
    exit_time: datetime
    exit_price: float
    exit_reason: ExitReason
    mfe_price: float
    mae_price: float
    meta: dict[str, object] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class Exit:
    index: int
    price: float
    reason: ExitReason
    at_open: bool  # filled at the bar's open (gap), else during the bar


class SimBroker:
    def __init__(self, account_currency: str, leverage: int, specs: dict[str, SymbolSpec], swaps: dict[str, SwapTerms],
                 series: dict[str, PriceSeries], converter: Converter, costs: CostModel, initial_balance: float) -> None:
        self.currency = account_currency
        self.leverage = leverage
        self.specs = specs
        self.swaps = swaps
        self.series = series
        self.converter = converter
        self.costs = costs
        self.balance = initial_balance
        self.open: dict[int, SimPosition] = {}
        self._exits: list[tuple[int, int]] = []  # heap of (exit time ns, ticket)
        self._tickets = itertools.count(1)
        self.end_ns: int | None = None  # positions still open here are closed at the last price

    # ------------------------------------------------------------------ market facts
    def quote(self, symbol: str, t: datetime) -> Quote | None:
        s = self.series[symbol]
        t_ns = to_ns(t)
        i = s.first_at_or_after(t_ns)
        if i >= len(s) or s.times[i] - t_ns > MAX_QUOTE_DELAY_NS:
            return None
        bid = float(s.open[i])
        return Quote(symbol, from_ns(int(s.times[i])), bid, bid + float(s.spread[i]))

    def typical_spread_points(self, symbol: str, t: datetime) -> float | None:
        s = self.series[symbol]
        i = s.last_closed(to_ns(t))
        return None if i < 0 else float(s.typical_points[i])

    def value_per_price_unit(self, symbol: str, t: datetime) -> float:
        """Account-currency value of a 1.0 price move for 1.0 lot."""
        spec = self.specs[symbol]
        return spec.contract_size * self.converter.rate(spec.currency_profit, to_ns(t))

    def loss_per_lot(self, symbol: str, entry: float, stop: float, t: datetime) -> float:
        return abs(entry - stop) * self.value_per_price_unit(symbol, t)

    def margin_per_lot(self, symbol: str, price: float, t: datetime) -> float:
        return price * self.value_per_price_unit(symbol, t) / self.leverage

    def equity(self, t: datetime) -> float:
        t_ns = to_ns(t)
        floating = 0.0
        for p in self.open.values():
            s = self.series[p.symbol]
            i = s.last_closed(t_ns)
            if i < 0:
                continue
            mark = s.close[i] if p.direction is Direction.LONG else s.close[i] + s.spread[i]
            floating += int(p.direction) * (mark - p.entry_price) * p.volume * self.value_per_price_unit(p.symbol, t)
        return self.balance + floating

    def used_margin(self, t: datetime) -> float:
        return sum(p.volume * self.margin_per_lot(p.symbol, p.entry_price, t) for p in self.open.values())

    def account(self, t: datetime, equity: float | None = None) -> AccountSnapshot:
        eq = self.equity(t) if equity is None else equity
        margin = self.used_margin(t)
        return AccountSnapshot(login=1, server="SIM", currency=self.currency, trade_mode=AccountTradeMode.DEMO,
                               balance=self.balance, equity=eq, margin=margin, free_margin=eq - margin,
                               leverage=self.leverage, trade_allowed=True, expert_trading_allowed=True, hedging=True,
                               time_utc=t)

    # ------------------------------------------------------------------ orders
    def open_position(self, symbol: str, direction: Direction, volume: float, sl: float, tp: float, t: datetime, *,
                      risk_amount: float, risk_pct: float, signal_id: str, strategy_version: str,
                      meta: dict[str, object] | None = None) -> SimPosition | str:
        """Market order at the first M1 open at/after t. Returns the position, or why it was rejected."""
        s, spec = self.series[symbol], self.specs[symbol]
        t_ns = to_ns(t)
        i = s.first_at_or_after(t_ns)
        if i >= len(s) or s.times[i] - t_ns > MAX_QUOTE_DELAY_NS:
            return "market closed"
        d = int(direction)
        slip = self.costs.slippage_price(spec.point)
        entry = float(s.open[i] + s.spread[i] + slip) if d > 0 else float(s.open[i] - slip)
        if d * (entry - sl) <= spec.stops_level_points * spec.point or d * (tp - entry) <= 0:
            return f"rejected: fill {entry:.5f} leaves no valid stop/target ({sl:.5f} / {tp:.5f})"
        ex = self._find_exit(s, i, d, sl, tp, slip)
        j = ex.index
        hi = s.high[i:j + 1] if d > 0 else s.high[i:j + 1] + s.spread[i:j + 1]
        lo = s.low[i:j + 1] if d > 0 else s.low[i:j + 1] + s.spread[i:j + 1]
        mfe = float(max(0.0, (hi.max() - entry) if d > 0 else (entry - lo.min())))
        mae = float(max(0.0, (entry - lo.min()) if d > 0 else (hi.max() - entry)))
        exit_ns = int(s.times[j]) + (0 if ex.at_open else MINUTE_NS)
        pos = SimPosition(next(self._tickets), symbol, direction, volume, entry, from_ns(int(s.times[i])), sl, tp,
                          risk_amount, risk_pct, signal_id, strategy_version, from_ns(exit_ns), ex.price, ex.reason,
                          mfe, mae, dict(meta or {}))
        self.balance -= self.costs.commission(volume)  # entry side
        self.open[pos.ticket] = pos
        heapq.heappush(self._exits, (exit_ns, pos.ticket))
        return pos

    def _find_exit(self, s: PriceSeries, i: int, d: int, sl: float, tp: float, slip: float) -> Exit:
        n = len(s)
        start, chunk = i, 256
        while start < n:
            end = min(n, start + chunk)
            spr = s.spread[start:end]
            if d > 0:
                sl_hit, tp_hit = s.low[start:end] <= sl, s.high[start:end] >= tp
            else:
                sl_hit, tp_hit = s.high[start:end] + spr >= sl, s.low[start:end] + spr <= tp
            hit = sl_hit | tp_hit
            if hit.any():
                k = int(np.argmax(hit))
                j = start + k
                if sl_hit[k]:  # stop first when both are inside one bar
                    opened_beyond = j > i and ((d > 0 and s.open[j] <= sl) or (d < 0 and s.open[j] + spr[k] >= sl))
                    if opened_beyond:
                        px = s.open[j] - slip if d > 0 else s.open[j] + spr[k] + slip
                        return Exit(j, float(px), ExitReason.STOP_LOSS, True)
                    return Exit(j, float(sl - d * slip), ExitReason.STOP_LOSS, False)
                return Exit(j, float(tp), ExitReason.TAKE_PROFIT, False)
            start, chunk = end, chunk * 2
        last = n - 1
        mark = s.close[last] if d > 0 else s.close[last] + s.spread[last]
        return Exit(last, float(mark), ExitReason.END_OF_TEST, False)

    # ------------------------------------------------------------------ settlement
    def due_exits(self, t: datetime) -> list[SimPosition]:
        """Positions whose exit happened at or before t, in exit-time order."""
        t_ns = to_ns(t)
        out = []
        while self._exits and self._exits[0][0] <= t_ns:
            _, ticket = heapq.heappop(self._exits)
            if ticket in self.open:
                out.append(self.open[ticket])
        return out

    def settle(self, pos: SimPosition, at: datetime | None = None, price: float | None = None,
               reason: ExitReason | None = None) -> ClosedTrade:
        """Close ``pos`` (at its scheduled exit unless overridden) and book the result."""
        del self.open[pos.ticket]
        exit_time = at or pos.exit_time
        exit_price = pos.exit_price if price is None else price
        d = int(pos.direction)
        gross = d * (exit_price - pos.entry_price) * pos.volume * self.value_per_price_unit(pos.symbol, exit_time)
        commission = -2.0 * self.costs.commission(pos.volume)
        swap = self._swap(pos, exit_time)
        self.balance += gross + swap - self.costs.commission(pos.volume)  # exit-side commission
        return ClosedTrade(
            trade_id=str(pos.ticket), signal_id=pos.signal_id, strategy_version=pos.strategy_version,
            symbol=pos.symbol, direction=pos.direction, open_time_utc=pos.entry_time, close_time_utc=exit_time,
            entry_price=pos.entry_price, exit_price=exit_price, initial_sl=pos.sl, initial_tp=pos.tp,
            volume=pos.volume, risk_amount=pos.risk_amount, risk_pct=pos.risk_pct, gross_pnl=gross,
            commission=commission, swap=swap, mfe_price=pos.mfe_price, mae_price=pos.mae_price,
            exit_reason=reason or pos.exit_reason,
        )

    def close_at_end(self, t: datetime) -> list[ClosedTrade]:
        """End of the test: book every open position at the last closed price (reason END_OF_TEST)."""
        out = []
        t_ns = to_ns(t)
        for pos in sorted(self.open.values(), key=lambda p: p.ticket):
            if pos.exit_time <= t:
                out.append(self.settle(pos))
                continue
            s = self.series[pos.symbol]
            i = max(s.last_closed(t_ns), 0)
            mark = s.close[i] if pos.direction is Direction.LONG else s.close[i] + s.spread[i]
            out.append(self.settle(pos, at=t, price=float(mark), reason=ExitReason.END_OF_TEST))
        self._exits.clear()
        return out

    def _swap(self, pos: SimPosition, exit_time: datetime) -> float:
        terms = self.swaps.get(pos.symbol, SwapTerms())
        if terms.mode not in (SWAP_POINTS, SWAP_CURRENCY_DEPOSIT):
            return 0.0
        nights = rollover_nights(pos.entry_time, exit_time, terms.triple_day)
        if nights == 0:
            return 0.0
        rate = terms.long if pos.direction is Direction.LONG else terms.short
        if terms.mode == SWAP_POINTS:
            spec = self.specs[pos.symbol]
            return nights * rate * spec.point * pos.volume * self.value_per_price_unit(pos.symbol, exit_time)
        return nights * rate * pos.volume


def rollover_nights(entry: datetime, exit_time: datetime, triple_day_mql: int = 3) -> int:
    """Swap nights charged between entry and exit: one per 17:00 New York roll Mon–Fri, three on the
    broker's triple day (MQL5 day numbering: 0 = Sunday)."""
    triple_py = (triple_day_mql + 6) % 7  # MQL5 Sunday=0 -> Python Monday=0
    nights = 0
    day = entry.astimezone(NEW_YORK).date()
    last = exit_time.astimezone(NEW_YORK).date()
    while day <= last:
        roll = datetime(day.year, day.month, day.day, 17, 0, tzinfo=NEW_YORK)
        if roll.weekday() < 5 and entry < roll <= exit_time:
            nights += 3 if roll.weekday() == triple_py else 1
        day += timedelta(days=1)
    return nights
