"""STEP 1 tests: safety invariants of the message contracts + architecture rules."""

from __future__ import annotations

import ast
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytest
import yaml

from core.types import (
    ActionKind,
    ClosedTrade,
    ContractViolation,
    Direction,
    ExitReason,
    ManagementAction,
    MarketSnapshot,
    OrderIntent,
    Quote,
    RiskDecision,
    ScoreComponent,
    ScoredSignal,
    SetupCandidate,
    Timeframe,
    make_setup_id,
)

ROOT = Path(__file__).resolve().parents[1]
T0 = datetime(2024, 3, 4, 10, 0, tzinfo=timezone.utc)


def _intent(**overrides: object) -> OrderIntent:
    base: dict[str, object] = dict(
        signal_id="a" * 40, strategy_version="1.0.0", symbol="EURUSD", direction=Direction.LONG,
        volume=0.10, entry_ref=1.1000, sl=1.0950, tp=1.1100, max_deviation_points=10,
        magic=731001, comment="S1v1:aaaaaaaaaaaa",
    )
    base.update(overrides)
    return OrderIntent(**base)  # type: ignore[arg-type]


# ----------------------------------------------------------------- stop-loss invariants

def test_valid_long_and_short_orders() -> None:
    _intent()
    _intent(direction=Direction.SHORT, sl=1.1050, tp=1.0900)


@pytest.mark.parametrize("sl", [0.0, -1.0, float("nan")])
def test_order_without_valid_stop_is_impossible(sl: float) -> None:
    with pytest.raises(ContractViolation):
        _intent(sl=sl)


def test_stop_on_wrong_side_rejected() -> None:
    with pytest.raises(ContractViolation):
        _intent(sl=1.1010)  # long with SL above entry
    with pytest.raises(ContractViolation):
        _intent(direction=Direction.SHORT, sl=1.0950, tp=1.0900)


def test_comment_length_limit() -> None:
    with pytest.raises(ContractViolation):
        _intent(comment="x" * 32)
    assert len(OrderIntent.build_comment("S1v1", "f" * 40)) <= 31


def test_zero_volume_rejected() -> None:
    with pytest.raises(ContractViolation):
        _intent(volume=0.0)


# ----------------------------------------------------------------- stop may only tighten

def test_stop_can_only_tighten() -> None:
    ManagementAction(1, "EURUSD", Direction.LONG, ActionKind.MODIFY_SL, "be", current_sl=1.095, new_sl=1.100)
    ManagementAction(2, "EURUSD", Direction.SHORT, ActionKind.MODIFY_SL, "trail", current_sl=1.105, new_sl=1.101)
    with pytest.raises(ContractViolation):
        ManagementAction(1, "EURUSD", Direction.LONG, ActionKind.MODIFY_SL, "bad", current_sl=1.095, new_sl=1.090)
    with pytest.raises(ContractViolation):
        ManagementAction(2, "EURUSD", Direction.SHORT, ActionKind.MODIFY_SL, "bad", current_sl=1.105, new_sl=1.110)


# ----------------------------------------------------------------- look-ahead guard

def _bars(last_open: datetime, n: int, tf: Timeframe) -> pd.DataFrame:
    times = [last_open - tf.delta * (n - 1 - i) for i in range(n)]
    return pd.DataFrame({
        "time_open_utc": pd.to_datetime(times, utc=True),
        "open": 1.1, "high": 1.1, "low": 1.1, "close": 1.1, "tick_volume": 1, "spread_points": 6,
    })


def test_snapshot_accepts_closed_bars() -> None:
    # H1 bar opened 09:00 closes 10:00 → visible at 10:00
    MarketSnapshot("EURUSD", T0, {Timeframe.H1: _bars(T0 - timedelta(hours=1), 5, Timeframe.H1)})


def test_snapshot_rejects_forming_bar() -> None:
    # H1 bar opened 10:00 is still forming at 10:05 → must be rejected
    with pytest.raises(ContractViolation, match="LOOK-AHEAD"):
        MarketSnapshot("EURUSD", T0 + timedelta(minutes=5), {Timeframe.H1: _bars(T0, 5, Timeframe.H1)})


def test_naive_timestamps_rejected() -> None:
    with pytest.raises(ContractViolation):
        Quote("EURUSD", datetime(2024, 1, 1, 12), 1.1, 1.1001)


# ----------------------------------------------------------------- setup ids and scoring

def test_setup_id_is_deterministic_and_event_specific() -> None:
    a = make_setup_id("1.0.0", "EURUSD", Direction.LONG, ("swing@2024-03-04T09:15Z", "bos@2024-03-04T09:45Z"))
    b = make_setup_id("1.0.0", "EURUSD", Direction.LONG, ("swing@2024-03-04T09:15Z", "bos@2024-03-04T09:45Z"))
    c = make_setup_id("1.0.0", "EURUSD", Direction.LONG, ("swing@2024-03-04T09:15Z", "bos@2024-03-04T10:00Z"))
    assert a == b != c


def test_score_component_bounds_and_reason_required() -> None:
    with pytest.raises(ContractViolation):
        ScoreComponent("trend", 16, 15, "too many points")
    with pytest.raises(ContractViolation):
        ScoreComponent("trend", 10, 15, "   ")


def test_scored_signal_total() -> None:
    cand = SetupCandidate(
        "id", "1.0.0", "EURUSD", Direction.LONG, Timeframe.M15, T0, 1.1000, 1.0980, 1.1040, 1.0980,
        T0 + timedelta(hours=1),
    )
    sig = ScoredSignal(cand, (ScoreComponent("a", 10, 20, "r"), ScoreComponent("b", 5, 15, "r")))
    assert sig.total == 15 and sig.max_total == 35
    assert cand.gross_rr == pytest.approx(2.0)


def test_rejected_risk_needs_reason() -> None:
    with pytest.raises(ContractViolation):
        RiskDecision(False, 0.0, 0.0, 0.0, 0.0, 0.0, ())


def test_r_multiple_uses_initial_risk_and_net_pnl() -> None:
    t = ClosedTrade(
        "t1", "s1", "1.0.0", "EURUSD", Direction.LONG, T0, T0 + timedelta(hours=2), 1.1, 1.11, 1.095, 1.11,
        0.1, 50.0, 0.5, gross_pnl=100.0, commission=-7.0, swap=-1.0, mfe_price=0.011, mae_price=0.002,
        exit_reason=ExitReason.TAKE_PROFIT,
    )
    assert t.r_multiple == pytest.approx(92.0 / 50.0)


# ----------------------------------------------------------------- architecture rules

PURE_MODULES = {
    "indicators", "market_structure", "strategy", "signal_engine", "position_sizer",
    "exposure", "exits", "session_manager", "filters", "types", "risk_manager", "cooldown",
    "circuit_breakers", "gates",
}
FORBIDDEN_FOR_PURE = {"MetaTrader5", "sqlite3", "requests", "streamlit", "core.mt5_connection",
                      "core.orchestrator", "storage", "backtest", "dashboard"}


def _imports(path: Path) -> set[str]:
    tree = ast.parse(path.read_text(encoding="utf-8"))
    names: set[str] = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            names.update(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom) and node.module:
            names.add(node.module)
    return names


def _py_files() -> list[Path]:
    return [p for p in ROOT.rglob("*.py") if ".venv" not in p.parts and "tests" not in p.parts]


def test_metatrader5_imported_only_by_adapter() -> None:
    offenders = [p for p in _py_files() if "MetaTrader5" in _imports(p) and p.name != "mt5_connection.py"]
    assert not offenders, f"MetaTrader5 imported outside core/mt5_connection.py: {offenders}"


def test_pure_modules_have_no_io_dependencies() -> None:
    for p in (ROOT / "core").glob("*.py"):
        if p.stem in PURE_MODULES:
            bad = {i for i in _imports(p) if any(i == f or i.startswith(f + ".") for f in FORBIDDEN_FOR_PURE)}
            assert not bad, f"{p.name} (pure layer) imports {bad}"


def test_no_direct_wall_clock_in_core() -> None:
    allowed = {"clock.py", "mt5_connection.py", "logging_setup.py"}
    for p in (ROOT / "core").glob("*.py"):
        if p.name in allowed:
            continue
        src = p.read_text(encoding="utf-8")
        assert "datetime.now(" not in src and "utcnow(" not in src, f"{p.name} reads the wall clock; use Clock"


# ----------------------------------------------------------------- config sanity

def test_settings_defaults_are_safe() -> None:
    cfg = yaml.safe_load((ROOT / "config" / "settings.yaml").read_text(encoding="utf-8"))
    assert cfg["app"]["mode"] == "demo"
    assert cfg["live"]["enabled"] is False
    assert sum(cfg["scoring"].values()) == 100
    assert 0.1 <= cfg["risk"]["risk_per_trade_pct"] <= 1.0
    splits = cfg["backtest"]["splits"]
    assert splits["development"]["end"] < splits["validation"]["start"]
    assert splits["validation"]["end"] < splits["final_oos"]["start"]
