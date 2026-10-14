// Skip to next event, launch-day reveals and first-week reports, rival bosses.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { advanceDay, advanceDays } from '../tick';
import { createGame, releasePlayerGame } from '../actions';
import { focus } from '../constants';
import { deserializeWorld, serializeWorld } from '../save';
import { SKIP_MAX_DAYS, skipToNextEvent } from '../skip';
import { HOLD_WEEKS, PERSONA_IDS, overtakeXp, ensureNemesis, nemesis, personaOf, rivalReactToLaunch, rivalRecord, rivalryDaily, type PersonaId } from '../rivalry';
import type { Company, Game, World } from '../types';
import { activeCompanies, gamesOf, playerCompany } from '../util';

const opts = { seed: 'rivals-1', companyName: 'Underdog Games', founderName: 'U', specialty: 'designer' as const, difficulty: 'normal' as const, rivals: 24 };

function startGame(w: World, title = 'Big Swing'): Game {
  const founder = w.player.employees[0];
  const r = createGame(
    w,
    { title, genre: 'indie', topic: 'cats', platforms: ['pc', 'mobile'], audience: 'everyone', engine: 'pixelforge', monetization: 'premium', price: 4.99, artStyle: 'pixel', multiplayer: 'single', scope: 'tiny', budget: 500, focus: focus(1, 1, 1, 1, 1, 1) },
    [founder.id],
  );
  expect(r.ok, r.error).toBe(true);
  return w.games[r.id!];
}

function finish(w: World, g: Game): void {
  while (g.workDone < g.workRequired) advanceDay(w);
}

function rivalWith(w: World, persona: PersonaId): Company {
  const c = activeCompanies(w).find((x) => !x.isPlayer && personaOf(x) === persona);
  expect(c, `a ${persona} studio`).toBeTruthy();
  w.player.rivalId = c!.id;
  return c!;
}

describe('skip to next event', () => {
  it('stops when a game is ready to release', () => {
    const w = createWorld(opts);
    const g = startGame(w);
    const { days, reason } = skipToNextEvent(w);
    expect(days).toBeGreaterThan(0);
    expect(days).toBeLessThanOrEqual(SKIP_MAX_DAYS);
    // either the game finished or something else needed the player first
    if (reason.includes('ready to release')) expect(g.workDone).toBeGreaterThanOrEqual(g.workRequired);
  });

  it('does not stop straight away for a game that was already ready', () => {
    const w = createWorld(opts);
    const g = startGame(w);
    finish(w, g);
    const { reason } = skipToNextEvent(w);
    expect(reason).not.toContain(`${g.title} is ready`);
  });

  it('always stops within the quiet-stretch limit', () => {
    const w = createWorld(opts);
    for (let i = 0; i < 3; i++) {
      const { days } = skipToNextEvent(w);
      expect(days).toBeGreaterThan(0);
      expect(days).toBeLessThanOrEqual(SKIP_MAX_DAYS);
    }
  });
});

describe('launch day', () => {
  it('queues a reveal with the previous best score, and keeps the score out of the pop-up', () => {
    const w = createWorld(opts);
    const g = startGame(w);
    finish(w, g);
    w.toasts = [];
    expect(releasePlayerGame(w, g.id).ok).toBe(true);
    expect(w.launches).toHaveLength(1);
    expect(w.launches![0]).toMatchObject({ gameId: g.id, prevBest: 0 });
    expect(w.toasts.some((t) => t.title.includes('launched! Critics'))).toBe(false);
    expect(w.notices.some((n) => n.title.includes('launched! Critics'))).toBe(true);
    // reveals are for the screen, not the save file
    expect(JSON.parse(serializeWorld(w)).launches).toEqual([]);
  });

  it('reports the first week', () => {
    const w = createWorld(opts);
    const g = startGame(w);
    finish(w, g);
    releasePlayerGame(w, g.id);
    advanceDays(w, 8);
    const report = w.notices.find((n) => n.title === `${g.title}: first week`);
    expect(report).toBeTruthy();
    expect(report!.body).toMatch(/players · \$.* earned · #\d+ of \d+/);
  });
});

describe('rival bosses', () => {
  it('every studio boss has a stable personality', () => {
    const w = createWorld(opts);
    const seen = new Set(activeCompanies(w).filter((c) => !c.isPlayer).map(personaOf));
    expect(seen.size).toBeGreaterThanOrEqual(3);
    const c = activeCompanies(w).find((x) => !x.isPlayer)!;
    expect(personaOf(c)).toBe(personaOf(c));
    expect(PERSONA_IDS).toContain(personaOf(c));
  });

  it('your rival reacts to your launch and keeps a head-to-head record', () => {
    const w = createWorld(opts);
    const c = rivalWith(w, 'grump');
    const theirs = gamesOf(w, c.id).find((x) => x.releaseDay !== null)!;
    theirs.releaseDay = w.day;
    theirs.criticScore = 50;
    const g = startGame(w);
    finish(w, g);
    g.status = 'released';
    g.releaseDay = w.day;
    g.criticScore = 90;
    const line = rivalReactToLaunch(w, g);
    expect(line).toContain(c.ceo);
    expect(rivalRecord(w, c.id)).toEqual({ won: 1, lost: 0 });
    expect(w.player.rivalry.quotes[0].companyId).toBe(c.id);
  });

  it('the copycat clones your hit', () => {
    const w = createWorld(opts);
    const c = rivalWith(w, 'copycat');
    c.cash = 1e9;
    c.headcount = Math.max(c.headcount, 60);
    const g = startGame(w, 'Cat Odyssey');
    finish(w, g);
    g.status = 'released';
    g.releaseDay = w.day;
    g.criticScore = 92;
    const before = gamesOf(w, c.id).length;
    rivalReactToLaunch(w, g);
    const after = gamesOf(w, c.id);
    expect(after.length).toBe(before + 1);
    const clone = after[after.length - 1];
    expect(clone.status).toBe('development');
    expect(clone.genre).toBe(g.genre);
    expect(clone.topic).toBe(g.topic);
    expect(clone.title).toContain('Cat Odyssey');
  });

  it('the shark rushes a launch out to clash with yours', () => {
    const w = createWorld(opts);
    const c = rivalWith(w, 'shark');
    const g = startGame(w);
    finish(w, g);
    const theirs = gamesOf(w, c.id).find((x) => x.status === 'development') ?? gamesOf(w, c.id)[0];
    theirs.status = 'development';
    theirs.genre = g.genre;
    theirs.workDone = theirs.workRequired * 0.85;
    g.status = 'released';
    g.releaseDay = w.day;
    rivalReactToLaunch(w, g);
    // out today, unfinished
    expect(theirs.status).toBe('released');
    expect(theirs.releaseDay).toBe(w.day);
    expect(w.toasts.some((t) => t.title.includes('rushed'))).toBe(true);
  });

  it('overtaking your rival pays out and finds you a bigger one', () => {
    const w = createWorld(opts);
    const c = rivalWith(w, 'showboat');
    const p = playerCompany(w);
    w.player.rivalry.ahead = false;
    c.valuation = 1000;
    p.valuation = 5e6;
    const rep = p.reputation;
    const xp = w.player.progression.xp + w.player.progression.level * 1e6;
    const reward = overtakeXp(w);
    expect(reward).toBeGreaterThan(100);
    // a lead has to hold for a few weeks: one good week is not enough
    for (let week = 1; week <= HOLD_WEEKS; week++) {
      expect(w.player.rivalry.beaten).not.toContain(c.id);
      w.day += 7 - (w.day % 7);
      rivalryDaily(w);
    }
    expect(w.player.rivalry.beaten).toContain(c.id);
    expect(p.reputation).toBe(Math.min(100, rep + 3));
    expect(w.player.progression.xp + w.player.progression.level * 1e6).toBeGreaterThanOrEqual(xp + reward);
    const next = nemesis(w);
    if (next && next.id !== c.id) expect(next.valuation).toBeGreaterThan(p.valuation);
  });

  it('a lead that slips starts the count again', () => {
    const w = createWorld(opts);
    const c = rivalWith(w, 'grump');
    const p = playerCompany(w);
    w.player.rivalry.ahead = false;
    const week = () => {
      w.day += 7 - (w.day % 7);
      rivalryDaily(w);
    };
    p.valuation = c.valuation * 2;
    for (let i = 0; i < HOLD_WEEKS - 1; i++) week();
    expect(w.player.rivalry.leadWeeks).toBe(HOLD_WEEKS - 1);
    p.valuation = c.valuation / 2;
    week();
    expect(w.player.rivalry.leadWeeks).toBe(0);
    p.valuation = c.valuation * 2;
    week();
    expect(w.player.rivalry.beaten).not.toContain(c.id);
  });

  it('a new studio starts with a rival worth clearly more than it', () => {
    const w = createWorld(opts);
    const c = nemesis(w)!;
    expect(c).toBeTruthy();
    expect(c.valuation).toBeGreaterThanOrEqual(playerCompany(w).valuation * 1.5);
    expect(w.player.rivalry.ahead).toBe(false);
  });

  it('a rival that goes bust counts as beaten and is replaced', () => {
    const w = createWorld(opts);
    const c = rivalWith(w, 'sport');
    c.status = 'bankrupt';
    ensureNemesis(w);
    expect(w.player.rivalry.beaten).toContain(c.id);
    expect(nemesis(w)?.id).not.toBe(c.id);
  });

  it('old saves keep their rival without a free reward', () => {
    const w = createWorld(opts);
    const c = rivalWith(w, 'grump');
    const p = playerCompany(w);
    p.valuation = c.valuation * 10;
    const old = JSON.parse(serializeWorld(w));
    delete old.player.rivalry;
    const m = deserializeWorld(JSON.stringify(old));
    expect(m.player.rivalId).toBe(c.id);
    expect(m.player.rivalry.ahead).toBe(true);
    const beaten = m.player.rivalry.beaten.length;
    advanceDays(m, 14);
    expect(m.player.rivalry.beaten.length).toBe(beaten);
  });
});
