// Studio progression: XP and levels, the perk tree, and rotating goals.
import { MAX_LEVEL, PERKS, SERVER_TIERS, xpForLevel } from './constants';
import { shuffle } from './rng';
import { ownedCapacity } from './datacenters';
import { tierBlocker } from './infra';
import type { ActionResult, Objective, ObjectiveKind, PerkId, World } from './types';
import { celebrate, clamp, fansFromRep, fansOf, fmtFans, gamesOf, ledgerRevenue, newId, playerCompany, toast } from './util';

export function perkRank(w: World, id: PerkId): number {
  return w.player.progression?.perks[id] ?? 0;
}

/** Award studio XP; level-ups grant a perk point each. */
export function addXp(w: World, amount: number): void {
  const pr = w.player.progression;
  if (!pr || !(amount > 0) || !playerCompany(w)) return;
  pr.xp += amount;
  while (pr.level < MAX_LEVEL && pr.xp >= xpForLevel(pr.level)) {
    pr.xp -= xpForLevel(pr.level);
    pr.level += 1;
    pr.perkPoints += 1;
    toast(w, `Studio level ${pr.level}! +1 perk point`, 'good', { category: 'goal', link: { route: 'goals' }, body: 'Spend it on a perk in Goals & Perks.' });
    celebrate(w, `Level ${pr.level}`);
  }
  if (pr.level >= MAX_LEVEL) pr.xp = Math.min(pr.xp, xpForLevel(MAX_LEVEL));
}

export function spendPerk(w: World, id: PerkId): ActionResult {
  const pr = w.player.progression;
  const def = PERKS[id];
  const rank = pr.perks[id] ?? 0;
  if (pr.perkPoints <= 0) return { ok: false, error: 'No perk points left. Level up your studio to earn more.' };
  if (rank >= def.maxRank) return { ok: false, error: 'Already at max rank.' };
  if (pr.level < def.minLevel + rank * 2) return { ok: false, error: `Needs studio level ${def.minLevel + rank * 2}.` };
  pr.perks[id] = rank + 1;
  pr.perkPoints -= 1;
  return { ok: true };
}

// ------------------------------------------------------------ goals

function nice(n: number): number {
  if (n < 100) return Math.ceil(n);
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return Math.ceil(n / mag) * mag;
}

const fmt = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `$${Math.round(n / 1e3)}K` : `$${Math.round(n)}`);
const cnt = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${Math.round(n)}`);

function updatesShipped(w: World): number {
  let n = 0;
  for (const g of gamesOf(w, w.player.companyId)) n += g.updates.length;
  return n;
}

function lastMonthRevenue(w: World): number {
  const c = playerCompany(w);
  const last = c.monthly[c.monthly.length - 1];
  return Math.max(last?.revenue ?? 0, ledgerRevenue(c.ledger));
}

/** Current value of the measured quantity for an objective kind. */
export function objectiveProgress(w: World, o: Objective): number {
  const c = playerCompany(w);
  const mine = gamesOf(w, c.id);
  switch (o.kind) {
    case 'ccu':
      return Math.max(0, ...mine.filter((g) => g.status === 'released').map((g) => g.ccu));
    case 'critic':
      return Math.max(0, ...mine.filter((g) => g.releaseDay !== null && g.releaseDay >= o.createdDay).map((g) => g.criticScore));
    case 'monthRevenue':
      return lastMonthRevenue(w);
    case 'employees':
      return w.player.employees.length;
    case 'updates':
      return updatesShipped(w) - o.baseline;
    case 'reputation':
      return fansOf(c);
    case 'valuation':
      return c.isPublic ? c.price * c.shares : c.valuation;
    case 'liveGames':
      return mine.filter((g) => g.status === 'released' && g.active >= 100).length;
    case 'owners':
      return Math.max(0, ...mine.map((g) => g.owners));
    case 'cash':
      return c.cash;
    case 'contracts':
      return w.player.contractsCompleted - o.baseline;
    case 'serverTier':
      return w.player.infra.tier;
    case 'dataCenter':
      return ownedCapacity(w, false);
    case 'releases':
      return w.player.stats.gamesReleased - o.baseline;
  }
}

function makeObjective(w: World, kind: ObjectiveKind): Objective | null {
  const c = playerCompany(w);
  const s = w.player.stats;
  const mine = gamesOf(w, c.id);
  const live = mine.filter((g) => g.status === 'released');
  let target = 0;
  let baseline = 0;
  let title = '';
  switch (kind) {
    case 'ccu':
      if (live.length === 0) return null;
      target = nice(Math.max(300, s.peakCcu * 2));
      title = `Reach ${cnt(target)} players online in one game`;
      break;
    case 'critic':
      target = clamp(Math.round(Math.max(65, s.bestCritic + 4)), 65, 95);
      title = `Release a game that scores ${target} or more`;
      break;
    case 'monthRevenue':
      target = nice(Math.max(15000, lastMonthRevenue(w) * 1.7));
      title = `Earn ${fmt(target)} in a single month`;
      break;
    case 'employees':
      target = w.player.employees.length + Math.max(2, Math.round(w.player.employees.length * 0.4));
      title = `Grow your team to ${target} people`;
      break;
    case 'updates':
      if (live.length === 0) return null;
      baseline = updatesShipped(w);
      target = 3;
      title = 'Ship 3 updates for your live games';
      break;
    case 'reputation':
      if (c.reputation > 92) return null;
      target = Math.min(fansFromRep(100), nice(fansFromRep(Math.min(100, Math.ceil((c.reputation + 8) / 5) * 5))));
      title = `Reach ${fmtFans(target)} fans`;
      break;
    case 'valuation':
      target = nice(Math.max(250000, (c.isPublic ? c.price * c.shares : c.valuation) * 2.2));
      title = `Grow the company's value to ${fmt(target)}`;
      break;
    case 'liveGames': {
      const n = live.filter((g) => g.active >= 100).length;
      if (n >= 8) return null;
      target = Math.max(2, n + 1);
    }
      title = `Have ${target} games with 100+ active players at once`;
      break;
    case 'owners':
      if (live.length === 0) return null;
      target = nice(Math.max(10000, Math.max(...mine.map((g) => g.owners)) * 2));
      title = `Get ${cnt(target)} players into one game`;
      break;
    case 'cash':
      target = nice(Math.max(100000, c.cash * 2));
      title = `Build a cash pile of ${fmt(target)}`;
      break;
    case 'contracts':
      if (w.player.employees.length > 40) return null;
      baseline = w.player.contractsCompleted;
      target = 2;
      title = 'Complete 2 contracts for clients';
      break;
    case 'serverTier':
      if (w.player.infra.tier >= SERVER_TIERS.length - 1 || !live.some((g) => g.multiplayer === 'online' || g.multiplayer === 'massive')) return null;
      target = w.player.infra.tier + 1;
      if (tierBlocker(w, target)?.startsWith('Needs empire')) return null;
      title = `Upgrade your servers to ${SERVER_TIERS[target].name}`;
      break;
    case 'dataCenter': {
      if (!live.some((g) => g.multiplayer === 'online' || g.multiplayer === 'massive')) return null;
      const owned = ownedCapacity(w, false);
      target = nice(Math.max(2000, owned * 2, w.player.infra.demand * 0.5));
      title = owned > 0 ? `Own servers for ${cnt(target)} players in your data centers` : `Host ${cnt(target)} players on servers you own`;
      break;
    }
    case 'releases':
      baseline = s.gamesReleased;
      target = 2;
      title = 'Release 2 more games';
      break;
  }
  const level = w.player.progression.level;
  const scale = Math.max(1, Math.sqrt(Math.max(0, lastMonthRevenue(w)) / 20000));
  const o: Objective = {
    id: newId(w, 'o'),
    kind,
    title,
    target,
    baseline,
    rewardCash: nice(clamp(6000 * scale, 6000, 20e6)),
    rewardXp: 100 + level * 25,
    rewardRep: 2,
    rewardPerk: (w.player.objectivesCompleted + w.player.objectives.length + 1) % 4 === 0,
    createdDay: w.day,
  };
  if (objectiveProgress(w, o) >= target) return null;
  return o;
}

const KINDS: ObjectiveKind[] = ['ccu', 'critic', 'monthRevenue', 'employees', 'updates', 'reputation', 'valuation', 'liveGames', 'owners', 'cash', 'contracts', 'serverTier', 'dataCenter', 'releases'];

export function refillObjectives(w: World): void {
  const have = new Set(w.player.objectives.map((o) => o.kind));
  const order = shuffle(w, [...KINDS]);
  for (const kind of order) {
    if (w.player.objectives.length >= 3) break;
    if (have.has(kind)) continue;
    const o = makeObjective(w, kind);
    if (o) {
      w.player.objectives.push(o);
      have.add(kind);
    }
  }
}

/** Goals nobody is chasing expire after a year so the list stays fresh. */
export const OBJECTIVE_LIFETIME = 360;

export function objectivesDaily(w: World): void {
  const c = playerCompany(w);
  if (!c || c.status !== 'active') return;
  const stale = w.player.objectives.filter((o) => w.day - o.createdDay > OBJECTIVE_LIFETIME);
  if (stale.length) {
    w.player.objectives = w.player.objectives.filter((o) => w.day - o.createdDay <= OBJECTIVE_LIFETIME);
    for (const o of stale) toast(w, `Goal expired: ${o.title}`, 'neutral', { category: 'goal', link: { route: 'goals' }, silent: true });
  }
  const done = w.player.objectives.filter((o) => objectiveProgress(w, o) >= o.target);
  for (const o of done) {
    w.player.objectives = w.player.objectives.filter((x) => x.id !== o.id);
    w.player.objectivesCompleted += 1;
    c.cash += o.rewardCash;
    c.ledger.other += o.rewardCash;
    c.reputation = Math.min(100, c.reputation + o.rewardRep);
    if (o.rewardPerk) w.player.progression.perkPoints += 1;
    addXp(w, o.rewardXp);
    toast(w, `Goal complete: ${o.title}`, 'good', {
      category: 'goal',
      link: { route: 'goals' },
      body: `+${fmt(o.rewardCash)}, +${o.rewardXp} XP${o.rewardPerk ? ', +1 perk point' : ''}.`,
    });
  }
  if (w.player.objectives.length < 3) refillObjectives(w);
}

export function rerollObjective(w: World, id: string): ActionResult {
  if (w.day - w.player.objectiveRerollDay < 30) return { ok: false, error: `You can swap a goal again in ${30 - (w.day - w.player.objectiveRerollDay)} days.` };
  const before = w.player.objectives.length;
  w.player.objectives = w.player.objectives.filter((o) => o.id !== id);
  if (w.player.objectives.length === before) return { ok: false, error: 'Goal not found.' };
  w.player.objectiveRerollDay = w.day;
  refillObjectives(w);
  return { ok: true };
}

/** XP for shipping a game: quality matters, bigger games matter more. */
export function releaseXp(critic: number, scopeIndex: number): number {
  const mult = [1, 1.6, 2.6, 4, 6, 8][scopeIndex] ?? 1;
  return Math.round(Math.max(20, (critic - 40) * 2.5) * mult);
}
