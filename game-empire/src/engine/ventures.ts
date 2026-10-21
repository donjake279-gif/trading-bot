// Ventures: the businesses a rich studio builds beyond games. Anti-cheat and
// AI tools are sold to rival studios, consoles earn a cut of every game sold
// on them, films and theme parks cash in on your franchises. Every generation
// costs more than the last while rivals, cheat makers and AI labs keep
// getting better, faster the bigger your empire grows.
import { acSpeed, antiCheatDaily, antiCheatMonthly, cheatersDaily, signatureCost } from './anticheat';
import { aiRevenueMult, aiTrainDiscount, ecoConsoleBoost, hardwareCostMult, trainingBonus } from './dominionCore';
import { PLATFORMS, REGIONS } from './constants';
import { ownedCapacity } from './datacenters';
import { hasResearch } from './development';
import { platformUsers } from './market';
import { decreeActive, empireLevel, rivalPace } from './empire';
import type { ActionResult, AiModel, Company, ConsoleModel, ConsoleSize, Film, Game, RegionId, ThemePark, Ventures, World } from './types';
import { celebrate, clamp, earn, isPlayerGroup, needFans, newId, playerCompany, pushNews, spend, toast } from './util';
import { chance, randNormal, randRange } from './rng';

const fail = (error: string): ActionResult => ({ ok: false, error });
const ok = (): ActionResult => ({ ok: true });
const money = (n: number) => (n >= 1e12 ? `$${(n / 1e12).toFixed(2)}T` : n >= 1e9 ? `$${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`);
const vt = (w: World): Ventures => w.player.ventures;

export type VentureId = 'antiCheat' | 'films' | 'consoles' | 'parks' | 'ai';

export const VENTURES: Record<VentureId, { name: string; blurb: string; valuation: number; research?: 'antiCheat' | 'aiTools'; rep?: number }> = {
  antiCheat: { name: 'Anti-cheat', blurb: 'Build anti-cheat software, protect your online games and sell it to rival studios. Cheat makers never stop getting better.', valuation: 0, research: 'antiCheat' },
  films: { name: 'Film studio', blurb: 'Turn your hit games into movies. Big budgets, big box office, or a famous flop.', valuation: 5e8 },
  consoles: { name: 'Consoles', blurb: 'Design your own consoles. Earn on every unit and take a cut of every game sold on them.', valuation: 2e9, rep: 50 },
  parks: { name: 'Theme parks', blurb: 'Build theme parks around the world with lands for your franchises.', valuation: 5e9 },
  ai: { name: 'AI lab', blurb: 'Train ever bigger AI models. Sell them to the world and to rival studios, and speed up your own developers.', valuation: 1e10, research: 'aiTools' },
};

export function ventureBlocker(w: World, id: VentureId): string | null {
  const def = VENTURES[id];
  const p = playerCompany(w);
  if (def.research && !hasResearch(w, def.research)) return `Needs ${def.research === 'antiCheat' ? 'Anti-Cheat Systems' : 'AI-Assisted Tooling'} research.`;
  if (p.valuation < def.valuation) return `Needs a ${money(def.valuation)} valuation.`;
  if (def.rep && p.reputation < def.rep) return needFans(def.rep);
  return null;
}

/** The fees rivals pay you are halved under a consent decree. */
function decreeMult(w: World): number {
  return decreeActive(w) ? 0.5 : 1;
}

function rivalsOf(w: World): Company[] {
  const out: Company[] = [];
  for (const id in w.companies) {
    const c = w.companies[id];
    if (c.status === 'active' && !c.isPlayer && !isPlayerGroup(w, c)) out.push(c);
  }
  return out;
}

function releasedGamesOf(w: World, companyId: string): Game[] {
  const out: Game[] = [];
  for (const id in w.games) {
    const g = w.games[id];
    if (g.companyId === companyId && g.status === 'released') out.push(g);
  }
  return out;
}

// ================================================================ anti-cheat (see anticheat.ts)

export { acBuildCost, acBuildDays, acEffectiveness, antiCheatChurn, foundAntiCheat, setAntiCheat, startAntiCheatVersion } from './anticheat';

// ================================================================ consoles

export const CONSOLE_SIZES: Record<ConsoleSize, { name: string; blurb: string; powerMult: number; costMult: number; unitCost: number; refPrice: number; days: number }> = {
  handheld: { name: 'Handheld', blurb: 'Portable and cheap to make. Modest power.', powerMult: 0.75, costMult: 0.6, unitCost: 160, refPrice: 249, days: 300 },
  home: { name: 'Home console', blurb: 'The classic box under the TV.', powerMult: 1, costMult: 1, unitCost: 380, refPrice: 449, days: 420 },
  elite: { name: 'Powerhouse', blurb: 'The most powerful machine ever made. Expensive to build and to buy.', powerMult: 1.3, costMult: 1.8, unitCost: 650, refPrice: 649, days: 540 },
};

export function nextConsoleGen(w: World): number {
  return vt(w).consoles.reduce((m, c) => Math.max(m, c.gen), 0) + 1;
}

export function consoleRdCost(gen: number, size: ConsoleSize): number {
  return Math.round(4e8 * Math.pow(2.5, gen - 1) * CONSOLE_SIZES[size].costMult);
}

export function consoleDevDays(gen: number, size: ConsoleSize): number {
  return CONSOLE_SIZES[size].days + 30 * gen;
}

export function consolesInstalled(w: World): number {
  return vt(w).consoles.reduce((s, c) => s + c.installed, 0);
}

function consoleUsers(w: World): number {
  return platformUsers(w, 'console') * 1e6;
}

/** Your share of all consoles in homes, which is your share of console store fees. */
export function consoleShare(w: World): number {
  return clamp(consolesInstalled(w) / Math.max(1, consoleUsers(w)), 0, 0.7);
}

/** How your console compares with the best rival machine today. */
export function consolePowerRatio(w: World, c: ConsoleModel): number {
  return c.power / Math.max(1, vt(w).rivalPower);
}

export function designConsole(w: World, opts: { name: string; size: ConsoleSize; price: number }): ActionResult {
  const blocker = ventureBlocker(w, 'consoles');
  if (blocker) return fail(blocker);
  if (vt(w).consoles.some((c) => c.stage === 'design')) return fail('You already have a console in development.');
  const name = opts.name.trim().slice(0, 28);
  if (!name) return fail('Name your console.');
  const gen = nextConsoleGen(w);
  const rdCost = consoleRdCost(gen, opts.size);
  if (playerCompany(w).cash < rdCost * 0.2) return fail(`Needs at least ${money(rdCost * 0.2)} in the bank.`);
  const def = CONSOLE_SIZES[opts.size];
  vt(w).consoles.push({
    id: newId(w, 'cn'),
    name,
    gen,
    size: opts.size,
    stage: 'design',
    startDay: w.day,
    launchDay: w.day + consoleDevDays(gen, opts.size),
    rdCost,
    rdSpent: 0,
    power: 0,
    price: Math.round(clamp(opts.price, 49, 2999)),
    unitCost: def.unitCost,
    installed: 0,
    sold: 0,
    dailySales: 0,
    revenue: 0,
    fees: 0,
    marketingUntil: 0,
    shortageUntil: 0,
  });
  return ok();
}

export function setConsolePrice(w: World, id: string, price: number): ActionResult {
  const c = vt(w).consoles.find((x) => x.id === id);
  if (!c || c.stage === 'retired') return fail('No such console.');
  c.price = Math.round(clamp(price, 49, 2999));
  return ok();
}

export function consoleMarketingCost(c: ConsoleModel): number {
  return Math.round(c.rdCost * 0.05);
}

export function marketConsole(w: World, id: string): ActionResult {
  const c = vt(w).consoles.find((x) => x.id === id);
  if (!c || c.stage !== 'live') return fail('Only consoles on sale can be marketed.');
  if (w.day < c.marketingUntil) return fail('A campaign is already running.');
  const cost = consoleMarketingCost(c);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Costs ${money(cost)}.`);
  spend(p, 'marketing', cost);
  c.marketingUntil = w.day + 90;
  return ok();
}

export function retireConsole(w: World, id: string): ActionResult {
  const c = vt(w).consoles.find((x) => x.id === id);
  if (!c || c.stage !== 'live') return fail('Only consoles on sale can be retired.');
  c.stage = 'retired';
  c.dailySales = 0;
  return ok();
}

function consoleAppeal(w: World, c: ConsoleModel, library: number): number {
  const def = CONSOLE_SIZES[c.size];
  const p = playerCompany(w);
  const age = (w.day - c.launchDay) / 365;
  let a = Math.pow(consolePowerRatio(w, c), 1.6) * Math.pow(def.refPrice / Math.max(1, c.price), 1.3) * ecoConsoleBoost(w);
  a *= library * (0.6 + p.reputation / 125);
  if (w.day < c.marketingUntil) a *= 1.5;
  if (age < 60 / 365) a *= 1.8;
  if (age > 6) a *= 0.5;
  return a;
}

function consolesDaily(w: World): void {
  const v = vt(w);
  const p = playerCompany(w);
  // the industry's console fees today: your share comes to you
  const share = consoleShare(w);
  if (v.feePool > 0 && share > 0) {
    const fee = v.feePool * share * decreeMult(w);
    earn(p, 'hardware', fee);
    const live = v.consoles.filter((c) => c.stage !== 'design');
    for (const c of live) c.fees += fee * (c.installed / Math.max(1, consolesInstalled(w)));
  }
  v.feePool = 0;
  if (!v.consoles.length) return;

  let lib = 0;
  for (const g of releasedGamesOf(w, p.id)) if (g.platforms.includes('console') && g.criticScore >= 75 && w.day - (g.releaseDay ?? 0) < 3 * 365) lib++;
  const library = 1 + 0.06 * Math.min(10, lib);
  const demand = consoleUsers(w) / (5 * 365);
  const live = v.consoles.filter((c) => c.stage === 'live');
  const appeal = live.map((c) => consoleAppeal(w, c, library));
  const total = appeal.reduce((s, a) => s + a, 0) + 2.4;

  for (const c of v.consoles) {
    if (c.stage === 'design') {
      const today = c.rdCost / Math.max(1, c.launchDay - c.startDay);
      spend(p, 'ventures', today);
      c.rdSpent += today;
      if (w.day >= c.launchDay) launchConsole(w, c);
      continue;
    }
    c.installed *= c.stage === 'live' ? 1 - 0.0003 : 1 - 0.0008;
    if (c.stage !== 'live') continue;
    const i = live.indexOf(c);
    let units = demand * (appeal[i] / total) * randRange(w, 0.9, 1.1);
    if (w.day < c.shortageUntil) units *= 0.5;
    c.dailySales = units;
    c.sold += units;
    c.installed += units;
    const rev = units * c.price;
    c.revenue += rev;
    earn(p, 'hardware', rev);
    spend(p, 'ventures', units * c.unitCost * hardwareCostMult(w));
    c.unitCost *= 1 - 0.12 / 365;
  }
}

function launchConsole(w: World, c: ConsoleModel): void {
  const p = playerCompany(w);
  c.stage = 'live';
  c.launchDay = w.day;
  c.power = vt(w).rivalPower * CONSOLE_SIZES[c.size].powerMult * randRange(w, 0.92, 1.12);
  celebrate(w, `${c.name} launches!`, true);
  pushNews(w, { kind: 'player', title: `${p.name} launches the ${c.name}`, body: `${CONSOLE_SIZES[c.size].name}, $${c.price}.`, companyId: p.id, tone: 'good' });
  if (chance(w, 0.08)) {
    const recall = c.rdCost * 0.1;
    spend(p, 'ventures', recall);
    p.reputation = Math.max(0, p.reputation - 3);
    c.shortageUntil = w.day + 45;
    toast(w, `${c.name} launch units are overheating`, 'bad', { category: 'studio', link: { route: 'empire', id: 'consoles' }, body: `A recall costs ${money(recall)} and stock runs short for 45 days.` });
  } else {
    toast(w, `${c.name} is in stores`, 'good', { category: 'studio', link: { route: 'empire', id: 'consoles' } });
  }
}

// ================================================================ AI lab

export const AI_LAB_COST = 1e9;
export const RESEARCHER_SALARY = 25000;

export function bestModel(w: World): AiModel | null {
  const ai = w.player.ventures?.ai;
  if (!ai || !ai.models.length) return null;
  return ai.models.reduce((a, b) => (b.quality > a.quality ? b : a));
}

/** Your best model compared with rival labs': 1.2 means 20% ahead. */
export function aiLead(w: World): number {
  const m = bestModel(w);
  return m ? m.quality / Math.max(1, vt(w).aiFrontier) : 0;
}

/** Owning data centers makes training cheaper (up to 40%). */
export function computeDiscount(w: World): number {
  return Math.min(0.4, (ownedCapacity(w, false) / 2e7) * 0.4);
}

export function aiTrainCost(w: World, gen: number): number {
  return Math.round(2.5e8 * Math.pow(3, gen - 1) * (1 - computeDiscount(w)) * aiTrainDiscount(w));
}

export function aiTrainDays(gen: number): number {
  return 90 + 25 * gen;
}

export function nextModelGen(w: World): number {
  return (bestModel(w)?.gen ?? 0) + 1;
}

export function trainingOdds(w: World, gen: number): number {
  const ai = vt(w).ai;
  const staff = ai ? Math.min(0.1, ai.researchers / 5000) : 0;
  return clamp(0.92 - 0.035 * gen + staff + trainingBonus(w), 0.4, 0.97);
}

export function foundAiLab(w: World, name: string): ActionResult {
  if (vt(w).ai) return fail('You already run an AI lab.');
  const blocker = ventureBlocker(w, 'ai');
  if (blocker) return fail(blocker);
  const clean = name.trim().slice(0, 24);
  if (!clean) return fail('Name your lab.');
  const p = playerCompany(w);
  if (p.cash < AI_LAB_COST) return fail(`Founding a lab costs ${money(AI_LAB_COST)}.`);
  spend(p, 'ventures', AI_LAB_COST);
  vt(w).ai = { name: clean, founded: w.day, researchers: 100, models: [], training: null, licensing: true, licensees: [], revenue: 0, incidents: 0, dailyRevenue: 0 };
  return ok();
}

export function startTraining(w: World): ActionResult {
  const ai = vt(w).ai;
  if (!ai) return fail('Found an AI lab first.');
  if (ai.training) return fail('A model is already training.');
  const gen = nextModelGen(w);
  const cost = aiTrainCost(w, gen);
  if (playerCompany(w).cash < cost * 0.25) return fail(`Needs at least ${money(cost * 0.25)} in the bank.`);
  ai.training = { gen, start: w.day, days: aiTrainDays(gen), cost, spent: 0 };
  return ok();
}

export function hireResearchers(w: World, n: number): ActionResult {
  const ai = vt(w).ai;
  if (!ai) return fail('Found an AI lab first.');
  const signing = n * 50000;
  const p = playerCompany(w);
  if (n < 0) {
    ai.researchers = Math.max(50, ai.researchers + n);
    return ok();
  }
  if (p.cash < signing) return fail(`Signing bonuses cost ${money(signing)}.`);
  spend(p, 'ventures', signing);
  ai.researchers += n;
  return ok();
}

export function setAiLicensing(w: World, on: boolean): ActionResult {
  const ai = vt(w).ai;
  if (!ai) return fail('Found an AI lab first.');
  ai.licensing = on;
  if (!on) ai.licensees = [];
  return ok();
}

const MODEL_NAMES = ['Spark', 'Echo', 'Nova', 'Atlas', 'Oracle', 'Titan', 'Helix', 'Zenith', 'Prism', 'Infinity', 'Singularity', 'Omega'];

function aiDaily(w: World): void {
  const ai = vt(w).ai;
  const p = playerCompany(w);
  if (!ai) return;
  if (ai.training) {
    const t = ai.training;
    const today = t.cost / t.days;
    spend(p, 'ventures', today);
    t.spent += today;
    if (w.day - t.start >= t.days) {
      ai.training = null;
      if (chance(w, trainingOdds(w, t.gen))) {
        const staffQ = 4 * Math.log10(1 + ai.researchers / 100);
        const model: AiModel = { id: newId(w, 'ai'), gen: t.gen, name: `${ai.name} ${MODEL_NAMES[(t.gen - 1) % MODEL_NAMES.length]}`, quality: t.gen * 10 + randRange(w, -3, 5) + staffQ, day: w.day };
        ai.models.push(model);
        const lead = aiLead(w);
        celebrate(w, `${model.name} is live`, t.gen >= 5);
        toast(w, `${model.name} finished training`, 'good', { category: 'studio', link: { route: 'empire', id: 'ai' }, body: lead >= 1 ? `It beats every rival lab (${Math.round(lead * 100)}% of the frontier).` : `It reaches ${Math.round(lead * 100)}% of the best rival model.` });
        pushNews(w, { kind: 'player', title: `${p.name} releases ${model.name}`, companyId: p.id, tone: 'good' });
      } else {
        toast(w, `The generation ${t.gen} training run failed`, 'bad', { category: 'studio', link: { route: 'empire', id: 'ai' }, body: `${money(t.cost)} of compute is gone. More researchers improve the odds.` });
      }
    }
  }
  const m = bestModel(w);
  ai.dailyRevenue = 0;
  if (!m) return;
  const q4 = Math.pow(m.quality, 4);
  const share = q4 / (q4 + 3 * Math.pow(vt(w).aiFrontier, 4));
  const rev = (vt(w).aiMarket / 365) * share * randRange(w, 0.95, 1.05) * aiRevenueMult(w);
  ai.dailyRevenue = rev;
  ai.revenue += rev;
  earn(p, 'tech', rev);
  spend(p, 'ventures', rev * 0.3 * (1 - computeDiscount(w) / 2));
}

function aiMonthly(w: World): void {
  const ai = vt(w).ai;
  const p = playerCompany(w);
  if (!ai) return;
  spend(p, 'ventures', ai.researchers * RESEARCHER_SALARY);
  const lead = aiLead(w);
  if (ai.licensing && lead > 0) {
    const lic = new Set(ai.licensees);
    for (const c of rivalsOf(w)) {
      if (lic.has(c.id)) {
        if (lead < 0.8 && chance(w, 0.1)) {
          lic.delete(c.id);
          continue;
        }
        const fee = Math.min(c.cash * 0.1, c.headcount * 900 * clamp(lead, 0.3, 1.5)) * decreeMult(w);
        if (fee > 0) {
          c.cash -= fee;
          c.ledger.royalties += fee;
          earn(p, 'tech', fee);
          ai.revenue += fee;
        }
      } else if (c.headcount >= 10 && chance(w, 0.06 * clamp(lead, 0, 1.5) / 1.5)) {
        lic.add(c.id);
        pushNews(w, { kind: 'industry', title: `${c.name} signs up for ${ai.name}'s AI dev tools`, companyId: c.id, tone: 'neutral' });
      }
    }
    ai.licensees = [...lic];
  }
  const m = bestModel(w);
  if (m && chance(w, (0.02 * m.gen) / (1 + ai.researchers / 400))) {
    const fine = Math.max(5e6, ai.dailyRevenue * 60);
    spend(p, 'empire', fine);
    p.reputation = Math.max(0, p.reputation - 4);
    ai.incidents += 1;
    toast(w, `AI safety incident at ${ai.name}`, 'bad', { category: 'studio', link: { route: 'empire', id: 'ai' }, body: `${m.name} did something it shouldn't. Fines and clean-up cost ${money(fine)}. More researchers make incidents rarer.` });
  }
}

/** Your own developers work faster with your AI tools. */
export function aiSpeedBoost(w: World): number {
  const lead = aiLead(w);
  return lead > 0 ? 1 + (0.25 * Math.min(1.2, lead)) / 1.2 : 1;
}

/** Rival studios using your AI tools work faster too. */
export function rivalAiBoost(w: World, c: Company): number {
  return w.player.ventures?.ai?.licensees.includes(c.id) ? 1.15 : 1;
}

// ================================================================ films

export const FILM_TIERS = [
  { name: 'Indie film', budget: 2e7, days: 240, bonus: 0, mult: 1.3 },
  { name: 'Studio film', budget: 1e8, days: 360, bonus: 3, mult: 1.1 },
  { name: 'Blockbuster', budget: 3e8, days: 480, bonus: 6, mult: 1 },
  { name: 'Mega-franchise event', budget: 1e9, days: 600, bonus: 9, mult: 0.85 },
];

export function filmsOfIp(w: World, ipId: string): Film[] {
  return vt(w).films.filter((f) => f.ipId === ipId);
}

export function greenlightFilm(w: World, gameId: string, tier: number): ActionResult {
  const blocker = ventureBlocker(w, 'films');
  if (blocker) return fail(blocker);
  const g = w.games[gameId];
  const p = playerCompany(w);
  const t = FILM_TIERS[tier];
  if (!g || g.companyId !== p.id || g.status !== 'released' || !t) return fail('Pick one of your released games.');
  if (vt(w).films.filter((f) => f.stage === 'production').length >= 3) return fail('You can make 3 films at a time.');
  if (vt(w).films.some((f) => f.stage === 'production' && f.ipId === g.ipId)) return fail('A film of this franchise is already shooting.');
  if (p.cash < t.budget * 0.25) return fail(`Needs at least ${money(t.budget * 0.25)} in the bank.`);
  const n = filmsOfIp(w, g.ipId).length;
  vt(w).films.push({
    id: newId(w, 'fm'),
    title: n === 0 ? `${g.title}: The Movie` : `${g.title}: The Movie ${n + 1}`,
    gameId,
    ipId: g.ipId,
    tier,
    budget: t.budget,
    start: w.day,
    releaseDay: w.day + t.days,
    stage: 'production',
    score: 0,
    gross: 0,
    earned: 0,
  });
  return ok();
}

function ipOwners(w: World, ipId: string): number {
  const ip = w.ips[ipId];
  if (!ip) return 0;
  return ip.games.reduce((s, id) => s + (w.games[id]?.owners ?? 0), 0);
}

function releaseFilm(w: World, f: Film): void {
  const g = w.games[f.gameId];
  const t = FILM_TIERS[f.tier];
  const p = playerCompany(w);
  const sequels = filmsOfIp(w, f.ipId).filter((x) => x.stage === 'released').length;
  f.score = Math.round(clamp(30 + (g?.criticScore ?? 60) * 0.45 + t.bonus + randNormal(w, 0, 9) - 7 * sequels - 2 * Math.max(0, empireLevel(w) - 2), 5, 98));
  const fame = clamp(Math.log10(1 + ipOwners(w, f.ipId)) / 7, 0.15, 1.4);
  f.gross = Math.round(f.budget * 2.6 * t.mult * fame * Math.pow(f.score / 60, 2.5) * randRange(w, 0.7, 1.3));
  f.stage = 'released';
  f.releaseDay = w.day;
  const ip = w.ips[f.ipId];
  if (f.score >= 60) {
    if (g) g.freshness = Math.min(1, g.freshness + 0.2);
    if (ip) ip.fans *= 1 + Math.min(40, f.score - 50) / 200;
    for (const id in w.games) {
      const x = w.games[id];
      if (x.ipId === f.ipId && x.status === 'development') x.hype += 100;
    }
  }
  const hit = f.gross >= f.budget * 2;
  if (f.gross >= 1e9) celebrate(w, `${f.title} crosses $1B at the box office!`, true);
  toast(w, `${f.title} opens: ${f.score}/100 from critics`, hit ? 'good' : f.gross < f.budget ? 'bad' : 'neutral', {
    category: 'studio',
    link: { route: 'empire', id: 'films' },
    body: `Expected box office ${money(f.gross)} on a ${money(f.budget)} budget.${f.score < 45 ? ' The video game movie curse strikes again.' : ''}`,
  });
  pushNews(w, { kind: 'player', title: `${f.title} ${hit ? 'is a smash hit' : f.gross < f.budget ? 'flops' : 'opens'}`, body: `Critics ${f.score}/100. Box office ${money(f.gross)}.`, companyId: p.id, tone: hit ? 'good' : f.gross < f.budget ? 'bad' : 'neutral' });
}

function filmsDaily(w: World): void {
  const p = playerCompany(w);
  for (const f of vt(w).films) {
    if (f.stage === 'production') {
      const t = FILM_TIERS[f.tier];
      spend(p, 'ventures', f.budget / t.days);
      if (w.day < f.releaseDay) continue;
      releaseFilm(w, f);
    }
    const k = w.day - f.releaseDay;
    if (k >= 0 && k < 90 && f.earned < f.gross) {
      const today = Math.min(f.gross - f.earned, (f.gross * 2 * (90 - k)) / (90 * 91));
      f.earned += today;
      earn(p, 'entertainment', today);
    }
  }
}

// ================================================================ theme parks

export const PARK_REGION_MULT: Record<RegionId, number> = { na: 1.2, eu: 1.1, asia: 1.3, sa: 0.7, oce: 0.5 };
export const PARK_TICKET = 140;
export const PARK_UPKEEP = 8e6;
export const MAX_LANDS = 8;

export function parkCost(w: World): number {
  return Math.round(1.5e9 * Math.pow(1.6, vt(w).parks.length));
}

export function landCost(park: ThemePark): number {
  return Math.round(2.5e8 * (1 + 0.5 * park.lands.length));
}

export function buildPark(w: World, region: RegionId, name: string): ActionResult {
  const blocker = ventureBlocker(w, 'parks');
  if (blocker) return fail(blocker);
  if (!REGIONS[region]) return fail('Pick a region.');
  const clean = name.trim().slice(0, 32);
  if (!clean) return fail('Name your park.');
  const cost = parkCost(w);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Costs ${money(cost)}.`);
  spend(p, 'ventures', cost);
  vt(w).parks.push({ id: newId(w, 'pk'), name: clean, region, stage: 'building', start: w.day, openDay: w.day + 365, cost, lands: [], visitors: 0, revenue: 0, closedUntil: 0 });
  return ok();
}

export function addLand(w: World, parkId: string, ipId: string): ActionResult {
  const park = vt(w).parks.find((x) => x.id === parkId);
  const ip = w.ips[ipId];
  const p = playerCompany(w);
  if (!park) return fail('No such park.');
  if (!ip || ip.companyId !== p.id) return fail('Pick one of your franchises.');
  if (park.lands.includes(ipId)) return fail('That franchise already has a land here.');
  if (park.lands.length >= MAX_LANDS) return fail(`A park holds at most ${MAX_LANDS} lands.`);
  const cost = landCost(park);
  if (p.cash < cost) return fail(`Costs ${money(cost)}.`);
  spend(p, 'ventures', cost);
  park.lands.push(ipId);
  return ok();
}

function franchiseFame(w: World): number {
  let fans = 0;
  for (const id in w.ips) if (w.ips[id].companyId === w.player.companyId) fans += w.ips[id].fans;
  return clamp(Math.pow(fans / 1e7, 0.3), 0.5, 2.5);
}

export function parkVisitors(w: World, park: ThemePark): number {
  if (park.stage !== 'open' || w.day < park.closedUntil) return 0;
  const sameRegion = vt(w).parks.filter((x) => x.stage === 'open' && x.region === park.region).length;
  const season = 1 + 0.35 * Math.sin((2 * Math.PI * ((((w.day % 365) + 365) % 365) - 80)) / 365);
  const rep = 0.6 + playerCompany(w).reputation / 125;
  return (8000 * PARK_REGION_MULT[park.region] * (1 + 0.25 * park.lands.length) * franchiseFame(w) * season * rep) / Math.sqrt(sameRegion);
}

function parksDaily(w: World): void {
  const p = playerCompany(w);
  for (const park of vt(w).parks) {
    if (park.stage === 'building') {
      if (w.day >= park.openDay) {
        park.stage = 'open';
        celebrate(w, `${park.name} is open!`, true);
        pushNews(w, { kind: 'player', title: `${p.name} opens ${park.name}`, body: REGIONS[park.region].name, companyId: p.id, tone: 'good' });
      }
      continue;
    }
    const visitors = parkVisitors(w, park);
    park.visitors = visitors;
    const rev = visitors * PARK_TICKET;
    park.revenue += rev;
    earn(p, 'entertainment', rev);
    spend(p, 'ventures', PARK_UPKEEP / 30 + rev * 0.15);
  }
}

function parksMonthly(w: World): void {
  const p = playerCompany(w);
  for (const park of vt(w).parks) {
    if (park.stage !== 'open' || !chance(w, 0.015)) continue;
    const fine = 5e7 * (1 + empireLevel(w));
    spend(p, 'empire', fine);
    park.closedUntil = w.day + 14;
    p.reputation = Math.max(0, p.reputation - 3);
    toast(w, `A ride broke down at ${park.name}`, 'bad', { category: 'studio', link: { route: 'empire', id: 'parks' }, body: `Closed for two weeks. Fines and repairs ${money(fine)}.` });
  }
}

// ================================================================ the world moves on

/** Rivals, cheat makers and AI labs improve every day, faster the bigger you are. */
function frontiersDaily(w: World): void {
  const v = vt(w);
  const pace = 1 + rivalPace(w);
  cheatersDaily(w);
  v.rivalPower *= 1 + (0.1 / 365) * pace;
  v.aiFrontier += (6 / 365) * pace;
  v.aiMarket = Math.min(w.player.dominion?.megaprojects.some((m) => m.id === 'dysonCompute' && m.stage === 'done') ? 5e13 : 5e12, v.aiMarket * (1 + 0.25 / 365));
}

export function venturesDaily(w: World): void {
  if (!w.player.ventures) return;
  frontiersDaily(w);
  antiCheatDaily(w);
  consolesDaily(w);
  aiDaily(w);
  filmsDaily(w);
  parksDaily(w);
}

export function venturesMonthly(w: World): void {
  if (!w.player.ventures) return;
  antiCheatMonthly(w);
  aiMonthly(w);
  parksMonthly(w);
}

/** Monthly run-rate of venture income and costs right now (for dashboards and runway). */
export function ventureRunRate(w: World): { revenue: number; cost: number } {
  const v = w.player.ventures;
  let revenue = 0;
  let cost = 0;
  if (!v) return { revenue, cost };
  for (const c of v.consoles) {
    if (c.stage === 'live') {
      revenue += c.dailySales * c.price * 30;
      cost += c.dailySales * c.unitCost * 30;
    } else if (c.stage === 'design') cost += (c.rdCost / Math.max(1, c.launchDay - c.startDay)) * 30;
  }
  if (v.ai) {
    revenue += v.ai.dailyRevenue * 30;
    cost += v.ai.dailyRevenue * 30 * 0.3 * (1 - computeDiscount(w) / 2) + v.ai.researchers * RESEARCHER_SALARY;
    if (v.ai.training) cost += (v.ai.training.cost / v.ai.training.days) * 30;
  }
  const acp = v.antiCheat?.project;
  if (acp) cost += (acp.cost / acp.work) * acSpeed(w) * 30;
  if (v.antiCheat) cost += v.antiCheat.bounty + v.antiCheat.policy.appeals + (v.antiCheat.autoSig ? signatureCost(v.antiCheat) * 4 : 0);
  for (const f of v.films) {
    if (f.stage === 'production') cost += (f.budget / FILM_TIERS[f.tier].days) * 30;
    else if (w.day - f.releaseDay < 90) revenue += Math.min(f.gross - f.earned, (f.gross * 2 * Math.max(0, 90 - (w.day - f.releaseDay)) * 30) / (90 * 91));
  }
  for (const park of v.parks) {
    if (park.stage !== 'open') continue;
    const rev = park.visitors * PARK_TICKET * 30;
    revenue += rev;
    cost += PARK_UPKEEP + rev * 0.15;
  }
  return { revenue, cost };
}

/** Called by the market for every game's console revenue, before store cuts. */
export function addConsoleGross(w: World, gross: number): void {
  const v = w.player.ventures;
  if (v && v.consoles.length) v.feePool += gross * PLATFORMS.console.storeCut;
}
