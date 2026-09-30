"""`python main.py download-data` — fetch M1 history for configured + conversion symbols."""

from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path

from backtest.data_loader import (
    download_symbol,
    load_history,
    quality_report,
    required_conversion_symbols,
    write_quality_reports,
)
from backtest.specs import SPECS_FILE, save_broker_facts
from core.clock import LiveClock
from core.config import Credentials, Settings
from core.errors import SymbolResolutionError
from core.mt5_connection import MT5Gateway
from core.ports import BrokerUnavailable

log = logging.getLogger(__name__)
UTC = timezone.utc


def run_download(settings: Settings, creds: Credentials, start: datetime, end: datetime, force: bool,
                 project_root: Path) -> int:
    clock = LiveClock()
    gw = MT5Gateway(settings, creds, clock)
    try:
        gw.connect()
        acct = gw.account()
        symbols = list(settings.symbol_names)
        gw.resolve_symbols(symbols)
        specs = {s: gw.symbol_spec(s) for s in symbols}

        # conversion pairs (e.g. AUDUSD for EURAUD in a USD account)
        candidates: set[str] = set()
        for spec in specs.values():
            if spec.currency_profit != acct.currency:
                candidates |= {f"{spec.currency_profit}{acct.currency}", f"{acct.currency}{spec.currency_profit}"}
        available = set(symbols)
        for c in sorted(candidates - available):
            try:
                gw.resolve_symbols([c])
                available.add(c)
            except SymbolResolutionError:
                pass
        needed, problems = required_conversion_symbols(specs, acct.currency, available)
        for p in problems:
            print(f"WARNING: {p}")
        all_symbols = symbols + sorted(needed - set(symbols))
        print(f"Downloading M1 {start.date()} -> {end.date()} for: {', '.join(all_symbols)}")
        print("This can take a while the first time (MT5 fetches history from the broker).")

        root = project_root / settings.backtest.history_dir
        save_broker_facts(root / SPECS_FILE, acct.currency, acct.leverage,
                          {s: gw.symbol_spec(s) for s in all_symbols}, {s: gw.swap_terms(s) for s in all_symbols})
        print(f"Broker specs (contract size, lot steps, swap) saved for the backtester: {root / SPECS_FILE}")
        reports = []
        for sym in all_symbols:
            print(f"  {sym} ...", flush=True)
            download_symbol(gw, sym, start, end, root, settings.data.download_chunk_days, force, clock.now_utc())
            try:
                rep = quality_report(sym, load_history(root, sym, start, end))
            except FileNotFoundError:
                print(f"  {sym}: NO DATA returned by the broker")
                continue
            reports.append(rep)
            print(f"  {sym}: {rep.rows:,} bars {rep.first_utc} -> {rep.last_utc} | "
                  f"unexpected gaps {rep.unexpected_gaps} | median spread {rep.spread_median_points} pts | {rep.verdict}")
            if rep.first_utc and rep.first_utc[:10] > start.date().isoformat():
                print(f"    NOTE: broker history for {sym} starts {rep.first_utc[:10]}, later than requested "
                      f"{start.date()}. Check 'Max bars in chart' = Unlimited and re-run.")
        write_quality_reports(reports, root / "quality_report.json")
        print(f"\nQuality report: {root / 'quality_report.json'}")
        return 0 if reports and all(r.verdict != "FAIL" for r in reports) else 1
    except BrokerUnavailable as exc:
        print(f"ERROR: {exc}")
        return 1
    finally:
        gw.shutdown()
