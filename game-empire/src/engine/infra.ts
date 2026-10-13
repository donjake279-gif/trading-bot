// Server infrastructure for the player's online games. All online and
// massively multiplayer games share one fleet: rented cloud nodes (tier x
// nodes) plus the servers in data centers you own (datacenters.ts).
// Overload turns new players away, raises churn and hurts reviews. A cloud
// or building outage removes its share of capacity; if nothing is left
// running, every online game goes down. Rival studios keep the simpler
// per-game server model in market.ts.
import { SERVER_TIERS, RESEARCH } from './constants';
import { hasResearch } from './development';
import { perkRank } from './progression';
import { engineServerDiscount } from './studioEngine';
import {
  autoscaleOwned,
  dataCentersDaily,
  fleetPerformance,
  onlineFleetCapacity,
  ownedBandwidthRate,
  ownedCapacity,
  ownedMonthlyCost,
  regionCoverage,
  rentedCapacity,
} from './datacenters';
import { chance, pick, randInt } from './rng';
import type { ActionResult, Game, World } from './types';
import { gamesOf, playerCompany, pushPoint, spend, toast } from './util';

export function isOnline(g: Pick<Game, 'multiplayer'>): boolean {
  return g.multiplayer === 'online' || g.multiplayer === 'massive';
}

/** Total capacity you have (rented plus built), whether or not it is up right now. */
export function infraCapacity(w: World): number {
  return rentedCapacity(w) + ownedCapacity(w, false);
}

/** Is everything down? */
export function fleetDown(w: World): boolean {
  return w.player.infra.demand > 0 && onlineFleetCapacity(w) <= 0;
}

export function infraCostMult(w: World): number {
  let m = 1;
  if (hasResearch(w, 'netcode')) m *= 0.9;
  if (hasResearch(w, 'cloudInfra')) m *= 0.75;
  return m * (1 - 0.06 * perkRank(w, 'lean')) * (1 - engineServerDiscount(w));
}

/** Share of traffic on rented hosting (the rest runs on your own buildings). */
function rentedShare(w: World): number {
  const rented = w.day < w.player.infra.outageUntil ? 0 : rentedCapacity(w);
  const total = rented + ownedCapacity(w, true);
  return total > 0 ? rented / total : 1;
}

/** Monthly server bill at a given number of concurrent players. */
export function infraMonthlyCost(w: World, demand = w.player.infra.demand, tier = w.player.infra.tier, nodes = w.player.infra.nodes): number {
  const t = SERVER_TIERS[tier];
  const share = rentedShare(w);
  const bandwidth = demand * 30 * (share * t.bandwidth + (1 - share) * ownedBandwidthRate(w));
  return (nodes * t.nodeMaintenance + bandwidth + ownedMonthlyCost(w)) * infraCostMult(w);
}

/** Uptime over the last 90 days, 0..1. */
export function infraUptime(w: World): number {
  let down = 0;
  for (const inc of w.player.infra.incidents) {
    if (w.day - inc.day > 90) continue;
    down += inc.full === false ? inc.days * 0.25 : inc.days;
  }
  return Math.max(0, 1 - down / 90);
}

export interface InfraEffects {
  acquire: number;
  churn: number;
  score: number;
  overloaded: boolean;
  down: boolean;
}

/** How the fleet affects the player's online games today (based on yesterday's load). */
export function infraEffects(w: World): InfraEffects {
  const i = w.player.infra;
  const down = fleetDown(w);
  const over = down ? 0 : Math.max(0, i.load - 1);
  const perf = fleetPerformance(w);
  const regions = regionCoverage(w) - 1;
  return {
    acquire: down ? 0.25 : (1 / (1 + 1.6 * over)) * (1 + 0.03 * regions),
    churn: (down ? 1.5 : 1) * (1 + 0.6 * Math.min(2, over)) * (1 - 0.08 * perf),
    score: 4 * perf + 0.6 * regions - Math.min(15, 10 * over) - (down ? 3 : 0),
    overloaded: over > 0,
    down,
  };
}

function onlineGames(w: World): Game[] {
  return gamesOf(w, w.player.companyId).filter((g) => g.status === 'released' && isOnline(g));
}

const OUTAGE_CAUSES = ['a failed database migration', 'a DDoS attack', 'a power failure at the data center', 'an expired TLS certificate', 'a bad config push', 'a network routing fault'];

/** Daily: measure load, pay the bill, roll for outages, autoscale. Runs after the market. */
export function infraDaily(w: World): void {
  const p = playerCompany(w);
  if (!p || p.status !== 'active') return;
  const i = w.player.infra;
  const t = SERVER_TIERS[i.tier];
  const games = onlineGames(w);
  let demand = 0;
  for (const g of games) demand += g.ccu;
  i.demand = demand;
  const ownedCost = dataCentersDaily(w, games.length > 0);
  const cap = onlineFleetCapacity(w);
  i.load = cap > 0 ? demand / cap : demand > 0 ? 9 : 0;

  const share = rentedShare(w);
  const bandwidth = demand * (share * t.bandwidth + (1 - share) * ownedBandwidthRate(w));
  const cost = (i.nodes * t.nodeMaintenance / 30 + bandwidth + ownedCost) * infraCostMult(w);
  spend(p, 'servers', cost);
  if (demand > 0) {
    for (const g of games) {
      const share = (g.ccu / demand) * cost;
      g.dailyCost = share;
      g.costTotal += share;
      g.cost30 = g.cost30 * (29 / 30) + share;
    }
  }

  if (i.load > 1 && games.length > 0) {
    i.overloadDays += 1;
    if (i.overloadDays === 1 || i.overloadDays % 30 === 0) {
      toast(w, `Servers overloaded: ${Math.round(i.load * 100)}% of capacity`, 'bad', {
        category: 'server',
        link: { route: 'servers' },
        body: 'Players are stuck in queues and new players are being turned away. Add servers to your data centers, rent more nodes or upgrade your tier.',
      });
    }
  } else {
    i.overloadDays = 0;
  }

  if (w.day >= i.outageUntil && games.length > 0 && i.nodes > 0) {
    const risk = t.outage * (1 + 3 * Math.max(0, i.load - 0.9));
    if (chance(w, risk)) {
      const days = randInt(w, 1, 3);
      const cause = pick(w, OUTAGE_CAUSES);
      i.outageUntil = w.day + days;
      const full = ownedCapacity(w, true) <= 0;
      i.incidents.unshift({ day: w.day, days, cause, where: 'cloud', full });
      if (i.incidents.length > 20) i.incidents.length = 20;
      pushPoint(i.downtime, w.day, days, 60);
      toast(w, full ? `Server outage: ${days} day${days > 1 ? 's' : ''} of downtime` : `Cloud hosting down for ${days} day${days > 1 ? 's' : ''}`, 'bad', {
        category: 'server',
        link: { route: 'servers' },
        body: full ? `Caused by ${cause}. Better server tiers fail far less often, and your own data centers keep games up when the cloud fails.` : `Caused by ${cause}. Your own data centers are carrying the load.`,
      });
    }
  }
  // nothing left running: every online game goes dark
  if (games.length > 0 && onlineFleetCapacity(w) <= 0 && demand > 0) {
    for (const g of games) {
      if (g.meltdownUntil <= w.day) g.userScore = Math.max(1, g.userScore - 1.5);
      g.meltdownUntil = Math.max(g.meltdownUntil, w.day + 1);
    }
  }

  if (i.autoscale) autoscale(w);
  if (w.day % 2 === 0 && (games.length > 0 || i.demandHistory.length > 0)) {
    pushPoint(i.demandHistory, w.day, Math.round(demand), 240);
    pushPoint(i.capacityHistory, w.day, onlineFleetCapacity(w), 240);
  }
}

function autoscale(w: World): void {
  const p = playerCompany(w);
  const i = w.player.infra;
  const t = SERVER_TIERS[i.tier];
  if (i.load > 0.85) {
    i.lowLoadDays = 0;
    // your own buildings first: cheaper to run than rented nodes
    const target = i.demand / 0.75;
    const short = target - onlineFleetCapacity(w);
    if (short > 0 && autoscaleOwned(w, short) > 0) {
      i.load = i.demand / Math.max(1, onlineFleetCapacity(w));
      if (i.load <= 0.85) return;
    }
    const ownedRunning = ownedCapacity(w, true);
    const want = Math.max(i.nodes + 1, Math.ceil(Math.max(0, i.demand / 0.75 - ownedRunning) / t.nodeCapacity));
    const n = Math.min(t.maxNodes - i.nodes, want - i.nodes, Math.floor(Math.max(0, p.cash - 5000) / t.nodeCost));
    if (n > 0) {
      i.nodes += n;
      spend(p, 'servers', n * t.nodeCost);
      i.load = i.demand / Math.max(1, onlineFleetCapacity(w));
    }
    if (i.nodes >= t.maxNodes && i.load > 0.9) {
      // move up a tier when it is unlocked and comfortably affordable
      const next = i.tier + 1;
      if (next < SERVER_TIERS.length && !tierBlocker(w, next) && SERVER_TIERS[next].upgradeCost < p.cash * 0.3) {
        setServerTier(w, next);
        return;
      }
      const key = `tierMax${i.tier}`;
      if (!w.player.flags[key]) {
        w.player.flags[key] = w.day;
        const next = SERVER_TIERS[i.tier + 1];
        const why = next ? tierBlocker(w, i.tier + 1) : null;
        toast(w, `${t.name} is at its limit`, 'bad', {
          category: 'server',
          link: { route: 'servers' },
          body: next ? `Autoscaling cannot add more nodes. ${next.name}${why ? ` ${why.charAt(0).toLowerCase()}${why.slice(1)}` : ' is available: upgrade now.'}` : 'You are at the largest fleet possible.',
        });
      }
    }
  } else if (i.load < 0.3 && i.nodes > (ownedCapacity(w, true) > 0 ? 0 : 1)) {
    i.lowLoadDays += 1;
    if (i.lowLoadDays > 30) {
      i.nodes -= 1;
      p.cash += t.nodeCost * 0.3;
      i.lowLoadDays = 0;
    }
  } else {
    i.lowLoadDays = 0;
  }
}

// ------------------------------------------------------------ player actions

export function tierBlocker(w: World, tier: number): string | null {
  const def = SERVER_TIERS[tier];
  if (!def) return 'Unknown tier.';
  const p = playerCompany(w);
  if (p.reputation < def.minRep) return `Needs reputation ${def.minRep}.`;
  if (def.research && !hasResearch(w, def.research)) return `Needs ${RESEARCH[def.research].name} research.`;
  if (tier > w.player.infra.tier && p.cash < def.upgradeCost) return `Costs $${def.upgradeCost.toLocaleString()}.`;
  return null;
}

/** Move the fleet to another tier; capacity carries over as equivalent nodes. */
export function setServerTier(w: World, tier: number): ActionResult {
  const i = w.player.infra;
  if (tier === i.tier) return { ok: false, error: 'Already on that tier.' };
  const blocker = tierBlocker(w, tier);
  if (blocker) return { ok: false, error: blocker };
  const def = SERVER_TIERS[tier];
  const p = playerCompany(w);
  const capacity = rentedCapacity(w);
  if (tier > i.tier) spend(p, 'servers', def.upgradeCost);
  i.tier = tier;
  i.nodes = Math.min(def.maxNodes, Math.max(1, Math.ceil(capacity / def.nodeCapacity)));
  i.load = i.demand / Math.max(1, onlineFleetCapacity(w));
  toast(w, `Servers moved to ${def.name}`, 'good', { category: 'server', link: { route: 'servers' } });
  return { ok: true };
}

export function buyNodes(w: World, n: number): ActionResult {
  const i = w.player.infra;
  const def = SERVER_TIERS[i.tier];
  const p = playerCompany(w);
  const count = Math.min(n, def.maxNodes - i.nodes);
  if (count <= 0) return { ok: false, error: `${def.name} supports at most ${def.maxNodes} nodes. Upgrade your tier.` };
  if (p.cash < count * def.nodeCost) return { ok: false, error: 'Not enough cash.' };
  spend(p, 'servers', count * def.nodeCost);
  i.nodes += count;
  i.load = i.demand / Math.max(1, onlineFleetCapacity(w));
  return { ok: true };
}

export function sellNodes(w: World, n: number): ActionResult {
  const i = w.player.infra;
  const def = SERVER_TIERS[i.tier];
  const floor = ownedCapacity(w, false) > 0 ? 0 : 1;
  const count = Math.min(n, i.nodes - floor);
  if (count <= 0) return { ok: false, error: floor ? 'You need at least one node, or servers in a data center of your own.' : 'No rented nodes left.' };
  i.nodes -= count;
  playerCompany(w).cash += count * def.nodeCost * 0.3;
  i.load = i.demand / Math.max(1, onlineFleetCapacity(w));
  return { ok: true };
}

export function setAutoscale(w: World, on: boolean): ActionResult {
  w.player.infra.autoscale = on;
  return { ok: true };
}
