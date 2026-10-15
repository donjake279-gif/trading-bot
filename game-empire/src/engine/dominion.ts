// The Dominion orchestrator: runs every late-game system on the daily,
// weekly and monthly ticks, settles market dominance, announces what
// unlocks, and routes inbox decisions to the right system.
import { celebrate, earn, ledgerRevenue, playerCompany, spend, toast } from './util';
import { FEATURES, FEATURE_ORDER, SECTOR_IDS, bestLevel, dlog, dominanceBonus, dominionOpen, refreshPower, scarValue, sectorMult, sectorShare } from './dominionCore';
import { allianceBonus, annexedIncome, corpsMonthly, ensureCorps, resolveWarDecision, warsDaily } from './megacorps';
import { execsMonthly, refreshExecPool, resolveExecDecision } from './executives';
import { espionageMonthly, opsDaily, resolveSpyDecision, threatsWeekly } from './espionage';
import { ecosystemDaily, ecosystemMonthly, resolveEcoDecision } from './ecosystem';
import { corpKeynotesMonthly, keynotesDaily } from './keynotes';
import { resolveSpaceDecision, spaceDaily, spaceMonthly } from './space';
import { citiesMonthly, resolveCityDecision } from './cities';
import { resolveWorldDecision, universesDaily, universesMonthly, universesWeekly } from './universes';
import { corpMegaprojectsMonthly, megaprojectsDaily, resolveMegaDecision } from './megaprojects';
import { emergenciesMonthly, emergencyDaily, resolveEmergencyDecision } from './emergencies';
import type { DecisionEvent, Ledger, SectorId, World } from './types';

export function dominionDaily(w: World): void {
  if (!w.player.dominion || !dominionOpen(w)) return;
  warsDaily(w);
  opsDaily(w);
  keynotesDaily(w);
  ecosystemDaily(w);
  spaceDaily(w);
  universesDaily(w);
  megaprojectsDaily(w);
  emergencyDaily(w);
}

export function dominionWeekly(w: World): void {
  if (!w.player.dominion || !dominionOpen(w)) return;
  announceUnlocks(w);
  threatsWeekly(w);
  universesWeekly(w);
}

/** Runs at the start of each month, before the books close. */
export function dominionMonthly(w: World): void {
  const d = w.player.dominion;
  if (!d || !dominionOpen(w)) return;
  refreshPower(w);
  corpsMonthly(w);
  execsMonthly(w);
  espionageMonthly(w);
  ecosystemMonthly(w);
  corpKeynotesMonthly(w);
  spaceMonthly(w);
  citiesMonthly(w);
  universesMonthly(w);
  corpMegaprojectsMonthly(w);
  emergenciesMonthly(w);
  marketDominance(w);
  d.mods = d.mods.filter((m) => m.until > w.day);
  d.scars = d.scars.filter((s) => s.until > w.day);
}

function monthBySector(l: Ledger): Record<SectorId, number> {
  return {
    games: l.sales + l.microtransactions + l.subscriptions + l.ads + l.dlc + l.licensing + l.store + l.publishing + l.contracts,
    hardware: l.hardware,
    platforms: l.ecosystem,
    cloud: 0,
    ai: l.tech,
    media: l.entertainment + l.worlds,
    space: l.space,
  };
}

/**
 * Leading a market pays (up to +12% of what you earn there); war spoils,
 * sanctions and crises push income up or down; allies share technology;
 * absorbed megacorps send their profits home.
 */
function marketDominance(w: World): void {
  const d = w.player.dominion;
  const p = playerCompany(w);
  const rev = monthBySector(p.ledger);
  let adj = 0;
  for (const s of SECTOR_IDS) {
    if (!rev[s]) continue;
    const bonus = d.corps.length ? dominanceBonus(sectorShare(w, s)) : 0;
    adj += rev[s] * (bonus + sectorMult(w, s) - 1);
  }
  adj += ledgerRevenue(p.ledger) * (allianceBonus(w) + scarValue(w, 'revenue'));
  if (adj > 0) earn(p, 'dominion', adj);
  else if (adj < 0) spend(p, 'warfare', -adj);
  const annexed = annexedIncome(w);
  if (annexed > 0) earn(p, 'dominion', annexed);
  const rep = scarValue(w, 'rep');
  if (rep) p.reputation = Math.max(0, Math.min(100, p.reputation + rep));
}

/** Weekly: tell the player what just opened up. */
export function announceUnlocks(w: World): void {
  const d = w.player.dominion;
  const best = bestLevel(w);
  if (best <= d.seen) return;
  const fresh = FEATURE_ORDER.filter((f) => FEATURES[f].level > d.seen && FEATURES[f].level <= best);
  d.seen = best;
  if (!fresh.length) return;
  if (fresh.includes('execs')) refreshExecPool(w);
  if (fresh.includes('wars')) ensureCorps(w);
  const names = fresh.map((f) => FEATURES[f].name).join(', ');
  toast(w, `Dominion: ${names} unlocked`, 'major', { category: 'studio', link: { route: 'dominion', id: fresh[0] }, body: FEATURES[fresh[0]].blurb });
  dlog(w, `Unlocked: ${names}.`, 'major');
  if (best >= 4) celebrate(w, `New in Dominion: ${names}`, false);
}

export function resolveDominion(w: World, ev: DecisionEvent, optionId: string): boolean {
  if (!w.player.dominion) return false;
  return (
    resolveWarDecision(w, ev, optionId) ||
    resolveExecDecision(w, ev, optionId) ||
    resolveSpyDecision(w, ev, optionId) ||
    resolveEcoDecision(w, ev, optionId) ||
    resolveSpaceDecision(w, ev, optionId) ||
    resolveCityDecision(w, ev, optionId) ||
    resolveWorldDecision(w, ev, optionId) ||
    resolveMegaDecision(w, ev, optionId) ||
    resolveEmergencyDecision(w, ev, optionId)
  );
}

/** Things that need you right now (for nav badges and the dashboard). */
export function dominionAlerts(w: World): number {
  const d = w.player.dominion;
  if (!d || !dominionOpen(w)) return 0;
  let n = 0;
  if (d.emergency) n++;
  n += d.wars.filter((x) => x.attackers.includes('player') || x.defenders.includes('player')).length;
  return n;
}
