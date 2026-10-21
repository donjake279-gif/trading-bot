// Virtual gaming universes. Persistent worlds with millions of simulated
// residents and a real economy: coins dropped into the world (the faucet)
// and taken out by taxes, prices that inflate when you print too much, land
// you can sell, creators, toxicity and content that goes stale. A central-
// bank autopilot handles the routine; crises (duplication exploits, land
// bubbles) need you.
import { activeCorps } from './megacorps';
import { addScar, dlog, empireScale, execPower, featureOpen, fmtMoney, fmtPeople, scarValue } from './dominionCore';
import { onlineFleetCapacity } from './datacenters';
import { pushDecision } from './events';
import type { ActionResult, DecisionEvent, TopicId, Universe, World } from './types';
import { celebrate, clamp, earn, fanChange, newId, playerCompany, spend, toast } from './util';
import { chance, randRange } from './rng';

const fail = (error: string): ActionResult => ({ ok: false, error });
const ok = (id?: string): ActionResult => ({ ok: true, id });

export const UNIVERSE_SCALES = [
  { name: 'Shard', capacity: 1e7, cost: 2e10, days: 300 },
  { name: 'Realm', capacity: 5e7, cost: 8e10, days: 360 },
  { name: 'World', capacity: 2.5e8, cost: 3.2e11, days: 420 },
  { name: 'Metaverse', capacity: 1.25e9, cost: 1.28e12, days: 480 },
  { name: 'Omniverse', capacity: 6e9, cost: 5e12, days: 540 },
];

/** Coins per resident at a price index of 100. */
const COINS_PER_RESIDENT = 50;

export function universeCapacity(w: World, u: Universe): number {
  const fullDive = w.player.dominion.megaprojects.some((m) => m.id === 'fullDive' && m.stage === 'done') ? 2 : 1;
  return UNIVERSE_SCALES[u.scale - 1].capacity * fullDive;
}

export function createUniverse(w: World, opts: { name: string; theme: TopicId; ipId: string | null; scale: number }): ActionResult {
  if (!featureOpen(w, 'universes')) return fail('Universes unlock at the Megacorp level ($100B).');
  const scale = clamp(Math.round(opts.scale), 1, UNIVERSE_SCALES.length);
  const def = UNIVERSE_SCALES[scale - 1];
  const clean = opts.name.trim().slice(0, 32);
  if (!clean) return fail('Name your universe.');
  if (opts.ipId && w.ips[opts.ipId]?.companyId !== w.player.companyId) return fail('Pick one of your franchises.');
  const p = playerCompany(w);
  if (p.cash < def.cost * 0.25) return fail(`Needs at least ${fmtMoney(def.cost * 0.25)} in the bank.`);
  const u: Universe = {
    id: newId(w, 'uv'),
    name: clean,
    theme: opts.theme,
    ipId: opts.ipId,
    founded: w.day,
    stage: 'building',
    ready: w.day + Math.round(def.days * (1 - 0.15 * execPower(w, 'cto'))),
    cost: def.cost,
    scale,
    population: 0,
    peak: 0,
    satisfaction: 70,
    money: 0,
    prices: 100,
    inflation: 0,
    tax: 0.08,
    faucet: 0.3,
    landSold: 0,
    moderation: 1,
    toxicity: 30,
    freshness: 1,
    autopilot: true,
    rmt: false,
    monthRevenue: 0,
    revenue: 0,
    history: [],
    crisis: null,
    crisisUntil: 0,
  };
  w.player.dominion.universes.push(u);
  dlog(w, `Work begins on ${clean}, a ${def.name.toLowerCase()} for up to ${fmtPeople(def.capacity)} residents.`, 'major');
  return ok(u.id);
}

export function setUniverse(w: World, id: string, patch: { tax?: number; faucet?: number; moderation?: number; autopilot?: boolean; rmt?: boolean }): ActionResult {
  const u = w.player.dominion.universes.find((x) => x.id === id);
  if (!u || u.stage === 'closed') return fail('No such universe.');
  if (patch.tax !== undefined) u.tax = clamp(Math.round(patch.tax * 100) / 100, 0, 0.3);
  if (patch.faucet !== undefined) u.faucet = clamp(Math.round(patch.faucet * 100) / 100, 0, 2);
  if (patch.moderation !== undefined) u.moderation = clamp(Math.round(patch.moderation), 0, 3);
  if (patch.autopilot !== undefined) u.autopilot = patch.autopilot;
  if (patch.rmt !== undefined) u.rmt = patch.rmt;
  return ok();
}

export function contentDropCost(u: Universe): number {
  return Math.round(u.cost * 0.02);
}

export function contentDrop(w: World, id: string): ActionResult {
  const u = w.player.dominion.universes.find((x) => x.id === id);
  if (!u || u.stage !== 'live') return fail('Only live universes get content.');
  const cost = contentDropCost(u);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Costs ${fmtMoney(cost)}.`);
  spend(p, 'buildout', cost);
  u.freshness = 1;
  u.satisfaction = Math.min(100, u.satisfaction + 5);
  return ok();
}

export function landPrice(u: Universe): number {
  // what 1% of the world's land sells for
  return Math.max(0, u.population * 40 * (u.satisfaction / 70) * (100 / Math.max(20, u.prices)) * (1 + u.landSold));
}

export function sellLand(w: World, id: string, pct: number): ActionResult {
  const u = w.player.dominion.universes.find((x) => x.id === id);
  if (!u || u.stage !== 'live') return fail('Only live universes have land to sell.');
  const share = clamp(pct, 0.01, 0.1);
  if (u.landSold + share > 0.9) return fail('There’s almost no land left to sell.');
  const cash = landPrice(u) * share * 100;
  const p = playerCompany(w);
  earn(p, 'worlds', cash);
  u.landSold += share;
  if (u.landSold > 0.6) u.satisfaction = Math.max(0, u.satisfaction - 4);
  u.revenue += cash;
  dlog(w, `${Math.round(share * 100)}% of ${u.name}'s land sold for ${fmtMoney(cash)}.`, 'good');
  return ok();
}

export function closeUniverse(w: World, id: string): ActionResult {
  const u = w.player.dominion.universes.find((x) => x.id === id);
  if (!u || u.stage === 'closed') return fail('No such universe.');
  u.stage = 'closed';
  u.population = 0;
  playerCompany(w).reputation = Math.max(0, playerCompany(w).reputation - 4);
  return ok();
}

// ------------------------------------------------------------ simulation

/** Daily: construction only. */
export function universesDaily(w: World): void {
  const d = w.player.dominion;
  if (!d?.universes.length) return;
  const p = playerCompany(w);
  for (const u of d.universes) {
    if (u.stage !== 'building') continue;
    spend(p, 'buildout', u.cost / Math.max(1, u.ready - u.founded));
    if (w.day < u.ready) continue;
    u.stage = 'live';
    u.population = universeCapacity(w, u) * 0.02;
    u.money = u.population * COINS_PER_RESIDENT;
    celebrate(w, `${u.name} opens its doors`, true);
    toast(w, `${u.name} is live`, 'good', { category: 'studio', link: { route: 'dominion', id: 'universes' }, body: 'Residents are pouring in. The central bank autopilot is on.' });
  }
}

/** 0..1: how much of your worlds' load your spare server capacity covers. Residents lag without it. */
export function worldServerCoverage(w: World): number {
  const need = w.player.dominion.universes.reduce((s, u) => s + (u.stage === 'live' ? u.population * 0.08 : 0), 0);
  const spare = Math.max(0, onlineFleetCapacity(w) - w.player.infra.demand);
  return need > 0 ? clamp(spare / need, 0, 1) : 1;
}

/** Where a world's satisfaction is heading, and what pushes it up or down. */
export function worldMood(w: World, u: Universe, serverOk = worldServerCoverage(w)): { target: number; parts: { label: string; value: number }[] } {
  const infl = Math.max(0, u.inflation - 0.08);
  const deflation = Math.max(0, -u.inflation - 0.05);
  const parts = [
    { label: 'Fresh content', value: (u.freshness - 0.5) * 30 },
    { label: 'Toxicity', value: -u.toxicity * 0.3 },
    { label: 'Inflation', value: -Math.min(40, infl * 60) },
    { label: 'Deflation', value: -Math.min(30, deflation * 30) },
    { label: 'High taxes', value: -Math.max(0, u.tax - 0.1) * 120 },
    { label: 'Server lag', value: -(1 - serverOk) * 30 },
    { label: 'Moderation', value: u.moderation * 2 },
    { label: 'Land squeeze', value: u.landSold > 0.6 ? -6 : 0 },
    { label: 'Coin drops', value: 4 * u.faucet },
  ].filter((x) => Math.abs(x.value) >= 0.5);
  return { target: clamp(68 + parts.reduce((s, x) => s + x.value, 0), 0, 100), parts };
}

/** Weekly: residents come and go, the economy breathes. */
export function universesWeekly(w: World): void {
  const d = w.player.dominion;
  if (!featureOpen(w, 'universes')) return;
  const live = d.universes.filter((u) => u.stage === 'live');
  // rival worlds
  const corps = activeCorps(w);
  for (const c of corps) {
    const want = c.power.media / 300;
    c.assets.universePop += (want - c.assets.universePop) * 0.03;
  }
  if (!live.length) return;
  const rivalPop = corps.reduce((s, c) => s + c.assets.universePop, 0);
  const myCap = live.reduce((s, u) => s + universeCapacity(w, u), 0);
  const competition = clamp(1 - rivalPop / (rivalPop + myCap * 2 + 1), 0.35, 1);
  const serverOk = worldServerCoverage(w);
  for (const u of live) {
    const ip = u.ipId ? w.ips[u.ipId] : null;
    const fame = 1 + (ip ? Math.log10(1 + ip.fans) / 8 : 0);
    const cap = universeCapacity(w, u);
    // the economy: coins in, coins out, prices follow
    const spendRate = 10 * (0.5 + u.satisfaction / 140);
    if (u.autopilot) {
      // the central bank steers the money supply toward prices rising ~3% a year
      const years = Math.max(0, (w.day - u.ready) / 365);
      const target = COINS_PER_RESIDENT * Math.pow(1.03, years * 1.25);
      const perCapita = u.money / Math.max(1, u.population);
      if (u.tax > 0.15) u.tax = 0.15;
      u.faucet = clamp(Math.round(((spendRate * u.tax * 0.6 + 0.15 * (target - perCapita)) / 2) * 100) / 100, 0, 2);
    }
    const activity = u.population * spendRate;
    u.money = Math.max(0, u.money + u.population * u.faucet * 2 - activity * u.tax * 0.6 + (w.day < u.crisisUntil && u.crisis === 'dupe' ? u.money * 0.08 : 0));
    const fair = Math.max(1, u.population * COINS_PER_RESIDENT);
    const prevPrices = u.prices;
    u.prices = clamp(u.prices + (100 * Math.pow(u.money / fair, 0.8) - u.prices) * 0.25, 5, 5000);
    // yearly inflation, smoothed so one odd week doesn't read as hyperinflation
    const trend = 0.85 * (Math.log(1 + Math.max(-0.99, u.inflation)) / 52) + 0.15 * Math.log(u.prices / Math.max(1, prevPrices));
    u.inflation = Math.exp(trend * 52) - 1;
    u.toxicity += (45 - 12 * u.moderation + (u.rmt ? 15 : 0) + Math.log10(1 + u.population / 1e6) * 4 - u.toxicity) * 0.1;
    u.freshness = Math.max(0, u.freshness - 0.012);
    const targetSat = worldMood(w, u, serverOk).target;
    u.satisfaction += (targetSat - u.satisfaction) * 0.2;
    const desired = cap * clamp((0.15 + (0.7 * u.satisfaction) / 100) * fame * competition * (1 + scarValue(w, 'worldPop')), 0, 1);
    const before = u.population;
    u.population = Math.max(0, u.population + (desired - u.population) * (desired > u.population ? 0.05 : 0.03));
    // newcomers get starter coins and leavers take theirs: growth alone doesn't move prices
    if (before > 0) u.money *= u.population / before;
    u.peak = Math.max(u.peak, u.population);
    u.history.push([w.day, Math.round(u.population), Math.round(u.prices)]);
    if (u.history.length > 104) u.history.shift();
    if (w.day >= u.crisisUntil) u.crisis = null;
    worldEvents(w, u);
  }
}

/** Monthly: the money. */
export function universesMonthly(w: World): void {
  const d = w.player.dominion;
  if (!featureOpen(w, 'universes')) return;
  const p = playerCompany(w);
  for (const u of d.universes) {
    if (u.stage !== 'live') {
      u.monthRevenue = 0;
      continue;
    }
    const real = 100 / Math.max(20, u.prices);
    const memberships = u.population * 0.05 * 8 * (u.satisfaction / 70);
    const taxes = u.population * 2 * u.tax * 4 * real;
    const rmt = u.rmt ? (memberships + taxes) * 0.3 : 0;
    const rev = (memberships + taxes + rmt) * randRange(w, 0.95, 1.05);
    u.monthRevenue = rev;
    u.revenue += rev;
    earn(p, 'worlds', rev);
    // running costs: moderation and upkeep
    spend(p, 'buildout', u.cost * 0.004 + u.population * 0.05 * u.moderation);
    if (u.rmt && chance(w, 0.03) && !w.pendingEvents.some((e) => e.kind === 'worldRegulator')) {
      const fine = Math.round(empireScale(w) * 0.003);
      pushDecision(w, {
        kind: 'worldRegulator',
        title: `Regulators call ${u.name}'s real-money trading gambling`,
        body: `Lawmakers want real-money trading in ${u.name} shut down. Comply (ban it), or pay ${fmtMoney(fine)} in fines and keep it for now.`,
        options: [
          { id: 'ban', label: 'Ban real-money trading', description: 'Less income, less toxicity.' },
          { id: 'pay', label: `Pay the fine · ${fmtMoney(fine)}`, description: `${fanChange(playerCompany(w), -2)}.` },
        ],
        data: { worldId: u.id, cost: fine },
        expiresDay: w.day + 21,
        defaultOption: 'ban',
      });
    }
  }
}

function worldEvents(w: World, u: Universe): void {
  if (u.crisis) return;
  if (chance(w, 0.004 * (1 - 0.3 * execPower(w, 'cto'))) && !w.pendingEvents.some((e) => e.kind === 'worldDupe')) {
    u.crisis = 'dupe';
    u.crisisUntil = w.day + 21;
    pushDecision(w, {
      kind: 'worldDupe',
      title: `A duplication exploit is flooding ${u.name} with coins`,
      body: `Players found a way to copy items and coins in ${u.name}. Prices are exploding. Roll the world back a week (angry residents), wipe the duped items (furious traders), or let the market sort it out (hyperinflation).`,
      options: [
        { id: 'rollback', label: 'Roll back the world', description: 'Prices fixed; satisfaction -8, population -3%.' },
        { id: 'wipe', label: 'Wipe duped items', description: 'Money supply fixed; satisfaction -15.' },
        { id: 'ignore', label: 'Let it ride', description: 'No complaints today. Inflation tomorrow.' },
      ],
      data: { worldId: u.id },
      expiresDay: w.day + 14,
      defaultOption: 'rollback',
    });
    return;
  }
  if (u.landSold > 0.5 && chance(w, 0.006)) {
    u.crisis = 'land';
    u.crisisUntil = w.day + 60;
    u.satisfaction = Math.max(0, u.satisfaction - 12);
    toast(w, `The ${u.name} land bubble burst`, 'bad', { category: 'studio', link: { route: 'dominion', id: 'universes' }, body: 'Virtual property prices crashed and residents are angry. Selling less land prevents bubbles.' });
    dlog(w, `${u.name}'s land bubble burst.`, 'bad');
  }
}

export function resolveWorldDecision(w: World, ev: DecisionEvent, optionId: string): boolean {
  const u = w.player.dominion.universes.find((x) => x.id === ev.data.worldId);
  if (ev.kind === 'worldDupe') {
    if (!u) return true;
    const fair = u.population * COINS_PER_RESIDENT;
    if (optionId === 'rollback') {
      u.money = fair;
      u.satisfaction = Math.max(0, u.satisfaction - 8);
      u.population *= 0.97;
      u.crisisUntil = w.day;
    } else if (optionId === 'wipe') {
      u.money = fair;
      u.satisfaction = Math.max(0, u.satisfaction - 15);
      u.crisisUntil = w.day;
    } else {
      u.money *= 2.5;
      addScar(w, `${u.name} hyperinflation`, 'worldPop', -0.1, 180);
    }
    return true;
  }
  if (ev.kind === 'worldRegulator') {
    if (!u) return true;
    if (optionId === 'ban') u.rmt = false;
    else {
      spend(playerCompany(w), 'empire', Number(ev.data.cost));
      playerCompany(w).reputation = Math.max(0, playerCompany(w).reputation - 2);
    }
    return true;
  }
  return false;
}

/** Disaster helper for emergencies. */
export function crashWorld(w: World): string | null {
  const live = w.player.dominion.universes.filter((u) => u.stage === 'live');
  if (!live.length) return null;
  const u = live.reduce((a, b) => (b.population > a.population ? b : a));
  u.population *= 0.5;
  u.prices *= 3;
  u.satisfaction = Math.max(0, u.satisfaction - 25);
  return u.name;
}

export function universeSummary(w: World): string {
  const live = w.player.dominion.universes.filter((u) => u.stage === 'live');
  return `${live.length} live · ${fmtPeople(live.reduce((s, u) => s + u.population, 0))} residents`;
}

