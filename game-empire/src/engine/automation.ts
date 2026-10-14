// Player conveniences that run every day: auto live-ops for games the player
// opted in, and idle developers joining projects on their own.
import { struggling } from './hr';
import { contractDailyWork } from './contracts';
import { MONETIZATIONS, PLATFORMS, ROLES, SCOPES, platformAffinity } from './constants';
import { bugDensity } from './development';
import { CREW_OUTPUT, CREW_WORK_COST, startUpdateRecord, updateCost, updateFatigue, updateWork } from './updates';
import type { Employee, Game, PlatformId, UpdateTypeId, World } from './types';
import { gamesOf, playerCompany } from './util';

function developers(w: World): Employee[] {
  return w.player.employees.filter((e) => ROLES[e.role].dev);
}

/** Is this game kept updated automatically? */
export function isAutoUpdated(w: World, g: Game): boolean {
  if (g.manualUpdates) return false;
  return g.autoUpdates || !!w.player.liveOps?.auto;
}

export interface AutoPick {
  type: UpdateTypeId;
  platform?: PlatformId;
}

/** A hit that is missing a big platform gets ported there. */
export function bestPort(w: World, g: Game): PlatformId | null {
  const p = playerCompany(w);
  let best: PlatformId | null = null;
  let bestScore = 0;
  for (const id of Object.keys(PLATFORMS) as PlatformId[]) {
    if (g.platforms.includes(id)) continue;
    const def = PLATFORMS[id];
    if (p.reputation < def.minRep) continue;
    const aff = platformAffinity(id, g.genre);
    if (aff < 0.8) continue;
    const score = w.market.platforms[id].users * aff * def.spend;
    if (score > bestScore) {
      bestScore = score;
      best = id;
    }
  }
  return best;
}

/** What a sensible live-ops team would ship next for this game, if anything. */
export function pickAutoUpdate(w: World, g: Game): AutoPick | null {
  const since = w.day - g.lastUpdateDay;
  // games nobody plays get nothing, not even patches
  if (g.active < 100 && g.rev30 < 500) return null;
  if (bugDensity(g) > 2.5 && since > 14) return { type: 'hotfix' };
  const f2p = !MONETIZATIONS[g.monetization].upfront;
  const gap = g.scope === 'tiny' ? 90 : f2p ? 35 : 55;
  if (since < gap) return null;
  const age = w.day - (g.releaseDay ?? w.day);
  const recentPort = g.updates.some((u) => u.type === 'port' && w.day - u.day < 180);
  if (!recentPort && age > 120 && (g.owners >= 200000 || g.peakActive >= 20000)) {
    const platform = bestPort(w, g);
    if (platform) return { type: 'port', platform };
  }
  const n = g.updates.filter((u) => u.type !== 'hotfix').length;
  const options: UpdateTypeId[] = [];
  if (g.scope !== 'tiny' && age > 200 && n % 3 === 2) options.push('expansion');
  options.push('content');
  options.push(f2p ? 'seasonal' : 'balance');
  // the freshest kind of update wins: players tire of the same thing
  options.sort((a, b) => updateFatigue(w, g, a) - updateFatigue(w, g, b));
  return { type: options[0] };
}

export function liveOpsTeamSize(g: Game): number {
  return Math.max(1, Math.min(6, Math.ceil(SCOPES[g.scope].typicalTeam * 0.25)));
}

/** Roughly what an update can earn back: a few months of the game's revenue, plus DLC buyers for a paid expansion. */
export function updateValue(g: Game, type: UpdateTypeId): number {
  const dlc = type === 'expansion' && MONETIZATIONS[g.monetization].upfront ? Math.max(0, g.owners - g.dlcOwners) * 0.02 * Math.max(9.99, g.price * 0.4) : 0;
  const reach = type === 'port' ? g.rev30 * 3 + g.owners * 0.05 * g.price * 0.3 : 0;
  // a patch keeps players happy: worth something even for games that no longer sell
  const goodwill = type === 'hotfix' ? g.active * 0.05 : 0;
  return g.rev30 * 3 + dlc + reach + goodwill;
}

/** How long a live-ops crew should take for each kind of update. */
export const CREW_TARGET_DAYS: Record<UpdateTypeId, number> = { hotfix: 5, balance: 10, content: 30, seasonal: 20, expansion: 60, monetization: 14, port: 40 };

/** Contractors needed so the update ships on schedule next to your own people. */
export function crewFor(w: World, g: Game, pick: AutoPick, ownPeople: number): { crew: number; cost: number } {
  const work = updateWork(w, g, pick.type, true, pick.platform);
  const days = CREW_TARGET_DAYS[pick.type];
  const crew = Math.max(0, Math.ceil(work / days / CREW_OUTPUT - ownPeople));
  // contractors are paid for the share of the work they do
  const share = crew / Math.max(1, crew + ownPeople);
  return { crew, cost: Math.round(work * share * CREW_WORK_COST) };
}

/** Idle developers first, then borrow a few from the biggest projects. */
function recruitTeam(w: World, size: number): Employee[] {
  const all = developers(w);
  const team = all.filter((e) => !e.assignment).slice(0, size);
  if (team.length >= size) return team;
  const byProject = new Map<string, Employee[]>();
  for (const e of all) {
    if (!e.assignment || w.games[e.assignment]?.status !== 'development') continue;
    const list = byProject.get(e.assignment) ?? [];
    list.push(e);
    byProject.set(e.assignment, list);
  }
  const projects = [...byProject.values()].sort((a, b) => b.length - a.length);
  for (const list of projects) {
    const lend = Math.max(1, Math.floor(list.length / 4));
    for (const e of list.slice(0, lend)) {
      if (team.length >= size) return team;
      team.push(e);
    }
  }
  return team;
}

export function playerAutomation(w: World): void {
  const p = playerCompany(w);
  if (!p || p.status !== 'active') return;
  const games = gamesOf(w, p.id);

  const useCrew = w.player.liveOps?.crew ?? true;
  const tight = struggling(w);
  for (const g of games) {
    if (g.status !== 'released' || g.update || g.updateQueue.length > 0 || !isAutoUpdated(w, g)) continue;
    const pick = pickAutoUpdate(w, g);
    if (!pick) continue;
    const base = updateCost(g, pick.type, pick.platform);
    // with a crew, only idle developers help; without one, borrow from projects
    // while the studio is struggling only patches ship, and only with your own free developers
    if (tight && pick.type !== 'hotfix') continue;
    const hire = useCrew && !tight;
    const team = hire || tight ? developers(w).filter((e) => !e.assignment).slice(0, liveOpsTeamSize(g)) : recruitTeam(w, liveOpsTeamSize(g));
    const { crew, cost: crewCost } = hire ? crewFor(w, g, pick, team.length) : { crew: 0, cost: 0 };
    if (p.cash < (base + crewCost) * 3) continue;
    // every update has to be worth what it costs (patches 1×, everything else 2×)
    if (updateValue(g, pick.type) < (pick.type === 'hotfix' ? 1 : 2) * (base + crewCost)) continue;
    if (team.length === 0 && crew === 0) continue;
    for (const e of team) e.assignment = g.id;
    startUpdateRecord(w, g, p, pick.type, team.map((e) => e.id), crew, { platform: pick.platform });
    if (crewCost > 0) {
      p.cash -= crewCost;
      p.ledger.development += crewCost;
      g.update!.cost += crewCost;
    }
  }

  if (!w.player.autoAssign) return;
  let idle = developers(w).filter((e) => !e.assignment);
  if (idle.length === 0) return;
  // contracts that would miss their deadline get help first
  for (const k of w.player.contracts) {
    const daysLeft = Math.max(1, k.deadline - w.day);
    while (idle.length > 0 && contractDailyWork(w, k.id) * daysLeft < k.work - k.workDone) {
      idle[0].assignment = k.id;
      idle = idle.slice(1);
    }
  }
  const projects = games.filter((g) => g.status === 'development');
  const updating = games.filter((g) => g.status === 'released' && g.update);
  const size = new Map<string, number>();
  for (const e of developers(w)) if (e.assignment) size.set(e.assignment, (size.get(e.assignment) ?? 0) + 1);
  for (const e of idle) {
    let best: Game | null = null;
    let bestRatio = Infinity;
    for (const g of projects) {
      const n = size.get(g.id) ?? 0;
      if (n >= SCOPES[g.scope].maxTeam) continue;
      const ratio = n / SCOPES[g.scope].typicalTeam;
      if (ratio < bestRatio) {
        best = g;
        bestRatio = ratio;
      }
    }
    if (!best && updating.length > 0) best = updating[0];
    if (!best) break;
    e.assignment = best.id;
    size.set(best.id, (size.get(best.id) ?? 0) + 1);
  }
}
