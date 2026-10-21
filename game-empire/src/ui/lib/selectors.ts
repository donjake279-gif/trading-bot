import { versionLabel } from '../../engine/updates';
import { empireUpkeep } from '../../engine/empire';
import { ventureRunRate } from '../../engine/ventures';
import type { Company, Game, World } from '../../engine/types';
import { gamesOf } from '../../engine/util';
import { monthlyBurn, revenueTTM } from '../../engine/finance';

export function gamesOfCompany(w: World, companyId: string): Game[] {
  return gamesOf(w, companyId);
}

export function liveGamesOf(w: World, companyId: string): Game[] {
  return gamesOf(w, companyId).filter((g) => g.status === 'released');
}

export function devGamesOf(w: World, companyId: string): Game[] {
  return gamesOf(w, companyId).filter((g) => g.status === 'development');
}

/** Sum one history column across games, by day. idx: 1 active, 2 ccu, 3 revenue. */
export function aggregateHistory(games: Game[], idx: 1 | 2 | 3, sinceDay: number): [number, number][] {
  const map = new Map<number, number>();
  for (const g of games) {
    for (const h of g.history) {
      if (h[0] < sinceDay) continue;
      map.set(h[0], (map.get(h[0]) ?? 0) + h[idx]);
    }
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0]);
}

export function companyCcu(w: World, companyId: string): number {
  let t = 0;
  for (const g of gamesOf(w, companyId)) if (g.status === 'released') t += g.ccu;
  return t;
}

export function companyActive(w: World, companyId: string): number {
  let t = 0;
  for (const g of gamesOf(w, companyId)) if (g.status === 'released') t += g.active;
  return t;
}

export function companyRev30(w: World, companyId: string): number {
  let t = 0;
  for (const g of gamesOf(w, companyId)) if (g.status === 'released') t += g.rev30;
  return t;
}

/** Group-level stats including subsidiaries. */
export function groupMembers(w: World, root: Company): Company[] {
  return Object.values(w.companies).filter((c) => c.id === root.id || (c.parentId === root.id && c.status === 'active'));
}

export function groupRevenueTTM(w: World, root: Company): number {
  return groupMembers(w, root).reduce((s, c) => s + revenueTTM(c), 0);
}

/** Monthly costs, including ventures and empire upkeep for the player. */
export function monthlyCosts(w: World, c: Company): number {
  const burn = monthlyBurn(w, c);
  return c.isPlayer ? burn + ventureRunRate(w).cost + empireUpkeep(w).total : burn;
}

/** Revenue over the last 30 days, including ventures for the player. */
export function monthlyRevenue(w: World, c: Company): number {
  const rev = companyRev30(w, c.id);
  return c.isPlayer ? rev + ventureRunRate(w).revenue : rev;
}

export function runwayMonths(w: World, c: Company): number {
  const burn = monthlyCosts(w, c);
  const rev = monthlyRevenue(w, c);
  const net = rev - burn;
  if (net >= 0) return Infinity;
  return Math.max(0, c.cash / -net);
}

export function statusLabel(g: Game): string {
  switch (g.status) {
    case 'development':
      return g.workDone >= g.workRequired ? 'Polishing' : 'In development';
    case 'released':
      if (g.update) return `Live ${versionLabel(g)} · updating`;
      if (g.patchPlan?.backlog.length) return `Live ${versionLabel(g)} · ${g.patchPlan.backlog.length} change${g.patchPlan.backlog.length === 1 ? '' : 's'} in the works`;
      return `Live ${versionLabel(g)}`;
    case 'shutdown':
      return 'Servers offline';
    case 'retired':
      return 'Retired';
    case 'cancelled':
      return 'Cancelled';
  }
}
