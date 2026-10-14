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
- **Live-ops autopilot.** Every live game is auto-updated by default (Studio → Live). The autopilot picks the
  freshest kind of update, ports hits to the big platforms they're missing, and skips games that earn less than an
  update costs, and while the studio is short of money only patches ship. A contract live-ops crew joins each update so it ships on schedule (about a month for content, two
  for an expansion) without pulling developers off new games. Content updates and expansions make a game
  permanently bigger: its version climbs (v1.3, then v2.0 after an expansion) and each size level brings 2% more new
  players and 1% less churn, up to level 30.
- **Build the company.** Hire from a rotating candidate pool, with skills, traits and salaries. Employees have
  morale and can quit. You can train them, give raises, or fire them. Move through seven office tiers and
  research 16 technologies, including your own licensable engine.
- **HR autopilot.** On the Team screen, HR can run the people side for you:
  - *Auto hiring* checks every week and hires the best candidates the studio can afford into empty desks, favouring
    the roles the team is short on (programmers, artists and designers first for small teams). It replaces anyone who quits, can pay a
    headhunter when the pool runs dry, and grows the team up to the office size or a target you pick. It only hires
    when there is work (a game, update or contract) or the studio is making money, and always leaves months of costs
    in the bank.
  - *Auto skill upgrades* send the least skilled developers on training every month (each person once every three
    months) once the studio earns more than it spends (Generous HR starts sooner), so skills keep climbing. The team
    table marks fresh gains.
  - *Auto raises* keep pay in line with each person's pay grade (Junior → Principal) so nobody quits over pay.
  - *Auto jobs* put idle developers on the project that needs them most.

  A spending style (Careful, Balanced, Generous) sets pay, how much cash HR keeps, and how boldly it hires. When the
  studio is losing money and runway is short, HR tightens its belt: no paid training, and raises only for people
  about to quit. The card always says why HR is waiting (office full, waiting for cash, waiting for work).
- **Finance.** Monthly P&L, taxes, bank loans priced on your credit, venture rounds (Seed → Growth) that dilute you,
  an IPO, share buybacks and secondary offerings. A board can fire you once you lose majority control.
- **Capital markets.** A simulated stock market with bull and bear regimes, crashes and quarterly earnings
  surprises. You can trade rivals' shares, acquire studios (they become AI-run subsidiaries you steer), and bid
  on bankrupt studios' IP at sealed-bid auctions.
- **Build your own engine.** Research it, name it, then upgrade six modules (Rendering, Physics, Tools,
  Networking, Platforms, AI & Scripting) and ship major versions from 1.0 to 5.0, with an optional tech-demo
  launch. Your games get a higher quality ceiling and build faster. Open it for licensing, set the royalty and
  upfront fee, and rival studios choose it over Titan and Apex when it's good and fairly priced. Your
  subsidiaries use it for free, and if it takes off, Titan cuts its royalties to fight back.
- **Pick topics and discover combos.** Every game has a topic (Zombies, Space, Cats, Pirates...). Each genre and
  topic pairing has a hidden grade, and a few secret legendary combos (dinosaur racing, anyone?) go viral.
  The combo book in the Trophy Room fills in as you ship games and watch rivals' hits.
- **Studio life.** Build office facilities (espresso bar, arcade room, nap pods, mo-cap stage, render farm...),
  hire rare industry legends, host your own fan convention, remaster your old classics, and earn Silver to
  Legendary sales certifications for your Hall of Fame. Players leave funny reviews of every game, and the
  internet happens to your hits: speedrunners, meme NPCs, celebrity fans, modders and rival CEOs who talk too much.
- **Open your own store.** Late in the game, launch a PC game store, take a 30% cut of PC sales flowing
  through it, and run free-game giveaways to grow your share.
- **The Game Awards.** The industry's big night. Nominations land on November 18 across 14 categories (Game of
  the Year, Narrative, Art Direction, Score & Audio, Multiplayer, Ongoing Game, Indie, Debut, Mobile, Most
  Innovative, Family, Players' Voice, Studio of the Year, and the dreaded Golden Glitch for the buggiest hit).
  For four weeks you can run "For Your Consideration" campaigns for your nominees, predict Game of the Year,
  book a world-premiere slot for an upcoming game and maybe get invited to present. On December 12 the ceremony
  reveals each winner live ("and the award goes to…"), with confetti when it's you. Winners get a huge boost
  in players and reputation; trophies go in your cabinet and every year is kept in the archive.
- **More game-feel.** Confetti for big moments (level-ups, 90+ reviews, Platinum sales, legendary combos, new
  engine versions, awards), reviews from critics at eight outlets on every game, and an annual Global Game
  Jam where your team makes a 99-cent game in a weekend that can turn into a surprise hit.
- **Legacy (New Game+).** Every finished run banks legacy points in your browser (retire, sell or go bust).
  Spend them on head starts for the next studio: savings, reputation, a garage, perk points or engine blueprints.
- **Empire levels.** Your company's value sets your empire level: Indie Studio → Rising Studio ($100M) → Major
  Publisher ($1B) → Industry Giant ($10B) → Megacorp ($100B) → Trillion-Dollar Empire ($1T) → World Power ($10T)
  → Galactic Conglomerate ($100T). Every level makes the game harder: monthly empire upkeep (a share of revenue and of
  idle cash), antitrust investigations (settle, fight in court, or accept a consent decree), data breaches and union
  drives, critics who expect more, rival studios that make better games, and cheat makers, rival consoles and AI
  labs that improve faster. Each level has challenges; clearing them all pays perk points and XP and cuts upkeep by 10%.
- **Ventures (Empire screen).** Businesses beyond games, each harder and pricier with every generation:
  - *Anti-cheat*: ship versions that protect your online games and license them to rival studios for a share of
    their online revenue. Cheat makers keep improving; fall behind and a cheating wave hits and licensees leave.
    A kernel-level driver is stronger but risks privacy backlash.
  - *Consoles*: design handhelds, home consoles or powerhouses. Sell units, take your share of every console game's
    store fee, and launch the next generation (2.5× the R&D) before rival hardware leaves yours behind.
  - *AI lab*: train model generations (3× the compute each time, cheaper if you own data centers), hire researchers,
    sell AI to the world and AI dev tools to rival studios. Your own developers work up to 25% faster with it.
  - *Film studio*: turn your games into movies, from indie films to $1B franchise events. Hits revive the game and
    its franchise; sequels wear audiences out.
  - *Theme parks*: build parks around the world (each costs 1.6× the last) and add lands for your franchises.
- **Run servers.** Every online and MMO game you ship runs on your server fleet: rented cloud nodes (nine tiers,
  Shared Hosting → Hyperscale Edge → Planetary Mesh (4B players) → Orbital Server Ring (20B) → Dyson Swarm Cloud,
  which holds up to 100 billion players at $5B a node and $80M a month each) plus **data centers you own**. Buy a
  building (Server Closet → Small Warehouse → Warehouse → Large Warehouse → Data Hall → Hyperscale Campus → Arctic
  Megaplex → Orbital Data Station) in any of five regions, wait for construction,
  grow it into the next size, and upgrade six systems: floor space, power, cooling, network uplink, backup
  generators and security. Fill the racks with seven server models (Budget Server up to Quantum Racks and 30-million-player Photonic Cores), each with its own capacity, slots, power draw
  and smoothness. Owning costs more up front but much less per month than renting; hardware wears out and can be
  refreshed; covering more regions helps growth and reviews. Overloaded servers turn new players away, raise
  churn and hurt reviews. A cloud or building outage only removes its share of capacity; if nothing is left
  running, every online game goes down. Autoscaling fills your own buildings first, then rents cloud nodes.
- **Level up.** Studio XP comes from releases, updates, contracts, player milestones, awards and goals. Each level
  gives a perk point for 12 permanent perks (faster development, fewer bugs, cheaper servers, better deals...).
  Three rotating goals always give you something to chase, with cash, XP and perk-point rewards.
- **Grow the business.** Take work-for-hire contracts between your own games. Set company policies (benefits,
  working hours, QA, profit sharing, a marketing retainer). Park cash in bonds or an index fund. Publish smaller
  studios' games for a revenue share. License your hits to film, merchandise and esports. Book GameExpo booths,
  join the Summer and Holiday sales, and keep an eye on your rival studio.
- **Live with consequences.** Weekends and holidays move player counts. Great updates bring lapsed players back,
  flops trigger a month of backlash, shipping the same update over and over tires players, and popular games
  that go quiet for months feel abandoned. Hyped rival launches in your genre steal attention.
- **Handle opportunities and dilemmas.** Streamers asking for early builds, storefront deals, review bombs,
  security exploits, burnout, crowdfunding, distressed studios for sale, film rights, charity drives, plus
  genre crazes, recessions, crashes, console launches, regulation, viral hits, scandals, patent trolls, buyout
  offers, hostile takeovers and the annual Game Awards.
- **Notifications that never interrupt.** Small toasts slide in at the top right and fade after a few seconds
  (click one to jump to what it's about). The bell keeps a filterable history; the inbox holds decisions with
  their options inline. The game never pauses for them. Every offer shows what happens if you let it lapse,
  and the default is always the safe choice.

Your first three releases get newcomer buzz, which helps early sales. If cash goes negative you get 90 days to
recover, and an angel investor offers a lifeline (cash for equity, or an emergency loan) twice per run. If you
don't answer, the emergency loan is taken for you.

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
| `infra.ts`, `datacenters.ts` | The player's server fleet: rented cloud and owned buildings, capacity, load, costs, outages, wear, autoscaling |
| `progression.ts` | Studio XP and levels, perks, rotating goals |
| `hr.ts` | HR autopilot: weekly hiring, pay grades and raises, skill training, replacing people who quit |
| `empire.ts` | Empire levels: upkeep, antitrust and crises, critic expectations, rival pace, level challenges |
| `ventures.ts` | Anti-cheat, consoles, AI lab, films and theme parks, and the rivals they race against |
| `automation.ts` | Live-ops autopilot (update picks, ports, contract crews) and auto-assigning idle developers |
| `contracts.ts`, `business.ts` | Work-for-hire, policies, investments, publishing, licensing, GameExpo, sales, rival |
| `calendar.ts`, `opportunities.ts` | Weekly and seasonal rhythms; inbox opportunities and dilemmas |
| `studioEngine.ts` | Your own engine: modules, versions, licensing, adoption by rivals, engine wars |
| `topics.ts`, `reviews.ts`, `memes.ts` | Topics and the combo book, generated player reviews, viral moments |
| `fun.ts`, `legacy.ts` | Facilities, certifications, remasters, conventions, your store, legends; New Game+ |
| `awards.ts`, `jam.ts` | The Game Awards season (nominations, campaigns, predictions, ceremony); the annual game jam |
| `updates.ts`, `staff.ts`, `achievements.ts`, `actions.ts`, `save.ts` | Live ops, people and research, achievements, the player action API, persistence |

**Player market.** Each genre has an audience drawn from platform user bases, genre interest, target audience
and a drifting trend. Every day a slice of that audience shops. Games win attention in proportion to
`appeal × visibility^1.3 × market presence`, against an outside option. Appeal comes from review scores,
genre/audience/art/mode fit, content freshness, viral and seasonal boosts. Visibility comes from launch
featuring, hype, word of mouth, reputation, franchise fans and network effects. Owners accumulate toward a
penetration cap. Active players churn, at rates set by genre, mode, quality, bugs and freshness, and lapsed
players drift back to well-kept games. Revenue follows the business model, after platform store cuts, engine
royalties and publisher shares. Rival online games pay per-game server costs; the player's online games share
one fleet whose load feeds back into acquisition, churn and user scores.

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

## Performance

The simulation runs in small slices (a day or two every 50 ms) so no single tick blocks the page. At 3× and 4×
the screen redraws five times a second, and charts redraw about once a second (staggered, and straight away when
paused or when what they show changes). Autosave waits for both 30 game days and 45 real seconds, and pausing saves
just after the paused screen has drawn. In the engine, the day loop works from cached game lists, AI studios share
one genre-crowding count per day, and valuations share one franchise-fans count per day.

## Tuning notes

`src/engine/__tests__/economy.test.ts` prints development cost versus first-year revenue for every scope.
`longrun.test.ts` prints six years of industry health. Current targets:
- A solo tiny game earns roughly $5–30k in its first year.
- Mediocre small or large games can lose money.
- Great large and AAA games return many times their cost.
- The industry sustains about 30 studios and roughly $10–35B a year, with a few bankruptcies and new entrants
  each year.
