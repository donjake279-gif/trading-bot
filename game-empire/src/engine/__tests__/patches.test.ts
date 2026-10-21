// The patch pipeline: bundled patches, live teams and release schedules.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { advanceDay, advanceDays } from '../tick';
import { createGame, releasePlayerGame, setAutoUpdates, setLiveOps } from '../actions';
import { focus } from '../constants';
import { deserializeWorld, serializeWorld } from '../save';
import {
  addPatchItems,
  liveLevel,
  movePatchItem,
  nextOnWeekday,
  planBacklog,
  planOf,
  setPatchPlan,
  setScheduleDefaults,
  shipPatchNow,
  weekdayOf,
} from '../patches';
import type { Game, World } from '../types';
import { playerCompany } from '../util';

const opts = { seed: 'patches-1', companyName: 'Patch Day', founderName: 'P', specialty: 'programmer' as const, difficulty: 'normal' as const, rivals: 16 };

function liveGame(w: World, auto = false): Game {
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
  setAutoUpdates(w, g.id, auto);
  playerCompany(w).cash = 1e8;
  return g;
}

/** Pretend the game is a busy hit. */
function makeHit(g: Game): void {
  g.scope = 'large';
  g.workRequired = 13000;
  g.budget = 4e6;
  g.owners = 2e6;
  g.active = 3e5;
  g.rev30 = 5e6;
  g.bugs = 0;
}

/** A few hires with known roles. */
function staff(w: World, roles: ('programmer' | 'artist' | 'designer' | 'qa')[]): string[] {
  const ids: string[] = [];
  for (const role of roles) {
    const e = { ...w.player.employees[0], id: `t${ids.length}${role}`, name: `${role} ${ids.length}`, role, isFounder: false, skill: 60, morale: 80, assignment: null, traits: [], liveXp: 0 };
    w.player.employees.push(e);
    ids.push(e.id);
  }
  return ids;
}

describe('patch schedule', () => {
  it('finds the next patch day on the chosen weekday', () => {
    for (let day = 100; day < 114; day++) {
      const d = nextOnWeekday(day, 2);
      expect(weekdayOf(d)).toBe(2);
      expect(d).toBeGreaterThan(day);
      expect(d - day).toBeLessThanOrEqual(7);
    }
  });

  it('ships every finished change together on patch day, every other Tuesday', () => {
    const w = createWorld(opts);
    const g = liveGame(w);
    g.bugs = 0;
    expect(setPatchPlan(w, g.id, { scheduled: true, weekday: 2, everyWeeks: 2, minItems: 1 }).ok).toBe(true);
    const plan = planOf(w, g);
    expect(weekdayOf(plan.nextDay)).toBe(2);
    const team = staff(w, ['programmer', 'programmer', 'designer', 'designer', 'qa']);
    expect(addPatchItems(w, g.id, [{ type: 'hotfix' }, { type: 'balance' }, { type: 'qol' }], team).ok).toBe(true);
    for (let i = 0; i < 60 && plan.patches === 0; i++) advanceDay(w);
    const first = w.day;
    const shipped = g.updates[g.updates.length - 1];
    expect(shipped.day).toBe(first);
    expect(weekdayOf(shipped.day)).toBe(2);
    expect(shipped.items!.length).toBe(3);
    expect(shipped.onTime).toBe(true);
    expect(shipped.notes!.length).toBeGreaterThanOrEqual(3);
    expect(shipped.label).toMatch(/^Patch v1\.0\.1/);
    expect(plan.nextDay).toBe(first + 14);
    expect(plan.streak).toBe(1);
    expect(plan.backlog.length).toBe(0);
  });

  it('builds a streak when patches land on time, and loses it when patch day slips', () => {
    const w = createWorld(opts);
    const g = liveGame(w);
    g.bugs = 0;
    setPatchPlan(w, g.id, { scheduled: true, weekday: 4, everyWeeks: 1 });
    const plan = planOf(w, g);
    const team = staff(w, ['designer', 'designer', 'designer', 'qa']);
    for (let i = 0; i < 3; i++) {
      addPatchItems(w, g.id, [{ type: 'balance' }], team);
      const day = plan.nextDay;
      while (w.day < day) advanceDay(w);
    }
    expect(plan.streak).toBe(3);
    // something big that can't be ready in a week, with nobody to build it
    setLiveOps(w, { crew: false });
    w.player.autoAssign = false;
    addPatchItems(w, g.id, [{ type: 'expansion' }], []);
    for (const e of w.player.employees) e.assignment = null;
    const day = plan.nextDay;
    while (w.day < day) advanceDay(w);
    expect(plan.streak).toBe(0);
    expect(plan.slipped).toBe(1);
    expect(plan.bestStreak).toBe(3);
  });

  it('can ship as soon as changes are ready instead', () => {
    const w = createWorld(opts);
    const g = liveGame(w);
    g.bugs = 0;
    setPatchPlan(w, g.id, { scheduled: false, minItems: 2 });
    addPatchItems(w, g.id, [{ type: 'hotfix' }, { type: 'performance' }], staff(w, ['programmer', 'programmer', 'qa']));
    const before = g.updates.length;
    for (let i = 0; i < 60 && g.patchPlan!.backlog.length; i++) advanceDay(w);
    expect(g.updates.length).toBe(before + 1);
    expect(g.updates[g.updates.length - 1].items).toEqual(['hotfix', 'performance']);
  });

  it('lets you ship early, reorder and remove changes', () => {
    const w = createWorld(opts);
    const g = liveGame(w);
    setPatchPlan(w, g.id, { scheduled: true, weekday: 1, everyWeeks: 8 });
    addPatchItems(w, g.id, [{ type: 'hotfix' }, { type: 'cosmetics' }, { type: 'qol' }], w.player.employees.map((e) => e.id));
    const plan = planOf(w, g);
    const last = plan.backlog[2].id;
    expect(movePatchItem(w, g.id, last, -2).ok).toBe(true);
    expect(plan.backlog[0].type).toBe('qol');
    expect(shipPatchNow(w, g.id).ok).toBe(false);
    for (let i = 0; i < 40 && !plan.backlog.some((x) => x.ready !== null); i++) advanceDay(w);
    expect(shipPatchNow(w, g.id).ok).toBe(true);
    expect(g.updates[g.updates.length - 1].onTime).toBeUndefined();
  });

  it('studio defaults apply to every live game', () => {
    const w = createWorld(opts);
    const g = liveGame(w);
    setScheduleDefaults(w, { weekday: 5, everyWeeks: 3, majorEvery: 2 }, true);
    expect(planOf(w, g).weekday).toBe(5);
    expect(planOf(w, g).everyWeeks).toBe(3);
    expect(weekdayOf(planOf(w, g).nextDay)).toBe(5);
  });
});

describe('live teams', () => {
  it('people work fastest on what their role is good at', () => {
    const run = (type: 'hotfix' | 'cosmetics') => {
      const w = createWorld(opts);
      const g = liveGame(w);
      makeHit(g);
      setPatchPlan(w, g.id, { scheduled: false, minItems: 6 });
      for (const e of w.player.employees) e.assignment = 'elsewhere';
      const artists = staff(w, ['artist', 'artist']);
      addPatchItems(w, g.id, [{ type }], artists);
      advanceDays(w, 5);
      return g.patchPlan!.backlog[0].done;
    };
    expect(run('cosmetics')).toBeGreaterThan(run('hotfix') * 1.4);
  });

  it('a dedicated team stays between patches and gains live-ops experience', () => {
    const w = createWorld(opts);
    const g = liveGame(w);
    const ids = staff(w, ['programmer', 'designer', 'qa']);
    for (const e of w.player.employees) if (!ids.includes(e.id)) e.assignment = 'elsewhere';
    setPatchPlan(w, g.id, { scheduled: true, weekday: 3, everyWeeks: 1, teamTarget: 3 });
    for (let i = 0; i < 6; i++) {
      addPatchItems(w, g.id, [{ type: 'balance' }, { type: 'qol' }], []);
      const day = planOf(w, g).nextDay;
      while (w.day < day) advanceDay(w);
    }
    const team = w.player.employees.filter((e) => e.assignment === g.id);
    expect(team.length).toBe(3);
    expect(Math.max(...team.map(liveLevel))).toBeGreaterThanOrEqual(1);
  });

  it('a public test server holds changes for a week and lets fewer bugs through', () => {
    const run = (testServer: boolean) => {
      const w = createWorld(opts);
      const g = liveGame(w);
      makeHit(g);
      setPatchPlan(w, g.id, { scheduled: false, minItems: 1, testServer });
      const team = staff(w, ['designer', 'designer', 'artist', 'artist', 'programmer']);
      addPatchItems(w, g.id, [{ type: 'content' }], team);
      let readyDay = 0;
      for (let i = 0; i < 400 && g.patchPlan!.backlog.length; i++) {
        advanceDay(w);
        const it = g.patchPlan!.backlog[0];
        if (it && it.ready !== null && !readyDay) readyDay = it.ready - w.day;
      }
      return { wait: readyDay, bugs: g.bugs };
    };
    const off = run(false);
    const on = run(true);
    expect(on.wait).toBeGreaterThanOrEqual(6);
    expect(off.wait).toBe(0);
    expect(on.bugs).toBeLessThan(off.bugs);
  });

  it('crunch speeds up the days before patch day and wears people down', () => {
    const w = createWorld(opts);
    const g = liveGame(w);
    makeHit(g);
    setPatchPlan(w, g.id, { scheduled: true, weekday: weekdayOf(w.day + 2), everyWeeks: 4, crunch: true, minItems: 6 });
    const ids = staff(w, ['designer', 'designer']);
    addPatchItems(w, g.id, [{ type: 'expansion' }], ids);
    const before = w.player.employees.find((e) => e.id === ids[0])!.morale;
    advanceDays(w, 2);
    expect(w.player.employees.find((e) => e.id === ids[0])!.morale).toBeLessThan(before);
  });
});

describe('the live-ops lead', () => {
  it('plans a varied backlog for a busy scheduled game, and nothing for a dead one', () => {
    const w = createWorld(opts);
    const g = liveGame(w, true);
    makeHit(g);
    g.releaseDay = w.day - 300;
    g.lastUpdateDay = w.day - 100;
    const plan = planOf(w, g);
    planBacklog(w, g, plan, 0);
    const types = plan.backlog.map((i) => i.type);
    expect(types.some((t) => t === 'content' || t === 'expansion' || t === 'port' || t === 'seasonal')).toBe(true);
    expect(types.some((t) => t === 'balance' || t === 'qol' || t === 'performance' || t === 'cosmetics')).toBe(true);
    expect(plan.backlog.every((i) => i.auto)).toBe(true);

    const dead = liveGame(w, true);
    dead.active = 5;
    dead.rev30 = 10;
    dead.bugs = 0;
    const deadPlan = planOf(w, dead);
    planBacklog(w, dead, deadPlan, 0);
    expect(deadPlan.backlog.length).toBe(0);
  });

  it('keeps an auto-updated hit patched on schedule for a year, with a major update along the way', () => {
    const w = createWorld(opts);
    const g = liveGame(w, true);
    makeHit(g);
    g.releaseDay = w.day - 300;
    setPatchPlan(w, g.id, { scheduled: true, weekday: 2, everyWeeks: 2, majorEvery: 3 });
    staff(w, ['programmer', 'designer', 'artist', 'qa']);
    const before = g.updates.length;
    for (let i = 0; i < 365; i++) {
      advanceDay(w);
      g.active = Math.max(g.active, 3e5);
      g.rev30 = Math.max(g.rev30, 5e6);
      playerCompany(w).cash = Math.max(playerCompany(w).cash, 1e8);
    }
    const patches = g.updates.slice(before).filter((u) => u.items);
    expect(patches.length).toBeGreaterThanOrEqual(8);
    expect(patches.every((u) => u.onTime || u.label.startsWith('Hotfix') || !u.onTime)).toBe(true);
    expect(patches.filter((u) => u.onTime).every((u) => weekdayOf(u.day) === 2)).toBe(true);
    expect(patches.some((u) => u.major)).toBe(true);
    expect(planOf(w, g).bestStreak).toBeGreaterThanOrEqual(3);
  });

  it('keeps a weekly schedule without slipping, and builds bundles when shipping as soon as ready', () => {
    const year = (settings: Parameters<typeof setPatchPlan>[2]) => {
      const w = createWorld(opts);
      const g = liveGame(w, true);
      makeHit(g);
      g.releaseDay = w.day - 300;
      w.player.autoAssign = false;
      setPatchPlan(w, g.id, { ...settings, teamTarget: 4 });
      staff(w, ['programmer', 'artist', 'designer', 'qa']);
      const before = g.updates.length;
      for (let i = 0; i < 240; i++) {
        advanceDay(w);
        g.active = Math.max(g.active, 3e5);
        g.rev30 = Math.max(g.rev30, 5e6);
        playerCompany(w).cash = Math.max(playerCompany(w).cash, 1e8);
      }
      const ups = g.updates.slice(before).filter((u) => u.items);
      return { plan: planOf(w, g), ups, size: ups.reduce((s, u) => s + u.items!.length, 0) / Math.max(1, ups.length) };
    };
    const weekly = year({ scheduled: true, weekday: 2, everyWeeks: 1 });
    expect(weekly.plan.slipped).toBeLessThanOrEqual(2);
    expect(weekly.plan.bestStreak).toBeGreaterThanOrEqual(20);
    const bundles = year({ scheduled: false, minItems: 3 });
    expect(bundles.size).toBeGreaterThanOrEqual(2.5);
  });

  it('ships a critical hotfix right away instead of waiting for patch day', () => {
    const w = createWorld(opts);
    const g = liveGame(w);
    g.active = 5000;
    setPatchPlan(w, g.id, { scheduled: true, weekday: weekdayOf(w.day + 1), everyWeeks: 8 });
    planOf(w, g).nextDay = w.day + 50;
    g.bugs = g.workRequired * 0.05;
    addPatchItems(w, g.id, [{ type: 'hotfix' }, { type: 'content' }], staff(w, ['programmer', 'programmer', 'qa']));
    const plan = planOf(w, g);
    for (let i = 0; i < 30 && plan.backlog.some((x) => x.type === 'hotfix'); i++) advanceDay(w);
    const last = g.updates[g.updates.length - 1];
    expect(last.label).toMatch(/^Hotfix/);
    expect(w.day).toBeLessThan(plan.nextDay);
    expect(plan.backlog.some((x) => x.type === 'content')).toBe(true);
  });
});

describe('saves', () => {
  it('turns an old in-progress update and queue into backlog items', () => {
    const w = createWorld(opts);
    const g = liveGame(w);
    const raw = JSON.parse(serializeWorld(w));
    const rg = raw.games[g.id];
    delete rg.patchPlan;
    rg.update = { type: 'content', workRequired: 20, workDone: 12, startDay: w.day - 5, team: [], aiTeam: 0, cost: 900 };
    rg.updateQueue = [{ type: 'balance' }, { type: 'hotfix' }];
    const m = deserializeWorld(JSON.stringify(raw));
    const mg = m.games[g.id];
    expect(mg.update).toBeNull();
    expect(mg.updateQueue).toEqual([]);
    expect(mg.patchPlan!.backlog.map((i) => i.type)).toEqual(['content', 'balance', 'hotfix']);
    expect(mg.patchPlan!.backlog[0].done).toBe(12);
    expect(mg.patchPlan!.backlog[0].paid).toBe(true);
    advanceDays(m, 40);
  });

  it('a saved game resumes on exactly the same patch timeline', () => {
    const w = createWorld(opts);
    const g = liveGame(w, true);
    makeHit(g);
    staff(w, ['programmer', 'designer']);
    advanceDays(w, 30);
    const copy = deserializeWorld(serializeWorld(w));
    advanceDays(w, 90);
    advanceDays(copy, 90);
    expect(JSON.stringify(copy.games[g.id].updates)).toBe(JSON.stringify(w.games[g.id].updates));
    expect(JSON.stringify(copy.games[g.id].patchPlan)).toBe(JSON.stringify(w.games[g.id].patchPlan));
  });
});
