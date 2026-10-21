// Gaming ecosystems. Own the place people play: an operating system, a
// subscription, a marketplace, a cloud and a line of devices. Each part
// makes the others stronger and pulls users away from rival megacorps'
// platforms; owning too much of the market brings regulators and angry
// developers.
import { activeCorps } from './megacorps';
import { dlog, empireScale, execPower, featureOpen, fmtMoney, scarValue } from './dominionCore';
import { ownedCapacity } from './datacenters';
import { courtOdds } from './empire';
import { pushDecision } from './events';
import { platformUsers } from './market';
import { PLATFORM_IDS } from './constants';
import type { ActionResult, DecisionEvent, EcoPart, EcosystemState, World } from './types';
import { celebrate, clamp, earn, fanChange, playerCompany, spend, toast } from './util';
import { chance } from './rng';

const fail = (error: string): ActionResult => ({ ok: false, error });
const ok = (): ActionResult => ({ ok: true });

export const ECO_PARTS: Record<EcoPart, { name: string; blurb: string; base: number; weight: number }> = {
  os: { name: 'Operating system', blurb: 'The foundation. Licensing income, and every other part builds on it.', base: 2e9, weight: 1 },
  subscription: { name: 'Subscription', blurb: 'A monthly pass to a library of games. Steady, sticky income.', base: 1e9, weight: 0.6 },
  marketplace: { name: 'Marketplace', blurb: 'A store for everyone else’s games. You take a cut of every sale.', base: 1.5e9, weight: 0.6 },
  cloud: { name: 'Cloud platform', blurb: 'Cloud gaming and compute rented to others. Needs your own data centers or Regional Data Centers.', base: 3e9, weight: 0.5 },
  devices: { name: 'Devices', blurb: 'Controllers, headsets and handhelds that make your consoles sell better. Needs a console on sale.', base: 2.5e9, weight: 0.7 },
};

export const ECO_PART_IDS: EcoPart[] = ['os', 'subscription', 'marketplace', 'cloud', 'devices'];
export const ECO_MAX_LEVEL = 5;

/** The world's other platforms (PC stores, phones) that you compete with. */
const BASELINE_STRENGTH = 60;

export function ecoBuildCost(part: EcoPart, level: number): number {
  return Math.round(ECO_PARTS[part].base * Math.pow(3, level - 1));
}

export function ecoBuildDays(level: number): number {
  return 120 + 40 * level;
}

export function foundEcosystem(w: World, name: string): ActionResult {
  if (!featureOpen(w, 'ecosystem')) return fail('Ecosystems unlock at the Industry Giant level ($10B).');
  const d = w.player.dominion;
  if (d.ecosystem) return fail('You already have an ecosystem.');
  const clean = name.trim().slice(0, 24);
  if (!clean) return fail('Name your ecosystem.');
  const cost = ecoBuildCost('os', 1);
  if (playerCompany(w).cash < cost * 0.25) return fail(`Needs at least ${fmtMoney(cost * 0.25)} in the bank.`);
  d.ecosystem = {
    name: clean,
    founded: w.day,
    levels: { os: 0, subscription: 0, marketplace: 0, cloud: 0, devices: 0 },
    building: null,
    users: 0,
    subscribers: 0,
    subPrice: 14.99,
    cut: 0.3,
    open: true,
    dayOne: false,
    developers: 0.1,
    exclusives: [],
    partRevenue: { os: 0, subscription: 0, marketplace: 0, cloud: 0, devices: 0 },
    monthRevenue: 0,
    revenue: 0,
    promo: 1,
    invested: 0,
    history: [],
  };
  return upgradePart(w, 'os');
}

export function partBlocker(w: World, part: EcoPart): string | null {
  const e = w.player.dominion.ecosystem;
  if (!e) return 'Found your ecosystem first.';
  const next = e.levels[part] + 1;
  if (next > ECO_MAX_LEVEL) return 'Fully built.';
  if (e.building) return `${ECO_PARTS[e.building.part].name} is being built.`;
  if (part !== 'os' && e.levels.os < 1) return 'Build the operating system first.';
  if (part !== 'os' && next > e.levels.os + 1) return `Upgrade the operating system to level ${next - 1} first.`;
  if (part === 'cloud' && !w.player.infra.dataCenters.length && w.player.infra.tier < 3) return 'Needs a data center of your own or Regional Data Centers.';
  if (part === 'devices' && !w.player.ventures.consoles.some((c) => c.stage === 'live')) return 'Needs one of your consoles on sale.';
  return null;
}

export function upgradePart(w: World, part: EcoPart): ActionResult {
  const e = w.player.dominion.ecosystem;
  const blocker = partBlocker(w, part);
  if (blocker || !e) return fail(blocker ?? 'Found your ecosystem first.');
  const level = e.levels[part] + 1;
  const cost = ecoBuildCost(part, level);
  if (playerCompany(w).cash < cost * 0.25) return fail(`Needs at least ${fmtMoney(cost * 0.25)} in the bank.`);
  e.building = { part, level, start: w.day, days: Math.round(ecoBuildDays(level) * (1 - 0.2 * execPower(w, 'coo'))), cost };
  return ok();
}

export function setEcosystem(w: World, patch: { subPrice?: number; cut?: number; open?: boolean; dayOne?: boolean }): ActionResult {
  const e = w.player.dominion.ecosystem;
  if (!e) return fail('Found your ecosystem first.');
  if (patch.subPrice !== undefined) e.subPrice = Math.round(clamp(patch.subPrice, 4.99, 49.99) * 100) / 100;
  if (patch.cut !== undefined) e.cut = clamp(Math.round(patch.cut * 100) / 100, 0.05, 0.4);
  if (patch.open !== undefined) e.open = patch.open;
  if (patch.dayOne !== undefined) e.dayOne = patch.dayOne;
  return ok();
}

export function exclusiveCost(w: World, companyId: string): number {
  const c = w.companies[companyId];
  return c ? Math.round(Math.max(5e7, c.valuation * 0.3)) : 0;
}

/** Pay a studio to ship only on your platform for two years. */
export function signExclusive(w: World, companyId: string): ActionResult {
  const e = w.player.dominion.ecosystem;
  if (!e || e.levels.os < 1) return fail('Build your operating system first.');
  const c = w.companies[companyId];
  if (!c || c.status !== 'active' || c.isPlayer || c.parentId) return fail('Pick an independent studio.');
  if (e.exclusives.some((x) => x.companyId === companyId && x.until > w.day)) return fail('Already exclusive to you.');
  const cost = exclusiveCost(w, companyId);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Costs ${fmtMoney(cost)}.`);
  spend(p, 'buildout', cost);
  e.exclusives = e.exclusives.filter((x) => x.until > w.day);
  e.exclusives.push({ companyId, until: w.day + 730 });
  dlog(w, `${c.name} signs a two-year exclusive with ${e.name}.`, 'good');
  return ok();
}

// ------------------------------------------------------------ simulation

/** People who play games anywhere (all platforms). */
export function totalGamers(w: World): number {
  let t = 0;
  for (const p of PLATFORM_IDS) t += platformUsers(w, p) * 1e6;
  return t;
}

function libraryFactor(w: World, e: EcosystemState): number {
  let good = 0;
  for (const id in w.games) {
    const g = w.games[id];
    if (g.companyId === w.player.companyId && g.status === 'released' && g.criticScore >= 75 && w.day - (g.releaseDay ?? 0) < 3 * 365) good++;
  }
  const ex = e.exclusives.filter((x) => x.until > w.day).length;
  return 1 + 0.08 * Math.min(12, good) + 0.05 * Math.min(10, ex);
}

/** How attractive your platform is compared with the rest. */
export function ecoStrength(w: World, e: EcosystemState): number {
  let lv = 0;
  for (const part of ECO_PART_IDS) lv += e.levels[part] * ECO_PARTS[part].weight;
  const rep = 0.6 + playerCompany(w).reputation / 125;
  const growthScar = 1 + scarValue(w, 'ecoGrowth');
  return 2.5 * lv * Math.pow(libraryFactor(w, e), 0.7) * (e.open ? 1.15 : 1) * (0.7 + e.developers * 0.6) * (1 + 0.2 * execPower(w, 'cmo')) * rep * Math.max(0.2, growthScar);
}

function corpStrength(platformsPower: number): number {
  return 2.4 * Math.sqrt(Math.max(0, platformsPower) / 1e9);
}

export function ecosystemDaily(w: World): void {
  const e = w.player.dominion?.ecosystem;
  if (!e?.building) return;
  const b = e.building;
  const p = playerCompany(w);
  const today = b.cost / b.days;
  spend(p, 'buildout', today);
  e.invested += today;
  if (w.day - b.start < b.days) return;
  e.levels[b.part] = b.level;
  e.building = null;
  const name = `${e.name} ${ECO_PARTS[b.part].name.toLowerCase()}`;
  if (b.part === 'os' && b.level === 1) celebrate(w, `${e.name} launches!`, true);
  toast(w, `${name} level ${b.level} is live`, 'good', { category: 'studio', link: { route: 'dominion', id: 'ecosystem' } });
  dlog(w, `${name} reaches level ${b.level}.`, 'good');
}

export function ecosystemMonthly(w: World): void {
  const d = w.player.dominion;
  if (!featureOpen(w, 'ecosystem')) return;
  const gamers = totalGamers(w);
  const corps = activeCorps(w);
  const e = d.ecosystem;
  const mine = e && e.levels.os > 0 ? ecoStrength(w, e) : 0;
  let total = mine + BASELINE_STRENGTH;
  for (const c of corps) total += corpStrength(c.power.platforms);
  // rival platforms fight for the same users, and spend to win them back
  const myShare = mine / total;
  for (const c of corps) {
    const target = (gamers * corpStrength(c.power.platforms)) / total;
    c.assets.ecosystemUsers += (target - c.assets.ecosystemUsers) * 0.12;
    c.power.platforms += (c.assets.ecosystemUsers * 25 - c.power.platforms) * 0.05;
    const focus = c.persona === 'tycoon' || c.persona === 'diplomat' || c.persona === 'schemer' ? 1.5 : 1;
    if (myShare > 0.25 && c.cash > c.valuation * 0.03 && chance(w, 0.25 * focus)) {
      const spend = c.cash * 0.04;
      c.cash -= spend;
      c.power.platforms += spend * 0.35;
    }
  }
  if (!e) return;
  const p = playerCompany(w);
  const share = mine / total;
  const target = gamers * share;
  // locked-in users leave slowly
  const lockIn = 0.04 + 0.01 * (e.levels.subscription + e.levels.devices);
  e.users = Math.max(0, e.users + (target - e.users) * (target > e.users ? 0.15 : Math.max(0.03, 0.12 - lockIn)));
  // developers follow users, open platforms and fair cuts
  const devTarget = clamp(share * 2 * (e.open ? 1.2 : 0.8) * (0.3 / Math.max(0.05, e.cut)) ** 0.5, 0.02, 0.95);
  e.developers += (devTarget - e.developers) * 0.1;
  // income
  const L = e.levels;
  const lib = libraryFactor(w, e);
  const conv = L.subscription > 0 ? 0.04 * L.subscription * lib * Math.pow(15 / e.subPrice, 1.2) * (e.dayOne ? 1.35 : 1) : 0;
  e.subscribers = e.users * clamp(conv, 0, 0.5);
  const rev = {
    os: (e.users * 3 * L.os) / 3 / 12,
    subscription: e.subscribers * e.subPrice,
    marketplace: L.marketplace > 0 ? (e.users * 12 * e.developers * e.cut * (L.marketplace / 3)) / 12 : 0,
    cloud: L.cloud > 0 ? (e.users * 0.05 * 10 * (L.cloud / 3) + Math.max(0, ownedCapacity(w, false) - w.player.infra.demand) * 0.08) * (w.player.dominion.megaprojects.some((m) => m.id === 'quantumWeb' && m.stage === 'done') ? 2 : 1) : 0,
    devices: L.devices > 0 ? (e.users * 0.02 * 150 * (L.devices / 3)) / 12 : 0,
  };
  let total$ = 0;
  for (const part of ECO_PART_IDS) {
    e.partRevenue[part] = rev[part];
    total$ += rev[part];
  }
  e.monthRevenue = total$;
  e.revenue += total$;
  earn(p, 'ecosystem', total$);
  // running it costs 6% a year of what it took to build
  spend(p, 'buildout', (e.invested * 0.06) / 12);
  // putting your games in the subscription on day one costs some sales
  if (e.dayOne && L.subscription > 0) {
    const last = p.monthly[p.monthly.length - 1];
    if (last) spend(p, 'royalties', last.ledger.sales * 0.12);
  }
  e.promo = 1 + 0.6 * share * (L.os > 0 ? 1 : 0);
  e.history.push([w.day, e.users]);
  if (e.history.length > 120) e.history.shift();
  ecosystemEvents(w, e, share);
}

function ecosystemEvents(w: World, e: EcosystemState, share: number): void {
  if (w.pendingEvents.some((x) => x.kind === 'ecoDevs' || x.kind === 'ecoRegulator')) return;
  if (e.cut >= 0.28 && e.developers > 0.3 && chance(w, 0.04)) {
    pushDecision(w, {
      kind: 'ecoDevs',
      title: `Developers revolt against ${e.name}'s ${Math.round(e.cut * 100)}% cut`,
      body: `Studios are threatening to pull their games. Lower your cut to 15% (developers flock back) or hold the line (some leave, ${fanChange(playerCompany(w), -2)}).`,
      options: [
        { id: 'lower', label: 'Lower the cut to 15%', description: 'Less per sale, more developers.' },
        { id: 'hold', label: 'Hold the line', description: `Developers -25%, ${fanChange(playerCompany(w), -2)}.` },
      ],
      data: {},
      expiresDay: w.day + 21,
      defaultOption: 'lower',
    });
    return;
  }
  if (!e.open && share > 0.4 && chance(w, 0.05)) {
    const fine = Math.round(empireScale(w) * 0.01);
    pushDecision(w, {
      kind: 'ecoRegulator',
      title: `Regulators order ${e.name} to open up`,
      body: `With ${Math.round(share * 100)}% of players on your platform, regulators want rival stores allowed in. Comply (open platform, cut capped at 20%), or fight it in court (about ${Math.round(courtOdds(w) * 100)}% to win; losing means a ${fmtMoney(fine)} fine and opening anyway).`,
      options: [
        { id: 'comply', label: 'Open the platform', description: 'More developers, smaller cut.' },
        { id: 'fight', label: 'Fight in court', description: 'Win and stay closed. A good General Counsel helps.' },
      ],
      data: { fine },
      expiresDay: w.day + 30,
      defaultOption: 'comply',
    });
  }
}

export function resolveEcoDecision(w: World, ev: DecisionEvent, optionId: string): boolean {
  const e = w.player.dominion.ecosystem;
  const p = playerCompany(w);
  if (ev.kind === 'ecoDevs') {
    if (!e) return true;
    if (optionId === 'lower') {
      e.cut = 0.15;
      e.developers = Math.min(0.95, e.developers + 0.1);
    } else {
      e.developers *= 0.75;
      p.reputation = Math.max(0, p.reputation - 2);
    }
    return true;
  }
  if (ev.kind === 'ecoRegulator') {
    if (!e) return true;
    if (optionId === 'comply') {
      e.open = true;
      e.cut = Math.min(e.cut, 0.2);
    } else if (!chance(w, Math.min(0.85, courtOdds(w) + 0.15 * execPower(w, 'counsel')))) {
      spend(p, 'empire', Number(ev.data.fine));
      e.open = true;
      e.cut = Math.min(e.cut, 0.2);
      toast(w, 'You lost: your platform must open up', 'bad', { category: 'finance', link: { route: 'dominion', id: 'ecosystem' } });
    } else {
      toast(w, 'Court backs your closed platform', 'good', { category: 'finance', link: { route: 'dominion', id: 'ecosystem' } });
    }
    return true;
  }
  return false;
}

/** Your share of all gamers. */
export function ecoShare(w: World): number {
  const e = w.player.dominion.ecosystem;
  return e ? e.users / Math.max(1, totalGamers(w)) : 0;
}
