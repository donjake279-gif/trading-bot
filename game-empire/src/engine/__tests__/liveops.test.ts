// Live-ops autopilot: every game gets updated, a contract crew makes sure
// updates ship on time, and content makes games permanently bigger.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { advanceDay, advanceDays } from '../tick';
import { createGame, releasePlayerGame, setAutoUpdates, setLiveOps } from '../actions';
import { focus } from '../constants';
import { CREW_TARGET_DAYS, crewFor, isAutoUpdated, pickAutoUpdate } from '../automation';
import { completeUpdate, contentLevelOf, versionLabel } from '../updates';
import type { Game, World } from '../types';
import { playerCompany } from '../util';

const opts = { seed: 'liveops-1', companyName: 'Patch Notes', founderName: 'P', specialty: 'programmer' as const, difficulty: 'normal' as const, rivals: 16 };

function liveGame(w: World): Game {
  const founder = w.player.employees[0];
  const r = createGame(
    w,
    { title: 'Forever Game', genre: 'indie', topic: 'cats', platforms: ['pc'], audience: 'everyone', engine: 'pixelforge', monetization: 'premium', price: 9.99, artStyle: 'pixel', multiplayer: 'online', scope: 'tiny', budget: 500, focus: focus(1, 1, 1, 1, 1, 1) },
    [founder.id],
  );
  expect(r.ok, r.error).toBe(true);
  const g = w.games[r.id!];
  while (g.workDone < g.workRequired) advanceDay(w);
  expect(releasePlayerGame(w, g.id).ok).toBe(true);
  return g;
}

/** Pretend the game is a big, busy hit. */
function makeHit(g: Game): void {
  g.scope = 'large';
  g.workRequired = 13000;
  g.budget = 4e6;
  g.owners = 2e6;
  g.active = 3e5;
  g.rev30 = 5e6;
  g.lastUpdateDay -= 100;
  g.bugs = 0;
}

describe('live ops', () => {
  it('auto-updates every game by default', () => {
    const w = createWorld(opts);
    expect(w.player.liveOps.auto).toBe(true);
    const g = liveGame(w);
    expect(isAutoUpdated(w, g)).toBe(true);
    expect(setAutoUpdates(w, g.id, false).ok).toBe(true);
    expect(isAutoUpdated(w, g)).toBe(false);
    setLiveOps(w, { auto: true });
    expect(isAutoUpdated(w, g)).toBe(true);
    setLiveOps(w, { auto: false });
    expect(isAutoUpdated(w, g)).toBe(false);
  });

  it('a contract crew ships big updates on time even when nobody is free', () => {
    const w = createWorld(opts);
    const g = liveGame(w);
    makeHit(g);
    playerCompany(w).cash = 1e8;
    for (const e of w.player.employees) e.assignment = 'busy-elsewhere';
    const pick = pickAutoUpdate(w, g)!;
    expect(pick).not.toBeNull();
    const { crew, cost } = crewFor(w, g, pick, 0);
    expect(crew).toBeGreaterThan(10);
    expect(cost).toBeGreaterThan(0);
    advanceDay(w);
    const plan = g.patchPlan!;
    const big = plan.backlog.find((i) => i.type !== 'hotfix')!;
    expect(big).toBeTruthy();
    advanceDay(w);
    expect(big.crew).toBeGreaterThan(0);
    advanceDays(w, CREW_TARGET_DAYS[big.type] + 20);
    expect(g.updates.some((u) => (u.items ?? [u.type]).includes(big.type))).toBe(true);
  });

  it('without a crew it waits for free developers', () => {
    const w = createWorld(opts);
    const g = liveGame(w);
    makeHit(g);
    playerCompany(w).cash = 1e8;
    setLiveOps(w, { crew: false });
    for (const e of w.player.employees) e.assignment = 'busy-elsewhere';
    advanceDays(w, 3);
    const plan = g.patchPlan!;
    expect(plan.backlog.length).toBeGreaterThan(0);
    expect(plan.backlog.every((i) => i.crew === 0 && i.done === 0)).toBe(true);
  });

  it('content makes games bigger, and expansions bump the version', () => {
    const w = createWorld(opts);
    const g = liveGame(w);
    expect(versionLabel(g)).toBe('v1.0');
    const c = playerCompany(w);
    const run = (type: 'content' | 'expansion') => {
      g.update = { type, workRequired: 1, workDone: 1, startDay: w.day, team: [], aiTeam: 1, cost: 0 };
      completeUpdate(w, g, c, 60);
    };
    run('content');
    run('content');
    expect(versionLabel(g)).toBe('v1.2');
    expect(contentLevelOf(g)).toBe(2);
    run('expansion');
    expect(versionLabel(g)).toBe('v2.0');
    expect(contentLevelOf(g)).toBe(5);
    expect(g.updates[g.updates.length - 1].label).toMatch(/v2\.0/);
  });

  it('bigger games keep more players', () => {
    const run = (level: number) => {
      const w = createWorld(opts);
      setLiveOps(w, { auto: false });
      const g = liveGame(w);
      g.contentLevel = level;
      advanceDays(w, 120);
      return g.owners;
    };
    expect(run(20)).toBeGreaterThan(run(0));
  });

  it('ports hits to the platforms they are missing', () => {
    const w = createWorld(opts);
    const g = liveGame(w);
    makeHit(g);
    g.releaseDay = w.day - 200;
    playerCompany(w).reputation = 60;
    const pick = pickAutoUpdate(w, g)!;
    expect(pick.type).toBe('port');
    expect(g.platforms).not.toContain(pick.platform);
  });

  it('does not waste money on games nobody plays', () => {
    const w = createWorld(opts);
    const g = liveGame(w);
    g.active = 5;
    g.rev30 = 10;
    g.lastUpdateDay -= 200;
    g.bugs = 0;
    expect(pickAutoUpdate(w, g)).toBeNull();
  });
});
