// Anti-cheat as a real security operation. Your product is a stack of
// detection layers (signatures, behaviour analysis, machine learning, a
// kernel driver, server authority, hardware bans, replay review), each good
// against different kinds of cheats. Cheat makers are an adaptive opponent:
// they pour effort into whatever you catch most. You choose how to ban
// (instantly, or in waves that teach them less), how aggressive detection
// is (more cheaters caught, more innocent players banned), how harsh the
// penalty is, and how much goes to appeals. Go after them too: buy their
// cheats undercover, sue the sellers, run honeypots and bug bounties. A
// security team speeds development up, and every licensee and honeypot
// feeds the machine-learning layer with data.
import { aiLead, ventureBlocker } from './ventures';
import { empireLevel, rivalPace, decreeActive } from './empire';
import { execPower } from './dominionCore';
import { pushDecision } from './events';
import { GENRES, ROLES } from './constants';
import { chance, pick } from './rng';
import type { AcLayerId, AcOp, AcOpKind, AcPolicy, ActionResult, AntiCheat, BanMode, BanPenalty, CheatType, Company, DecisionEvent, Game, World } from './types';
import { celebrate, clamp, earn, fanChange, isPlayerGroup, newId, playerCompany, pushNews, spend, toast } from './util';

const fail = (error: string): ActionResult => ({ ok: false, error });
const ok = (): ActionResult => ({ ok: true });
const fmt = (n: number) => (n >= 1e9 ? `$${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `$${(n / 1e6).toFixed(1)}M` : `$${Math.round(n / 1000)}K`);
const online = (g: Game) => g.multiplayer === 'online' || g.multiplayer === 'massive';
const count = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${Math.round(n / 1000)}K` : Math.round(n).toLocaleString('en-US'));
const pctText = (n: number) => `${Math.round(n * 100)}%`;

/** Employees on the security team carry this assignment. */
export const AC_TEAM = 'team:anticheat';
export const AC_MAX_LEVEL = 5;
export const AC_MAX_OPS = 2;
/** Share of players who cheat in a game with typical third-party anti-cheat. */
export const BASE_CHEATERS = 0.08;

export const CHEAT_TYPES: Record<CheatType, { name: string; blurb: string; share: number }> = {
  aimbot: { name: 'Aimbots', blurb: 'Perfect aim, every shot.', share: 0.25 },
  wallhack: { name: 'Wallhacks & ESP', blurb: 'Seeing enemies through walls.', share: 0.2 },
  speedhack: { name: 'Speed & teleport hacks', blurb: 'Moving faster than the game allows.', share: 0.1 },
  bots: { name: 'Bots & farming', blurb: 'Scripts that grind, farm and sell.', share: 0.2 },
  exploits: { name: 'Exploits & duping', blurb: 'Bugs abused to copy items and money.', share: 0.1 },
  macros: { name: 'Macros & scripts', blurb: 'No-recoil scripts, auto-clickers, input cheats.', share: 0.15 },
};
export const CHEAT_IDS = Object.keys(CHEAT_TYPES) as CheatType[];

export const AC_LAYERS: Record<AcLayerId, { name: string; blurb: string; base: number; requires?: AcLayerId; note?: string }> = {
  signatures: { name: 'Signature scanning', blurb: 'Recognises known cheat programs. Cheap, but goes stale unless new signatures are pushed.', base: 2e6 },
  heuristics: { name: 'Behaviour analysis', blurb: 'Flags impossible aim, speed and reaction times on the server.', base: 3e6 },
  ml: { name: 'Machine-learning detection', blurb: 'Learns what cheating looks like from millions of matches. Better with more data and a strong AI lab.', base: 8e6, requires: 'heuristics' },
  kernel: { name: 'Kernel driver', blurb: 'Runs at the deepest level of the PC: stops injectors and wallhacks cold.', base: 5e6, note: 'Privacy backlash risk while on.' },
  serverAuth: { name: 'Server authority', blurb: 'The server checks every move: no speed hacks, no duping.', base: 6e6, note: 'Raises your server costs while on.' },
  hwid: { name: 'Hardware bans', blurb: 'Bans stick to the machine, not the account. Cheaters rarely come back.', base: 4e6, note: 'False bans hurt more.' },
  replay: { name: 'Replay review', blurb: 'Trusted players review reported matches. Slow and cheap, and players love it.', base: 1.5e6 },
};
export const AC_LAYER_IDS = Object.keys(AC_LAYERS) as AcLayerId[];

/** How well each layer counters each kind of cheat (0..1) at full strength. */
export const COVERAGE: Record<AcLayerId, Record<CheatType, number>> = {
  signatures: { aimbot: 0.6, wallhack: 0.6, speedhack: 0.5, bots: 0.4, exploits: 0.2, macros: 0.5 },
  heuristics: { aimbot: 0.7, wallhack: 0.4, speedhack: 0.6, bots: 0.6, exploits: 0.3, macros: 0.4 },
  ml: { aimbot: 0.8, wallhack: 0.6, speedhack: 0.4, bots: 0.8, exploits: 0.3, macros: 0.7 },
  kernel: { aimbot: 0.9, wallhack: 0.9, speedhack: 0.5, bots: 0.3, exploits: 0.1, macros: 0.6 },
  serverAuth: { aimbot: 0.1, wallhack: 0.5, speedhack: 1, bots: 0.3, exploits: 0.8, macros: 0.1 },
  hwid: { aimbot: 0.15, wallhack: 0.15, speedhack: 0.15, bots: 0.15, exploits: 0.15, macros: 0.15 },
  replay: { aimbot: 0.5, wallhack: 0.5, speedhack: 0.3, bots: 0.3, exploits: 0.2, macros: 0.3 },
};

export const BAN_MODES: Record<BanMode, { name: string; blurb: string; every: number; adapt: number }> = {
  instant: { name: 'Instant bans', blurb: 'Cheaters vanish right away, but cheat makers learn what you detect and adapt fast.', every: 0, adapt: 1.4 },
  weekly: { name: 'Weekly ban waves', blurb: 'Detections pile up for a week, then everyone goes at once.', every: 7, adapt: 1 },
  monthly: { name: 'Monthly ban waves', blurb: 'Cheaters play on for weeks, but cheat makers learn very little and the waves make headlines.', every: 30, adapt: 0.7 },
};

export const PENALTIES: Record<BanPenalty, { name: string; blurb: string; deter: number; comeback: number }> = {
  suspend: { name: 'Suspensions', blurb: 'A month off. Most come back, some still cheating.', deter: 0.1, comeback: 0.6 },
  permanent: { name: 'Permanent bans', blurb: 'The account is gone. Some buy a new copy.', deter: 0.25, comeback: 0.3 },
  hardware: { name: 'Hardware bans', blurb: 'The machine is banned. Needs the hardware-ban layer.', deter: 0.4, comeback: 0.06 },
};

const vt = (w: World) => w.player.ventures;

// ------------------------------------------------------------ set-up and old saves

function emptyLayers(): AntiCheat['layers'] {
  const out = {} as AntiCheat['layers'];
  for (const l of AC_LAYER_IDS) out[l] = { level: 0, on: true };
  return out;
}

export function defaultPolicy(): AcPolicy {
  return { banMode: 'weekly', sensitivity: 50, penalty: 'permanent', appeals: 0 };
}

export function cheatsOf(w: World): Record<CheatType, number> {
  const v = vt(w);
  if (!v.cheats) {
    v.cheats = {} as Record<CheatType, number>;
    for (const t of CHEAT_IDS) v.cheats[t] = v.cheatLevel;
  }
  return v.cheats;
}

/** Bring an anti-cheat from an older save (or a brand-new one) up to date. */
export function normalizeAntiCheat(w: World): void {
  const ac = vt(w)?.antiCheat;
  if (!ac || (ac as Partial<AntiCheat>).layers) return;
  ac.layers = emptyLayers();
  const v = ac.version;
  ac.layers.signatures.level = Math.min(AC_MAX_LEVEL, v);
  ac.layers.heuristics.level = Math.min(AC_MAX_LEVEL, Math.max(0, v - 1));
  if (ac.mode === 'kernel') ac.layers.kernel.level = Math.min(AC_MAX_LEVEL, Math.max(1, v));
  ac.project = null;
  if (ac.building) {
    ac.project = { layer: 'heuristics', level: ac.layers.heuristics.level + 1, work: ac.building.days, done: Math.max(0, w.day - ac.building.start), cost: ac.building.cost };
    ac.building = null;
  }
  ac.queue = [];
  ac.sigDay = w.day;
  ac.autoSig = false;
  ac.policy = defaultPolicy();
  ac.pending = 0;
  ac.nextWave = w.day + 7;
  ac.cheaters = BASE_CHEATERS;
  ac.stats = { bans: 0, falseBans: 0, waves: 0, lawsuitsWon: 0 };
  ac.intel = {};
  ac.ops = [];
  ac.bounty = 0;
  ac.data = Math.min(30, ac.licensees.length * 3);
  ac.history = [];
  ac.log = [];
  ac.version = AC_LAYER_IDS.reduce((s, l) => s + ac.layers[l].level, 0);
}

function aclog(ac: AntiCheat, w: World, text: string, tone: 'good' | 'bad' | 'neutral' = 'neutral'): void {
  ac.log.unshift({ day: w.day, text, tone });
  if (ac.log.length > 40) ac.log.length = 40;
}

// ------------------------------------------------------------ detection

/** A layer's strength against one kind of cheat. */
export function layerPower(w: World, ac: AntiCheat, l: AcLayerId, t: CheatType): number {
  const L = ac.layers[l];
  if (!L || !L.on || L.level === 0) return 0;
  let pw = 15 * L.level + 15;
  if (l === 'signatures') pw -= Math.min(25, (w.day - ac.sigDay) * 0.25);
  if (l === 'ml') pw += Math.min(20, ac.data / 5) + Math.min(10, aiLead(w) * 8);
  if ((ac.intel[t] ?? 0) > w.day) pw += 12;
  return pw;
}

/** 0..1: share of a cheat type the stack detects, before sensitivity. */
export function detectionOf(w: World, ac: AntiCheat, t: CheatType): number {
  const soph = cheatsOf(w)[t];
  let miss = 1;
  for (const l of AC_LAYER_IDS) {
    const pw = layerPower(w, ac, l, t);
    if (!pw) continue;
    miss *= 1 - COVERAGE[l][t] * clamp(0.5 + (pw - soph) / 30, 0, 1);
  }
  return 1 - miss;
}

/** Sensitivity turns detections into bans. */
export function catchRate(w: World, ac: AntiCheat, t: CheatType): number {
  return Math.min(0.98, detectionOf(w, ac, t) * (0.7 + (0.6 * ac.policy.sensitivity) / 100));
}

function stackEffectiveness(w: World, ac: AntiCheat): number {
  let e = 0;
  for (const t of CHEAT_IDS) e += CHEAT_TYPES[t].share * catchRate(w, ac, t);
  return clamp(e, 0, 1);
}

/** 0..1: how well your anti-cheat stops today's cheaters. */
export function acEffectiveness(w: World): number {
  const ac = vt(w)?.antiCheat;
  if (!ac || ac.version === 0) return 0;
  if (!(ac as Partial<AntiCheat>).layers) normalizeAntiCheat(w);
  return stackEffectiveness(w, ac);
}

/** How much the overall catch rate would rise with the next level of a layer (switched on). */
export function layerGain(w: World, l: AcLayerId): number {
  const ac = vt(w)?.antiCheat;
  if (!ac || ac.layers[l].level >= AC_MAX_LEVEL) return 0;
  const L = ac.layers[l];
  const saved = { level: L.level, on: L.on, sigDay: ac.sigDay };
  const before = stackEffectiveness(w, ac);
  L.level += 1;
  L.on = true;
  if (l === 'signatures') ac.sigDay = w.day;
  const after = stackEffectiveness(w, ac);
  L.level = saved.level;
  L.on = saved.on;
  ac.sigDay = saved.sigDay;
  return Math.max(0, after - before);
}

/** Share of bans that hit innocent players. */
export function falsePositiveRate(ac: AntiCheat): number {
  const s = ac.policy.sensitivity / 100;
  const smart = ac.layers.heuristics.level + ac.layers.ml.level > 0 ? 1 : 0.4;
  return s * s * 0.03 * smart * (ac.layers.replay.on && ac.layers.replay.level ? 0.7 : 1);
}

/** 0..1: how much of the false-ban damage the appeals team undoes. */
export function appealsCover(ac: AntiCheat, players: number): number {
  return clamp(ac.policy.appeals / Math.max(20000, players * 0.02), 0, 1);
}

/** Online players your anti-cheat protects: in your own games and in your licensees' games. */
export function coveredPlayers(w: World): { own: number; licensed: number; total: number } {
  const lic = new Set(vt(w)?.antiCheat?.licensees ?? []);
  let own = 0;
  let licensed = 0;
  for (const id in w.games) {
    const g = w.games[id];
    if (g.status !== 'released' || !online(g)) continue;
    if (g.companyId === w.player.companyId) own += g.active;
    else if (lic.has(g.companyId)) licensed += g.active;
  }
  return { own, licensed, total: own + licensed };
}

/** Churn multiplier for online games from anti-cheat (yours and your licensees'). */
export function antiCheatChurn(w: World, g: Game, c: Company): number {
  const ac = vt(w)?.antiCheat;
  if (!ac || ac.version === 0 || !online(g)) return 1;
  if (c.isPlayer) {
    const gf = GENRES[g.genre].competitive ? 1.4 : 0.8;
    const rate = ac.cheaters ?? BASE_CHEATERS;
    return clamp(1 + 2.5 * gf * (rate - BASE_CHEATERS), 0.8, 1.6) * (w.day < ac.breachUntil ? 1.1 : 1);
  }
  if (ac.licensees.includes(c.id)) return 1 - 0.06 * acEffectiveness(w);
  return 1;
}

/** Server authority checks every move: your online games need more server capacity. */
export function antiCheatServerMult(w: World): number {
  const ac = vt(w)?.antiCheat;
  const L = ac?.layers?.serverAuth;
  return L && L.on && L.level > 0 ? 1 + 0.015 * L.level : 1;
}

// ------------------------------------------------------------ development

export function layerCost(l: AcLayerId, level: number): number {
  return Math.round(AC_LAYERS[l].base * Math.pow(2.2, level));
}

export function layerWork(level: number): number {
  return 40 + 25 * level;
}

/** First-build cost and days (old API). */
export function acBuildCost(version: number): number {
  return layerCost('signatures', version - 1);
}

export function acBuildDays(version: number): number {
  return layerWork(version - 1);
}

export function securityTeam(w: World) {
  return w.player.employees.filter((e) => e.assignment === AC_TEAM);
}

/** Development speed: the security team (programmers and QA count double). */
export function acSpeed(w: World): number {
  let bonus = 0;
  for (const m of securityTeam(w)) bonus += (m.role === 'programmer' || m.role === 'qa' || m.isFounder ? 0.2 : 0.1) * Math.pow(m.skill / 60, 0.9);
  return 1 + Math.min(2.5, bonus);
}

export function layerBlocker(w: World, l: AcLayerId): string | null {
  const ac = vt(w).antiCheat;
  if (!ac) return 'Found your anti-cheat first.';
  const L = ac.layers[l];
  if (L.level >= AC_MAX_LEVEL) return 'Fully developed.';
  const req = AC_LAYERS[l].requires;
  if (req && ac.layers[req].level < 1) return `Needs ${AC_LAYERS[req].name} first.`;
  if (ac.project) return `Already building ${AC_LAYERS[ac.project.layer].name}.`;
  if (playerCompany(w).cash < layerCost(l, L.level) * 0.25) return `Needs ${fmt(layerCost(l, L.level) * 0.25)} in the bank.`;
  return null;
}

/** Start building a layer's next level (paid day by day). */
export function startLayer(w: World, l: AcLayerId): ActionResult {
  const blocker = layerBlocker(w, l);
  if (blocker) return fail(blocker);
  const ac = vt(w).antiCheat!;
  const level = ac.layers[l].level + 1;
  ac.project = { layer: l, level, work: layerWork(level - 1), done: 0, cost: layerCost(l, level - 1) };
  ac.queue = ac.queue.filter((x) => x !== l);
  return ok();
}

export function queueLayer(w: World, l: AcLayerId): ActionResult {
  const ac = vt(w).antiCheat;
  if (!ac) return fail('Found your anti-cheat first.');
  if (!ac.project && !layerBlocker(w, l)) return startLayer(w, l);
  if (ac.queue.includes(l)) return fail('Already queued.');
  if (ac.layers[l].level >= AC_MAX_LEVEL) return fail('Fully developed.');
  ac.queue.push(l);
  return ok();
}

export function unqueueLayer(w: World, l: AcLayerId): ActionResult {
  const ac = vt(w).antiCheat;
  if (!ac || !ac.queue.includes(l)) return fail('Not queued.');
  ac.queue = ac.queue.filter((x) => x !== l);
  return ok();
}

export function toggleLayer(w: World, l: AcLayerId, on: boolean): ActionResult {
  const ac = vt(w).antiCheat;
  if (!ac) return fail('Found your anti-cheat first.');
  ac.layers[l].on = on;
  if (l === 'kernel') ac.mode = on && ac.layers.kernel.level ? 'kernel' : 'standard';
  if (l === 'hwid' && !on && ac.policy.penalty === 'hardware') ac.policy.penalty = 'permanent';
  return ok();
}

export function foundAntiCheat(w: World, name: string): ActionResult {
  if (vt(w).antiCheat) return fail('You already make anti-cheat.');
  const blocker = ventureBlocker(w, 'antiCheat');
  if (blocker) return fail(blocker);
  const clean = name.trim().slice(0, 24);
  if (!clean) return fail('Give it a name.');
  vt(w).antiCheat = {
    name: clean,
    version: 0,
    strength: 0,
    mode: 'standard',
    building: null,
    licensing: true,
    fee: 0.03,
    licensees: [],
    revenue: 0,
    breachUntil: 0,
    layers: emptyLayers(),
    project: null,
    queue: ['heuristics'],
    sigDay: w.day,
    autoSig: true,
    policy: defaultPolicy(),
    pending: 0,
    nextWave: w.day + 7,
    cheaters: BASE_CHEATERS,
    stats: { bans: 0, falseBans: 0, waves: 0, lawsuitsWon: 0 },
    intel: {},
    ops: [],
    bounty: 0,
    data: 0,
    history: [],
    log: [],
  };
  cheatsOf(w);
  return startLayer(w, 'signatures');
}

/** Old one-click "next version": upgrade the weakest layer you can. */
export function startAntiCheatVersion(w: World): ActionResult {
  const ac = vt(w).antiCheat;
  if (!ac) return fail('Found your anti-cheat first.');
  if (ac.project) return fail('A version is already in development.');
  const options = AC_LAYER_IDS.filter((l) => !layerBlocker(w, l)).sort((a, b) => ac.layers[a].level - ac.layers[b].level);
  if (!options.length) return fail(layerBlocker(w, 'signatures') ?? 'Nothing to build.');
  return startLayer(w, options[0]);
}

export function setAntiCheat(w: World, patch: { licensing?: boolean; fee?: number; mode?: 'standard' | 'kernel'; autoSig?: boolean; bounty?: number }): ActionResult {
  const ac = vt(w).antiCheat;
  if (!ac) return fail('Found your anti-cheat first.');
  if (patch.fee !== undefined) ac.fee = clamp(patch.fee, 0.01, 0.06);
  if (patch.licensing !== undefined) {
    ac.licensing = patch.licensing;
    if (!patch.licensing) ac.licensees = [];
  }
  if (patch.mode) toggleLayer(w, 'kernel', patch.mode === 'kernel');
  if (patch.autoSig !== undefined) ac.autoSig = patch.autoSig;
  if (patch.bounty !== undefined) ac.bounty = clamp(Math.round(patch.bounty), 0, 5e6);
  return ok();
}

export function setAcPolicy(w: World, patch: Partial<AcPolicy>): ActionResult {
  const ac = vt(w).antiCheat;
  if (!ac) return fail('Found your anti-cheat first.');
  if (patch.penalty === 'hardware' && !(ac.layers.hwid.level > 0 && ac.layers.hwid.on)) return fail('Hardware bans need the hardware-ban layer.');
  if (patch.banMode && patch.banMode !== ac.policy.banMode) {
    ac.policy.banMode = patch.banMode;
    // switching to instant flushes the queue now
    ac.nextWave = patch.banMode === 'instant' ? w.day : w.day + BAN_MODES[patch.banMode].every;
  }
  if (patch.sensitivity !== undefined) ac.policy.sensitivity = clamp(Math.round(patch.sensitivity), 0, 100);
  if (patch.penalty) ac.policy.penalty = patch.penalty;
  if (patch.appeals !== undefined) ac.policy.appeals = clamp(Math.round(patch.appeals), 0, 5e6);
  return ok();
}

export function signatureCost(ac: AntiCheat): number {
  return 50000 * Math.max(1, ac.layers.signatures.level);
}

/** Push fresh signatures for the latest cheats. */
export function pushSignatures(w: World): ActionResult {
  const ac = vt(w).antiCheat;
  if (!ac || ac.layers.signatures.level === 0) return fail('Build signature scanning first.');
  const cost = signatureCost(ac);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Costs ${fmt(cost)}.`);
  spend(p, 'ventures', cost);
  ac.sigDay = w.day;
  return ok();
}

// ------------------------------------------------------------ operations against cheat makers

export const OPS: Record<AcOpKind, { name: string; blurb: string; days: number }> = {
  undercover: { name: 'Buy cheats undercover', blurb: 'Learn exactly how good one kind of cheat is, and detect it much better for four months.', days: 21 },
  lawsuit: { name: 'Sue the sellers', blurb: 'Take a cheat seller to court. Win and that kind of cheat is set back badly.', days: 120 },
  honeypot: { name: 'Honeypot', blurb: 'Fake servers that lure cheaters in: lots of training data for machine learning.', days: 45 },
};

export function opCost(w: World, kind: AcOpKind): number {
  const lvl = empireLevel(w);
  return kind === 'undercover' ? 250000 * (1 + lvl) : kind === 'lawsuit' ? 2e6 * (1 + lvl / 2) : 500000 * (1 + lvl / 2);
}

export function lawsuitOdds(w: World): number {
  return clamp(0.5 + 0.3 * execPower(w, 'counsel'), 0.3, 0.85);
}

export function startAcOp(w: World, kind: AcOpKind, target: CheatType | null): ActionResult {
  const ac = vt(w).antiCheat;
  if (!ac) return fail('Found your anti-cheat first.');
  if (ac.ops.length >= AC_MAX_OPS) return fail(`At most ${AC_MAX_OPS} operations at once.`);
  if (kind !== 'honeypot' && !target) return fail('Pick a kind of cheat.');
  if (ac.ops.some((o) => o.kind === kind && o.target === target)) return fail('Already running.');
  const cost = opCost(w, kind);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Costs ${fmt(cost)}.`);
  spend(p, 'ventures', cost);
  ac.ops.push({ id: newId(w, 'ao'), kind, target: kind === 'honeypot' ? null : target, start: w.day, days: OPS[kind].days, cost });
  aclog(ac, w, `${OPS[kind].name}${target ? ` (${CHEAT_TYPES[target].name.toLowerCase()})` : ''} started.`);
  return ok();
}

function finishOp(w: World, ac: AntiCheat, op: AcOp): void {
  const cheats = cheatsOf(w);
  const t = op.target;
  if (op.kind === 'undercover' && t) {
    ac.intel[t] = w.day + 120;
    ac.data = Math.min(100, ac.data + 5);
    aclog(ac, w, `Undercover buy: we know exactly how ${CHEAT_TYPES[t].name.toLowerCase()} work now.`, 'good');
    toast(w, `Undercover intel on ${CHEAT_TYPES[t].name.toLowerCase()}`, 'good', { category: 'studio', link: { route: 'empire', id: 'antiCheat' }, body: 'Detection of that cheat is much stronger for four months.' });
  } else if (op.kind === 'lawsuit' && t) {
    if (chance(w, lawsuitOdds(w))) {
      cheats[t] = Math.max(5, cheats[t] - 15);
      ac.stats.lawsuitsWon += 1;
      playerCompany(w).reputation = Math.min(100, playerCompany(w).reputation + 2);
      pushNews(w, { kind: 'player', title: `${playerCompany(w).name} wins a lawsuit against a ${CHEAT_TYPES[t].name.toLowerCase().replace(/s$/, '')} seller`, companyId: w.player.companyId, tone: 'good' });
      aclog(ac, w, `Lawsuit won: ${CHEAT_TYPES[t].name.toLowerCase()} set back badly.`, 'good');
      toast(w, 'Lawsuit won against cheat sellers', 'good', { category: 'studio', link: { route: 'empire', id: 'antiCheat' } });
    } else {
      cheats[t] += 3;
      playerCompany(w).reputation = Math.max(0, playerCompany(w).reputation - 1);
      aclog(ac, w, `Lawsuit lost: the ${CHEAT_TYPES[t].name.toLowerCase()} sellers are gloating.`, 'bad');
      toast(w, 'Lawsuit against cheat sellers lost', 'bad', { category: 'studio', link: { route: 'empire', id: 'antiCheat' } });
    }
  } else if (op.kind === 'honeypot') {
    ac.data = Math.min(100, ac.data + 20);
    ac.intel.bots = Math.max(ac.intel.bots ?? 0, w.day + 60);
    ac.intel.exploits = Math.max(ac.intel.exploits ?? 0, w.day + 60);
    aclog(ac, w, 'Honeypot closed: a mountain of training data.', 'good');
  }
}

// ------------------------------------------------------------ the daily, weekly and monthly life

/** Cheat makers get better every day: faster the bigger you are, and fastest at what you catch. */
export function cheatersDaily(w: World): void {
  const v = vt(w);
  const pace = (8 / 365) * (1 + rivalPace(w));
  const cheats = cheatsOf(w);
  const ac = v.antiCheat;
  const active = ac && ac.version > 0 && ac.layers;
  const adapt = active ? BAN_MODES[ac.policy.banMode].adapt : 1;
  const bounty = active ? Math.min(0.6, (ac.bounty / 1e6) * 0.6) : 0;
  let avg = 0;
  for (const t of CHEAT_IDS) {
    let g = pace;
    if (active) g *= (0.5 + catchRate(w, ac, t)) * adapt;
    if (t === 'exploits') g *= 1 - bounty;
    cheats[t] += g;
    avg += CHEAT_TYPES[t].share * cheats[t];
  }
  v.cheatLevel = avg;
}

export function antiCheatDaily(w: World): void {
  const ac = vt(w).antiCheat;
  if (!ac) return;
  if (!ac.layers) normalizeAntiCheat(w);
  const p = playerCompany(w);
  const pr = ac.project;
  if (pr) {
    const step = acSpeed(w);
    const today = (pr.cost / pr.work) * Math.min(step, pr.work - pr.done);
    spend(p, 'ventures', today);
    pr.done += step;
    if (pr.done >= pr.work) finishLayer(w, ac);
  }
  if (!ac.project && ac.queue.length) {
    for (const l of [...ac.queue]) if (!layerBlocker(w, l)) {
      startLayer(w, l);
      break;
    }
  }
  for (const op of [...ac.ops]) {
    if (w.day - op.start < op.days) continue;
    ac.ops = ac.ops.filter((x) => x !== op);
    finishOp(w, ac, op);
  }
  if (ac.version > 0 && w.day % 7 === 0) acWeekly(w, ac);
}

function finishLayer(w: World, ac: AntiCheat): void {
  const pr = ac.project!;
  ac.project = null;
  ac.layers[pr.layer].level = pr.level;
  if (pr.layer === 'signatures') ac.sigDay = w.day;
  if (pr.layer === 'kernel' && ac.layers.kernel.on) ac.mode = 'kernel';
  ac.version += 1;
  const def = AC_LAYERS[pr.layer];
  // sometimes cheat makers crack a new build straight away
  if (chance(w, 0.08)) {
    const t = pick(w, CHEAT_IDS);
    cheatsOf(w)[t] += 5;
    aclog(ac, w, `${def.name} ${pr.level} shipped, but ${CHEAT_TYPES[t].name.toLowerCase()} adapted on day one.`, 'bad');
    toast(w, `Cheat makers adapted to ${ac.name}'s new ${def.name.toLowerCase()} on day one`, 'bad', { category: 'studio', link: { route: 'empire', id: 'antiCheat' } });
  } else {
    aclog(ac, w, `${def.name} level ${pr.level} is live.`, 'good');
    toast(w, `${ac.name}: ${def.name} level ${pr.level} is live`, 'good', { category: 'studio', link: { route: 'empire', id: 'antiCheat' }, body: ac.version === 1 ? 'Your online games are protected and rival studios can license it.' : undefined });
  }
  if (ac.version === 1) celebrate(w, `${ac.name} launched`);
}

/** Weekly: cheaters come, get caught, get banned (now or in a wave), and some innocents too. */
function acWeekly(w: World, ac: AntiCheat): void {
  const players = coveredPlayers(w).total;
  const eff = acEffectiveness(w);
  const pen = PENALTIES[ac.policy.penalty === 'hardware' && !(ac.layers.hwid.level && ac.layers.hwid.on) ? 'permanent' : ac.policy.penalty];
  const hwid = ac.layers.hwid.on ? ac.layers.hwid.level : 0;
  const comeback = Math.max(0.03, pen.comeback - 0.04 * hwid);
  const cheats = cheatsOf(w);
  let avg = 0;
  for (const t of CHEAT_IDS) avg += CHEAT_TYPES[t].share * cheats[t];
  // new cheaters arrive
  const inflow = 0.006 * (1 + avg / 60) * (1 - pen.deter) * (w.day < ac.breachUntil ? 2 : 1);
  ac.cheaters = clamp(ac.cheaters + inflow * (1 - ac.cheaters), 0, 0.4);
  // and get caught
  const caught = Math.max(0, ac.cheaters - ac.pending) * eff * 0.6;
  const mode = BAN_MODES[ac.policy.banMode];
  let banned = 0;
  let wave = false;
  if (mode.every === 0) {
    banned = caught;
    ac.cheaters = Math.max(0, ac.cheaters - caught * (1 - comeback));
  } else {
    ac.pending += caught;
    if (w.day >= ac.nextWave) {
      banned = ac.pending;
      ac.cheaters = Math.max(0, ac.cheaters - ac.pending * (1 - comeback));
      ac.pending = 0;
      ac.nextWave = w.day + mode.every;
      ac.stats.waves += 1;
      wave = true;
      const n = Math.round(banned * players);
      if (n > 0) {
        for (const id in w.games) {
          const g = w.games[id];
          if (g.companyId === w.player.companyId && g.status === 'released' && online(g)) g.goodwill += mode.every >= 30 ? 1.5 : 0.5;
        }
        aclog(ac, w, `Ban wave: ${n.toLocaleString()} accounts banned.`, 'good');
        if (n >= 1000) toast(w, `${ac.name} ban wave: ${n.toLocaleString()} cheaters banned`, 'good', { category: 'game', link: { route: 'empire', id: 'antiCheat' } });
      }
    }
  }
  const bans = banned * players;
  ac.stats.bans += Math.round(bans);
  // innocent players caught in the net
  const fp = bans * falsePositiveRate(ac) * (hwid ? 1.3 : 1);
  ac.stats.falseBans += Math.round(fp);
  ac.report = { day: w.day, players, flagged: Math.round(caught * players), banned: Math.round(bans), falseBans: Math.round(fp), wave };
  if (players > 0 && fp > 0) {
    const hurt = Math.min(2, (fp / players) * 1000) * (1 - 0.7 * appealsCover(ac, players));
    for (const id in w.games) {
      const g = w.games[id];
      if (g.companyId === w.player.companyId && g.status === 'released' && online(g)) g.goodwill -= hurt;
    }
    if (fp > Math.max(200, players * 0.0005) && !w.pendingEvents.some((e) => e.kind === 'acFalseBans') && chance(w, 0.35)) falseBanScandal(w, ac, Math.round(fp));
  }
  // signatures on autopilot
  if (ac.autoSig && ac.layers.signatures.level > 0) ac.sigDay = w.day;
}

function falseBanScandal(w: World, ac: AntiCheat, n: number): void {
  const cost = Math.round(Math.max(50000, n * 25));
  pushDecision(w, {
    kind: 'acFalseBans',
    title: `Players say ${ac.name} banned them for nothing`,
    body: `About ${n.toLocaleString()} innocent players were banned this week and streamers are making videos about it. Refund and unban them, defend the system, or retune detection to be less aggressive.`,
    options: [
      { id: 'refund', label: `Unban and refund · ${fmt(cost)}`, description: 'Players forgive you.', disabled: playerCompany(w).cash < cost },
      { id: 'defend', label: 'Defend the system', description: `${fanChange(playerCompany(w), -3)}, players stay angry.` },
      { id: 'retune', label: 'Lower sensitivity by 20', description: 'Fewer false bans, more cheaters slip through.' },
    ],
    data: { cost },
    expiresDay: w.day + 21,
    defaultOption: 'retune',
  });
}

function rivalsOf(w: World): Company[] {
  const out: Company[] = [];
  for (const id in w.companies) {
    const c = w.companies[id];
    if (c.status === 'active' && !c.isPlayer && !isPlayerGroup(w, c)) out.push(c);
  }
  return out;
}

export function antiCheatMonthly(w: World): void {
  const ac = vt(w).antiCheat;
  const p = playerCompany(w);
  if (!ac) return;
  if (!ac.layers) normalizeAntiCheat(w);
  // running costs
  if (ac.autoSig && ac.layers.signatures.level > 0) spend(p, 'ventures', signatureCost(ac) * 4);
  if (ac.bounty > 0) spend(p, 'ventures', ac.bounty);
  if (ac.policy.appeals > 0) spend(p, 'ventures', ac.policy.appeals);
  if (ac.version === 0) return;
  const e = acEffectiveness(w);
  // machine-learning data from everyone you protect
  const players = coveredPlayers(w).own;
  ac.data = clamp(ac.data * 0.97 + Math.log10(1 + coveredPlayers(w).total / 1e4) * 2 + ac.licensees.length * 0.5, 0, 100);
  // the bug bounty turns up exploits
  if (ac.bounty > 0 && chance(w, Math.min(0.5, ac.bounty / 1e6))) {
    cheatsOf(w).exploits = Math.max(5, cheatsOf(w).exploits - 3);
    aclog(ac, w, 'A bug-bounty hunter reported an exploit before cheaters found it.', 'good');
  }
  // rival studios license it, and drop it when cheaters get through
  ac.monthRevenue = 0;
  if (ac.licensing) {
    const lic = new Set(ac.licensees);
    for (const c of rivalsOf(w)) {
      const games = Object.values(w.games).filter((g) => g.companyId === c.id && g.status === 'released' && online(g));
      if (lic.has(c.id)) {
        const drop = e < 0.2 ? 0.12 : e < 0.3 ? 0.04 : 0.01;
        if (!games.length || chance(w, drop)) {
          lic.delete(c.id);
          if (e < 0.3) pushNews(w, { kind: 'industry', title: `${c.name} drops ${ac.name} after a cheating scandal`, companyId: c.id, tone: 'bad' });
          continue;
        }
        const gross = games.reduce((s, g) => s + g.rev30, 0);
        const fee = Math.min(c.cash * 0.2, gross * ac.fee) * (decreeActive(w) ? 0.5 : 1);
        if (fee > 0) {
          c.cash -= fee;
          c.ledger.royalties += fee;
          earn(p, 'tech', fee);
          ac.revenue += fee;
          ac.monthRevenue += fee;
        }
      } else if (games.length && e >= 0.1 && chance(w, 0.06 * (0.3 + e) * clamp((0.06 - ac.fee) / 0.03, 0, 1.7))) {
        lic.add(c.id);
        pushNews(w, { kind: 'industry', title: `${c.name} licenses ${ac.name} for its online games`, companyId: c.id, tone: 'good' });
      }
    }
    ac.licensees = [...lic];
  }
  // cheating drags on every online match
  if (players > 0) {
    const drag = (ac.cheaters - BASE_CHEATERS) * 10;
    for (const id in w.games) {
      const g = w.games[id];
      if (g.companyId === p.id && g.status === 'released' && online(g)) g.goodwill -= drag;
    }
  }
  // when cheat makers are well ahead, a cheating wave hits
  if (e < 0.15 && chance(w, 0.25)) {
    ac.breachUntil = w.day + 45;
    ac.cheaters = Math.min(0.4, ac.cheaters + 0.05);
    p.reputation = Math.max(0, p.reputation - 2);
    toast(w, `Cheaters broke through ${ac.name}`, 'bad', { category: 'game', link: { route: 'empire', id: 'antiCheat' }, body: 'Cheaters are flooding your online games for 45 days. Strengthen your layers.' });
    aclog(ac, w, 'Cheaters broke through: a cheating wave is hitting your games.', 'bad');
  }
  const kernel = ac.layers.kernel;
  if (kernel.on && kernel.level > 0 && chance(w, 0.04 * (kernel.level / 3))) {
    p.reputation = Math.max(0, p.reputation - 3);
    if (ac.licensees.length) ac.licensees.pop();
    toast(w, `Privacy backlash over ${ac.name}'s kernel driver`, 'bad', { category: 'studio', link: { route: 'empire', id: 'antiCheat' } });
    aclog(ac, w, 'Privacy backlash over the kernel driver.', 'bad');
  }
  ac.history.push([w.day, Math.round(ac.cheaters * 1000) / 1000, Math.round(e * 100) / 100]);
  if (ac.history.length > 48) ac.history.shift();
  acEvents(w, ac);
}

const CHEAT_NAMES = ['Phantom', 'Ghost', 'Nyx', 'Vortex', 'Specter', 'Hydra', 'Oblivion', 'Wraith', 'Cipher', 'Venom'];

function acEvents(w: World, ac: AntiCheat): void {
  if (w.pendingEvents.some((e) => e.kind === 'acCheatLaunch' || e.kind === 'acFalseBans')) return;
  if (!chance(w, 0.06)) return;
  const t = pick(w, CHEAT_IDS);
  const name = `${pick(w, CHEAT_NAMES)} ${pick(w, ['X', 'Pro', 'Elite', 'v2', 'Prime'])}`;
  const cost = Math.round(opCost(w, 'undercover') * 1.5);
  pushDecision(w, {
    kind: 'acCheatLaunch',
    title: `A new ${CHEAT_TYPES[t].name.toLowerCase().replace(/s$/, '')} called "${name}" claims to beat ${ac.name}`,
    body: `${name} is selling fast on cheat forums. Rush an emergency response (buy it, analyse it, push detections), take its makers to court, or wait and see.`,
    options: [
      { id: 'respond', label: `Emergency response · ${fmt(cost)}`, description: 'Detect it properly for four months.', disabled: playerCompany(w).cash < cost },
      { id: 'sue', label: `Sue · ${fmt(opCost(w, 'lawsuit'))}`, description: `About ${Math.round(lawsuitOdds(w) * 100)}% to win in four months.`, disabled: playerCompany(w).cash < opCost(w, 'lawsuit') || ac.ops.length >= AC_MAX_OPS },
      { id: 'wait', label: 'Wait and see', description: 'That kind of cheat gets noticeably better.' },
    ],
    data: { type: t, cost },
    expiresDay: w.day + 21,
    defaultOption: 'wait',
  });
}

export function resolveAntiCheatDecision(w: World, ev: DecisionEvent, optionId: string): boolean {
  if (ev.kind !== 'acCheatLaunch' && ev.kind !== 'acFalseBans') return false;
  const ac = vt(w).antiCheat;
  if (!ac) return true;
  const p = playerCompany(w);
  if (ev.kind === 'acFalseBans') {
    const cost = Number(ev.data.cost);
    if (optionId === 'refund' && p.cash >= cost) {
      spend(p, 'ventures', cost);
      for (const id in w.games) {
        const g = w.games[id];
        if (g.companyId === p.id && g.status === 'released' && online(g)) g.goodwill += 2;
      }
      aclog(ac, w, 'False bans reversed and refunded.', 'good');
    } else if (optionId === 'defend') {
      p.reputation = Math.max(0, p.reputation - 3);
      aclog(ac, w, 'Defended the false bans. Players are not convinced.', 'bad');
    } else {
      ac.policy.sensitivity = Math.max(0, ac.policy.sensitivity - 20);
      aclog(ac, w, `Detection retuned to sensitivity ${ac.policy.sensitivity}.`);
    }
    return true;
  }
  const t = String(ev.data.type) as CheatType;
  const cheats = cheatsOf(w);
  if (optionId === 'respond' && p.cash >= Number(ev.data.cost)) {
    spend(p, 'ventures', Number(ev.data.cost));
    ac.intel[t] = w.day + 120;
    aclog(ac, w, `Emergency response to a new ${CHEAT_TYPES[t].name.toLowerCase().replace(/s$/, '')}.`, 'good');
  } else if (optionId === 'sue' && startAcOp(w, 'lawsuit', t).ok) {
    cheats[t] += 2;
  } else {
    cheats[t] += 6;
    aclog(ac, w, `A new ${CHEAT_TYPES[t].name.toLowerCase().replace(/s$/, '')} spreads unchecked.`, 'bad');
  }
  return true;
}

/** For the UI: how sophisticated each cheat type looks to you (exact with intel, rough without). */
export function cheatEstimate(w: World, t: CheatType): { value: number; exact: boolean } {
  const ac = vt(w).antiCheat;
  const v = cheatsOf(w)[t];
  if (ac && (ac.intel[t] ?? 0) > w.day) return { value: v, exact: true };
  return { value: Math.round(v / 5) * 5, exact: false };
}

/** Rough weekly ban rate, for the UI. */
export function weeklyBanEstimate(w: World): { cheaters: number; bans: number; falseBans: number; players: number } {
  const ac = vt(w).antiCheat;
  const players = coveredPlayers(w).total;
  if (!ac || ac.version === 0) return { cheaters: 0, bans: 0, falseBans: 0, players };
  const bans = Math.max(0, ac.cheaters - ac.pending) * acEffectiveness(w) * 0.6 * players;
  return { cheaters: ac.cheaters * players, bans, falseBans: bans * falsePositiveRate(ac), players };
}


// ------------------------------------------------------------ plain-language guidance for the UI

/** The day the next ban wave actually goes out (waves happen on the weekly check). */
export function nextWaveDay(w: World): number {
  const ac = vt(w).antiCheat;
  const next7 = (Math.floor(w.day / 7) + 1) * 7;
  return Math.ceil(Math.max(ac?.nextWave ?? next7, next7) / 7) * 7;
}

/** Weighted churn multiplier your anti-cheat puts on your own online games (below 1 = players stay longer). */
export function acChurnEffect(w: World): number | null {
  const p = playerCompany(w);
  let sum = 0;
  let tot = 0;
  for (const id in w.games) {
    const g = w.games[id];
    if (g.companyId !== p.id || g.status !== 'released' || !online(g)) continue;
    const a = Math.max(1, g.active);
    sum += a * antiCheatChurn(w, g, p);
    tot += a;
  }
  return tot ? sum / tot : null;
}

export interface AcNote {
  tone: 'good' | 'warn' | 'bad' | 'neutral';
  text: string;
}

/** What is going on right now, and why a number might still be zero. */
export function acStatus(w: World): AcNote[] {
  const ac = vt(w).antiCheat;
  if (!ac) return [];
  const out: AcNote[] = [];
  const cov = coveredPlayers(w);
  const pr = ac.project;
  if (ac.version === 0) {
    out.push(
      pr
        ? { tone: 'warn', text: `Your first layer, ${AC_LAYERS[pr.layer].name}, is being built: ${Math.ceil((pr.work - pr.done) / acSpeed(w))} days left. Nothing is protected until it is live, so the catch rate and bans stay at 0 until then.` }
        : { tone: 'bad', text: 'Nothing is being built. Pick a detection layer below to get started.' },
    );
  }
  if (cov.total === 0) {
    out.push({ tone: 'warn', text: `No players to protect yet. Anti-cheat only works in online and MMO games, and none of yours are out${ac.licensing ? ', and no studio has licensed it yet' : ''}. Bans start as soon as there are online players.` });
  } else if (cov.own === 0) {
    out.push({ tone: 'neutral', text: `None of your own games are online, but ${ac.licensees.length} studio${ac.licensees.length === 1 ? '' : 's'} use ${ac.name}: it protects ${count(cov.licensed)} of their players.` });
  }
  if (ac.version > 0 && cov.total > 0) {
    const r = ac.report;
    if (r && r.players > 0) {
      const what = r.wave ? `Ban wave last week: ${count(r.banned)} cheaters banned` : r.banned > 0 ? `Last week: ${count(r.banned)} cheaters banned` : `Last week: ${count(r.flagged)} cheaters caught (banned in the next wave)`;
      out.push({ tone: r.banned > 0 || r.flagged > 0 ? 'good' : 'neutral', text: `${what}${r.falseBans > 0 ? `, ${count(r.falseBans)} innocent players hit by mistake` : ''}.` });
    }
    if (ac.policy.banMode !== 'instant') {
      const d = nextWaveDay(w) - w.day;
      const waiting = ac.pending * cov.total;
      out.push({ tone: 'neutral', text: `Next ban wave in ${d} day${d === 1 ? '' : 's'}${waiting >= 1 ? `: ${count(waiting)} cheaters caught and waiting for it` : ''}.` });
    }
  }
  return out;
}

export interface AcAdvice {
  id: string;
  title: string;
  why: string;
  /** Button text; no button when there is nothing to click. */
  label?: string;
  run?: (w: World) => ActionResult;
  /** A screen to open instead. */
  route?: 'create';
}

function bestNextLayer(w: World, ac: AntiCheat, only?: CheatType): { l: AcLayerId; gain: number } | null {
  let best: { l: AcLayerId; gain: number; score: number } | null = null;
  for (const l of AC_LAYER_IDS) {
    if (ac.layers[l].level >= AC_MAX_LEVEL || ac.project?.layer === l || ac.queue.includes(l)) continue;
    const req = AC_LAYERS[l].requires;
    if (req && ac.layers[req].level < 1) continue;
    const gain = layerGain(w, l);
    const score = only ? COVERAGE[l][only] * (1 + gain) : gain / Math.sqrt(layerCost(l, ac.layers[l].level));
    if (gain <= 0.005 && !only) continue;
    if (!best || score > best.score) best = { l, gain, score };
  }
  return best;
}

function joinSecurityTeam(w: World, id: string): ActionResult {
  const e = w.player.employees.find((x) => x.id === id);
  if (!e || !ROLES[e.role].dev) return fail('They cannot join the security team.');
  e.assignment = AC_TEAM;
  return ok();
}

/** Up to four concrete next steps, most useful first. */
export function acAdvice(w: World): AcAdvice[] {
  const ac = vt(w).antiCheat;
  if (!ac) return [];
  const out: AcAdvice[] = [];
  const cov = coveredPlayers(w);
  const eff = stackEffectiveness(w, ac);
  // 1. always have something building
  if (!ac.project || !ac.queue.length) {
    const b = bestNextLayer(w, ac);
    if (b) {
      const lvl = ac.layers[b.l].level + 1;
      out.push({
        id: 'layer',
        title: `${ac.project ? 'Queue' : 'Build'} ${AC_LAYERS[b.l].name}${lvl > 1 ? ` level ${lvl}` : ''}`,
        why: `Best value right now: catches ${pctText(eff)} → ${pctText(eff + b.gain)} of cheaters. ${fmt(layerCost(b.l, lvl - 1))}, paid while it builds.`,
        label: ac.project ? 'Queue it' : 'Build it',
        run: (x) => queueLayer(x, b.l),
      });
    }
  }
  if (ac.licensing === false) {
    out.push({ id: 'licensing', title: 'Turn on licensing', why: `Rival studios would pay ${pctText(ac.fee)} of their online revenue to use ${ac.name}, and their players count towards your bans and training data.`, label: 'Turn on', run: (x) => setAntiCheat(x, { licensing: true }) });
  }
  if (cov.own === 0) {
    out.push({ id: 'online', title: 'Make an online game', why: 'Anti-cheat only protects online and MMO games. With one of your own, fewer cheaters means players stay longer.', label: 'New game', route: 'create' });
  }
  // 2. stale signatures
  const sigAge = w.day - ac.sigDay;
  if (ac.layers.signatures.level > 0 && !ac.autoSig && sigAge > 30) {
    out.push({ id: 'sig', title: 'Your cheat signatures are going stale', why: `Last update ${sigAge} days ago, so signature scanning has lost strength. Auto-push weekly for ${fmt(signatureCost(ac) * 4)}/mo and forget about it.`, label: 'Auto-push weekly', run: (x) => setAntiCheat(x, { autoSig: true }) });
  }
  // 3. the weakest kind of cheat
  if (ac.version > 0) {
    let weak: CheatType | null = null;
    for (const t of CHEAT_IDS) if (!weak || catchRate(w, ac, t) < catchRate(w, ac, weak)) weak = t;
    const r = weak ? catchRate(w, ac, weak) : 1;
    if (weak && r < 0.3) {
      const b = bestNextLayer(w, ac, weak);
      if (b && !out.some((a) => a.id === 'layer' && a.title.includes(AC_LAYERS[b.l].name))) {
        out.push({ id: 'weak', title: `Weak spot: ${CHEAT_TYPES[weak].name.toLowerCase()}`, why: `You catch only ${pctText(r)} of them. ${AC_LAYERS[b.l].name} is the best counter you can build.`, label: ac.project ? 'Queue it' : 'Build it', run: (x) => queueLayer(x, b.l) });
      }
    }
  }
  // 4. a security team
  if (!securityTeam(w).length) {
    const idle = w.player.employees.filter((e) => ROLES[e.role].dev && !e.assignment).sort((a, b) => Number(b.role === 'programmer' || b.role === 'qa') - Number(a.role === 'programmer' || a.role === 'qa') || b.skill - a.skill)[0];
    if (idle) out.push({ id: 'team', title: 'Nobody is on the security team', why: `${idle.name} (${ROLES[idle.role].name}, skill ${Math.round(idle.skill)}) is free. Security staff build layers faster; programmers and QA count double.`, label: `Add ${idle.name.split(' ')[0]}`, run: (x) => joinSecurityTeam(x, idle.id) });
  }
  // 5. too many innocent players banned
  const est = weeklyBanEstimate(w);
  if (falsePositiveRate(ac) > 0.012 && est.falseBans > 30) {
    const to = Math.max(0, ac.policy.sensitivity - 15);
    out.push({ id: 'fp', title: 'Too many innocent players are banned', why: `About ${count(est.falseBans)} a week. Lowering sensitivity to ${to} bans fewer innocents but lets a few more cheaters through.`, label: `Sensitivity ${to}`, run: (x) => setAcPolicy(x, { sensitivity: to }) });
  }
  // 6. hardware bans built but not used
  if (ac.layers.hwid.level > 0 && ac.layers.hwid.on && ac.policy.penalty !== 'hardware') {
    out.push({ id: 'hwid', title: 'Use hardware bans', why: 'You built the hardware-ban layer: banned cheaters would rarely come back.', label: 'Switch penalty', run: (x) => setAcPolicy(x, { penalty: 'hardware' }) });
  }
  // 7. cheaters broke through
  if (w.day < ac.breachUntil && ac.ops.length < AC_MAX_OPS && !ac.ops.some((o) => o.kind === 'honeypot')) {
    out.push({ id: 'breach', title: 'Cheaters broke through', why: `A honeypot (${fmt(opCost(w, 'honeypot'))}) floods machine learning with fresh data and helps you catch bots and exploits fast.`, label: 'Run a honeypot', run: (x) => startAcOp(x, 'honeypot', null) });
  }
  return out.slice(0, 4);
}
