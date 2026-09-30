"""Strategy S1 — Structure Pullback Continuation (pure, architecture layer L2). Spec: docs/STRATEGY.md §3–6, §13.

S1 is evaluated only when its trigger fires: a CHoCH on the entry timeframe (M5) in the direction of the
active structure-timeframe (M15) leg, on the last closed entry bar. Everything else is then measured from
the CLOSED bars between the leg's break and the trigger bar, so the result:
* depends only on data <= decision time (no look-ahead), and
* holds no hidden state — a restarted bot re-derives exactly the same verdict (live == backtest).

Every rule L0–L9 that can be measured is evaluated and recorded, even after one fails, so research can
see what each rule removes. L10 (score) is applied by ``core.signal_engine`` and L11 (session, spread,
volatility, news, cooldown/dedupe, safety, health) by the gate modules.
"""

from __future__ import annotations

import math
from collections.abc import Mapping, Sequence
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta

import numpy as np
import pandas as pd

from core.config import CostsCfg, Settings
from core.market_structure import (
    AnalysisSnapshot,
    BreakEvent,
    StructState,
    StructureState,
    nearest_obstacle,
)
from core.types import (
    ContractViolation,
    Direction,
    GateResult,
    Quote,
    SetupCandidate,
    SymbolSpec,
    Timeframe,
    make_setup_id,
)

STRATEGY_ID = "S1"
HTF_VETO = "veto_opposite"
HTF_SCORE_ONLY = "score_only"


# ----------------------------------------------------------------------------- inputs


@dataclass(frozen=True, slots=True)
class S1Params:
    """Everything S1 needs from the configuration. Only target_rr, stop_buffer_atr5 and
    pullback_r_min are tunable (STRATEGY §10); the rest is fixed a priori."""

    version: str  # "S1 1.0.0": part of every setup id
    context_tf: Timeframe
    structure_tf: Timeframe
    setup_tf: Timeframe
    entry_tf: Timeframe
    target_rr: float
    stop_buffer_atr5: float
    pullback_r_min: float
    min_impulse_atr15: float
    max_leg_age_m15_bars: int
    stop_min_atr15: float
    stop_max_atr15: float
    min_obstacle_R: float
    min_net_rr: float
    max_cost_R: float
    htf_mode: str = HTF_VETO

    def __post_init__(self) -> None:
        if self.structure_tf.minutes % self.entry_tf.minutes != 0:
            raise ValueError("the structure timeframe must be a whole multiple of the entry timeframe")
        if self.htf_mode not in (HTF_VETO, HTF_SCORE_ONLY):
            raise ValueError(f"unknown htf_mode {self.htf_mode!r}")

    @property
    def max_leg_age_entry_bars(self) -> int:
        """L5 in entry bars: 48 M15 bars = 144 M5 bars. Counting bars (not hours) skips weekends."""
        return self.max_leg_age_m15_bars * (self.structure_tf.minutes // self.entry_tf.minutes)

    @classmethod
    def from_settings(cls, settings: Settings) -> S1Params:
        roles = settings.timeframes.roles()
        s = settings.strategy
        return cls(
            version=f"{STRATEGY_ID} {settings.app.strategy_version}",
            context_tf=roles["context"], structure_tf=roles["structure"], setup_tf=roles["setup"],
            entry_tf=roles["entry"], target_rr=s.target_rr, stop_buffer_atr5=s.stop_buffer_atr5,
            pullback_r_min=s.pullback_r_min, min_impulse_atr15=s.min_impulse_atr15,
            max_leg_age_m15_bars=s.max_leg_age_m15_bars, stop_min_atr15=s.stop_min_atr15,
            stop_max_atr15=s.stop_max_atr15, min_obstacle_R=s.min_obstacle_R, min_net_rr=s.min_net_rr,
            max_cost_R=settings.execution.max_cost_R, htf_mode=s.htf_mode,
        )


@dataclass(frozen=True, slots=True)
class MarketCosts:
    """Executable prices and cost estimates at decision time, all in PRICE units (STRATEGY §5–6)."""

    bid: float
    ask: float
    typical_spread: float  # rolling median spread; buffers the SHORT stop (shorts are stopped on the ask)
    commission: float  # round-trip commission for one lot, converted to price units
    slippage: float  # expected slippage
    stops_level: float  # broker minimum stop distance (L7 adds the current spread to it)

    def __post_init__(self) -> None:
        for name in ("bid", "ask", "typical_spread", "commission", "slippage", "stops_level"):
            value = getattr(self, name)
            if not (isinstance(value, (int, float)) and math.isfinite(value) and value >= 0):
                raise ContractViolation(f"MarketCosts.{name} must be a finite number >= 0, got {value!r}")
        if self.bid <= 0 or self.ask < self.bid:
            raise ContractViolation(f"MarketCosts: need 0 < bid <= ask, got {self.bid} / {self.ask}")

    @property
    def spread(self) -> float:
        return self.ask - self.bid

    def entry(self, direction: Direction) -> float:
        """E: a LONG buys at the ask, a SHORT sells at the bid."""
        return self.ask if direction is Direction.LONG else self.bid

    @classmethod
    def build(cls, quote: Quote, spec: SymbolSpec, costs: CostsCfg, value_per_price_unit: float,
              typical_spread_points: float | None) -> MarketCosts:
        """``value_per_price_unit``: account-currency value of a 1.0 price move for 1.0 lot, e.g.
        ``broker.loss_per_lot(...) / |entry - stop|`` (100,000 for EURUSD in a USD account)."""
        if not value_per_price_unit > 0:
            raise ContractViolation("value_per_price_unit must be > 0")
        typical = quote.spread if typical_spread_points is None else typical_spread_points * spec.point
        return cls(
            bid=quote.bid, ask=quote.ask, typical_spread=typical,
            commission=2.0 * costs.commission_per_lot_per_side / value_per_price_unit,
            slippage=costs.expected_slippage_points * spec.point,
            stops_level=spec.stops_level_points * spec.point,
        )


# ----------------------------------------------------------------------------- pullback scan


@dataclass(frozen=True, slots=True)
class PullbackScan:
    """Leg extreme and pullback measured on entry-timeframe bars (STRATEGY §2.6–2.7, §4, §13)."""

    extreme: float  # B: highest high (LONG) / lowest low (SHORT) of the scanned bars
    extreme_bar: int  # position of the (first) bar that made B
    pullback: float | None  # PL (LONG) / PH (SHORT) over the bars AFTER the B bar; None = no such bar yet
    bars_since_extreme: int
    erased_bar: int | None  # first bar at which the pullback reached the origin A (r >= 1)
    stale_bar: int | None  # first bar at which B was more than the age limit old

    def retracement(self, origin: float) -> float | None:
        """r = (B - PL) / (B - A); the same expression serves SHORT legs (signs cancel)."""
        if self.pullback is None or self.extreme == origin:
            return None
        return (self.extreme - self.pullback) / (self.extreme - origin)


def scan_pullback(high: Sequence[float] | np.ndarray, low: Sequence[float] | np.ndarray, direction: int,
                  origin: float, max_age_bars: int) -> PullbackScan | None:
    """Replay the bars since the leg's break in time order.

    * A bar that exceeds B makes a new B and the pullback restarts from it (invalidation 2: the leg
      resumed). The bar that makes B is not part of the pullback: its range lies before or around B.
    * Once the pullback reaches A (r >= 1) or B gets older than ``max_age_bars``, the leg is dead for
      good (invalidations 1 and 3), even if price later makes a new extreme.

    SHORT legs run the same code on negated prices, which mirrors every comparison exactly.
    """
    n = len(high)
    if n == 0 or len(low) != n:
        return None
    d = 1.0 if direction > 0 else -1.0
    favourable = [d * float(x) for x in (high if direction > 0 else low)]
    adverse = [d * float(x) for x in (low if direction > 0 else high)]
    target = d * origin
    best, best_bar = -math.inf, 0
    pull = math.inf
    erased: int | None = None
    stale: int | None = None
    for j in range(n):
        if favourable[j] > best:
            best, best_bar, pull = favourable[j], j, math.inf
        elif adverse[j] < pull:
            pull = adverse[j]
        if erased is None and pull <= target:
            erased = j
        if stale is None and j - best_bar > max_age_bars:
            stale = j
    return PullbackScan(
        extreme=d * best, extreme_bar=best_bar, pullback=None if math.isinf(pull) else d * pull,
        bars_since_extreme=n - 1 - best_bar, erased_bar=erased, stale_bar=stale,
    )


# ----------------------------------------------------------------------------- outputs


@dataclass(frozen=True, slots=True)
class S1Measures:
    """Everything S1 measured for one trigger: the evidence behind every rule and score component."""

    direction: Direction
    trigger_time: datetime
    trigger_level: float  # the entry-TF swing the CHoCH closed through
    trigger_level_time: datetime  # its pivot bar open time
    trigger_body_atr: float | None  # body of the trigger bar / ATR5
    trigger_clv: float  # close location in the trade direction (SHORT: 1 - CLV)
    leg_id: str
    origin: float  # A
    origin_time: datetime
    break_time: datetime
    leg_extreme_structure: float  # B as the structure tracker saw it (closed M15 bars only)
    extreme: float | None  # B used by the rules (entry-TF resolution, §13)
    extreme_time: datetime | None  # close time of the bar that made B
    pullback: float | None  # PL (LONG) / PH (SHORT)
    retracement: float | None  # r
    impulse_atr: float | None  # I = |B - A| / ATR15
    leg_age_m15: float | None  # M15 bars since B (entry bars / ratio)
    atr_entry: float | None  # ATR5
    atr_structure: float | None  # ATR15
    atr_percentile: float | None  # P_ATR on the structure timeframe
    htf_state: StructState
    htf_bars_since_break: int | None  # bars since the last context-TF break in the trade direction
    sweep: str  # "structure" (M15) | "entry" (M5) | "none": deepest liquidity sweep during the pullback
    entry: float  # E
    stop: float | None
    target: float | None
    risk: float | None  # D = |E - SL|
    obstacle: float | None
    room_R: float | None  # (Ob - E) / D in the trade direction; None = no obstacle
    spread: float
    commission: float
    slippage: float
    cost_R: float | None
    rr_net: float | None
    regime: str
    compression: bool
    momentum: float | None
    rel_tick_volume: float | None

    def as_dict(self) -> dict[str, float | str | bool | None]:
        """Flat, JSON-friendly copy for the journal."""
        out: dict[str, float | str | bool | None] = {}
        for key, value in asdict(self).items():
            if isinstance(value, Direction):
                out[key] = value.name
            elif isinstance(value, StructState):
                out[key] = value.value
            elif isinstance(value, datetime):
                out[key] = value.isoformat()
            else:
                out[key] = value
        return out


@dataclass(frozen=True, slots=True)
class S1Evaluation:
    """One trigger, fully evaluated: a valid SetupCandidate, or the rules that rejected it."""

    symbol: str
    direction: Direction
    decision_time_utc: datetime
    checks: tuple[GateResult, ...]
    measures: S1Measures
    candidate: SetupCandidate | None

    def __post_init__(self) -> None:
        passed = all(c.passed for c in self.checks)
        if self.candidate is not None and not passed:
            raise ContractViolation("an S1 candidate cannot exist while a rule failed")
        if self.candidate is None and passed:
            raise ContractViolation("all S1 rules passed but no candidate was built")

    @property
    def valid(self) -> bool:
        return self.candidate is not None

    @property
    def failed_checks(self) -> tuple[GateResult, ...]:
        return tuple(c for c in self.checks if not c.passed)

    @property
    def summary(self) -> str:
        failed = self.failed_checks
        return "valid" if not failed else "; ".join(f"{c.gate}: {c.reason}" for c in failed)


# ----------------------------------------------------------------------------- helpers


def _closed_slice(df: pd.DataFrame, tf: Timeframe, first_open: datetime, last_close: datetime) -> pd.DataFrame:
    """Bars with open >= first_open and close <= last_close (O(log n), no copy of the frame)."""
    if df.empty:
        return df
    times = df["time_open_utc"]
    lo = int(times.searchsorted(pd.Timestamp(first_open), side="left"))
    hi = int(times.searchsorted(pd.Timestamp(last_close - tf.delta), side="right"))
    return df.iloc[lo:hi]


def _bar_open(df: pd.DataFrame, i: int) -> datetime:
    return pd.Timestamp(df["time_open_utc"].iloc[i]).to_pydatetime()


def _floor(ts: datetime, tf: Timeframe) -> datetime:
    """Open time of the tf bar containing ts (bars up to D1 align to UTC midnight multiples)."""
    minutes = ts.hour * 60 + ts.minute
    return ts.replace(second=0, microsecond=0) - timedelta(minutes=minutes % tf.minutes)


def _fmt(x: float | None, digits: int = 5) -> str:
    return "n/a" if x is None else f"{x:.{digits}f}"


def _measured(**values: float | str | bool | None) -> dict[str, float | str | bool]:
    return {k: v for k, v in values.items() if v is not None}


# ----------------------------------------------------------------------------- strategy


class S1Strategy:
    """Stateless rule engine for S1. ``evaluate`` returns one S1Evaluation per trigger (0, 1 or 2)."""

    def __init__(self, params: S1Params) -> None:
        self.p = params

    # ------------------------------------------------------------------ trigger
    def trigger(self, entry: StructureState, direction: Direction, decision_time: datetime) -> BreakEvent | None:
        """An entry-TF CHoCH in ``direction`` on the LAST closed entry bar, not older than one entry bar.

        Old events (e.g. replayed while the engine warmed up after a restart) never trigger."""
        for event in reversed(entry.recent_breaks):
            if event.bar_index != entry.bar_index:
                break
            if event.kind == "CHoCH" and event.direction == int(direction):
                age = decision_time - event.time_close
                return event if timedelta(0) <= age < self.p.entry_tf.delta else None
        return None

    def triggered(self, snap: AnalysisSnapshot) -> bool:
        """Cheap pre-check: does any trigger fire on the last closed entry bar? Lets callers skip pricing
        (quotes, costs) on the vast majority of bars, where S1 has nothing to evaluate."""
        entry = snap.frames[self.p.entry_tf]
        return any(self.trigger(entry, d, snap.decision_time) is not None for d in (Direction.LONG, Direction.SHORT))

    def evaluate(self, snap: AnalysisSnapshot, frames: Mapping[Timeframe, pd.DataFrame],
                 market: MarketCosts) -> list[S1Evaluation]:
        """Evaluate every trigger on the last closed entry bar that belongs to an active leg.

        ``frames`` are the same closed-bar frames the analysis engine was fed; bars after the
        decision time (backtests) are never read."""
        entry_state = snap.frames[self.p.entry_tf]
        structure = snap.frames[self.p.structure_tf]
        out: list[S1Evaluation] = []
        for direction in (Direction.LONG, Direction.SHORT):
            trig = self.trigger(entry_state, direction, snap.decision_time)
            if trig is None:
                continue
            want = StructState.BULL if direction is Direction.LONG else StructState.BEAR
            leg = structure.leg
            if structure.state is not want or leg is None or leg.direction != int(direction):
                continue  # L1: no active leg in this direction -> not an S1 setup at all
            out.append(self._evaluate(snap, frames, market, direction, trig))
        return out

    # ------------------------------------------------------------------ evaluation
    def _evaluate(self, snap: AnalysisSnapshot, frames: Mapping[Timeframe, pd.DataFrame], market: MarketCosts,
                  direction: Direction, trig: BreakEvent) -> S1Evaluation:
        p = self.p
        d = int(direction)
        ctx, struct, ent = snap.frames[p.context_tf], snap.frames[p.structure_tf], snap.frames[p.entry_tf]
        leg = struct.leg
        assert leg is not None  # guaranteed by evaluate()
        a = leg.origin.price
        checks: list[GateResult] = []

        # L0 — every timeframe the rules read must be past warm-up (STRATEGY §2.13)
        not_ready = [st.timeframe.name for st in (ctx, struct, ent) if not st.ready]
        checks.append(GateResult("L0_ready", not not_ready,
                                 "all timeframes ready" if not not_ready else f"not ready: {', '.join(not_ready)}"))

        # L1 — active leg (the "not used yet" half is the dedupe gate: one entry per setup id)
        checks.append(GateResult(
            "L1_leg", True, f"{struct.timeframe.name} {'BULL' if d > 0 else 'BEAR'} leg from A={a:.5f}",
            _measured(leg_id=leg.leg_id, origin=a, break_time=leg.break_time.isoformat()),
        ))

        # Pullback scan on entry bars from the start of the break bar to the trigger bar (§13)
        m5 = _closed_slice(frames[p.entry_tf], p.entry_tf, leg.break_time - p.structure_tf.delta, trig.time_close)
        scan = scan_pullback(m5["high"].to_numpy(float), m5["low"].to_numpy(float), d, a,
                             p.max_leg_age_entry_bars) if len(m5) else None
        covers_break = len(m5) > 0 and _bar_open(m5, 0) <= leg.break_time - p.structure_tf.delta
        b = scan.extreme if scan is not None else None
        b_time = _bar_open(m5, scan.extreme_bar) + p.entry_tf.delta if scan is not None else None
        pull = scan.pullback if scan is not None else None
        r = scan.retracement(a) if scan is not None else None
        erased_at = None if scan is None or scan.erased_bar is None else _bar_open(m5, scan.erased_bar)
        stale_at = None if scan is None or scan.stale_bar is None else _bar_open(m5, scan.stale_bar)
        if scan is not None and not covers_break and d * (leg.extreme - scan.extreme) > 0:
            stale_at = stale_at or _bar_open(m5, 0)  # B lies before the loaded entry-TF history
        m15 = _closed_slice(frames[p.structure_tf], p.structure_tf, leg.break_time, trig.time_close)
        beyond_a = np.flatnonzero(d * (m15["close"].to_numpy(float) - a) < 0) if len(m15) else np.array([], int)
        m15_erased_at = _bar_open(m15, int(beyond_a[0])) + p.structure_tf.delta if len(beyond_a) else None

        atr15, atr5 = struct.atr, ent.atr
        impulse = d * (b - a) / atr15 if b is not None and atr15 else None

        # L2 — the leg is meaningful
        checks.append(GateResult(
            "L2_impulse", impulse is not None and impulse >= p.min_impulse_atr15,
            f"I={_fmt(impulse, 2)} ATR15 (min {p.min_impulse_atr15})",
            _measured(impulse_atr=impulse, extreme=b, origin=a, atr15=atr15),
        ))

        # L3 — context timeframe not opposed
        opposite = StructState.BEAR if d > 0 else StructState.BULL
        vetoed = p.htf_mode == HTF_VETO and ctx.state is opposite
        checks.append(GateResult(
            "L3_htf", not vetoed,
            f"{ctx.timeframe.name} state {ctx.state.value}" + (" opposes the trade" if vetoed else
                                                               f" ({p.htf_mode})"),
            _measured(htf_state=ctx.state.value, htf_mode=p.htf_mode),
        ))

        # L4 — a real pullback that did not erase the leg (invalidation 1)
        if scan is None:
            l4_ok, l4_reason = False, "no entry-timeframe bars since the break"
        elif erased_at is not None:
            l4_ok, l4_reason = False, f"leg erased: pullback reached A at {erased_at.isoformat()}"
        elif m15_erased_at is not None:
            l4_ok = False
            l4_reason = f"leg erased: {p.structure_tf.name} closed beyond A at {m15_erased_at.isoformat()}"
        elif r is None:
            l4_ok, l4_reason = False, "no pullback yet: the trigger bar made a new extreme"
        else:
            l4_ok = p.pullback_r_min <= r < 1.0
            l4_reason = f"r={r:.3f} (need {p.pullback_r_min} <= r < 1)"
        checks.append(GateResult("L4_pullback", l4_ok, l4_reason, _measured(retracement=r, pullback=pull, extreme=b)))

        # L5 — the leg is not stale (invalidation 3); age counted in entry bars
        ratio = p.structure_tf.minutes // p.entry_tf.minutes
        age_m15 = scan.bars_since_extreme / ratio if scan is not None else None
        if scan is None:
            l5_ok, l5_reason = False, "no entry-timeframe bars since the break"
        elif stale_at is not None:
            l5_ok, l5_reason = False, f"leg went stale at {stale_at.isoformat()}"
        else:
            l5_ok, l5_reason = True, f"B is {age_m15:.1f} {p.structure_tf.name} bars old (max {p.max_leg_age_m15_bars})"
        checks.append(GateResult("L5_fresh", l5_ok, l5_reason, _measured(leg_age_m15=age_m15)))

        # L6 — the CHoCH broke a swing that formed after B
        after_b = b_time is not None and trig.level.pivot_time >= b_time
        checks.append(GateResult(
            "L6_trigger", after_b,
            f"{p.entry_tf.name} CHoCH through {trig.level.price:.5f} (swing of {trig.level.pivot_time.isoformat()}) "
            + ("formed after B" if after_b else "formed before B"),
            _measured(trigger_level=trig.level.price, trigger_close=trig.close),
        ))

        # L7 — stop beyond the pullback extreme, sane distance
        e = market.entry(direction)
        stop: float | None = None
        risk: float | None = None
        target: float | None = None
        if pull is not None and atr5:
            stop = pull - d * p.stop_buffer_atr5 * atr5 + (market.typical_spread if d < 0 else 0.0)
            risk = d * (e - stop)
            target = e + d * p.target_rr * risk
        min_distance = market.stops_level + market.spread
        if risk is None or atr15 is None:
            l7_ok, l7_reason = False, "stop not computable (no pullback extreme or ATR)"
        elif risk <= 0:
            l7_ok, l7_reason = False, f"entry {e:.5f} is already beyond the stop {stop:.5f}"
        else:
            lo, hi = p.stop_min_atr15 * atr15, p.stop_max_atr15 * atr15
            l7_ok = (lo <= risk <= hi and risk >= min_distance and stop is not None and stop > 0
                     and target is not None and target > 0)
            l7_reason = (f"D={risk:.5f} in [{lo:.5f}, {hi:.5f}]" if lo <= risk <= hi
                         else f"D={risk:.5f} outside [{lo:.5f}, {hi:.5f}]")
            if risk < min_distance:
                l7_reason += f"; below stops level + spread {min_distance:.5f}"
        checks.append(GateResult("L7_stop", l7_ok, l7_reason,
                                 _measured(entry=e, stop=stop, risk=risk, atr5=atr5, min_distance=min_distance)))

        # L8 — room to move: no obstacle within min_obstacle_R
        obstacle = nearest_obstacle(e, d, snap.obstacles(d, p.context_tf))
        room = d * (obstacle - e) / risk if obstacle is not None and risk and risk > 0 else None
        if risk is None or risk <= 0:
            l8_ok, l8_reason = False, "not measurable without a valid stop"
        elif room is None:
            l8_ok, l8_reason = True, "no obstacle in the trade direction"
        else:
            l8_ok = room >= p.min_obstacle_R
            l8_reason = f"obstacle {obstacle:.5f} is {room:.2f} R away (min {p.min_obstacle_R})"
        checks.append(GateResult("L8_room", l8_ok, l8_reason, _measured(obstacle=obstacle, room_R=room)))

        # L9 — costs acceptable
        cost_r = rr_net = None
        if risk is not None and risk > 0:
            cost_r = (market.spread + market.commission + market.slippage) / risk
            rr_net = (p.target_rr * risk - market.commission - market.slippage) / (risk + market.commission
                                                                                    + market.slippage)
            l9_ok = cost_r <= p.max_cost_R and rr_net >= p.min_net_rr
            l9_reason = f"cost_R={cost_r:.3f} (max {p.max_cost_R}), RR_net={rr_net:.2f} (min {p.min_net_rr})"
        else:
            l9_ok, l9_reason = False, "not measurable without a valid stop"
        checks.append(GateResult("L9_costs", l9_ok, l9_reason, _measured(
            cost_R=cost_r, rr_net=rr_net, spread=market.spread, commission=market.commission,
            slippage=market.slippage)))

        measures = S1Measures(
            direction=direction, trigger_time=trig.time_close, trigger_level=trig.level.price,
            trigger_level_time=trig.level.pivot_time,
            trigger_body_atr=(ent.last_bar.candle.body / atr5) if ent.last_bar is not None and atr5 else None,
            trigger_clv=self._directional_clv(ent, d),
            leg_id=leg.leg_id, origin=a, origin_time=leg.origin.pivot_time, break_time=leg.break_time,
            leg_extreme_structure=leg.extreme, extreme=b, extreme_time=b_time, pullback=pull, retracement=r,
            impulse_atr=impulse, leg_age_m15=age_m15, atr_entry=atr5, atr_structure=atr15,
            atr_percentile=struct.atr_percentile, htf_state=ctx.state,
            htf_bars_since_break=self._bars_since_break(ctx, d),
            sweep=self._sweep(struct, ent, d, b_time, trig.time_close), entry=e, stop=stop, target=target,
            risk=risk, obstacle=obstacle, room_R=room, spread=market.spread, commission=market.commission,
            slippage=market.slippage, cost_R=cost_r, rr_net=rr_net, regime=struct.regime.value,
            compression=struct.compression, momentum=struct.momentum, rel_tick_volume=struct.rel_tick_volume,
        )
        candidate = None
        if all(c.passed for c in checks):
            assert stop is not None and target is not None
            candidate = SetupCandidate(
                setup_id=make_setup_id(p.version, snap.symbol, direction,
                                       (leg.origin.pivot_time.isoformat(), leg.break_time.isoformat())),
                strategy_version=p.version, symbol=snap.symbol, direction=direction, timeframe=p.setup_tf,
                detected_at_utc=snap.decision_time, entry_ref=e, stop=stop, target=target, invalidation_price=a,
                expires_at_utc=trig.time_close + p.entry_tf.delta, context=measures.as_dict(),
            )
        return S1Evaluation(snap.symbol, direction, snap.decision_time, tuple(checks), measures, candidate)

    # ------------------------------------------------------------------ descriptors
    @staticmethod
    def _directional_clv(ent: StructureState, d: int) -> float:
        if ent.last_bar is None:
            return 0.5
        clv = ent.last_bar.candle.clv
        return clv if d > 0 else 1.0 - clv

    @staticmethod
    def _bars_since_break(ctx: StructureState, d: int) -> int | None:
        for event in reversed(ctx.recent_breaks):
            if event.direction == d:
                return ctx.bar_index - event.bar_index
        return None

    def _sweep(self, struct: StructureState, ent: StructureState, d: int, b_time: datetime | None,
               t: datetime) -> str:
        """Deepest liquidity sweep in the trade direction during the pullback (STRATEGY §7, §13):
        an M15 sweep on an M15 bar after the one containing B, else an M5 sweep after the B bar."""
        if b_time is None:
            return "none"
        b_structure_close = _floor(b_time - self.p.entry_tf.delta, self.p.structure_tf) + self.p.structure_tf.delta
        if any(s.direction == d and b_structure_close < s.time_close <= t for s in struct.recent_sweeps):
            return "structure"
        if any(s.direction == d and b_time < s.time_close <= t for s in ent.recent_sweeps):
            return "entry"
        return "none"

