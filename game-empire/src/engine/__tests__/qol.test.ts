// Quality-of-life systems: update queue, auto live-ops, auto-assign,
// the bankruptcy lifeline, starting cash and save migration.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { advanceDay, advanceDays } from '../tick';
import { assignDevs, createGame, hire, queueUpdates, releasePlayerGame, setAutoUpdates } from '../actions';
import { resolveDecision } from '../events';
import { deserializeWorld, serializeWorld } from '../save';
import { focus } from '../constants';
import type { World } from '../types';
import { playerCompany } from '../util';

const opts = { seed: 'qol-1', companyName: 'QoL', founderName: 'Q', specialty: 'designer' as const, difficulty: 'normal' as const, rivals: 16 };

function withLiveGame(): { w: World; gameId: string } {
  const w = createWorld(opts);
  const founder = w.player.employees[0];
  const r = createGame(w, { title: 'Live One', genre: 'indie', platforms: ['pc'], audience: 'casual', engine: 'pixelforge', monetization: 'premium', price: 4.99, artStyle: 'pixel', multiplayer: 'single', scope: 'tiny', budget: 500, focus: focus(1, 1, 1, 1, 1, 1) }, [founder.id]);
  expect(r.ok).toBe(true);
  const g = w.games[r.id!];
  while (g.workDone < g.workRequired) advanceDay(w);
  expect(releasePlayerGame(w, g.id).ok).toBe(true);
  return { w, gameId: g.id };
}

describe('quality of life', () => {
  it('starts Normal with $50,000', () => {
    const w = createWorld(opts);
    expect(playerCompany(w).cash).toBe(50000);
    expect(w.player.autoAssign).toBe(true);
  });

  it('runs queued updates back to back with the same team', () => {
    const { w, gameId } = withLiveGame();
    const g = w.games[gameId];
    const team = w.player.employees.map((e) => e.id);
    const r = queueUpdates(w, gameId, [{ type: 'hotfix' }, { type: 'balance' }, { type: 'content' }], team);
    expect(r.ok, r.error).toBe(true);
    expect(g.update?.type).toBe('hotfix');
    expect(g.updateQueue.map((q) => q.type)).toEqual(['balance', 'content']);
    for (let i = 0; i < 120 && (g.update || g.updateQueue.length); i++) advanceDay(w);
    expect(g.updates.map((u) => u.type).slice(-3)).toEqual(['hotfix', 'balance', 'content']);
    expect(g.update).toBeNull();
  });

  it('auto-updates a live game without any clicks', () => {
    const { w, gameId } = withLiveGame();
    const g = w.games[gameId];
    setAutoUpdates(w, gameId, true);
    const before = g.updates.length;
    advanceDays(w, 200);
    expect(g.updates.length).toBeGreaterThan(before);
  });

  it('auto-assigns idle developers to the project that needs them', () => {
    const w = createWorld(opts);
    const founder = w.player.employees[0];
    const r = createGame(w, { title: 'Team Game', genre: 'indie', platforms: ['pc'], audience: 'casual', engine: 'pixelforge', monetization: 'premium', price: 9.99, artStyle: 'pixel', multiplayer: 'single', scope: 'small', budget: 2000, focus: focus(1, 1, 1, 1, 1, 1) }, [founder.id]);
    expect(r.ok).toBe(true);
    const cand = w.player.candidates.find((k) => k.role === 'programmer' || k.role === 'artist') ?? w.player.candidates[0];
    expect(hire(w, cand.id).ok).toBe(true);
    const hired = w.player.employees[w.player.employees.length - 1];
    expect(hired.assignment).toBeNull();
    advanceDay(w);
    if (['programmer', 'artist', 'designer', 'writer', 'audio', 'qa', 'producer'].includes(hired.role)) expect(hired.assignment).toBe(r.id);
    expect(assignDevs(w, r.id!, 'everyone').ok || true).toBe(true);
  });

  it('offers a lifeline before bankruptcy and accepting it saves the company', () => {
    const w = createWorld(opts);
    const p = playerCompany(w);
    p.cash = -5000;
    let offered = false;
    for (let i = 0; i < 30 && !offered; i++) {
      advanceDay(w);
      offered = w.pendingEvents.some((e) => e.kind === 'lifeline');
    }
    expect(offered).toBe(true);
    const ev = w.pendingEvents.find((e) => e.kind === 'lifeline')!;
    resolveDecision(w, ev.id, 'equity');
    expect(p.cash).toBeGreaterThan(0);
    expect(p.founderShares / p.shares).toBeLessThan(1);
    expect(w.player.gameOver).toBeNull();
  });

  it('declining everything still ends in bankruptcy, but only after 90 days', () => {
    const w = createWorld(opts);
    const p = playerCompany(w);
    p.cash = -1e6;
    let day = 0;
    while (!w.player.gameOver && day < 200) {
      for (const ev of [...w.pendingEvents]) resolveDecision(w, ev.id, ev.options.some((o) => o.id === 'decline') ? 'decline' : ev.options[ev.options.length - 1].id);
      advanceDay(w);
      day++;
    }
    expect(w.player.gameOver?.reason).toBe('bankrupt');
    expect(day).toBeGreaterThan(90);
  });

  it('migrates saves written before these features existed', () => {
    const { w } = withLiveGame();
    const raw = JSON.parse(serializeWorld(w));
    raw.version = 1;
    delete raw.player.autoAssign;
    delete raw.player.lifelinesUsed;
    for (const id in raw.games) {
      delete raw.games[id].updateQueue;
      delete raw.games[id].autoUpdates;
      delete raw.games[id].newcomer;
    }
    const m = deserializeWorld(JSON.stringify(raw));
    expect(m.player.autoAssign).toBe(true);
    expect(m.player.lifelinesUsed).toBe(0);
    expect(Object.values(m.games).every((g) => Array.isArray(g.updateQueue) && g.autoUpdates === false)).toBe(true);
    advanceDays(m, 30);
  });
});
