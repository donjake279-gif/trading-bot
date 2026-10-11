// Economy diagnostics: cost vs. first-year revenue for each game scope with a
// reasonable team. Prints a table; asserts only basic sanity.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { advanceDay } from '../tick';
import { createGame, releasePlayerGame } from '../actions';
import { makeCandidate, makeEmployee } from '../staff';
import { GENRES, recommendedBudgetFor } from './helpers';
import type { GenreId, MonetizationId, PlatformId, RoleId, ScopeId, World } from '../types';
import { playerCompany } from '../util';

const fmt = (n: number) => {
  const a = Math.abs(n);
  if (a >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `$${(n / 1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
};

interface Case {
  scope: ScopeId;
  genre: GenreId;
  team: [RoleId, number][];
  skill: number;
  platforms: PlatformId[];
  monetization: MonetizationId;
  price: number;
  office: number;
  rep: number;
}

const CASES: Case[] = [
  { scope: 'tiny', genre: 'indie', team: [], skill: 45, platforms: ['pc'], monetization: 'premium', price: 4.99, office: 0, rep: 0 },
  { scope: 'small', genre: 'indie', team: [['programmer', 1], ['artist', 1], ['designer', 1]], skill: 40, platforms: ['pc'], monetization: 'premium', price: 12.99, office: 1, rep: 5 },
  { scope: 'small', genre: 'horror', team: [['programmer', 1], ['artist', 1], ['audio', 1]], skill: 40, platforms: ['pc'], monetization: 'premium', price: 12.99, office: 1, rep: 5 },
  { scope: 'medium', genre: 'survival', team: [['programmer', 4], ['artist', 3], ['designer', 2], ['audio', 1], ['qa', 1], ['producer', 1]], skill: 50, platforms: ['pc', 'console'], monetization: 'premium', price: 24.99, office: 2, rep: 20 },
  { scope: 'medium', genre: 'battleRoyale', team: [['programmer', 4], ['artist', 3], ['designer', 2], ['audio', 1], ['qa', 1], ['producer', 1]], skill: 50, platforms: ['pc', 'console'], monetization: 'f2pCosmetic', price: 0, office: 2, rep: 20 },
  { scope: 'large', genre: 'rpg', team: [['programmer', 12], ['artist', 12], ['designer', 8], ['writer', 5], ['audio', 3], ['qa', 4], ['producer', 2]], skill: 58, platforms: ['pc', 'console'], monetization: 'premium', price: 49.99, office: 4, rep: 40 },
  { scope: 'large', genre: 'fps', team: [['programmer', 14], ['artist', 12], ['designer', 8], ['audio', 4], ['qa', 5], ['producer', 2]], skill: 70, platforms: ['pc', 'console'], monetization: 'premium', price: 49.99, office: 4, rep: 50 },
  { scope: 'aaa', genre: 'fps', team: [['programmer', 70], ['artist', 55], ['designer', 40], ['writer', 8], ['audio', 18], ['qa', 18], ['producer', 8]], skill: 80, platforms: ['pc', 'console'], monetization: 'premium', price: 69.99, office: 5, rep: 70 },
  { scope: 'aaa', genre: 'openWorld', team: [['programmer', 60], ['artist', 60], ['designer', 35], ['writer', 15], ['audio', 10], ['qa', 15], ['producer', 6]], skill: 65, platforms: ['pc', 'console'], monetization: 'premium', price: 69.99, office: 5, rep: 60 },
];

function runCase(cs: Case, seed: string) {
  const w: World = createWorld({ seed, companyName: 'Econ', founderName: 'F', specialty: 'designer', difficulty: 'normal', rivals: 22 });
  const c = playerCompany(w);
  c.cash = 1e10;
  c.reputation = cs.rep;
  w.player.officeLevel = cs.office;
  const founder = w.player.employees[0];
  founder.skill = cs.skill;
  const ids = [founder.id];
  for (const [role, n] of cs.team) {
    for (let i = 0; i < n; i++) {
      const k = makeCandidate(w, role, cs.skill);
      k.skill = cs.skill;
      const e = makeEmployee(w, k);
      w.player.employees.push(e);
      ids.push(e.id);
    }
  }
  const art = cs.scope === 'aaa' || cs.scope === 'large' ? 'realistic' : cs.scope === 'medium' ? 'stylized' : 'pixel';
  const engine = cs.scope === 'aaa' ? 'titan' : cs.scope === 'large' ? 'titan' : cs.scope === 'medium' ? 'nimbus' : 'pixelforge';
  const mp = cs.genre === 'battleRoyale' || cs.genre === 'survival' || cs.genre === 'fps' ? 'online' : 'single';
  const budget = recommendedBudgetFor(cs.scope, art, cs.platforms);
  const res = createGame(
    w,
    {
      title: `Test ${cs.scope}`,
      genre: cs.genre,
      platforms: cs.platforms,
      audience: cs.genre === 'battleRoyale' ? 'teens' : cs.genre === 'indie' ? 'casual' : 'youngAdults',
      engine,
      monetization: cs.monetization,
      price: cs.price,
      artStyle: art,
      multiplayer: mp,
      scope: cs.scope,
      budget,
      focus: { ...GENRES[cs.genre].ideal },
    },
    ids,
  );
  expect(res.ok, res.error).toBe(true);
  const g = w.games[res.id!];
  const startCash = c.cash;
  const startDay = w.day;
  let polish = 0;
  while (g.status === 'development' && w.day - startDay < 2000) {
    advanceDay(w);
    if (g.workDone >= g.workRequired) polish++;
    if (polish > Math.max(7, (w.day - startDay) * 0.05)) releasePlayerGame(w, g.id);
  }
  const devDays = w.day - startDay;
  const devCost = startCash - c.cash;
  // keep the team idle on payroll during the launch year (realistic burn)
  for (let i = 0; i < 365; i++) advanceDay(w);
  return { devDays, devCost, critic: g.criticScore, rev: g.revenueTotal, owners: g.owners, peakCcu: g.peakCcu, active: g.active, team: ids.length };
}

describe('economy by scope', () => {
  it('prints cost vs revenue table', () => {
    const rows: string[] = [];
    for (const cs of CASES) {
      for (const seed of ['econ-a', 'econ-b']) {
        const r = runCase(cs, seed);
        rows.push(
          `${cs.scope.padEnd(7)} ${cs.genre.padEnd(13)} ${cs.monetization.padEnd(12)} team ${String(r.team).padStart(3)} dev ${String(r.devDays).padStart(4)}d cost ${fmt(r.devCost).padStart(8)} critic ${r.critic} yr1 rev ${fmt(r.rev).padStart(8)} owners ${Math.round(r.owners).toLocaleString().padStart(11)} peakCCU ${Math.round(r.peakCcu).toLocaleString().padStart(9)} ROI ${(r.rev / Math.max(1, r.devCost)).toFixed(2)}`,
        );
      }
    }
    console.log(rows.join('\n'));
    expect(rows.length).toBe(CASES.length * 2);
  });
});
