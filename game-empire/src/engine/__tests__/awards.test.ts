// The Game Awards season, game jams and critic reviews.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { advanceDay, advanceDays } from '../tick';
import { createGame, releasePlayerGame } from '../actions';
import { resolveDecision } from '../events';
import { deserializeWorld, serializeWorld } from '../save';
import { focus } from '../constants';
import { AWARD_CATEGORIES, CAMPAIGN_TIERS, announceNominations, bookPremiere, holdCeremony, playerNominations, predictGoty, runAwardCampaign, scoreCategories } from '../awards';
import { criticReviews } from '../reviews';
import type { Game, World } from '../types';
import { dayToDate, playerCompany } from '../util';

const opts = { seed: 'awards-1', companyName: 'Statuette Games', founderName: 'S', specialty: 'designer' as const, difficulty: 'normal' as const, rivals: 24 };

function shipGame(w: World, title = 'Contender'): Game {
  const founder = w.player.employees[0];
  const r = createGame(
    w,
    { title, genre: 'indie', topic: 'cats', platforms: ['pc', 'mobile'], audience: 'everyone', engine: 'pixelforge', monetization: 'premium', price: 4.99, artStyle: 'pixel', multiplayer: 'single', scope: 'tiny', budget: 500, focus: focus(1, 1, 1, 1, 1, 1) },
    [founder.id],
  );
  expect(r.ok, r.error).toBe(true);
  const g = w.games[r.id!];
  while (g.workDone < g.workRequired) advanceDay(w);
  expect(releasePlayerGame(w, g.id).ok).toBe(true);
  return g;
}

function runUntil(w: World, month: number, date: number): void {
  for (let i = 0; i < 400; i++) {
    const d = dayToDate(w.day);
    if (d.getUTCMonth() === month && d.getUTCDate() === date) return;
    advanceDay(w);
    for (const ev of [...w.pendingEvents]) resolveDecision(w, ev.id, ev.defaultOption ?? ev.options[ev.options.length - 1].id);
  }
}

describe('the game awards', () => {
  it('nominates in November and crowns winners in December', () => {
    const w = createWorld(opts);
    runUntil(w, 10, 19);
    const s = w.awardSeason!;
    expect(s).not.toBeNull();
    expect(s.categories.some((c) => c.id === 'goty')).toBe(true);
    expect(s.categories.length).toBeGreaterThanOrEqual(6);
    for (const c of s.categories) expect(c.nominees.length).toBeLessThanOrEqual(5);
    expect(s.done).toBe(false);
    runUntil(w, 11, 13);
    expect(s.done).toBe(true);
    expect(s.categories.every((c) => c.winnerId)).toBe(true);
    expect(w.awardArchive[w.awardArchive.length - 1]).toBe(s);
    const goty = s.categories.find((c) => c.id === 'goty')!;
    const winner = w.games[goty.winnerId!];
    expect(winner.awards.some((a) => a.startsWith('Game of the Year'))).toBe(true);
    expect(w.awardsHistory.some((a) => a.category === AWARD_CATEGORIES.goty.name && a.year === s.year)).toBe(true);
    expect(s.highlights.length).toBeGreaterThan(0);
  });

  it('your nominated games can campaign, and a great campaign and prediction pay off', () => {
    const w = createWorld(opts);
    const g = shipGame(w);
    g.criticScore = 96;
    g.userScore = 95;
    g.owners = 2_000_000;
    g.peakActive = 500_000;
    runUntil(w, 10, 19);
    const s = w.awardSeason!;
    const mine = playerNominations(w);
    expect(mine.length).toBeGreaterThan(0);
    const p = playerCompany(w);
    p.cash = 1e8;
    for (let t = CAMPAIGN_TIERS.length - 1; t >= 0; t--) runAwardCampaign(w, g.id, t);
    expect(s.campaigns[g.id]).toBe(7);
    expect(runAwardCampaign(w, g.id, 0).ok).toBe(false);
    const gotyNoms = s.categories.find((c) => c.id === 'goty')!.nominees;
    expect(predictGoty(w, gotyNoms[0].id).ok).toBe(true);
    expect(predictGoty(w, 'nope').ok).toBe(false);
    const xp = w.player.progression.xp + w.player.progression.level * 10000;
    holdCeremony(w);
    expect(s.done).toBe(true);
    const wins = s.categories.filter((c) => c.winnerId === g.id && c.id !== 'glitch');
    expect(wins.length).toBeGreaterThan(0);
    expect(w.player.progression.xp + w.player.progression.level * 10000).toBeGreaterThan(xp);
    expect(w.celebrations.length).toBeGreaterThan(0);
    expect(runAwardCampaign(w, g.id, 0).ok).toBe(false); // season over
  });

  it('world premieres hype a game in development', () => {
    const w = createWorld(opts);
    shipGame(w);
    runUntil(w, 10, 19);
    const founder = w.player.employees[0];
    const r = createGame(
      w,
      { title: 'Next Big Thing', genre: 'rpg', topic: 'fantasy', platforms: ['pc'], audience: 'adults', engine: 'nimbus', monetization: 'premium', price: 19.99, artStyle: 'stylized', multiplayer: 'single', scope: 'small', budget: 2000, focus: focus(1, 1, 1, 1, 1, 1) },
      [founder.id],
    );
    expect(r.ok, r.error).toBe(true);
    playerCompany(w).cash = 1e6;
    expect(bookPremiere(w, r.id!).ok).toBe(true);
    expect(bookPremiere(w, r.id!).ok).toBe(false);
    const hype = w.games[r.id!].hype;
    holdCeremony(w);
    expect(w.games[r.id!].hype).toBeGreaterThan(hype + 100);
  });

  it('every category can find candidates in a busy year', () => {
    const w = createWorld({ ...opts, seed: 'awards-busy', rivals: 30 });
    advanceDays(w, 365);
    const scored = scoreCategories(w, w.day - 365, w.day);
    const filled = Object.values(scored).filter((list) => list.length >= 2).length;
    expect(filled).toBeGreaterThanOrEqual(9);
  });

  it('survives a save and load mid-season', () => {
    const w = createWorld(opts);
    runUntil(w, 10, 19);
    expect(w.awardSeason).not.toBeNull();
    const m = deserializeWorld(serializeWorld(w));
    runUntil(m, 11, 13);
    expect(m.awardSeason?.done).toBe(true);
  });

  it('announcing twice in a day is harmless', () => {
    const w = createWorld(opts);
    runUntil(w, 10, 18);
    announceNominations(w);
    expect(w.awardSeason?.done).toBe(false);
  });
});

describe('game jam', () => {
  it('ships a tiny game and fills the combo book', () => {
    const w2 = createWorld({ ...opts, seed: 'jam-2' });
    for (let i = 0; i < 400; i++) {
      advanceDay(w2);
      const jam = w2.pendingEvents.find((e) => e.kind === 'gameJam');
      if (jam) {
        const before = Object.keys(w2.player.combos).length;
        const opt = jam.options.find((o) => o.id.startsWith('jam:'))!;
        resolveDecision(w2, jam.id, opt.id);
        const jamGame = Object.values(w2.games).find((g) => g.companyId === w2.player.companyId && g.price === 0.99);
        expect(jamGame?.status).toBe('released');
        expect(Object.keys(w2.player.combos).length).toBeGreaterThanOrEqual(before);
        return;
      }
      for (const e of [...w2.pendingEvents]) resolveDecision(w2, e.id, e.defaultOption ?? e.options[e.options.length - 1].id);
    }
    throw new Error('no game jam within a year');
  });
});

describe('critics', () => {
  it('outlets review around the critic score and stay stable', () => {
    const w = createWorld(opts);
    const g = shipGame(w);
    const reviews = criticReviews(g, 5);
    expect(reviews.length).toBe(5);
    for (const r of reviews) expect(Math.abs(r.score - g.criticScore)).toBeLessThanOrEqual(6);
    expect(criticReviews(g, 5)).toEqual(reviews);
    expect(new Set(reviews.map((r) => r.quote)).size).toBe(5);
  });
});
