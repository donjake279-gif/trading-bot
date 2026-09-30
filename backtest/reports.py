"""Backtest outputs: CSV/JSON files, a self-contained HTML report, a console summary and the experiment log.

Every run is appended to ``reports/experiments.jsonl`` (ARCHITECTURE §11.3): the number of configurations
ever tried is part of judging whether a good result is luck.
"""

from __future__ import annotations

import html
import json
import math
from collections.abc import Sequence
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd

from backtest.backtester import BacktestResult
from backtest.metrics import Check, Stats, breakdown, score_bucket, verdict_text

NY = "America/New_York"


def _jsonable(x: Any) -> Any:
    if isinstance(x, datetime):
        return x.isoformat()
    if isinstance(x, float) and not math.isfinite(x):
        return None
    if isinstance(x, dict):
        return {str(k): _jsonable(v) for k, v in x.items()}
    if isinstance(x, (list, tuple)):
        return [_jsonable(v) for v in x]
    return x


def trades_frame(result: BacktestResult) -> pd.DataFrame:
    rows = []
    for t in result.trades:
        info = result.trade_info.get(t.trade_id, {})
        rows.append({
            "trade_id": t.trade_id, "symbol": t.symbol, "direction": t.direction.name,
            "open_time_utc": t.open_time_utc.isoformat(), "close_time_utc": t.close_time_utc.isoformat(),
            "entry": t.entry_price, "exit": t.exit_price, "stop": t.initial_sl, "target": t.initial_tp,
            "volume": t.volume, "risk_amount": round(t.risk_amount, 2), "risk_pct": round(t.risk_pct, 4),
            "gross_pnl": round(t.gross_pnl, 2), "commission": round(t.commission, 2), "swap": round(t.swap, 2),
            "net_pnl": round(t.net_pnl, 2), "r_multiple": round(t.r_multiple, 4), "exit_reason": t.exit_reason.value,
            "hold_hours": round(t.holding_time.total_seconds() / 3600, 2),
            "mfe_R": round(t.mfe_price / abs(t.entry_price - t.initial_sl), 3) if t.entry_price != t.initial_sl else None,
            "mae_R": round(t.mae_price / abs(t.entry_price - t.initial_sl), 3) if t.entry_price != t.initial_sl else None,
            "score": round(info["score"], 2) if "score" in info else None, "session": info.get("session"),
            "regime": info.get("regime"), "retracement": info.get("retracement"), "sweep": info.get("sweep"),
            "cost_R": info.get("cost_R"), "setup_id": info.get("setup_id"),
        })
    return pd.DataFrame(rows)


def summary_dict(result: BacktestResult, stats: Stats, checks: Sequence[Check] | None = None) -> dict[str, Any]:
    trades = result.trades
    info = result.trade_info
    o = result.options
    return _jsonable({
        "label": o.label, "start": o.start, "end": o.end, "symbols": list(o.symbols),
        "cost_multiplier": o.cost_multiplier, "account_currency": result.account_currency,
        "initial_balance": result.initial_balance, "final_balance": round(result.final_balance, 2),
        "settings_hash": result.settings_hash, "runtime_seconds": round(result.runtime_seconds, 1),
        "stats": stats.as_dict(),
        "funnel": {"s1_triggers_in_active_leg": result.triggers,
                   "valid_setups": len(result.decisions),
                   "filled": sum(1 for d in result.decisions if d["outcome"] == "filled")},
        "s1_rule_rejections": dict(result.rule_failures.most_common()),
        "gate_rejections": dict(result.gate_failures.most_common()),
        "by_year": breakdown(trades, lambda t: t.open_time_utc.year),
        "by_symbol": breakdown(trades, lambda t: t.symbol),
        "by_direction": breakdown(trades, lambda t: t.direction.name),
        "by_score": breakdown(trades, lambda t: score_bucket(info.get(t.trade_id, {}).get("score"))),
        "by_session": breakdown(trades, lambda t: info.get(t.trade_id, {}).get("session", "n/a")),
        "by_exit": breakdown(trades, lambda t: t.exit_reason.value),
        "breaker_trips": result.breaker_trips,
        "warnings": result.warnings,
        "checks": [c.__dict__ for c in checks] if checks else None,
        "verdict": verdict_text(checks) if checks else None,
        "data": result.data_summary,
    })


def write_outputs(result: BacktestResult, stats: Stats, out_dir: Path,
                  checks: Sequence[Check] | None = None) -> dict[str, Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    paths = {name: out_dir / name for name in ("trades.csv", "setups.csv", "equity.csv", "summary.json",
                                               "report.html")}
    trades_frame(result).to_csv(paths["trades.csv"], index=False)
    setups = pd.DataFrame(result.decisions)
    if not setups.empty:
        setups["time"] = setups["time"].map(lambda t: t.isoformat())
    setups.to_csv(paths["setups.csv"], index=False)
    equity_hourly(result).to_csv(paths["equity.csv"], index_label="time_utc")
    summary = summary_dict(result, stats, checks)
    paths["summary.json"].write_text(json.dumps(summary, indent=2), encoding="utf-8")
    paths["report.html"].write_text(html_report(result, summary), encoding="utf-8")
    return paths


def equity_hourly(result: BacktestResult) -> pd.Series:
    if len(result.equity) == 0:
        return pd.Series(dtype=float, name="equity")
    s = pd.Series(result.equity, index=pd.to_datetime(result.equity_ns, utc=True), name="equity")
    return s.resample("1h").last().dropna().round(2)


def append_experiment(log: Path, result: BacktestResult, stats: Stats) -> int:
    """Append one line per run; returns how many runs the log now holds."""
    log.parent.mkdir(parents=True, exist_ok=True)
    o = result.options
    entry = _jsonable({"run_at": datetime.now(timezone.utc), "label": o.label, "start": o.start, "end": o.end,
                       "symbols": list(o.symbols), "cost_multiplier": o.cost_multiplier,
                       "settings_hash": result.settings_hash, "trades": stats.trades,
                       "expectancy_r": stats.expectancy_r, "t_stat": stats.t_stat})
    with log.open("a", encoding="utf-8") as f:
        f.write(json.dumps(entry) + "\n")
    return sum(1 for _ in log.open(encoding="utf-8"))


def distinct_configs(log: Path) -> int:
    if not log.exists():
        return 0
    hashes = {json.loads(line).get("settings_hash") for line in log.read_text(encoding="utf-8").splitlines() if line}
    return len(hashes)


# ----------------------------------------------------------------------------- console


def _f(x: float, fmt: str) -> str:
    return "n/a" if x is None or (isinstance(x, float) and not math.isfinite(x)) else format(x, fmt)


def console_summary(result: BacktestResult, stats: Stats) -> str:
    o = result.options
    lines = [
        f"=== {o.label}: {o.start:%Y-%m-%d} -> {o.end:%Y-%m-%d}, {', '.join(o.symbols)}, costs x{o.cost_multiplier:g} ===",
        f"  trades              {stats.trades}  ({_f(stats.trades_per_year, '.0f')} per year)",
        f"  expectancy          {_f(stats.expectancy_r, '+.3f')} R per trade   (t = {_f(stats.t_stat, '.2f')})",
        (f"  win rate            {_f(100 * stats.win_rate, '.1f')} %   avg win {_f(stats.avg_win_r, '+.2f')} R, "
         f"avg loss {_f(stats.avg_loss_r, '+.2f')} R"),
        f"  net profit          {stats.net_profit:,.2f} {result.account_currency}  ({stats.return_pct:+.2f} %)",
        (f"  max drawdown        {_f(stats.max_drawdown_pct, '.2f')} %   longest losing streak "
         f"{stats.longest_losing_streak}"),
        f"  profit factor       {_f(stats.profit_factor, '.2f')}   daily Sharpe {_f(stats.sharpe_daily, '.2f')}",
        (f"  funnel              {result.triggers} triggers -> {len(result.decisions)} valid setups -> "
         f"{sum(1 for d in result.decisions if d['outcome'] == 'filled')} trades"),
    ]
    if result.breaker_trips:
        n = sum(1 for t in result.breaker_trips if t["breaker"] == "total_dd")
        lines.append(f"  circuit breakers    {len(result.breaker_trips)} trips"
                     + (f", incl. {n} TOTAL drawdown halt(s) that live would need a manual reset" if n else ""))
    for w in result.warnings:
        lines.append(f"  WARNING: {w}")
    return "\n".join(lines)


def checks_table(checks: Sequence[Check]) -> str:
    lines = ["", "=== STRATEGY §0 checks (fixed before any testing) ==="]
    for c in checks:
        mark = {True: "PASS", False: "FAIL", None: "----"}[c.passed]
        lines.append(f"  [{mark}] {c.name:<32} {c.rule:<24} {c.value}")
    lines.append("")
    lines.append(verdict_text(checks))
    return "\n".join(lines)


# ----------------------------------------------------------------------------- HTML

_CSS = """
.viz-root { color-scheme: light; --surface-1:#fcfcfb; --surface-2:#f3f2ef; --text-primary:#0b0b0b;
  --text-secondary:#52514e; --rule:#e2e1dc; --series-1:#2a78d6; --pass:#008300; --fail:#c23b3a; }
@media (prefers-color-scheme: dark) { :root:where(:not([data-theme="light"])) .viz-root { color-scheme: dark;
  --surface-1:#1a1a19; --surface-2:#242423; --text-primary:#ffffff; --text-secondary:#c3c2b7; --rule:#3a3a38;
  --series-1:#3987e5; --pass:#4caf50; --fail:#e66767; } }
:root[data-theme="dark"] .viz-root { color-scheme: dark; --surface-1:#1a1a19; --surface-2:#242423;
  --text-primary:#ffffff; --text-secondary:#c3c2b7; --rule:#3a3a38; --series-1:#3987e5; --pass:#4caf50;
  --fail:#e66767; }
body { margin:0; background:#fcfcfb; }
@media (prefers-color-scheme: dark) { body { background:#1a1a19; } }
.viz-root { background:var(--surface-1); color:var(--text-primary); font:14px/1.45 system-ui, sans-serif;
  max-width:1100px; margin:0 auto; padding:24px 16px; }
h1 { font-size:20px; margin:0 0 4px; } h2 { font-size:16px; margin:28px 0 8px; }
.sub { color:var(--text-secondary); margin:0 0 16px; }
.tiles { display:grid; grid-template-columns:repeat(auto-fit, minmax(150px, 1fr)); gap:8px; }
.tile { background:var(--surface-2); border-radius:8px; padding:10px 12px; }
.tile .k { color:var(--text-secondary); font-size:12px; } .tile .v { font-size:20px; font-variant-numeric:tabular-nums; }
table { border-collapse:collapse; width:100%; font-variant-numeric:tabular-nums; }
th, td { text-align:right; padding:4px 8px; border-bottom:1px solid var(--rule); }
th:first-child, td:first-child { text-align:left; } th { color:var(--text-secondary); font-weight:600; }
.tables { display:grid; grid-template-columns:repeat(auto-fit, minmax(440px, 1fr)); gap:8px 32px; }
.verdict { background:var(--surface-2); border-radius:8px; padding:12px; }
.pass { color:var(--pass); font-weight:600; } .fail { color:var(--fail); font-weight:600; }
.warn { color:var(--text-secondary); } .chart { height:320px; } .scroll { overflow-x:auto; }
.tables > div { min-width:0; } @media (max-width: 520px) { .tables { grid-template-columns:1fr; } }
"""


_HEADERS = {"group": "", "trades": "trades", "win_rate": "win %", "expectancy_r": "avg R", "total_r": "total R",
            "net_profit": "net profit"}


def _cell(col: str, value: Any) -> str:
    if col == "win_rate" and isinstance(value, (int, float)):
        return f"{100 * value:.0f}"
    if col in ("expectancy_r", "total_r") and isinstance(value, (int, float)):
        return f"{value:+.2f}"
    if col == "net_profit" and isinstance(value, (int, float)):
        return f"{value:,.0f}"
    return str(value)


def _table(rows: list[dict[str, Any]], title: str) -> str:
    if not rows:
        return f"<div><h2>{html.escape(title)}</h2><p class='sub'>none</p></div>"
    cols = list(rows[0])
    head = "".join(f"<th>{html.escape(_HEADERS.get(c, c.replace('_', ' ')))}</th>" for c in cols)
    body = "".join("<tr>" + "".join(f"<td>{html.escape(_cell(c, r[c]))}</td>" for c in cols) + "</tr>"
                   for r in rows)
    return (f"<div><h2>{html.escape(title)}</h2><div class='scroll'><table><thead><tr>{head}</tr></thead>"
            f"<tbody>{body}</tbody></table></div></div>")


def _plotly_js() -> str:
    try:
        from plotly.offline import get_plotlyjs
        return f"<script>{get_plotlyjs()}</script>"
    except ImportError:  # the report still opens; charts need internet then
        return '<script src="https://cdn.jsdelivr.net/npm/plotly.js-dist-min@2.35.2/plotly.min.js"></script>'


def html_report(result: BacktestResult, summary: dict[str, Any]) -> str:
    s = summary["stats"]
    eq = equity_hourly(result)
    peak = eq.cummax()
    dd = ((eq - peak) / peak * 100).round(3)
    x = [t.isoformat() for t in eq.index]

    def tile(k: str, v: str) -> str:
        return f"<div class='tile'><div class='k'>{html.escape(k)}</div><div class='v'>{html.escape(v)}</div></div>"

    def num(v: Any, fmt: str) -> str:
        return "n/a" if v is None else format(v, fmt)

    tiles = "".join([
        tile("Trades", f"{s['trades']} ({num(s['trades_per_year'], '.0f')}/yr)"),
        tile("Expectancy", f"{num(s['expectancy_r'], '+.3f')} R"),
        tile("t-statistic", num(s["t_stat"], ".2f")),
        tile("Win rate", f"{num(s['win_rate'] * 100 if s['win_rate'] is not None else None, '.1f')} %"),
        tile("Net profit", f"{s['net_profit']:,.0f} {summary['account_currency']} ({s['return_pct']:+.1f} %)"),
        tile("Max drawdown", f"{num(s['max_drawdown_pct'], '.2f')} %"),
        tile("Profit factor", num(s["profit_factor"], ".2f")),
    ])
    verdict = ""
    if summary.get("checks"):
        rows = "".join(
            f"<tr><td>{html.escape(c['name'])}</td><td>{html.escape(c['rule'])}</td><td>{html.escape(c['value'])}</td>"
            f"<td class='{'pass' if c['passed'] else 'fail' if c['passed'] is False else ''}'>"
            f"{'PASS' if c['passed'] else 'FAIL' if c['passed'] is False else 'not run'}</td></tr>"
            for c in summary["checks"])
        verdict = (f"<h2>STRATEGY §0 checks</h2><div class='verdict'><div class='scroll'><table><thead><tr>"
                   f"<th>Check</th><th>Rule</th><th>Value</th><th>Result</th></tr></thead><tbody>{rows}</tbody>"
                   f"</table></div>"
                   f"<p>{html.escape(summary['verdict'])}</p></div>")
    funnel = summary["funnel"]
    rej = [{"rule": k, "evaluations rejected": v} for k, v in summary["s1_rule_rejections"].items()]
    gates = [{"gate": k, "setups rejected": v} for k, v in summary["gate_rejections"].items()]
    warnings = "".join(f"<li class='warn'>{html.escape(w)}</li>" for w in summary["warnings"])
    trips = [{"time": t["time"], "breaker": t["breaker"], "measured": t["measured"], "threshold": t["threshold"]}
             for t in summary["breaker_trips"]]
    data = {"x": x, "equity": [round(v, 2) for v in eq.tolist()], "dd": dd.tolist()}
    return f"""<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,
initial-scale=1"><title>S1 backtest report</title><style>{_CSS}</style>{_plotly_js()}</head><body><div class="viz-root">
<h1>S1 backtest: {html.escape(summary['label'])}</h1>
<p class="sub">{html.escape(summary['start'][:10])} to {html.escape(summary['end'][:10])} · {html.escape(', '.join(summary['symbols']))}
· costs ×{summary['cost_multiplier']:g} · settings {html.escape(summary['settings_hash'])} · R = result ÷ money risked</p>
<div class="tiles">{tiles}</div>{verdict}
<h2>Account equity ({html.escape(summary['account_currency'])})</h2><div id="eq" class="chart"></div>
<h2>Drawdown from peak (%)</h2><div id="dd" class="chart"></div>
<p class="sub">Funnel: {funnel['s1_triggers_in_active_leg']} S1 triggers → {funnel['valid_setups']} valid setups →
{funnel['filled']} trades.</p>
<div class="tables">{_table(summary['by_year'], 'By year')}{_table(summary['by_symbol'], 'By symbol')}
{_table(summary['by_direction'], 'By direction')}{_table(summary['by_score'], 'By score (does a higher score help?)')}
{_table(summary['by_session'], 'By session')}{_table(summary['by_exit'], 'By exit reason')}
{_table(rej, 'S1 rules: what they removed')}{_table(gates, 'Gates and risk: what they removed')}
{_table(trips, 'Circuit-breaker trips')}</div>
<h2>Warnings</h2><ul>{warnings or "<li class='warn'>none</li>"}</ul>
</div>
<script>
const D = {json.dumps(data)};
const css = getComputedStyle(document.querySelector('.viz-root'));
const v = n => css.getPropertyValue(n).trim();
const layout = (yTitle) => ({{margin: {{l: 64, r: 16, t: 8, b: 40}}, paper_bgcolor: v('--surface-1'),
  plot_bgcolor: v('--surface-1'), font: {{color: v('--text-secondary'), size: 12}}, hovermode: 'x',
  xaxis: {{showgrid: false, linecolor: v('--rule'), showspikes: true, spikemode: 'across', spikethickness: 1,
    spikecolor: v('--text-secondary'), spikedash: 'solid'}},
  yaxis: {{title: yTitle, gridcolor: v('--rule'), zeroline: false}}}});
const line = (y, name, fmt) => [{{x: D.x, y: y, type: 'scatter', mode: 'lines', name: name,
  line: {{color: v('--series-1'), width: 2}}, hovertemplate: '%{{x|%Y-%m-%d %H:%M}} UTC<br>' + fmt + '<extra></extra>'}}];
if (window.Plotly && D.x.length) {{
  Plotly.newPlot('eq', line(D.equity, 'Equity', '%{{y:,.2f}}'), layout(''), {{displaylogo: false, responsive: true}});
  Plotly.newPlot('dd', line(D.dd, 'Drawdown', '%{{y:.2f}} %'), layout(''), {{displaylogo: false, responsive: true}});
}}
</script></body></html>"""
