// Data centers you own. Buy a building (from a server closet up to a
// hyperscale campus), wait for construction, expand it, upgrade six systems
// (floor space, power, cooling, network, backup power, security) and fill it
// with servers. Owned hardware costs more up front than renting cloud nodes
// but far less each month, and good buildings make games run smoother.
// Hardware wears out over the years and can be refreshed.
import { cityServerCapacity, energyMult } from './dominionCore';
import {
  DC_BUILDINGS,
  DC_MAX_UPGRADE,
  ELECTRICITY_PER_KW,
  OWNED_BANDWIDTH,
  REGIONS,
  RESEARCH,
  SERVER_MODELS,
  SERVER_MODEL_IDS,
  SERVER_TIERS,
  dcUpgradeCost,
} from './constants';
import { hasResearch } from './development';
import { addXp } from './progression';
import { chance, pick, randInt } from './rng';
import type { ActionResult, DataCenter, DcUpgradeId, RegionId, ServerModelId, World } from './types';
import { newId, playerCompany, pushNews, pushPoint, spend, toast } from './util';

export const MAX_DATA_CENTERS = 8;

// ------------------------------------------------------------ measurements

export function dcSlots(dc: DataCenter): number {
  return Math.floor(DC_BUILDINGS[dc.building].slots * (1 + 0.25 * dc.upgrades.space));
}

export function dcPowerCap(dc: DataCenter): number {
  return DC_BUILDINGS[dc.building].power * (1 + 0.25 * dc.upgrades.power);
}

export function dcUsedSlots(dc: DataCenter): number {
  let t = 0;
  for (const m of SERVER_MODEL_IDS) t += dc.servers[m] * SERVER_MODELS[m].slots;
  return t;
}

export function dcPowerDraw(dc: DataCenter): number {
  let t = 0;
  for (const m of SERVER_MODEL_IDS) t += dc.servers[m] * SERVER_MODELS[m].power;
  return t;
}

export function dcServerCount(dc: DataCenter): number {
  let t = 0;
  for (const m of SERVER_MODEL_IDS) t += dc.servers[m];
  return t;
}

export function dcReady(w: World, dc: DataCenter): boolean {
  return w.day >= dc.readyDay;
}

export function dcOnline(w: World, dc: DataCenter): boolean {
  return dcReady(w, dc) && w.day >= dc.offlineUntil;
}

/** Players this building could host when running. */
export function dcCapacity(dc: DataCenter): number {
  let t = 0;
  for (const m of SERVER_MODEL_IDS) t += dc.servers[m] * SERVER_MODELS[m].capacity;
  return t;
}

/** How smooth games feel on this building's hardware, 0..1. */
export function dcPerformance(dc: DataCenter): number {
  const cap = dcCapacity(dc);
  if (cap <= 0) return 0;
  let p = 0;
  for (const m of SERVER_MODEL_IDS) p += dc.servers[m] * SERVER_MODELS[m].capacity * SERVER_MODELS[m].perf;
  return Math.max(0, Math.min(1, p / cap + 0.04 * dc.upgrades.network - 0.15 * dc.wear));
}

export function dcServerValue(dc: DataCenter): number {
  let t = 0;
  for (const m of SERVER_MODEL_IDS) t += dc.servers[m] * SERVER_MODELS[m].cost;
  return t;
}

/** Monthly running cost of one building: rent, server upkeep, electricity. */
export function dcMonthlyCost(w: World, dc: DataCenter): number {
  if (!dcReady(w, dc)) return 0;
  let upkeep = 0;
  for (const m of SERVER_MODEL_IDS) upkeep += dc.servers[m] * SERVER_MODELS[m].upkeep;
  return DC_BUILDINGS[dc.building].rent + upkeep + dcPowerDraw(dc) * ELECTRICITY_PER_KW * energyMult(w);
}

export function ownedCapacity(w: World, onlineOnly = true): number {
  let t = cityServerCapacity(w);
  for (const dc of w.player.infra.dataCenters ?? []) if (onlineOnly ? dcOnline(w, dc) : dcReady(w, dc)) t += dcCapacity(dc);
  return t;
}

export function ownedMonthlyCost(w: World): number {
  let t = 0;
  for (const dc of w.player.infra.dataCenters ?? []) t += dcMonthlyCost(w, dc);
  return t;
}

/** Bandwidth per player-day on your own network, weighted by capacity. */
export function ownedBandwidthRate(w: World): number {
  let cap = 0;
  let net = 0;
  for (const dc of w.player.infra.dataCenters ?? []) {
    if (!dcOnline(w, dc)) continue;
    const c = dcCapacity(dc);
    cap += c;
    net += c * dc.upgrades.network;
  }
  const avgNet = cap > 0 ? net / cap : 0;
  return OWNED_BANDWIDTH * (1 - 0.08 * avgNet);
}

/** Distinct regions with a running data center. */
export function regionsServed(w: World): RegionId[] {
  const set = new Set<RegionId>();
  for (const dc of w.player.infra.dataCenters ?? []) if (dcOnline(w, dc) && dcCapacity(dc) > 0) set.add(dc.region);
  return [...set];
}

// ------------------------------------------------------------ actions

export function buildingBlocker(w: World, building: number): string | null {
  const def = DC_BUILDINGS[building];
  if (!def) return 'Unknown building.';
  const p = playerCompany(w);
  if ((w.player.infra.dataCenters ?? []).length >= MAX_DATA_CENTERS) return `You can run at most ${MAX_DATA_CENTERS} data centers.`;
  if (p.reputation < def.minRep) return `Needs reputation ${def.minRep}.`;
  if (p.cash < def.cost) return `Costs $${def.cost.toLocaleString()}.`;
  return null;
}

function emptyServers(): Record<ServerModelId, number> {
  return { budget: 0, rack: 0, blade: 0, pod: 0, supercluster: 0, quantum: 0, photonic: 0 };
}

function emptyUpgrades(): Record<DcUpgradeId, number> {
  return { space: 0, power: 0, cooling: 0, network: 0, backup: 0, security: 0 };
}

export function buyDataCenter(w: World, building: number, region: RegionId): ActionResult {
  const blocker = buildingBlocker(w, building);
  if (blocker) return { ok: false, error: blocker };
  if (!REGIONS[region]) return { ok: false, error: 'Pick a region.' };
  const def = DC_BUILDINGS[building];
  const p = playerCompany(w);
  spend(p, 'servers', def.cost);
  const dcs = w.player.infra.dataCenters;
  const used = new Set(dcs.map((d) => d.name.split(' ')[0]));
  const city = REGIONS[region].cities.find((c) => !used.has(c)) ?? REGIONS[region].cities[dcs.length % REGIONS[region].cities.length];
  const dc: DataCenter = {
    id: newId(w, 'dc'),
    name: `${city} ${def.name}`,
    region,
    building,
    upgrades: emptyUpgrades(),
    servers: emptyServers(),
    readyDay: w.day + def.build,
    expandTo: null,
    expandDay: 0,
    offlineUntil: 0,
    wear: 0,
    boughtDay: w.day,
  };
  dcs.push(dc);
  addXp(w, 30 + building * 40);
  toast(w, `Construction started: ${dc.name}`, 'good', { category: 'server', link: { route: 'servers' }, body: `Ready in ${def.build} days. Then fill it with servers.` });
  return { ok: true, id: dc.id };
}

function findDc(w: World, id: string): DataCenter | undefined {
  return (w.player.infra.dataCenters ?? []).find((d) => d.id === id);
}

export function expandCost(dc: DataCenter): number {
  const next = DC_BUILDINGS[dc.building + 1];
  return next ? Math.round((next.cost * 0.85) / 1000) * 1000 : 0;
}

export function expandBlocker(w: World, dc: DataCenter): string | null {
  const next = DC_BUILDINGS[dc.building + 1];
  if (!next) return 'Already the biggest building there is.';
  if (!dcReady(w, dc)) return 'Still under construction.';
  if (dc.expandTo !== null) return 'Already expanding.';
  if (playerCompany(w).reputation < next.minRep) return `Needs reputation ${next.minRep}.`;
  if (playerCompany(w).cash < expandCost(dc)) return `Costs $${expandCost(dc).toLocaleString()}.`;
  return null;
}

/** Grow the building into the next size. Servers keep running during the work. */
export function expandDataCenter(w: World, id: string): ActionResult {
  const dc = findDc(w, id);
  if (!dc) return { ok: false, error: 'Data center not found.' };
  const blocker = expandBlocker(w, dc);
  if (blocker) return { ok: false, error: blocker };
  const next = DC_BUILDINGS[dc.building + 1];
  spend(playerCompany(w), 'servers', expandCost(dc));
  dc.expandTo = dc.building + 1;
  dc.expandDay = w.day + Math.ceil(next.build * 0.7);
  toast(w, `${dc.name} is growing into a ${next.name}`, 'good', { category: 'server', link: { route: 'servers' }, body: `Done in ${Math.ceil(next.build * 0.7)} days. The servers keep running meanwhile.` });
  return { ok: true };
}

export function dcUpgradeBlocker(w: World, dc: DataCenter, u: DcUpgradeId): string | null {
  const lvl = dc.upgrades[u];
  if (lvl >= DC_MAX_UPGRADE) return 'Maxed out.';
  if (!dcReady(w, dc)) return 'Still under construction.';
  const cost = dcUpgradeCost(dc.building, lvl);
  if (playerCompany(w).cash < cost) return `Costs $${cost.toLocaleString()}.`;
  return null;
}

export function upgradeDataCenter(w: World, id: string, u: DcUpgradeId): ActionResult {
  const dc = findDc(w, id);
  if (!dc) return { ok: false, error: 'Data center not found.' };
  const blocker = dcUpgradeBlocker(w, dc, u);
  if (blocker) return { ok: false, error: blocker };
  spend(playerCompany(w), 'servers', dcUpgradeCost(dc.building, dc.upgrades[u]));
  dc.upgrades[u] += 1;
  addXp(w, 10 + 4 * dc.upgrades[u]);
  return { ok: true };
}

export function serverBlocker(w: World, dc: DataCenter, model: ServerModelId, n = 1): string | null {
  const def = SERVER_MODELS[model];
  const p = playerCompany(w);
  if (!dcReady(w, dc)) return 'Still under construction.';
  if (p.reputation < def.minRep) return `Needs reputation ${def.minRep}.`;
  if (def.research && !hasResearch(w, def.research)) return `Needs ${RESEARCH[def.research].name} research.`;
  if (dcUsedSlots(dc) + def.slots * n > dcSlots(dc)) return 'No rack space left. Expand floor space or the building.';
  if (dcPowerDraw(dc) + def.power * n > dcPowerCap(dc) + 1e-9) return 'Not enough power. Upgrade the power supply.';
  if (p.cash < def.cost * n) return `Costs $${(def.cost * n).toLocaleString()}.`;
  return null;
}

/** How many of a model still fit in a building (by space and power). */
export function serversThatFit(dc: DataCenter, model: ServerModelId): number {
  const def = SERVER_MODELS[model];
  const bySlots = Math.floor((dcSlots(dc) - dcUsedSlots(dc)) / def.slots);
  const byPower = Math.floor((dcPowerCap(dc) - dcPowerDraw(dc) + 1e-9) / def.power);
  return Math.max(0, Math.min(bySlots, byPower));
}

export function buyServers(w: World, id: string, model: ServerModelId, n: number): ActionResult {
  const dc = findDc(w, id);
  if (!dc) return { ok: false, error: 'Data center not found.' };
  const count = Math.max(1, Math.floor(n));
  const blocker = serverBlocker(w, dc, model, count);
  if (blocker) return { ok: false, error: blocker };
  const def = SERVER_MODELS[model];
  const before = dcServerCount(dc);
  spend(playerCompany(w), 'servers', def.cost * count);
  // new hardware lowers the building's average wear
  dc.wear = before + count > 0 ? (dc.wear * before) / (before + count) : 0;
  dc.servers[model] += count;
  w.player.infra.load = w.player.infra.demand / Math.max(1, onlineFleetCapacity(w));
  return { ok: true };
}

export function sellServers(w: World, id: string, model: ServerModelId, n: number): ActionResult {
  const dc = findDc(w, id);
  if (!dc) return { ok: false, error: 'Data center not found.' };
  const count = Math.min(Math.floor(n), dc.servers[model]);
  if (count <= 0) return { ok: false, error: 'None to sell.' };
  dc.servers[model] -= count;
  playerCompany(w).cash += SERVER_MODELS[model].cost * count * 0.3 * (1 - dc.wear * 0.5);
  w.player.infra.load = w.player.infra.demand / Math.max(1, onlineFleetCapacity(w));
  return { ok: true };
}

export function refreshCost(dc: DataCenter): number {
  return Math.round((dcServerValue(dc) * 0.35 * dc.wear) / 100) * 100;
}

export function refreshHardware(w: World, id: string): ActionResult {
  const dc = findDc(w, id);
  if (!dc) return { ok: false, error: 'Data center not found.' };
  if (dc.wear < 0.05 || dcServerCount(dc) === 0) return { ok: false, error: 'The hardware is still fresh.' };
  const cost = refreshCost(dc);
  if (playerCompany(w).cash < cost) return { ok: false, error: `Costs $${cost.toLocaleString()}.` };
  spend(playerCompany(w), 'servers', cost);
  dc.wear = 0;
  toast(w, `${dc.name}: hardware refreshed`, 'good', { category: 'server', link: { route: 'servers' }, silent: true });
  return { ok: true };
}

export function closeDataCenter(w: World, id: string): ActionResult {
  const dc = findDc(w, id);
  if (!dc) return { ok: false, error: 'Data center not found.' };
  const refund = DC_BUILDINGS[dc.building].cost * 0.4 + dcServerValue(dc) * 0.3 * (1 - dc.wear * 0.5);
  playerCompany(w).cash += refund;
  w.player.infra.dataCenters = w.player.infra.dataCenters.filter((d) => d.id !== id);
  toast(w, `${dc.name} sold for $${Math.round(refund).toLocaleString()}`, 'neutral', { category: 'server', link: { route: 'servers' } });
  return { ok: true };
}

// ------------------------------------------------------------ fleet helpers (rented + owned)


export function rentedCapacity(w: World): number {
  const i = w.player.infra;
  return i.nodes * SERVER_TIERS[i.tier].nodeCapacity;
}

/** Capacity running right now: rented hosting (unless the cloud is down) plus online buildings. */
export function onlineFleetCapacity(w: World): number {
  const i = w.player.infra;
  return (w.day < i.outageUntil ? 0 : rentedCapacity(w)) + ownedCapacity(w, true);
}

/** Capacity-weighted performance across rented and owned hardware. */
export function fleetPerformance(w: World): number {
  const i = w.player.infra;
  const rented = w.day < i.outageUntil ? 0 : rentedCapacity(w);
  let cap = rented;
  let perf = rented * SERVER_TIERS[i.tier].performance;
  for (const dc of i.dataCenters ?? []) {
    if (!dcOnline(w, dc)) continue;
    const c = dcCapacity(dc);
    cap += c;
    perf += c * dcPerformance(dc);
  }
  return cap > 0 ? perf / cap : SERVER_TIERS[i.tier].performance;
}

/** How many regions your players are served from (rented global tiers count too). */
export function regionCoverage(w: World): number {
  const i = w.player.infra;
  const rentedCover = i.nodes > 0 ? (i.tier >= 7 ? 5 : i.tier >= 6 ? 4 : i.tier >= 4 ? 3 : i.tier >= 3 ? 2 : 1) : 0;
  return Math.max(1, regionsServed(w).length, rentedCover);
}

// ------------------------------------------------------------ daily

const DC_CAUSES = ['a cooling failure', 'a blown transformer', 'a fire-suppression false alarm', 'a cut fibre line', 'a DDoS attack', 'a raccoon in the substation', 'a failed firmware update'];

/** Daily upkeep, construction, wear and incidents for owned buildings. Returns today's cost. */
export function dataCentersDaily(w: World, hasOnlineGames: boolean): number {
  const i = w.player.infra;
  let cost = 0;
  for (const dc of i.dataCenters ?? []) {
    if (w.day === dc.readyDay) {
      toast(w, `${dc.name} is open`, 'good', { category: 'server', link: { route: 'servers' }, body: dcServerCount(dc) ? 'Its servers are now online.' : 'Fill it with servers to put it to work.' });
    }
    if (dc.expandTo !== null && w.day >= dc.expandDay) {
      dc.building = dc.expandTo;
      dc.expandTo = null;
      const base = dc.name.split(' ')[0];
      dc.name = `${base} ${DC_BUILDINGS[dc.building].name}`;
      addXp(w, 40 * dc.building);
      pushNews(w, { kind: 'player', title: `${playerCompany(w).name} opens the ${dc.name}`, companyId: w.player.companyId, tone: 'good' });
      toast(w, `Expansion done: ${dc.name}`, 'good', { category: 'server', link: { route: 'servers' }, body: `Now ${dcSlots(dc)} rack slots and ${Math.round(dcPowerCap(dc))} kW.` });
    }
    if (!dcReady(w, dc)) continue;
    cost += dcMonthlyCost(w, dc) / 30;
    if (dcServerCount(dc) === 0) continue;
    dc.wear = Math.min(1, dc.wear + (1 / (4 * 365)) * (1 - 0.1 * dc.upgrades.cooling));
    if (dc.wear >= 0.75 && !w.player.flags[`wear:${dc.id}`]) {
      w.player.flags[`wear:${dc.id}`] = w.day;
      toast(w, `${dc.name}: hardware is getting old`, 'bad', { category: 'server', link: { route: 'servers' }, body: 'Worn servers fail more and run slower. Refresh the hardware.' });
    } else if (dc.wear < 0.5) delete w.player.flags[`wear:${dc.id}`];
    if (!dcOnline(w, dc) || !hasOnlineGames) continue;
    const util = dcPowerCap(dc) > 0 ? dcPowerDraw(dc) / dcPowerCap(dc) : 1;
    const u = dc.upgrades;
    const risk = 0.0016 * (1 + 3 * Math.max(0, util - 0.85)) * (1 - 0.12 * u.cooling) * (1 - 0.15 * u.backup) * (1 - 0.1 * u.security) * (1 + 2 * dc.wear);
    if (chance(w, risk)) {
      const days = u.backup >= 3 ? 1 : randInt(w, 1, 3);
      const cause = pick(w, DC_CAUSES);
      dc.offlineUntil = w.day + days;
      i.incidents.unshift({ day: w.day, days, cause, where: dc.name, full: false });
      if (i.incidents.length > 20) i.incidents.length = 20;
      pushPoint(i.downtime, w.day, days, 60);
      toast(w, `${dc.name} is offline for ${days} day${days > 1 ? 's' : ''}`, 'bad', {
        category: 'server',
        link: { route: 'servers' },
        body: `Caused by ${cause}. Its players move to your other servers if there is room. Cooling, backup power and security make this rarer.`,
      });
    }
  }
  return cost;
}

/** Autoscale helper: fill free space in your buildings with the best servers you can afford. Returns capacity added. */
export function autoscaleOwned(w: World, needed: number): number {
  const p = playerCompany(w);
  let added = 0;
  const models = [...SERVER_MODEL_IDS].reverse();
  for (const dc of w.player.infra.dataCenters ?? []) {
    if (!dcReady(w, dc) || added >= needed) continue;
    for (const m of models) {
      const def = SERVER_MODELS[m];
      if (p.reputation < def.minRep || (def.research && !hasResearch(w, def.research))) continue;
      while (added < needed && serversThatFit(dc, m) > 0 && p.cash - 5000 > def.cost) {
        spend(p, 'servers', def.cost);
        const before = dcServerCount(dc);
        dc.wear = (dc.wear * before) / (before + 1);
        dc.servers[m] += 1;
        added += def.capacity;
      }
    }
  }
  return added;
}

