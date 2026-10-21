// Engine 2.0 and Anti-cheat 2.0.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { advanceDay, advanceDays } from '../tick';
import { engineStats } from '../development';
import { resolveDecision } from '../events';
import { deserializeWorld, serializeWorld } from '../save';
import { updateWork } from '../updates';
import {
  ENGINE_TEAM,
  activeDeal,
  adoptionChance,
  engineQualityBonus,
  engineSpeed,
  queueResearch,
  researchBlocker,
  researchSlots,
  resolveEngineDecision,
  royaltyWaived,
  setEngineArch,
  setEngineCrunch,
  setEngineFocus,
  setEngineSource,
  setLicensing,
  startRefactor,
  startResearch,
  studioEngineStats,
  foundEngine,
} from '../studioEngine';
import {
  AC_TEAM,
  acEffectiveness,
  acSpeed,
  antiCheatChurn,
  catchRate,
  cheatEstimate,
  falsePositiveRate,
  foundAntiCheat,
  layerPower,
  normalizeAntiCheat,
  pushSignatures,
  resolveAntiCheatDecision,
  setAcPolicy,
  startAcOp,
  startLayer,
} from '../anticheat';
import type { AntiCheat, Company, DecisionEvent, Employee, Game, StudioEngine, World } from '../types';
import { playerCompany } from '../util';

const opts = { seed: 'techops-1', companyName: 'Deep Tech', founderName: 'D', specialty: 'programmer' as const, difficulty: 'normal' as const, rivals: 20 };

function withEngine(): { w: World; e: StudioEngine } {
  const w = createWorld(opts);
  w.player.research.completed.push('agile', 'engine1');
  expect(foundEngine(w, 'Kraken').ok).toBe(true);
  playerCompany(w).cash = 1e10;
  return { w, e: w.player.engine! };
}

function hire(w: World, n: number, role: Employee['role'], assignment: string | null): Employee[] {
  const out: Employee[] = [];
  for (let i = 0; i < n; i++) {
    const e = { ...w.player.employees[0], id: `h${w.player.employees.length}`, name: `H${i}`, role, isFounder: false, skill: 70, morale: 90, assignment, traits: [] } as Employee;
    w.player.employees.push(e);
    out.push(e);
  }
  return out;
}

const rival = (w: World): Company => Object.values(w.companies).find((c) => !c.isPlayer && c.status === 'active' && !c.parentId)!;

function fakeGame(over: Partial<Game>): Game {
  return { engine: 'inhouse', multiplayer: 'single', artStyle: 'stylized', genre: 'indie', platforms: ['pc'], ...over } as Game;
}

describe('engine tech tree', () => {
  it('gates features by tier, prerequisites and version', () => {
    const { w, e } = withEngine();
    expect(researchBlocker(w, 'pbr')).toMatch(/Needs 1 rendering feature/);
    expect(researchBlocker(w, 'deterministic')).toMatch(/Needs/);
    expect(startResearch(w, 'toonShader').ok).toBe(true);
    // one slot without a team
    expect(researchBlocker(w, 'vehicles')).toMatch(/slot/);
    while (e.research.length) advanceDay(w);
    expect(e.features).toContain('toonShader');
    expect(e.modules.rendering).toBe(2);
    // can't push a module past the next version
    expect(researchBlocker(w, 'deferred')).toMatch(/Ship Kraken 2.0 first/);
  });

  it('an engine team adds research slots and speed, and the queue keeps them busy', () => {
    const { w, e } = withEngine();
    const solo = engineSpeed(w);
    hire(w, 8, 'programmer', ENGINE_TEAM);
    expect(engineSpeed(w)).toBeGreaterThan(solo * 1.8);
    expect(researchSlots(w)).toBe(3);
    for (const id of ['toonShader', 'vehicles', 'visualScript', 'dedicated', 'consoleSdk']) expect(queueResearch(w, id).ok).toBe(true);
    expect(e.research.length).toBe(3);
    expect(e.queue.length).toBe(2);
    advanceDays(w, 120);
    expect(e.features.length).toBe(5);
  });

  it('features make the engine good at specific kinds of games', () => {
    const { w, e } = withEngine();
    const stylized = fakeGame({ artStyle: 'stylized' });
    const realistic = fakeGame({ artStyle: 'realistic' });
    const before = [engineQualityBonus(w, stylized), engineQualityBonus(w, realistic)];
    e.features.push('toonShader');
    expect(engineQualityBonus(w, stylized)).toBeGreaterThan(before[0] + 2);
    expect(engineQualityBonus(w, realistic)).toBe(before[1]);
    // hot reload makes patches cheaper
    const g = fakeGame({ workRequired: 1000 } as Partial<Game>);
    const slow = updateWork(w, g, 'content', true);
    e.features.push('hotReload');
    expect(updateWork(w, g, 'content', true)).toBeLessThan(slow * 0.9);
    // genre templates
    expect(setEngineFocus(w, ['racing']).ok).toBe(true);
    expect(engineQualityBonus(w, fakeGame({ genre: 'racing' }))).toBeGreaterThan(engineQualityBonus(w, fakeGame({ genre: 'horror' })));
  });

  it('crunch is faster but piles up debt; refactoring pays it down and pauses research', () => {
    const { w, e } = withEngine();
    const normal = engineSpeed(w);
    setEngineCrunch(w, true);
    expect(engineSpeed(w)).toBeGreaterThan(normal * 1.3);
    startResearch(w, 'toonShader');
    const debt0 = e.debt;
    while (e.research.length) advanceDay(w);
    expect(e.debt).toBeGreaterThan(debt0 + 4);
    setEngineCrunch(w, false);
    expect(startRefactor(w).ok).toBe(true);
    expect(researchBlocker(w, 'vehicles')).toMatch(/refactoring/);
    const high = e.debt;
    advanceDays(w, 31);
    expect(e.debt).toBeLessThanOrEqual(Math.max(0, high - 15));
  });

  it('architecture trades quality, work and bugs, and big changes cost debt', () => {
    const { w, e } = withEngine();
    const base = studioEngineStats(w, null);
    const debt0 = e.debt;
    expect(setEngineArch(w, { performance: 70, usability: 15, stability: 15 }).ok).toBe(true);
    const perf = studioEngineStats(w, null);
    expect(perf.cap).toBeGreaterThan(base.cap);
    expect(perf.workMult).toBeGreaterThan(base.workMult);
    expect(e.debt).toBeGreaterThan(debt0 + 5);
    setEngineArch(w, { performance: 15, usability: 15, stability: 70 });
    e.debt = debt0;
    expect(studioEngineStats(w, null).bugMult).toBeLessThan(base.bugMult);
  });

  it('open source wins adoption but caps what you can charge; closing it again hurts', () => {
    const { w, e } = withEngine();
    setLicensing(w, { licensing: true, royalty: 0.08, fee: 200000 });
    const c = rival(w);
    const closed = adoptionChance(w, c, 'small');
    setEngineSource(w, 'open');
    expect(adoptionChance(w, c, 'small')).toBeGreaterThan(closed);
    expect(e.fee).toBe(0);
    expect(studioEngineStats(w, c).royalty).toBeLessThanOrEqual(0.02);
    e.hype = 80;
    const hype = e.hype;
    setEngineSource(w, 'closed');
    expect(e.hype).toBeLessThan(hype - 30);
  });

  it('royalty-free first million, enterprise deals and security holes', () => {
    const { w, e } = withEngine();
    setLicensing(w, { licensing: true, threshold: true });
    expect(royaltyWaived(w, fakeGame({ revenueTotal: 5e5 } as Partial<Game>))).toBe(true);
    expect(royaltyWaived(w, fakeGame({ revenueTotal: 5e6 } as Partial<Game>))).toBe(false);
    const c = rival(w);
    const deal: DecisionEvent = { id: 'd1', kind: 'engineDeal', title: '', body: '', options: [], data: { companyId: c.id, annual: 1.2e6 }, expiresDay: w.day + 30 } as unknown as DecisionEvent;
    expect(resolveEngineDecision(w, deal, 'accept')).toBe(true);
    expect(activeDeal(w, c.id)).toBe(true);
    expect(engineStats(w, 'inhouse', false, c).royalty).toBe(0);
    expect(adoptionChance(w, c, 'medium')).toBeGreaterThan(0.8);
    const vuln = { ...deal, id: 'd2', kind: 'engineVuln', data: { cost: 1000 } } as DecisionEvent;
    resolveEngineDecision(w, vuln, 'ignore');
    expect(e.vulnUntil).toBeGreaterThan(w.day);
  });

  it('old level-based engines become features, and research resumes after a save', () => {
    const { w, e } = withEngine();
    const raw = JSON.parse(serializeWorld(w));
    const old = raw.player.engine;
    for (const k of ['features', 'research', 'queue', 'versionLog', 'arch', 'debt', 'refactorUntil', 'crunch', 'focus', 'focusDay', 'source', 'threshold', 'support', 'satisfaction', 'deals', 'vulnUntil', 'log']) delete old[k];
    old.modules = { rendering: 3, physics: 3, tools: 3, networking: 3, platforms: 3, scripting: 2 };
    old.version = 2;
    old.upgrade = { module: 'scripting', daysLeft: 30, days: 90 };
    const m = deserializeWorld(JSON.stringify(raw));
    const me = m.player.engine!;
    expect(me.features.length).toBe(2 * 5 + 1);
    expect(me.research.length).toBe(1);
    expect(me.research[0].done).toBeGreaterThan(30);
    advanceDays(m, 60);
    expect(me.modules.scripting).toBe(3);
    void e;
  });
});

describe('anti-cheat layers and policy', () => {
  function withAc(): { w: World; ac: AntiCheat } {
    const w = createWorld(opts);
    w.player.research.completed.push('antiCheat');
    playerCompany(w).cash = 1e10;
    expect(foundAntiCheat(w, 'Iron Shield').ok).toBe(true);
    const ac = w.player.ventures.antiCheat!;
    ac.project = null;
    ac.queue = [];
    ac.version = 1;
    return { w, ac };
  }

  it('different layers stop different cheats', () => {
    const { w, ac } = withAc();
    ac.layers.serverAuth.level = 4;
    expect(catchRate(w, ac, 'speedhack')).toBeGreaterThan(catchRate(w, ac, 'aimbot') + 0.3);
    ac.layers.serverAuth.level = 0;
    ac.layers.kernel.level = 4;
    expect(catchRate(w, ac, 'aimbot')).toBeGreaterThan(catchRate(w, ac, 'exploits') + 0.3);
  });

  it('signatures go stale unless pushed', () => {
    const { w, ac } = withAc();
    ac.layers.signatures.level = 3;
    const fresh = layerPower(w, ac, 'signatures', 'aimbot');
    advanceDays(w, 60);
    expect(layerPower(w, ac, 'signatures', 'aimbot')).toBeLessThan(fresh - 15);
    expect(pushSignatures(w).ok).toBe(true);
    expect(layerPower(w, ac, 'signatures', 'aimbot')).toBe(fresh);
  });

  it('higher sensitivity catches more cheaters and bans more innocents', () => {
    const { w, ac } = withAc();
    ac.layers.heuristics.level = 3;
    setAcPolicy(w, { sensitivity: 20 });
    const low = [acEffectiveness(w), falsePositiveRate(ac)];
    setAcPolicy(w, { sensitivity: 90 });
    expect(acEffectiveness(w)).toBeGreaterThan(low[0]);
    expect(falsePositiveRate(ac)).toBeGreaterThan(low[1] * 5);
    expect(setAcPolicy(w, { penalty: 'hardware' }).ok).toBe(false);
    ac.layers.hwid.level = 1;
    expect(setAcPolicy(w, { penalty: 'hardware' }).ok).toBe(true);
  });

  it('cheaters ruin online games; a strong stack keeps them out', () => {
    const { w, ac } = withAc();
    const g = { multiplayer: 'online', genre: 'fps' } as Game;
    const p = playerCompany(w);
    ac.cheaters = 0.2;
    expect(antiCheatChurn(w, g, p)).toBeGreaterThan(1.3);
    ac.cheaters = 0.02;
    expect(antiCheatChurn(w, g, p)).toBeLessThan(0.85);
  });

  it('instant bans clear cheaters fastest; monthly waves teach cheat makers least', () => {
    const run = (mode: 'instant' | 'monthly') => {
      const { w, ac } = withAc();
      for (const l of ['signatures', 'heuristics', 'kernel'] as const) ac.layers[l].level = 4;
      ac.autoSig = true;
      setAcPolicy(w, { banMode: mode });
      ac.cheaters = 0.15;
      const before = { ...w.player.ventures.cheats! };
      advanceDays(w, 28);
      const after = w.player.ventures.cheats!;
      return { cheaters: ac.cheaters, learned: after.aimbot - before.aimbot };
    };
    const instant = run('instant');
    const monthly = run('monthly');
    expect(instant.cheaters).toBeLessThan(monthly.cheaters);
    expect(monthly.learned).toBeLessThan(instant.learned);
  });

  it('a security team builds faster; undercover buys, honeypots and lawsuits work', () => {
    const { w, ac } = withAc();
    const solo = acSpeed(w);
    hire(w, 6, 'qa', AC_TEAM);
    expect(acSpeed(w)).toBeGreaterThan(solo * 1.8);
    expect(startLayer(w, 'heuristics').ok).toBe(true);
    expect(cheatEstimate(w, 'bots').exact).toBe(false);
    expect(startAcOp(w, 'undercover', 'bots').ok).toBe(true);
    expect(startAcOp(w, 'honeypot', null).ok).toBe(true);
    expect(startAcOp(w, 'lawsuit', 'aimbot').ok).toBe(false); // two at once
    const data = ac.data;
    advanceDays(w, 50);
    expect(cheatEstimate(w, 'bots').exact).toBe(true);
    expect(ac.data).toBeGreaterThan(data + 15);
    expect(ac.layers.heuristics.level).toBe(1);
    const aimbot = w.player.ventures.cheats!.aimbot;
    expect(startAcOp(w, 'lawsuit', 'aimbot').ok).toBe(true);
    advanceDays(w, 125);
    expect(Math.abs(w.player.ventures.cheats!.aimbot - aimbot)).toBeGreaterThan(2);
  });

  it('false-ban scandals can be answered, and old saves are converted', () => {
    const { w, ac } = withAc();
    setAcPolicy(w, { sensitivity: 80 });
    const ev = { id: 'x', kind: 'acFalseBans', title: '', body: '', options: [], data: { cost: 1000 }, expiresDay: w.day + 21 } as unknown as DecisionEvent;
    expect(resolveAntiCheatDecision(w, ev, 'retune')).toBe(true);
    expect(ac.policy.sensitivity).toBe(60);
    // an old anti-cheat
    const old = { name: 'Old', version: 3, strength: 50, mode: 'kernel', building: null, licensing: true, fee: 0.03, licensees: [], revenue: 0, breachUntil: 0 } as unknown as AntiCheat;
    w.player.ventures.antiCheat = old;
    normalizeAntiCheat(w);
    expect(old.layers.signatures.level).toBe(3);
    expect(old.layers.kernel.level).toBe(3);
    expect(old.version).toBe(3 + 2 + 3);
    expect(acEffectiveness(w)).toBeGreaterThan(0.3);
    void resolveDecision;
  });
});
