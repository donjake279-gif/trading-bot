// Company cities. Found a city, lay out its districts and keep millions of
// residents happy. Districts feed the rest of the empire: desks for staff
// beyond your tower, research labs, server farms, factories, tourism and
// clean power. Push taxes too hard and the streets fill with protesters.
import { activeCorps } from './megacorps';
import { addScar, dlog, execPower, featureOpen, fmtMoney, fmtPeople, scarValue } from './dominionCore';
import { pushDecision } from './events';
import { REGIONS } from './constants';
import type { ActionResult, CompanyCity, DecisionEvent, DistrictKind, RegionId, World } from './types';
import { celebrate, clamp, earn, newId, playerCompany, pushNews, spend, toast } from './util';
import { chance, randRange } from './rng';

const fail = (error: string): ActionResult => ({ ok: false, error });
const ok = (id?: string): ActionResult => ({ ok: true, id });

export const DISTRICTS: Record<DistrictKind, { name: string; emoji: string; blurb: string; cost: number; pop: number; pollution: number }> = {
  residential: { name: 'Residential', emoji: '🏘️', blurb: 'Homes for your people: morale up across the company.', cost: 2e10, pop: 3e5, pollution: 0 },
  campus: { name: 'Campus', emoji: '🏢', blurb: '+2,500 desks per level, beyond your office tower.', cost: 4e10, pop: 6e4, pollution: 1 },
  research: { name: 'Research park', emoji: '🔬', blurb: 'Research runs 10% faster per level and AI training succeeds more often.', cost: 6e10, pop: 4e4, pollution: 1 },
  data: { name: 'Data district', emoji: '🗄️', blurb: 'Server farms: room for 80 million more players per level.', cost: 8e10, pop: 1e4, pollution: 3 },
  industry: { name: 'Industrial zone', emoji: '🏭', blurb: 'Cheaper consoles and space hardware (4% per level).', cost: 5e10, pop: 8e4, pollution: 5 },
  entertainment: { name: 'Entertainment quarter', emoji: '🎡', blurb: 'Arenas, museums and franchise stores. Tourists bring money.', cost: 4e10, pop: 5e4, pollution: 1 },
  commerce: { name: 'Business district', emoji: '🏦', blurb: 'Shops and offices. The city’s economy (and your taxes) grow.', cost: 3e10, pop: 1.5e5, pollution: 1 },
  energy: { name: 'Clean energy', emoji: '⚡', blurb: 'Cheaper power for data centers and a happier, cleaner city.', cost: 5e10, pop: 1e4, pollution: -4 },
  spaceport: { name: 'City spaceport', emoji: '🚀', blurb: 'Launches from downtown: space construction 5% cheaper per level. Needs your spaceport.', cost: 1e11, pop: 2e4, pollution: 3 },
};

export const DISTRICT_KINDS = Object.keys(DISTRICTS) as DistrictKind[];
export const DISTRICT_MAX = 3;

export function cityCost(w: World): number {
  return Math.round(1.5e11 * Math.pow(1.8, w.player.dominion.cities.length));
}

export function districtCost(w: World, kind: DistrictKind, level: number): number {
  return Math.round(DISTRICTS[kind].cost * Math.pow(2, level - 1) * (1 - 0.15 * execPower(w, 'coo')));
}

export function expandCost(c: CompanyCity): number {
  return Math.round(1e11 * Math.pow(1.6, (c.slots - 6) / 3));
}

export function foundCity(w: World, name: string, region: RegionId): ActionResult {
  if (!featureOpen(w, 'cities')) return fail('Cities unlock at the Trillion-Dollar Empire level ($1T).');
  if (!REGIONS[region]) return fail('Pick a region.');
  const clean = name.trim().slice(0, 32);
  if (!clean) return fail('Name your city.');
  const cost = cityCost(w);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Founding a city costs ${fmtMoney(cost)}.`);
  spend(p, 'buildout', cost);
  const c: CompanyCity = {
    id: newId(w, 'ct'),
    name: clean,
    region,
    founded: w.day,
    ready: w.day + 540,
    slots: 6,
    districts: [],
    population: 0,
    happiness: 65,
    unrest: 0,
    tax: 0.12,
    services: 2,
    autopilot: true,
    invested: cost,
    monthRevenue: 0,
    revenue: 0,
    troubleUntil: 0,
    history: [],
  };
  w.player.dominion.cities.push(c);
  dlog(w, `Groundbreaking for ${clean} in ${REGIONS[region].name}. Ready in 18 months.`, 'major');
  return ok(c.id);
}

export function buildDistrict(w: World, cityId: string, kind: DistrictKind): ActionResult {
  const c = w.player.dominion.cities.find((x) => x.id === cityId);
  if (!c) return fail('No such city.');
  if (c.districts.length >= c.slots) return fail('No free plots. Expand the city.');
  if (kind === 'spaceport' && !w.player.dominion.space.assets.some((a) => a.kind === 'spaceport' && a.stage === 'active')) return fail('Needs your own spaceport first.');
  const cost = districtCost(w, kind, 1);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Costs ${fmtMoney(cost)}.`);
  spend(p, 'buildout', cost);
  c.invested += cost;
  c.districts.push({ id: newId(w, 'ds'), kind, level: 1, ready: Math.max(c.ready, w.day + 180) });
  return ok();
}

export function upgradeDistrict(w: World, cityId: string, districtId: string): ActionResult {
  const c = w.player.dominion.cities.find((x) => x.id === cityId);
  const d = c?.districts.find((x) => x.id === districtId);
  if (!c || !d) return fail('No such district.');
  if (d.level >= DISTRICT_MAX) return fail('Fully developed.');
  if (w.day < d.ready) return fail('Still under construction.');
  const cost = districtCost(w, d.kind, d.level + 1);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Costs ${fmtMoney(cost)}.`);
  spend(p, 'buildout', cost);
  c.invested += cost;
  d.level += 1;
  d.ready = w.day + 150;
  return ok();
}

export function demolishDistrict(w: World, cityId: string, districtId: string): ActionResult {
  const c = w.player.dominion.cities.find((x) => x.id === cityId);
  if (!c) return fail('No such city.');
  c.districts = c.districts.filter((x) => x.id !== districtId);
  return ok();
}

export function expandCity(w: World, cityId: string): ActionResult {
  const c = w.player.dominion.cities.find((x) => x.id === cityId);
  if (!c) return fail('No such city.');
  const arcology = w.player.dominion.megaprojects.some((m) => m.id === 'arcologies' && m.stage === 'done');
  if (c.slots >= (arcology ? 18 : 12)) return fail(arcology ? 'The city has reached its limits.' : 'At its limit. The Arcology Network megaproject allows more.');
  const cost = expandCost(c);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Costs ${fmtMoney(cost)}.`);
  spend(p, 'buildout', cost);
  c.invested += cost;
  c.slots += 3;
  return ok();
}

export function setCity(w: World, cityId: string, patch: { tax?: number; services?: number; autopilot?: boolean }): ActionResult {
  const c = w.player.dominion.cities.find((x) => x.id === cityId);
  if (!c) return fail('No such city.');
  if (patch.tax !== undefined) c.tax = clamp(Math.round(patch.tax * 100) / 100, 0, 0.4);
  if (patch.services !== undefined) c.services = clamp(Math.round(patch.services), 0, 3);
  if (patch.autopilot !== undefined) c.autopilot = patch.autopilot;
  return ok();
}

// ------------------------------------------------------------ simulation

function levelSum(c: CompanyCity, kind: DistrictKind, day: number): number {
  let t = 0;
  for (const d of c.districts) if (d.kind === kind && day >= d.ready) t += d.level;
  return t;
}

export function cityLevels(w: World, kind: DistrictKind): number {
  let t = 0;
  for (const c of w.player.dominion?.cities ?? []) if (w.day >= c.ready) t += levelSum(c, kind, w.day);
  return t;
}

const DISASTERS: Record<RegionId, string[]> = {
  na: ['A hurricane', 'Wildfires', 'A blizzard'],
  eu: ['Floods', 'A heatwave', 'A storm'],
  asia: ['An earthquake', 'A typhoon', 'Floods'],
  sa: ['Mudslides', 'Floods', 'An earthquake'],
  oce: ['Bushfires', 'A cyclone', 'Floods'],
};

export function citiesMonthly(w: World): void {
  const d = w.player.dominion;
  if (!featureOpen(w, 'cities')) return;
  const p = playerCompany(w);
  const fusion = d.megaprojects.some((m) => m.id === 'fusionGrid' && m.stage === 'done');
  const arcology = d.megaprojects.some((m) => m.id === 'arcologies' && m.stage === 'done');
  for (const c of d.cities) {
    if (w.day < c.ready) {
      c.history.push([w.day, 0]);
      continue;
    }
    if (c.history.length && c.history[c.history.length - 1][1] === 0 && c.population === 0) {
      celebrate(w, `${c.name} opens its gates`, true);
      toast(w, `${c.name} is open`, 'good', { category: 'studio', link: { route: 'dominion', id: 'cities' }, body: 'Build districts to grow it.' });
    }
    let target = 5e4;
    let pollution = 0;
    for (const dist of c.districts) {
      if (w.day < dist.ready) continue;
      target += DISTRICTS[dist.kind].pop * dist.level;
      pollution += DISTRICTS[dist.kind].pollution * dist.level;
    }
    if (arcology) target *= 2;
    const ent = levelSum(c, 'entertainment', w.day);
    const energy = levelSum(c, 'energy', w.day);
    const commerce = levelSum(c, 'commerce', w.day);
    // happiness: services, taxes, fun, clean air
    const targetHappy = clamp(55 + 7 * c.services - 120 * Math.max(0, c.tax - 0.12) + 3 * ent + 2 * energy - Math.max(0, pollution) * 1.5 + (fusion ? 5 : 0) + scarValue(w, 'cityHappiness'), 0, 100);
    c.happiness += (targetHappy - c.happiness) * 0.3;
    c.population += (target * (0.6 + c.happiness / 250) - c.population) * 0.12;
    c.unrest = clamp(c.unrest + (50 - c.happiness) / 6 - (c.happiness > 60 ? 4 : 0), 0, 100);
    // autopilot: the mayor's office keeps the peace
    if (c.autopilot) {
      if (c.unrest > 45) {
        c.tax = Math.max(0.05, c.tax - 0.02);
        c.services = Math.min(3, c.services + 1);
      } else if (c.unrest < 15 && c.happiness > 70) c.tax = Math.min(0.18, c.tax + 0.01);
    }
    const servicesCost = c.population * 30 * c.services;
    const upkeep = (c.invested * 0.02) / 12 * (1 - 0.08 * energy);
    spend(p, 'buildout', servicesCost + upkeep);
    let rev = 0;
    if (w.day >= c.troubleUntil) {
      const gdp = (c.population * 4000 * (1 + 0.15 * commerce) * (0.6 + c.happiness / 250)) / 12;
      const tourism = ent * 5e8 * (0.6 + p.reputation / 125) * randRange(w, 0.9, 1.1);
      rev = gdp * c.tax + tourism + c.population * 25;
    }
    c.monthRevenue = rev;
    c.revenue += rev;
    earn(p, 'cities', rev);
    c.history.push([w.day, c.population]);
    if (c.history.length > 120) c.history.shift();
    cityEvents(w, c);
  }
  // rival megacorps found cities too
  for (const corp of activeCorps(w)) {
    if (chance(w, corp.persona === 'tycoon' ? 0.04 : 0.012) && corp.cash > 3e11) {
      corp.cash -= 2e11;
      corp.assets.cities += 1;
      for (const s in corp.power) corp.power[s as keyof typeof corp.power] *= 1.01;
      pushNews(w, { kind: 'industry', title: `${corp.name} founds a company city`, tone: 'neutral' });
      dlog(w, `${corp.name} founds a company city (${corp.assets.cities} so far).`);
    }
  }
}

function cityEvents(w: World, c: CompanyCity): void {
  if (c.unrest >= 70 && w.day >= c.troubleUntil && !w.pendingEvents.some((e) => e.kind === 'cityRiot')) {
    pushDecision(w, {
      kind: 'cityRiot',
      title: `Protests in ${c.name}`,
      body: `Residents of ${c.name} are in the streets over taxes and services (unrest ${Math.round(c.unrest)}). Make concessions (tax -5 points, services +1), or crack down (unrest drops fast, but reputation -5 and it can backfire).`,
      options: [
        { id: 'concede', label: 'Make concessions', description: 'Less tax income, a calmer city.' },
        { id: 'crackdown', label: 'Crack down', description: 'Reputation -5. 30% chance of riots: no income for 2 months.' },
      ],
      data: { cityId: c.id },
      expiresDay: w.day + 21,
      defaultOption: 'concede',
    });
  }
  if (chance(w, 0.006)) {
    const p = playerCompany(w);
    const what = DISASTERS[c.region][Math.floor(randRange(w, 0, 2.999))];
    const services = c.services;
    const days = Math.round(randRange(w, 20, 70) * (1 - 0.15 * services));
    const repair = c.invested * 0.03;
    c.troubleUntil = Math.max(c.troubleUntil, w.day + days);
    spend(p, 'buildout', repair);
    toast(w, `${what} hits ${c.name}`, 'bad', { category: 'studio', link: { route: 'dominion', id: 'cities' }, body: `Repairs cost ${fmtMoney(repair)}; the city earns nothing for ${days} days. Good public services shorten it.` });
    dlog(w, `${what} hit ${c.name}.`, 'bad');
  }
}

export function resolveCityDecision(w: World, ev: DecisionEvent, optionId: string): boolean {
  if (ev.kind !== 'cityRiot') return false;
  const c = w.player.dominion.cities.find((x) => x.id === ev.data.cityId);
  const p = playerCompany(w);
  if (!c) return true;
  if (optionId === 'concede') {
    c.tax = Math.max(0, c.tax - 0.05);
    c.services = Math.min(3, c.services + 1);
    c.unrest = Math.max(0, c.unrest - 25);
  } else {
    p.reputation = Math.max(0, p.reputation - 5);
    c.unrest = Math.max(0, c.unrest - 40);
    if (chance(w, 0.3)) {
      c.troubleUntil = w.day + 60;
      addScar(w, `Riots in ${c.name}`, 'cityHappiness', -8, 365);
      pushNews(w, { kind: 'player', title: `Riots in ${c.name} after a crackdown`, companyId: p.id, tone: 'bad' });
      toast(w, `The crackdown backfired: riots in ${c.name}`, 'bad', { category: 'studio', link: { route: 'dominion', id: 'cities' } });
    }
  }
  return true;
}

export function citySummary(w: World): string {
  const cs = w.player.dominion.cities;
  const pop = cs.reduce((s, c) => s + c.population, 0);
  return `${cs.length} cit${cs.length === 1 ? 'y' : 'ies'} · ${fmtPeople(pop)} residents`;
}
