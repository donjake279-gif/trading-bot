// Business management: company policies, investments, publishing deals with
// independent studios, licensing income, GameExpo, seasonal sales and rivals.
import { BENEFITS, EXPO_BOOTHS, GENRES, MONETIZATIONS, SCOPE_IDS, retainerCost } from './constants';
import { saleActive, saleEndDay, parts, EXPO_DATE, SUMMER_SALE, HOLIDAY_SALE } from './calendar';
import { addXp, perkRank } from './progression';
import { marketCap } from './stocks';
import type { ActionResult, BenefitsPolicy, Company, Game, HoursPolicy, Policies, QaPolicy, World } from './types';
import { activeCompanies, earn, gamesOf, hashString, newId, playerCompany, pushNews, spend, toast } from './util';

// ------------------------------------------------------------ policies

export function policyMonthlyCost(w: World, policies: Policies = w.player.policies): number {
  const heads = w.player.employees.length;
  let cost = BENEFITS[policies.benefits].perHead * heads;
  if (policies.retainer) cost += retainerCost(heads);
  return cost;
}

export function setPolicies(w: World, patch: Partial<{ benefits: BenefitsPolicy; hours: HoursPolicy; qa: QaPolicy; profitSharing: boolean; retainer: boolean }>): ActionResult {
  Object.assign(w.player.policies, patch);
  return { ok: true };
}

export function policiesDaily(w: World): void {
  const p = playerCompany(w);
  const pol = w.player.policies;
  const heads = w.player.employees.length;
  spend(p, 'perks', (BENEFITS[pol.benefits].perHead * heads) / 30);
  if (pol.retainer) {
    spend(p, 'marketing', retainerCost(heads) / 30);
    for (const g of gamesOf(w, p.id)) if (g.status === 'development') g.hype = Math.min(1400, g.hype + 0.8);
  }
}

/** Monthly: profit sharing pays out 5% of a profitable month to the team. */
export function profitSharingMonthly(w: World, monthProfit: number): void {
  if (!w.player.policies.profitSharing || monthProfit <= 0) return;
  const p = playerCompany(w);
  const payout = monthProfit * 0.05;
  spend(p, 'perks', payout);
  for (const e of w.player.employees) if (!e.isFounder) e.morale = Math.min(100, e.morale + 8);
}

// ------------------------------------------------------------ investments

export function investmentValue(w: World): number {
  const inv = w.player.investments;
  return inv.bonds + inv.indexUnits * w.market.index;
}

export function moveBonds(w: World, amount: number): ActionResult {
  const p = playerCompany(w);
  const inv = w.player.investments;
  if (amount > 0) {
    if (p.cash < amount) return { ok: false, error: 'Not enough cash.' };
    p.cash -= amount;
    inv.bonds += amount;
  } else {
    const take = Math.min(-amount, inv.bonds);
    if (take <= 0) return { ok: false, error: 'No bonds to sell.' };
    inv.bonds -= take;
    p.cash += take;
  }
  return { ok: true };
}

export function tradeIndexFund(w: World, amount: number): ActionResult {
  const p = playerCompany(w);
  const inv = w.player.investments;
  const price = w.market.index;
  if (amount > 0) {
    if (p.cash < amount) return { ok: false, error: 'Not enough cash.' };
    const units = (amount * 0.997) / price;
    p.cash -= amount;
    inv.indexUnits += units;
    inv.indexCost += amount;
  } else {
    const value = inv.indexUnits * price;
    const sell = Math.min(-amount, value);
    if (sell <= 0) return { ok: false, error: 'You hold no index fund units.' };
    const units = sell / price;
    const costShare = inv.indexUnits > 0 ? (inv.indexCost * units) / inv.indexUnits : 0;
    inv.indexUnits -= units;
    inv.indexCost -= costShare;
    p.cash += sell * 0.997;
    if (inv.indexUnits < 1e-9) {
      inv.indexUnits = 0;
      inv.indexCost = 0;
    }
  }
  return { ok: true };
}

export function investmentsDaily(w: World): void {
  const inv = w.player.investments;
  if (inv.bonds > 0) earn(playerCompany(w), 'investments', (inv.bonds * Math.max(0.005, w.market.baseRate - 0.005)) / 365);
}

// ------------------------------------------------------------ publishing

export const MAX_PUBLISHING_DEALS = 5;

/** Terms an independent studio would accept to let you publish its game. */
export function publishingTerms(w: World, g: Game): { price: number; share: number } {
  const c = w.companies[g.companyId];
  const h = hashString(g.id);
  const share = 0.2 + (h % 16) / 100;
  const base = g.budget * 0.5 + g.workRequired * 140;
  const price = Math.round((base * (0.7 + c.talent / 100) * (0.8 + share)) / 1000) * 1000;
  return { price: Math.max(5000, price), share };
}

export function publishingOpportunities(w: World): Game[] {
  const taken = new Set(w.player.publishing.map((d) => d.gameId));
  const out: Game[] = [];
  for (const c of activeCompanies(w)) {
    if (c.isPlayer || c.parentId || c.headcount > 300) continue;
    for (const g of gamesOf(w, c.id)) {
      if (g.status !== 'development' || taken.has(g.id) || g.publisherCut > 0) continue;
      const idx = SCOPE_IDS.indexOf(g.scope);
      if (idx < 1 || idx > 3 || g.workDone / g.workRequired > 0.85) continue;
      out.push(g);
    }
  }
  return out.sort((a, b) => b.hype - a.hype).slice(0, 12);
}

export function fundPublishing(w: World, gameId: string): ActionResult {
  if (w.player.publishing.length >= MAX_PUBLISHING_DEALS) return { ok: false, error: `You can publish at most ${MAX_PUBLISHING_DEALS} outside games at once.` };
  const g = w.games[gameId];
  if (!g || g.status !== 'development') return { ok: false, error: 'That game is no longer available.' };
  const p = playerCompany(w);
  const { price, share } = publishingTerms(w, g);
  if (p.cash < price) return { ok: false, error: 'Not enough cash.' };
  const studio = w.companies[g.companyId];
  p.cash -= price;
  p.ledger.misc += price;
  studio.cash += price;
  g.publisherCut = share;
  g.hype = Math.min(1400, g.hype + 40);
  w.player.publishing.push({ id: newId(w, 'pub'), gameId, companyId: studio.id, title: g.title, share, paid: price, earned: 0, startDay: w.day });
  pushNews(w, { kind: 'finance', title: `${p.name} will publish ${studio.name}'s ${g.title}`, companyId: p.id, gameId, tone: 'neutral' });
  return { ok: true };
}

export function publishingDaily(w: World): void {
  for (const d of [...w.player.publishing]) {
    const g = w.games[d.gameId];
    if (!g || g.status === 'cancelled') {
      w.player.publishing = w.player.publishing.filter((x) => x.id !== d.id);
      toast(w, `${d.title} was cancelled: your publishing money is gone`, 'bad', { category: 'finance', link: { route: 'finance' } });
    } else if (g.status === 'shutdown' || g.status === 'retired') {
      w.player.publishing = w.player.publishing.filter((x) => x.id !== d.id);
      w.player.flags.publishingEarned = (w.player.flags.publishingEarned ?? 0) + d.earned;
      toast(w, `Publishing deal for ${d.title} ended: earned $${Math.round(d.earned).toLocaleString()} on $${d.paid.toLocaleString()}`, d.earned >= d.paid ? 'good' : 'neutral', { category: 'finance', link: { route: 'finance' } });
    }
  }
}

// ------------------------------------------------------------ licensing

export function licensesMonthly(w: World): void {
  const p = playerCompany(w);
  for (const l of w.player.licenses) {
    earn(p, 'licensing', l.monthly);
    l.monthsLeft -= 1;
  }
  const ended = w.player.licenses.filter((l) => l.monthsLeft <= 0);
  w.player.licenses = w.player.licenses.filter((l) => l.monthsLeft > 0);
  for (const l of ended) toast(w, `Licensing deal ended: ${l.label}`, 'neutral', { category: 'finance', silent: true });
}

// ------------------------------------------------------------ GameExpo

export function bookExpo(w: World, tier: number): ActionResult {
  const booth = EXPO_BOOTHS[tier];
  if (!booth || tier === 0) return { ok: false, error: 'Pick a booth.' };
  const p = playerCompany(w);
  const { year, month, date } = parts(w.day);
  const expoPassed = month > EXPO_DATE[0] || (month === EXPO_DATE[0] && date >= EXPO_DATE[1]);
  const expoYear = expoPassed ? year + 1 : year;
  const current = w.player.expoBooking?.year === expoYear ? w.player.expoBooking.tier : 0;
  if (tier <= current) return { ok: false, error: 'You already booked that or better.' };
  const cost = booth.cost - EXPO_BOOTHS[current].cost;
  if (p.cash < cost) return { ok: false, error: 'Not enough cash.' };
  spend(p, 'marketing', cost);
  w.player.expoBooking = { year: expoYear, tier };
  return { ok: true };
}

export function expoDaily(w: World): void {
  const { year, month, date } = parts(w.day);
  const p = playerCompany(w);
  if (month === 4 && date === 1 && w.player.expoBooking?.year !== year) {
    toast(w, `GameExpo ${year} is in June`, 'neutral', { category: 'industry', link: { route: 'goals' }, body: 'Book a booth to show off your games in development.' });
  }
  if (month !== EXPO_DATE[0] || date !== EXPO_DATE[1]) return;
  pushNews(w, { kind: 'industry', title: `GameExpo ${year} opens its doors`, body: 'Studios unveil their biggest upcoming games.', tone: 'major' });
  for (const c of activeCompanies(w)) {
    if (c.isPlayer || c.headcount < 150) continue;
    for (const g of gamesOf(w, c.id)) if (g.status === 'development' && g.hype > 50) g.hype = Math.min(1400, g.hype * 1.15);
  }
  const booking = w.player.expoBooking;
  if (!booking || booking.year !== year || booking.tier === 0) return;
  const booth = EXPO_BOOTHS[booking.tier];
  const eff = (1 + p.reputation / 150) * (1 + 0.12 * perkRank(w, 'marketing'));
  let shown = 0;
  for (const g of gamesOf(w, p.id)) {
    if (g.status === 'development') {
      g.hype = Math.min(1400, g.hype + booth.hype * eff);
      shown++;
    } else if (g.status === 'released' && g.active > 0) {
      g.viralMult = Math.max(g.viralMult, 1.25);
      g.viralUntil = Math.max(g.viralUntil, w.day + 14);
    }
  }
  p.reputation = Math.min(100, p.reputation + booking.tier);
  addXp(w, 30 * booking.tier);
  toast(w, `Your ${booth.name} at GameExpo was a hit`, 'good', { category: 'industry', body: shown ? `${shown} game${shown > 1 ? 's' : ''} in development gained hype.` : 'Your live games got extra attention.' });
}

// ------------------------------------------------------------ seasonal sales

export function joinSale(w: World, pct: number): ActionResult {
  const sale = saleActive(w.day);
  if (!sale) return { ok: false, error: 'No seasonal sale is running.' };
  const until = saleEndDay(w.day);
  let n = 0;
  for (const g of gamesOf(w, w.player.companyId)) {
    if (g.status !== 'released' || !MONETIZATIONS[g.monetization].upfront) continue;
    g.discount = pct;
    g.discountUntil = until;
    n++;
  }
  return n ? { ok: true } : { ok: false, error: 'You have no premium games to discount.' };
}

export function salesDaily(w: World): void {
  const { month, date } = parts(w.day);
  const soon = (md: [number, number]) => month === md[0] && date === md[1] - 3;
  if (soon(SUMMER_SALE.start) || soon(HOLIDAY_SALE.start)) {
    const hasPremium = gamesOf(w, w.player.companyId).some((g) => g.status === 'released' && MONETIZATIONS[g.monetization].upfront);
    if (hasPremium) toast(w, `The ${soon(SUMMER_SALE.start) ? 'Summer' : 'Holiday'} Sale starts in 3 days`, 'neutral', { category: 'market', link: { route: 'dashboard' }, body: 'Discounted games sell much better during the sale.' });
  }
  if (saleActive(w.day) && !saleActive(w.day - 1)) {
    pushNews(w, { kind: 'market', title: `The ${saleActive(w.day) === 'summer' ? 'Summer' : 'Holiday'} Sale is live`, body: 'Players flock to storefronts hunting for bargains.', tone: 'major' });
  }
}

// ------------------------------------------------------------ rival

export function updateRival(w: World): void {
  const p = playerCompany(w);
  const myGenres = new Set(gamesOf(w, p.id).map((g) => g.genre));
  const myValue = Math.max(1, marketCap(p));
  let best: Company | null = null;
  let bestScore = -Infinity;
  for (const c of activeCompanies(w)) {
    if (c.isPlayer || c.parentId === p.id) continue;
    const ratio = Math.max(1, marketCap(c)) / myValue;
    const closeness = -Math.abs(Math.log(ratio));
    const overlap = c.specialties.filter((s) => myGenres.has(s)).length;
    const score = closeness + overlap * 0.6 + (ratio > 1 ? 0.3 : 0);
    if (score > bestScore) {
      best = c;
      bestScore = score;
    }
  }
  if (best && best.id !== w.player.rivalId) {
    const first = w.player.rivalId === null;
    w.player.rivalId = best.id;
    if (!first) {
      toast(w, `New rival: ${best.name}`, 'neutral', { category: 'industry', link: { route: 'company', id: best.id }, body: `They make ${best.specialties.map((s) => GENRES[s].name).join(', ')} games and are close to your size.` });
    }
  }
}
