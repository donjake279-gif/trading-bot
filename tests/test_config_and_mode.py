"""Config validation and demo/live safety gate."""

from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml

from core.config import LIVE_ACK_PHRASE, ConfigError, Credentials, load_settings
from core.mode_guard import resolve_run_mode
from core.types import AccountSnapshot, AccountTradeMode, RunMode

ROOT = Path(__file__).resolve().parents[1]
CFG = ROOT / "config" / "settings.yaml"


def _write(tmp_path: Path, mutate) -> Path:  # type: ignore[no-untyped-def]
    raw = yaml.safe_load(CFG.read_text(encoding="utf-8"))
    mutate(raw)
    p = tmp_path / "s.yaml"
    p.write_text(yaml.safe_dump(raw), encoding="utf-8")
    return p


def test_shipped_config_is_valid() -> None:
    s = load_settings(CFG)
    assert s.app.mode == "demo" and s.live.enabled is False
    assert s.symbol_names == ["EURUSD", "GBPUSD", "AUDUSD", "USDJPY", "EURAUD"]


@pytest.mark.parametrize("mutate, fragment", [
    (lambda r: r["risk"].update(risk_per_trade_pct=5.0), "risk_per_trade_pct"),
    (lambda r: r["risk"].update(risk_pct_typo=1), "risk_pct_typo"),                  # unknown key
    (lambda r: r["scoring"].update(volatility=20), "sum to 100"),
    (lambda r: r["execution"].update(max_retries=10), "max_retries"),
    (lambda r: r["cooldown"].update(one_entry_per_setup=False), "one_entry_per_setup"),
    (lambda r: r["circuit_breakers"].update(max_daily_drawdown_pct=9.0), "daily <= weekly"),
    (lambda r: r["backtest"]["splits"]["validation"].update(start="2023-06-01"), "chronological"),
    (lambda r: r["broker_time"].update(rule="gmt+2"), "broker_time"),
    (lambda r: r["risk"]["drawdown_risk_reduction"].update(risk_multiplier=2.0), "risk_multiplier"),
])
def test_unsafe_or_wrong_config_rejected(tmp_path: Path, mutate, fragment: str) -> None:  # type: ignore[no-untyped-def]
    with pytest.raises(ConfigError, match=fragment):
        load_settings(_write(tmp_path, mutate))


def _acct(mode: AccountTradeMode, login: int = 90518081) -> AccountSnapshot:
    return AccountSnapshot(login, "MEXAtlantic-Demo", "USD", mode, 10000, 10000, 0, 10000, 500, True, True, True,
                           datetime(2026, 9, 28, tzinfo=timezone.utc))


def test_demo_config_refuses_real_account() -> None:
    s = load_settings(CFG)
    d = resolve_run_mode(s, _acct(AccountTradeMode.REAL), Credentials())
    assert not d.allowed and not d.may_send_orders and "REAL" in d.problems[0]


def test_demo_on_demo_ok() -> None:
    d = resolve_run_mode(load_settings(CFG), _acct(AccountTradeMode.DEMO), Credentials())
    assert d.allowed and d.may_send_orders and d.mode is RunMode.DEMO and "DEMO" in d.banner


def test_live_requires_all_three_confirmations(tmp_path: Path) -> None:
    def to_live(r: dict) -> None:  # type: ignore[type-arg]
        r["app"]["mode"] = "live"

    s = load_settings(_write(tmp_path, to_live))
    d = resolve_run_mode(s, _acct(AccountTradeMode.REAL), Credentials())
    assert not d.allowed and len(d.problems) == 3

    def full_live(r: dict) -> None:  # type: ignore[type-arg]
        r["app"]["mode"] = "live"
        r["live"].update(enabled=True, acknowledge_risk=LIVE_ACK_PHRASE)

    s2 = load_settings(_write(tmp_path, full_live))
    wrong_acct = resolve_run_mode(s2, _acct(AccountTradeMode.REAL), Credentials(live_confirm="11111"))
    assert not wrong_acct.allowed  # env var tied to a DIFFERENT account number
    ok = resolve_run_mode(s2, _acct(AccountTradeMode.REAL), Credentials(live_confirm="90518081"))
    assert ok.allowed and ok.may_send_orders and "LIVE" in ok.banner
    on_demo = resolve_run_mode(s2, _acct(AccountTradeMode.DEMO), Credentials(live_confirm="90518081"))
    assert not on_demo.allowed


def test_shadow_never_sends_orders() -> None:
    raw_s = load_settings(CFG).model_copy(update={"app": load_settings(CFG).app.model_copy(update={"mode": "shadow"})})
    d = resolve_run_mode(raw_s, _acct(AccountTradeMode.DEMO), Credentials())
    assert d.allowed and not d.may_send_orders
