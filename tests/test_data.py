"""Bar integrity, spread tracking, new-bar events, resampling, history download, conversion pairs."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytest

from backtest.data_loader import download_symbol, load_history, quality_report, required_conversion_symbols, resample_m1
from core.market_data import NewBarDetector, SpreadTracker, validate_bars
from core.types import SymbolSpec, Timeframe

UTC = timezone.utc
T0 = datetime(2024, 7, 15, 9, 0, tzinfo=UTC)  # Monday


def m1_frame(start: datetime, n: int, price: float = 1.1) -> pd.DataFrame:
    times = pd.date_range(start, periods=n, freq="1min", tz=UTC)
    p = [price + 0.00001 * i for i in range(n)]
    return pd.DataFrame({"time_open_utc": times, "open": p, "high": [x + 0.0002 for x in p],
                         "low": [x - 0.0002 for x in p], "close": [x + 0.00005 for x in p],
                         "tick_volume": 5, "spread_points": 7})


def test_validate_bars_detects_problems() -> None:
    df = m1_frame(T0, 10)
    assert validate_bars(df, Timeframe.M1) == []
    bad = df.copy()
    bad.loc[3, "high"] = bad.loc[3, "low"] - 0.001
    bad = pd.concat([bad, bad.iloc[[5]]])
    issues = " ".join(validate_bars(bad, Timeframe.M1))
    assert "duplicate" in issues and "inconsistent OHLC" in issues and "not increasing" in issues


def test_resample_m15_values_and_no_partial_bar() -> None:
    m1 = m1_frame(T0, 40)  # 09:00..09:39 -> M15 bars 09:00, 09:15 complete; 09:30 partial
    m15 = resample_m1(m1, Timeframe.M15)
    assert list(m15["time_open_utc"]) == [T0, T0 + timedelta(minutes=15)]
    first = m1.iloc[0:15]
    assert m15.loc[0, "open"] == first["open"].iloc[0]
    assert m15.loc[0, "close"] == first["close"].iloc[-1]
    assert m15.loc[0, "high"] == first["high"].max() and m15.loc[0, "low"] == first["low"].min()
    assert m15.loc[0, "tick_volume"] == 75


def test_resample_is_causal() -> None:
    """Truncation test: bars produced from data[:k] equal the same bars from the full data."""
    full = resample_m1(m1_frame(T0, 300), Timeframe.M15)
    part = resample_m1(m1_frame(T0, 200), Timeframe.M15)
    pd.testing.assert_frame_equal(part, full.iloc[: len(part)].reset_index(drop=True))


def test_spread_tracker_median_and_window() -> None:
    tr = SpreadTracker(timedelta(minutes=10))
    for i in range(40):
        tr.add("EURUSD", T0 + timedelta(seconds=10 * i), 7 if i % 2 else 9)
    assert tr.typical("EURUSD") == 8.0
    tr.add("EURUSD", T0 + timedelta(hours=1), 50)  # everything older than 10 min is evicted
    assert tr.count("EURUSD") == 1 and tr.typical("EURUSD") is None


def test_new_bar_detector() -> None:
    d = NewBarDetector()
    assert d.update("EURUSD", Timeframe.M5, T0) is False  # initialisation
    assert d.update("EURUSD", Timeframe.M5, T0) is False
    assert d.update("EURUSD", Timeframe.M5, T0 + timedelta(minutes=5)) is True
    assert d.update("EURUSD", Timeframe.M5, T0 + timedelta(minutes=5)) is False


class _Source:
    def __init__(self, df: pd.DataFrame) -> None:
        self.df = df
        self.calls = 0

    def history_bars(self, symbol: str, timeframe: Timeframe, start_utc: datetime, end_utc: datetime) -> pd.DataFrame:
        self.calls += 1
        m = (self.df["time_open_utc"] >= start_utc) & (self.df["time_open_utc"] < end_utc)
        return self.df.loc[m].reset_index(drop=True)


def test_download_and_reload(tmp_path: Path) -> None:
    data = m1_frame(datetime(2023, 12, 31, 20, 0, tzinfo=UTC), 60 * 30)  # spans the year boundary
    src = _Source(data)
    start, end = datetime(2023, 12, 1, tzinfo=UTC), datetime(2024, 1, 3, tzinfo=UTC)
    files = download_symbol(src, "EURUSD", start, end, tmp_path, chunk_days=7, now_utc=end)
    assert {f.name for f in files} == {"M1_2023.parquet", "M1_2024.parquet"}
    back = load_history(tmp_path, "EURUSD")
    assert len(back) == len(data) and back["time_open_utc"].is_monotonic_increasing
    calls = src.calls
    download_symbol(src, "EURUSD", start, end, tmp_path, chunk_days=7, now_utc=end)
    assert src.calls > calls  # current year (2024) is always refreshed; 2023 skipped


def test_quality_report_ignores_weekend_gap() -> None:
    fri = m1_frame(datetime(2024, 7, 19, 20, 50, tzinfo=UTC), 10)  # Friday until 21:00 UTC close
    sun = m1_frame(datetime(2024, 7, 21, 21, 5, tzinfo=UTC), 10)   # Sunday reopen
    mid_week_gap = m1_frame(datetime(2024, 7, 22, 12, 0, tzinfo=UTC), 5)
    rep = quality_report("EURUSD", pd.concat([fri, sun, mid_week_gap], ignore_index=True))
    assert rep.unexpected_gaps == 1  # only the Monday gap
    assert rep.verdict == "OK"


def _spec(name: str, base: str, quote: str) -> SymbolSpec:
    return SymbolSpec(name, 5, 1e-5, 1e-5, 100000, 0.01, 100, 0.01, 0, 0, base, quote, base, True)


def test_conversion_pairs() -> None:
    specs = {"EURUSD": _spec("EURUSD", "EUR", "USD"), "EURAUD": _spec("EURAUD", "EUR", "AUD"),
             "USDJPY": _spec("USDJPY", "USD", "JPY")}
    needed, problems = required_conversion_symbols(specs, "USD", {"EURUSD", "EURAUD", "USDJPY", "AUDUSD"})
    assert needed == {"AUDUSD", "USDJPY"} and problems == []
    _, problems = required_conversion_symbols(specs, "USD", {"EURUSD", "EURAUD", "USDJPY"})
    assert problems and "AUD" in problems[0]


@pytest.mark.parametrize("tf", [Timeframe.H4, Timeframe.D1])
def test_resample_refuses_server_aligned_timeframes(tf: Timeframe) -> None:
    with pytest.raises(ValueError):
        resample_m1(m1_frame(T0, 10), tf)
