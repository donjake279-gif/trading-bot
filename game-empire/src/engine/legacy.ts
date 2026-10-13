// Legacy (New Game+): every run that ends banks legacy points, kept in this
// browser across runs. Spend them on head starts for your next studio.
import { LEGACY_BONUSES, OFFICES } from './constants';
import { newStudioEngine } from './studioEngine';
import { founderStake } from './stocks';
import type { ActionResult, LegacyId, World } from './types';
import { playerCompany, pushNews } from './util';

export interface LegacyBank {
  points: number;
  earned: number;
  runs: number;
  bestValuation: number;
}

const KEY = 'game-empire:legacy';

export function loadLegacy(): LegacyBank {
  const empty: LegacyBank = { points: 0, earned: 0, runs: 0, bestValuation: 0 };
  try {
    if (typeof localStorage === 'undefined') return empty;
    const raw = localStorage.getItem(KEY);
    if (!raw) return empty;
    const v = JSON.parse(raw) as Partial<LegacyBank>;
    return { points: Math.max(0, Number(v.points) || 0), earned: Math.max(0, Number(v.earned) || 0), runs: Math.max(0, Number(v.runs) || 0), bestValuation: Math.max(0, Number(v.bestValuation) || 0) };
  } catch {
    return empty;
  }
}

export function saveLegacy(bank: LegacyBank): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(KEY, JSON.stringify(bank));
  } catch {
    /* storage blocked: legacy only lasts this session */
  }
}

/** Points a finished run is worth. */
export function legacyPointsFor(w: World): number {
  const go = w.player.gameOver;
  const s = w.player.stats;
  const level = w.player.progression?.level ?? 1;
  const ach = Object.keys(w.player.achievements).length;
  const value = Math.max(0, Math.log10(Math.max(1, s.peakValuation)) - 6) * 8;
  const years = Math.max(0, ((go?.day ?? w.day) - (playerCompany(w)?.founded ?? 0)) / 365);
  const exit = years >= 3 ? (go?.reason === 'sold' ? 15 : go?.reason === 'retired' ? 8 : 0) : 0;
  // short runs are worth little, so quitting early can't farm points
  const seasoned = Math.min(1, Math.max(0.1, years / 3));
  return Math.max(1, Math.round((level * 1.5 + ach * 2 + value + w.player.objectivesCompleted * 0.5 + exit) * seasoned));
}

/** Bank this run's legacy points once. Returns the points added (0 if already banked). */
export function bankLegacy(w: World): number {
  if (!w.player.gameOver || w.player.legacyBanked) return 0;
  const pts = legacyPointsFor(w);
  const bank = loadLegacy();
  bank.points += pts;
  bank.earned += pts;
  bank.runs += 1;
  bank.bestValuation = Math.max(bank.bestValuation, w.player.stats.peakValuation);
  saveLegacy(bank);
  w.player.legacyBanked = true;
  return pts;
}

export function legacyCost(picks: Partial<Record<LegacyId, number>>): number {
  let t = 0;
  for (const [id, n] of Object.entries(picks) as [LegacyId, number][]) t += LEGACY_BONUSES[id].cost * (n ?? 0);
  return t;
}

/** Spend points from the bank for a new run. */
export function spendLegacy(picks: Partial<Record<LegacyId, number>>): boolean {
  const bank = loadLegacy();
  const cost = legacyCost(picks);
  if (cost > bank.points) return false;
  bank.points -= cost;
  saveLegacy(bank);
  return true;
}

/** Apply head starts to a freshly created player (deterministic: part of the new-game options). */
export function applyLegacy(w: World, picks: Partial<Record<LegacyId, number>>): void {
  const p = playerCompany(w);
  const n = (id: LegacyId) => Math.max(0, Math.min(LEGACY_BONUSES[id].max, Math.floor(picks[id] ?? 0)));
  w.player.legacy = {};
  for (const id of Object.keys(LEGACY_BONUSES) as LegacyId[]) if (n(id) > 0) w.player.legacy[id] = n(id);
  if (n('cash')) {
    p.cash += 25000 * n('cash');
  }
  if (n('reputation')) p.reputation = Math.min(100, p.reputation + 5 * n('reputation'));
  if (n('skill')) {
    const f = w.player.employees.find((e) => e.isFounder);
    if (f) f.skill = Math.min(100, f.skill + 5 * n('skill'));
  }
  if (n('perk')) w.player.progression.perkPoints += n('perk');
  if (n('garage') && w.player.officeLevel < 1) w.player.officeLevel = 1;
  if (n('engine')) {
    if (!w.player.research.completed.includes('engine1')) w.player.research.completed.push('engine1');
    if (!w.player.research.completed.includes('agile')) w.player.research.completed.push('agile');
    w.player.engine = newStudioEngine(w, `${p.name.split(' ')[0]} Engine`);
  }
  if (Object.keys(w.player.legacy).length) {
    pushNews(w, { kind: 'player', title: `${p.ceo} starts again, wiser this time`, body: `Legacy bonuses: ${Object.keys(w.player.legacy).map((k) => LEGACY_BONUSES[k as LegacyId].name).join(', ')}. Office: ${OFFICES[w.player.officeLevel].name}.`, companyId: p.id, tone: 'good' });
  }
}

/** Walk away on your own terms: ends the run and banks legacy points. */
export function retire(w: World): ActionResult {
  if (w.player.gameOver) return { ok: false, error: 'The run is already over.' };
  const p = playerCompany(w);
  const worth = founderStake(p) * (p.isPublic ? p.price * p.shares : p.valuation);
  w.player.gameOver = {
    reason: 'retired',
    day: w.day,
    title: `You retired from ${p.name}`,
    body: `You handed the keys to your successor and walked into the sunset with a stake worth $${Math.round(worth).toLocaleString()}.`,
    netWorth: worth,
  };
  return { ok: true };
}
