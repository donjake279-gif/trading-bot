// Your own game engine, Unreal-style. Found it after the research, then grow
// it feature by feature through a tech tree, with a dedicated engine team.
// How you build it matters: the architecture you favour (performance,
// usability, stability), the tech debt you pile up by crunching or changing
// direction, the genres you ship templates for, and whether it's closed,
// source-available or open source. Ship major versions from 1.0 to 5.0 and
// license it to rival studios: fees, royalties (optionally only after a
// game's first $1M), enterprise deals, a support budget that keeps licensees
// happy, and security holes to deal with. Your subsidiaries use it for free.
import { ENGINES, ENGINE_MAX_LEVEL, ENGINE_MODULE_IDS, ROLES, SCOPE_IDS, engineShowcaseCost } from './constants';
import { ENGINE_FEATURES, FEATURE_BY_ID, defaultFeaturesFor, featureCost, featureWork, type EngineFeature } from './engineTech';
import { pushDecision } from './events';
import { addXp } from './progression';
import { chance, pick } from './rng';
import type { ActionResult, Company, DecisionEvent, EngineArch, EngineId, EngineModuleId, EngineSource, Game, GenreId, ScopeId, StudioEngine, World } from './types';
import { bumpRep, celebrate, clamp, earn, isPlayerGroup, playerCompany, pushNews, spend, toast } from './util';

export const DEFAULT_ROYALTY = 0.05;
/** Employees on the engine team carry this assignment. */
export const ENGINE_TEAM = 'team:engine';
export const MAX_QUEUE = 12;
export const REFACTOR_DAYS = 30;
export const DEAL_YEARS = 2;

const fail = (error: string): ActionResult => ({ ok: false, error });
const ok = (): ActionResult => ({ ok: true });
const fmt = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`);

function hasResearchDone(w: World, id: string): boolean {
  return (w.player.research.completed as string[]).includes(id);
}

/** Fill in everything Engine 2.0 added (new engines and old saves). */
function engineDefaults(e: StudioEngine, w: World): void {
  e.features ??= [];
  e.research ??= [];
  e.queue ??= [];
  e.versionLog ??= [];
  e.arch ??= { performance: 34, usability: 33, stability: 33 };
  e.debt ??= 10;
  e.refactorUntil ??= 0;
  e.crunch ??= false;
  e.focus ??= [];
  e.focusDay ??= -999;
  e.source ??= 'closed';
  e.threshold ??= false;
  e.support ??= 0;
  e.satisfaction ??= 60;
  e.deals ??= [];
  e.vulnUntil ??= 0;
  e.log ??= [];
  void w;
}

export function newStudioEngine(w: World, name: string, level = 1): StudioEngine {
  const modules = {} as StudioEngine['modules'];
  for (const m of ENGINE_MODULE_IDS) modules[m] = level;
  const e = {
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
  } as unknown as StudioEngine;
  engineDefaults(e, w);
  for (const m of ENGINE_MODULE_IDS) e.features.push(...defaultFeaturesFor(m, level - 1));
  return e;
}

/** Bring an engine from an older save up to date. */
export function upgradeEngineSave(w: World): void {
  const e = w.player.engine;
  if (!e || Array.isArray((e as Partial<StudioEngine>).features)) return;
  engineDefaults(e, w);
  for (const m of ENGINE_MODULE_IDS) e.features.push(...defaultFeaturesFor(m, Math.max(0, (e.modules[m] ?? 1) - 1)));
  // an old module upgrade in progress becomes research on that module's next feature
  if (e.upgrade) {
    const next = ENGINE_FEATURES.find((f) => f.module === e.upgrade!.module && !e.features.includes(f.id));
    if (next) {
      const work = featureWork(next);
      e.research.push({ feature: next.id, work, done: (work * (e.upgrade.days - e.upgrade.daysLeft)) / Math.max(1, e.upgrade.days), cost: featureCost(next) });
    }
    e.upgrade = null;
  }
}

export function suggestEngineName(w: World): string {
  const p = playerCompany(w);
  const first = p.name.split(' ')[0] || 'Studio';
  const pool = ['Phoenix', 'Kraken', 'Nova', 'Aurora', 'Titanium', 'Quasar', 'Vortex', 'Ember', 'Monolith', 'Prism'];
  const choice = pool[Math.abs(p.name.length * 7 + first.charCodeAt(0)) % pool.length];
  return first.length <= 10 && chance(w, 0.5) ? `${first} Engine` : `${choice} Engine`;
}

export function canFoundEngine(w: World): string | null {
  if (w.player.engine) return 'You already have an engine.';
  if (!hasResearchDone(w, 'engine1')) return 'Research "Found Your Own Engine" first (Office & R&D).';
  return null;
}

export function foundEngine(w: World, name: string): ActionResult {
  const blocker = canFoundEngine(w);
  if (blocker) return fail(blocker);
  const clean = name.trim().slice(0, 40);
  if (!clean) return fail('Give your engine a name.');
  w.player.engine = newStudioEngine(w, clean);
  const p = playerCompany(w);
  pushNews(w, { kind: 'player', title: `${p.name} unveils ${clean} 1.0`, body: 'A brand-new game engine built in-house.', companyId: p.id, tone: 'major' });
  toast(w, `${clean} 1.0 is ready`, 'good', { category: 'studio', link: { route: 'engine' }, body: 'Put programmers on the engine team and pick your first features in the tech tree.' });
  addXp(w, 120);
  return ok();
}

export function renameEngine(w: World, name: string): ActionResult {
  const e = w.player.engine;
  if (!e) return fail('No engine yet.');
  const clean = name.trim().slice(0, 40);
  if (!clean) return fail('Give your engine a name.');
  e.name = clean;
  return ok();
}

/** Migrate saves from the old v1/v2/v3 research ladder. */
export function migrateEngine(w: World): void {
  if (w.player.engine) {
    upgradeEngineSave(w);
    return;
  }
  w.player.engine = null;
  if (!hasResearchDone(w, 'engine1')) return;
  const level = hasResearchDone(w, 'engine3') ? 3 : hasResearchDone(w, 'engine2') ? 2 : 1;
  const e = newStudioEngine(w, `${playerCompany(w)?.name.split(' ')[0] ?? 'Studio'} Engine`, level);
  e.licensing = level >= 3;
  w.player.engine = e;
}

function elog(e: StudioEngine, w: World, text: string, tone: 'good' | 'bad' | 'neutral' = 'neutral'): void {
  e.log.unshift({ day: w.day, text, tone });
  if (e.log.length > 40) e.log.length = 40;
}

// ------------------------------------------------------------ what the features add up to

export interface EngineFx {
  cap: number;
  quality: number;
  work: number;
  bugs: number;
  server: number;
  port: number;
  patch: number;
  adoption: number;
  /** Features that give extra quality to matching games. */
  matchers: EngineFeature[];
  /** Features that cut churn (for matching games). */
  churners: EngineFeature[];
}

const fxCache = new WeakMap<StudioEngine, { key: string; fx: EngineFx }>();

export function engineFx(e: StudioEngine): EngineFx {
  const key = e.features.join(',');
  const hit = fxCache.get(e);
  if (hit && hit.key === key) return hit.fx;
  const fx: EngineFx = { cap: 0, quality: 0, work: 0, bugs: 0, server: 0, port: 0, patch: 0, adoption: 0, matchers: [], churners: [] };
  for (const id of e.features) {
    const f = FEATURE_BY_ID[id];
    if (!f) continue;
    const x = f.fx;
    fx.cap += x.cap ?? 0;
    fx.quality += x.quality ?? 0;
    fx.work += x.work ?? 0;
    fx.bugs += x.bugs ?? 0;
    fx.server += x.server ?? 0;
    fx.port += x.port ?? 0;
    fx.patch += x.patch ?? 0;
    fx.adoption += x.adoption ?? 0;
    if (x.match) fx.matchers.push(f);
    if (x.churn) fx.churners.push(f);
  }
  fxCache.set(e, { key, fx });
  return fx;
}

type GameLike = Pick<Game, 'engine' | 'multiplayer' | 'artStyle'> & Partial<Pick<Game, 'genre' | 'platforms'>>;

function matches(f: EngineFeature, g: GameLike): boolean {
  const x = f.fx;
  if (!x.genres && !x.art && !x.mp && !x.platforms) return true;
  return (!!g.genre && !!x.genres?.includes(g.genre)) || !!x.art?.includes(g.artStyle) || !!x.mp?.includes(g.multiplayer) || !!g.platforms?.some((p) => x.platforms?.includes(p));
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
  const fx = engineFx(e);
  const extra = Math.min(8, fx.cap * 0.2 + fx.quality * 0.5) + ((e.arch?.performance ?? 33) - 33) * 0.08 - (e.debt ?? 0) * 0.04;
  return Math.round(clamp(40 + 12 * engineLevel(e) + extra, 0, 100));
}

/** Rough score for the commercial engines at the start, for comparisons in the UI. */
export const COMMERCIAL_SCORES: Partial<Record<EngineId, number>> = { pixelforge: 48, nimbus: 62, titan: 80, apex: 92 };

/** The commercial engines keep improving every year. */
export function commercialScore(w: World, id: EngineId): number {
  const years = w.day / 365;
  const base = COMMERCIAL_SCORES[id] ?? 40;
  const growth = id === 'apex' ? 0.8 : id === 'titan' ? 1.2 : id === 'nimbus' ? 0.8 : 0.5;
  return Math.round(Math.min(id === 'apex' ? 99 : 95, base + growth * years));
}

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

export function activeDeal(w: World, companyId: string): boolean {
  return !!w.player.engine?.deals?.some((d) => d.companyId === companyId && d.until > w.day);
}

/** Stats a game built on your engine gets. `forCompany` decides what the user pays. */
export function studioEngineStats(w: World, forCompany: Company | null): EngineStats {
  const e = w.player.engine;
  const base = ENGINES.inhouse;
  if (!e) return { ...base };
  const m = e.modules;
  const fx = engineFx(e);
  const a = e.arch ?? { performance: 34, usability: 33, stability: 33 };
  const own = !forCompany || forCompany.isPlayer || forCompany.parentId === w.player.companyId;
  const free = own || activeDeal(w, forCompany!.id);
  const open = e.source === 'open';
  return {
    name: e.name,
    licenseCost: free || open ? 0 : e.fee,
    royalty: free ? 0 : open ? Math.min(e.royalty, 0.02) : e.royalty,
    cap: Math.min(100, 78 + m.rendering * 3 + m.physics * 1.4 + fx.cap * 0.5 + (a.performance - 33) * 0.12),
    workMult: Math.max(0.45, (0.92 - 0.04 * m.tools) * (1 - fx.work) * (1 - (a.usability - 33) * 0.003)),
    bugMult: Math.max(0.3, (0.98 - 0.04 * m.scripting) * (1 - fx.bugs) * (1 - (a.stability - 33) * 0.004) * (1 + (e.debt ?? 0) / 200)),
    minRep: 0,
    blurb: `Your engine, version ${e.version}.0.`,
  };
}

/** Extra quality a game gets from the engine's specialised features and genre templates. */
export function engineQualityBonus(w: World, g: GameLike): number {
  const e = w.player.engine;
  if (!e || g.engine !== 'inhouse') return 0;
  let q = 0;
  if (g.multiplayer === 'online' || g.multiplayer === 'massive') q += 0.8 * (e.modules.networking - 1);
  if (g.artStyle === 'realistic' || g.artStyle === 'photoreal') q += 0.6 * (e.modules.rendering - 1);
  const fx = engineFx(e);
  let match = 0;
  for (const f of fx.matchers) if (matches(f, g)) match += f.fx.match ?? 0;
  q += Math.min(12, match) + fx.quality;
  if (g.genre && e.focus?.includes(g.genre)) q += 2;
  return q;
}

/** Server-cost discount for your own online games. */
export function engineServerDiscount(w: World): number {
  const e = w.player.engine;
  if (!e) return 0;
  return Math.min(0.4, 0.03 * (e.modules.networking - 1) + engineFx(e).server + Math.max(0, ((e.arch?.performance ?? 33) - 33) * 0.001));
}

/** Port and multi-platform work discount. */
export function enginePortDiscount(w: World, engine: EngineId): number {
  const e = w.player.engine;
  return e && engine === 'inhouse' ? Math.min(0.6, 0.08 * (e.modules.platforms - 1) + engineFx(e).port) : 0;
}

/** Patches and updates take less work on your engine (hot reload, build farms, test bots). */
export function enginePatchDiscount(w: World, engine: EngineId): number {
  const e = w.player.engine;
  return e && engine === 'inhouse' ? Math.min(0.5, engineFx(e).patch) : 0;
}

/** Churn multiplier for games on your engine (netcode, matchmaking, the AI director). */
export function engineChurn(w: World, g: Game): number {
  if (g.engine !== 'inhouse') return 1;
  const e = w.player.engine;
  if (!e) return 1;
  const fx = engineFx(e);
  if (!fx.churners.length) return 1;
  let cut = 0;
  for (const f of fx.churners) if (matches(f, g)) cut += f.fx.churn ?? 0;
  return 1 - Math.min(0.15, cut);
}

export function engineDisplayName(w: World, id: EngineId): string {
  return id === 'inhouse' && w.player.engine ? w.player.engine.name : ENGINES[id].name;
}

// ------------------------------------------------------------ the engine team

export function engineTeam(w: World) {
  return w.player.employees.filter((e) => e.assignment === ENGINE_TEAM && ROLES[e.role].dev);
}

/** Research speed: the engine team (programmers count double), crunch, debt and open-source help. */
export function engineSpeed(w: World): number {
  const e = w.player.engine;
  let bonus = 0;
  for (const m of engineTeam(w)) bonus += (m.role === 'programmer' || m.isFounder ? 0.2 : 0.1) * Math.pow(m.skill / 60, 0.9) * (0.6 + (0.5 * m.morale) / 100);
  let s = 1 + Math.min(2.5, bonus);
  if (!e) return s;
  if (e.crunch) s *= 1.4;
  s *= 1 - (e.debt ?? 0) / 250;
  if (e.source === 'open') s *= 1.25;
  return s;
}

/** Old name, still used by a few screens. */
export function engineTeamSpeed(w: World): number {
  return engineSpeed(w);
}

/** Features researched in parallel: one, plus one per four people on the team (up to three). */
export function researchSlots(w: World): number {
  return 1 + Math.min(2, Math.floor(engineTeam(w).length / 4));
}

export function setEngineTeam(w: World, employeeId: string, on: boolean): ActionResult {
  const m = w.player.employees.find((x) => x.id === employeeId);
  if (!m) return fail('Employee not found.');
  if (!ROLES[m.role].dev) return fail(`${ROLES[m.role].plural} work company-wide.`);
  if (!w.player.engine) return fail('Found your engine first.');
  m.assignment = on ? ENGINE_TEAM : m.assignment === ENGINE_TEAM ? null : m.assignment;
  return ok();
}

// ------------------------------------------------------------ the tech tree

export function featuresIn(e: StudioEngine, m: EngineModuleId): number {
  let n = 0;
  for (const id of e.features) if (FEATURE_BY_ID[id]?.module === m) n++;
  return n;
}

function recomputeLevels(e: StudioEngine): void {
  for (const m of ENGINE_MODULE_IDS) e.modules[m] = 1 + Math.min(ENGINE_MAX_LEVEL - 1, featuresIn(e, m));
}

/** Why this feature can't start right now (null: it can). */
export function researchBlocker(w: World, id: string, checkSlot = true): string | null {
  const e = w.player.engine;
  if (!e) return 'Found your engine first.';
  const f = FEATURE_BY_ID[id];
  if (!f) return 'Unknown feature.';
  if (e.features.includes(id)) return 'Already researched.';
  if (e.research.some((r) => r.feature === id)) return 'Being researched.';
  const have = featuresIn(e, f.module);
  if (have < f.tier - 1) return `Needs ${f.tier - 1} ${f.module} feature${f.tier - 1 === 1 ? '' : 's'} first.`;
  for (const r of f.requires ?? []) if (!e.features.includes(r)) return `Needs ${FEATURE_BY_ID[r]?.name ?? r}.`;
  const inFlight = e.research.filter((r) => FEATURE_BY_ID[r.feature]?.module === f.module).length;
  if (have + inFlight < ENGINE_MAX_LEVEL - 1 && have + inFlight + 1 > e.version) return `Ship ${e.name} ${e.version + 1}.0 first.`;
  if (w.day < e.refactorUntil) return 'The team is refactoring.';
  if (checkSlot && e.research.length >= researchSlots(w)) return 'Every research slot is busy.';
  if (playerCompany(w).cash < featureCost(f)) return `Costs ${fmt(featureCost(f))}.`;
  return null;
}

export function startResearch(w: World, id: string): ActionResult {
  const blocker = researchBlocker(w, id);
  if (blocker) return fail(blocker);
  const e = w.player.engine!;
  const f = FEATURE_BY_ID[id];
  spend(playerCompany(w), 'research', featureCost(f));
  e.research.push({ feature: id, work: featureWork(f), done: 0, cost: featureCost(f), crunched: e.crunch || undefined });
  e.queue = e.queue.filter((q) => q !== id);
  return ok();
}

/** Start now if a slot is free, otherwise line it up. */
export function queueResearch(w: World, id: string): ActionResult {
  const e = w.player.engine;
  if (!e) return fail('Found your engine first.');
  if (!FEATURE_BY_ID[id]) return fail('Unknown feature.');
  if (e.features.includes(id) || e.research.some((r) => r.feature === id)) return fail('Already researched or underway.');
  if (!researchBlocker(w, id)) return startResearch(w, id);
  if (e.queue.includes(id)) return fail('Already queued.');
  if (e.queue.length >= MAX_QUEUE) return fail(`The queue holds ${MAX_QUEUE} features.`);
  e.queue.push(id);
  return ok();
}

export function unqueueResearch(w: World, id: string): ActionResult {
  const e = w.player.engine;
  if (!e || !e.queue.includes(id)) return fail('Not queued.');
  e.queue = e.queue.filter((q) => q !== id);
  return ok();
}

/** Stop a feature midway: the money is spent and the work is lost. */
export function cancelResearch(w: World, id: string): ActionResult {
  const e = w.player.engine;
  if (!e || !e.research.some((r) => r.feature === id)) return fail('Not being researched.');
  e.research = e.research.filter((r) => r.feature !== id);
  return ok();
}

/** Old one-click module upgrade: research the module's next feature. */
export function moduleUpgradeBlocker(w: World, m: EngineModuleId): string | null {
  const e = w.player.engine;
  if (!e) return 'Found your engine first.';
  if (e.modules[m] >= ENGINE_MAX_LEVEL) return 'Maxed out.';
  const next = nextFeature(e, m);
  return next ? researchBlocker(w, next.id) : 'Nothing left to research.';
}

export function nextFeature(e: StudioEngine, m: EngineModuleId): EngineFeature | undefined {
  return ENGINE_FEATURES.find((f) => f.module === m && !e.features.includes(f.id) && !e.research.some((r) => r.feature === f.id) && f.tier <= featuresIn(e, m) + 1 && (f.requires ?? []).every((r) => e.features.includes(r)));
}

export function startModuleUpgrade(w: World, m: EngineModuleId): ActionResult {
  const blocker = moduleUpgradeBlocker(w, m);
  if (blocker) return fail(blocker);
  return startResearch(w, nextFeature(w.player.engine!, m)!.id);
}

export function upgradeDays(w: World, m: EngineModuleId): number {
  const e = w.player.engine;
  if (!e) return 0;
  const next = nextFeature(e, m);
  return next ? Math.ceil(featureWork(next) / engineSpeed(w)) : 0;
}

export function featureDays(w: World, id: string): number {
  const f = FEATURE_BY_ID[id];
  return f ? Math.ceil(featureWork(f) / engineSpeed(w)) : 0;
}

export function readyForVersion(e: StudioEngine): boolean {
  return e.version < ENGINE_MAX_LEVEL && ENGINE_MODULE_IDS.every((m) => e.modules[m] > e.version);
}

/** Features researched since the last major version. */
export function unreleasedFeatures(e: StudioEngine): string[] {
  const shipped = new Set(e.versionLog.flatMap((v) => v.features));
  return e.features.filter((f) => !shipped.has(f));
}

export function releaseEngineVersion(w: World, showcase: boolean): ActionResult {
  const e = w.player.engine;
  if (!e) return fail('No engine yet.');
  if (!readyForVersion(e)) return fail(`Every module must reach level ${e.version + 1} first.`);
  const p = playerCompany(w);
  const next = e.version + 1;
  const cost = showcase ? engineShowcaseCost(next) : 0;
  if (p.cash < cost) return fail('Not enough cash for the showcase.');
  if (cost > 0) spend(p, 'marketing', cost);
  const notes = unreleasedFeatures(e);
  e.version = next;
  e.versionLog.push({ version: next, day: w.day, features: notes });
  e.hype = clamp(e.hype + (showcase ? 45 : 20) + Math.min(15, notes.length * 2), 0, 100);
  p.reputation = Math.min(100, p.reputation + (showcase ? 3 : 1));
  addXp(w, 150 * next);
  const highlights = notes
    .map((id) => FEATURE_BY_ID[id])
    .filter(Boolean)
    .sort((a, b) => b.tier - a.tier)
    .slice(0, 3)
    .map((f) => f.name.toLowerCase());
  pushNews(w, {
    kind: 'player',
    title: `${p.name} ships ${e.name} ${next}.0`,
    body: highlights.length ? `New: ${highlights.join(', ')}.` : showcase ? 'A jaw-dropping tech demo has developers everywhere talking.' : 'A quiet release with big improvements under the hood.',
    companyId: p.id,
    tone: 'major',
  });
  elog(e, w, `${e.name} ${next}.0 shipped with ${notes.length} new feature${notes.length === 1 ? '' : 's'}.`, 'good');
  celebrate(w, `${e.name} ${next}.0`, next >= 5);
  toast(w, `${e.name} ${next}.0 is out!`, 'good', { category: 'studio', link: { route: 'engine' }, body: e.licensing ? 'Rival studios are taking a fresh look at licensing it.' : 'Open licensing to earn from rival studios.' });
  return ok();
}

// ------------------------------------------------------------ how it's built

/** Re-balance the engine's design. Big changes pile up tech debt. */
export function setEngineArch(w: World, arch: EngineArch): ActionResult {
  const e = w.player.engine;
  if (!e) return fail('No engine yet.');
  const vals = [arch.performance, arch.usability, arch.stability].map((x) => clamp(Math.round(x), 10, 80));
  const sum = vals[0] + vals[1] + vals[2];
  const n = vals.map((x) => Math.round((x / sum) * 100));
  n[2] = 100 - n[0] - n[1];
  const next = { performance: n[0], usability: n[1], stability: n[2] };
  const diff = (Math.abs(next.performance - e.arch.performance) + Math.abs(next.usability - e.arch.usability) + Math.abs(next.stability - e.arch.stability)) / 2;
  if (diff < 1) return ok();
  e.arch = next;
  if (diff >= 5) {
    const debt = Math.min(25, diff / 2);
    e.debt = clamp(e.debt + debt, 0, 100);
    elog(e, w, `Re-architected toward ${n[0]}/${n[1]}/${n[2]}: +${Math.round(debt)} tech debt.`);
  }
  return ok();
}

export function setEngineCrunch(w: World, on: boolean): ActionResult {
  const e = w.player.engine;
  if (!e) return fail('No engine yet.');
  e.crunch = on;
  return ok();
}

export function refactorCost(e: StudioEngine): number {
  return 100000 * e.version;
}

/** Stop researching for a month and pay down tech debt. */
export function startRefactor(w: World): ActionResult {
  const e = w.player.engine;
  if (!e) return fail('No engine yet.');
  if (w.day < e.refactorUntil) return fail('Already refactoring.');
  if (e.debt < 10) return fail('The codebase is in good shape.');
  const cost = refactorCost(e);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Costs ${fmt(cost)}.`);
  spend(p, 'research', cost);
  e.refactorUntil = w.day + REFACTOR_DAYS;
  elog(e, w, 'Refactor sprint started: research paused for a month.');
  return ok();
}

export function setEngineSource(w: World, source: EngineSource): ActionResult {
  const e = w.player.engine;
  if (!e) return fail('No engine yet.');
  if (source === e.source) return ok();
  const p = playerCompany(w);
  const from = e.source;
  e.source = source;
  if (source === 'open') {
    e.hype = clamp(e.hype + 15, 0, 100);
    e.fee = 0;
    e.royalty = Math.min(e.royalty, 0.02);
    pushNews(w, { kind: 'player', title: `${p.name} open-sources ${e.name}`, body: 'Developers everywhere start contributing.', companyId: p.id, tone: 'major' });
    elog(e, w, 'Open-sourced: faster research from the community, no upfront fees, royalties capped at 2%.', 'good');
  } else if (from === 'open') {
    e.hype = clamp(e.hype - 40, 0, 100);
    e.satisfaction = clamp(e.satisfaction - 30, 0, 100);
    p.reputation = Math.max(0, p.reputation - 5);
    pushNews(w, { kind: 'player', title: `${p.name} closes ${e.name}'s source and developers are furious`, companyId: p.id, tone: 'bad' });
    elog(e, w, 'Closed the source again: the community feels betrayed.', 'bad');
  } else if (source === 'sourceAvailable') {
    e.hype = clamp(e.hype + 5, 0, 100);
    elog(e, w, 'Source available to licensees: happier studios, a little more interest.', 'good');
  }
  return ok();
}

export const FOCUS_COOLDOWN = 60;

export function setEngineFocus(w: World, genres: GenreId[]): ActionResult {
  const e = w.player.engine;
  if (!e) return fail('No engine yet.');
  const clean = [...new Set(genres)].slice(0, 3);
  if (clean.join() === e.focus.join()) return ok();
  if (e.focus.length && w.day - e.focusDay < FOCUS_COOLDOWN) return fail(`New templates take time: ${FOCUS_COOLDOWN - (w.day - e.focusDay)} more days.`);
  e.focus = clean;
  e.focusDay = w.day;
  return ok();
}

export function setLicensing(w: World, patch: { licensing?: boolean; royalty?: number; fee?: number; threshold?: boolean; support?: number }): ActionResult {
  const e = w.player.engine;
  if (!e) return fail('No engine yet.');
  if (patch.licensing !== undefined) e.licensing = patch.licensing;
  if (patch.royalty !== undefined) e.royalty = clamp(patch.royalty, 0, e.source === 'open' ? 0.02 : 0.15);
  if (patch.fee !== undefined) e.fee = e.source === 'open' ? 0 : clamp(Math.round(patch.fee), 0, 5e6);
  if (patch.threshold !== undefined) e.threshold = patch.threshold;
  if (patch.support !== undefined) e.support = clamp(Math.round(patch.support), 0, 5e7);
  return ok();
}

// ------------------------------------------------------------ the daily and monthly life

/** Daily: research, refactoring, debt and buzz. */
export function engineDaily(w: World): void {
  const e = w.player.engine;
  if (!e) return;
  if (!Array.isArray((e as Partial<StudioEngine>).features)) upgradeEngineSave(w);
  e.hype = Math.max(0, e.hype * 0.9985);
  if (e.source === 'open') e.debt = Math.max(0, e.debt - 0.03);
  if (w.day < e.refactorUntil) {
    e.debt = Math.max(0, e.debt - 40 / REFACTOR_DAYS);
    if (w.day + 1 >= e.refactorUntil) {
      elog(e, w, 'Refactor sprint finished: the codebase is cleaner.', 'good');
      toast(w, `${e.name}: refactor finished`, 'good', { category: 'studio', link: { route: 'engine' }, body: `Tech debt is down to ${Math.round(e.debt)}.` });
    }
    return;
  }
  if (e.research.length) {
    const speed = engineSpeed(w);
    if (e.crunch) {
      e.debt = Math.min(100, e.debt + 0.05);
      for (const m of engineTeam(w)) m.morale = Math.max(0, m.morale - 0.25);
    }
    for (const r of [...e.research]) {
      r.done += speed;
      if (r.done < r.work) continue;
      e.research = e.research.filter((x) => x !== r);
      finishFeature(w, e, r.feature, !!r.crunched || e.crunch);
    }
  }
  // fill free slots from the queue
  if (e.queue.length && e.research.length < researchSlots(w)) {
    for (const id of [...e.queue]) {
      if (e.research.length >= researchSlots(w)) break;
      if (!researchBlocker(w, id)) startResearch(w, id);
    }
  }
}

function finishFeature(w: World, e: StudioEngine, id: string, crunched: boolean): void {
  const f = FEATURE_BY_ID[id];
  if (!f || e.features.includes(id)) return;
  e.features.push(id);
  recomputeLevels(e);
  const debt = 4 * (1 - (e.arch.stability - 33) / 100) * (crunched ? 1.5 : 1);
  e.debt = clamp(e.debt + debt, 0, 100);
  e.hype = clamp(e.hype + (f.fx.hype ?? 0) + 1, 0, 100);
  addXp(w, 25 * f.tier);
  elog(e, w, `${f.name} is done.`, 'good');
  toast(w, `${e.name}: ${f.name} is done`, 'good', {
    category: 'studio',
    link: { route: 'engine' },
    body: readyForVersion(e) ? `Every module is ready: ship ${e.name} ${e.version + 1}.0!` : f.blurb,
  });
}

/** Studios (not yours) with projects on your engine. */
export function engineLicensees(w: World): string[] {
  const set = new Set<string>();
  for (const id in w.games) {
    const g = w.games[id];
    if (g.engine !== 'inhouse' || (g.status !== 'development' && g.status !== 'released')) continue;
    const c = w.companies[g.companyId];
    if (!c || c.isPlayer || isPlayerGroup(w, c)) continue;
    set.add(c.id);
  }
  return [...set];
}

/** 0..1.5: how well the support budget covers the licensees. */
export function supportCoverage(e: StudioEngine, licensees: number): number {
  return clamp(e.support / Math.max(50000, 20000 * licensees), 0, 1.5);
}

export function satisfactionTarget(w: World, e: StudioEngine, licensees: number): number {
  const rival = commercialScore(w, 'titan');
  let t = 50 + (engineScore(e) - rival) / 1.5 + 20 * supportCoverage(e, licensees) - e.debt / 3;
  if (e.source === 'open') t += 10;
  else if (e.source === 'sourceAvailable') t += 6;
  if (w.day < e.vulnUntil) t -= 20;
  return clamp(t, 0, 100);
}

/** Monthly: support costs, licensee mood, deals, the marketplace, and things going wrong. */
export function engineMonthly(w: World): void {
  const e = w.player.engine;
  const p = playerCompany(w);
  if (!e || !p) return;
  if (!Array.isArray((e as Partial<StudioEngine>).features)) upgradeEngineSave(w);
  const lic = engineLicensees(w);
  if (e.support > 0) spend(p, 'research', e.support);
  e.satisfaction = clamp(e.satisfaction + (satisfactionTarget(w, e, lic.length) - e.satisfaction) * 0.25, 0, 100);
  if (e.satisfaction < 30 && lic.length) e.hype = Math.max(0, e.hype - 3);
  else if (e.satisfaction > 75) e.hype = Math.min(100, e.hype + 1);
  // enterprise deals pay monthly
  for (const d of [...e.deals]) {
    const c = w.companies[d.companyId];
    if (d.until <= w.day || !c || c.status !== 'active') {
      e.deals = e.deals.filter((x) => x !== d);
      if (c) elog(e, w, `Enterprise deal with ${c.name} ended.`);
      continue;
    }
    const pay = Math.min(d.annual / 12, Math.max(0, c.cash * 0.2));
    c.cash -= pay;
    earn(p, 'licensing', pay);
    e.feesTotal += pay;
  }
  // the asset marketplace
  if (e.features.includes('marketplace') && lic.length) {
    const take = lic.length * 15000 * e.version * (e.satisfaction / 60);
    earn(p, 'licensing', take);
    e.feesTotal += take;
  }
  // an ignored security hole can be exploited
  if (w.day < e.vulnUntil && chance(w, 0.15)) {
    e.vulnUntil = 0;
    const lost = bumpRep(p, -5);
    e.hype = Math.max(0, e.hype - 15);
    e.satisfaction = Math.max(0, e.satisfaction - 20);
    pushNews(w, { kind: 'industry', title: `Hackers exploit a hole in ${e.name}`, body: 'Games built on the engine were hit.', tone: 'bad' });
    toast(w, `Hackers exploited the hole in ${e.name}`, 'bad', { category: 'studio', link: { route: 'engine' }, body: `${lost}, licensees are angry.` });
    elog(e, w, 'The unpatched vulnerability was exploited.', 'bad');
  }
  engineEvents(w, e, lic);
}

function engineEvents(w: World, e: StudioEngine, lic: string[]): void {
  if (w.pendingEvents.some((x) => x.kind === 'engineDeal' || x.kind === 'engineVuln')) return;
  const p = playerCompany(w);
  // security holes: more likely with lots of tech debt
  const exposed = lic.length > 0 || Object.values(w.games).some((g) => g.companyId === p.id && g.engine === 'inhouse' && g.status === 'released');
  if (exposed && w.day >= e.vulnUntil && chance(w, 0.025 * (1 + e.debt / 40))) {
    const cost = Math.round(150000 * e.version * (1 + lic.length / 10));
    pushDecision(w, {
      kind: 'engineVuln',
      title: `Security hole found in ${e.name}`,
      body: `Researchers found a remote-code exploit in ${e.name}'s ${pick(w, ['networking layer', 'scripting runtime', 'asset loader', 'save system'])}. ${lic.length ? `${lic.length} studios ship games on it.` : 'Your own games run on it.'} Patch it properly, fix it quietly, or hope nobody notices.`,
      options: [
        { id: 'patch', label: `Emergency patch · ${fmt(cost)}`, description: 'Fixed and disclosed. Licensees appreciate it.', disabled: p.cash < cost },
        { id: 'quiet', label: `Quiet fix · ${fmt(cost / 3)}`, description: 'Cheaper, but if it leaks you look bad (30%).', disabled: p.cash < cost / 3 },
        { id: 'ignore', label: 'Ignore it', description: 'Free today. Hackers may exploit it in the coming months.' },
      ],
      data: { cost },
      expiresDay: w.day + 21,
      defaultOption: 'quiet',
    });
    return;
  }
  // a big studio wants an enterprise deal
  if (!e.licensing || e.source === 'open' || !chance(w, 0.1)) return;
  const taken = new Set(e.deals.map((d) => d.companyId));
  const big = Object.values(w.companies)
    .filter((c) => c.status === 'active' && !c.isPlayer && !isPlayerGroup(w, c) && !taken.has(c.id) && c.valuation > 5e7)
    .sort((a, b) => b.valuation - a.valuation)
    .slice(0, 6);
  if (!big.length) return;
  const c = pick(w, big);
  const yearly = c.monthly.slice(-12).reduce((s, m) => s + m.revenue, 0);
  const annual = Math.round(Math.max(250000, yearly * 0.02 * (engineScore(e) / commercialScore(w, 'titan'))));
  pushDecision(w, {
    kind: 'engineDeal',
    title: `${c.name} wants an enterprise licence for ${e.name}`,
    body: `${c.name} offers ${fmt(annual)} a year for ${DEAL_YEARS} years: unlimited projects on ${e.name}, no royalties or fees. Accept, push for more (they may walk away), or decline.`,
    options: [
      { id: 'accept', label: `Accept · ${fmt(annual)}/yr`, description: 'Steady money and a big name on your engine.' },
      { id: 'counter', label: `Counter · ${fmt(annual * 1.4)}/yr`, description: 'About a 50/50 chance they agree.' },
      { id: 'decline', label: 'Decline', description: 'They stay on royalties, if they use it at all.' },
    ],
    data: { companyId: c.id, annual },
    expiresDay: w.day + 30,
    defaultOption: 'decline',
  });
}

export function resolveEngineDecision(w: World, ev: DecisionEvent, optionId: string): boolean {
  const e = w.player.engine;
  if (ev.kind !== 'engineDeal' && ev.kind !== 'engineVuln') return false;
  if (!e) return true;
  const p = playerCompany(w);
  if (ev.kind === 'engineVuln') {
    const cost = Number(ev.data.cost);
    if (optionId === 'patch' && p.cash >= cost) {
      spend(p, 'research', cost);
      e.satisfaction = clamp(e.satisfaction + 5, 0, 100);
      elog(e, w, 'Security hole patched and disclosed.', 'good');
    } else if (optionId === 'quiet' && p.cash >= cost / 3) {
      spend(p, 'research', cost / 3);
      if (chance(w, 0.3)) {
        p.reputation = Math.max(0, p.reputation - 3);
        e.satisfaction = clamp(e.satisfaction - 15, 0, 100);
        pushNews(w, { kind: 'industry', title: `${p.name} quietly patched a serious hole in ${e.name}`, tone: 'bad' });
        elog(e, w, 'The quiet fix leaked to the press.', 'bad');
      } else elog(e, w, 'Security hole fixed quietly.');
    } else {
      e.vulnUntil = w.day + 90;
      elog(e, w, 'Security hole left open.', 'bad');
    }
    return true;
  }
  const c = w.companies[String(ev.data.companyId)];
  if (!c || c.status !== 'active') return true;
  const annual = Number(ev.data.annual);
  const sign = (amount: number) => {
    e.deals.push({ companyId: c.id, annual: amount, start: w.day, until: w.day + 365 * DEAL_YEARS });
    e.hype = clamp(e.hype + 5, 0, 100);
    pushNews(w, { kind: 'industry', title: `${c.name} signs an enterprise deal for ${e.name}`, companyId: c.id, tone: 'good' });
    elog(e, w, `Enterprise deal: ${c.name}, ${fmt(amount)} a year.`, 'good');
  };
  if (optionId === 'accept') sign(annual);
  else if (optionId === 'counter') {
    if (chance(w, 0.5)) sign(Math.round(annual * 1.4));
    else {
      elog(e, w, `${c.name} walked away from the deal.`, 'bad');
      toast(w, `${c.name} walked away from the engine deal`, 'neutral', { category: 'studio', link: { route: 'engine' } });
    }
  }
  return true;
}

// ------------------------------------------------------------ licensing market

/** Chance a rival studio picks your engine for a new project. */
export function adoptionChance(w: World, c: Company, scope: ScopeId, genre?: GenreId): number {
  const e = w.player.engine;
  if (!e || !e.licensing || c.isPlayer) return 0;
  if (activeDeal(w, c.id)) return 0.85;
  const sIdx = SCOPE_IDS.indexOf(scope);
  const score = engineScore(e);
  const rival = sIdx >= 4 ? commercialScore(w, 'apex') : commercialScore(w, 'titan');
  const open = e.source === 'open';
  const royalty = open ? Math.min(e.royalty, 0.02) : e.royalty;
  const fee = open ? 0 : e.fee;
  let p = 0.06 + (score - rival) / 90 + e.hype / 400 + engineFx(e).adoption + ((e.arch?.usability ?? 33) - 33) / 400;
  if (open) p += 0.12;
  else if (e.source === 'sourceAvailable') p += 0.04;
  // price sensitivity: royalty against Titan's, fee against the project's size
  p += (w.market.titanRoyalty - royalty) * (sIdx <= 1 ? 6 : 4);
  p -= fee / (40000 * Math.pow(4, sIdx));
  if (e.threshold && sIdx <= 1) p += 0.06;
  if (genre && e.focus?.includes(genre)) p += 0.08;
  if (c.talent > 75 && score < 70) p -= 0.05;
  p *= 0.5 + (e.satisfaction ?? 60) / 100;
  return clamp(p, 0, 0.6);
}

/** Called when a rival starts a project on your engine. */
export function chargeLicenseFee(w: World, c: Company, g: Game): void {
  const e = w.player.engine;
  const p = playerCompany(w);
  if (!e || !p || p.status !== 'active') return;
  if (c.parentId === p.id) return;
  e.gamesBuilt += 1;
  const fee = activeDeal(w, c.id) || e.source === 'open' ? 0 : e.fee;
  if (fee > 0) {
    c.cash -= fee;
    earn(p, 'licensing', fee);
    e.feesTotal += fee;
  }
  if (e.gamesBuilt === 1) {
    toast(w, `${c.name} licensed ${e.name} for ${g.title}`, 'good', { category: 'studio', link: { route: 'engine' }, body: 'Your first licensee! Royalties arrive once the game earns money.' });
  } else if (SCOPE_IDS.indexOf(g.scope) >= 3) {
    toast(w, `${c.name} is building ${g.title} on ${e.name}`, 'good', { category: 'studio', link: { route: 'engine' }, silent: true });
  }
}

/** Royalty-free below a game's first $1M, if you offer that. */
export function royaltyWaived(w: World, g: Game): boolean {
  const e = w.player.engine;
  return !!e?.threshold && g.engine === 'inhouse' && g.revenueTotal < 1e6;
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
  engineMonthly(w);
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
