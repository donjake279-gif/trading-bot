// Long-run headless simulation: sanity checks plus a diagnostic report used
// to tune the economy. Run with `npm run sim`.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { advanceDay } from '../tick';
import { totalActivePlayers } from '../market';
import { revenueTTM } from '../finance';
import { createGame, releasePlayerGame } from '../actions';
import { GENRES } from '../constants';
import { focus } from '../constants';
import type { World } from '../types';
import { formatDate } from '../util';

const fmt = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};
const num = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(0)}K` : n.toFixed(0));

function report(w: World, label: string) {
  const comps = Object.values(w.companies);
  const active = comps.filter((c) => c.status === 'active');
  const lines: string[] = [];
  lines.push(`==== ${label} — ${formatDate(w.day)} (day ${w.day})`);
  lines.push(
    `studios: ${active.length} active, ${comps.filter((c) => c.status === 'bankrupt').length} bankrupt, ${comps.filter((c) => c.parentId).length} subsidiaries, public ${active.filter((c) => c.isPublic).length}`,
  );
  const live = Object.values(w.games).filter((g) => g.status === 'released');
  const dailyRev = live.reduce((s, g) => s + g.dailyRevenue, 0);
  lines.push(`games: ${Object.keys(w.games).length} total, ${live.length} live; active players ${num(totalActivePlayers(w))}; industry rev/day ${fmt(dailyRev)} (~${fmt(dailyRev * 365)}/yr)`);
  const top = [...live].sort((a, b) => b.ccu - a.ccu).slice(0, 8);
  for (const g of top) {
    lines.push(
      `  ${g.title.padEnd(34)} ${GENRES[g.genre].short.padEnd(6)} ${w.companies[g.companyId].name.padEnd(22)} ccu ${num(g.ccu).padStart(6)} act ${num(g.active).padStart(6)} own ${num(g.owners).padStart(6)} crit ${g.criticScore} rev30 ${fmt(g.rev30)} ${g.monetization}`,
    );
  }
  const byRev = [...active].sort((a, b) => revenueTTM(b) - revenueTTM(a)).slice(0, 10);
  for (const c of byRev) {
    lines.push(
      `  ${c.name.padEnd(24)} ${c.strategy.padEnd(16)} rev ${fmt(revenueTTM(c)).padStart(8)} cash ${fmt(c.cash).padStart(8)} val ${fmt(c.valuation).padStart(8)} hc ${String(c.headcount).padStart(5)} rep ${c.reputation.toFixed(0)} tal ${c.talent.toFixed(0)}${c.isPublic ? ` $${c.price.toFixed(2)}` : ''}`,
    );
  }
  lines.push(`index ${w.market.index.toFixed(0)} regime ${w.market.regime} sentiment ${w.market.sentiment.toFixed(2)}`);
  return lines.join('\n');
}

function checkFinite(w: World) {
  for (const c of Object.values(w.companies)) {
    expect(Number.isFinite(c.cash), `cash ${c.name}`).toBe(true);
    expect(Number.isFinite(c.valuation), `valuation ${c.name}`).toBe(true);
    if (c.isPublic) expect(Number.isFinite(c.price), `price ${c.name}`).toBe(true);
  }
  for (const g of Object.values(w.games)) {
    expect(Number.isFinite(g.active), `active ${g.title}`).toBe(true);
    expect(Number.isFinite(g.owners), `owners ${g.title}`).toBe(true);
    expect(Number.isFinite(g.dailyRevenue), `rev ${g.title}`).toBe(true);
  }
}

describe('long run simulation', () => {
  it('runs a living industry for several years without breaking', () => {
    const t0 = Date.now();
    const w = createWorld({ seed: 'longrun-1', companyName: 'Test Co', founderName: 'Tester', specialty: 'designer', difficulty: 'normal', rivals: 24 });
    const tGen = Date.now() - t0;
    console.log(`world generated in ${tGen}ms`);
    console.log(report(w, 'start'));
    checkFinite(w);

    // scripted player: one tiny game solo
    const founder = w.player.employees[0];
    const res = createGame(
      w,
      {
        title: 'First Light',
        genre: 'indie',
        platforms: ['pc'],
        audience: 'casual',
        engine: 'pixelforge',
        monetization: 'premium',
        price: 4.99,
        artStyle: 'pixel',
        multiplayer: 'single',
        scope: 'tiny',
        budget: 800,
        focus: focus(36, 16, 18, 14, 4, 12),
      },
      [founder.id],
    );
    expect(res.ok).toBe(true);
    const gid = res.id!;
    let released = false;
    let polishDays = 0;
    const t1 = Date.now();
    const years = 6;
    for (let d = 0; d < 365 * years; d++) {
      advanceDay(w);
      const g = w.games[gid];
      if (!released && g.workDone >= g.workRequired && (polishDays += 1) > 10) {
        releasePlayerGame(w, gid);
        released = true;
        console.log(`player game released day ${w.day}, critic ${g.criticScore}, quality ${g.quality.toFixed(1)}, bugs ${g.bugs.toFixed(1)}`);
      }
      if (released && w.day % 30 === 0 && w.day < 400) {
        console.log(`  day ${w.day}: owners ${num(g.owners)} active ${num(g.active)} rev total ${fmt(g.revenueTotal)} cash ${fmt(w.companies[w.player.companyId].cash)}`);
      }
      if (w.day % 365 === 0) {
        console.log(report(w, `year ${w.day / 365}`));
        checkFinite(w);
      }
      if (w.player.gameOver) {
        console.log('player game over', w.player.gameOver.reason, 'day', w.day);
        break;
      }
    }
    const ms = Date.now() - t1;
    console.log(`simulated ${years} years in ${ms}ms (${(ms / (365 * years)).toFixed(2)}ms/day)`);
    const json = JSON.stringify(w);
    console.log(`save size ${(json.length / 1024 / 1024).toFixed(2)} MB`);
    const byScope: Record<string, { n: number; critic: number; rev: number; cost: number; hits: number }> = {};
    for (const g of Object.values(w.games)) {
      if (w.companies[g.companyId].isPlayer || g.releaseDay === null || g.releaseDay < 0 || g.releaseDay > w.day - 365) continue;
      const b = (byScope[g.scope] ??= { n: 0, critic: 0, rev: 0, cost: 0, hits: 0 });
      b.n++;
      b.critic += g.criticScore;
      b.rev += g.revenueTotal;
      b.cost += g.budgetSpent + g.staffCost + g.marketingSpent;
      if (g.revenueTotal > (g.budgetSpent + g.staffCost) * 3) b.hits++;
    }
    for (const [k, b] of Object.entries(byScope)) console.log(`AI ${k.padEnd(7)} n=${b.n} critic ${(b.critic / b.n).toFixed(1)} avgRev ${fmt(b.rev / b.n)} avgCost ${fmt(b.cost / b.n)} ROI ${(b.rev / b.cost).toFixed(2)} hits ${b.hits}`);
    const counts: Record<string, number> = {};
    for (const n of w.news) {
      const key = /bankruptcy/.test(n.title) ? 'bankrupt' : /acquires/.test(n.title) ? 'acquire' : /goes public/.test(n.title) ? 'ipo' : /launches with|opens its doors/.test(n.title) ? 'newStudio' : /goes viral/.test(n.title) ? 'viral' : n.kind;
      counts[key] = (counts[key] ?? 0) + 1;
    }
    console.log('news counts (last 450):', JSON.stringify(counts));
    const news = w.news.slice(0, 40).map((n) => `${formatDate(n.day)} [${n.kind}] ${n.title}`);
    console.log(news.join('\n'));
    checkFinite(w);
  });
});
