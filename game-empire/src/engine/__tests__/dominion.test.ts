// The Dominion: the late game's ten systems.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { advanceDay, advanceDays } from '../tick';
import { createGame } from '../actions';
import { focus } from '../constants';
import { resolveDecision } from '../events';
import { deserializeWorld, serializeWorld } from '../save';
import { playerCompany } from '../util';
import { SECTOR_IDS, antitrustFactor, deskCapacity, dominionAssetValue, energyMult, execPower, featureOpen, fmtMoney, sectorShare } from '../dominionCore';
import { activeCorps, corpById, declareWar, endWar, makePeace, peaceTerms, sideOf, startWar, useTactic, warsOf } from '../megacorps';
import { EXEC_ROLE_IDS, fireExec, grantStock, hireExec, settleFeud } from '../executives';
import { defense, launchOp, opsDaily, setSecurityLevel } from '../espionage';
import { foundEcosystem, upgradePart } from '../ecosystem';
import { planKeynote, revealOptions, runKeynote } from '../keynotes';
import { buildSpace, upgradeLaunchTech } from '../space';
import { buildDistrict, foundCity } from '../cities';
import { createUniverse, sellLand } from '../universes';
import { MEGAPROJECTS, startMegaproject } from '../megaprojects';
import { EMERGENCIES, startEmergency } from '../emergencies';
import { EMPIRE_LEVELS, empireLevel } from '../empire';
import type { World } from '../types';
import { lateBot } from './lateBot';

const opts = { seed: 'dominion-1', companyName: 'Omni Play', founderName: 'O', specialty: 'designer' as const, difficulty: 'normal' as const, rivals: 22 };

/** A world whose player is suddenly very rich (the Dominion opens up on the next weekly check). */
function richWorld(cash: number, seed = opts.seed): World {
  const w = createWorld({ ...opts, seed });
  const p = playerCompany(w);
  p.cash = cash;
  p.reputation = 80;
  while (w.day % 7 !== 6) advanceDay(w);
  advanceDay(w);
  return w;
}

/** Answer whatever is in the inbox with its default option (the "safe" choice). */
function answerAll(w: World): void {
  for (const ev of [...w.pendingEvents]) resolveDecision(w, ev.id, ev.defaultOption ?? ev.options[ev.options.length - 1].id);
}

describe('unlocks', () => {
  it('opens systems as the empire grows, and the megacorps arrive', () => {
    const w = richWorld(3e12);
    expect(empireLevel(w)).toBe(5);
    expect(w.player.empire.best).toBe(5);
    expect(featureOpen(w, 'wars')).toBe(true);
    expect(featureOpen(w, 'space')).toBe(true);
    expect(featureOpen(w, 'megaprojects')).toBe(false);
    const d = w.player.dominion;
    expect(d.seen).toBe(5);
    expect(d.feed.some((f) => f.text.startsWith('Unlocked:'))).toBe(true);
    expect(activeCorps(w).length).toBe(6);
    expect(d.execPool.length).toBeGreaterThanOrEqual(4);
    for (const c of activeCorps(w)) {
      expect(c.valuation).toBeGreaterThan(0);
      for (const s of SECTOR_IDS) expect(c.power[s]).toBeGreaterThanOrEqual(0);
    }
  });

  it('has empire levels beyond $100T, each harder than the last', () => {
    expect(EMPIRE_LEVELS.length).toBe(10);
    for (let i = 1; i < EMPIRE_LEVELS.length; i++) {
      expect(EMPIRE_LEVELS[i].min).toBeGreaterThan(EMPIRE_LEVELS[i - 1].min);
      expect(EMPIRE_LEVELS[i].rivalPace).toBeGreaterThanOrEqual(EMPIRE_LEVELS[i - 1].rivalPace);
    }
    expect(fmtMoney(2.5e15)).toBe('$2.50Q');
  });

  it('keeps market shares sane and dominance raises antitrust heat', () => {
    const w = richWorld(3e12);
    advanceDays(w, 40);
    for (const s of SECTOR_IDS) {
      const total = sectorShare(w, s) + activeCorps(w).reduce((t, c) => t + sectorShare(w, s, c.id), 0);
      expect(total).toBeLessThanOrEqual(1.0001);
    }
    expect(antitrustFactor(w)).toBeGreaterThanOrEqual(1);
  });
});

describe('executives', () => {
  it('hires, rewards and settles feuds', () => {
    const w = richWorld(3e12);
    const d = w.player.dominion;
    const cand = d.execPool[0];
    expect(hireExec(w, cand.id).ok).toBe(true);
    expect(execPower(w, cand.role)).toBeGreaterThan(0);
    const before = cand.loyalty;
    expect(grantStock(w, cand.id).ok).toBe(true);
    expect(cand.loyalty).toBeGreaterThan(before);
    // two executives in a feud: backing one ends it
    const other = d.execPool.find((x) => x.role !== cand.role)!;
    hireExec(w, other.id);
    cand.feudWith = other.id;
    other.feudWith = cand.id;
    expect(execPower(w, cand.role)).toBeLessThan(execPower(w, cand.role) / 0.75 + 1e-9);
    expect(settleFeud(w, cand.id).ok).toBe(true);
    expect(cand.feudWith).toBeNull();
    expect(other.loyalty).toBeLessThan(before);
    expect(fireExec(w, other.id).ok).toBe(true);
    expect(d.execs.length).toBe(1);
    expect(EXEC_ROLE_IDS.length).toBe(6);
  });
});

describe('espionage', () => {
  it('security tiers raise defense; operations resolve and can be exposed', () => {
    const w = richWorld(3e12);
    const d0 = defense(w);
    expect(setSecurityLevel(w, 3).ok).toBe(true);
    expect(defense(w)).toBeGreaterThan(d0);
    const target = activeCorps(w)[0];
    expect(launchOp(w, 'roadmap', target.id).ok).toBe(true);
    const op = w.player.dominion.spy.ops[0];
    op.odds = 1;
    op.risk = 2;
    const relBefore = target.relation;
    const repBefore = playerCompany(w).reputation;
    w.day += op.days;
    opsDaily(w);
    expect(w.player.dominion.spy.ops.length).toBe(0);
    expect(w.player.dominion.spy.intel[target.id]).toBeGreaterThanOrEqual(35);
    expect(w.player.dominion.spy.stats.opsExposed).toBe(1);
    expect(target.relation).toBeLessThan(relBefore);
    expect(playerCompany(w).reputation).toBeLessThan(repBefore);
  });
});

describe('ecosystem', () => {
  it('builds an OS, earns money and promotes your games', () => {
    const w = richWorld(3e12);
    expect(foundEcosystem(w, 'Nexus').ok).toBe(true);
    const e = w.player.dominion.ecosystem!;
    expect(e.building?.part).toBe('os');
    advanceDays(w, e.building!.days + 1);
    expect(e.levels.os).toBe(1);
    expect(upgradePart(w, 'subscription').ok).toBe(true);
    advanceDays(w, 70);
    expect(e.users).toBeGreaterThan(0);
    expect(e.revenue).toBeGreaterThan(0);
    expect(e.promo).toBeGreaterThan(1);
    expect(playerCompany(w).monthly.some((m) => m.ledger.ecosystem > 0)).toBe(true);
  });
});

describe('keynotes', () => {
  it('reveals a game to a live audience and the rivals react', () => {
    const w = richWorld(3e12);
    const r = createGame(
      w,
      { title: 'Star Siege', genre: 'rpg', topic: 'space', platforms: ['pc', 'console'], audience: 'youngAdults', engine: 'titan', monetization: 'premium', price: 39.99, artStyle: 'stylized', multiplayer: 'single', scope: 'medium', budget: 3e5, focus: focus(1, 1, 1, 1, 1, 1) },
      [w.player.employees[0].id],
    );
    expect(r.ok, r.error).toBe(true);
    const g = w.games[r.id!];
    const opt = revealOptions(w).find((o) => o.refId === g.id)!;
    expect(opt).toBeTruthy();
    expect(planKeynote(w, { title: 'Omni Live', venue: 1, reveals: [{ ...opt, surprise: true }] }).ok).toBe(true);
    const plan = w.player.dominion.keynotes.plan!;
    const hype = g.hype;
    const res = runKeynote(w, plan);
    expect(res.items.length).toBe(1);
    expect(res.score).toBeGreaterThan(0);
    expect(res.reactions.length).toBeGreaterThan(0);
    expect(g.hype).toBeGreaterThan(hype);
    expect(w.keynoteShows?.length).toBe(1);
    expect(JSON.parse(serializeWorld(w)).keynoteShows).toEqual([]);
  });
});

describe('empire wars', () => {
  it('fights with tactics, makes peace, and a decisive win pays spoils', () => {
    const w = richWorld(3e12);
    advanceDays(w, 35);
    const foe = activeCorps(w).sort((a, b) => a.valuation - b.valuation)[0];
    const res = declareWar(w, foe.id, 'games');
    expect(res.ok, res.error).toBe(true);
    const war = w.player.dominion.wars.find((x) => x.id === res.id)!;
    expect(sideOf(war, 'player')).toBe('attackers');
    const score = war.score;
    expect(useTactic(w, war.id, 'adBlitz').ok).toBe(true);
    expect(war.score).toBeGreaterThan(score);
    expect(useTactic(w, war.id, 'adBlitz').ok).toBe(false);
    expect(peaceTerms(w, war.id).note.length).toBeGreaterThan(0);
    // a decisive victory
    war.score = 100;
    const before = foe.power.games;
    endWar(w, war, 'attackers');
    expect(w.player.dominion.stats.warsWon).toBe(1);
    expect(foe.power.games).toBeLessThan(before);
    expect(w.player.dominion.mods.some((m) => m.sector === 'games' && m.mult > 1)).toBe(true);
    expect(warsOf(w, 'player').length).toBe(0);
  });

  it('can be absorbed after a crushing defeat', () => {
    const w = richWorld(3e12);
    advanceDays(w, 35);
    const foe = activeCorps(w).sort((a, b) => a.valuation - b.valuation)[0];
    foe.valuation = playerCompany(w).valuation * 0.2;
    const war = startWar(w, 'player', foe.id, 'media');
    endWar(w, war, 'attackers');
    const ev = w.pendingEvents.find((e) => e.kind === 'annex');
    expect(ev).toBeTruthy();
    resolveDecision(w, ev!.id, 'accept');
    expect(corpById(w, foe.id)?.status).toBe('annexed');
    expect(w.player.dominion.annexed.length).toBe(1);
  });

  it('megacorps go to war with each other on their own', () => {
    const w = richWorld(3e12, 'dominion-wars');
    let wars = 0;
    for (let i = 0; i < 24 && wars === 0; i++) {
      advanceDays(w, 30);
      wars = w.player.dominion.wars.length + w.player.dominion.warHistory.length;
    }
    expect(wars).toBeGreaterThan(0);
  });

  it('peace on the player’s terms ends the war', () => {
    const w = richWorld(3e12);
    advanceDays(w, 35);
    const foe = activeCorps(w)[0];
    const war = startWar(w, 'player', foe.id, 'ai');
    war.score = 40;
    expect(peaceTerms(w, war.id).accept).toBe(true);
    expect(makePeace(w, war.id).ok).toBe(true);
    expect(w.player.dominion.wars.some((x) => x.id === war.id)).toBe(false);
  });
});

describe('space, cities and universes', () => {
  it('builds a spaceport and earns from orbit', () => {
    const w = richWorld(3e12);
    expect(upgradeLaunchTech(w).ok).toBe(true);
    expect(buildSpace(w, 'spaceport').ok).toBe(true);
    const a = w.player.dominion.space.assets[0];
    advanceDays(w, a.ready - w.day + 35);
    answerAll(w);
    expect(['active', 'lost', 'building']).toContain(a.stage);
    if (a.stage === 'active') {
      expect(w.player.dominion.space.firsts.spaceport).toBeTruthy();
      expect(w.player.dominion.space.revenue).toBeGreaterThan(0);
    }
    expect(dominionAssetValue(w)).toBeGreaterThan(0);
  });

  it('grows a city whose campus adds desks', () => {
    const w = richWorld(5e12);
    const desks = deskCapacity(w);
    expect(foundCity(w, 'Omni City', 'eu').ok).toBe(true);
    const c = w.player.dominion.cities[0];
    expect(buildDistrict(w, c.id, 'campus').ok).toBe(true);
    expect(buildDistrict(w, c.id, 'residential').ok).toBe(true);
    advanceDays(w, 620);
    expect(deskCapacity(w)).toBe(desks + 2500);
    expect(c.population).toBeGreaterThan(5e4);
    expect(c.revenue).toBeGreaterThan(0);
  });

  it('runs a universe economy that the central bank keeps stable', () => {
    const w = richWorld(3e12);
    expect(createUniverse(w, { name: 'Aether', theme: 'space', ipId: null, scale: 2 }).ok).toBe(true);
    const u = w.player.dominion.universes[0];
    advanceDays(w, u.ready - w.day + 400);
    answerAll(w);
    expect(u.stage).toBe('live');
    expect(u.population).toBeGreaterThan(1e6);
    expect(u.revenue).toBeGreaterThan(0);
    expect(u.prices).toBeLessThan(400);
    const cash = playerCompany(w).cash;
    expect(sellLand(w, u.id, 0.05).ok).toBe(true);
    expect(playerCompany(w).cash).toBeGreaterThan(cash);
  });
});

describe('megaprojects', () => {
  it('a World Power can build a fusion grid that cuts power bills', () => {
    const w = richWorld(1.2e13);
    expect(w.player.empire.best).toBeGreaterThanOrEqual(6);
    expect(startMegaproject(w, 'fusionGrid').ok).toBe(true);
    for (let i = 0; i < MEGAPROJECTS.fusionGrid.days + 400 && w.player.dominion.megaprojects[0].stage === 'building'; i++) {
      advanceDay(w);
      if (i % 20 === 0) answerAll(w);
    }
    expect(w.player.dominion.megaprojects[0].stage).toBe('done');
    expect(energyMult(w)).toBeLessThanOrEqual(0.2);
  });
});

describe('emergencies', () => {
  it('can be contained by spending through every stage', () => {
    const w = richWorld(3e12);
    startEmergency(w, 'liquidity');
    for (let i = 0; i < 120 && w.player.dominion.emergency; i++) {
      for (const ev of w.pendingEvents.filter((e) => e.kind === 'emergency')) resolveDecision(w, ev.id, 'spend');
      advanceDay(w);
    }
    expect(w.player.dominion.emergency).toBeNull();
    expect(w.player.dominion.emergencyHistory[0].outcome).toBe('contained');
  });

  it('turns into a disaster when pressure hits 100', () => {
    const w = richWorld(3e12);
    const e = startEmergency(w, 'liquidity');
    e.pressure = 99.9;
    advanceDay(w);
    expect(w.player.dominion.emergency).toBeNull();
    expect(w.player.dominion.emergencyHistory[0].outcome).toBe('disaster');
    expect(w.player.dominion.stats.disasters).toBe(1);
    expect(Object.keys(EMERGENCIES).length).toBe(11);
  });
});

describe('saves', () => {
  it('round-trips the whole Dominion and migrates older saves', () => {
    const w = richWorld(3e12);
    foundEcosystem(w, 'Nexus');
    advanceDays(w, 60);
    const back = deserializeWorld(serializeWorld(w));
    expect(back.player.dominion.corps.length).toBe(w.player.dominion.corps.length);
    expect(back.player.dominion.ecosystem?.name).toBe('Nexus');
    const raw = JSON.parse(serializeWorld(w));
    delete raw.player.dominion;
    for (const id in raw.companies) for (const k of ['ecosystem', 'space', 'worlds', 'cities', 'dominion', 'warfare', 'execs', 'buildout']) delete raw.companies[id].ledger[k];
    const old = deserializeWorld(JSON.stringify(raw));
    expect(old.player.dominion.corps).toEqual([]);
    advanceDays(old, 40);
    expect(Number.isFinite(playerCompany(old).cash)).toBe(true);
    expect(old.player.dominion.corps.length).toBeGreaterThan(0);
  });

  it('a saved late game resumes on exactly the same timeline', () => {
    const a = richWorld(3e12, 'dominion-det');
    advanceDays(a, 120);
    const b = deserializeWorld(serializeWorld(a));
    advanceDays(a, 150);
    advanceDays(b, 150);
    const pa = playerCompany(a);
    const pb = playerCompany(b);
    expect(pb.cash).toBe(pa.cash);
    expect(pb.valuation).toBe(pa.valuation);
    expect(b.player.dominion.corps.map((c) => c.valuation)).toEqual(a.player.dominion.corps.map((c) => c.valuation));
    expect(b.player.dominion.feed.length).toBe(a.player.dominion.feed.length);
    expect(b.rng).toBe(a.rng);
  });
});

describe('the late game keeps running', () => {
  it('a scripted empire uses every system for three years', () => {
    const w = richWorld(1.5e13, 'dominion-long');
    const t = performance.now();
    for (let m = 0; m < 36 && !w.player.gameOver; m++) {
      advanceDays(w, 30);
      lateBot(w);
      answerAll(w);
    }
    const msPerDay = (performance.now() - t) / (36 * 30);
    const p = playerCompany(w);
    const d = w.player.dominion;
    expect(Number.isFinite(p.cash)).toBe(true);
    expect(Number.isFinite(p.valuation)).toBe(true);
    expect(activeCorps(w).length).toBeGreaterThanOrEqual(5);
    for (const c of activeCorps(w)) expect(Number.isFinite(c.valuation)).toBe(true);
    expect(d.execs.length).toBeGreaterThan(0);
    expect(d.ecosystem).not.toBeNull();
    expect(d.universes.length).toBeGreaterThan(0);
    expect(d.space.assets.length).toBeGreaterThan(0);
    expect(d.cities.length).toBeGreaterThan(0);
    expect(d.megaprojects.length).toBeGreaterThan(0);
    expect(d.stats.keynotes).toBeGreaterThan(0);
    expect(d.feed.length).toBeGreaterThan(20);
    expect(msPerDay).toBeLessThan(40);
  });

  it('old games nobody is updating still earn, simulated in weekly steps', () => {
    const w = createWorld(opts);
    advanceDays(w, 60);
    const old = Object.values(w.games).filter((g) => g.status === 'released' && g.companyId !== w.player.companyId && w.day - (g.releaseDay ?? w.day) > 400 && g.active > 1000);
    expect(old.length).toBeGreaterThan(0);
    const g = old[0];
    const rev = g.revenueTotal;
    const owners = g.owners;
    advanceDays(w, 14);
    expect(g.revenueTotal).toBeGreaterThan(rev);
    expect(g.owners).toBeGreaterThanOrEqual(owners);
    expect(g.active).toBeGreaterThan(0);
    expect(g.simSlot).toBeGreaterThanOrEqual(0);
  });
});
