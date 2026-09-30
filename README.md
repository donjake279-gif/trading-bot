# MT5 Rules-Based Trading System

A modular research and execution framework for MetaTrader 5. Its purpose is to test whether a
precisely defined strategy has a statistically defensible edge with controlled risk.
**No profitability is implied or promised.**

The build is split into three phases. **Phase 1 answers the only question that matters before any live
plumbing: does strategy S1 have an edge after costs?** Phases 2 and 3 only happen if it does.

| Phase | Step | Status |
|---|---|---|
| | 1 Architecture (`docs/ARCHITECTURE.md`) | done |
| | 2 Strategy spec (`docs/STRATEGY.md`) | done |
| | 3 MT5 connection + market data + history download | done |
| | 4 Indicators + market structure (swings, BOS/CHoCH, legs, sweeps) | done |
| | 5 Strategy S1 rules + signal score | done |
| 1 | 6 Position sizing + currency/correlation exposure + risk manager | done |
| 1 | Gates: sessions, spread, volatility, news, cooldown, circuit breakers | done |
| 1 | 11 Backtester + metrics + the STRATEGY §0 verdict | **done: run it on your data** |
| 1 | 12 Walk-forward, Monte Carlo, robustness report | only if 11 passes |
| 2 | 7 Execution · 8 Trade management · 9 Safety manager + restart sync · 10 Trade database · 13 Dashboard | only if 12 passes |
| 3 | 14 Weeks of demo trading · 15 Live, small size | only if 13 passes |

**The bot cannot place trades.** Order sending stays disabled in code until STEP 7.

## Setup (Windows)

1. Python 3.12 (64-bit) is installed. Open **Command Prompt** and go to the project:
   ```
   cd %USERPROFILE%\Documents\mt5_trading_bot
   ```
2. Install the dependencies (one time, a few minutes):
   ```
   python -m pip install -r requirements.txt
   ```
3. Run the tests (should print `226 passed`, under a minute):
   ```
   python -m pytest -q
   ```
4. With **MetaTrader 5 open and logged into your demo account**, run the read-only health check:
   ```
   python main.py diagnose
   ```
   It lists every check as OK / INFO / WARN / FAIL and saves a report in `logs\`. It never trades.

`1_setup_and_check.bat` does steps 2–4 in one go.

## Downloading history for backtests

In MetaTrader 5, go to **Tools → Options → Charts** and set **Max bars in chart = Unlimited**. Restart MT5, then run
`2_download_history.bat`, or:
```
python main.py download-data --start 2019-10-01
```
(Starting in Oct 2019 gives the analysis ~1,100 bars of warm-up before the 2020 test period begins.)
This saves M1 bars to `data\history\<SYMBOL>\M1_<year>.parquet`, plus any conversion pairs the backtest needs
(e.g. AUDUSD so EURAUD P&L can be converted to USD). It also writes `data\history\quality_report.json` and
`data\history\symbol_specs.json` (your broker's contract sizes, lot steps and swap rates).
If your broker's history starts later than 2020, the command tells you. Re-running only refreshes the current year.

**Already downloaded before this update?** Run it once more: it is quick, because completed years are skipped, and it
adds `symbol_specs.json`. Without that file the backtest assumes standard FX specs and no swap, and it says so.

## Running the backtest (Phase 1)

**First, set your broker's real commission** in `config\settings.yaml` → `costs: commission_per_lot_per_side`
(account currency per lot per side; the default 3.5 is a placeholder). Costs decide most short-term strategies.

Then run `3_run_backtest.bat`, or:
```
python main.py backtest --check --open
```
It runs the three checks that STRATEGY §0 fixed before any testing, then prints the verdict and opens the report:

| Run | Period | Must show |
|---|---|---|
| Development | 2020–2023 | average > +0.05 R per trade, t-statistic ≥ 2, at least 300 trades |
| Cost stress | 2020–2023 at 1.5× spread, commission and slippage | average > 0 |
| Validation | 2024 | average > 0 |

R is a trade's result divided by the money it risked: −1 R is a full stop-loss, +2 R a full target.
Expect roughly 5–15 minutes. Each run writes `reports\<time>_<period>_costs_x<m>\` with `report.html` (equity,
drawdown, results by year/symbol/direction/score/session, and what each rule removed), `trades.csv`, `setups.csv`
(every valid setup and why it was or wasn't taken), `equity.csv` and `summary.json`.

**How to read the verdict:**
- **NO EDGE**: S1 must not be traded. Do **not** adjust settings until it passes; every such attempt makes the
  backtest less trustworthy (each run is logged in `reports\experiments.jsonl`, and the count is shown). Next step: a new
  hypothesis, tested on the same machinery.
- **PASSES**: necessary, not sufficient. Next come walk-forward, Monte Carlo and robustness checks (STEP 12), then
  weeks of demo trading.

Other options: `--period validation`, `--costs 2`, `--symbols EURUSD,GBPUSD`, `--start 2022-01-01 --end 2022-07-01`.
The final out-of-sample period (2025 onward) is **sealed**. It is opened once, for a frozen configuration, in STEP 12.

**What the backtest models:** fills at the next minute's open, with spread and slippage; stops checked on the bid for
longs and the ask for shorts; stop first when stop and target fall in the same minute; gaps fill at the worse open;
commission per side; swap from your broker's rates (triple on Wednesdays); profit converted at historical rates. It also
applies the same risk sizing, gates, cooldowns and circuit breakers as live trading.

**What it doesn't model yet:** the news filter (no historical calendar); extra spread around the daily rollover;
break-even, trailing and partial exits (STEP 8, each tested separately against plain fixed stop and target).

**Sanity check performed:** on price series with no trend at all (pure random walks), the backtest shows a loss of
about −0.2 R per trade, i.e. the costs, and never a profit. A backtester that found an edge there would be lying.

## Safety defaults
- Mode defaults to `demo`. A demo config **refuses to start** if MT5 is logged into a real account.
- Live mode requires three separate confirmations (ARCHITECTURE §9).
- Order-sending functions are disabled in code until STEP 7.
