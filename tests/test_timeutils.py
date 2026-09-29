"""Broker time conversion across DST, trading-day boundaries, offset verification."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pandas as pd
import pytest

from core.errors import ConfigError
from core.timeutils import (
    BrokerTimeRule,
    check_server_offset,
    fx_market_open,
    trading_day_start,
    trading_week_start,
)

UTC = timezone.utc
NY_CLOSE = BrokerTimeRule.parse("ny_close")


@pytest.mark.parametrize(
    "utc, expected_hours",
    [
        (datetime(2024, 1, 15, 12, tzinfo=UTC), 2),   # US winter -> UTC+2
        (datetime(2024, 7, 15, 12, tzinfo=UTC), 3),   # US summer -> UTC+3
        # 2024-03-15: US already on DST (since Mar 10), EU not yet (Mar 31).
        # ny_close must be UTC+3 here; Europe/Athens would wrongly give UTC+2.
        (datetime(2024, 3, 15, 12, tzinfo=UTC), 3),
        (datetime(2024, 11, 1, 12, tzinfo=UTC), 3),   # US still DST, EU already back to winter
        (datetime(2026, 9, 28, 4, tzinfo=UTC), 3),    # observed on the user's broker: server 07:01 at 04:01 UTC
    ],
)
def test_ny_close_offsets(utc: datetime, expected_hours: int) -> None:
    assert NY_CLOSE.offset_at_utc(utc) == timedelta(hours=expected_hours)


def test_athens_differs_from_ny_close_in_march_gap() -> None:
    athens = BrokerTimeRule.parse("iana:Europe/Athens")
    t = datetime(2024, 3, 15, 12, tzinfo=UTC)
    assert athens.offset_at_utc(t) == timedelta(hours=2) != NY_CLOSE.offset_at_utc(t)


@pytest.mark.parametrize("utc", [
    datetime(2024, 1, 15, 12, 34, tzinfo=UTC), datetime(2024, 3, 15, 9, 0, tzinfo=UTC),
    datetime(2024, 7, 1, 23, 59, tzinfo=UTC), datetime(2025, 11, 3, 0, 1, tzinfo=UTC),
])
def test_round_trip(utc: datetime) -> None:
    for rule in (NY_CLOSE, BrokerTimeRule.parse("fixed:+2"), BrokerTimeRule.parse("iana:Europe/Athens")):
        server = rule.utc_to_server_naive(utc)
        assert rule.server_naive_to_utc(server) == utc


def test_mt5_seconds_conversion_scalar_and_vector_agree() -> None:
    utc = datetime(2024, 7, 15, 12, 0, tzinfo=UTC)
    server_secs = int(NY_CLOSE.to_mt5_request_datetime(utc).timestamp())
    assert NY_CLOSE.from_mt5_seconds(server_secs) == utc
    vec = NY_CLOSE.mt5_seconds_to_utc_index(pd.Series([server_secs]))
    assert vec.iloc[0].to_pydatetime() == utc


def test_bad_rules_rejected() -> None:
    for bad in ("gmt+2", "iana:Mars/Olympus", "fixed:abc", "fixed:+20"):
        with pytest.raises(ConfigError):
            BrokerTimeRule.parse(bad)


def test_trading_day_boundary_follows_new_york_dst() -> None:
    # winter: 17:00 NY = 22:00 UTC ; summer: 17:00 NY = 21:00 UTC
    assert trading_day_start(datetime(2024, 1, 16, 23, 0, tzinfo=UTC)) == datetime(2024, 1, 16, 22, 0, tzinfo=UTC)
    assert trading_day_start(datetime(2024, 1, 16, 21, 0, tzinfo=UTC)) == datetime(2024, 1, 15, 22, 0, tzinfo=UTC)
    assert trading_day_start(datetime(2024, 7, 16, 21, 30, tzinfo=UTC)) == datetime(2024, 7, 16, 21, 0, tzinfo=UTC)


def test_trading_week_start_and_market_hours() -> None:
    wed = datetime(2024, 7, 17, 12, tzinfo=UTC)
    assert trading_week_start(wed) == datetime(2024, 7, 14, 21, 0, tzinfo=UTC)  # Sunday 17:00 NY (EDT)
    assert fx_market_open(wed)
    assert not fx_market_open(datetime(2024, 7, 20, 12, tzinfo=UTC))            # Saturday
    assert not fx_market_open(datetime(2024, 7, 19, 21, 30, tzinfo=UTC))        # Friday after 17:00 NY
    assert fx_market_open(datetime(2024, 7, 14, 21, 5, tzinfo=UTC))             # Sunday just after open


def test_offset_check() -> None:
    now = datetime(2024, 7, 17, 12, 0, 0, tzinfo=UTC)
    fresh_tick = int((now - timedelta(seconds=2)).timestamp()) + 3 * 3600
    assert check_server_offset(NY_CLOSE, fresh_tick, now).status == "ok"
    wrong = int(now.timestamp()) + 2 * 3600
    assert check_server_offset(NY_CLOSE, wrong, now).status == "mismatch"
    weekend = datetime(2024, 7, 20, 12, tzinfo=UTC)
    assert check_server_offset(NY_CLOSE, fresh_tick, weekend).status == "unverified"
    assert check_server_offset(NY_CLOSE, None, now).status == "unverified"
