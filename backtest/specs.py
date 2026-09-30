"""Broker facts the backtester needs offline: symbol specs, swap terms, account currency and leverage.

``python main.py download-data`` saves them to ``data/history/symbol_specs.json`` from your broker. If the
file is missing, standard FX values are assumed (5-digit quotes, 3-digit JPY, 100,000 units per lot,
0.01-lot steps, no swap) and the backtest report says so.
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

from core.types import SymbolSpec

SPECS_FILE = "symbol_specs.json"

# MQL5 ENUM_SYMBOL_SWAP_MODE values the swap model understands
SWAP_DISABLED = 0
SWAP_POINTS = 1
SWAP_CURRENCY_DEPOSIT = 4


@dataclass(frozen=True, slots=True)
class SwapTerms:
    mode: int = SWAP_DISABLED
    long: float = 0.0  # per lot per night: points (mode 1) or account currency (mode 4)
    short: float = 0.0
    triple_day: int = 3  # MQL5 ENUM_DAY_OF_WEEK (0 = Sunday); 3 = Wednesday

    @property
    def supported(self) -> bool:
        return self.mode in (SWAP_DISABLED, SWAP_POINTS, SWAP_CURRENCY_DEPOSIT)


@dataclass(frozen=True, slots=True)
class BrokerFacts:
    account_currency: str
    leverage: int
    specs: dict[str, SymbolSpec]
    swaps: dict[str, SwapTerms]
    warnings: tuple[str, ...]


def standard_fx_spec(symbol: str) -> SymbolSpec:
    digits = 3 if "JPY" in symbol.upper() else 5
    point = 10.0 ** -digits
    return SymbolSpec(symbol=symbol, digits=digits, point=point, tick_size=point, contract_size=100_000.0,
                      volume_min=0.01, volume_max=100.0, volume_step=0.01, stops_level_points=0, freeze_level_points=0,
                      currency_base=symbol[:3].upper(), currency_profit=symbol[3:6].upper(),
                      currency_margin=symbol[:3].upper(), trade_allowed=True)


def save_broker_facts(path: Path, account_currency: str, leverage: int, specs: dict[str, SymbolSpec],
                      swaps: dict[str, dict[str, float | int]]) -> None:
    payload = {
        "account_currency": account_currency,
        "leverage": leverage,
        "symbols": {
            name: {**{k: v for k, v in asdict(spec).items() if k != "filling_modes"},
                   "filling_modes": sorted(spec.filling_modes), **swaps.get(name, {})}
            for name, spec in specs.items()
        },
    }
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2), encoding="utf-8")


def load_broker_facts(history_dir: Path, symbols: list[str], default_currency: str = "USD",
                      default_leverage: int = 100) -> BrokerFacts:
    path = history_dir / SPECS_FILE
    warnings: list[str] = []
    raw: dict[str, dict[str, object]] = {}
    currency, leverage = default_currency, default_leverage
    if path.exists():
        data = json.loads(path.read_text(encoding="utf-8"))
        currency = str(data.get("account_currency", default_currency))
        leverage = int(data.get("leverage", default_leverage))
        raw = data.get("symbols", {})
    else:
        warnings.append(f"{path} not found: assumed a {currency} account, leverage 1:{leverage} and standard FX specs. "
                        "Re-run `python main.py download-data` to record your broker's exact values.")
    specs: dict[str, SymbolSpec] = {}
    swaps: dict[str, SwapTerms] = {}
    for name in symbols:
        entry = raw.get(name)
        if entry is None:
            specs[name] = standard_fx_spec(name)
            swaps[name] = SwapTerms()
            if raw:
                warnings.append(f"{name}: no saved spec, standard FX values assumed")
            continue
        e: dict[str, Any] = dict(entry)
        fields = {k: e[k] for k in SymbolSpec.__dataclass_fields__ if k in e and k != "filling_modes"}
        specs[name] = SymbolSpec(**fields, filling_modes=frozenset(e.get("filling_modes", [])))
        terms = SwapTerms(int(e.get("swap_mode", 0)), float(e.get("swap_long", 0.0)), float(e.get("swap_short", 0.0)),
                          int(e.get("swap_rollover3days", 3)))
        if not terms.supported:
            warnings.append(f"{name}: swap mode {terms.mode} is not modelled; swap treated as 0")
        swaps[name] = terms
    if not raw:
        warnings.append("swap (overnight financing) not modelled: no broker swap terms available")
    return BrokerFacts(currency, leverage, specs, swaps, tuple(warnings))
