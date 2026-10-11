# Game Empire

A single-player browser tycoon: start as a solo developer with **$50,000** in a bedroom and try to build a
game-development empire inside a **living, simulated games industry**. Rival studios grow, merge, go public and
go bankrupt on their own. Millions of simulated players pick what to play every day. You can win big, or you can lose everything.

Built with React + TypeScript, Vite, Tailwind CSS, Zustand, Recharts and Lucide. No backend, no paid APIs.
Everything runs in the browser and saves to IndexedDB (with a localStorage fallback).

## Run it

```bash
cd game-empire
npm install
npm run dev        # http://localhost:5173
npm run build      # production build in dist/ (static, works from any folder)
npm test           # engine tests: determinism, saves, economy, long-run industry, scripted bot player
npm run sim        # long-run headless industry report (prints yearly stats)
npm run build:artifact  # hosted-page build: libraries load from jsDelivr, only app code ships
```

The hosted build (`scripts/build-artifact.mjs`) loads React 18, Recharts, Zustand and the Lucide icons
from pinned jsDelivr URLs through an import map, because the host only allows scripts from public CDNs.
In that build, file downloads are blocked, so saves move between browsers with **Copy save code** and
**Paste save code**.

Controls: **Space** pauses/resumes, **1–4** set the speed (1, 3, 8 or 25 in-game days per second).

## What you can do

- **Make games.** Choose title, genre (13), platforms (PC, Console, Mobile, Handheld, VR, Cloud), audience, engine,
  monetization (premium, premium+MTX, cosmetic F2P, loot-box F2P, subscription, ads), price, art style,
  multiplayer mode, scope (Tiny → Mega Blockbuster) and budget. Then assign a team and set the development focus.
  The wizard projects how well your team covers what the genre needs, and estimates time, cost and fit.
- **Develop.** Progress, bugs, polish, crunch (fast, but bad for morale and a scandal risk), marketing campaigns
  that build hype and wishlists, early release, cancellation.
- **Less clicking.** Idle developers join the project that needs them most (toggle in Team). Put every idle
  developer, or the whole studio, on a game with one click. Queue several updates to run back to back, or switch
  on **auto-update** and the studio keeps a live game patched and fresh by itself.
- **Run live games.** Watch live player counts, active players, sales, reviews and freshness. Ship hotfixes,
  balance patches, content updates, seasonal events, paid expansions, monetization changes and platform ports.
  You can also change prices, run sales, or shut servers down.
- **Build the company.** Hire from a rotating candidate pool, with skills, traits and salaries. Employees have
  morale and can quit. You can train them, give raises, or fire them. Move through seven office tiers and
  research 16 technologies, including your own licensable engine.
- **Finance.** Monthly P&L, taxes, bank loans priced on your credit, venture rounds (Seed → Growth) that dilute you,
  an IPO, share buybacks and secondary offerings. A board can fire you once you lose majority control.
- **Capital markets.** A simulated stock market with bull and bear regimes, crashes and quarterly earnings
  surprises. You can trade rivals' shares, acquire studios (they become AI-run subsidiaries you steer), and bid
  on bankrupt studios' IP at sealed-bid auctions.
- **Survive events.** Genre crazes and fatigue, recessions, market crashes, console launches, loot-box
  regulation, viral hits, scandals, poaching, publisher deals, patent trolls, buyout offers, hostile takeovers,
  and the annual Game Awards.

Your first three releases get newcomer buzz, which helps early sales. If cash goes negative you get 90 days to
recover, and an angel investor offers a lifeline (cash for equity, or an emergency loan) twice per run.

The run ends if you go **bankrupt** (90 days with negative cash), get **ousted** by your board, lose a
**hostile takeover**, or accept a buyout (**a successful exit**).

## The simulation

Everything lives in `src/engine/` and is plain TypeScript with no React. The UI only reads the world and calls
actions.

| Module | Responsibility |
|---|---|
| `types.ts`, `constants.ts` | The serializable data model and every design/tuning table |
| `rng.ts` | Seeded mulberry32 PRNG whose state lives in the world, so saves resume the same random stream |
| `world.ts` | Generates 15–30 rival studios across five tiers with back-catalogues, then simulates 18 months of history before you arrive |
| `tick.ts` | One in-game day: production → market → costs → AI decisions → stocks → events → monthly/quarterly closes |
| `development.ts` | Work estimates, per-employee output by role and focus, bugs, quality, review scores, release |
| `market.ts` | The player market (below) |
| `ai.ts` | Autonomous studio decisions (below) |
| `finance.ts` | Running costs, loans, valuation, monthly close and taxes, reputation drift |
| `stocks.ts` | Index, prices, earnings, IPOs, trading, splits, acquisitions, subsidiary cash sweeps |
| `events.ts` | Macro economy, random world events, player decisions, board, solvency, awards, auctions |
| `updates.ts`, `staff.ts`, `achievements.ts`, `actions.ts`, `save.ts` | Live ops, people and research, goals, the player action API, persistence |

**Player market.** Each genre has an audience drawn from platform user bases, genre interest, target audience
and a drifting trend. Every day a slice of that audience shops. Games win attention in proportion to
`appeal × visibility^1.3 × market presence`, against an outside option. Appeal comes from review scores,
genre/audience/art/mode fit, content freshness, viral and seasonal boosts. Visibility comes from launch
featuring, hype, word of mouth, reputation, franchise fans and network effects. Owners accumulate toward a
penetration cap. Active players churn, at rates set by genre, mode, quality, bugs and freshness, and lapsed
players drift back to well-kept games. Revenue follows the business model, after platform store cuts, engine
royalties and publisher shares. Online games pay for servers.

**AI studios.** Each studio has a strategy: Aggressive Growth, Quality First, Monetization Machine, Indie
Artisan, Conglomerate or Trend Chaser. Every week it decides based on its own runway, revenue and catalogue:
- Hiring and layoffs.
- Which project to start: scope it can staff and afford, genre weighted by trend, specialty, experience and
  saturation, or a sequel to a big IP.
- When to patch, run events or ship expansions.
- When to shut down unprofitable servers or discount old games.
- Whether to borrow, raise money, IPO, repay debt or buy a rival.

Outcomes are not scripted. Hits lift their genre's popularity, overextended studios collapse, and bankrupt
studios' IP goes to auction while their staff flood the job market.

**Determinism.** Given the same seed and the same player actions on the same days, the world evolves
identically. A saved game resumes on exactly the same timeline. Both properties are covered by tests.

## Tuning notes

`src/engine/__tests__/economy.test.ts` prints development cost versus first-year revenue for every scope.
`longrun.test.ts` prints six years of industry health. Current targets:
- A solo tiny game earns roughly $5–30k in its first year.
- Mediocre small or large games can lose money.
- Great large and AAA games return many times their cost.
- The industry sustains about 30 studios and roughly $10–35B a year, with a few bankruptcies and new entrants
  each year.
