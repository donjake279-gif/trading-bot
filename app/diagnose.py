"""`python main.py diagnose` — read-only health check of terminal, account, time, symbols and data.

It never sends orders. Exit code 0 = no FAIL items, 1 = at least one FAIL.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

from core.clock import LiveClock
from core.config import Credentials, Settings
from core.errors import SymbolResolutionError
from core.market_data import MarketDataService, validate_bars
from core.mode_guard import resolve_run_mode
from core.mt5_connection import MT5Gateway
from core.ports import BrokerUnavailable
from core.timeutils import check_server_offset, fx_market_open
from core.types import Timeframe


@dataclass
class Report:
    items: list[tuple[str, str, str]] = field(default_factory=list)  # (status, check, detail)

    def add(self, status: str, check: str, detail: str) -> None:
        self.items.append((status, check, detail))
        print(f"  [{status:<4}] {check:<34} {detail}")

    @property
    def failed(self) -> bool:
        return any(s == "FAIL" for s, _, _ in self.items)


def _section(title: str) -> None:
    print(f"\n=== {title} ===")


def run_diagnose(settings: Settings, creds: Credentials, report_dir: Path) -> int:
    clock = LiveClock()
    gw = MT5Gateway(settings, creds, clock)
    rep = Report()

    _section("Terminal")
    try:
        gw.connect()
    except BrokerUnavailable as exc:
        rep.add("FAIL", "connect to MetaTrader 5", str(exc))
        return _finish(rep, report_dir)
    try:
        term = gw.terminal_summary()
        rep.add("OK", "MetaTrader5 package", f"{term['package_version']} (terminal build {term['terminal_build']})")
        rep.add("OK" if term["connected"] else "FAIL", "terminal connected to broker", str(term["connected"]))
        rep.add("INFO", "Algo Trading button", "ON" if term["algo_trading_button"] else
                "OFF (fine for now — needed from STEP 14)")
        maxbars = term.get("max_bars_in_chart")
        if maxbars is not None and int(maxbars) < 5_000_000:
            rep.add("WARN", "Max bars in chart", f"{maxbars} — set Tools > Options > Charts > Max bars = Unlimited "
                    "before downloading 2020+ history")

        _section("Account")
        acct = gw.account()
        rep.add("INFO", "account", f"{acct.login} @ {acct.server} ({acct.currency}, 1:{acct.leverage})")
        rep.add("OK" if acct.trade_mode.value != "real" else "WARN", "account type", acct.trade_mode.value.upper())
        rep.add("OK" if acct.hedging else "WARN", "margin mode", "hedging" if acct.hedging else
                "netting (bot limits to 1 position per symbol)")
        rep.add("INFO", "balance / equity", f"{acct.balance:.2f} / {acct.equity:.2f}")
        rep.add("OK" if acct.expert_trading_allowed else "WARN", "account allows API trading", str(acct.expert_trading_allowed))
        decision = resolve_run_mode(settings, acct, creds)
        rep.add("OK" if decision.allowed else "FAIL", "mode safety check", decision.banner)
        for p in decision.problems:
            rep.add("FAIL", "  mode problem", p)
        for w in decision.warnings:
            rep.add("WARN", "  mode warning", w)

        _section("Symbols")
        try:
            mapping = gw.resolve_symbols(settings.symbol_names)
        except SymbolResolutionError as exc:
            rep.add("FAIL", "symbol resolution", str(exc))
            return _finish(rep, report_dir, gw)
        md = MarketDataService(gw, clock, settings)
        entry_tf = Timeframe.parse(settings.timeframes.entry)
        for name, broker in mapping.items():
            spec = gw.symbol_spec(name)
            label = name if name == broker else f"{name} -> {broker}"
            if not spec.trade_allowed:
                rep.add("FAIL", label, "trading disabled for this symbol")
                continue
            try:
                q = md.sample_quote(name)
                spread_pts = round(q.spread / spec.point)
                cap = settings.symbol_cfg(name).max_spread_points
                st = "OK" if spread_pts <= cap else "WARN"
                rep.add(st, label, f"spread {spread_pts} pts (cap {cap}), digits {spec.digits}, "
                        f"min lot {spec.volume_min}, step {spec.volume_step}, stops level {spec.stops_level_points}")
            except BrokerUnavailable as exc:
                rep.add("WARN", label, f"no quote: {exc}")
            for role, tf in settings.timeframes.roles().items():
                try:
                    bars = gw.closed_bars(name, tf, 200)
                except BrokerUnavailable as exc:
                    rep.add("FAIL", f"  {tf.name} bars", str(exc))
                    continue
                issues = validate_bars(bars, tf)
                last = bars["time_open_utc"].iloc[-1] if not bars.empty else None
                rep.add("OK" if (not issues and last is not None) else "FAIL", f"  {tf.name} ({role}) closed bars",
                        f"{len(bars)} bars, last opened {last.isoformat() if last is not None else '-'}"
                        + (f" ISSUES: {issues}" if issues else ""))
            status = md.data_status(name, entry_tf)
            rep.add("OK" if status.fresh else ("INFO" if not status.market_open else "WARN"),
                    "  data freshness", status.reason)

        _section("Time")
        now = clock.now_utc()
        latest = gw.latest_tick_server_seconds(list(mapping))
        check = check_server_offset(gw.time_rule, latest, now)
        st = {"ok": "OK", "mismatch": "FAIL", "unverified": "WARN"}[check.status]
        rep.add(st, "broker server offset", f"{check.detail} (rule {settings.broker_time.rule}: "
                f"expected {check.expected}, observed {check.observed})")
        rep.add("INFO", "FX market", "open" if fx_market_open(now) else "closed (weekend)")
    except BrokerUnavailable as exc:
        rep.add("FAIL", "broker call", str(exc))
    return _finish(rep, report_dir, gw)


def _finish(rep: Report, report_dir: Path, gw: MT5Gateway | None = None) -> int:
    if gw is not None:
        gw.shutdown()
    report_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    path = report_dir / f"diagnose_{stamp}.json"
    path.write_text(json.dumps([{"status": s, "check": c, "detail": d} for s, c, d in rep.items], indent=2),
                    encoding="utf-8")
    fails = sum(1 for s, _, _ in rep.items if s == "FAIL")
    warns = sum(1 for s, _, _ in rep.items if s == "WARN")
    print(f"\nRESULT: {'FAIL' if fails else 'PASS'}  ({fails} fail, {warns} warn)  report: {path}")
    return 1 if rep.failed else 0
