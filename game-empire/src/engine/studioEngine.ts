// Your own game engine, Unreal-style. Found it after the research, then
// upgrade six tech modules, ship major versions, and license it to rival
// studios for an upfront fee and a royalty on their revenue. Your
// subsidiaries use it for free.
import { ENGINES, ENGINE_MAX_LEVEL, ENGINE_MODULES, ENGINE_MODULE_IDS, ROLES, SCOPE_IDS, engineShowcaseCost, engineUpgradeCost } from './constants';
import { addXp } from './progression';
import { chance } from './rng';
import type { ActionResult, Company, EngineId, EngineModuleId, Game, ScopeId, StudioEngine, World } from './types';
import { clamp, earn, playerCompany, pushNews, spend, toast } from './util';

export const DEFAULT_ROYALTY = 0.05;

function hasResearchDone(w: World, id: string): boolean {
  return (w.player.research.completed as string[]).includes(id);
}

export function newStudioEngine(w: World, name: string, level = 1): StudioEngine {
  const modules = {} as StudioEngine['modules'];
  for (const m of ENGINE_MODULE_IDS) modules[m] = level;
  return {
    name,
    foundedDay: w.day,
    version: level,
    modules,
    upgrade: null,
    licensing: false,
    royalty: DEFAULT_ROYALTY,
    fee: 0,
    hype: 10,
    royaltiesTotal: 0,
    feesTotal: 0,
    gamesBuilt: 0,
  };
}

export function suggestEngineName(w: World): string {
  const p = playerCompany(w);
  const first = p.name.split(' ')[0] || 'Studio';
  const pool = ['Phoenix', 'Kraken', 'Nova', 'Aurora', 'Titanium', 'Quasar', 'Vortex', 'Ember', 'Monolith', 'Prism'];
  const pick = pool[Math.abs(p.name.length * 7 + first.charCodeAt(0)) % pool.length];
  return first.length <= 10 && chance(w, 0.5) ? `${first} Engine` : `${pick} Engine`;
}

export function canFoundEngine(w: World): string | null {
  if (w.player.engine) return 'You already have an engine.';
  if (!hasResearchDone(w, 'engine1')) return 'Research "Found Your Own Engine" first (Office & R&D).';
  return null;
}

export function foundEngine(w: World, name: string): ActionResult {
  const blocker = canFoundEngine(w);
  if (blocker) return { ok: false, error: blocker };
  const clean = name.trim().slice(0, 40);
  if (!clean) return { ok: false, error: 'Give your engine a name.' };
  w.player.engine = newStudioEngine(w, clean);
  const p = playerCompany(w);
  pushNews(w, { kind: 'player', title: `${p.name} unveils ${clean} 1.0`, body: 'A brand-new game engine built in-house.', companyId: p.id, tone: 'major' });
  toast(w, `${clean} 1.0 is ready`, 'good', { category: 'studio', link: { route: 'engine' }, body: 'Pick it when you start your next game. Upgrade modules to ship 2.0.' });
  addXp(w, 120);
  return { ok: true };
}

export function renameEngine(w: World, name: string): ActionResult {
  const e = w.player.engine;
  if (!e) return { ok: false, error: 'No engine yet.' };
  const clean = name.trim().slice(0, 40);
  if (!clean) return { ok: false, error: 'Give your engine a name.' };
  e.name = clean;
  return { ok: true };
}

/** Migrate saves from the old v1/v2/v3 research ladder. */
export function migrateEngine(w: World): void {
  if (w.player.engine) return;
  w.player.engine = null;
  if (!hasResearchDone(w, 'engine1')) return;
  const level = hasResearchDone(w, 'engine3') ? 3 : hasResearchDone(w, 'engine2') ? 2 : 1;
  const e = newStudioEngine(w, `${playerCompany(w)?.name.split(' ')[0] ?? 'Studio'} Engine`, level);
  e.licensing = level >= 3;
  w.player.engine = e;
}

// ------------------------------------------------------------ stats

/** Average module level, 1..5. */
export function engineLevel(e: StudioEngine): number {
  let t = 0;
  for (const m of ENGINE_MODULE_IDS) t += e.modules[m];
  return t / ENGINE_MODULE_IDS.length;
}

/** Overall tech score, 0..100, comparable to the commercial engines. */
export function engineScore(e: StudioEngine): number {
  return Math.round(40 + 12 * engineLevel(e));
}

/** Rough score for the commercial engines, for comparisons in the UI. */
export const COMMERCIAL_SCORES: Partial<Record<EngineId, number>> = { pixelforge: 48, nimbus: 62, titan: 80, apex: 92 };

export interface EngineStats {
  name: string;
  licenseCost: number;
  royalty: number;
  cap: number;
  workMult: number;
  bugMult: number;
  minRep: number;
  blurb: string;
}

/** Stats a game built on your engine gets. `forCompany` decides what the user pays. */
export function studioEngineStats(w: World, forCompany: Company | null): EngineStats {
  const e = w.player.engine;
  const base = ENGINES.inhouse;
  if (!e) return { ...base };
  const m = e.modules;
  const own = !forCompany || forCompany.isPlayer || forCompany.parentId === w.player.companyId;
  return {
    name: e.name,
    licenseCost: own ? 0 : e.fee,
    royalty: own ? 0 : e.royalty,
    cap: Math.min(100, 78 + m.rendering * 3 + m.physics * 1.4),
    workMult: 0.92 - 0.04 * m.tools,
    bugMult: 0.98 - 0.04 * m.scripting,
    minRep: 0,
    blurb: `Your engine, version ${e.version}.0.`,
  };
}

/** Extra quality a game gets from specialised modules. */
export function engineQualityBonus(w: World, g: Pick<Game, 'engine' | 'multiplayer' | 'artStyle'>): number {
  const e = w.player.engine;
  if (!e || g.engine !== 'inhouse') return 0;
  let q = 0;
  if (g.multiplayer === 'online' || g.multiplayer === 'massive') q += 0.8 * (e.modules.networking - 1);
  if (g.artStyle === 'realistic' || g.artStyle === 'photoreal') q += 0.6 * (e.modules.rendering - 1);
  return q;
}

/** Server-cost discount for your own online games from the networking module. */
export function engineServerDiscount(w: World): number {
  const e = w.player.engine;
  return e ? 0.03 * (e.modules.networking - 1) : 0;
}

/** Port and multi-platform work discount from the platform module. */
export function enginePortDiscount(w: World, engine: EngineId): number {
  const e = w.player.engine;
  return e && engine === 'inhouse' ? 0.08 * (e.modules.platforms - 1) : 0;
}

export function engineDisplayName(w: World, id: EngineId): string {
  return id === 'inhouse' && w.player.engine ? w.player.engine.name : ENGINES[id].name;
}

// ------------------------------------------------------------ upgrades & versions

export function moduleUpgradeBlocker(w: World, m: EngineModuleId): string | null {
  const e = w.player.engine;
  if (!e) return 'Found your engine first.';
  if (e.upgrade) return `Already upgrading ${ENGINE_MODULES[e.upgrade.module].name}.`;
  const lvl = e.modules[m];
  if (lvl >= ENGINE_MAX_LEVEL) return 'Maxed out.';
  if (lvl > e.version) return `Ship ${e.name} ${e.version + 1}.0 first.`;
  const { cost } = engineUpgradeCost(lvl);
  if (playerCompany(w).cash < cost) return `Costs $${cost.toLocaleString()}.`;
  return null;
}

/** Programmers on staff speed up engine work (up to twice as fast). */
export function engineTeamSpeed(w: World): number {
  let prog = 0;
  for (const e of w.player.employees) if (e.role === 'programmer' || (e.isFounder && e.specialty === 'programmer')) prog += 1;
  return 1 + Math.min(1, prog / 30);
}

export function upgradeDays(w: World, m: EngineModuleId): number {
  const e = w.player.engine;
  if (!e) return 0;
  return Math.ceil(engineUpgradeCost(e.modules[m]).days / engineTeamSpeed(w));
}

export function startModuleUpgrade(w: World, m: EngineModuleId): ActionResult {
  const blocker = moduleUpgradeBlocker(w, m);
  if (blocker) return { ok: false, error: blocker };
  const e = w.player.engine!;
  const { cost } = engineUpgradeCost(e.modules[m]);
  spend(playerCompany(w), 'research', cost);
  const days = upgradeDays(w, m);
  e.upgrade = { module: m, daysLeft: days, days };
  return { ok: true };
}

export function readyForVersion(e: StudioEngine): boolean {
  return e.version < ENGINE_MAX_LEVEL && ENGINE_MODULE_IDS.every((m) => e.modules[m] > e.version);
}

export function releaseEngineVersion(w: World, showcase: boolean): ActionResult {
  const e = w.player.engine;
  if (!e) return { ok: false, error: 'No engine yet.' };
  if (!readyForVersion(e)) return { ok: false, error: `Every module must reach level ${e.version + 1} first.` };
  const p = playerCompany(w);
  const next = e.version + 1;
  const cost = showcase ? engineShowcaseCost(next) : 0;
  if (p.cash < cost) return { ok: false, error: 'Not enough cash for the showcase.' };
  if (cost > 0) spend(p, 'marketing', cost);
  e.version = next;
  e.hype = clamp(e.hype + (showcase ? 45 : 20), 0, 100);
  p.reputation = Math.min(100, p.reputation + (showcase ? 3 : 1));
  addXp(w, 150 * next);
  pushNews(w, {
    kind: 'player',
    title: `${p.name} ships ${e.name} ${next}.0`,
    body: showcase ? 'A jaw-dropping tech demo has developers everywhere talking.' : 'A quiet release with big improvements under the hood.',
    companyId: p.id,
    tone: 'major',
  });
  toast(w, `${e.name} ${next}.0 is out!`, 'good', { category: 'studio', link: { route: 'engine' }, body: e.licensing ? 'Rival studios are taking a fresh look at licensing it.' : 'Open licensing to earn from rival studios.' });
  return { ok: true };
}

export function setLicensing(w: World, patch: { licensing?: boolean; royalty?: number; fee?: number }): ActionResult {
  const e = w.player.engine;
  if (!e) return { ok: false, error: 'No engine yet.' };
  if (patch.licensing !== undefined) e.licensing = patch.licensing;
  if (patch.royalty !== undefined) e.royalty = clamp(patch.royalty, 0, 0.15);
  if (patch.fee !== undefined) e.fee = clamp(Math.round(patch.fee), 0, 5e6);
  return { ok: true };
}

/** Daily: progress upgrades, let buzz settle, keep Titan honest. */
export function engineDaily(w: World): void {
  const e = w.player.engine;
  if (!e) return;
  e.hype = Math.max(0, e.hype * 0.9985);
  const u = e.upgrade;
  if (u) {
    u.daysLeft -= 1;
    if (u.daysLeft <= 0) {
      e.modules[u.module] += 1;
      e.upgrade = null;
      addXp(w, 25 * e.modules[u.module]);
      toast(w, `${e.name}: ${ENGINE_MODULES[u.module].name} upgraded to level ${e.modules[u.module]}`, 'good', {
        category: 'studio',
        link: { route: 'engine' },
        body: readyForVersion(e) ? `Every module is ready: ship ${e.name} ${e.version + 1}.0!` : undefined,
      });
    }
  }
}

// ------------------------------------------------------------ licensing market

/** Chance a rival studio picks your engine for a new project. */
export function adoptionChance(w: World, c: Company, scope: ScopeId): number {
  const e = w.player.engine;
  if (!e || !e.licensing || c.isPlayer) return 0;
  const sIdx = SCOPE_IDS.indexOf(scope);
  const score = engineScore(e);
  const rival = sIdx >= 4 ? 92 : 80;
  let p = 0.06 + (score - rival) / 90 + e.hype / 400;
  // price sensitivity: royalty against Titan's, fee against the project's size
  p += (w.market.titanRoyalty - e.royalty) * (sIdx <= 1 ? 6 : 4);
  p -= e.fee / (40000 * Math.pow(4, sIdx));
  if (c.talent > 75 && score < 70) p -= 0.05;
  return clamp(p, 0, 0.55);
}

/** Called when a rival starts a project on your engine. */
export function chargeLicenseFee(w: World, c: Company, g: Game): void {
  const e = w.player.engine;
  const p = playerCompany(w);
  if (!e || !p || p.status !== 'active') return;
  if (c.parentId === p.id) return;
  e.gamesBuilt += 1;
  if (e.fee > 0) {
    c.cash -= e.fee;
    earn(p, 'licensing', e.fee);
    e.feesTotal += e.fee;
  }
  if (e.gamesBuilt === 1) {
    toast(w, `${c.name} licensed ${e.name} for ${g.title}`, 'good', { category: 'studio', link: { route: 'engine' }, body: 'Your first licensee! Royalties arrive once the game earns money.' });
  } else if (SCOPE_IDS.indexOf(g.scope) >= 3) {
    toast(w, `${c.name} is building ${g.title} on ${e.name}`, 'good', { category: 'studio', link: { route: 'engine' }, silent: true });
  }
}

/** A licensee's game earned royalties today. */
export function collectRoyalty(w: World, amount: number): void {
  const e = w.player.engine;
  const p = playerCompany(w);
  if (!e || !p || p.status !== 'active' || !(amount > 0)) return;
  earn(p, 'licensing', amount);
  e.royaltiesTotal += amount;
}

/** Hits built on your engine make it more attractive. */
export function engineHitFeedback(w: World, g: Game): void {
  const e = w.player.engine;
  if (!e || g.engine !== 'inhouse') return;
  if (g.criticScore >= 85) e.hype = clamp(e.hype + 5, 0, 100);
  else if (g.criticScore >= 75) e.hype = clamp(e.hype + 2, 0, 100);
  else if (g.criticScore < 50) e.hype = clamp(e.hype - 2, 0, 100);
}

/** Share of rival projects (in development or live) built on each engine. */
export function engineMarketShare(w: World): { id: EngineId; games: number }[] {
  const counts = new Map<EngineId, number>();
  for (const id in w.games) {
    const g = w.games[id];
    if (g.status !== 'development' && g.status !== 'released') continue;
    if (g.companyId === w.player.companyId) continue;
    counts.set(g.engine, (counts.get(g.engine) ?? 0) + 1);
  }
  return [...counts.entries()].map(([id, games]) => ({ id, games })).sort((a, b) => b.games - a.games);
}

/** Monthly: if your engine is eating Titan's lunch, Titan fights back with lower royalties. */
export function engineWarsMonthly(w: World): void {
  const e = w.player.engine;
  if (!e || !e.licensing) return;
  const share = engineMarketShare(w);
  const total = share.reduce((s, x) => s + x.games, 0);
  const mine = share.find((x) => x.id === 'inhouse')?.games ?? 0;
  if (total > 0 && mine / total > 0.15 && w.market.titanRoyalty > 0.03 && chance(w, 0.25)) {
    w.market.titanRoyalty = Math.max(0.03, w.market.titanRoyalty - 0.005);
    pushNews(w, { kind: 'industry', title: `Titan Engine cuts royalties to ${(w.market.titanRoyalty * 100).toFixed(1)}% as ${e.name} gains ground`, tone: 'major' });
    toast(w, `Engine wars: Titan cut its royalty to ${(w.market.titanRoyalty * 100).toFixed(1)}%`, 'neutral', { category: 'industry', link: { route: 'engine' }, body: `${e.name} now powers ${Math.round((mine / total) * 100)}% of rival projects.` });
  }
}

/** Number of programmers counts for the UI. */
export function programmerCount(w: World): number {
  return w.player.employees.filter((e) => ROLES[e.role].dev && (e.role === 'programmer' || (e.isFounder && e.specialty === 'programmer'))).length;
}
