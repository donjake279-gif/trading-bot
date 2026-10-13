// The daily simulation step. Order matters: production, then the market,
// then costs, then decisions, then capital markets, then events and closes.
import { checkAchievements } from './achievements';
import { playerAutomation } from './automation';
import { aiDaily, aiDecide, aiSolvency, maybeSpawnStudio } from './ai';
import { playerDevDay } from './development';
import { awardsDaily } from './awards';
import { boardMonthly, expireDecisions, hitFeedback, macroDay, playerSolvency, randomEvents, resolveAuctions } from './events';
import { computeValuation, dailyCosts, monthlyBurn, monthlyClose, recordCash, updateIpFans } from './finance';
import { marketDay, playerGameAlerts, totalActivePlayers } from './market';
import { expoDaily, investmentsDaily, licensesMonthly, policiesDaily, profitSharingMonthly, publishingDaily, salesDaily, updateRival } from './business';
import { contractsDaily } from './contracts';
import { infraDaily } from './infra';
import { addXp, objectivesDaily } from './progression';
import { refreshCandidates, researchDaily, staffDaily, staffMonthly } from './staff';
import { engineDaily, engineWarsMonthly } from './studioEngine';
import { certificationsWeekly, conventionDaily, facilitiesDaily, legendsDaily, legendsMonthly, storeDaily } from './fun';
import { memesDaily } from './memes';
import { jamDaily } from './jam';
import { marketDay as stockMarketDay, quarterlyEarnings, stockDay, sweepSubsidiaries } from './stocks';
import { updateDaily } from './updates';
import type { World } from './types';
import { dayToDate, ledgerExpenses, ledgerRevenue } from './util';
import { WARMUP_DAYS } from './constants';

export function advanceDay(w: World): void {
  if (w.player.gameOver) return;
  w.day += 1;
  const date = dayToDate(w.day);
  const monthStart = date.getUTCDate() === 1;
  const player = w.companies[w.player.companyId];
  const hasPlayer = !!player && player.status === 'active';

  macroDay(w);

  for (const id in w.companies) {
    const c = w.companies[id];
    if (c.status === 'active') c.rev30 *= 29 / 30;
  }

  // ---- production
  if (hasPlayer) {
    playerAutomation(w);
    for (const id in w.games) {
      const g = w.games[id];
      if (g.companyId === player.id && g.status === 'development') playerDevDay(w, g, player);
    }
    contractsDaily(w);
    staffDaily(w);
    researchDaily(w);
    engineDaily(w);
    legendsDaily(w);
  }
  for (const id in w.companies) {
    const c = w.companies[id];
    if (c.status === 'active' && !c.isPlayer) aiDaily(w, c);
  }
  for (const id in w.games) {
    const g = w.games[id];
    if (g.update && g.status === 'released') updateDaily(w, g, w.companies[g.companyId]);
  }

  // ---- the market
  marketDay(w);
  if (hasPlayer) {
    infraDaily(w);
    if (w.day % 7 === 0) playerGameAlerts(w);
  }
  for (const id in w.games) {
    const g = w.games[id];
    if (g.releaseDay === w.day && g.breakout > 1) hitFeedback(w, g);
    if (hasPlayer && g.companyId === player.id && g.status === 'released' && g.ccu > w.player.stats.peakCcu) w.player.stats.peakCcu = g.ccu;
  }

  // ---- running costs
  for (const id in w.companies) {
    const c = w.companies[id];
    if (c.status === 'active') dailyCosts(w, c);
  }
  if (hasPlayer) {
    facilitiesDaily(w);
    storeDaily(w);
    conventionDaily(w);
    policiesDaily(w);
    investmentsDaily(w);
    publishingDaily(w);
    expoDaily(w);
    salesDaily(w);
  }

  // ---- AI decisions (staggered weekly)
  for (const id in w.companies) {
    const c = w.companies[id];
    if (c.status !== 'active' || c.isPlayer) continue;
    if ((w.day + c.decisionOffset) % 7 === 0) {
      aiDecide(w, c);
      c.valuation = computeValuation(w, c);
    }
  }
  if (hasPlayer) player.valuation = computeValuation(w, player);

  // ---- capital markets
  const mret = stockMarketDay(w);
  stockDay(w, mret);

  // ---- events
  randomEvents(w);
  maybeSpawnStudio(w);
  resolveAuctions(w);
  if (hasPlayer) expireDecisions(w);

  // ---- solvency
  for (const id in w.companies) {
    const c = w.companies[id];
    if (c.status === 'active' && !c.isPlayer) aiSolvency(w, c);
  }
  if (hasPlayer) {
    playerSolvency(w);
    recordCash(w, player);
    if (player.valuation > w.player.stats.peakValuation) w.player.stats.peakValuation = player.valuation;
  }

  // ---- monthly close
  if (monthStart) {
    if (hasPlayer) {
      engineWarsMonthly(w);
      licensesMonthly(w);
      const revenue = ledgerRevenue(player.ledger);
      profitSharingMonthly(w, revenue - ledgerExpenses(player.ledger));
      if (revenue > 0) addXp(w, Math.min(600, 25 * Math.log10(1 + revenue / 1000) ** 1.6));
    }
    for (const id in w.companies) {
      const c = w.companies[id];
      if (c.status === 'active') {
        monthlyClose(w, c);
        if (!c.isPlayer) recordCash(w, c);
      }
    }
    updateIpFans(w);
    sweepSubsidiaries(w, (c) => monthlyBurn(w, c));
    if (hasPlayer) {
      staffMonthly(w);
      boardMonthly(w);
      if (w.day - w.player.candidatesRefreshDay >= 28) refreshCandidates(w);
      legendsMonthly(w);
      updateRival(w);
      w.player.stats.totalRevenue = player.revenueTotal;
    }
    let rev = 0;
    for (const id in w.games) if (w.games[id].status === 'released') rev += w.games[id].dailyRevenue;
    if (w.day > -WARMUP_DAYS + 270) w.market.industryHistory.push([w.day, Math.round(totalActivePlayers(w)), Math.round(rev)]);
    if (w.market.industryHistory.length > 180) w.market.industryHistory.shift();
    const m = date.getUTCMonth();
    if (m % 3 === 0) quarterlyEarnings(w);
  }

  awardsDaily(w);
  if (hasPlayer) {
    memesDaily(w);
    jamDaily(w);
    objectivesDaily(w);
    if (w.day % 7 === 0) {
      certificationsWeekly(w);
      checkAchievements(w);
    }
  }
}

export function advanceDays(w: World, n: number): void {
  for (let i = 0; i < n && !w.player.gameOver; i++) advanceDay(w);
}
