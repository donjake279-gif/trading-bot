// Owned data centers: buildings, construction, upgrades, servers, wear,
// outages, autoscaling and how they combine with rented cloud hosting.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { advanceDay, advanceDays } from '../tick';
import { createGame, releasePlayerGame } from '../actions';
import { deserializeWorld, serializeWorld } from '../save';
import { DC_BUILDINGS, SERVER_MODELS, SERVER_TIERS, focus } from '../constants';
import {
  buyDataCenter,
  buyServers,
  closeDataCenter,
  dataCentersDaily,
  dcCapacity,
  dcPerformance,
  dcPowerCap,
  dcSlots,
  expandDataCenter,
  fleetPerformance,
  onlineFleetCapacity,
  ownedCapacity,
  ownedMonthlyCost,
  refreshHardware,
  sellServers,
  serversThatFit,
  upgradeDataCenter,
} from '../datacenters';
import { buyNodes, infraCapacity, infraDaily, infraEffects, infraMonthlyCost, sellNodes, setServerTier } from '../infra';
import type { Game, World } from '../types';
import { playerCompany } from '../util';

const opts = { seed: 'dc-1', companyName: 'Metal Works', founderName: 'M', specialty: 'programmer' as const, difficulty: 'normal' as const, rivals: 16 };

function onlineGame(w: World): Game {
  const founder = w.player.employees[0];
  const r = createGame(
    w,
    { title: 'Server Test', genre: 'indie', topic: 'robots', platforms: ['pc'], audience: 'casual', engine: 'pixelforge', monetization: 'premium', price: 4.99, artStyle: 'pixel', multiplayer: 'online', scope: 'tiny', budget: 500, focus: focus(1, 1, 1, 1, 1, 1) },
    [founder.id],
  );
  expect(r.ok, r.error).toBe(true);
  const g = w.games[r.id!];
  while (g.workDone < g.workRequired) advanceDay(w);
  expect(releasePlayerGame(w, g.id).ok).toBe(true);
  return g;
}

function rich(w: World, rep = 70): void {
  playerCompany(w).cash = 1e9;
  playerCompany(w).reputation = rep;
  w.player.research.completed.push('netcode', 'cloudInfra');
}

describe('data centers', () => {
  it('buildings take time to build and need space and power for servers', () => {
    const w = createWorld(opts);
    playerCompany(w).cash = 1e6;
    expect(buyDataCenter(w, 2, 'na').ok).toBe(false); // needs reputation 15
    const r = buyDataCenter(w, 0, 'na');
    expect(r.ok, r.error).toBe(true);
    const dc = w.player.infra.dataCenters[0];
    expect(dc.name).toMatch(/Server Closet/);
    expect(buyServers(w, dc.id, 'budget', 1).ok).toBe(false); // under construction
    advanceDays(w, DC_BUILDINGS[0].build);
    expect(buyServers(w, dc.id, 'budget', 2).ok).toBe(true);
    // a closet holds 4 slots and 3 kW: two rack servers draw 2.4 kW, a third would blow the power budget
    playerCompany(w).reputation = 0;
    expect(buyServers(w, dc.id, 'rack', 1).ok).toBe(false); // rack needs reputation 3
    playerCompany(w).reputation = 5;
    expect(buyServers(w, dc.id, 'rack', 2).ok).toBe(false); // 1 + 2.4 kW > 3 kW
    expect(buyServers(w, dc.id, 'rack', 1).ok).toBe(true);
    expect(serversThatFit(dc, 'rack')).toBe(0);
    expect(upgradeDataCenter(w, dc.id, 'power').ok).toBe(true);
    expect(dcPowerCap(dc)).toBeCloseTo(3.75, 5);
    expect(dcCapacity(dc)).toBe(2 * SERVER_MODELS.budget.capacity + SERVER_MODELS.rack.capacity);
    expect(sellServers(w, dc.id, 'budget', 5).ok).toBe(true);
    expect(dc.servers.budget).toBe(0);
  });

  it('floor space and expansions add room', () => {
    const w = createWorld(opts);
    rich(w);
    buyDataCenter(w, 1, 'eu');
    const dc = w.player.infra.dataCenters[0];
    advanceDays(w, DC_BUILDINGS[1].build);
    const slots = dcSlots(dc);
    expect(upgradeDataCenter(w, dc.id, 'space').ok).toBe(true);
    expect(dcSlots(dc)).toBe(Math.floor(slots * 1.25));
    expect(expandDataCenter(w, dc.id).ok).toBe(true);
    expect(expandDataCenter(w, dc.id).ok).toBe(false);
    advanceDays(w, DC_BUILDINGS[2].build);
    expect(dc.building).toBe(2);
    expect(dc.name).toMatch(/Warehouse/);
    expect(dcSlots(dc)).toBe(Math.floor(DC_BUILDINGS[2].slots * 1.25));
  });

  it('owned and rented capacity add up, and owned hardware can carry the whole fleet', () => {
    const w = createWorld(opts);
    rich(w);
    const g = onlineGame(w);
    const rented = infraCapacity(w);
    buyDataCenter(w, 2, 'na');
    const dc = w.player.infra.dataCenters[0];
    advanceDays(w, DC_BUILDINGS[2].build);
    expect(buyServers(w, dc.id, 'blade', 4).ok).toBe(true);
    expect(infraCapacity(w)).toBe(rented + 4 * SERVER_MODELS.blade.capacity);
    expect(onlineFleetCapacity(w)).toBe(infraCapacity(w));
    // you can drop rented hosting entirely once you own servers
    expect(sellNodes(w, 99).ok).toBe(true);
    expect(w.player.infra.nodes).toBe(0);
    g.ccu = 20000;
    w.player.infra.autoscale = false;
    infraDaily(w);
    expect(w.player.infra.load).toBeCloseTo(20000 / 48000, 3);
    expect(infraEffects(w).down).toBe(false);
  });

  it('a building outage only removes its share; losing everything takes games down', () => {
    const w = createWorld(opts);
    rich(w);
    const g = onlineGame(w);
    buyDataCenter(w, 1, 'na');
    const dc = w.player.infra.dataCenters[0];
    advanceDays(w, DC_BUILDINGS[1].build);
    buyServers(w, dc.id, 'rack', 4);
    const total = onlineFleetCapacity(w);
    dc.offlineUntil = w.day + 2;
    expect(onlineFleetCapacity(w)).toBe(total - dcCapacity(dc));
    sellNodes(w, 99);
    g.ccu = 1000;
    w.player.infra.demand = 1000;
    expect(infraEffects(w).down).toBe(true);
    w.player.infra.autoscale = false;
    infraDaily(w);
    expect(g.meltdownUntil).toBeGreaterThan(w.day);
  });

  it('autoscaling fills your own buildings before renting more nodes', () => {
    const w = createWorld(opts);
    rich(w);
    const g = onlineGame(w);
    buyDataCenter(w, 2, 'asia');
    const dc = w.player.infra.dataCenters[0];
    advanceDays(w, DC_BUILDINGS[2].build);
    const nodes = w.player.infra.nodes;
    g.ccu = 30000;
    infraDaily(w);
    expect(dcCapacity(dc)).toBeGreaterThan(0);
    expect(w.player.infra.nodes).toBe(nodes);
    expect(w.player.infra.load).toBeLessThan(1);
  });

  it('hardware wears out, fails more, and can be refreshed', () => {
    const w = createWorld(opts);
    rich(w);
    buyDataCenter(w, 1, 'na');
    const dc = w.player.infra.dataCenters[0];
    advanceDays(w, DC_BUILDINGS[1].build);
    buyServers(w, dc.id, 'rack', 4);
    const fresh = dcPerformance(dc);
    for (let d = 0; d < 800; d++) {
      w.day += 1;
      dataCentersDaily(w, false);
    }
    expect(dc.wear).toBeGreaterThan(0.5);
    expect(dcPerformance(dc)).toBeLessThan(fresh);
    expect(refreshHardware(w, dc.id).ok).toBe(true);
    expect(dc.wear).toBe(0);
  });

  it('upgrades make games run smoother and regions help', () => {
    const w = createWorld(opts);
    rich(w);
    onlineGame(w);
    for (const region of ['na', 'eu', 'asia'] as const) buyDataCenter(w, 2, region);
    advanceDays(w, DC_BUILDINGS[2].build);
    for (const dc of w.player.infra.dataCenters) {
      buyServers(w, dc.id, 'pod', 2);
      for (let k = 0; k < 3; k++) upgradeDataCenter(w, dc.id, 'network');
    }
    sellNodes(w, 99);
    expect(fleetPerformance(w)).toBeGreaterThan(SERVER_TIERS[2].performance);
    expect(infraEffects(w).score).toBeGreaterThan(4 * SERVER_TIERS[2].performance);
  });

  it('owning is cheaper to run than renting at scale', () => {
    const w = createWorld(opts);
    rich(w);
    const demand = 100000;
    // rented: dedicated servers sized for the load
    w.player.infra.tier = 2;
    w.player.infra.nodes = 12;
    const rentedMonthly = infraMonthlyCost(w, demand);
    // owned: a warehouse full of blades, no rented nodes
    buyDataCenter(w, 2, 'na');
    const dc = w.player.infra.dataCenters[0];
    advanceDays(w, DC_BUILDINGS[2].build);
    upgradeDataCenter(w, dc.id, 'power');
    expect(buyServers(w, dc.id, 'blade', 10).ok).toBe(true);
    w.player.infra.nodes = 0;
    const ownedMonthly = infraMonthlyCost(w, demand);
    expect(ownedCapacity(w)).toBeGreaterThanOrEqual(demand);
    expect(ownedMonthly).toBeLessThan(rentedMonthly * 0.8);
    expect(ownedMonthlyCost(w)).toBeGreaterThan(0);
    expect(closeDataCenter(w, dc.id).ok).toBe(true);
  });

  it('saves without data centers load and keep working', () => {
    const w = createWorld(opts);
    onlineGame(w);
    const raw = JSON.parse(serializeWorld(w));
    delete raw.player.infra.dataCenters;
    const m = deserializeWorld(JSON.stringify(raw));
    expect(m.player.infra.dataCenters).toEqual([]);
    advanceDays(m, 30);
    expect(Number.isFinite(playerCompany(m).cash)).toBe(true);
  });
});

describe('mega cloud tiers', () => {
  it('the Orbital Server Ring reaches 20 billion players, at a huge price', () => {
    const top = SERVER_TIERS[SERVER_TIERS.length - 1];
    expect(top.nodeCapacity * top.maxNodes).toBe(20_000_000_000);
    expect(top.nodeCost).toBeGreaterThanOrEqual(1e9);

    const w = createWorld({ seed: 'orbit', companyName: 'Sky High', founderName: 'S', specialty: 'programmer', difficulty: 'normal', rivals: 12 });
    const p = playerCompany(w);
    const tier = SERVER_TIERS.length - 1;
    expect(setServerTier(w, tier).ok).toBe(false); // needs research and reputation
    w.player.research.completed.push('cloudInfra');
    p.reputation = 90;
    p.cash = 5e9;
    expect(setServerTier(w, tier).ok).toBe(false); // can't afford the $8B move
    p.cash = 3e11;
    expect(setServerTier(w, tier).ok).toBe(true);
    expect(buyNodes(w, top.maxNodes).ok).toBe(true);
    expect(w.player.infra.nodes).toBe(top.maxNodes);
    expect(infraCapacity(w)).toBeGreaterThanOrEqual(20_000_000_000);
    expect(infraMonthlyCost(w, 0)).toBeGreaterThanOrEqual(2e9); // billions a month, even with the cloud research discount
    expect(buyNodes(w, 1).ok).toBe(false);
  });
});
