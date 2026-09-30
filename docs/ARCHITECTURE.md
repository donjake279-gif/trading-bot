# MT5 Trading System — Architecture (STEP 1)

Status: design v0.1 · Strategy: not yet defined (STEP 2) · Nothing in this document implies profitability.

The project's objective is to find out whether a rules-based strategy has a repeatable,
statistically defensible edge with controlled risk on unseen data. The architecture serves
that goal first and live trading second. Most of the decisions below are there to stop the
system from telling us something false: look-ahead bias, leakage, cost blindness, silent
state drift and overfitting.

---

## 0. Non-negotiable principles

| # | Principle | How the architecture enforces it |
|---|-----------|----------------------------------|
| P1 | **MT5 is the source of truth** for positions, orders, deals and account state. | Local state is only a cache. `Reconciler` compares it with MT5 on startup and on every cycle, and MT5 wins every conflict. |
| P2 | **One code path for backtest and live.** | Strategy, scoring, filters, risk, safety and position management depend only on *ports* (`BrokerGateway`, `Clock`, `Journal`, `CalendarSource`). Live runs inject `MT5Gateway` + `LiveClock`; backtests inject `SimBroker` + `SimClock`. No strategy code is aware of which mode it is in. |
| P3 | **Decisions use closed bars only.** | `MarketData` never returns the forming bar. Higher timeframes are joined by *close time*, never by open time (§8). |
| P4 | **Every trade has a stop loss.** | `OrderIntent` refuses to be built without an SL on the correct side of entry. If a position is ever seen without an SL, the bot sets one or closes the position (§7.4). |
| P5 | **No martingale, grid, averaging-down or recovery sizing.** | Sizing is a pure function of equity × risk % ÷ loss-per-lot at the stop. It takes no input about past losses except to *reduce* risk (optional) or block entries. Adding to a losing position is structurally impossible: one position per setup ID, and the SL may only ever tighten. |
| P6 | **Fail closed for entries, fail safe for management.** | Any uncertainty (disconnect, stale data, unknown order outcome, unverifiable account) blocks *new entries*. Existing positions always keep broker-side SL/TP, so a crashed bot does not leave naked risk. |
| P7 | **Never resend an order whose outcome is unknown.** | Order state machine with an `UNKNOWN → VERIFY` step (§7). |
| P8 | **Everything is explainable.** | Each candidate setup produces a `DecisionRecord` with every score component, every gate result and the final reason, whether accepted or rejected. |
| P9 | **The final out-of-sample period is sealed.** | `PeriodVault` refuses OOS runs unless the config is frozen, and it logs every OOS access (§11.2). |
| P10 | **Demo is the default; live needs two independent confirmations.** | §9. |

---

## 1. Key design decisions (and why)

### 1.1 Python-first, with a small MQL5 component. No execution EA.

**Decision:** Python runs execution through the official `MetaTrader5` package. MQL5 is used for one job only: exporting MetaTrader's built-in **Economic Calendar**, which the Python package cannot access.

**Why no execution EA bridge:**
- `mt5.order_send()` is synchronous and returns a full `MqlTradeResult` (retcode, deal, order, price, volume). A file- or socket-based EA bridge would add a second state machine, a message protocol, and its own failure modes (lost messages, partial writes, duplicated commands). Those are exactly the failure modes we want to avoid.
- SL and TP are attached **server-side in the same request**. If Python crashes, the broker still enforces the stop. An EA adds no protection there.
- Backtests run in Python, so keeping live logic in Python lets both modes share one implementation (P2). An EA would mean a second copy of the strategy in MQL5, and the two copies would drift apart.

**When we would add an EA later (optional, not in scope now):** a small "guardian" EA that independently enforces the daily loss limit, closing all positions tagged with our magic numbers if equity drops below a hard floor, even when Python is dead. It is a belt-and-braces layer and does not replace any Python logic. I'll propose it at STEP 15.

**Consequences:**
- It requires **Windows** (the `MetaTrader5` package is Windows-only) with the MT5 terminal running and logged in. A Windows VPS near the broker is recommended for demo/live.
- **Only one process may talk to the terminal.** The package holds a single IPC connection per process, and its calls are not thread-safe. The dashboard therefore never calls MT5. It reads SQLite and sends commands through a control table (§5).

### 1.2 Economic calendar via MetaTrader's built-in calendar

`CalendarExporter.mq5` (an MT5 *Service*, so it needs no chart) calls `CalendarValueHistory()` / `CalendarEventById()` / `CalendarCountryById()`. Every N minutes it writes upcoming and recent events to `MQL5/Files/Common/calendar_events.csv`. The same program can export history for backtests.

- Only the **scheduled time, currency and importance** are used. Actual, forecast and previous values are never used as features, because they are revised after the fact and would leak future information.
- If the file is missing or older than `news.max_feed_age_minutes`, the filter's status becomes `UNAVAILABLE`, and the configured policy applies (§6.5). **We never invent events.**
- Known limitation: unscheduled events (emergency central-bank meetings, surprise remarks) are not covered by any schedule-based filter.

### 1.3 Storage: SQLite (WAL mode) plus an append-only emergency log

- `data/live.sqlite` holds live and demo records, and `data/research.sqlite` holds backtests and experiments. Keeping them in separate files means research runs cannot pollute trading records.
- WAL mode lets the dashboard read while the bot writes.
- If a DB write fails, the record goes to `logs/emergency_YYYYMMDD.jsonl` (append-only, fsync). If **both** fail, new entries are blocked and position management continues (§10).

### 1.4 Dashboard: Streamlit in a separate process

It is read-only against SQLite. Commands (START / STOP / PAUSE / RESUME / CLOSE_ALL) are inserted into `control_commands` and executed by the bot at the start of its next cycle. The bot re-validates each command, and the mode banner (DEMO/LIVE) comes from the **account trade mode the bot actually observed**, not from the config file. A console status line in the bot process gives a minimal view without the dashboard.

### 1.5 Backtest fidelity: M1 bid bars + explicit cost model, event-driven

- The base data is MT5 M1 bars (bid) for 2020-01-01 onward. Higher timeframes are **resampled from M1 on broker-time boundaries**, so they match MT5's own bars and share one source of truth.
- Fills are modelled on the bar *after* the decision (§11.1). Spread, commission, slippage and swap are modelled explicitly. When SL and TP both fall inside one M1 bar, **the SL is assumed to be hit first** (pessimistic).
- Tick-level replay is not the default. Broker tick history for 2020–2026 is usually incomplete, and M1 with pessimistic intra-bar rules is more honest than a partial tick set. Tick replay can be added for a short period as a *verification* of the M1 model.

---

## 2. Runtime topology

```
┌──────────────────────── Windows host / VPS ─────────────────────────────┐
│                                                                          │
│  ┌──────────────────────┐        IPC (MetaTrader5 pkg)                   │
│  │  MT5 Terminal         │◄──────────────────────────────┐               │
│  │  - logged-in account  │                               │               │
│  │  - Algo Trading ON    │                               │               │
│  │  - CalendarExporter   │── writes ──► Common/Files/     │               │
│  │    (MQL5 Service)     │             calendar_events.csv│               │
│  └──────────────────────┘                    │           │               │
│                                               │ reads     │               │
│  ┌────────────────────────────────────────────▼───────────┴────────────┐ │
│  │  BOT PROCESS  (python main.py run)   — the ONLY process using MT5   │ │
│  │  single-threaded deterministic loop; see §4                          │ │
│  └───────────────┬───────────────────────────────▲─────────────────────┘ │
│        writes    │                               │ polls control_commands │
│                  ▼                               │                        │
│  ┌──────────────────────────────────────────────────────────────────┐    │
│  │  data/live.sqlite  (WAL)     logs/*.jsonl (structured + emergency)│    │
│  └──────────────────────────────▲───────────────────────────────────┘    │
│                  reads          │   inserts commands                      │
│  ┌──────────────────────────────┴───────────────┐                        │
│  │  DASHBOARD PROCESS (streamlit) — never MT5   │ ◄── browser localhost   │
│  └──────────────────────────────────────────────┘                        │
└──────────────────────────────────────────────────────────────────────────┘

Research (any OS with the data files):
  python main.py backtest | walkforward | montecarlo | robustness
  → reads data/history/*.parquet, writes data/research.sqlite + reports/
```

---

## 3. Module map

### 3.1 Layers (dependencies point downward only)

```
  L5  Entry points       main.py (CLI) · dashboard/dashboard.py
  L4  Orchestration      core/orchestrator.py (live loop) · backtest/backtester.py (sim loop)
  L3  Services (stateful, depend on ports)
                         execution · position_manager · safety_manager · reconciler
                         risk_manager · market_data · news_filter · cooldown
  L2  Domain logic (PURE functions, no I/O, no clock, fully unit-testable)
                         indicators · market_structure · strategy · signal_engine
                         position_sizer · exposure · exits · session_manager · filters
  L1  Contracts          core/types.py (messages) · core/ports.py (interfaces)
                         core/config.py (typed, validated settings)
  L0  Adapters (the only modules touching the outside world)
                         core/mt5_connection.py  (ONLY file that imports MetaTrader5)
                         backtest/sim_broker.py  · storage/* · news CSV reader · clocks
```

The rules that keep this honest:
- **L2 modules cannot import anything from L0/L3/L4.** A unit test enforces it by scanning imports. Pure functions cannot peek at the future, because they only receive the data they are given.
- **`import MetaTrader5` appears in exactly one file.** Tests also enforce this.
- No module calls `datetime.now()`. Time comes from the injected `Clock`.

### 3.2 Project tree (target)

```
mt5_trading_bot/
├── main.py                      CLI: run | shadow | backtest | walkforward | montecarlo | robustness | dashboard | download-data
├── config/
│   └── settings.yaml            all tunables (strategy section defined in STEP 2)
├── core/
│   ├── types.py                 immutable message types (L1)       ← written in STEP 1
│   ├── ports.py                 BrokerGateway, Clock, Journal, CalendarSource (L1)  ← STEP 1
│   ├── config.py                pydantic models + validation of settings.yaml
│   ├── errors.py                exception hierarchy
│   ├── clock.py                 LiveClock, SimClock
│   ├── timeutils.py             broker-time ⇄ UTC, trading-day boundaries, DST
│   ├── mt5_connection.py        MT5Gateway adapter (connect, health, orders, history)
│   ├── market_data.py           closed-bar retrieval, MTF alignment, staleness, spread sampling
│   ├── indicators.py            ATR, returns, rolling stats (pure)
│   ├── market_structure.py      swings, HH/HL/LH/LL, trend/range, BOS/CHoCH, liquidity (pure)
│   ├── strategy.py              setup detection → SetupCandidate (pure)
│   ├── signal_engine.py         scoring → ScoredSignal with component reasons (pure)
│   ├── filters.py               spread, volatility, cost-vs-RR gates (pure)
│   ├── session_manager.py       session windows in exchange-local timezones (pure)
│   ├── news_filter.py           calendar feed reader + blackout gate
│   ├── cooldown.py              setup-ID dedupe, per-session caps, post-loss cooldown
│   ├── position_sizer.py        lot size from risk (pure)
│   ├── exposure.py              currency-leg and correlation exposure (pure)
│   ├── risk_manager.py          composes sizer + exposure + portfolio limits → RiskDecision
│   ├── safety_manager.py        health gates + circuit breakers (persisted state machine)
│   ├── execution.py             order pre-checks, send, retcode policy, UNKNOWN verification
│   ├── exits.py                 BE / trailing / ATR / structure / partial rules (pure)
│   ├── position_manager.py      applies exits to open positions via execution
│   ├── reconciler.py            MT5 ⇄ local state sync, orphan/phantom handling
│   ├── orchestrator.py          the live trading cycle
│   └── logging_setup.py         JSON structured logging
├── mql5/
│   └── CalendarExporter.mq5     MT5 Service exporting the economic calendar
├── backtest/
│   ├── data_loader.py           download M1 history from MT5 → parquet; quality report
│   ├── cost_model.py            spread / commission / slippage / swap models
│   ├── sim_broker.py            BrokerGateway implementation for simulation
│   ├── backtester.py            event loop reusing the live services
│   ├── splits.py                PeriodVault: dev / validation / sealed OOS
│   ├── metrics.py               all performance statistics
│   ├── walk_forward.py          rolling train/test windows
│   ├── monte_carlo.py           bootstrap / block bootstrap with the real risk rules
│   ├── robustness.py            overfitting checks, cost stress, parameter sensitivity
│   ├── experiments.py           experiment registry (counts every config ever tested)
│   └── reports.py               HTML/PNG reports, equity curves
├── models/
│   ├── features.py              feature extraction from the signal-time snapshot only
│   └── ml_filter.py             optional stage-2 "take this valid setup?" classifier
├── storage/
│   ├── database.py              schema, migrations, WAL connection, retry
│   ├── journal.py               Journal port implementation (decisions, orders, trades…)
│   └── emergency_log.py         append-only JSONL fallback
├── dashboard/
│   ├── dashboard.py             Streamlit UI
│   └── console_status.py        one-line status in the bot console
├── tests/                       unit + integration (SimBroker) tests
├── docs/ARCHITECTURE.md         this file
├── data/  logs/  reports/       runtime output (git-ignored)
├── requirements.txt  .env.example  README.md
```

### 3.3 Requirement → module traceability

| Requested component | Module(s) |
|---|---|
| MT5 connection manager | `core/mt5_connection.py` |
| Market data manager | `core/market_data.py`, `backtest/data_loader.py` |
| Strategy engine | `core/strategy.py` |
| Market structure engine | `core/market_structure.py`, `core/indicators.py` |
| Signal engine / scoring | `core/signal_engine.py` |
| Risk manager | `core/risk_manager.py`, `core/exposure.py` |
| Position sizing | `core/position_sizer.py` |
| Trade execution | `core/execution.py` |
| Open-position manager | `core/position_manager.py` |
| SL / TP / trailing / break-even / partials | `core/exits.py` (rules), `core/position_manager.py` (application) |
| Session filter | `core/session_manager.py` |
| Spread / volatility filter | `core/filters.py` |
| News filter | `core/news_filter.py`, `mql5/CalendarExporter.mq5` |
| Cooldown | `core/cooldown.py` |
| Daily loss / drawdown protection, circuit breaker | `core/safety_manager.py` |
| Trade logger | `storage/journal.py`, `storage/emergency_log.py` |
| Statistics / performance | `backtest/metrics.py` (shared with dashboard) |
| Backtesting / walk-forward / Monte Carlo | `backtest/*` |
| Overfitting protection | `backtest/robustness.py`, `backtest/splits.py`, `backtest/experiments.py` |
| ML filter (stage 2) | `models/*` |
| Configuration | `config/settings.yaml`, `core/config.py` |
| Dashboard | `dashboard/*` |
| Restart synchronisation | `core/reconciler.py` |

---

## 4. The live trading cycle (how modules talk)

The orchestrator runs a **single-threaded loop** that polls every `loop.poll_interval_ms` (default 500 ms). Work is triggered by **events** derived from polling: a *new closed bar* on a timeframe, a *management tick*, or a *control command*. Single-threading keeps the sequence deterministic and reproducible in the backtester, which calls the same steps in the same order.

```
every poll:
 ┌─ 1. CONTROL      Journal.pending_commands() → apply START/STOP/PAUSE/RESUME/CLOSE_ALL
 │
 ├─ 2. HEALTH       SafetyManager.health_check(Broker, MarketData, Journal, NewsFeed)
 │                  → HealthReport {connected, terminal_trade_allowed, account_verified,
 │                                  account_unchanged, per-symbol data_fresh, db_ok, news_ok}
 │                  any global failure ⇒ entries blocked this cycle (reason logged)
 │
 ├─ 3. RECONCILE    Reconciler.sync(Broker.positions(magic), Broker.deals(since), Journal)
 │                  → PortfolioState (authoritative open positions + newly closed trades)
 │                  newly closed trades ⇒ Journal.record_trade(ClosedTrade) + Cooldown update
 │
 ├─ 4. SAFETY       SafetyManager.evaluate(PortfolioState, AccountSnapshot, Clock)
 │                  → SafetyStatus {state, can_open_new, trips[]}; persisted; latching
 │
 ├─ 5. MANAGE       on each new closed bar of management_timeframe (default M1):
 │                  PositionManager.evaluate(positions, snapshots) → [ManagementAction]
 │                  Execution.apply(action)  (modify SL/TP, partial close, close)
 │                  ► runs even when entries are blocked; skipped only if disconnected
 │
 ├─ 6. ANALYSE     for each symbol with a new closed bar on the ENTRY timeframe:
 │                  MarketData.snapshot(symbol, decision_time) → MarketSnapshot (closed bars, all TFs)
 │                  MarketStructure.analyse(snapshot)         → StructureState   (pure)
 │                  Strategy.detect(snapshot, structure)       → [SetupCandidate]  (pure)
 │                  SignalEngine.score(candidate, …)           → ScoredSignal      (pure)
 │
 ├─ 7. GATE         Gates.evaluate_all(scored, context)        → [GateResult]  (ALL gates run)
 │                  session · spread · volatility · cost-vs-RR · news · cooldown/dedupe ·
 │                  min-score · safety.can_open_new · health
 │
 ├─ 8. RISK         RiskManager.assess(scored, PortfolioState, Account, SymbolSpec)
 │                  → RiskDecision {volume, risk_amount, exposure checks, reasons}
 │
 ├─ 9. EXECUTE      if all gates pass and risk approved:
 │                  OrderIntent → Execution.submit() → ExecutionResult
 │                  setup_id marked consumed BEFORE send (idempotency, §7)
 │
 └─ 10. JOURNAL     DecisionRecord (candidate + score components + gates + risk + outcome)
                    heartbeat + equity snapshot + status for dashboard
```

**Ordering rules**
- Steps 1–4 always run before any trading action, so no decision is ever made on unreconciled state.
- When several symbols produce setups on the same bar, they are processed in **descending score, then symbol name** order (deterministic), and `PortfolioState` is updated after each approval. The second trade therefore sees the exposure created by the first.
- **All gates are evaluated even after one fails.** The decision is still "reject", but every gate's result is recorded. That lets us measure each filter's effect in research (e.g. "the news filter removed 212 trades; their hypothetical expectancy was X").
- Every step is wrapped at the **symbol boundary**. An exception in one symbol's analysis is logged with its traceback, the symbol is quarantined for `safety.symbol_quarantine_cycles`, and other symbols continue. Too many exceptions per hour trips the `EXCEPTION_RATE` breaker (§6.4). Exceptions inside `Execution` never trigger a resend (§7).

**Why management runs on closed M1 bars rather than on every tick:** the rules must be reproducible in the backtester, which has M1 resolution. The SL and TP sit on the broker's server, so intra-bar protection does not depend on the bot. Tick-level trailing would look better live than it can ever be tested, which is a form of untestable behaviour we want to avoid.

---

## 5. Data contracts (messages between modules)

Defined in `core/types.py`. All are **frozen dataclasses**, so a module cannot mutate what another module handed it. Invariants are validated in `__post_init__`.

| Type | Produced by | Consumed by | Key invariants |
|---|---|---|---|
| `SymbolSpec` | Broker | sizer, execution, filters | tick_size > 0, volume_step > 0, min ≤ max |
| `Quote` | Broker | filters, execution | ask ≥ bid |
| `AccountSnapshot` | Broker | safety, risk, dashboard | equity finite; `trade_mode` DEMO/REAL/CONTEST |
| `MarketSnapshot` | MarketData | structure, strategy, signal | contains **closed bars only**; every frame's last close time ≤ `decision_time` |
| `SetupCandidate` | Strategy | SignalEngine | deterministic `setup_id`; LONG ⇒ stop < entry < target |
| `ScoreComponent` / `ScoredSignal` | SignalEngine | gates, journal | 0 ≤ points ≤ max_points; total = Σ points |
| `GateResult` | gates | orchestrator, journal | name + pass/fail + reason + measured values |
| `RiskDecision` | RiskManager | orchestrator | approved ⇒ volume > 0 and risk ≤ budget |
| `OrderIntent` | orchestrator | Execution | **SL mandatory**, correct side; volume > 0; comment ≤ 31 chars |
| `ExecutionResult` | Execution | orchestrator, journal | status ∈ {FILLED, REJECTED, UNKNOWN, SKIPPED} |
| `PositionState` | Broker/Reconciler | PositionManager, risk, safety | — |
| `ManagementAction` | PositionManager | Execution | SL may only move in the protective direction |
| `ClosedTrade` | Reconciler | journal, metrics, safety, cooldown | R multiple computed from *initial* risk |
| `HealthReport` / `SafetyStatus` | SafetyManager | orchestrator, dashboard | — |
| `DecisionRecord` | orchestrator | Journal | the complete audit trail of one candidate |

Ports (`core/ports.py`):
- **`BrokerGateway`**: `account()`, `symbol_spec()`, `quote()`, `closed_bars()`, `positions()`, `deals()`, `check_order()`, `send_market_order()`, `modify_position()`, `close_position()`, `loss_per_lot()`. Implemented by `MT5Gateway` (live) and `SimBroker` (backtest).
- **`Clock`**: `now_utc()`. `LiveClock` and `SimClock`.
- **`Journal`**: `record_decision()`, `record_order()`, `record_trade()`, `record_safety_event()`, `consume_setup()`, `pending_commands()`… Implemented by SQLite (live), SQLite research DB (backtest), or in-memory (tests).
- **`CalendarSource`**: `events_between()`, `status()`.

---

## 6. Components in detail

### 6.1 Market data (`market_data.py`)
- `closed_bars(symbol, tf, n)` calls `copy_rates_from_pos(symbol, tf, 1, n)`. **Start position 1 skips the forming bar.** It then asserts that `last_bar.close_time ≤ now` (where close_time = open_time + tf).
- **Staleness:** a symbol is stale if `now − last_tick_time > data.max_tick_age_seconds` during its trading hours, or if the last closed entry-TF bar is older than `tf + data.bar_grace_seconds`. A stale symbol gets no new entries. Its open positions are still protected server-side.
- **Spread sampling:** each poll records `ask − bid` (in points) into a rolling per-symbol window. `typical_spread` is the rolling median over `spread.window_minutes`. It is stored so it survives restarts.
- **Gap/quality checks** on each fetch: no duplicate timestamps, monotonic time, OHLC consistency (low ≤ open, close ≤ high).

### 6.2 Market analysis (`indicators.py`, `market_structure.py`)
Every concept (swing, HH/HL, BOS, CHoCH, liquidity sweep, displacement, rejection, range, etc.) gets an **exact formula** in STEP 2 and pure-function code in STEP 4. The architectural constraint is that each function takes `(bars[: t+1], params)` and returns values *at* t. Swing points need k bars on the right to be confirmed, so a swing at bar i is only **known at bar i+k**. The structure engine stores both `pivot_index` and `confirmed_index`, and consumers may only use swings where `confirmed_index ≤ t`. This is the most common look-ahead bug in structure-based systems, and it is enforced by a dedicated test that truncates the data at every t and asserts the output does not change.

### 6.3 Signal scoring (`signal_engine.py`)
- Setup validity is **binary and decided by the strategy**: SL exists, structure conditions hold, RR is achievable. The score only ranks and filters *valid* setups. Hard requirements are never turned into points.
- Components follow the weights you specified (structure 20, trend 15, liquidity 15, entry confirmation 20, volatility 10, RR quality 10, HTF 10). Each component returns `points`, `max_points`, a text `reason`, and the raw `inputs` it measured.
- **The score must earn its place.** In research we test whether higher score buckets actually have higher out-of-sample expectancy. If they don't, the score is decoration and the report will say so. The weights are parameters too, so they are fixed *a priori* and not optimized.

### 6.4 Safety manager (`safety_manager.py`)

**Health gates** (re-evaluated every cycle and not latching): terminal connected; `terminal_info().trade_allowed`; `account_info().trade_allowed` and `trade_expert`; account login and server equal to the values recorded at startup; per-symbol data fresh; DB or emergency log writable; news feed status (per policy); server-time offset matches the configured rule (§8).

**Circuit breakers** (latching, persisted, recomputed from MT5 deal history on restart):

| Breaker | Definition | Default | Reset |
|---|---|---|---|
| `CONSEC_LOSSES` | count of consecutive closed trades with net P&L < 0 | 3 | next trading day |
| `DAILY_DD` | (day_start_equity − equity_now) / day_start_equity, including floating | 2 % | next trading day |
| `WEEKLY_DD` | same measure against week_start_equity | 4 % | next trading week |
| `TOTAL_DD` | (equity_high_watermark − equity_now) / equity_high_watermark | 8 % | **manual only**: `RESET_BREAKER TOTAL_DD` command + config acknowledgment |
| `MAX_TRADES_DAY` | entries today ≥ limit | 4 | next trading day |
| `EXCEPTION_RATE` | unhandled exceptions in the last 60 min ≥ limit | 5 | manual |
| `ORDER_FAILURES` | failed or unknown order sends in the last 60 min ≥ limit | 3 | manual |

- The **trading day** boundary is configurable and defaults to 17:00 America/New_York, the FX convention (handles DST). The trading week starts at the Sunday 17:00 NY open.
- `day_start_equity` is snapshotted at the boundary. If the bot starts mid-day, it is reconstructed as `balance − realized_net_since_boundary`. Floating P&L at the boundary is unknown after a restart, so the reconstruction is conservative and flagged in the log.
- When a breaker trips: the state becomes `ENTRIES_BLOCKED`, and a `SafetyEvent` is written with the exact rule, measured value and threshold. If `close_positions_on_trip[breaker]` is true (default **false** for all), positions are closed. Otherwise they are managed normally.
- States: `RUNNING` → `ENTRIES_BLOCKED` (breaker or pause) → `HALTED` (account changed, manual stop, fatal error). Only one state machine exists, and the dashboard displays it.

### 6.5 Filters
- **Session** (`session_manager.py`): sessions are defined in the **local time of their financial centre** (London in Europe/London, New York in America/New_York, Tokyo in Asia/Tokyo, Sydney in Australia/Sydney). DST is therefore handled by the tz database, with no hard-coded offsets. Evaluation always converts the UTC decision time into each zone.
- **Spread:** reject if `spread_points > min(symbol.max_spread_points, spread.max_multiple_of_typical × typical)`.
- **Cost vs RR:** `cost_R = (spread + 2 × commission_per_lot_in_price + expected_slippage) / stop_distance`. Reject if `cost_R > execution.max_cost_R` or if `RR_net = (target_distance − costs) / (stop_distance + costs) < strategy.min_rr`.
- **Volatility:** ATR percentile rank over a lookback must lie within `[min_pct, max_pct]` (exact definition in STEP 2).
- **News:** block entries from `before_minutes` before to `after_minutes` after any high-importance event whose currency is in the pair. Feed status `UNAVAILABLE` → `news.on_unavailable`: `block_entries` (default, fail-closed) or `ignore` (explicitly accepts the risk; logged every cycle). If the module is disabled in config, a startup warning says so.
- **Cooldown** (`cooldown.py`): one entry per `setup_id` (DB unique constraint); max N entries per symbol per session; M minutes after any close on that symbol; K minutes after a loss.

### 6.6 Risk manager and sizing

```
loss_per_lot   = Broker.loss_per_lot(symbol, direction, entry, sl)
                 # live: −order_calc_profit(same-direction action, symbol, 1.0, entry, sl) → exact, handles crosses
                 # sim : (|entry−sl| / tick_size) × tick_value_in_account_ccy(t)   (uses historical conversion rates)
cost_per_lot   = round-trip commission + spread cost at entry
risk_money     = min(balance, equity) × risk_pct   (conservative default; configurable to equity or balance)
raw_volume     = risk_money / (loss_per_lot + cost_per_lot)
volume         = floor(raw_volume / volume_step) × volume_step   ← ALWAYS rounds DOWN
reject if volume < volume_min      ← never bumped up to the minimum (that would exceed risk)
cap    at min(volume_max, risk.max_volume_per_trade)
verify actual_risk = volume × (loss_per_lot + cost_per_lot) ≤ risk_money × 1.001
verify margin: order_calc_margin(...) ≤ free_margin × risk.max_margin_usage
```

Portfolio checks: max open positions; max positions per symbol (default 1); **currency exposure**, where each position is decomposed into signed currency legs weighted by its *risk amount* (long EURUSD at 0.5 % risk → EUR +0.5 %, USD −0.5 %) and the absolute net per currency must stay ≤ `max_currency_risk_pct`; **correlated exposure**, where for a candidate *c*, `Σ risk_i` over open positions with `|ρ(c,i)| ≥ ρ_min` in the same effective direction (sign(ρ) × dir_i = dir_c) must stay ≤ `max_correlated_risk_pct`. ρ is the Pearson correlation of H1 log returns over `correlation.lookback_days`, recomputed daily from closed bars only.

Optional **risk reduction** after drawdown (e.g. halve risk_pct when drawdown > 4 %) is allowed because it only ever *reduces* risk. Risk increases after losses are impossible by construction.

### 6.7 Position management (`exits.py` + `position_manager.py`)
Each rule is a pure function `(position, snapshot, params) → ManagementAction | None`. The rules are individually toggled in config, and each variant is backtested separately (fixed SL/TP only, +BE, +ATR trail, +structure trail, +partials). One central invariant: **a new SL may only move toward profit** (`new_sl > old_sl` for longs). Actions also respect the broker `stops_level` and `freeze_level`, and a minimum interval between modifications per position to avoid `TOO_MANY_REQUESTS`. For partials, the R multiple of the full trade is computed from the **initial** risk across all fills.

---

## 7. Order lifecycle and idempotency

```
            ┌──────────── pre-checks fail ───────────► REJECTED_PRECHECK (logged, no send)
 OrderIntent│
   built ───┤ setup_id consumed (DB unique insert) ──► if duplicate: SKIPPED_DUPLICATE
            │
            ▼
      PRECHECK: connected · account verified · algo trading allowed · symbol visible & trade_mode full
                · market open (fresh tick) · spread ok · price re-read · stop ≥ stops_level
                · volume valid · margin via order_check() · positions-per-symbol · no existing
                  position with same signal comment
            ▼
      SEND  mt5.order_send(request with SL+TP, deviation, magic, comment=signal short id, type_filling
                           chosen from symbol filling_mode)
            │
   ┌────────┼─────────────────────┬──────────────────────────────┐
 DONE      RETRYABLE             NON-RETRYABLE                  None / TIMEOUT / CONNECTION
 (10009)  (REQUOTE 10004,        (INVALID_STOPS, NO_MONEY,       ► UNKNOWN
   │       PRICE_CHANGED 10020,   MARKET_CLOSED, TRADE_DISABLED,   │
   ▼       PRICE_OFF 10021)       INVALID_VOLUME, AUTOTRADING      ▼
 FILLED     │                     disabled, LIMIT_POSITIONS…)   VERIFY: search positions + deals
 verify SL  ▼                     → REJECTED (no retry;          (magic + comment + time window)
 attached  re-read price,          may raise ORDER_FAILURES)      found → FILLED (adopt)
           re-run ALL prechecks                                   absent & attempts < max &
           (incl. cost-vs-RR at                                   setup still valid → resend
           new price), attempt ≤                                  else → REJECTED_UNKNOWN,
           execution.max_retries                                  entries blocked for symbol
           (default 2), backoff
```

- The **signal ID** is `sha1(strategy_version | symbol | direction | structure_event_ids)`. A short form is placed in the MT5 comment (the comment is ≤ 31 chars, and some brokers overwrite comments, so the *magic number + ticket mapping* in the DB is the primary link and the comment is secondary).
- The **magic number** encodes strategy and version (e.g. `7310xx`). The bot only ever touches positions carrying its own magic numbers, so manual trades and other EAs are left alone.
- **Post-fill SL check:** if a filled position shows `sl == 0`, the bot immediately modifies it. If that fails, it closes the position. This covers brokers that ignore SL on market execution.
- Retry happens only when the failure is known to be transient and nothing was filled. We never retry in a tight loop.
- **Hedging vs netting:** the bot reads `account_info().margin_mode`. On netting accounts it enforces max 1 position per symbol and blocks partial-close features that would behave differently. Hedging accounts are recommended.

---

## 8. Time handling

- Internally **every timestamp is timezone-aware UTC**. Display converts to any zone (e.g. Australia/Sydney for you) at the edge.
- MT5 bar and tick times are **broker server wall-clock time** encoded as Unix seconds (not true UTC). Many brokers run "UTC+2 winter / UTC+3 summer", following **US** DST so the daily candle closes at 17:00 New York. Europe/Athens is *not* a correct substitute because EU and US DST dates differ by 2–3 weeks each year.
- Config `broker_time.rule` supports:
  - `ny_close` → server = America/New_York wall time + 7 h (the most common FX setup);
  - `iana:<Zone>` → server follows that IANA zone;
  - `fixed:<±hours>` → constant offset.
- **Startup verification:** during market hours, `observed = round_to_30min(last_tick_server_time − true_utc_now)` must equal the rule's offset at that instant. On a mismatch the bot refuses to trade and prints both values. Historical conversion applies the rule per timestamp, so DST is handled across 2020–2026.
- US DST changes happen at 02:00 NY on Sunday, while FX is closed, so the conversion never meets an ambiguous timestamp during trading.

---

## 9. Demo / live safety

Mode resolution happens once at startup and is **re-verified every cycle**:

| Configured | Requirements | Account observed | Result |
|---|---|---|---|
| `mode: demo` (default) | none | DEMO | runs |
| `mode: demo` | — | REAL | **refuses to start** (terminal is logged into a real account) |
| `mode: shadow` | none | any | full pipeline, **orders never sent** (logs "would trade") |
| `mode: live` | `live.enabled: true` in YAML **and** env `MT5BOT_LIVE_CONFIRM` equal to the account login number **and** `live.acknowledge_risk: "I UNDERSTAND REAL MONEY IS AT RISK"` | REAL | runs with a large red banner plus console warning; first 60 s in `ENTRIES_BLOCKED` countdown |
| `mode: live` | any requirement missing | — | refuses to start, lists the missing items |
| any | — | login/server changes mid-run | **HALTED** immediately |

Tying the env var to the account number means a leftover environment variable cannot enable live trading on a *different* account.

---

## 10. Failure matrix

| Failure | Detection | Response |
|---|---|---|
| Terminal disconnects | `terminal_info()` None or `connected == False`; IPC call returns None | Entries blocked; no management attempts; reconnect with exponential backoff (max 60 s); **full reconcile before anything else** on reconnect |
| IPC call returns None | check every call; `mt5.last_error()` logged | Treated as "unknown", never as "no positions" (an empty result is not proof of absence unless the call succeeded) |
| `order_send` timeout / None | ExecutionResult UNKNOWN | VERIFY by searching positions and deals; never blind resend (§7) |
| Stale data | tick or bar age thresholds | Symbol-level entry block; logged once per transition, not every cycle |
| Account unverifiable | `account_info()` None / fields invalid | Global entry block |
| Account or server changed | login ≠ startup login | HALTED; requires restart |
| Algo Trading switched off | `terminal_info().trade_allowed == False` | Entry block plus dashboard alert (management also impossible; broker SL/TP still active) |
| DB write fails | exception from Journal | Record to emergency JSONL; alert; entries continue only while the emergency log works |
| DB and emergency log both fail | both raise | Entries blocked; management continues; console alert |
| Exception in a symbol pipeline | caught at symbol boundary | Symbol quarantined; counts toward `EXCEPTION_RATE` |
| Exception in main loop | top-level handler | Logged; loop continues after a 5 s back-off; repeated → HALTED |
| Restart | always | Load config → connect → verify mode/account → **reconcile vs MT5** → recompute breakers from deal history → load consumed setup IDs → then start the loop |
| Position found without SL | reconciler / post-fill check | Set SL (from the stored plan, or an ATR-based emergency stop); if that fails, close |
| Orphan position (our magic, unknown locally) | reconciler | Adopt with an emergency management profile; log `ORPHAN_ADOPTED` |
| Phantom (local open, not in MT5) | reconciler | Look up closing deals → record ClosedTrade; if none are found, mark `LOST_SYNC` and alert; **never recreate** |
| Weekend / market closed | tick age plus trade_mode | No entries, no modifications (avoids `MARKET_CLOSED` spam) |
| PC clock drift | server-tick vs local UTC comparison | Warning above 5 s; entry block above 60 s |

---

## 11. Research architecture

### 11.1 Simulation model (`sim_broker.py`, `cost_model.py`)
- **Decision at bar t close, fill at bar t+1 open.** A long fills at `open_bid(t+1) + spread(t+1) + slippage`; a short fills at `open_bid(t+1) − slippage`.
- MT5 bars are bid bars: a long SL or TP triggers when the **bid** crosses; a short SL or TP triggers when **ask = bid + spread** crosses.
- **SL and TP in the same M1 bar → SL first.** A gap through the SL fills at the open (the worse price).
- **Spread model:** `max(bar.spread_field, symbol.backtest_min_spread_points)` + session/rollover widening. The MT5 bar `spread` field is often the *minimum* spread over the bar, so it is treated as a floor, not the truth.
- **Commission:** per lot per side (config). **Swap:** current `swap_long` / `swap_short` from the symbol spec, with the triple-swap weekday from the spec. Historical swap rates are unavailable, and this is a documented approximation.
- **Slippage:** fixed points plus an optional seeded random component. Stress runs use costs ×1.5 and ×2.
- **Conversion rates:** account-currency P&L for crosses (e.g. EURAUD in a USD account) uses historical AUDUSD bars at the fill time, so the data loader downloads conversion symbols automatically.
- **Management** runs on each simulated M1 close, exactly like live.

### 11.2 Data splits and the sealed vault (`splits.py`)
| Period | Dates | Use |
|---|---|---|
| Development | 2020-01-01 → 2023-12-31 | build, debug, walk-forward windows |
| Validation | 2024-01-01 → 2024-12-31 | confirm behaviour on unseen data; limited number of looks |
| **Sealed OOS** | 2025-01-01 → latest available (≈ 2026-09) | one final evaluation of a frozen config |

- The OOS period can only be run with `--final-oos` **and** a config hash that has been frozen (`experiments.freeze`). Every OOS access is written to `oos_access_log`. If more than one distinct config has ever touched OOS, every later report carries a **"OOS CONTAMINATED — N configs evaluated"** warning.
- Indicator warm-up uses bars before a period start (past data only, so there is no leakage). No *trades* are counted before the start.
- 2020 includes the COVID volatility regime. The reports break results down per year, so no single regime can hide inside the averages.

### 11.3 Experiment registry (`experiments.py`)
Every backtest run stores its config hash, git commit, data hash, period and headline metrics. The report shows **how many configurations were tried**, which is needed to judge the chance that the best result is luck. We'll use the Deflated Sharpe Ratio (Bailey & López de Prado) as a multiple-testing adjustment.

### 11.4 Walk-forward (`walk_forward.py`)
Rolling windows inside dev + validation only, e.g. train 18 months / test 6 months / step 6 months. Only a **small, pre-declared** parameter grid (≤ 3 parameters, ≤ 5 values each) is ever searched. The selection rule is **plateau-based**: choose the parameter set whose *neighbourhood median* expectancy is highest, not the single best cell. Outputs: stitched test-window equity, walk-forward efficiency (test expectancy ÷ train expectancy), and parameter drift across windows.

### 11.5 Monte Carlo (`monte_carlo.py`)
It resamples realised **R-multiples** (i.i.d. bootstrap, plus stationary block bootstrap to preserve streakiness) and **replays them through the real sizing rules and circuit breakers**, so drawdown and ruin estimates reflect how the system actually behaves. Outputs: max-drawdown distribution (P50/P95/P99), longest losing-streak distribution, fan chart of equity paths, and probability of hitting −X % (the ruin definition is configurable, default −20 %).

### 11.6 Overfitting checks (`robustness.py`)
Each check produces PASS / WARN / FAIL with numbers:
- **Trade count:** fewer than 300 trades in dev, or fewer than 30 in any bucket being reported on.
- **Parameter fragility:** ±1 grid step changes expectancy by more than 50 %, or flips its sign.
- **Symbol concentration:** the top symbol accounts for more than 60 % of net profit, or removing the best symbol leaves expectancy ≤ 0.
- **Time concentration:** the best month is more than 25 % of net profit, or removing the top 5 % of trades leaves expectancy ≤ 0.
- **Dev vs validation:** validation expectancy is less than 50 % of dev, or has the opposite sign.
- **Long vs short:** one side is profitable and the other loses heavily with n ≥ 30 each.
- **Cost stress:** expectancy at costs ×2 ≤ 0.
- **Execution realism:** the share of trades with MAE < 0.1 R is above 30 % (suspiciously perfect entries), plus a check that entry price ≠ signal-bar close.
- **Score validity:** expectancy is not monotonic across score buckets out of sample.

### 11.7 ML filter (stage 2, `models/`)
It is only built **after** the baseline shows an edge on validation. Features come from the same `MarketSnapshot` the strategy saw at decision time, so future data is unreachable by construction. The label is the trade's realised R (or R > 0). The model is trained with **purged, embargoed walk-forward** splits (embargo ≥ max holding time, because trade outcomes overlap in time), and never with random shuffling. It is judged only on whether it improves validation and then OOS expectancy and drawdown against the baseline at a *fixed* threshold chosen on training folds.

---

## 12. Storage schema (outline, full DDL in STEP 10)

`runs` · `heartbeat` · `decisions` (one per candidate) · `score_components` · `gate_results` · `orders` (intent + every attempt + retcode) · `trades` (open → closed lifecycle, MFE/MAE, exit reason, R) · `trade_events` (BE, trail, partial) · `equity_snapshots` · `safety_events` · `breaker_state` · `consumed_setups` (UNIQUE setup_id) · `control_commands` (id, command, nonce, created_at, expires_at, status) · `spread_stats` · `oos_access_log` · `experiments`.

MFE/MAE are tracked from M1 highs and lows (live and sim alike) while the position is open, measured in price units and in R.

---

## 13. Look-ahead and leakage guards (checked at every step)

1. Forming bar excluded (`start_pos=1`); snapshot asserts `last_close_time ≤ decision_time`.
2. HTF join by **close time**: an H1 bar covering 10:00–11:00 becomes visible at 11:00, never at 10:05.
3. Swings are usable only after confirmation (`confirmed_index ≤ t`).
4. Fill at next bar open, never at the signal bar's close.
5. Rolling statistics (ATR percentile, correlations, typical spread) use trailing windows only.
6. The news filter uses scheduled times only; actual values are never read.
7. ML features come from the decision-time snapshot; splits are purged and embargoed; nothing is shuffled.
8. A **truncation test**: run the analysis on data[:t] and on data[:t+100], and the outputs at t must be identical. It runs for every indicator and structure function.
9. The OOS vault plus the experiment registry.

---

## 14. Build plan and how each step will be tested

| Step | Deliverable | How you will test it |
|---|---|---|
| 1 | This document, contracts, config skeleton | `pytest tests/test_contracts.py` |
| 2 | Strategy spec with exact formulas (document + worked numeric examples) | review; each rule becomes a test case in STEP 4/5 |
| 3 | `config.py`, `timeutils.py`, `mt5_connection.py`, `market_data.py`, `data_loader.py` | unit tests (tz/DST); `python main.py diagnose` against your **demo** terminal prints account, symbols, server offset check, last closed bars; `download-data` builds parquet + a quality report |
| 4 | indicators + market structure | synthetic-series tests with known answers; truncation (look-ahead) tests; plot overlay for visual spot checks |
| 5 | strategy + signal engine | fixture scenarios per LONG/SHORT/invalidation rule; score breakdown snapshot tests |
| 6 | sizer, exposure, risk manager | exhaustive tests across JPY/non-JPY/cross pairs, rounding, min-lot rejection, currency caps |
| 7 | execution | SimBroker-driven tests for every retcode path incl. UNKNOWN; then `shadow` mode on demo |
| 8 | exits + position manager | per-rule tests; SL-monotonic property test |
| 9 | safety manager + reconciler | simulated disconnects, restarts, orphans/phantoms, breaker boundaries |
| 10 | SQLite journal + emergency log | DB-failure injection tests |
| 11 | backtester, metrics | known-outcome synthetic backtests; cost-model hand calculations |
| 12 | walk-forward, Monte Carlo, robustness report | run on dev + validation; **results reported to you as-is** |
| 13 | dashboard | run against a demo session |
| 14 | demo autonomous trading | ≥ several weeks of demo; live-vs-backtest slippage/fill comparison |
| 15 | live safeguards (+ optional guardian EA) | only if 12 and 14 justify it |

**Build order change (agreed after STEP 5).** The research path comes first, so the go/no-go answer arrives before
any live plumbing is built: STEP 6 → gates and circuit breakers (pure modules from STEPS 6 and 9) → STEP 11 → STEP 12.
STEPS 7–10 and 13–15 follow only if S1 passes. How the backtester relates to the design above:
- Every *decision* module is shared with live trading: `AnalysisEngine`, `S1Strategy`, `SignalEngine`,
  `Gatekeeper` (session, spread, volatility, news, cooldown, min score, circuit breakers), `RiskManager`,
  `position_sizer`, `exposure`. Only the loop and the fills are simulation-specific (`backtest/backtester.py`,
  `backtest/sim_broker.py`). The live orchestrator (STEP 14) will call the same modules in the same order.
- `SimBroker` implements the parts of `BrokerGateway` the research needs. The full port (orders, modify, close,
  deals) arrives with STEP 7, so management variants can be simulated through it.
- Baseline exits (M0: fixed SL/TP) are known at entry, so each exit is found with one vectorised scan over M1 bars.
- Broker facts for offline research (specs, swap terms, account currency, leverage) are saved by `download-data`
  to `data/history/symbol_specs.json`.
- The news filter cannot be backtested (no historical calendar): it is off in research runs, and the report says so.
- A `TOTAL_DD` breaker trip is recorded and then reset in research runs, so the rest of the period is still
  measured; live, it halts entries until a manual reset.

---

## 15. Honest risks to the project

- **Costs dominate at M1/M5.** On EURUSD a 0.8-pip spread plus ~0.7 pip of commission against a 6-pip stop is already ≈ 0.25 R per trade before slippage. Short-horizon FX structure strategies commonly show no edge after realistic costs, so I recommend M15 setups with M5 entries as the initial default, with M1 treated as an experiment.
- **Pattern-based ideas (BOS/CHoCH/liquidity sweeps) are widely discussed and loosely defined.** Once they are defined exactly, they may not carry an edge. The architecture is built to tell us that clearly and quickly.
- **Five FX pairs are highly correlated** (EURUSD/GBPUSD/AUDUSD, all USD-driven). The effective number of independent bets is much smaller than the trade count suggests, and the statistics will account for it (per-symbol and correlation-aware reporting).
- **Broker data quirks:** history depth, spread-field semantics and server time differ per broker. STEP 3 includes a diagnostic that checks your broker specifically.

---

## 16. Assumptions to confirm

1. Hedging demo account (recommended). Netting is supported with restrictions.
2. Account currency USD, or tell me yours: it affects conversion-rate downloads.
3. Your broker's server time follows the `ny_close` rule (UTC+2/+3). The STEP 3 diagnostic will verify it.
4. Commission model: the per-lot round-trip value for your account type.
5. Windows machine or VPS that stays on while demo trading.
