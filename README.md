# MT5 Rules-Based Trading System

A modular research and execution framework for MetaTrader 5. Its purpose is to test whether a
precisely defined strategy has a statistically defensible edge with controlled risk.
**No profitability is implied or promised.**

| Step | Status |
|---|---|
| 1 Architecture (`docs/ARCHITECTURE.md`) | done |
| 2 Strategy spec (`docs/STRATEGY.md`) | done |
| 3 MT5 connection + market data + history download | done |
| 4 Indicators + market structure (swings, BOS/CHoCH, legs, sweeps) | done |
| 5 Strategy S1 rules + signal score (`core/strategy.py`, `core/signal_engine.py`) | done |
| 6 Position sizing + currency/correlation exposure + risk manager | **done** |
| 7+ Execution, safety, … | not yet. **The bot cannot place trades yet** |

STEP 5 finds S1 setups and scores them, but nothing acts on them yet. How each rule is applied in code
is in `docs/STRATEGY.md` §13.

## Setup (Windows)

1. Python 3.12 (64-bit) is installed. Open **Command Prompt** and go to the project:
   ```
   cd %USERPROFILE%\Documents\mt5_trading_bot
   ```
2. Install the dependencies (one time, a few minutes):
   ```
   python -m pip install -r requirements.txt
   ```
3. Run the tests (should print `185 passed`, about 20 seconds):
   ```
   python -m pytest -q
   ```
4. With **MetaTrader 5 open and logged into your demo account**, run the read-only health check:
   ```
   python main.py diagnose
   ```
   It lists every check as OK / INFO / WARN / FAIL and saves a report in `logs\`. It never trades.

## Downloading history for backtests

In MetaTrader 5, go to **Tools → Options → Charts** and set **Max bars in chart = Unlimited**. Restart MT5, then run:
```
python main.py download-data --start 2019-10-01
```
(Starting in Oct 2019 gives the analysis ~1,100 bars of warm-up before the 2020 test period begins.)
This saves M1 bars to `data\history\<SYMBOL>\M1_<year>.parquet`, plus any conversion pairs the backtest needs
(e.g. AUDUSD so EURAUD P&L can be converted to USD). It also writes `data\history\quality_report.json`.
If your broker's history starts later than 2020, the command tells you. Re-running only refreshes the current year.

## Safety defaults
- Mode defaults to `demo`. A demo config **refuses to start** if MT5 is logged into a real account.
- Live mode requires three separate confirmations (ARCHITECTURE §9).
- Order-sending functions are disabled in code until STEP 7.
