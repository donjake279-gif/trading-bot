"""Historical data: download M1 bars from MT5 to parquet, check quality, resample, load.

Layout:  data/history/<SYMBOL>/M1_<YEAR>.parquet   (config symbol name, UTC timestamps)

Higher timeframes (M5/M15/M30/H1) are always RESAMPLED from M1 so every timeframe comes from one
source of truth. Resampling only emits bars whose full period is covered by the data (no
partial last bar = no look-ahead at the edge).
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol

import pandas as pd

from core.market_data import validate_bars
from core.timeutils import fx_market_open
from core.types import SymbolSpec, Timeframe

log = logging.getLogger(__name__)

UTC = timezone.utc
UNEXPECTED_GAP_MINUTES = 15  # daily rollover commonly has a few missing minutes


class HistorySource(Protocol):
    def history_bars(self, symbol: str, timeframe: Timeframe, start_utc: datetime, end_utc: datetime) -> pd.DataFrame: ...


# ----------------------------------------------------------------------------- download


def _year_file(root: Path, symbol: str, year: int) -> Path:
    return root / symbol / f"M1_{year}.parquet"


def download_symbol(
    source: HistorySource, symbol: str, start_utc: datetime, end_utc: datetime, root: Path,
    chunk_days: int = 31, force: bool = False, now_utc: datetime | None = None,
) -> list[Path]:
    """Download M1 bars in chunks, one parquet file per calendar year.
    Completed past years that already exist are skipped unless ``force``."""
    written: list[Path] = []
    current_year = (now_utc or end_utc).year
    for year in range(start_utc.year, end_utc.year + 1):
        path = _year_file(root, symbol, year)
        if path.exists() and year < current_year and not force:
            log.info("skip existing year", extra={"ctx": {"symbol": symbol, "year": year}})
            continue
        y_start = max(start_utc, datetime(year, 1, 1, tzinfo=UTC))
        y_end = min(end_utc, datetime(year + 1, 1, 1, tzinfo=UTC))
        parts: list[pd.DataFrame] = []
        cursor = y_start
        while cursor < y_end:
            chunk_end = min(cursor + timedelta(days=chunk_days), y_end)
            part = source.history_bars(symbol, Timeframe.M1, cursor, chunk_end)
            if not part.empty:
                parts.append(part)
            cursor = chunk_end
        if not parts:
            log.warning("no data for year", extra={"ctx": {"symbol": symbol, "year": year}})
            continue
        df = pd.concat(parts, ignore_index=True).drop_duplicates("time_open_utc").sort_values("time_open_utc")
        df = df.reset_index(drop=True)
        issues = validate_bars(df, Timeframe.M1)
        if issues:
            log.warning("integrity issues", extra={"ctx": {"symbol": symbol, "year": year, "issues": "; ".join(issues)}})
        path.parent.mkdir(parents=True, exist_ok=True)
        df.to_parquet(path, index=False)
        written.append(path)
        log.info("saved", extra={"ctx": {"symbol": symbol, "year": year, "rows": len(df)}})
    return written


def load_history(root: Path, symbol: str, start_utc: datetime | None = None, end_utc: datetime | None = None) -> pd.DataFrame:
    files = sorted((root / symbol).glob("M1_*.parquet"))
    if not files:
        raise FileNotFoundError(f"no history for {symbol} in {root / symbol}. Run: python main.py download-data")
    df = pd.concat((pd.read_parquet(f) for f in files), ignore_index=True)
    df["time_open_utc"] = pd.to_datetime(df["time_open_utc"], utc=True)
    df = df.drop_duplicates("time_open_utc").sort_values("time_open_utc")
    if start_utc is not None:
        df = df[df["time_open_utc"] >= start_utc]
    if end_utc is not None:
        df = df[df["time_open_utc"] < end_utc]
    return df.reset_index(drop=True)


# ----------------------------------------------------------------------------- resample


def resample_m1(m1: pd.DataFrame, tf: Timeframe) -> pd.DataFrame:
    """Aggregate M1 bars to tf (<= H1). Only complete periods are emitted."""
    if tf.minutes > 60:
        raise ValueError("resample_m1 supports up to H1; H4/D1 align to server time and need their own rule")
    if tf is Timeframe.M1 or m1.empty:
        return m1.copy()
    s = m1.set_index("time_open_utc")
    agg = s.resample(f"{tf.minutes}min", label="left", closed="left").agg(
        {"open": "first", "high": "max", "low": "min", "close": "last", "tick_volume": "sum", "spread_points": "max"}
    )
    agg = agg.dropna(subset=["open"])
    data_end = m1["time_open_utc"].iloc[-1] + Timeframe.M1.delta
    agg = agg[agg.index + tf.delta <= data_end]  # drop a trailing partial period
    out = agg.reset_index()
    out["tick_volume"] = out["tick_volume"].astype("int64")
    out["spread_points"] = out["spread_points"].astype("int64")
    return out


# ----------------------------------------------------------------------------- quality


@dataclass(frozen=True)
class QualityReport:
    symbol: str
    rows: int
    first_utc: str | None
    last_utc: str | None
    unexpected_gaps: int
    largest_gap_minutes: float
    zero_range_pct: float
    spread_median_points: float | None
    spread_p95_points: float | None
    integrity_issues: list[str]

    @property
    def verdict(self) -> str:
        if self.rows == 0 or self.integrity_issues:
            return "FAIL"
        if self.unexpected_gaps > 50 or self.zero_range_pct > 20:
            return "WARN"
        return "OK"


def quality_report(symbol: str, m1: pd.DataFrame) -> QualityReport:
    if m1.empty:
        return QualityReport(symbol, 0, None, None, 0, 0.0, 0.0, None, None, ["no data"])
    t = m1["time_open_utc"]
    diffs = t.diff().dt.total_seconds().div(60).fillna(1.0)
    gap_idx = diffs[diffs > UNEXPECTED_GAP_MINUTES].index
    unexpected = 0
    largest = 0.0
    for i in gap_idx:
        start = t.iloc[i - 1] + Timeframe.M1.delta
        midpoint = start + (t.iloc[i] - start) / 2
        if fx_market_open(midpoint.to_pydatetime()):  # weekends are expected gaps
            unexpected += 1
            largest = max(largest, float(diffs.iloc[i]))
    zero_range = float((m1["high"] == m1["low"]).mean() * 100)
    spreads = m1["spread_points"]
    return QualityReport(
        symbol=symbol, rows=len(m1), first_utc=t.iloc[0].isoformat(), last_utc=t.iloc[-1].isoformat(),
        unexpected_gaps=unexpected, largest_gap_minutes=largest, zero_range_pct=round(zero_range, 3),
        spread_median_points=float(spreads.median()), spread_p95_points=float(spreads.quantile(0.95)),
        integrity_issues=validate_bars(m1, Timeframe.M1),
    )


def write_quality_reports(reports: Iterable[QualityReport], path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = [asdict(r) | {"verdict": r.verdict} for r in reports]
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


# ----------------------------------------------------------------------------- conversion pairs


def required_conversion_symbols(
    specs: Mapping[str, SymbolSpec], account_currency: str, available: set[str]
) -> tuple[set[str], list[str]]:
    """Symbols needed to convert each instrument's profit currency into the account currency.

    Returns (needed_symbols, problems). Example: EURAUD in a USD account needs AUDUSD (or USDAUD).
    """
    needed: set[str] = set()
    problems: list[str] = []
    for name, spec in specs.items():
        ccy = spec.currency_profit
        if ccy == account_currency:
            continue
        direct, inverse = f"{ccy}{account_currency}", f"{account_currency}{ccy}"
        if direct in available:
            needed.add(direct)
        elif inverse in available:
            needed.add(inverse)
        else:
            problems.append(f"{name}: no {direct}/{inverse} symbol to convert {ccy} P&L to {account_currency}")
    return needed, problems
