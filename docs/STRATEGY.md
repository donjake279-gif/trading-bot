# Strategy S1 — Structure Pullback Continuation (STEP 2)

Version: `S1 1.0.0` · Status: **hypothesis, untested**. Nothing here is known to be profitable.

## 0. The hypothesis in one paragraph

After a market makes a **structural break** in one direction (a close beyond the last confirmed
swing point), the *first* meaningful pullback is more likely to resume in the direction of the
break than to reverse, **provided** the pullback ends with a short-term change of character back in
the trend direction. We enter on that short-term change of character, with the stop beyond the
pullback extreme and a fixed-R target.

**What would falsify it** (decided now, before any test):

| Check (development period 2020–2023, costs included) | "No edge" if … |
|---|---|
| Expectancy per trade | ≤ +0.05 R, or its t-statistic < 2.0 |
| Validation period 2024 | expectancy ≤ 0 R |
| Cost stress (costs ×1.5) | expectancy ≤ 0 R |
| Trade count | < 300 trades in development (too few to judge) |

If S1 fails, I will report it as a failure. Then we change the hypothesis. We do **not** keep adjusting S1's
parameters until the backtest turns green.

---

## 1. Notation and conventions

- Bars are **bid** OHLC: `O_i, H_i, L_i, C_i`, tick volume `V_i`. Index `i` increases with time.
- `t` = index of the **last closed bar** at decision time. Nothing at index > t is ever read.
- Three timeframes with fixed roles: **H1 = context**, **M15 = structure**, **M5 = trigger**.
  A bar of timeframe X covering `[T, T+Δ)` becomes visible at `T+Δ`.
- `lin(x, lo, hi) = min(1, max(0, (x − lo) / (hi − lo)))`: a linear ramp from 0 to 1, used for
  every graded score so that no score is a vague judgement.
- `d ∈ {+1 (LONG), −1 (SHORT)}`. Every SHORT rule is the exact mirror of the LONG rule: highs ↔ lows,
  `>` ↔ `<`, `+` ↔ `−`.
- "pip" = 10 points on 5-digit quotes (3-digit for JPY pairs). Code works in **price units**, never in pips.

---

## 2. Market-analysis primitives (exact definitions)

### 2.1 ATR
`TR_i = max(H_i − L_i, |H_i − C_{i−1}|, |L_i − C_{i−1}|)`
Wilder: `ATR_n = mean(TR_1..TR_n)`, then `ATR_i = ATR_{i−1} + (TR_i − ATR_{i−1}) / n`. Default `n = 14`.
`ATR5`, `ATR15` and `ATR60` denote ATR(14) on M5, M15 and H1 at their last closed bar.

### 2.2 Fractal swing points (confirmation-aware)
With lookback `k`, bar `p` is a **fractal high** if
`H_p > H_j` for all `j ∈ [p−k, p−1]` **and** `H_p ≥ H_j` for all `j ∈ [p+1, p+k]`.
(The left side is strict and the right side non-strict, so equal highs resolve to the first one.) Fractal lows mirror this.

A fractal at `p` is only **known at bar `p + k`** (its *confirmation index*). Any rule evaluated at bar `t`
may only use fractals with `p + k ≤ t`. Defaults: `k_H1 = 3`, `k_M15 = 3`, `k_M5 = 2`.

### 2.3 Significant swings (noise filter)
Fractals are processed in order of confirmation into an **alternating** high/low sequence:
1. If the new fractal is the same type as the last accepted swing: it **replaces** the last swing if it is more
   extreme (a higher high or a lower low); otherwise it is ignored.
2. If it is the opposite type: it is accepted only if `|price − last_swing_price| ≥ λ · ATR_p`
   (default `λ = 1.0`, where ATR is the value at the fractal bar). Otherwise it is ignored.

Result: swings `S_1, S_2, …` alternate high/low, and each carries `(price, pivot_index, confirm_index)`.

### 2.4 Swing labels
Each swing high is labelled against the previous swing high, with tolerance `ε = 0.1 · ATR`:
**HH** if `price > prev + ε`, **LH** if `price < prev − ε`, and **EH** (equal high) otherwise. Lows are labelled HL / LL / EL the same way.
**Equal highs/lows** (EH/EL) mark resting **liquidity pools**. They are logged as descriptors.

### 2.5 Break of structure (BOS) and change of character (CHoCH)
The structure state on each timeframe is `BULL`, `BEAR` or `NONE` (at start-up).
Let `SH*` = the most recent confirmed significant swing high that has **not** been broken yet (`SL*` for lows).

At bar `t`:
- **Bullish break** if `C_t > SH*.price`. The break uses the **close**, not the wick. `SH*` is marked broken, so each
  level can only be broken once.
  - If the state was `BEAR` or `NONE`, this is a **CHoCH↑**. Otherwise it is a **BOS↑**.
  - After a bullish break the state becomes `BULL`.
- **Bearish break** mirrors this with `C_t < SL*.price`.

### 2.6 Impulse leg (M15)
When a bullish break (BOS↑ or CHoCH↑) happens on M15 at bar `b`:
- **A (origin)** = the most recent confirmed significant M15 swing low with `pivot_index < b`.
- **B (impulse extreme)** = `max(H_b … H_t)`. It extends while price keeps rising and is frozen once the pullback trigger fires.
- **Impulse size** `I = (B − A) / ATR15`.
- **Leg ID** = `(symbol, M15, A.pivot_time, b_time)`. It identifies the setup and prevents duplicate entries.

### 2.7 Pullback measures (evaluated on M5 bars after the time of B)
- **Pullback low** `PL = min L_j` over M5 bars `j` from the bar containing B's time up to `t`.
- **Retracement ratio** `r = (B − PL) / (B − A)`.

### 2.8 Liquidity sweep
At bar `i`, a LONG-side sweep of a confirmed, unbroken swing low `P` happens if `L_i < P` **and** `C_i > P`
**and** `P − L_i ≤ 1.0 · ATR_{i−1}` (ATR of the previous bar, so a very large sweep bar cannot widen its own limit). A deeper penetration counts as a breakdown, not a sweep.
A sweep is recorded with the timeframe of the swept level (M5 or M15).

### 2.9 Candle measures
- **Range** `R_i = H_i − L_i`. Body `B_i = |C_i − O_i|`.
- **Close location value** `CLV_i = (C_i − L_i) / R_i`, with `CLV = 0.5` when `R_i = 0`.
- **Displacement (bullish)**: `C_i > O_i` and `B_i ≥ 1.0 · ATR_{i−1}` and `B_i / R_i ≥ 0.6`.
- **Rejection (bullish)**: `(min(O_i, C_i) − L_i) ≥ 0.5 · R_i` and `CLV_i ≥ 0.66`.

### 2.10 Regime (logged with every decision; used in reports)
- `TREND_UP` if the M15 state is `BULL` and the last M15 break was ≤ 48 M15 bars ago. `TREND_DOWN` is the mirror.
- Otherwise `RANGE`.
- **Compression** flag if `(max H − min L over last 20 M15 bars) < 3 · ATR15`.

### 2.11 Other descriptors (logged, not traded on)
- **Momentum** `MOM = (C_t − C_{t−12}) / ATR_t` on M15.
- **Relative tick volume** `RTV = V_t / median(V_{t−20..t−1})`. FX tick volume is only a proxy for activity.
- **ATR percentile** `P_ATR` = the percentage of the last 500 closed M15 ATR values that are ≤ the current `ATR15`.
- **Previous day high/low (PDH/PDL)**: the high and low of the previous trading day, with days split at 17:00 New York. **Previous week high/low** is defined the same way.

### 2.12 Obstacles (support/resistance used by the strategy)
For a LONG, the **obstacle** `Ob` is the *nearest price above the entry* among:
- unbroken confirmed H1 significant swing highs;
- PDH;
- the previous week's high.

For a SHORT, `Ob` is the nearest price below the entry among the mirrored levels. If none exists, `Ob = ∞` (no obstacle).

### 2.13 Memory and warm-up (added in STEP 4)
- Resting levels (unbroken swing highs/lows) older than **500 bars** of their timeframe are forgotten, and at most 30 per side are kept.
- A level that any later bar **closes** through is no longer resting liquidity, even when it didn't produce a BOS/CHoCH event
  (events are only fired against the most recent unbroken level, §2.5).
- A timeframe is **ready** only after **1,100 bars** have been processed. I measured that a tracker started late (as in live
  trading, with a finite history window) then agrees *exactly* with one fed from the start of the data. No setup may use a
  timeframe that isn't ready.

---

## 3. Entry rules

### 3.1 LONG: every condition must be true at the close of M5 bar `t`

| # | Condition | Exact test |
|---|---|---|
| L1 | M15 bullish leg active | M15 state = `BULL`, and the current leg (A, B, leg ID) exists and has not been used |
| L2 | Leg is meaningful | `I = (B − A) / ATR15 ≥ 1.5` |
| L3 | HTF not opposed | H1 state ≠ `BEAR` (mode `veto_opposite`; configurable to `score_only`) |
| L4 | Real pullback happened | `r_min ≤ r < 1.0`, with `r_min = 0.382` |
| L5 | Leg not stale | the time from B to bar `t` is ≤ 48 M15 bars (12 h) |
| L6 | Trigger | an **M5 CHoCH↑** closes at bar `t` (M5 state was `BEAR`/`NONE` and `C_t > SH*_M5`), and the swing high it breaks was formed after B |
| L7 | Stop is sane | `0.5 · ATR15 ≤ D ≤ 2.5 · ATR15` (D defined in §5) **and** `D ≥` broker stops level + spread |
| L8 | Room to move | `Ob − E ≥ 1.0 · D`: no obstacle within 1 R |
| L9 | Costs acceptable | `cost_R ≤ 0.20` **and** `RR_net ≥ 1.5` (defined in §6) |
| L10 | Score | `score ≥ min_score` (default 60, §7) |
| L11 | Gates | session, spread, volatility (`20 ≤ P_ATR ≤ 95`), news, cooldown, safety and health gates pass (ARCHITECTURE §6.5) |

### 3.2 SHORT
This is the exact mirror of 3.1. The M15 state is `BEAR` with a bearish leg (A = the origin swing high, B = the lowest low since the break).
`r = (PH − B) / (A − B)`, and L3 requires H1 ≠ `BULL`. The trigger is an **M5 CHoCH↓**. L8 uses the nearest obstacle below the entry.

### 3.3 One trade per leg
The setup ID is `sha1("S1 1.0.0" | symbol | direction | A.pivot_time | break_time)`.
An M15 leg can therefore produce **at most one trade**, however many M5 CHoCHs follow.

---

## 4. Invalidation (the setup is dead and nothing is entered)

For a LONG leg, any of these invalidates it:
1. **The pullback erases the leg:** any M15 close `< A`, or `r ≥ 1.0` on any M5 bar.
2. **The leg resumes without us:** price closes above B (`C > B` on M15) before an M5 CHoCH↑. The leg is then extended; a new B forms, and the pullback has to restart from it.
3. **The leg becomes stale:** more than 48 M15 bars pass after B.
4. **The M15 state flips:** a bearish M15 break happens (M15 CHoCH↓).
5. **The trigger is used:** the leg has already produced an order attempt (filled or not).

SHORT legs mirror this. Every invalidation is journaled with its reason.

---

## 5. Stop loss

- **Entry reference** `E` = current **ask** for a LONG (current **bid** for a SHORT) when the order is sent.
  The backtest fills at the next M5 bar's open plus spread plus slippage.
- **LONG stop:** `SL = PL − 0.25 · ATR5`. It sits below the pullback low, which is the structural invalidation point.
- **SHORT stop:** `SL = PH + 0.25 · ATR5 + spread_typical`. Short stops trigger on the **ask**, so the spread is added.
- **Risk distance** `D = |E − SL|`. This is always measured from the executable price, so the spread paid at entry is
  already inside `D` for longs.
- The stop is **server-side from the moment of entry**, and it can only ever tighten.

## 6. Take profit and cost rules

- **Target:** `TP = E + d · RR · D`, with `RR = 2.0` by default (1.5 / 2.5 / 3.0 are the pre-declared test values).
- **Obstacle rule** L8: an obstacle within 1 R rejects the trade. An obstacle beyond 1 R does not move the TP, but it
  lowers the RR-quality score.
- **Costs in price units**:
  - `comm` = round-trip commission per lot ÷ (contract size × value per price unit).
  - `slip` = the expected slippage.
  - `spread` = the current spread.
- **Cost burden** `cost_R = (spread + comm + slip) / D`. Reject if it is above 0.20.
- **Net RR** `RR_net = (RR · D − comm − slip) / (D + comm + slip)`. Reject if it is below 1.5.
  (The spread is already inside D for longs, and for shorts it is inside the SL buffer and makes the TP harder to reach, so it is not deducted twice. It is still counted in `cost_R`.)

---

## 7. Signal score (100 points, every component measurable)

The score only ranks setups that have **already passed L1–L9**. The weights were fixed before any testing and will not be optimized.

| Component | Max | Formula (LONG; SHORT mirrored) |
|---|---|---|
| Market structure | 20 | `20 · lin(I, 1.5, 3.5)`: bigger impulses score higher |
| Trend alignment | 15 | H1 state `BULL` → 15 · `NONE` → 7 · `BEAR` → 0 (vetoed by L3 by default) |
| Liquidity event | 15 | the pullback swept a confirmed unbroken **M15** swing low → 15 · swept only an **M5** swing low → 10 · no sweep → 0 |
| Entry confirmation | 20 | `12 · lin(B_t / ATR5, 0.5, 1.5) + 8 · lin(CLV_t, 0.5, 0.9)` on the CHoCH bar |
| Volatility | 10 | 10 if `30 ≤ P_ATR ≤ 80`; `10 · lin(P_ATR, 20, 30)` below that band; `10 · (1 − lin(P_ATR, 80, 95))` above it |
| Risk/reward quality | 10 | `10 · lin((Ob − E) / D, 1.0, 3.0)`, or 10 if there is no obstacle |
| HTF confirmation | 10 | the last H1 bullish break was ≤ 24 H1 bars ago → 10 · ≤ 48 → 5 · otherwise 0 |

Every component is journaled with its points, the raw inputs and a text reason.
The score is a **hypothesis in its own right**. If, out of sample, trades scoring 80+ do not beat trades scoring
60–70, the score is doing nothing useful and the report will say so.

---

## 8. Worked example (EURUSD LONG, numbers recomputed in code)

Account: 10,000 USD; risk 0.5 %; commission 7 USD per lot round trip; spread 0.7 pip; ATR15 = 0.00120; ATR5 = 0.00060.

1. **M15 leg.** Confirmed swing low **A = 1.10000**. At 10:15 an M15 bar closes at 1.10340, above the unbroken swing
   high at 1.10300, so there is a bullish break. The high after that is **B = 1.10600**. `I = 0.006 / 0.0012 = 5.0` ✓ (L2).
2. **Pullback.** On M5, price falls to **PL = 1.10240**. `r = (1.10600 − 1.10240) / 0.00600 = 0.60` ✓ (L4).
   On the way down it traded below an M5 swing low at 1.10260 and closed back above it → **M5 sweep**.
3. **Trigger.** The M5 bar 12:40–12:45 is O 1.10318 / H 1.10380 / L 1.10315 / C 1.10372. It closes above the last M5 swing
   high at 1.10350 while M5 was `BEAR` → **M5 CHoCH↑** ✓ (L6). Decision time is 12:45.
4. **Entry and stop.** The ask is `E = 1.10380`. `SL = 1.10240 − 0.25 × 0.00060 = 1.10225`. `D = 0.00155` (15.5 pips).
   The allowed range is `[0.00060, 0.00300]` ✓ (L7).
5. **Target.** `TP = 1.10380 + 2 × 0.00155 = 1.10690`. The nearest obstacle is an H1 swing high at 1.10900, so
   `(Ob − E) / D = 3.35 ≥ 1` ✓ (L8).
6. **Costs.** comm = 0.00007, slip = 0.00002, spread = 0.00007. `cost_R = 0.103` ✓. `RR_net = 1.835` ✓ (L9).
7. **Score.** Structure 20 + trend 15 + liquidity 10 + entry 12.34 (body/ATR 0.90, CLV 0.877) + volatility 10
   (P_ATR = 55) + RR quality 10 + HTF 10 = **87.3** ≥ 60 ✓.
8. **Size.** The loss per lot at the stop is 0.00155 × 100,000 = 155 USD, plus 7 USD commission = 162 USD per lot.
   `50 / 162 = 0.3086` → rounded **down** to 0.30 lots. The actual risk is 48.60 USD (0.486 %).

### Rejection examples
- The same leg, but PL = 1.09950 → `r = 1.083 ≥ 1.0` → **invalidated** (the pullback erased the leg).
- The stop would be 0.00340 away (> 2.5 × ATR15 = 0.00300) → **rejected, L7** (stop too wide for an acceptable RR).
- An H1 swing high sits at 1.10450 → `(Ob − E) / D = 0.45 < 1` → **rejected, L8** (obstacle within 1 R).
- Spread widens to 3.0 pips on a 6-pip stop → `cost_R = 0.65` → **rejected, L9**.

---

## 9. Exits and management (baseline plus variants tested separately)

- **Baseline (M0):** fixed SL and fixed TP only. Every other variant is compared against this.
- M1: M0 + move SL to break-even (`E`, plus commission in price) when price reaches +1 R on an M1 close.
- M2: M0 + partial close of 50 % at +1.5 R.
- M3: M0 + ATR trail (`SL = max(SL, C − 2 · ATR5)`) once +1 R is reached.
- M4: M0 + structure trail (SL to just below each new confirmed M5 significant swing low) once +1 R is reached.
- Optional time exit: close at market after 96 M5 bars (8 h) if neither SL nor TP was hit. It is tested as its own variant.

No variant is assumed to help. Each has to beat M0 in development **and** validation.

---

## 10. Parameters

**Fixed (never tuned):** ATR n = 14; k = 3/3/2; λ = 1.0; ε = 0.1 ATR; sweep depth ≤ 1 ATR; I ≥ 1.5;
stale limit 48 bars; stop range 0.5–2.5 × ATR15; obstacle ≥ 1 R; cost_R ≤ 0.20; RR_net ≥ 1.5; score weights; min_score 60;
P_ATR band 20–95.

**The only tunable parameters, pre-declared (walk-forward grid ≤ 3 × 4 values):**

| Parameter | Default | Grid |
|---|---|---|
| `target_rr` | 2.0 | 1.5, 2.0, 2.5, 3.0 |
| `stop_buffer_atr5` | 0.25 | 0.10, 0.25, 0.50 |
| `pullback_r_min` | 0.382 | 0.382, 0.50, 0.618 |

That is 36 combinations. The winner is chosen by neighbourhood median, not by the single best result.

---

## 11. Look-ahead and leakage audit of this spec

| Risk | Where | Guard |
|---|---|---|
| Using unconfirmed swings | §2.2 | Only fractals with `p + k ≤ t` are used |
| Forming HTF bar | L1, L3 | An M15/H1 bar is visible only after it closes. At 12:45 the M15 bar 12:30–12:45 is closed, but the H1 bar 12:00–13:00 is not |
| Future extreme in B / PL | §2.6–2.7 | max/min over bars `≤ t` only |
| Entering at the signal close | §5 | Live: order after the close at the current ask. Backtest: next bar open + spread + slippage |
| ATR percentile | §2.11 | Trailing window that includes `t` only |
| Obstacles | §2.12 | Only swings confirmed ≤ t; PDH/PDL come from completed days |
| Same-bar SL/TP ambiguity | backtest | Stop is assumed hit first |

---

## 12. Honest expectations

- This family of rules (break → pullback → lower-timeframe confirmation) is popular, and popularity is not evidence.
  After costs, it may well show **no edge**. The 15.5-pip stop in the example is typical; on EURUSD, costs are about 10 % of R.
  On GBPUSD and EURAUD they are higher.
- The five pairs are strongly USD-correlated, so there are far fewer independent bets than trades. Results will be
  reported per symbol and per year.
- Trade frequency is unknown until STEP 11. If it is under about 75 trades per year across all symbols, the statistics will be weak,
  and I'll tell you so rather than stretch conclusions.
