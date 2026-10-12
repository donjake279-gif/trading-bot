// Player conveniences that run every day: auto live-ops for games the player
// opted in, and idle developers joining projects on their own.
import { contractDailyWork } from './contracts';
import { MONETIZATIONS, ROLES, SCOPES } from './constants';
import { bugDensity } from './development';
import { startUpdateRecord, updateCost } from './updates';
import type { Employee, Game, UpdateTypeId, World } from './types';
import { gamesOf, playerCompany } from './util';

function developers(w: World): Employee[] {
  return w.player.employees.filter((e) => ROLES[e.role].dev);
}

/** What a sensible live-ops team would ship next for this game, if anything. */
export function pickAutoUpdate(w: World, g: Game): UpdateTypeId | null {
  const since = w.day - g.lastUpdateDay;
  if (bugDensity(g) > 2.5 && since > 7) return 'hotfix';
  const f2p = !MONETIZATIONS[g.monetization].upfront;
  if (since < (f2p ? 40 : 70)) return null;
  if (g.active < 30 && g.rev30 < 500) return null;
  const age = w.day - (g.releaseDay ?? w.day);
  const n = g.updates.length;
  const expansions = g.updates.filter((u) => u.type === 'expansion').length;
  if (!f2p && g.scope !== 'tiny' && age > 200 && expansions < 3 && n % 3 === 2) return 'expansion';
  if (f2p) return n % 2 === 0 ? 'seasonal' : 'content';
  return n % 4 === 3 ? 'balance' : 'content';
}

export function liveOpsTeamSize(g: Game): number {
  return Math.max(1, Math.min(6, Math.ceil(SCOPES[g.scope].typicalTeam * 0.25)));
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

  for (const g of games) {
    if (g.status !== 'released' || !g.autoUpdates || g.update || g.updateQueue.length > 0) continue;
    const type = pickAutoUpdate(w, g);
    if (!type) continue;
    if (p.cash < updateCost(g, type) * 3) continue;
    const team = recruitTeam(w, liveOpsTeamSize(g));
    if (team.length === 0) continue;
    for (const e of team) e.assignment = g.id;
    startUpdateRecord(w, g, p, type, team.map((e) => e.id), 0);
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
