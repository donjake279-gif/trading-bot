"""Demo/live safety gate (ARCHITECTURE §9). Pure function: config + observed account -> decision.

The mode shown to the user is always derived from the account the terminal is ACTUALLY
logged into, never from the config file alone.
"""

from __future__ import annotations

from dataclasses import dataclass

from core.config import LIVE_ACK_PHRASE, Credentials, Settings
from core.types import AccountSnapshot, AccountTradeMode, RunMode


@dataclass(frozen=True, slots=True)
class ModeDecision:
    allowed: bool
    mode: RunMode
    may_send_orders: bool
    banner: str
    problems: tuple[str, ...]
    warnings: tuple[str, ...]


def resolve_run_mode(settings: Settings, account: AccountSnapshot, creds: Credentials) -> ModeDecision:
    mode = RunMode(settings.app.mode)
    problems: list[str] = []
    warnings: list[str] = []
    fake_money = account.trade_mode in (AccountTradeMode.DEMO, AccountTradeMode.CONTEST)

    if settings.live.enabled and mode is not RunMode.LIVE:
        warnings.append("live.enabled is true but app.mode is not 'live' — live stays OFF")

    if mode is RunMode.BACKTEST:
        problems.append("app.mode is 'backtest'; use the backtest command, not live trading")
    elif mode is RunMode.DEMO:
        if not fake_money:
            problems.append(
                f"app.mode is 'demo' but the terminal is logged into a REAL account ({account.login}). "
                "Refusing to start. Log into a demo account."
            )
    elif mode is RunMode.SHADOW:
        if not fake_money:
            warnings.append("SHADOW mode on a REAL account: no orders will be sent")
    elif mode is RunMode.LIVE:
        if fake_money:
            problems.append("app.mode is 'live' but the connected account is DEMO — config/account mismatch")
        if not settings.live.enabled:
            problems.append("live.enabled must be true")
        if settings.live.acknowledge_risk != LIVE_ACK_PHRASE:
            problems.append(f"live.acknowledge_risk must equal exactly: {LIVE_ACK_PHRASE}")
        if creds.live_confirm != str(account.login):
            problems.append("environment variable MT5BOT_LIVE_CONFIRM must equal the REAL account login number")

    allowed = not problems
    may_send = allowed and mode in (RunMode.DEMO, RunMode.LIVE)
    if not allowed:
        banner = "BLOCKED — see problems"
    elif mode is RunMode.LIVE:
        banner = "!!! LIVE MODE — REAL MONEY AT RISK !!!"
    elif mode is RunMode.SHADOW:
        banner = "SHADOW MODE — orders are never sent"
    else:
        banner = "DEMO MODE — fake money"
    return ModeDecision(allowed, mode, may_send, banner, tuple(problems), tuple(warnings))
