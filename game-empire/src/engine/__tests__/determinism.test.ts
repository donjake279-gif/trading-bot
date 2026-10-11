import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { advanceDays } from '../tick';
import { deserializeWorld, serializeWorld } from '../save';
import { createGame, hire } from '../actions';
import { focus } from '../constants';

const opts = { seed: 'det-42', companyName: 'Det', founderName: 'D', specialty: 'programmer' as const, difficulty: 'normal' as const, rivals: 18 };

function fingerprint(w: ReturnType<typeof createWorld>): string {
  const comps = Object.values(w.companies).map((c) => `${c.name}:${c.cash.toFixed(2)}:${c.headcount}:${c.status}:${c.price.toFixed(4)}`);
  const games = Object.values(w.games).map((g) => `${g.title}:${g.active.toFixed(3)}:${g.status}`);
  return `${w.day}|${w.rng}|${comps.join(',')}|${games.length}|${games.slice(-30).join(',')}`;
}

describe('determinism and saves', () => {
  it('same seed produces the same world', () => {
    const a = createWorld(opts);
    const b = createWorld(opts);
    expect(fingerprint(a)).toBe(fingerprint(b));
    advanceDays(a, 200);
    advanceDays(b, 200);
    expect(fingerprint(a)).toBe(fingerprint(b));
  });

  it('a saved world resumes on the exact same timeline', () => {
    const a = createWorld(opts);
    const founder = a.player.employees[0];
    const r = createGame(a, { title: 'Det Game', genre: 'indie', platforms: ['pc'], audience: 'casual', engine: 'pixelforge', monetization: 'premium', price: 4.99, artStyle: 'pixel', multiplayer: 'single', scope: 'tiny', budget: 500, focus: focus(1, 1, 1, 1, 1, 1) }, [founder.id]);
    expect(r.ok).toBe(true);
    hire(a, a.player.candidates[a.player.candidates.length - 1].id);
    advanceDays(a, 120);
    const b = deserializeWorld(serializeWorld(a));
    advanceDays(a, 150);
    advanceDays(b, 150);
    expect(fingerprint(b)).toBe(fingerprint(a));
  });

  it('different seeds produce different industries', () => {
    const a = createWorld(opts);
    const b = createWorld({ ...opts, seed: 'det-43' });
    expect(fingerprint(a)).not.toBe(fingerprint(b));
  });
});
