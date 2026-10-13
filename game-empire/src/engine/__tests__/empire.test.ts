// Studio engine, topics and combos, remasters, certifications, facilities,
// legends, conventions, your own store, memes and legacy.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { advanceDay, advanceDays } from '../tick';
import { createGame, hire, releasePlayerGame } from '../actions';
import { resolveDecision } from '../events';
import { deserializeWorld, serializeWorld } from '../save';
import { ENGINE_MODULE_IDS, TOPIC_IDS, focus } from '../constants';
import { engineStats } from '../development';
import {
  adoptionChance,
  engineScore,
  foundEngine,
  readyForVersion,
  releaseEngineVersion,
  setLicensing,
  startModuleUpgrade,
} from '../studioEngine';
import { comboGrade, comboHint, legendaryCombo } from '../topics';
import { buildFacility, certificationsWeekly, facilityEffects, hostConvention, launchStore, makeLegend, remasterBlocker, startRemaster, storeDaily } from '../fun';
import { legacyPointsFor, loadLegacy, retire } from '../legacy';
import { resolveMeme } from '../memes';
import { playerReviews } from '../reviews';
import type { Game, MultiplayerId, TopicId, World } from '../types';
import { playerCompany } from '../util';

const opts = { seed: 'empire-1', companyName: 'Empire Works', founderName: 'E', specialty: 'programmer' as const, difficulty: 'normal' as const, rivals: 22 };

function shipGame(w: World, topic: TopicId = 'cats', multiplayer: MultiplayerId = 'single', genre: Game['genre'] = 'indie'): Game {
  const founder = w.player.employees[0];
  const r = createGame(
    w,
    { title: `Test ${topic}`, genre, topic, platforms: ['pc'], audience: 'casual', engine: 'pixelforge', monetization: 'premium', price: 4.99, artStyle: 'pixel', multiplayer, scope: 'tiny', budget: 500, focus: focus(1, 1, 1, 1, 1, 1) },
    [founder.id],
  );
  expect(r.ok, r.error).toBe(true);
  const g = w.games[r.id!];
  while (g.workDone < g.workRequired) advanceDay(w);
  expect(releasePlayerGame(w, g.id).ok).toBe(true);
  return g;
}

function withEngine(w: World): void {
  w.player.research.completed.push('agile', 'engine1');
  expect(foundEngine(w, 'Kraken Engine').ok).toBe(true);
}

describe('studio engine', () => {
  it('needs the research, then can be founded, upgraded and versioned', () => {
    const w = createWorld(opts);
    expect(foundEngine(w, 'Nope').ok).toBe(false);
    withEngine(w);
    const e = w.player.engine!;
    expect(e.version).toBe(1);
    const before = engineStats(w, 'inhouse', true);
    playerCompany(w).cash = 1e9;
    expect(readyForVersion(e)).toBe(false);
    for (const m of ENGINE_MODULE_IDS) {
      expect(startModuleUpgrade(w, m).ok).toBe(true);
      expect(startModuleUpgrade(w, 'tools').ok).toBe(false); // one at a time
      while (e.upgrade) advanceDay(w);
    }
    expect(ENGINE_MODULE_IDS.every((m) => e.modules[m] === 2)).toBe(true);
    // can't go past the next version before shipping it
    expect(startModuleUpgrade(w, 'rendering').ok).toBe(false);
    expect(readyForVersion(e)).toBe(true);
    expect(releaseEngineVersion(w, true).ok).toBe(true);
    expect(e.version).toBe(2);
    const after = engineStats(w, 'inhouse', true);
    expect(after.cap).toBeGreaterThan(before.cap);
    expect(after.workMult).toBeLessThan(before.workMult);
    expect(engineScore(e)).toBe(64);
  });

  it('rival studios license a good engine and pay fees and royalties', () => {
    const w = createWorld({ ...opts, seed: 'license-1', rivals: 28 });
    withEngine(w);
    const e = w.player.engine!;
    for (const m of ENGINE_MODULE_IDS) e.modules[m] = 4;
    e.version = 4;
    e.hype = 60;
    expect(adoptionChance(w, Object.values(w.companies).find((c) => !c.isPlayer)!, 'medium')).toBe(0);
    setLicensing(w, { licensing: true, royalty: 0.03, fee: 20000 });
    const ai = Object.values(w.companies).find((c) => !c.isPlayer && c.status === 'active')!;
    expect(adoptionChance(w, ai, 'medium')).toBeGreaterThan(0.1);
    playerCompany(w).cash = 1e8;
    advanceDays(w, 365 * 2);
    expect(e.gamesBuilt).toBeGreaterThan(0);
    const p = playerCompany(w);
    const licensing = p.ledger.licensing + p.monthly.reduce((s, m) => s + m.ledger.licensing, 0);
    expect(licensing).toBeGreaterThan(0);
    expect(e.feesTotal + e.royaltiesTotal).toBeGreaterThan(0);
    // licensees really use it
    expect(Object.values(w.games).some((g) => g.engine === 'inhouse' && g.companyId !== p.id)).toBe(true);
  });

  it('subsidiaries use your engine without paying royalties', () => {
    const w = createWorld(opts);
    withEngine(w);
    const sub = Object.values(w.companies).find((c) => !c.isPlayer)!;
    sub.parentId = w.player.companyId;
    expect(engineStats(w, 'inhouse', false, sub).royalty).toBe(0);
    setLicensing(w, { licensing: true, royalty: 0.08 });
    const rival = Object.values(w.companies).find((c) => !c.isPlayer && c.id !== sub.id)!;
    expect(engineStats(w, 'inhouse', false, rival).royalty).toBe(0.08);
  });
});

describe('topics and combos', () => {
  it('grades are stable, legendary combos exist, and shipping reveals them', () => {
    expect(comboGrade('rpg', 'fantasy')).toBe('great');
    expect(comboGrade('fps', 'cooking')).toBe('bad');
    expect(comboGrade('racing', 'dinosaurs')).toBe('legendary');
    expect(legendaryCombo('racing', 'dinosaurs')).not.toBeNull();
    for (const t of TOPIC_IDS) expect(comboGrade('sports', t)).toBe(comboGrade('sports', t));
    const w = createWorld(opts);
    expect(comboHint(w, 'indie', 'cats')).toBeNull();
    const g = shipGame(w, 'cats');
    expect(w.player.combos['indie:cats']).toBe('great');
    expect(comboHint(w, 'indie', 'cats')).toBe('great');
    expect(g.topic).toBe('cats');
  });

  it('a legendary combo goes viral on release', () => {
    const w = createWorld(opts);
    const g = shipGame(w, 'dinosaurs', 'single', 'racing');
    expect(w.player.combos['racing:dinosaurs']).toBe('legendary');
    expect(g.viralUntil).toBeGreaterThan(w.day);
  });

  it('rival games get topics too', () => {
    const w = createWorld(opts);
    const rivals = Object.values(w.games).filter((g) => g.companyId !== w.player.companyId);
    expect(rivals.length).toBeGreaterThan(10);
    expect(rivals.every((g) => TOPIC_IDS.includes(g.topic))).toBe(true);
  });
});

describe('studio life', () => {
  it('remasters old classics with less work and nostalgia hype', () => {
    const w = createWorld(opts);
    const g = shipGame(w);
    expect(remasterBlocker(w, g)).toMatch(/months/);
    g.releaseDay = w.day - 4 * 365;
    g.criticScore = 82;
    g.owners = 300000;
    expect(remasterBlocker(w, g)).toBeNull();
    const r = startRemaster(w, g.id);
    expect(r.ok, r.error).toBe(true);
    const rm = w.games[r.id!];
    expect(rm.remasterOf).toBe(g.id);
    expect(rm.hype).toBeGreaterThan(100);
    expect(g.remastered).toBe(true);
    expect(startRemaster(w, g.id).ok).toBe(false);
  });

  it('certifies big sellers', () => {
    const w = createWorld(opts);
    const g = shipGame(w);
    g.owners = 1_200_000;
    const xp = w.player.progression.xp + w.player.progression.level * 1000;
    certificationsWeekly(w);
    expect(g.certified).toBe(3);
    expect(w.player.progression.xp + w.player.progression.level * 1000).toBeGreaterThan(xp);
  });

  it('facilities need a big enough office and change the studio', () => {
    const w = createWorld(opts);
    playerCompany(w).cash = 1e8;
    expect(buildFacility(w, 'testLab').ok).toBe(false);
    w.player.officeLevel = 3;
    expect(buildFacility(w, 'testLab').ok).toBe(true);
    expect(buildFacility(w, 'coffee').ok).toBe(true);
    const fx = facilityEffects(w);
    expect(fx.bugMult).toBeLessThan(1);
    expect(fx.morale).toBeGreaterThan(0);
  });

  it('legends are rare, brilliant and come with a story', () => {
    const w = createWorld(opts);
    const k = makeLegend(w)!;
    expect(k.skill).toBeGreaterThanOrEqual(92);
    expect(k.traits).toContain('legend');
    w.player.candidates.unshift(k);
    playerCompany(w).cash = 1e6;
    expect(hire(w, k.id).ok).toBe(true);
    expect(w.player.employees.find((e) => e.name === k.name)?.bio).toBe(k.bio);
  });

  it('your own convention brings fans, hype and ticket money', () => {
    const w = createWorld(opts);
    shipGame(w);
    playerCompany(w).reputation = 15;
    playerCompany(w).cash = 1e6;
    expect(hostConvention(w, 1).ok).toBe(false); // needs reputation 30
    expect(hostConvention(w, 0).ok).toBe(true);
    expect(hostConvention(w, 0).ok).toBe(false);
    advanceDays(w, 46);
    expect(w.player.conventionsHeld).toBe(1);
    expect(w.player.convention).toBeNull();
  });

  it('your own store earns a cut of PC sales', () => {
    const w = createWorld(opts);
    const p = playerCompany(w);
    p.cash = 1e9;
    expect(launchStore(w, 'Vault').ok).toBe(false); // reputation and catalogue
    p.reputation = 60;
    for (let i = 0; i < 3; i++) shipGame(w, TOPIC_IDS[i]);
    expect(launchStore(w, 'Vault').ok).toBe(true);
    const before = p.ledger.store;
    storeDaily(w);
    expect(p.ledger.store).toBeGreaterThan(before);
  });

  it('players write reviews that match the game', () => {
    const w = createWorld(opts);
    const g = shipGame(w);
    g.owners = 5000;
    const reviews = playerReviews(w, g, 4);
    expect(reviews.length).toBe(4);
    expect(new Set(reviews.map((r) => r.text)).size).toBe(4);
    expect(playerReviews(w, g, 4)).toEqual(reviews);
  });

  it('meme choices resolve cleanly', () => {
    const w = createWorld(opts);
    const g = shipGame(w);
    const rival = Object.values(w.companies).find((c) => !c.isPlayer)!;
    for (const [kind, ids] of [
      ['memeGlitch', ['feature', 'patch']],
      ['memeDiss', ['clap', 'high', 'ad']],
    ] as const) {
      for (const id of ids) {
        const ev = { id: 'x', day: w.day, kind, title: '', body: '', options: [], expiresDay: w.day, data: { gameId: g.id, rivalId: rival.id, cost: 1000 } };
        expect(resolveMeme(w, ev, id)).toBe(true);
      }
    }
  });

  it('the internet happens to popular games', () => {
    const w = createWorld({ ...opts, seed: 'memes-1' });
    const g = shipGame(w);
    g.owners = 500000;
    g.active = 50000;
    for (let d = 0; d < 365 * 3; d++) {
      advanceDay(w);
      g.active = Math.max(g.active, 20000);
      for (const ev of [...w.pendingEvents]) resolveDecision(w, ev.id, ev.defaultOption ?? ev.options[0].id);
    }
    const memes = Object.keys(w.player.flags).filter((k) => k.startsWith('meme:'));
    expect(memes.length).toBeGreaterThanOrEqual(3);
  });
});

describe('legacy', () => {
  it('head starts apply to a new run and runs are worth points', () => {
    const w = createWorld({ ...opts, legacy: { cash: 2, reputation: 1, garage: 1, perk: 1, engine: 1 } });
    expect(playerCompany(w).cash).toBe(100000);
    expect(playerCompany(w).reputation).toBeGreaterThanOrEqual(5);
    expect(w.player.officeLevel).toBe(1);
    expect(w.player.progression.perkPoints).toBeGreaterThanOrEqual(1);
    expect(w.player.engine).not.toBeNull();
    expect(retire(w).ok).toBe(true);
    expect(w.player.gameOver?.reason).toBe('retired');
    expect(legacyPointsFor(w)).toBeGreaterThan(0);
    expect(loadLegacy().points).toBeGreaterThanOrEqual(0); // no storage in tests: never throws
  });

  it('old saves get topics, certifications and their engine back', () => {
    const w = createWorld(opts);
    shipGame(w);
    w.player.research.completed.push('agile', 'engine1', 'engine2', 'engine3');
    const raw = JSON.parse(serializeWorld(w));
    raw.version = 3;
    for (const k of ['engine', 'combos', 'facilities', 'convention', 'conventionsHeld', 'store', 'legacy', 'legacyBanked']) delete raw.player[k];
    for (const id in raw.games) for (const k of ['topic', 'remasterOf', 'remastered', 'certified']) delete raw.games[id][k];
    for (const id in raw.companies) delete raw.companies[id].ledger.store;
    const m = deserializeWorld(JSON.stringify(raw));
    expect(m.player.engine?.version).toBe(3);
    expect(m.player.engine?.licensing).toBe(true);
    expect(Object.values(m.games).every((g) => TOPIC_IDS.includes(g.topic) && typeof g.certified === 'number')).toBe(true);
    advanceDays(m, 40);
    expect(Number.isFinite(playerCompany(m).cash)).toBe(true);
  });
});
