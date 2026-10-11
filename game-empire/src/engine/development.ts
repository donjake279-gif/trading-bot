// Game development: work estimates, daily progress, quality and release.
import {
  ART_STYLES,
  ENGINES,
  FOCUS_IDS,
  GENRES,
  MONETIZATIONS,
  MULTIPLAYER,
  OFFICES,
  PLATFORMS,
  ROLES,
  SCOPES,
  artFit,
  audienceFit,
  platformAffinity,
} from './constants';
import { chance, randNormal, randRange } from './rng';
import type {
  ArtStyleId,
  AudienceId,
  Company,
  Employee,
  EngineId,
  Focus,
  Game,
  GenreId,
  MonetizationId,
  MultiplayerId,
  PlatformId,
  ResearchId,
  ScopeId,
  World,
} from './types';
import { clamp, gamesOf, newId, pushNews, toast } from './util';

export interface GameParams {
  title: string;
  genre: GenreId;
  platforms: PlatformId[];
  audience: AudienceId;
  engine: EngineId;
  monetization: MonetizationId;
  price: number;
  artStyle: ArtStyleId;
  multiplayer: MultiplayerId;
  scope: ScopeId;
  budget: number;
  focus: Focus;
  ipId?: string;
}

export function hasResearch(w: World, id: ResearchId): boolean {
  return w.player.research.completed.includes(id);
}

/** Engine stats with the player's in-house engine level applied. */
export function engineStats(w: World, engine: EngineId, isPlayer: boolean) {
  const def = ENGINES[engine];
  if (engine === 'inhouse' && isPlayer) {
    if (hasResearch(w, 'engine3')) return { ...def, cap: 100, workMult: 0.72, bugMult: 0.8 };
    if (hasResearch(w, 'engine2')) return { ...def, cap: 95, workMult: 0.78, bugMult: 0.85 };
  }
  if (engine === 'titan') return { ...def, royalty: w.market.titanRoyalty };
  return def;
}

export function platformWorkFactor(platforms: PlatformId[], crossplay: boolean): number {
  if (platforms.length <= 1) return 1;
  const mults = platforms.map((p) => PLATFORMS[p].workMult).sort((a, b) => b - a);
  let extra = 0;
  for (let i = 1; i < mults.length; i++) extra += mults[i];
  return 1 + extra * (crossplay ? 0.5 : 1);
}

export function estimateWork(w: World, p: Pick<GameParams, 'scope' | 'genre' | 'artStyle' | 'multiplayer' | 'engine' | 'platforms'>, isPlayer: boolean): number {
  const eng = engineStats(w, p.engine, isPlayer);
  return (
    SCOPES[p.scope].work *
    GENRES[p.genre].complexity *
    ART_STYLES[p.artStyle].workMult *
    MULTIPLAYER[p.multiplayer].workMult *
    eng.workMult *
    platformWorkFactor(p.platforms, isPlayer && hasResearch(w, 'crossplay'))
  );
}

export function recommendedBudget(scope: ScopeId, art: ArtStyleId, platforms: PlatformId[]): number {
  return SCOPES[scope].budget * ART_STYLES[art].costMult * (1 + 0.15 * Math.max(0, platforms.length - 1));
}

export function upfrontCosts(w: World, p: Pick<GameParams, 'engine' | 'platforms'>, isPlayer: boolean): number {
  const eng = engineStats(w, p.engine, isPlayer);
  let cost = eng.licenseCost;
  for (const pl of p.platforms) cost += PLATFORMS[pl].devKit;
  return cost;
}

export function blankFocus(): Focus {
  return { gameplay: 0, graphics: 0, story: 0, audio: 0, tech: 0, content: 0 };
}

export function createGameRecord(w: World, company: Company, p: GameParams, isPlayer: boolean): Game {
  const id = newId(w, 'g');
  let ipId = p.ipId;
  let sequelNo = 1;
  if (ipId && w.ips[ipId]) {
    const ip = w.ips[ipId];
    sequelNo = ip.games.length + 1;
    ip.games.push(id);
  } else {
    ipId = newId(w, 'ip');
    w.ips[ipId] = { id: ipId, name: p.title.split(':')[0].trim(), companyId: company.id, games: [id], fans: 0, createdDay: w.day };
  }
  const workRequired = estimateWork(w, p, isPlayer);
  const ip = w.ips[ipId];
  const startHype = sequelNo > 1 ? Math.min(400, Math.log10(1 + ip.fans) * 25) : 0; // capped well below the 1400 hype ceiling
  return {
    id,
    title: p.title,
    companyId: company.id,
    developerName: company.name,
    ipId,
    sequelNo,
    genre: p.genre,
    platforms: [...p.platforms],
    audience: p.audience,
    engine: p.engine,
    monetization: p.monetization,
    price: MONETIZATIONS[p.monetization].upfront ? p.price : 0,
    artStyle: p.artStyle,
    multiplayer: p.multiplayer,
    scope: p.scope,
    budget: Math.max(0, p.budget),
    budgetSpent: 0,
    staffCost: 0,
    status: 'development',
    createdDay: w.day,
    workRequired,
    workDone: 0,
    focus: { ...p.focus },
    points: blankFocus(),
    bugs: 0,
    crunch: false,
    crunchDays: 0,
    team: [],
    aiTeam: 0,
    aiTalent: company.talent,
    hype: startHype,
    wishlists: 0,
    marketingSpent: 0,
    plannedDays: 0,
    aiMarketingStage: 0,
    publisherCut: 0,
    releaseDay: null,
    quality: 0,
    criticScore: 0,
    userScore: 0,
    userScoreTarget: 0,
    breakout: 1,
    freshness: 1,
    owners: 0,
    active: 0,
    ccu: 0,
    peakCcu: 0,
    peakActive: 0,
    dailyNew: 0,
    dailyRevenue: 0,
    dailyCost: 0,
    revenueTotal: 0,
    costTotal: 0,
    rev30: 0,
    cost30: 0,
    dlcOwners: 0,
    viralUntil: 0,
    viralMult: 1,
    seasonalUntil: 0,
    discount: 0,
    discountUntil: 0,
    meltdownUntil: 0,
    goodwill: 0,
    update: null,
    updates: [],
    lastUpdateDay: w.day,
    awards: [],
    shutdownDay: null,
    history: [],
  };
}

// ------------------------------------------------------------ player work

export interface MemberOutput {
  work: number;
  quality: number;
  alloc: Focus;
  bugFix: number;
}

export function playerSpeedMods(w: World): number {
  let m = OFFICES[w.player.officeLevel].productivity;
  if (hasResearch(w, 'agile')) m *= 1.1;
  if (hasResearch(w, 'aiTools')) m *= 1.2;
  return m;
}

export function memberOutput(w: World, e: Employee, f: Focus, crunch: boolean, teamEff: number, producerBoost: number): MemberOutput {
  const role = ROLES[e.role];
  const moraleF = 0.6 + 0.5 * (e.morale / 100);
  let speed = 1;
  if (e.traits.includes('speedster')) speed *= 1.2;
  if (e.traits.includes('perfectionist')) speed *= 0.9;
  const work =
    Math.pow(e.skill / 50, 0.8) * moraleF * speed * playerSpeedMods(w) * (crunch ? 1.3 : 1) * teamEff * producerBoost * role.workShare;
  let quality = Math.pow(e.skill / 50, 0.6);
  if (e.traits.includes('perfectionist')) quality *= 1.15;
  if (e.traits.includes('genius')) quality *= 1.3;

  const alloc = blankFocus();
  let total = 0;
  for (const d of FOCUS_IDS) {
    let c = role.contributes[d] ?? 0;
    if (e.isFounder && e.specialty) {
      const spec = ROLES[e.specialty].contributes[d] ?? 0;
      c = 0.6 + spec * 1.2;
    }
    const v = c * (0.15 + f[d]);
    alloc[d] = v;
    total += v;
  }
  if (total > 0) for (const d of FOCUS_IDS) alloc[d] /= total;

  let bugFix = 0;
  if (e.role === 'qa') bugFix = 0.32 * (e.skill / 50);
  return { work, quality, alloc, bugFix };
}

export function teamFor(w: World, gameId: string): Employee[] {
  return w.player.employees.filter((e) => e.assignment === gameId && ROLES[e.role].dev);
}

export function teamFactors(team: Employee[], scope: keyof typeof SCOPES) {
  const contributors = team.filter((e) => e.role !== 'producer').length;
  const max = SCOPES[scope].maxTeam;
  const teamEff = contributors <= max ? 1 : (max + 0.3 * (contributors - max)) / contributors;
  let prod = 0;
  for (const e of team) if (e.role === 'producer') prod += 0.06 * (e.skill / 50);
  return { teamEff, producerBoost: 1 + Math.min(0.3, prod) };
}

export function playerBugRate(w: World, g: Game, e: Employee): number {
  const eng = engineStats(w, g.engine, true);
  let r = 0.07 * (1.3 - e.skill / 100) * eng.bugMult;
  if (g.crunch) r *= 1.4;
  if (hasResearch(w, 'qaAutomation')) r *= 0.65;
  if (hasResearch(w, 'aiTools')) r *= 0.8;
  if (e.traits.includes('speedster')) r *= 1.25;
  if (e.traits.includes('perfectionist')) r *= 0.7;
  return r;
}

/** Estimated work per day the current team produces on a game. */
export function playerDailyWork(w: World, g: Game, team: Employee[] = teamFor(w, g.id)): number {
  const { teamEff, producerBoost } = teamFactors(team, g.scope);
  let total = 0;
  for (const e of team) total += memberOutput(w, e, g.focus, g.crunch, teamEff, producerBoost).work;
  return total;
}

function applyWork(g: Game, out: MemberOutput, bugRate: number, polishing: boolean) {
  if (!polishing) {
    for (const d of FOCUS_IDS) g.points[d] += out.work * out.alloc[d] * out.quality;
    g.workDone += out.work;
    g.bugs += out.work * bugRate;
  } else {
    // polish: progress keeps counting past 100%, with diminishing quality gains
    for (const d of FOCUS_IDS) g.points[d] += out.work * out.alloc[d] * out.quality * 0.2;
    g.bugs = Math.max(0, g.bugs - out.work * 0.12);
    g.workDone += out.work;
  }
  if (out.bugFix > 0) g.bugs = Math.max(0, g.bugs - out.bugFix);
}

export function playerDevDay(w: World, g: Game, c: Company): void {
  const team = teamFor(w, g.id);
  if (team.length === 0) return;
  const { teamEff, producerBoost } = teamFactors(team, g.scope);
  const polishing = g.workDone >= g.workRequired;
  let dayWork = 0;
  for (const e of team) {
    const out = memberOutput(w, e, g.focus, g.crunch, teamEff, producerBoost);
    dayWork += out.work;
    applyWork(g, out, playerBugRate(w, g, e), polishing);
    // experience
    const learn = e.traits.includes('fastLearner') ? 2 : 1;
    e.xp += 0.02 * learn * (team.some((m) => m.traits.includes('mentor') && m.id !== e.id) ? 1.5 : 1);
  }
  if (g.crunch) g.crunchDays += 1;
  for (const e of team) g.staffCost += e.salary / 30;
  spendBudget(g, c, dayWork, polishing);
}

function spendBudget(g: Game, c: Company, dayWork: number, polishing: boolean) {
  if (polishing || dayWork <= 0) return;
  const remainingBudget = g.budget - g.budgetSpent;
  if (remainingBudget <= 0) return;
  const daysLeft = Math.max(1, (g.workRequired - g.workDone) / dayWork);
  const amt = Math.min(remainingBudget, remainingBudget / daysLeft);
  g.budgetSpent += amt;
  c.cash -= amt;
  c.ledger.development += amt;
}

// ------------------------------------------------------------ AI work

export function aiDevDay(w: World, g: Game, c: Company, qualityMult: number): void {
  if (g.aiTeam <= 0) return;
  const max = SCOPES[g.scope].maxTeam;
  const n = g.aiTeam;
  const teamEff = n <= max ? 1 : (max + 0.3 * (n - max)) / n;
  const talent = c.talent;
  const work = n * teamEff * Math.pow(talent / 50, 0.8) * 1.05;
  const out: MemberOutput = {
    work,
    quality: Math.pow(talent / 50, 0.6) * qualityMult,
    alloc: g.focus,
    bugFix: n * 0.04 * (talent / 50),
  };
  const polishing = g.workDone >= g.workRequired;
  const eng = engineStats(w, g.engine, false);
  const bugRate = 0.06 * (1.3 - talent / 100) * eng.bugMult;
  applyWork(g, out, bugRate, polishing);
  g.staffCost += (n * (c.avgSalary + 1100)) / 30;
  spendBudget(g, c, work, polishing);
}

// ------------------------------------------------------------ quality

export function designScore(g: Game): number {
  const ideal = GENRES[g.genre].ideal;
  let s = 0;
  for (const d of FOCUS_IDS) {
    const expected = g.workRequired * ideal[d];
    const x = expected > 0 ? g.points[d] / expected : 1;
    const v = x < 1 ? x : 1 + 0.35 * (1 - Math.exp(-1.5 * (x - 1)));
    s += ideal[d] * v;
  }
  return s;
}

export function fitScores(g: Pick<Game, 'genre' | 'audience' | 'artStyle' | 'multiplayer' | 'platforms'>) {
  const fa = audienceFit(g.audience, g.genre);
  const fart = artFit(g.artStyle, g.genre);
  const fmp = GENRES[g.genre].mp[g.multiplayer];
  let pa = 0;
  for (const p of g.platforms) pa += platformAffinity(p, g.genre);
  pa /= Math.max(1, g.platforms.length);
  return { audience: fa, art: fart, multiplayer: fmp, platform: pa };
}

export function fitBonus(g: Pick<Game, 'genre' | 'audience' | 'artStyle' | 'multiplayer' | 'platforms'>): number {
  const f = fitScores(g);
  return (f.audience - 1) * 14 + (f.art - 1) * 12 + (f.multiplayer - 1) * 16 + (f.platform - 1) * 5;
}

export function qualityCap(w: World, g: Game, isPlayer: boolean): number {
  let cap = engineStats(w, g.engine, isPlayer).cap;
  if (g.engine === 'pixelforge') {
    const art = ART_STYLES[g.artStyle];
    if (art.pixelforgeCap) cap = Math.min(cap, art.pixelforgeCap);
    if (g.multiplayer === 'massive') cap = Math.min(cap, 55);
  }
  return cap;
}

/** Deterministic part of quality (no noise / breakout). */
export function baseQuality(w: World, g: Game, c: Company): number {
  const isPlayer = c.isPlayer;
  const completion = clamp(g.workDone / g.workRequired, 0, 1);
  let q = 62 * designScore(g);
  if (completion < 1) q -= (1 - completion) * 40;
  const budgetRatio = g.budgetSpent / Math.max(1, recommendedBudget(g.scope, g.artStyle, g.platforms));
  q += clamp(7 * Math.log2(budgetRatio + 0.25) + 2, -8, 12);
  q += fitBonus(g);
  q += Math.min(6, 2 * Math.sqrt(c.genreXp[g.genre] ?? 0));
  if (isPlayer) {
    if (hasResearch(w, 'mocap') && (g.artStyle === 'realistic' || g.artStyle === 'photoreal')) q += 4;
    if (hasResearch(w, 'netcode') && (g.multiplayer === 'online' || g.multiplayer === 'massive')) q += 3;
  } else if (c.talent > 70 && (g.artStyle === 'realistic' || g.artStyle === 'photoreal')) {
    q += 2;
  }
  const density = (g.bugs / Math.max(1, g.workRequired)) * 100;
  q -= Math.min(25, density * 1.6);
  if (g.sequelNo > 1) {
    const ip = w.ips[g.ipId];
    const prev = ip?.games.map((id) => w.games[id]).filter((x) => x && x.id !== g.id && x.releaseDay !== null);
    const last = prev?.sort((a, b) => (b.releaseDay ?? 0) - (a.releaseDay ?? 0))[0];
    if (last && last.releaseDay !== null && w.day - last.releaseDay < 400) q -= 5;
  }
  q -= genreRepetitionPenalty(w, g);
  const cap = qualityCap(w, g, isPlayer);
  if (q > cap) q = cap + (q - cap) * 0.2;
  return q;
}

/** Critics tire of a studio shipping the same genre over and over. */
export function genreRepetitionPenalty(w: World, g: Game): number {
  let recent = 0;
  for (const o of gamesOf(w, g.companyId)) {
    if (o.id === g.id || o.companyId !== g.companyId || o.genre !== g.genre || o.releaseDay === null) continue;
    if (w.day - o.releaseDay < 240) recent++;
  }
  return Math.min(15, Math.max(0, recent - 1) * 4);
}

/** Fuzzy estimate shown to the player during development. */
export function qualityEstimate(w: World, g: Game, c: Company): { low: number; high: number } {
  const q = baseQuality(w, g, c);
  const spread = hasResearch(w, 'analytics') ? 6 : 15;
  return { low: clamp(Math.round(q - spread), 1, 99), high: clamp(Math.round(q + spread), 1, 99) };
}

export function bugDensity(g: Game): number {
  return (g.bugs / Math.max(1, g.workRequired)) * 100;
}

// ------------------------------------------------------------ release

export function releaseGame(w: World, g: Game): void {
  const c = w.companies[g.companyId];
  let q = baseQuality(w, g, c) + randNormal(w, 0, 4.5);
  let breakout = 1;
  if (chance(w, 0.022 * Math.pow(clamp(q, 0, 100) / 70, 2))) {
    breakout = randRange(w, 1.6, 3.2);
    q += 6;
  }
  q = clamp(q, 3, 99);
  const mon = MONETIZATIONS[g.monetization];
  g.quality = q;
  g.breakout = breakout;
  g.criticScore = Math.round(clamp(q + randNormal(w, 0, 3), 1, 99));
  const density = bugDensity(g);
  g.userScoreTarget = clamp(q + mon.userScore - density * 1.2, 1, 99);
  g.userScore = Math.round(clamp(g.userScoreTarget + randNormal(w, 0, 5), 1, 99));
  g.status = 'released';
  g.releaseDay = w.day;
  g.freshness = 1;
  g.team = [];
  g.aiTeam = 0;
  g.crunch = false;
  g.lastUpdateDay = w.day;

  const online = g.multiplayer === 'online' || g.multiplayer === 'massive';
  if (online && g.hype > 150) {
    const protectedInfra = c.isPlayer ? hasResearch(w, 'cloudInfra') : c.headcount > 400;
    if (!protectedInfra && chance(w, 0.45)) {
      g.meltdownUntil = w.day + 5;
      g.userScore = Math.max(1, g.userScore - 8);
    }
  }

  c.genreXp[g.genre] = (c.genreXp[g.genre] ?? 0) + q / 70;

  if (c.isPlayer || c.parentId === w.player.companyId) {
    for (const e of w.player.employees) if (e.assignment === g.id) e.assignment = null;
  }
  if (c.isPlayer) {
    w.player.stats.gamesReleased += 1;
    w.player.stats.bestCritic = Math.max(w.player.stats.bestCritic, g.criticScore);
  }

  const verdict =
    g.criticScore >= 90 ? 'universal acclaim' : g.criticScore >= 75 ? 'strong reviews' : g.criticScore >= 60 ? 'mixed reviews' : g.criticScore >= 40 ? 'poor reviews' : 'a critical mauling';
  const isMajor = g.hype > 300 || breakout > 1 || c.isPlayer;
  pushNews(w, {
    kind: c.isPlayer ? 'player' : 'release',
    title: `${c.name} releases ${g.title} to ${verdict} (${g.criticScore})`,
    body: `${GENRES[g.genre].name} · ${g.platforms.map((p) => PLATFORMS[p].name).join(', ')} · ${MONETIZATIONS[g.monetization].short}`,
    companyId: c.id,
    gameId: g.id,
    tone: c.isPlayer ? (g.criticScore >= 70 ? 'good' : g.criticScore < 50 ? 'bad' : 'neutral') : isMajor ? 'major' : 'neutral',
  });
  if (c.isPlayer) {
    toast(w, `${g.title} launched! Critics: ${g.criticScore}/100`, g.criticScore >= 70 ? 'good' : g.criticScore < 50 ? 'bad' : 'neutral');
    if (g.meltdownUntil > w.day) {
      pushNews(w, { kind: 'player', title: `Servers buckle under ${g.title} launch demand`, body: 'Players are furious about queues and disconnects. Cloud Infrastructure research prevents this.', gameId: g.id, companyId: c.id, tone: 'bad' });
    }
  }
}
