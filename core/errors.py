"""Exception hierarchy. Catch the narrowest type possible; never swallow silently."""

from __future__ import annotations

from core.ports import BrokerUnavailable


class TradingBotError(Exception):
    """Base class for all project-specific errors."""


class ConfigError(TradingBotError):
    """Configuration is missing, malformed or unsafe."""


class DataIntegrityError(TradingBotError):
    """Market data failed integrity checks (duplicates, non-monotonic time, bad OHLC)."""


class SymbolResolutionError(TradingBotError):
    """A configured symbol could not be matched to exactly one broker symbol."""


class ModeViolation(TradingBotError):
    """Configured run mode and the connected account disagree (e.g. demo config on a REAL account)."""


class NotYetImplemented(TradingBotError):
    """Deliberately disabled capability (e.g. order sending before STEP 7)."""


__all__ = [
    "BrokerUnavailable",
    "ConfigError",
    "DataIntegrityError",
    "ModeViolation",
    "NotYetImplemented",
    "SymbolResolutionError",
    "TradingBotError",
]
