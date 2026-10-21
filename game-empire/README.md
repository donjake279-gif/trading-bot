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

Controls: **Space** pauses/resumes, **1–4** set the speed (1, 3, 8 or 25 in-game days per second), **N** skips
ahead to the next thing that needs you (the ⏭ button does the same; press again to stop).

## What you can do

- **Make games.** Choose title, genre (13), platforms (PC, Console, Mobile, Handheld, VR, Cloud), audience, engine,
  monetization (premium, premium+MTX, cosmetic F2P, loot-box F2P, subscription, ads), price, art style,
  multiplayer mode, scope (Tiny → Mega Blockbuster) and budget. Then assign a team and set the development focus.
  The wizard projects how well your team covers what the genre needs, and estimates time, cost and fit.
- **Develop.** Progress, bugs, polish, crunch (fast, but bad for morale and a scandal risk), marketing campaigns
  that build hype and wishlists, early release, cancellation.
- **Launch day.** Pressing Release opens a reveal: five critics' reviews land one by one, then the score counts
  up, with a verdict, confetti for a great score, a new-studio-record badge, breakout and combo callouts, and
  your rival CEO's reaction. The game waits while you watch (or skip straight to the score). A week later a
  first-week report card shows players, earnings and where the game ranks in its genre; #1 gets a celebration.
- **Skip to the next event.** Fast-forward at full speed until something needs you: a decision in the inbox, a
  game ready to release, a big moment (confetti), a major headline, or 180 quiet days. It stops paused and tells
  you why. It runs in short slices, so the page stays smooth even on a huge late-game world.
- **Less clicking.** Idle developers join the project that needs them most (toggle in Team). Put every idle
  developer, or the whole studio, on a game with one click, and let live-ops leads plan your patches.
- **Run live games.** Watch live player counts, active players, sales, reviews and freshness. Change prices, run
  sales, or shut servers down.
- **Patches and live ops.** Every live game has its own Live Ops panel:
  - *A backlog of changes*: hotfixes, performance passes, balance patches, quality-of-life passes, content updates,
    seasonal events, cosmetic packs, paid expansions, monetization changes and platform ports. Add several at once
    (two balance patches and a content drop, say), reorder them, or remove them. Each one is paid for when work
    on it starts.
  - *Big bundled patches*: everything finished by patch day ships together as one patch with a version number
    (v1.4.2 for fixes, v1.5 for content, v2.0 for an expansion), patch notes and one player reception. Patches with
    several kinds of change go down better; repeating the same kind tires players.
  - *A release schedule you choose*: every Tuesday, every other Friday, monthly... (any weekday, every 1, 2, 3, 4,
    6 or 8 weeks), or "when ready" with a minimum bundle size. Shipping on schedule builds a streak: players trust
    you, churn less and receive patches better. Patch days with nothing ready slip, break the streak and cost
    goodwill. Critical bug fixes go out straight away as an off-schedule hotfix, and you can ship early at any time.
  - *Major updates*: every Nth patch (you pick N) is a named major update with extra hype, and your live-ops lead
    saves big content for it.
  - *A public test server* (a week of public testing, about a third of the new bugs, better reception) and
    *crunch before patch day* (35% faster for three days, at a cost in morale and bugs).
  - *A live team*: developers work through the backlog in parallel, each on what their role is good at
    (programmers on fixes and ports, artists on cosmetics and events, designers on balance and content, QA on
    fixes and testing). Off-role work is 40% slower, and QA testers on the team keep new bugs out of each patch.
    A dedicated team stays on the game between patches and tops itself up from idle developers. Everyone earns
    live-ops experience from each patch: up to level 10, +3% patch output and better reception per level.
  - *A live-ops lead* (on by default) plans the backlog: fixes when bugs pile up, enough small changes in the
    pipeline that every patch day has something to ship, content and events on a rhythm, expansions for major
    updates and ports for hits. It skips games that earn less than a change costs, and only fixes ship while the
    studio is short of money. With contractors switched on, they build the lead's changes in time for the next
    patch day (about a month for content) without pulling developers off new games.
  - *Studio-wide*: Studio → Live sets the schedule new games start with, can apply it to every live game at once,
    and shows a patch calendar of every live game (next patch day, backlog, team, streak).
  Content updates and expansions make a game permanently bigger: each size level brings 2% more new players and
  1% less churn, up to level 30.
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
- **Build your own engine.** Research it, name it, then grow it through a tech tree of 41 features across six
  modules (Rendering, Physics, Tools, Networking, Platforms, AI & Scripting): deferred lighting, path tracing,
  destruction, rollback netcode, crossplay, shards, procedural worlds, a visual scripting marketplace, learning
  NPCs and more. Each feature does something specific (a higher quality ceiling, faster builds, fewer bugs,
  cheaper servers, cheaper ports, cheaper patches, lower churn, a boost for certain genres or platforms).
  - *Engine team*: put people on the engine team from the Team screen; programmers count double. A bigger
    team researches faster and runs more features at once (up to 3), with a queue of up to 12.
  - *Architecture*: split 100 points between performance, usability and stability. Re-architecting a mature
    engine adds tech debt. Crunch speeds research up but piles on debt; a refactor pays it down.
  - *Genre focus*: tune the engine for up to three genres for extra quality and adoption.
  - *Source model*: closed, source-available or open source (more adoption and hype, smaller royalties).
  - *Ship versions*: features land in the next major version (1.0 to 5.0), with release notes, optional
    tech-demo launch and a version history.
  - *Licensing*: set the royalty and upfront fee, waive royalties until a game's first $1M, fund a support team
    to keep licensees happy, and sign two-year enterprise deals. Unhappy licensees leave; tech debt causes
    security holes. Rival studios choose your engine over Titan and Apex when it's good and fairly priced, and
    commercial engines improve every year. Your subsidiaries use it for free.
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
  in players and fans; trophies go in your cabinet and every year is kept in the archive.
- **More game-feel.** Confetti for big moments (level-ups, 90+ reviews, Platinum sales, legendary combos, new
  engine versions, awards), reviews from critics at eight outlets on every game, and an annual Global Game
  Jam where your team makes a 99-cent game in a weekend that can turn into a surprise hit.
- **Legacy (New Game+).** Every finished run banks legacy points in your browser (retire, sell or go bust).
  Spend them on head starts for the next studio: savings, a starting fanbase, a garage, perk points or engine blueprints.
- **Empire levels.** Your company's value sets your empire level: Indie Studio → Rising Studio ($100M) → Major
  Publisher ($1B) → Industry Giant ($10B) → Megacorp ($100B) → Trillion-Dollar Empire ($1T) → World Power ($10T)
  → Galactic Conglomerate ($100T) → Solar Dynasty ($1Q) → Cosmic Sovereign ($10Q). Every level makes the game harder: monthly empire upkeep (a share of revenue and of
  idle cash), antitrust investigations (settle, fight in court, or accept a consent decree), data breaches and union
  drives, critics who expect more, rival studios that make better games, and cheat makers, rival consoles and AI
  labs that improve faster. Each level has challenges; clearing them all pays perk points and XP and cuts upkeep by 10%.
- **Ventures (Empire screen).** Businesses beyond games, each harder and pricier with every generation:
  - *Anti-cheat*: protect your online games and license the system to rival studios for a share of their online
    revenue. Six cheat types (aimbots, wallhacks, speed hacks, bots, exploits, macros) each have their own skill
    level, and you build seven detection layers (signature scanning, behaviour analysis, machine learning, kernel
    driver, server authority, hardware bans, replay review), each good against different cheats.
    - *Ban policy*: instant bans or weekly/monthly ban waves (waves teach cheat makers less but let cheaters play
      longer), a detection sensitivity slider (catch more, ban more innocent players), suspensions, permanent or
      hardware bans, and an appeals team that undoes false-ban damage.
    - *Operations*: buy cheats undercover to learn their skill, sue cheat makers, run honeypots to feed the
      machine-learning layer, push signature updates (or automate them) and fund a bug bounty.
    - *Security team*: assign programmers and QA to build layers faster. Cheat makers adapt to whatever you catch
      most; fall behind and a cheating wave hits, players leave and licensees walk.
    - *Easy to read*: the screen walks through it in five numbers (players protected, share cheating, your catch
      rate, bans last week, payoff in player churn and licence income), says in plain words why a number is still
      zero (first layer still building, no online players yet, ban wave not out yet), and a "Do this next" panel
      suggests the best next layer, stale signatures, weak spots and free staff, each with a one-click button.
      Every layer card shows how much the next level would raise your catch rate. Your licensees' players count
      too, so bans and training data start even before you have an online game of your own.
  - *Consoles*: design handhelds, home consoles or powerhouses. Sell units, take your share of every console game's
    store fee, and launch the next generation (2.5× the R&D) before rival hardware leaves yours behind.
  - *AI lab*: train model generations (3× the compute each time, cheaper if you own data centers), hire researchers,
    sell AI to the world and AI dev tools to rival studios. Your own developers work up to 25% faster with it.
  - *Film studio*: turn your games into movies, from indie films to $1B franchise events. Hits revive the game and
    its franchise; sequels wear audiences out.
  - *Theme parks*: build parks around the world (each costs 1.6× the last) and add lands for your franchises.
- **The Dominion (late game).** From $1B up, a new screen opens one system at a time. Each one is tied into the
  rest of the game, and bigger companies face harder versions of all of them, not just bigger bills:
  - *Empire Wars* ($100B): six to ten AI megacorporations, each with a CEO and a personality (warlord, schemer,
    visionary, showman, diplomat, tycoon), grow, buy studios, form alliances, merge, collapse and go to war over
    seven markets (games, hardware, platforms, cloud, AI, media, space). They resent a dominant player and start
    wars against you; at the top levels whole coalitions do. In a war you set the intensity, which sets the daily
    cost, and play tactics (price wars, ad blitzes, exclusives, lobbying, talent raids, sabotage). Winning hurts
    their market and earns you +20% there for two years, and may let you absorb them. You can also sue for peace,
    join other corps' wars, form alliances, run joint ventures or buy out a smaller corp that likes you. Leading
    a market pays up to +12% there and draws antitrust heat.
  - *Executives* ($1B): six C-suite seats (COO, CFO, CTO, CMO, CSO, General Counsel) whose skill and loyalty
    power other systems. They have traits and ambitions, feud with each other, get poached, pitch pet projects,
    act on their own, sometimes plot a coup, and a star hired from a rival may still be working for them.
  - *Espionage* ($10B): rivals plant moles, leak your projects (spoiling keynote surprises), poach your people,
    hack your servers and steal tech. Buy security tiers and run audits, then go on the offence: steal roadmaps,
    plant moles, poach executives, sabotage launches, run smear campaigns or hack systems, with real odds of
    being exposed.
  - *Ecosystem* ($10B): build an operating system, subscription, marketplace, cloud platform and devices, five
    levels each. Users come from the same pool as rival platforms. Set the subscription price, store cut,
    open/closed policy and day-one releases, sign studio exclusives, and handle developer revolts and regulators.
  - *Keynotes* ($1B): book a venue (a livestream up to an orbital keynote), choose what to reveal and hold one
    thing back for "one more thing". The show plays live, revealing items one by one, then the score, stock
    move, hype, preorders and rival CEOs' reactions. Leaks, unfinished demos, rival keynotes the same week and
    re-showing old news all cost you.
  - *Universes* ($100B): persistent virtual worlds from Shard to Omniverse, with residents and a real economy:
    coin drops, trade tax, prices and inflation (or a central-bank autopilot), land sales and bubbles,
    moderation and toxicity, real-money trading, duplication exploits. Residents need your server capacity.
  - *Space* ($1T): spaceports, orbital factories and stations, lunar bases, helium-3 mines, lunar resorts, a Mars
    colony, asteroid mining and a Jovian outpost. Launches can fail and hazards knock assets offline; colonists
    become a market for your games. Rival corps race you to every first.
  - *Cities* ($1T): found company cities and fill their plots with nine district types. Campuses add desks,
    research parks speed research, data districts add server capacity, industry cuts hardware costs and
    energy cuts power bills. Balance tax, services, happiness and unrest, or riots break out.
  - *Megaprojects* ($10T): nine projects from a $2T planetary neural network to a $150T interstellar starship.
    Each takes years in three phases, and every phase ends in a hard call (overruns, protests, sabotage,
    breakthroughs). Finished projects change the rules for good; rival corps race you for them.
  - *Emergencies* ($100B): global outages, mega-breaches, whistleblowers, breakup orders, cash crunches, supply
    shocks, rogue AI, world crashes, orbital disasters, city riots and boycotts. Each has three stages, a
    pressure meter and three choices per stage: pay to fix it, gamble on the right executive, or cut corners and
    carry a scar for years. Contain it and you come out stronger; let pressure reach 100 and it's a disaster.
  The overview tracks market shares, a news feed of what the giants are doing, and every lasting effect on you.
  Routine work runs itself (security, the world autopilot, city managers); wars, crises, deals and big builds
  wait for you. Twenty-three new empire challenges cover levels 2 to 9.
- **Fans.** Your studio's following is a fan count, from 0 for a brand-new studio up to 10 billion. It grows a
  little every day when your recent games are well received, and big moments add or cost fans: awards, keynotes,
  scandals, crises, contracts and more. Fans unlock platforms, engines, buildings, server tiers and ventures; every
  requirement and every effect reads in fans, and the header shows your count and how it changed this month.
- **Run servers.** Every online and MMO game you ship runs on your server fleet: rented cloud nodes (32 tiers,
  Shared Hosting → Hyperscale Edge → Planetary Mesh (4B players) → Orbital Server Ring (20B) → Dyson Swarm Cloud
  (100B) → Matrioshka Brain (1 trillion) → Interstellar Relay Grid (10 trillion) → Galactic Core Cloud (100
  trillion), then twenty cosmic tiers, each ten times bigger than the last: Dark Matter Halo Net, Magellanic
  Bridge, Andromeda Link, Local Group Grid, Virgo Supercluster Cloud, Laniakea Backbone, Great Attractor Hub,
  Cosmic Web Fiber, Quasar Forge, Hypervoid Datacenters, Observable Universe Mesh, Hawking Radiation Farm,
  Wormhole Exchange, Vacuum Energy Engine, Quantum Foam Lattice, Parallel Universe Cluster, Time Loop Servers,
  Multiverse Mainframe, Big Bang Reactor and finally the Omniverse Core, with room for 10 decillion players. The
  cosmic tiers unlock with your empire level (6 to 9) and the last move costs $27 quadrillion) plus up to twelve
  **data centers you own**. Buy a
  building (Server Closet → Small Warehouse → Warehouse → Large Warehouse → Data Hall → Hyperscale Campus → Arctic
  Megaplex → Orbital Data Station → Lunar Data Vault → Dyson Ring Station → Planet-Brain Sphere, with 600,000 rack
  slots and 8 GW of power) in any of five regions, wait for construction,
  grow it into the next size, and upgrade six systems: floor space, power, cooling, network uplink, backup
  generators and security. Fill the racks with ten server models (Budget Server up to Photonic Cores,
  Neuromorphic Mainframes, Singularity Cores and 25-billion-player Planck Processors), each with its own capacity,
  slots, power draw and smoothness. Autoscaling never buys a machine more than twice the size of your whole player
  base. Owning costs more up front but much less per month than renting; hardware wears out and can be
  refreshed; covering more regions helps growth and reviews. Overloaded servers turn new players away, raise
  churn and hurt reviews. A cloud or building outage only removes its share of capacity; if nothing is left
  running, every online game goes down. Autoscaling fills your own buildings first, then rents cloud nodes.
- **Level up.** Studio XP comes from releases, updates, contracts, player milestones, awards and goals. Each level
  gives a perk point for 12 permanent perks (faster development, fewer bugs, cheaper servers, better deals...).
  Three rotating goals always give you something to chase, with cash, XP and perk-point rewards.
- **Grow the business.** Take work-for-hire contracts between your own games. Set company policies (benefits,
  working hours, QA, profit sharing, a marketing retainer). Park cash in bonds or an index fund. Publish smaller
  studios' games for a revenue share. License your hits to film, merchandise and esports. Book GameExpo booths,
  join the Summer and Holiday sales.
- **Rival bosses.** Your rival is the nearest studio worth at least 1.5× you, run by a CEO with a personality:
  the Showboat, the Copycat, the Shark, the Grump or the Good Sport. They react to your launches, taunt you when
  they pull ahead, cheer their own hits, and act in character: the Copycat clones your hits (same genre and
  topic, suspiciously similar title) and the Shark ships their nearly-done game, unpolished, on your launch
  day. The dashboard keeps the head-to-head record. Stay worth more than them for four weeks in a row (one
  launch spike isn't enough) for a burst of new fans and most of a level's XP, and a bigger rival steps up. If yours
  goes bust or gets bought, that counts as a win too.
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
| `finance.ts` | Running costs, loans, valuation, monthly close and taxes, fans (standing) drifting daily toward the reception of recent games |
| `stocks.ts` | Index, prices, earnings, IPOs, trading, splits, acquisitions, subsidiary cash sweeps |
| `events.ts` | Macro economy, random world events, player decisions, board, solvency, awards, auctions |
| `infra.ts`, `datacenters.ts` | The player's server fleet: rented cloud and owned buildings, capacity, load, costs, outages, wear, autoscaling |
| `progression.ts` | Studio XP and levels, perks, rotating goals |
| `hr.ts` | HR autopilot: weekly hiring, pay grades and raises, skill training, replacing people who quit |
| `empire.ts` | Empire levels: upkeep, antitrust and crises, critic expectations, rival pace, level challenges |
| `ventures.ts`, `anticheat.ts` | Consoles, AI lab, films and theme parks, and the rivals they race against; anti-cheat layers, cheat types, ban policy and operations |
| `dominion.ts`, `dominionCore.ts` | The late game: unlocks, markets and shares, scars, hooks into the rest of the sim; runs the systems below |
| `megacorps.ts`, `corpLines.ts` | AI megacorporations, alliances, wars, tactics, peace, annexation; their personas and lines |
| `executives.ts`, `espionage.ts` | The C-suite and its politics; security, threats and spy operations |
| `ecosystem.ts`, `keynotes.ts` | Platform ecosystems; keynote planning, the live show and rival keynotes |
| `universes.ts`, `space.ts`, `cities.ts` | Virtual worlds and their economies; the space economy; company cities |
| `megaprojects.ts`, `emergencies.ts` | Civilisation-scale projects; empire emergencies and corp crises |
| `patches.ts` | The patch pipeline: backlogs, live teams, release schedules, bundled patches and notes, the live-ops lead |
| `automation.ts` | Update value and contractor sizing, port picks, and auto-assigning idle developers |
| `contracts.ts`, `business.ts` | Work-for-hire, policies, investments, publishing, licensing, GameExpo, sales |
| `rivalry.ts`, `launch.ts`, `skip.ts` | Rival bosses (personas, quotes, clones, launch clashes, overtakes); first-week reports; skip to the next event |
| `calendar.ts`, `opportunities.ts` | Weekly and seasonal rhythms; inbox opportunities and dilemmas |
| `studioEngine.ts`, `engineTech.ts` | Your own engine: the 41-feature tech tree, engine team, architecture and tech debt, source model, versions, licensing deals, adoption by rivals, engine wars |
| `topics.ts`, `reviews.ts`, `memes.ts` | Topics and the combo book, generated player reviews, viral moments |
| `fun.ts`, `legacy.ts` | Facilities, certifications, remasters, conventions, your store, legends; New Game+ |
| `awards.ts`, `jam.ts` | The Game Awards season (nominations, campaigns, predictions, ceremony); the annual game jam |
| `updates.ts`, `staff.ts`, `achievements.ts`, `actions.ts`, `save.ts` | Live ops, people and research, achievements, the player action API, persistence |

**Player market.** Each genre has an audience drawn from platform user bases, genre interest, target audience
and a drifting trend. Every day a slice of that audience shops. Games win attention in proportion to
`appeal × visibility^1.3 × market presence`, against an outside option. Appeal comes from review scores,
genre/audience/art/mode fit, content freshness, viral and seasonal boosts. Visibility comes from launch
featuring, hype, word of mouth, studio fans, franchise fans and network effects. Owners accumulate toward a
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
one genre-crowding count per day, and valuations share one franchise-fans count per day. Old games that nothing is
happening to (rival games after 120 days; yours after a year with no recent update, sale or viral moment) are
simulated in weekly steps, and each game keeps daily history for four months, then weekly and monthly points, so
late-game worlds with thousands of games stay fast. The Dominion's systems run mostly weekly and monthly and cost
well under a millisecond a day, so 4× stays at about 60 frames a second in a $10T+ world.

## Tuning notes

`src/engine/__tests__/economy.test.ts` prints development cost versus first-year revenue for every scope.
`longrun.test.ts` prints six years of industry health. Current targets:
- A solo tiny game earns roughly $5–30k in its first year.
- Mediocre small or large games can lose money.
- Great large and AAA games return many times their cost.
- The industry sustains about 30 studios and roughly $10–35B a year, with a few bankruptcies and new entrants
  each year.
