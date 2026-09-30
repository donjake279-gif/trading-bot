"""Cooldown and dedupe (pure policy, architecture layer L2). Spec: ARCHITECTURE §6.5 and §7.

* one entry per setup id (the order attempt consumes the id, filled or not — STRATEGY §4 rule 5);
* at most N entries per symbol per session instance;
* M minutes after any close on the symbol, K minutes after a losing close.

Live, consumed ids are also stored in the journal (unique constraint) and reloaded on restart.
"""

from __future__ import annotations

from collections.abc import Iterable
from datetime import datetime, timedelta

from core.config import CooldownCfg
from core.types import GateResult


class Cooldown:
    def __init__(self, cfg: CooldownCfg, consumed: Iterable[str] = ()) -> None:
        self.cfg = cfg
        self.consumed: set[str] = set(consumed)
        self._session_entries: dict[tuple[str, str], int] = {}
        self._last_close: dict[str, datetime] = {}
        self._last_loss: dict[str, datetime] = {}

    def gate(self, setup_id: str, symbol: str, t_utc: datetime, sessions: tuple[str, ...]) -> GateResult:
        problems: list[str] = []
        if setup_id in self.consumed:
            problems.append("setup already used (one entry per setup)")
        cap = self.cfg.max_entries_per_symbol_per_session
        for s in sessions:
            n = self._session_entries.get((symbol, s), 0)
            if n >= cap:
                problems.append(f"{n} entries on {symbol} in {s} (max {cap})")
        closed = self._last_close.get(symbol)
        if closed is not None and t_utc - closed < timedelta(minutes=self.cfg.minutes_after_close):
            problems.append(f"{(t_utc - closed).total_seconds() / 60:.0f} min since the last close "
                            f"(wait {self.cfg.minutes_after_close})")
        lost = self._last_loss.get(symbol)
        if lost is not None and t_utc - lost < timedelta(minutes=self.cfg.minutes_after_loss):
            problems.append(f"{(t_utc - lost).total_seconds() / 60:.0f} min since the last loss "
                            f"(wait {self.cfg.minutes_after_loss})")
        return GateResult("cooldown", not problems, "; ".join(problems) or "clear")

    def consume(self, setup_id: str) -> bool:
        """Mark the setup used BEFORE the order is sent. False if it was already used."""
        if setup_id in self.consumed:
            return False
        self.consumed.add(setup_id)
        return True

    def record_entry(self, symbol: str, sessions: tuple[str, ...]) -> None:
        for s in sessions:
            self._session_entries[(symbol, s)] = self._session_entries.get((symbol, s), 0) + 1

    def record_close(self, symbol: str, t_utc: datetime, net_pnl: float) -> None:
        self._last_close[symbol] = max(t_utc, self._last_close.get(symbol, t_utc))
        if net_pnl < 0:
            self._last_loss[symbol] = max(t_utc, self._last_loss.get(symbol, t_utc))
