// Server infrastructure for the player's online games. All online and
// massively multiplayer games share one fleet: tier x nodes = capacity.
// Overload turns new players away, raises churn and hurts reviews; outages
// take every online game down at once. Rival studios keep the simpler
// per-game server model in market.ts.
import { SERVER_TIERS, RESEARCH } from './constants';
import { hasResearch } from './development';
import { perkRank } from './progression';
import { engineServerDiscount } from './studioEngine';
import { chance, pick, randInt } from './rng';
import type { ActionResult, Game, World } from './types';
import { gamesOf, playerCompany, pushPoint, spend, toast } from './util';

export function isOnline(g: Pick<Game, 'multiplayer'>): boolean {
  return g.multiplayer === 'online' || g.multiplayer === 'massive';
}

export function infraCapacity(w: World): number {
  const i = w.player.infra;
  return i.nodes * SERVER_TIERS[i.tier].nodeCapacity;
}

export function infraCostMult(w: World): number {
  let m = 1;
  if (hasResearch(w, 'netcode')) m *= 0.9;
  if (hasResearch(w, 'cloudInfra')) m *= 0.75;
  return m * (1 - 0.06 * perkRank(w, 'lean')) * (1 - engineServerDiscount(w));
}

/** Monthly server bill at a given number of concurrent players. */
export function infraMonthlyCost(w: World, demand = w.player.infra.demand, tier = w.player.infra.tier, nodes = w.player.infra.nodes): number {
  const t = SERVER_TIERS[tier];
  return (nodes * t.nodeMaintenance + demand * t.bandwidth * 30) * infraCostMult(w);
}

/** Uptime over the last 90 days, 0..1. */
export function infraUptime(w: World): number {
  let down = 0;
  for (const inc of w.player.infra.incidents) {
    if (w.day - inc.day > 90) continue;
    down += inc.days;
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
  const t = SERVER_TIERS[i.tier];
  const down = w.day < i.outageUntil;
  const over = Math.max(0, i.load - 1);
  return {
    acquire: down ? 0.25 : 1 / (1 + 1.6 * over),
    churn: (down ? 1.5 : 1) * (1 + 0.6 * Math.min(2, over)) * (1 - 0.08 * t.performance),
    score: 4 * t.performance - Math.min(15, 10 * over) - (down ? 3 : 0),
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
  const cap = infraCapacity(w);
  i.demand = demand;
  i.load = cap > 0 ? demand / cap : demand > 0 ? 9 : 0;

  const cost = (i.nodes * t.nodeMaintenance / 30 + demand * t.bandwidth) * infraCostMult(w);
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
        body: 'Players are stuck in queues and new players are being turned away. Add nodes or upgrade your tier.',
      });
    }
  } else {
    i.overloadDays = 0;
  }

  if (w.day >= i.outageUntil && games.length > 0) {
    const risk = t.outage * (1 + 3 * Math.max(0, i.load - 0.9));
    if (chance(w, risk)) {
      const days = randInt(w, 1, 3);
      const cause = pick(w, OUTAGE_CAUSES);
      i.outageUntil = w.day + days;
      i.incidents.unshift({ day: w.day, days, cause });
      if (i.incidents.length > 20) i.incidents.length = 20;
      pushPoint(i.downtime, w.day, days, 60);
      for (const g of games) {
        g.meltdownUntil = Math.max(g.meltdownUntil, w.day + days);
        g.userScore = Math.max(1, g.userScore - 1.5);
      }
      toast(w, `Server outage: ${days} day${days > 1 ? 's' : ''} of downtime`, 'bad', {
        category: 'server',
        link: { route: 'servers' },
        body: `Caused by ${cause}. Better server tiers fail far less often.`,
      });
    }
  }

  if (i.autoscale) autoscale(w);
  if (w.day % 2 === 0 && (games.length > 0 || i.demandHistory.length > 0)) {
    pushPoint(i.demandHistory, w.day, Math.round(demand), 240);
    pushPoint(i.capacityHistory, w.day, infraCapacity(w), 240);
  }
}

function autoscale(w: World): void {
  const p = playerCompany(w);
  const i = w.player.infra;
  const t = SERVER_TIERS[i.tier];
  if (i.load > 0.85) {
    i.lowLoadDays = 0;
    const want = Math.max(i.nodes + 1, Math.ceil(i.demand / (t.nodeCapacity * 0.75)));
    const n = Math.min(t.maxNodes - i.nodes, want - i.nodes, Math.floor(Math.max(0, p.cash - 5000) / t.nodeCost));
    if (n > 0) {
      i.nodes += n;
      spend(p, 'servers', n * t.nodeCost);
      i.load = i.demand / infraCapacity(w);
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
  } else if (i.load < 0.3 && i.nodes > 1) {
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
  const capacity = infraCapacity(w);
  if (tier > i.tier) spend(p, 'servers', def.upgradeCost);
  i.tier = tier;
  i.nodes = Math.min(def.maxNodes, Math.max(1, Math.ceil(capacity / def.nodeCapacity)));
  i.load = i.demand / infraCapacity(w);
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
  i.load = i.demand / infraCapacity(w);
  return { ok: true };
}

export function sellNodes(w: World, n: number): ActionResult {
  const i = w.player.infra;
  const def = SERVER_TIERS[i.tier];
  const count = Math.min(n, i.nodes - 1);
  if (count <= 0) return { ok: false, error: 'You need at least one node.' };
  i.nodes -= count;
  playerCompany(w).cash += count * def.nodeCost * 0.3;
  i.load = i.demand / infraCapacity(w);
  return { ok: true };
}

export function setAutoscale(w: World, on: boolean): ActionResult {
  w.player.infra.autoscale = on;
  return { ok: true };
}
