"""Hand-built S1 scenarios for STEP 5 tests.

``Scenario`` describes the STRATEGY §8 worked example (EURUSD LONG) in LONG-world prices. ``build``
turns it into exactly what the live loop hands the strategy (AnalysisSnapshot + closed-bar frames +
MarketCosts). For ``Direction.SHORT`` every price is mirrored (p -> K - p, highs <-> lows, bid <-> ask),
so each LONG rule test has an exact SHORT twin.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from datetime import datetime, timezone

import pandas as pd

from core.market_structure import (
    AnalysisSnapshot,
    Bar,
    BreakEvent,
    DailyLevelsState,
    Leg,
    Regime,
    StructState,
    StructureState,
    SweepEvent,
    Swing,
    SwingKind,
    make_leg_id,
)
from core.strategy import MarketCosts
from core.types import Direction, Timeframe

UTC = timezone.utc
DAY = datetime(2024, 7, 16, tzinfo=UTC)  # a Tuesday
K = 2.2  # mirror constant for SHORT scenarios
M5, M15, H1 = Timeframe.M5, Timeframe.M15, Timeframe.H1


def at(hhmm: str) -> datetime:
    h, m = (int(x) for x in hhmm.split(":"))
    return DAY.replace(hour=h, minute=m)


# LONG-world M5 path from the start of the break bar (10:00) to the trigger bar (12:40-12:45):
# (open time, open, high, low, close). B = 1.10600 (10:25 bar), PL = 1.10240 (12:10 bar, sweeping the
# 11:40 swing low at 1.10260), swing high 1.10350 at 12:25, trigger bar = STRATEGY §8 step 3.
def _default_path() -> tuple[tuple[str, float, float, float, float], ...]:
    rows = [
        ("10:00", 1.10280, 1.10300, 1.10270, 1.10290),
        ("10:05", 1.10290, 1.10320, 1.10285, 1.10315),
        ("10:10", 1.10315, 1.10345, 1.10310, 1.10340),  # M15 10:00-10:15 closes 1.10340 > SH 1.10300: the break
        ("10:15", 1.10340, 1.10480, 1.10335, 1.10470),
        ("10:20", 1.10470, 1.10560, 1.10460, 1.10550),
        ("10:25", 1.10550, 1.10600, 1.10540, 1.10580),  # B
    ]
    closes = [1.10560, 1.10530, 1.10500, 1.10480, 1.10450, 1.10430, 1.10410, 1.10390, 1.10370, 1.10350,
              1.10330, 1.10310, 1.10290, 1.10280, 1.10275]  # 10:30 .. 11:40 (swing low 1.10260 at 11:40)
    t = at("10:30")
    prev = 1.10580
    for i, c in enumerate(closes):
        low = 1.10260 if i == len(closes) - 1 else min(prev, c) - 0.00005
        rows.append((t.strftime("%H:%M"), prev, max(prev, c) + 0.00005, low, c))
        prev, t = c, t + M5.delta
    for hhmm, o, h, lo, c in (
        ("11:45", 1.10275, 1.10300, 1.10270, 1.10295),
        ("11:50", 1.10295, 1.10330, 1.10290, 1.10320),
        ("11:55", 1.10320, 1.10335, 1.10300, 1.10305),
        ("12:00", 1.10305, 1.10310, 1.10280, 1.10285),
        ("12:05", 1.10285, 1.10290, 1.10265, 1.10270),
        ("12:10", 1.10270, 1.10275, 1.10240, 1.10270),  # PL: sweeps 1.10260 and closes back above
        ("12:15", 1.10270, 1.10310, 1.10265, 1.10305),
        ("12:20", 1.10305, 1.10340, 1.10300, 1.10335),
        ("12:25", 1.10335, 1.10350, 1.10320, 1.10325),  # M5 swing high 1.10350
        ("12:30", 1.10325, 1.10330, 1.10300, 1.10310),
        ("12:35", 1.10310, 1.10320, 1.10300, 1.10318),
        ("12:40", 1.10318, 1.10380, 1.10315, 1.10372),  # trigger: M5 CHoCH up through 1.10350
    ):
        rows.append((hhmm, o, h, lo, c))
    return tuple(rows)


@dataclass(frozen=True)
class Scenario:
    symbol: str = "EURUSD"
    origin: float = 1.10000  # A: M15 swing low
    origin_pivot: str = "08:30"
    broken_high: float = 1.10300
    break_close: str = "10:15"
    path: tuple[tuple[str, float, float, float, float], ...] = field(default_factory=_default_path)
    atr15: float = 0.00120
    atr5: float = 0.00060
    atr_percentile: float | None = 55.0
    htf_state: StructState = StructState.BULL
    htf_break_bars_ago: int | None = 10
    htf_obstacles: tuple[float, ...] = (1.10900,)
    pdh: float | None = 1.11200
    pwh: float | None = 1.11500
    trigger_level: float = 1.10350
    trigger_pivot: str = "12:25"
    m5_sweeps: tuple[tuple[float, str, str], ...] = ((1.10260, "11:40", "12:15"),)  # (level, pivot, bar close)
    m15_sweeps: tuple[tuple[float, str, str], ...] = ()
    not_ready: frozenset[Timeframe] = frozenset()
    bid: float = 1.10373
    ask: float = 1.10380
    typical_spread: float = 0.00007
    commission: float = 0.00007
    slippage: float = 0.00002
    stops_level: float = 0.0
    decision: str = "12:45"

    def with_bar(self, hhmm: str, *, high: float | None = None, low: float | None = None,
                 close: float | None = None) -> Scenario:
        rows = []
        for row in self.path:
            if row[0] == hhmm:
                t, o, h, lo, c = row
                row = (t, o, h if high is None else high, lo if low is None else low, c if close is None else close)
            rows.append(row)
        return replace(self, path=tuple(rows))


# ----------------------------------------------------------------------------- builders


def _mirror(direction: Direction):  # type: ignore[no-untyped-def]
    if direction is Direction.LONG:
        return lambda p: p
    return lambda p: K - p


def frames_from_path(sc: Scenario, direction: Direction) -> dict[Timeframe, pd.DataFrame]:
    mp = _mirror(direction)
    rows = []
    for hhmm, o, h, lo, c in sc.path:
        hi2, lo2 = (h, lo) if direction is Direction.LONG else (mp(lo), mp(h))
        rows.append({"time_open_utc": at(hhmm), "open": mp(o), "high": hi2, "low": lo2, "close": mp(c),
                     "tick_volume": 100, "spread_points": 7})
    m5 = pd.DataFrame(rows)
    m5["time_open_utc"] = pd.to_datetime(m5["time_open_utc"], utc=True)
    m15 = aggregate(m5, M15)
    return {M5: m5, M15: m15, H1: aggregate(m5, H1)}


def aggregate(df: pd.DataFrame, tf: Timeframe) -> pd.DataFrame:
    """Complete tf bars from a finer frame (partial periods at either end are dropped)."""
    s = df.set_index("time_open_utc")
    agg = s.resample(f"{tf.minutes}min", label="left", closed="left").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "tick_volume": "sum", "spread_points": "max"}
    )
    step = df["time_open_utc"].iloc[1] - df["time_open_utc"].iloc[0]
    counts = s["open"].resample(f"{tf.minutes}min", label="left", closed="left").count()
    agg = agg[counts == int(pd.Timedelta(tf.delta) / step)]
    return agg.reset_index()


def swing(kind: SwingKind, price: float, pivot: datetime, tf: Timeframe, index: int = 0) -> Swing:
    return Swing(kind, price, index, pivot, index + 2, pivot + 3 * tf.delta, 0.001, "TEST")


def state(tf: Timeframe, **overrides: object) -> StructureState:
    base = StructureState(
        timeframe=tf, bar_index=2000, time_close=None, state=StructState.NONE, last_break=None, leg=None,
        atr=0.001, atr_prev=0.001, atr_percentile=50.0, regime=Regime.RANGE, compression=False, momentum=0.5,
        rel_tick_volume=1.0, last_bar=None,
        swings=(swing(SwingKind.LOW, 1.0, DAY, tf), swing(SwingKind.HIGH, 1.2, DAY, tf)),
        unbroken_highs=(), unbroken_lows=(), recent_breaks=(), recent_sweeps=(), warm=True,
    )
    return replace(base, **overrides)  # type: ignore[arg-type]


def build(sc: Scenario, direction: Direction = Direction.LONG) -> tuple[AnalysisSnapshot, dict[Timeframe, pd.DataFrame],
                                                                        MarketCosts]:
    d = int(direction)
    mp = _mirror(direction)
    lo_kind, hi_kind = (SwingKind.LOW, SwingKind.HIGH) if d > 0 else (SwingKind.HIGH, SwingKind.LOW)
    frames = frames_from_path(sc, direction)
    decision = at(sc.decision)
    m5 = frames[M5]

    # --- M5: last bar = trigger bar, CHoCH through the swing high formed after B, pullback sweeps
    n5 = 5000
    last = m5.iloc[-1]
    t_open = last["time_open_utc"].to_pydatetime()
    trigger_bar = Bar(n5, t_open, t_open + M5.delta, last["open"], last["high"], last["low"], last["close"])
    level = swing(hi_kind, mp(sc.trigger_level), at(sc.trigger_pivot), M5, n5 - 4)
    earlier = BreakEvent(M5, -d, "CHoCH", n5 - 20, at("11:05"), mp(1.10420), swing(lo_kind, mp(1.10430), DAY, M5),
                         StructState.BULL if d > 0 else StructState.BEAR)
    choch = BreakEvent(M5, d, "CHoCH", n5, trigger_bar.time_close, trigger_bar.close, level,
                       StructState.BEAR if d > 0 else StructState.BULL)
    sweeps5 = tuple(SweepEvent(M5, d, swing(lo_kind, mp(p), at(piv), M5), n5 - 1, at(bar), mp(p) - d * 0.0002, 0.3)
                    for p, piv, bar in sc.m5_sweeps)
    m5_state = state(M5, bar_index=n5, time_close=trigger_bar.time_close,
                     state=StructState.BULL if d > 0 else StructState.BEAR, last_break=choch, atr=sc.atr5,
                     last_bar=trigger_bar, recent_breaks=(earlier, choch), recent_sweeps=sweeps5,
                     warm=M5 not in sc.not_ready)

    # --- M15: active leg from A, broken at break_close, B = highest M15 high since the break
    m15 = frames[M15]
    n15 = 3000
    origin = swing(lo_kind, mp(sc.origin), at(sc.origin_pivot), M15, n15 - 30)
    brk = at(sc.break_close)
    since = m15[m15["time_open_utc"] >= brk - M15.delta]
    ext_row = since["high"].idxmax() if d > 0 else since["low"].idxmin()
    leg = Leg(M15, d, origin, n15 - 10, brk, float(m15.loc[ext_row, "high" if d > 0 else "low"]), n15 - 9,
              m15.loc[ext_row, "time_open_utc"].to_pydatetime() + M15.delta, make_leg_id(sc.symbol, M15, d, origin, brk))
    brk_event = BreakEvent(M15, d, "BOS", n15 - 10, brk, mp(1.10340), swing(hi_kind, mp(sc.broken_high), DAY, M15),
                           StructState.BULL if d > 0 else StructState.BEAR)
    sweeps15 = tuple(SweepEvent(M15, d, swing(lo_kind, mp(p), at(piv), M15), n15 - 2, at(bar), mp(p), 0.3)
                     for p, piv, bar in sc.m15_sweeps)
    m15_state = state(M15, bar_index=n15, time_close=decision, state=StructState.BULL if d > 0 else StructState.BEAR,
                      last_break=brk_event, leg=leg, atr=sc.atr15, atr_percentile=sc.atr_percentile,
                      regime=Regime.TREND_UP if d > 0 else Regime.TREND_DOWN, recent_breaks=(brk_event,),
                      recent_sweeps=sweeps15, warm=M15 not in sc.not_ready)

    # --- H1: context state, last break in the trade direction, unbroken swings = obstacles
    n60 = 1500
    htf = sc.htf_state
    if d < 0:
        htf = {StructState.BULL: StructState.BEAR, StructState.BEAR: StructState.BULL}.get(htf, htf)
    h1_breaks = () if sc.htf_break_bars_ago is None else (
        BreakEvent(H1, d, "BOS", n60 - sc.htf_break_bars_ago, DAY, mp(1.1), swing(hi_kind, mp(1.1), DAY, H1),
                   StructState.NONE),)
    obstacles = tuple(swing(hi_kind, mp(p), DAY, H1) for p in sc.htf_obstacles)
    h1_state = state(H1, bar_index=n60, time_close=decision.replace(minute=0), state=htf, recent_breaks=h1_breaks,
                     unbroken_highs=obstacles if d > 0 else (), unbroken_lows=obstacles if d < 0 else (),
                     warm=H1 not in sc.not_ready)

    pdh = None if sc.pdh is None else mp(sc.pdh)
    pwh = None if sc.pwh is None else mp(sc.pwh)
    daily = DailyLevelsState(pdh=pdh if d > 0 else None, pdl=pdh if d < 0 else None,
                             pwh=pwh if d > 0 else None, pwl=pwh if d < 0 else None,
                             day_high=None, day_low=None, day_start=None)
    snap = AnalysisSnapshot(sc.symbol, decision, {H1: h1_state, M15: m15_state, M5: m5_state}, daily)
    bid, ask = (sc.bid, sc.ask) if d > 0 else (K - sc.ask, K - sc.bid)
    market = MarketCosts(bid=bid, ask=ask, typical_spread=sc.typical_spread, commission=sc.commission,
                         slippage=sc.slippage, stops_level=sc.stops_level)
    return snap, frames, market
