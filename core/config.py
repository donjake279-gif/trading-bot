"""Typed, strictly validated configuration.

* Unknown keys anywhere are rejected (a typo must never silently disable a safety rule).
* Values are range-checked; risk limits cannot be set to unsafe values by accident.
* Credentials come only from environment variables / .env, never from YAML.
"""

from __future__ import annotations

import os
from datetime import date
from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator, model_validator

from core.errors import ConfigError
from core.timeutils import BrokerTimeRule, parse_hhmm
from core.types import Timeframe

LIVE_ACK_PHRASE = "I UNDERSTAND REAL MONEY IS AT RISK"
DEFAULT_CONFIG_PATH = Path(__file__).resolve().parents[1] / "config" / "settings.yaml"

TimeframeName = Literal["M1", "M5", "M15", "M30", "H1", "H4", "D1"]


class _Strict(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True)


# ----------------------------------------------------------------------------- sections


class AppCfg(_Strict):
    mode: Literal["demo", "shadow", "live", "backtest"] = "demo"
    strategy_code: str = Field(min_length=1, max_length=8)
    strategy_version: str
    magic_base: int = Field(gt=0, lt=2_000_000_000)
    timezone_display: str = "UTC"


class LiveCfg(_Strict):
    enabled: bool = False
    acknowledge_risk: str = ""
    startup_entry_delay_seconds: int = Field(ge=0)


class Mt5Cfg(_Strict):
    attach_to_running_terminal: bool = True
    connect_timeout_ms: int = Field(ge=1000)
    reconnect_backoff_max_seconds: int = Field(ge=1)
    auto_resolve_symbol_suffix: bool = True


class BrokerTimeCfg(_Strict):
    rule: str
    max_offset_mismatch_minutes: int = Field(ge=0)
    max_local_clock_drift_seconds_warn: int = Field(ge=0)
    max_local_clock_drift_seconds_block: int = Field(ge=1)

    @field_validator("rule")
    @classmethod
    def _valid_rule(cls, v: str) -> str:
        BrokerTimeRule.parse(v)  # raises ConfigError on bad input
        return v

    def parsed_rule(self) -> BrokerTimeRule:
        return BrokerTimeRule.parse(self.rule)


class TradingDayCfg(_Strict):
    boundary_timezone: str
    boundary_time: str

    @field_validator("boundary_time")
    @classmethod
    def _hhmm(cls, v: str) -> str:
        parse_hhmm(v)
        return v


class LoopCfg(_Strict):
    poll_interval_ms: int = Field(ge=100, le=10_000)
    management_timeframe: TimeframeName


class SymbolCfg(_Strict):
    name: str = Field(min_length=3)
    max_spread_points: int = Field(gt=0)
    backtest_min_spread_points: int = Field(ge=0)


class TimeframesCfg(_Strict):
    context: TimeframeName
    structure: TimeframeName
    setup: TimeframeName
    entry: TimeframeName
    bars_to_load: dict[TimeframeName, int]

    @model_validator(mode="after")
    def _ordering(self) -> TimeframesCfg:
        ctx, struct, entry = (Timeframe.parse(x).minutes for x in (self.context, self.structure, self.entry))
        if not ctx >= struct >= entry:
            raise ValueError("timeframes must satisfy context >= structure >= entry")
        for tf in (self.context, self.structure, self.setup, self.entry):
            if tf not in self.bars_to_load:
                raise ValueError(f"bars_to_load missing {tf}")
        return self

    def roles(self) -> dict[str, Timeframe]:
        return {r: Timeframe.parse(getattr(self, r)) for r in ("context", "structure", "setup", "entry")}


class DataCfg(_Strict):
    max_tick_age_seconds: int = Field(ge=1)
    bar_grace_seconds: int = Field(ge=0)
    closed_bar_settle_seconds: int = Field(ge=1, le=60)
    download_chunk_days: int = Field(ge=1, le=366)


class StrategyCfg(_Strict):
    name: str
    target_rr: float = Field(ge=1.0, le=5.0)
    stop_buffer_atr5: float = Field(ge=0.0, le=2.0)
    pullback_r_min: float = Field(gt=0.0, lt=1.0)
    atr_period: int = Field(ge=2)
    swing_k: dict[TimeframeName, int]
    swing_min_atr: float = Field(ge=0)
    equal_level_atr: float = Field(ge=0)
    sweep_max_depth_atr: float = Field(gt=0)
    min_impulse_atr15: float = Field(gt=0)
    max_leg_age_m15_bars: int = Field(ge=1)
    stop_min_atr15: float = Field(gt=0)
    stop_max_atr15: float = Field(gt=0)
    min_obstacle_R: float = Field(ge=0)
    min_net_rr: float = Field(ge=0.5)
    htf_mode: Literal["veto_opposite", "score_only"]
    min_score: float = Field(ge=0, le=100)
    regime_trend_max_bars: int = Field(ge=1)
    compression_bars: int = Field(ge=2)
    compression_atr: float = Field(gt=0)
    momentum_bars: int = Field(ge=1)

    @model_validator(mode="after")
    def _stops(self) -> StrategyCfg:
        if self.stop_min_atr15 >= self.stop_max_atr15:
            raise ValueError("stop_min_atr15 must be < stop_max_atr15")
        return self


class ScoringCfg(_Strict):
    market_structure: float = Field(ge=0)
    trend_alignment: float = Field(ge=0)
    liquidity_event: float = Field(ge=0)
    entry_confirmation: float = Field(ge=0)
    volatility: float = Field(ge=0)
    risk_reward: float = Field(ge=0)
    htf_confirmation: float = Field(ge=0)

    @model_validator(mode="after")
    def _sum_100(self) -> ScoringCfg:
        total = sum(self.model_dump().values())
        if abs(total - 100) > 1e-9:
            raise ValueError(f"scoring weights must sum to 100, got {total}")
        return self


class DrawdownReductionCfg(_Strict):
    enabled: bool
    drawdown_pct_threshold: float = Field(gt=0)
    risk_multiplier: float = Field(gt=0, le=1.0)  # may only REDUCE risk


class RiskCfg(_Strict):
    risk_per_trade_pct: float = Field(ge=0.1, le=1.0)
    sizing_equity_base: Literal["equity", "balance", "min_balance_equity"]
    max_open_positions: int = Field(ge=1, le=20)
    max_positions_per_symbol: int = Field(ge=1, le=3)
    max_trades_per_day: int = Field(ge=1)
    max_currency_risk_pct: float = Field(gt=0, le=5)
    max_correlated_risk_pct: float = Field(gt=0, le=5)
    max_margin_usage: float = Field(gt=0, le=0.9)
    max_volume_per_trade: float = Field(gt=0)
    drawdown_risk_reduction: DrawdownReductionCfg


class CorrelationCfg(_Strict):
    lookback_days: int = Field(ge=10)
    timeframe: TimeframeName
    threshold_abs: float = Field(gt=0, lt=1)


class CloseOnTripCfg(_Strict):
    consec_losses: bool
    daily_dd: bool
    weekly_dd: bool
    total_dd: bool


class CircuitBreakersCfg(_Strict):
    max_consecutive_losses: int = Field(ge=1)
    max_daily_drawdown_pct: float = Field(gt=0, le=10)
    max_weekly_drawdown_pct: float = Field(gt=0, le=20)
    max_total_drawdown_pct: float = Field(gt=0, le=50)
    max_exceptions_per_hour: int = Field(ge=1)
    max_order_failures_per_hour: int = Field(ge=1)
    close_positions_on_trip: CloseOnTripCfg

    @model_validator(mode="after")
    def _nested(self) -> CircuitBreakersCfg:
        if not self.max_daily_drawdown_pct <= self.max_weekly_drawdown_pct <= self.max_total_drawdown_pct:
            raise ValueError("drawdown limits must satisfy daily <= weekly <= total")
        return self


class SafetyCfg(_Strict):
    symbol_quarantine_cycles: int = Field(ge=1)


class SessionDef(_Strict):
    timezone: str
    start: str
    end: str

    @field_validator("start", "end")
    @classmethod
    def _hhmm(cls, v: str) -> str:
        parse_hhmm(v)
        return v


class SessionsCfg(_Strict):
    definitions: dict[str, SessionDef]
    overlap_london_ny: bool
    allowed_for_entries: list[str]
    avoid_minutes_around_day_roll: int = Field(ge=0)

    @model_validator(mode="after")
    def _known(self) -> SessionsCfg:
        unknown = set(self.allowed_for_entries) - set(self.definitions)
        if unknown:
            raise ValueError(f"allowed_for_entries references undefined sessions: {sorted(unknown)}")
        return self


class SpreadCfg(_Strict):
    window_minutes: int = Field(ge=10)
    max_multiple_of_typical: float = Field(ge=1.0)


class ExecutionCfg(_Strict):
    max_deviation_points: int = Field(ge=0)
    max_retries: int = Field(ge=0, le=3)  # hard cap: never spam orders
    retry_backoff_ms: int = Field(ge=100)
    max_cost_R: float = Field(gt=0, le=0.5)
    verify_window_seconds: int = Field(ge=10)
    min_seconds_between_modifications: int = Field(ge=1)


class CostsCfg(_Strict):
    commission_per_lot_per_side: float = Field(ge=0)
    expected_slippage_points: float = Field(ge=0)


class VolatilityFilterCfg(_Strict):
    atr_period: int = Field(ge=2)
    atr_percentile_lookback: int = Field(ge=50)
    min_percentile: float = Field(ge=0, le=100)
    max_percentile: float = Field(ge=0, le=100)


class NewsCfg(_Strict):
    enabled: bool
    feed_file: str
    importance: list[Literal["high", "medium", "low"]]
    before_minutes: int = Field(ge=0)
    after_minutes: int = Field(ge=0)
    max_feed_age_minutes: int = Field(ge=1)
    on_unavailable: Literal["block_entries", "ignore"]


class CooldownCfg(_Strict):
    one_entry_per_setup: Literal[True]  # cannot be disabled
    max_entries_per_symbol_per_session: int = Field(ge=1)
    minutes_after_close: int = Field(ge=0)
    minutes_after_loss: int = Field(ge=0)


class BreakEvenCfg(_Strict):
    enabled: bool
    trigger_R: float = Field(gt=0)
    offset_points: int = Field(ge=0)


class PartialCloseCfg(_Strict):
    enabled: bool
    trigger_R: float = Field(gt=0)
    fraction: float = Field(gt=0, lt=1)


class AtrTrailingCfg(_Strict):
    enabled: bool
    atr_period: int = Field(ge=2)
    atr_multiple: float = Field(gt=0)
    activate_R: float = Field(ge=0)


class StructureTrailingCfg(_Strict):
    enabled: bool
    activate_R: float = Field(ge=0)


class TimeExitCfg(_Strict):
    enabled: bool
    max_bars: int = Field(ge=1)


class ManagementCfg(_Strict):
    break_even: BreakEvenCfg
    partial_close: PartialCloseCfg
    atr_trailing: AtrTrailingCfg
    structure_trailing: StructureTrailingCfg
    time_exit: TimeExitCfg


class StorageCfg(_Strict):
    live_db: str
    research_db: str
    emergency_log_dir: str


class DashboardCfg(_Strict):
    refresh_seconds: int = Field(ge=1)
    command_ttl_seconds: int = Field(ge=5, le=300)


class PeriodCfg(_Strict):
    start: date
    end: date | Literal["latest"]


class SplitsCfg(_Strict):
    development: PeriodCfg
    validation: PeriodCfg
    final_oos: PeriodCfg

    @model_validator(mode="after")
    def _ordered(self) -> SplitsCfg:
        dev_end, val_end = self.development.end, self.validation.end
        if dev_end == "latest" or val_end == "latest":
            raise ValueError("only final_oos may end at 'latest'")
        if not (self.development.start <= dev_end < self.validation.start <= val_end < self.final_oos.start):
            raise ValueError("splits must be chronological and non-overlapping: development < validation < final_oos")
        return self


class BacktestCfg(_Strict):
    base_timeframe: Literal["M1"]
    history_dir: str
    splits: SplitsCfg
    initial_balance: float = Field(gt=0)
    intrabar_conflict: Literal["stop_first"]  # the only honest default; no optimistic option offered
    random_seed: int
    cost_stress_multipliers: list[float]


class WalkForwardCfg(_Strict):
    train_months: int = Field(ge=3)
    test_months: int = Field(ge=1)
    step_months: int = Field(ge=1)
    max_parameters: int = Field(ge=1, le=3)
    max_values_per_parameter: int = Field(ge=2, le=5)
    selection: Literal["plateau_median"]


class MonteCarloCfg(_Strict):
    simulations: int = Field(ge=100)
    methods: list[Literal["iid_bootstrap", "block_bootstrap"]]
    block_length_trades: int = Field(ge=2)
    ruin_drawdown_pct: float = Field(gt=0, le=100)


class RobustnessCfg(_Strict):
    min_trades_total: int = Field(ge=30)
    min_trades_per_bucket: int = Field(ge=10)
    max_symbol_profit_share: float = Field(gt=0, le=1)
    max_month_profit_share: float = Field(gt=0, le=1)
    min_validation_to_dev_ratio: float = Field(ge=0)
    max_param_neighbour_change: float = Field(gt=0)


# ----------------------------------------------------------------------------- root


class Settings(_Strict):
    app: AppCfg
    live: LiveCfg
    mt5: Mt5Cfg
    broker_time: BrokerTimeCfg
    trading_day: TradingDayCfg
    loop: LoopCfg
    symbols: list[SymbolCfg] = Field(min_length=1)
    timeframes: TimeframesCfg
    data: DataCfg
    strategy: StrategyCfg
    scoring: ScoringCfg
    risk: RiskCfg
    correlation: CorrelationCfg
    circuit_breakers: CircuitBreakersCfg
    safety: SafetyCfg
    sessions: SessionsCfg
    spread: SpreadCfg
    execution: ExecutionCfg
    costs: CostsCfg
    volatility_filter: VolatilityFilterCfg
    news: NewsCfg
    cooldown: CooldownCfg
    management: ManagementCfg
    storage: StorageCfg
    dashboard: DashboardCfg
    backtest: BacktestCfg
    walk_forward: WalkForwardCfg
    monte_carlo: MonteCarloCfg
    robustness: RobustnessCfg

    @model_validator(mode="after")
    def _unique_symbols(self) -> Settings:
        names = [s.name for s in self.symbols]
        if len(names) != len(set(names)):
            raise ValueError(f"duplicate symbols: {names}")
        return self

    @property
    def symbol_names(self) -> list[str]:
        return [s.name for s in self.symbols]

    def symbol_cfg(self, name: str) -> SymbolCfg:
        for s in self.symbols:
            if s.name == name:
                return s
        raise KeyError(name)


class Credentials(BaseModel):
    """Loaded only from environment variables (.env supported). Never logged."""

    model_config = ConfigDict(frozen=True)

    terminal_path: str | None = None
    login: int | None = None
    password: str | None = Field(default=None, repr=False)
    server: str | None = None
    live_confirm: str | None = Field(default=None, repr=False)


def load_settings(path: Path | str = DEFAULT_CONFIG_PATH) -> Settings:
    path = Path(path)
    if not path.exists():
        raise ConfigError(f"Config file not found: {path}")
    try:
        raw = yaml.safe_load(path.read_text(encoding="utf-8"))
    except yaml.YAMLError as exc:
        raise ConfigError(f"YAML syntax error in {path}: {exc}") from exc
    if not isinstance(raw, dict):
        raise ConfigError(f"{path} must contain a mapping at top level")
    try:
        return Settings.model_validate(raw)
    except ValidationError as exc:
        raise ConfigError(f"Invalid configuration in {path}:\n{exc}") from exc


def load_credentials(env_file: Path | str | None = None) -> Credentials:
    """Read MT5_* variables from the environment, optionally loading a .env file first."""
    if env_file is not None and Path(env_file).exists():
        from dotenv import load_dotenv

        load_dotenv(env_file, override=False)

    def _get(name: str) -> str | None:
        value = os.environ.get(name, "").strip()
        return value or None

    login_text = _get("MT5_LOGIN")
    try:
        login = int(login_text) if login_text else None
    except ValueError as exc:
        raise ConfigError("MT5_LOGIN must be a number") from exc
    return Credentials(
        terminal_path=_get("MT5_TERMINAL_PATH"),
        login=login,
        password=_get("MT5_PASSWORD"),
        server=_get("MT5_SERVER"),
        live_confirm=_get("MT5BOT_LIVE_CONFIRM"),
    )
