// Empire levels and ventures: anti-cheat, consoles, AI lab, films, theme parks.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { advanceDay, advanceDays } from '../tick';
import { createGame, releasePlayerGame } from '../actions';
import { focus } from '../constants';
import { resolveDecision } from '../events';
import { deserializeWorld, serializeWorld } from '../save';
import { EMPIRE_CHALLENGES, EMPIRE_LEVELS, criticPenalty, empireLevel, empireMonthly, empireUpkeep, empireWeekly, resolveEmpire } from '../empire';
import {
  AI_LAB_COST,
  acBuildCost,
  acBuildDays,
  acEffectiveness,
  addLand,
  aiLead,
  aiSpeedBoost,
  aiTrainCost,
  aiTrainDays,
  buildPark,
  consoleDevDays,
  consoleRdCost,
  designConsole,
  foundAiLab,
  foundAntiCheat,
  greenlightFilm,
  landCost,
  parkCost,
  startAntiCheatVersion,
  startTraining,
  venturesMonthly,
  ventureBlocker,
} from '../ventures';
import { playerSpeedMods } from '../development';
import type { AntiCheat, DecisionEvent, Game, World } from '../types';
import { normalizeAntiCheat } from '../anticheat';
import { playerCompany } from '../util';

const opts = { seed: 'empire-1', companyName: 'Mega Corp', founderName: 'M', specialty: 'designer' as const, difficulty: 'normal' as const, rivals: 20 };

function rich(cash = 1.2e12): World {
  const w = createWorld(opts);
  const p = playerCompany(w);
  p.cash = cash;
  p.valuation = cash;
  p.reputation = 80;
  w.player.research.completed.push('antiCheat', 'aiTools', 'netcode');
  return w;
}

function shipGame(w: World): Game {
  const founder = w.player.employees[0];
  const r = createGame(
    w,
    { title: 'Franchise', genre: 'indie', topic: 'cats', platforms: ['pc', 'console'], audience: 'everyone', engine: 'pixelforge', monetization: 'premium', price: 9.99, artStyle: 'pixel', multiplayer: 'online', scope: 'tiny', budget: 500, focus: focus(1, 1, 1, 1, 1, 1) },
    [founder.id],
  );
  expect(r.ok, r.error).toBe(true);
  const g = w.games[r.id!];
  while (g.workDone < g.workRequired) advanceDay(w);
  expect(releasePlayerGame(w, g.id).ok).toBe(true);
  return g;
}

function decision(w: World, kind: string, data: DecisionEvent['data']): DecisionEvent {
  return { id: `d-${kind}`, day: w.day, kind, title: kind, body: '', options: [], data, expiresDay: w.day + 30 };
}

describe('empire levels', () => {
  it('climb with valuation and get harder', () => {
    const w = createWorld(opts);
    const p = playerCompany(w);
    for (let i = 0; i < EMPIRE_LEVELS.length; i++) {
      p.valuation = EMPIRE_LEVELS[i].min + 1;
      expect(empireLevel(w)).toBe(i);
    }
    for (let i = 1; i < EMPIRE_LEVELS.length; i++) {
      const a = EMPIRE_LEVELS[i - 1];
      const b = EMPIRE_LEVELS[i];
      expect(b.overhead).toBeGreaterThanOrEqual(a.overhead);
      expect(b.antitrust).toBeGreaterThanOrEqual(a.antitrust);
      expect(b.rivalPace).toBeGreaterThanOrEqual(a.rivalPace);
    }
    p.valuation = 1.5e12;
    expect(criticPenalty(w)).toBe(3);
  });

  it('charges upkeep every month, more for bigger empires', () => {
    const small = rich(2e9);
    const big = rich(1.2e12);
    expect(empireUpkeep(small).total).toBeLessThan(empireUpkeep(big).total);
    const cash = playerCompany(big).cash;
    big.pendingEvents = [];
    empireMonthly(big);
    expect(playerCompany(big).cash).toBeLessThan(cash);
    expect(big.player.empire.overheadPaid).toBeGreaterThan(0);
  });

  it('antitrust: settling pays a fine, a decree halves platform income, court can go either way', () => {
    const w = rich();
    const p = playerCompany(w);
    const cash = p.cash;
    resolveEmpire(w, decision(w, 'antitrust', { fine: 1e9, fees: 1e8 }), 'settle');
    expect(p.cash).toBe(cash - 1e9);
    expect(w.player.empire.finesPaid).toBe(1e9);
    resolveEmpire(w, decision(w, 'antitrust', { fine: 1e9, fees: 1e8 }), 'decree');
    expect(w.player.empire.decreeUntil).toBe(w.day + 365);
    const before = w.player.empire.courtWins + w.player.empire.finesPaid;
    resolveEmpire(w, decision(w, 'antitrust', { fine: 1e9, fees: 1e8 }), 'fight');
    expect(w.player.empire.courtWins + w.player.empire.finesPaid).toBeGreaterThan(before);
  });

  it('crises: recognising a union raises pay and morale', () => {
    const w = rich();
    const k = w.player.candidates[0];
    w.player.employees.push({ ...w.player.employees[0], id: 'e-x', isFounder: false, role: k.role, salary: 5000, morale: 50 });
    resolveEmpire(w, decision(w, 'union', {}), 'recognise');
    const e = w.player.employees.find((x) => x.id === 'e-x')!;
    expect(e.salary).toBe(5300);
    expect(e.morale).toBe(65);
  });

  it('a big empire gets investigated and the game keeps running', () => {
    const w = rich();
    let seen = false;
    // about 8% a month at this level: four years makes a miss very unlikely
    for (let d = 0; d < 1460 && !seen; d++) {
      advanceDay(w);
      seen = w.pendingEvents.some((e) => e.kind === 'antitrust');
      for (const ev of [...w.pendingEvents]) resolveDecision(w, ev.id, ev.defaultOption ?? ev.options[ev.options.length - 1].id);
    }
    expect(seen).toBe(true);
    expect(Number.isFinite(playerCompany(w).cash)).toBe(true);
  });

  it('clearing a level\'s challenges pays out perk points', () => {
    const w = rich(2e8);
    w.player.empire.best = 1;
    const perks = w.player.progression.perkPoints;
    w.player.stats.gamesReleased = 10;
    w.player.ventures.antiCheat = { name: 'X', version: 1, strength: 40, mode: 'standard', building: null, licensing: false, fee: 0.03, licensees: [], revenue: 0, breachUntil: 0 } as unknown as AntiCheat;
    normalizeAntiCheat(w);
    w.awardsHistory.push({ year: 2026, category: 'Best Indie', gameId: 'g', companyId: w.player.companyId } as never);
    empireWeekly(w);
    expect(EMPIRE_CHALLENGES.filter((c) => c.level === 1).every((c) => w.player.empire.done.includes(c.id))).toBe(true);
    expect(w.player.empire.cleared).toContain(1);
    expect(w.player.progression.perkPoints).toBeGreaterThanOrEqual(perks + 2); // plus any studio levels from the XP
  });
});

describe('anti-cheat', () => {
  it('ships layers, falls behind cheat makers, and each level costs more', () => {
    const w = rich(5e8);
    expect(acBuildCost(2)).toBeGreaterThan(acBuildCost(1) * 2);
    expect(foundAntiCheat(w, 'Iron Shield').ok).toBe(true);
    advanceDays(w, acBuildDays(1) + 1);
    const ac = w.player.ventures.antiCheat!;
    expect(ac.version).toBe(1);
    expect(ac.layers.signatures.level).toBe(1);
    const fresh = acEffectiveness(w);
    expect(fresh).toBeGreaterThan(0.1);
    const cheats = w.player.ventures.cheats!;
    for (const t of Object.keys(cheats) as (keyof typeof cheats)[]) cheats[t] += 30; // two years of cheat makers
    expect(acEffectiveness(w)).toBeLessThan(fresh);
    // the queued behaviour-analysis layer started on its own
    expect(ac.project?.layer).toBe('heuristics');
    expect(startAntiCheatVersion(w).ok).toBe(false);
  });

  it('sells licences to rival studios with online games', () => {
    const w = rich(5e8);
    advanceDays(w, 200); // let rivals ship online games
    expect(foundAntiCheat(w, 'Iron Shield').ok).toBe(true);
    advanceDays(w, acBuildDays(1) + 1);
    const ac = w.player.ventures.antiCheat!;
    for (const l of ['signatures', 'heuristics', 'kernel', 'serverAuth'] as const) ac.layers[l].level = 5;
    for (let m = 0; m < 24 && ac.revenue === 0; m++) venturesMonthly(w);
    expect(ac.licensees.length).toBeGreaterThan(0);
    expect(ac.revenue).toBeGreaterThan(0);
  });
});

describe('consoles', () => {
  it('launch, sell, and the next generation costs more', () => {
    const w = rich();
    shipGame(w);
    expect(consoleRdCost(2, 'home')).toBe(consoleRdCost(1, 'home') * 2.5);
    expect(designConsole(w, { name: 'GameBox', size: 'home', price: 449 }).ok).toBe(true);
    expect(designConsole(w, { name: 'GameBox 2', size: 'home', price: 449 }).ok).toBe(false);
    advanceDays(w, consoleDevDays(1, 'home') + 30);
    const c = w.player.ventures.consoles[0];
    expect(c.stage).toBe('live');
    expect(c.installed).toBeGreaterThan(100000);
    expect(c.revenue).toBeGreaterThan(0);
    expect(playerCompany(w).monthly.some((m) => m.ledger.hardware > 0)).toBe(true);
  });

  it('is locked for small studios', () => {
    const w = createWorld(opts);
    expect(ventureBlocker(w, 'consoles')).toMatch(/valuation/);
    expect(designConsole(w, { name: 'Nope', size: 'home', price: 449 }).ok).toBe(false);
  });
});

describe('ai lab', () => {
  it('trains models that speed up your own developers', () => {
    const w = rich();
    expect(aiTrainCost(w, 3)).toBeGreaterThan(aiTrainCost(w, 2) * 2.5);
    const speed = playerSpeedMods(w);
    const cash = playerCompany(w).cash;
    expect(foundAiLab(w, 'Deep Mind Games').ok).toBe(true);
    expect(playerCompany(w).cash).toBe(cash - AI_LAB_COST);
    let models = 0;
    for (let tries = 0; tries < 4 && models === 0; tries++) {
      expect(startTraining(w).ok).toBe(true);
      advanceDays(w, aiTrainDays(1) + 1);
      models = w.player.ventures.ai!.models.length;
    }
    expect(models).toBe(1);
    expect(aiLead(w)).toBeGreaterThan(0);
    expect(aiSpeedBoost(w)).toBeGreaterThan(1);
    expect(playerSpeedMods(w)).toBeGreaterThan(speed);
    advanceDays(w, 30);
    expect(w.player.ventures.ai!.revenue).toBeGreaterThan(0);
  });
});

describe('films and theme parks', () => {
  it('a film of your game earns its box office over three months', () => {
    const w = rich();
    const g = shipGame(w);
    g.owners = 20e6;
    expect(greenlightFilm(w, g.id, 0).ok).toBe(true);
    expect(greenlightFilm(w, g.id, 0).ok).toBe(false); // already shooting
    advanceDays(w, 241);
    const f = w.player.ventures.films[0];
    expect(f.stage).toBe('released');
    expect(f.score).toBeGreaterThan(0);
    expect(f.gross).toBeGreaterThan(0);
    advanceDays(w, 95);
    expect(f.earned).toBeCloseTo(f.gross, -3);
  });

  it('parks open after a year, get pricier, and lands add visitors', () => {
    const w = rich();
    const g = shipGame(w);
    const first = parkCost(w);
    expect(buildPark(w, 'na', 'Cat Kingdom').ok).toBe(true);
    expect(parkCost(w)).toBeGreaterThan(first);
    const park = w.player.ventures.parks[0];
    const lc = landCost(park);
    expect(addLand(w, park.id, g.ipId).ok).toBe(true);
    expect(addLand(w, park.id, g.ipId).ok).toBe(false);
    expect(landCost(park)).toBeGreaterThan(lc);
    advanceDays(w, 366);
    expect(park.stage).toBe('open');
    advanceDays(w, 20);
    expect(park.revenue).toBeGreaterThan(0);
  });
});

describe('saves', () => {
  it('ventures survive a save and old saves get defaults', () => {
    const w = rich();
    foundAntiCheat(w, 'Shield');
    designConsole(w, { name: 'Box', size: 'handheld', price: 199 });
    const m = deserializeWorld(serializeWorld(w));
    expect(m.player.ventures.antiCheat?.name).toBe('Shield');
    expect(m.player.ventures.consoles).toHaveLength(1);

    const old = JSON.parse(serializeWorld(createWorld(opts)));
    delete old.player.ventures;
    delete old.player.empire;
    const migrated = deserializeWorld(JSON.stringify(old));
    expect(migrated.player.ventures.consoles).toEqual([]);
    expect(migrated.player.empire.best).toBe(0);
    advanceDays(migrated, 40);
    expect(Number.isFinite(playerCompany(migrated).cash)).toBe(true);
  });
});
