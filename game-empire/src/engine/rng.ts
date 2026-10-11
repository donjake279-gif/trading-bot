// Seeded, serialisable PRNG (mulberry32). The generator state lives on the
// World object so a saved game resumes the exact same random stream.

export interface RngHost {
  rng: number;
}

export function hashSeed(input: string | number): number {
  const s = String(input);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0 || 0x9e3779b9;
}

export function rand(host: RngHost): number {
  let t = (host.rng = (host.rng + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

export function randRange(host: RngHost, min: number, max: number): number {
  return min + (max - min) * rand(host);
}

export function randInt(host: RngHost, min: number, max: number): number {
  return Math.floor(randRange(host, min, max + 1));
}

export function chance(host: RngHost, p: number): boolean {
  return rand(host) < p;
}

/** Standard normal via Box-Muller. */
export function randNormal(host: RngHost, mean = 0, sd = 1): number {
  const u = Math.max(1e-12, rand(host));
  const v = rand(host);
  return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

export function pick<T>(host: RngHost, items: readonly T[]): T {
  return items[Math.floor(rand(host) * items.length)];
}

export function weightedPick<T>(host: RngHost, items: readonly T[], weights: readonly number[]): T {
  let total = 0;
  for (const w of weights) total += Math.max(0, w);
  if (total <= 0) return pick(host, items);
  let r = rand(host) * total;
  for (let i = 0; i < items.length; i++) {
    r -= Math.max(0, weights[i]);
    if (r <= 0) return items[i];
  }
  return items[items.length - 1];
}

export function shuffle<T>(host: RngHost, items: T[]): T[] {
  for (let i = items.length - 1; i > 0; i--) {
    const j = Math.floor(rand(host) * (i + 1));
    [items[i], items[j]] = [items[j], items[i]];
  }
  return items;
}
