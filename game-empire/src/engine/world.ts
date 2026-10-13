// World generation: a seeded industry of rival studios with a back-catalogue,
// warmed up for a year and a half before the player's company is founded.
import { refreshContractOffers } from './contracts';
import { applyLegacy } from './legacy';
import { refillObjectives } from './progression';
import { updateRival } from './business';
import { DIFFICULTIES, GENRE_IDS, PLATFORMS, PLATFORM_IDS, WARMUP_DAYS } from './constants';
import { makeStudio, seedCatalog, TIERS } from './ai';
import { computeValuation } from './finance';
import { hashSeed, randInt, randRange, shuffle } from './rng';
import { refreshCandidates } from './staff';
import { advanceDay } from './tick';
import type { Company, Difficulty, Employee, GenreState, LegacyId, MarketState, PlatformState, PlayerState, World } from './types';
import { emptyLedger, newId, pushNews } from './util';

export const SAVE_VERSION = 4;

export interface NewGameOptions {
  seed: string;
  companyName: string;
  founderName: string;
  specialty: 'programmer' | 'artist' | 'designer';
  difficulty: Difficulty;
  rivals: number;
  /** Legacy head starts bought with points from earlier runs. */
  legacy?: Partial<Record<LegacyId, number>>;
}

function initialMarket(w: World): MarketState {
  const genres = {} as Record<(typeof GENRE_IDS)[number], GenreState>;
  for (const g of GENRE_IDS) {
    const t = randRange(w, 0.75, 1.3);
    genres[g] = { trend: t, target: t, history: [] };
  }
  const platforms = {} as Record<(typeof PLATFORM_IDS)[number], PlatformState>;
  for (const p of PLATFORM_IDS) {
    const def = PLATFORMS[p];
    // users are defined at the player's start date; back-date for the warm-up
    const users = def.users / Math.pow(1 + def.growth, WARMUP_DAYS / 365);
    platforms[p] = { users, growth: def.growth, history: [] };
  }
  return {
    genres,
    platforms,
    sentiment: 1,
    sentimentTarget: 1,
    regime: 'neutral',
    index: 1000,
    indexHistory: [],
    baseRate: 0.045,
    effects: [],
    titanRoyalty: 0.05,
    talentSurgeUntil: 0,
    industryHistory: [],
  };
}

/** Player state added in save version 3 (also used to migrate old saves). */
export function playerExtras(): Pick<
  PlayerState,
  | 'infra'
  | 'progression'
  | 'objectives'
  | 'objectivesCompleted'
  | 'objectiveRerollDay'
  | 'contracts'
  | 'contractOffers'
  | 'contractsRefreshDay'
  | 'contractsCompleted'
  | 'policies'
  | 'investments'
  | 'publishing'
  | 'licenses'
  | 'expoBooking'
  | 'flags'
  | 'rivalId'
  | 'engine'
  | 'combos'
  | 'facilities'
  | 'convention'
  | 'conventionsHeld'
  | 'store'
  | 'legacy'
  | 'legacyBanked'
> {
  return {
    infra: { tier: 0, nodes: 1, autoscale: true, incidents: [], lowLoadDays: 0, demand: 0, load: 0, outageUntil: 0, overloadDays: 0, downtime: [], demandHistory: [], capacityHistory: [] },
    progression: { xp: 0, level: 1, perkPoints: 0, perks: {} },
    objectives: [],
    objectivesCompleted: 0,
    objectiveRerollDay: -9999,
    contracts: [],
    contractOffers: [],
    contractsRefreshDay: -9999,
    contractsCompleted: 0,
    policies: { benefits: 'basic', profitSharing: false, hours: 'standard', qa: 'standard', retainer: false },
    investments: { bonds: 0, indexUnits: 0, indexCost: 0 },
    publishing: [],
    licenses: [],
    expoBooking: null,
    flags: {},
    rivalId: null,
    engine: null,
    combos: {},
    facilities: [],
    convention: null,
    conventionsHeld: 0,
    store: null,
    legacy: {},
    legacyBanked: false,
  };
}

function blankPlayerState(): World['player'] {
  return {
    companyId: '',
    founderName: '',
    employees: [],
    candidates: [],
    candidatesRefreshDay: 0,
    research: { completed: [], active: null },
    officeLevel: 0,
    achievements: {},
    stats: { gamesReleased: 0, peakCcu: 0, bestCritic: 0, totalRevenue: 0, acquisitions: 0, peakValuation: 0, hitsOver1M: 0 },
    gameOver: null,
    fundingOffers: [],
    fundingRoundsTaken: 0,
    lastFundingDay: -9999,
    autoSupportSubsidiaries: true,
    tutorialDismissed: false,
    autoAssign: true,
    lifelinesUsed: 0,
    ...playerExtras(),
  };
}

export function createIndustry(seed: string, difficulty: Difficulty, rivals: number): World {
  const w: World = {
    version: SAVE_VERSION,
    seed: hashSeed(seed),
    rng: hashSeed(seed),
    day: -WARMUP_DAYS,
    difficulty,
    nextId: 0,
    companies: {},
    games: {},
    ips: {},
    market: undefined as unknown as MarketState,
    news: [],
    pendingEvents: [],
    auctions: [],
    player: blankPlayerState(),
    toasts: [],
    notices: [],
    awardsHistory: [],
  };
  w.market = initialMarket(w);

  const n = Math.max(15, Math.min(30, Math.round(rivals)));
  const tiers: (keyof typeof TIERS)[] = [];
  const mega = n >= 24 ? 3 : 2;
  const large = Math.round(n * 0.18);
  const mid = Math.round(n * 0.24);
  const small = Math.round(n * 0.24);
  for (let i = 0; i < mega; i++) tiers.push('mega');
  for (let i = 0; i < large; i++) tiers.push('large');
  for (let i = 0; i < mid; i++) tiers.push('mid');
  for (let i = 0; i < small; i++) tiers.push('small');
  while (tiers.length < n) tiers.push('indie');
  shuffle(w, tiers);

  const taken = new Set<string>();
  const catalogSize: Record<keyof typeof TIERS, [number, number]> = {
    mega: [8, 13],
    large: [4, 8],
    mid: [2, 5],
    small: [1, 3],
    indie: [0, 2],
  };
  for (const tier of tiers) {
    const c = makeStudio(w, tier, taken);
    w.companies[c.id] = c;
    seedCatalog(w, c, randInt(w, catalogSize[tier][0], catalogSize[tier][1]));
    c.valuation = Math.max(c.valuation, computeValuation(w, c));
    if (c.isPublic) c.price = c.valuation / c.shares;
  }

  // Warm up: let the industry run so the player arrives in a living market.
  for (let i = 0; i < WARMUP_DAYS; i++) advanceDay(w);
  w.toasts = [];
  w.notices = [];
  w.pendingEvents = [];
  return w;
}

export function createPlayer(w: World, opts: NewGameOptions): void {
  const diff = DIFFICULTIES[opts.difficulty];
  const shares = 10_000_000;
  const c: Company = {
    id: newId(w, 'c'),
    name: opts.companyName.trim() || 'Indie Dreams',
    isPlayer: true,
    founded: w.day,
    strategy: 'qualityFocused',
    specialties: [],
    color: '#38bdf8',
    ceo: opts.founderName.trim() || 'You',
    hq: 'Home Office',
    status: 'active',
    parentId: null,
    endDay: null,
    reputation: 0,
    fans: 0,
    cash: diff.cash,
    loans: [],
    headcount: 1,
    talent: 0,
    avgSalary: 0,
    genreXp: {},
    isPublic: false,
    shares,
    founderShares: shares,
    investorShares: 0,
    price: 0,
    ipoDay: null,
    priceHistory: [],
    valuation: diff.cash,
    valuationHistory: [[w.day, diff.cash]],
    expectedQuarter: 0,
    quarterRevenue: 0,
    lastQuarterRevenue: 0,
    holdings: {},
    ledger: emptyLedger(),
    monthly: [],
    cashHistory: [[w.day, diff.cash]],
    revenueTotal: 0,
    insolventDays: 0,
    boardConfidence: 100,
    defaults: 0,
    rev30: 0,
    lastDecisionDay: 0,
    decisionOffset: 0,
    distressDays: 0,
  };
  w.companies[c.id] = c;
  w.player.companyId = c.id;
  w.player.founderName = c.ceo;
  const founder: Employee = {
    id: newId(w, 'e'),
    name: c.ceo,
    role: 'founder',
    specialty: opts.specialty,
    skill: diff.founderSkill,
    salary: 0,
    morale: 85,
    xp: 0,
    traits: ['fastLearner'],
    hiredDay: w.day,
    assignment: null,
    isFounder: true,
  };
  w.player.employees = [founder];
  refreshCandidates(w);
  if (opts.legacy) applyLegacy(w, opts.legacy);
  refreshContractOffers(w);
  refillObjectives(w);
  updateRival(w);
  pushNews(w, {
    kind: 'player',
    title: `${c.name} is founded`,
    body: `${c.ceo} quits their day job to start a game studio with ${diff.cash.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })} in savings.`,
    companyId: c.id,
    tone: 'major',
  });
}

export function createWorld(opts: NewGameOptions): World {
  const w = createIndustry(opts.seed, opts.difficulty, opts.rivals);
  createPlayer(w, opts);
  return w;
}
