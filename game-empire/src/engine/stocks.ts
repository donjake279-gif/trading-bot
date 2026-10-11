// Stock market, IPOs, share trading and acquisitions.
import { randomInvestorAppetite } from './finance';
import { chance, randNormal, randRange } from './rng';
import type { Company, World } from './types';
import { clamp, formatDate, pushNews, pushPoint, toast } from './util';

export function marketCap(c: Company): number {
  return c.isPublic ? c.price * c.shares : c.valuation;
}

export function founderStake(c: Company): number {
  return c.shares > 0 ? c.founderShares / c.shares : 0;
}

/** Shares tradable on the open market (excluding insiders and other companies' holdings). */
export function floatShares(w: World, c: Company): number {
  let held = 0;
  for (const id in w.companies) {
    const h = w.companies[id].holdings[c.id];
    if (h) held += h.shares;
  }
  return Math.max(0, c.shares - c.founderShares - c.investorShares - held);
}

export function marketDay(w: World): number {
  const m = w.market;
  if (chance(w, 0.0035)) {
    const roll = randRange(w, 0, 1);
    const next = roll < 0.45 ? 'bull' : roll < 0.75 ? 'neutral' : 'bear';
    if (next !== m.regime) {
      m.regime = next;
      pushNews(w, {
        kind: 'market',
        title: next === 'bull' ? 'Markets rally as investors pile into gaming stocks' : next === 'bear' ? 'Bear market: investors flee risky tech and gaming stocks' : 'Markets steady after a volatile stretch',
        tone: next === 'bear' ? 'bad' : next === 'bull' ? 'good' : 'neutral',
      });
    }
  }
  const drift = m.regime === 'bull' ? 0.0007 : m.regime === 'bear' ? -0.0009 : 0.0002;
  const sentimentPull = (m.sentiment - 1) * 0.002;
  const ret = drift + sentimentPull + randNormal(w, 0, 0.0095);
  m.index = Math.max(50, m.index * Math.exp(ret));
  pushPoint(m.indexHistory, w.day, m.index, 500);
  return ret;
}

export function stockDay(w: World, marketRet: number): void {
  for (const id in w.companies) {
    const c = w.companies[id];
    if (!c.isPublic || c.status !== 'active') continue;
    const cap = c.price * c.shares;
    const fund = Math.max(0.01, c.valuation / c.shares);
    const beta = cap > 5e9 ? 0.85 : cap > 5e8 ? 1.05 : 1.3;
    const sigma = clamp(0.045 - Math.log10(Math.max(1e6, cap)) * 0.003, 0.012, 0.035);
    const lr = 0.02 * Math.log(fund / c.price) + beta * marketRet + randNormal(w, 0, sigma);
    c.price = Math.max(0.01, c.price * Math.exp(lr));
    if (c.price > 600) splitStock(w, c, 5);
    pushPoint(c.priceHistory, w.day, c.price, 500);
  }
}

export function splitStock(w: World, c: Company, ratio: number): void {
  c.shares *= ratio;
  c.founderShares *= ratio;
  c.investorShares *= ratio;
  c.price /= ratio;
  for (const p of c.priceHistory) p[1] /= ratio;
  for (const id in w.companies) {
    const h = w.companies[id].holdings[c.id];
    if (h) h.shares *= ratio;
  }
  pushNews(w, { kind: 'market', title: `${c.name} announces a ${ratio}-for-1 stock split`, companyId: c.id, tone: 'neutral' });
}

export function quarterlyEarnings(w: World): void {
  for (const id in w.companies) {
    const c = w.companies[id];
    if (c.status !== 'active') {
      c.quarterRevenue = 0;
      continue;
    }
    const rev = c.quarterRevenue;
    if (c.isPublic) {
      const expected = c.expectedQuarter > 0 ? c.expectedQuarter : rev;
      const surprise = expected > 0 ? (rev - expected) / expected : 0;
      const shock = clamp(surprise * 0.35 + randNormal(w, 0, 0.02), -0.3, 0.3);
      c.price = Math.max(0.01, c.price * Math.exp(shock));
      const notable = c.isPlayer || c.price * c.shares > 2e9 || !!w.companies[w.player.companyId]?.holdings[c.id];
      if (notable && Math.abs(surprise) > 0.08 && expected > 0) {
        pushNews(w, {
          kind: 'market',
          title: `${c.name} ${surprise > 0 ? 'beats' : 'misses'} quarterly estimates; stock ${shock > 0 ? 'jumps' : 'slides'} ${Math.abs(Math.round(shock * 100))}%`,
          body: `Revenue $${fmtShort(rev)} vs $${fmtShort(expected)} expected.`,
          companyId: c.id,
          tone: c.isPlayer ? (surprise > 0 ? 'good' : 'bad') : 'neutral',
        });
      }
      const growthGuess = c.lastQuarterRevenue > 0 ? clamp(rev / c.lastQuarterRevenue - 1, -0.3, 0.4) : 0.05;
      c.expectedQuarter = rev * (1 + growthGuess * 0.5);
    }
    c.lastQuarterRevenue = rev;
    c.quarterRevenue = 0;
  }
}

function fmtShort(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(0)}K`;
  return n.toFixed(0);
}

// ------------------------------------------------------------ IPO

export function ipoCompany(w: World, c: Company, floatFraction = 0.22): number {
  const preMoney = Math.max(1e6, c.valuation * randomInvestorAppetite(w));
  const targetPrice = randRange(w, 14, 42);
  const total = preMoney / targetPrice;
  const scale = total / c.shares;
  c.shares *= scale;
  c.founderShares *= scale;
  c.investorShares *= scale;
  for (const id in w.companies) {
    const h = w.companies[id].holdings[c.id];
    if (h) h.shares *= scale;
  }
  const newShares = (c.shares * floatFraction) / (1 - floatFraction);
  const raise = newShares * targetPrice;
  c.shares += newShares;
  c.cash += raise * 0.93;
  c.ledger.misc += raise * 0.07;
  c.isPublic = true;
  c.ipoDay = w.day;
  c.price = targetPrice;
  c.priceHistory = [[w.day, targetPrice]];
  c.expectedQuarter = c.lastQuarterRevenue * 1.05;
  pushNews(w, {
    kind: 'market',
    title: `${c.name} goes public at $${targetPrice.toFixed(2)} per share, raising $${fmtShort(raise)}`,
    body: `Valued at $${fmtShort(targetPrice * c.shares)} on its first day of trading.`,
    companyId: c.id,
    tone: c.isPlayer ? 'good' : 'major',
  });
  return raise;
}

// ------------------------------------------------------------ trading

export function tradeCost(w: World, target: Company, shares: number): { price: number; total: number } {
  const float = Math.max(1, floatShares(w, target));
  const impact = clamp((shares / float) * 0.6, -0.4, 0.6);
  const price = target.price * (1 + impact / 2);
  return { price, total: price * shares };
}

export function buyShares(w: World, buyer: Company, target: Company, shares: number): { ok: boolean; error?: string } {
  if (!target.isPublic || target.status !== 'active') return { ok: false, error: 'Not publicly traded.' };
  if (shares <= 0) return { ok: false, error: 'Enter a number of shares.' };
  if (shares > floatShares(w, target)) return { ok: false, error: 'Not enough shares available on the market.' };
  const { price, total } = tradeCost(w, target, shares);
  if (total > buyer.cash) return { ok: false, error: 'Not enough cash.' };
  buyer.cash -= total;
  const h = buyer.holdings[target.id] ?? { shares: 0, cost: 0 };
  h.shares += shares;
  h.cost += total;
  buyer.holdings[target.id] = h;
  target.price = Math.max(0.01, price);
  return { ok: true };
}

export function sellShares(w: World, seller: Company, target: Company, shares: number): { ok: boolean; error?: string } {
  const h = seller.holdings[target.id];
  if (!h || h.shares < shares || shares <= 0) return { ok: false, error: 'You do not own that many shares.' };
  const float = Math.max(1, floatShares(w, target) + h.shares);
  const impact = clamp((shares / float) * 0.6, 0, 0.5);
  const price = target.price * (1 - impact / 2);
  const proceeds = price * shares;
  const avgCost = h.cost / h.shares;
  h.shares -= shares;
  h.cost -= avgCost * shares;
  if (h.shares < 0.5) delete seller.holdings[target.id];
  seller.cash += proceeds;
  target.price = Math.max(0.01, target.price * (1 - impact / 2));
  return { ok: true };
}

// ------------------------------------------------------------ acquisitions

/** Price a buyer must pay for the target (excluding shares the buyer already owns). */
export function acquisitionPrice(_w: World, buyer: Company, target: Company, premium: number): number {
  const base = target.isPublic ? target.price * target.shares : target.valuation;
  const owned = buyer.holdings[target.id]?.shares ?? 0;
  const frac = target.shares > 0 ? 1 - owned / target.shares : 1;
  return Math.max(10000, base * premium * frac);
}

export function acquireCompany(w: World, buyer: Company, target: Company, price: number): void {
  buyer.cash -= price;
  // pay out any other holders at the deal price per share
  const perShare = price / Math.max(1, target.shares - (buyer.holdings[target.id]?.shares ?? 0));
  for (const id in w.companies) {
    const holder = w.companies[id];
    const h = holder.holdings[target.id];
    if (!h) continue;
    if (holder.id !== buyer.id) {
      holder.cash += h.shares * perShare;
      if (holder.isPlayer) {
        pushNews(w, { kind: 'finance', title: `Your ${target.name} shares were bought out for $${fmtShort(h.shares * perShare)}`, companyId: target.id, tone: h.shares * perShare > h.cost ? 'good' : 'bad' });
      }
    }
    delete holder.holdings[target.id];
  }
  // the target's own subsidiaries move under the buyer
  for (const id in w.companies) {
    const s = w.companies[id];
    if (s.parentId === target.id) s.parentId = buyer.id;
  }
  target.parentId = buyer.id;
  target.isPublic = false;
  target.founderShares = 0;
  target.investorShares = 0;
  target.distressDays = 0;
  if (buyer.isPlayer) {
    w.player.stats.acquisitions += 1;
    toast(w, `You acquired ${target.name}!`, 'good');
  }
  pushNews(w, {
    kind: 'finance',
    title: `${buyer.name} acquires ${target.name} for $${fmtShort(price)}`,
    body: `${target.name} (${target.headcount.toLocaleString()} staff) becomes a subsidiary. Deal closed ${formatDate(w.day)}.`,
    companyId: buyer.id,
    tone: buyer.isPlayer ? 'good' : 'major',
  });
}

/** Move excess cash from subsidiaries up to their parents. */
export function sweepSubsidiaries(w: World, burnOf: (c: Company) => number): void {
  for (const id in w.companies) {
    const s = w.companies[id];
    if (!s.parentId || s.status !== 'active') continue;
    const parent = w.companies[s.parentId];
    if (!parent || parent.status !== 'active') {
      s.parentId = null;
      continue;
    }
    const burn = burnOf(s);
    const excess = s.cash - burn * 6;
    if (excess > 0) {
      const amt = excess * 0.5;
      s.cash -= amt;
      parent.cash += amt;
    }
  }
}
