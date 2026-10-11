// Game design tables. Tuning lives here so the simulation code stays generic.
import type {
  ArtStyleId,
  AudienceId,
  CampaignId,
  EngineId,
  Focus,
  FocusId,
  GenreId,
  MonetizationId,
  MultiplayerId,
  PlatformId,
  ResearchId,
  RoleId,
  ScopeId,
  StrategyId,
  TraitId,
  UpdateTypeId,
} from './types';

export const START_YEAR = 2026;
export const WARMUP_DAYS = 540;

export const FOCUS_IDS: FocusId[] = ['gameplay', 'graphics', 'story', 'audio', 'tech', 'content'];
export const FOCUS_LABELS: Record<FocusId, string> = {
  gameplay: 'Gameplay',
  graphics: 'Graphics',
  story: 'Story',
  audio: 'Audio',
  tech: 'Technology',
  content: 'Content & World',
};

export function focus(gameplay: number, graphics: number, story: number, audio: number, tech: number, content: number): Focus {
  const t = gameplay + graphics + story + audio + tech + content;
  return {
    gameplay: gameplay / t,
    graphics: graphics / t,
    story: story / t,
    audio: audio / t,
    tech: tech / t,
    content: content / t,
  };
}

// ---------------------------------------------------------------- genres

export interface GenreDef {
  name: string;
  short: string;
  /** Share of gamers interested in the genre. */
  interest: number;
  /** Work multiplier. */
  complexity: number;
  /** Base daily churn of active players. */
  churn: number;
  ideal: Focus;
  mp: Record<MultiplayerId, number>;
  /** Smallest sensible scope. */
  minScope: ScopeId;
  competitive: boolean;
  blurb: string;
}

export const GENRE_IDS: GenreId[] = [
  'fps',
  'battleRoyale',
  'survival',
  'horror',
  'rpg',
  'mmorpg',
  'sandbox',
  'racing',
  'strategy',
  'simulation',
  'sports',
  'indie',
  'openWorld',
];

export const GENRES: Record<GenreId, GenreDef> = {
  fps: {
    name: 'FPS',
    short: 'FPS',
    interest: 0.3,
    complexity: 1.2,
    churn: 0.014,
    ideal: focus(32, 24, 6, 10, 18, 10),
    mp: { single: 0.85, localCoop: 0.9, online: 1.15, massive: 0.85 },
    minScope: 'small',
    competitive: true,
    blurb: 'Tight gunplay and twitch reflexes. Huge audience, fierce competition.',
  },
  battleRoyale: {
    name: 'Battle Royale',
    short: 'BR',
    interest: 0.24,
    complexity: 1.35,
    churn: 0.011,
    ideal: focus(34, 16, 2, 8, 24, 16),
    mp: { single: 0.15, localCoop: 0.25, online: 1.15, massive: 1.05 },
    minScope: 'medium',
    competitive: true,
    blurb: 'Last one standing wins. Needs online play and strong netcode.',
  },
  survival: {
    name: 'Survival',
    short: 'SURV',
    interest: 0.16,
    complexity: 1.0,
    churn: 0.016,
    ideal: focus(30, 16, 8, 10, 12, 24),
    mp: { single: 0.9, localCoop: 1.0, online: 1.12, massive: 1.0 },
    minScope: 'small',
    competitive: false,
    blurb: 'Gather, craft, endure. Thrives on co-op and emergent stories.',
  },
  horror: {
    name: 'Horror',
    short: 'HOR',
    interest: 0.12,
    complexity: 0.8,
    churn: 0.035,
    ideal: focus(22, 20, 22, 22, 6, 8),
    mp: { single: 1.12, localCoop: 1.05, online: 0.92, massive: 0.5 },
    minScope: 'tiny',
    competitive: false,
    blurb: 'Atmosphere is everything. Audio and story carry the scares.',
  },
  rpg: {
    name: 'RPG',
    short: 'RPG',
    interest: 0.24,
    complexity: 1.3,
    churn: 0.022,
    ideal: focus(26, 14, 26, 8, 6, 20),
    mp: { single: 1.1, localCoop: 0.98, online: 1.0, massive: 0.9 },
    minScope: 'small',
    competitive: false,
    blurb: 'Deep systems, rich worlds and characters players never forget.',
  },
  mmorpg: {
    name: 'MMORPG',
    short: 'MMO',
    interest: 0.1,
    complexity: 2.1,
    churn: 0.007,
    ideal: focus(24, 14, 12, 6, 20, 24),
    mp: { single: 0.15, localCoop: 0.25, online: 0.75, massive: 1.2 },
    minScope: 'large',
    competitive: false,
    blurb: 'Persistent worlds with sticky communities. Brutally expensive to build.',
  },
  sandbox: {
    name: 'Sandbox',
    short: 'SBX',
    interest: 0.18,
    complexity: 1.05,
    churn: 0.012,
    ideal: focus(32, 10, 4, 8, 16, 30),
    mp: { single: 0.95, localCoop: 1.02, online: 1.1, massive: 1.05 },
    minScope: 'tiny',
    competitive: false,
    blurb: 'Give players tools and get out of the way. Evergreen if done right.',
  },
  racing: {
    name: 'Racing',
    short: 'RACE',
    interest: 0.12,
    complexity: 1.0,
    churn: 0.022,
    ideal: focus(30, 28, 2, 16, 16, 8),
    mp: { single: 0.95, localCoop: 1.1, online: 1.06, massive: 0.7 },
    minScope: 'tiny',
    competitive: true,
    blurb: 'Speed, handling and gorgeous tracks.',
  },
  strategy: {
    name: 'Strategy',
    short: 'STR',
    interest: 0.14,
    complexity: 1.0,
    churn: 0.014,
    ideal: focus(38, 8, 10, 6, 16, 22),
    mp: { single: 1.05, localCoop: 0.95, online: 1.06, massive: 0.85 },
    minScope: 'tiny',
    competitive: true,
    blurb: 'Out-think the opponent. Loyal, demanding players.',
  },
  simulation: {
    name: 'Simulation',
    short: 'SIM',
    interest: 0.15,
    complexity: 0.9,
    churn: 0.014,
    ideal: focus(32, 14, 4, 8, 20, 22),
    mp: { single: 1.1, localCoop: 0.95, online: 0.96, massive: 0.8 },
    minScope: 'tiny',
    competitive: false,
    blurb: 'Build, manage and optimise. Long tails and devoted fans.',
  },
  sports: {
    name: 'Sports',
    short: 'SPRT',
    interest: 0.2,
    complexity: 1.1,
    churn: 0.014,
    ideal: focus(30, 26, 2, 14, 18, 10),
    mp: { single: 0.9, localCoop: 1.1, online: 1.12, massive: 0.8 },
    minScope: 'small',
    competitive: true,
    blurb: 'Annual releases, licensed teams, massive console audience.',
  },
  indie: {
    name: 'Indie',
    short: 'INDIE',
    interest: 0.2,
    complexity: 0.6,
    churn: 0.03,
    ideal: focus(36, 16, 18, 14, 4, 12),
    mp: { single: 1.1, localCoop: 1.06, online: 0.92, massive: 0.5 },
    minScope: 'tiny',
    competitive: false,
    blurb: 'Artful, original and cheap to make. A great place to start.',
  },
  openWorld: {
    name: 'Open World',
    short: 'OW',
    interest: 0.26,
    complexity: 1.7,
    churn: 0.02,
    ideal: focus(24, 22, 18, 8, 10, 18),
    mp: { single: 1.05, localCoop: 0.92, online: 1.05, massive: 1.0 },
    minScope: 'medium',
    competitive: false,
    blurb: 'Vast worlds to explore. Blockbuster potential, blockbuster budgets.',
  },
};

// ---------------------------------------------------------------- platforms

export interface PlatformDef {
  name: string;
  users: number; // millions at start
  growth: number; // annual growth at start
  spend: number; // spending power multiplier
  premiumAffinity: number; // how willing users are to pay upfront
  storeCut: number;
  devKit: number; // one-time cost per game
  minRep: number;
  workMult: number; // extra work for porting to this platform
  affinity: Partial<Record<GenreId, number>>;
  blurb: string;
}

export const PLATFORM_IDS: PlatformId[] = ['pc', 'console', 'mobile', 'handheld', 'vr', 'cloud'];

export const PLATFORMS: Record<PlatformId, PlatformDef> = {
  pc: {
    name: 'PC',
    users: 330,
    growth: 0.02,
    spend: 1.0,
    premiumAffinity: 1.0,
    storeCut: 0.3,
    devKit: 0,
    minRep: 0,
    workMult: 0.3,
    affinity: { sports: 0.7, racing: 0.9, mmorpg: 1.25, strategy: 1.35, simulation: 1.25, fps: 1.1, survival: 1.2, indie: 1.2, sandbox: 1.1 },
    blurb: 'Open storefronts, any genre. The indie home turf.',
  },
  console: {
    name: 'Console',
    users: 230,
    growth: 0.03,
    spend: 1.25,
    premiumAffinity: 1.1,
    storeCut: 0.3,
    devKit: 15000,
    minRep: 15,
    workMult: 0.35,
    affinity: { fps: 1.1, sports: 1.45, racing: 1.25, openWorld: 1.2, strategy: 0.45, mmorpg: 0.6, simulation: 0.7, survival: 0.9, sandbox: 0.9, indie: 0.75 },
    blurb: 'Big spenders. Platform holders only certify reputable studios.',
  },
  mobile: {
    name: 'Mobile',
    users: 1450,
    growth: 0.06,
    spend: 0.32,
    premiumAffinity: 0.22,
    storeCut: 0.3,
    devKit: 100,
    minRep: 0,
    workMult: 0.3,
    affinity: { strategy: 1.2, battleRoyale: 0.7, fps: 0.35, mmorpg: 0.5, racing: 0.6, simulation: 1.0, sports: 0.5, indie: 1.0, sandbox: 0.6, rpg: 0.7, survival: 0.5, horror: 0.3, openWorld: 0.2 },
    blurb: 'Billions of players who rarely pay upfront. Free-to-play rules here.',
  },
  handheld: {
    name: 'Handheld',
    users: 120,
    growth: 0.01,
    spend: 0.95,
    premiumAffinity: 1.05,
    storeCut: 0.3,
    devKit: 5000,
    minRep: 8,
    workMult: 0.25,
    affinity: { rpg: 1.35, indie: 1.35, racing: 1.1, sandbox: 1.15, fps: 0.6, battleRoyale: 0.6, mmorpg: 0.5, openWorld: 0.8, horror: 0.7, simulation: 0.9 },
    blurb: 'Portable premium market that loves RPGs and indies.',
  },
  vr: {
    name: 'VR',
    users: 28,
    growth: 0.24,
    spend: 1.1,
    premiumAffinity: 1.05,
    storeCut: 0.3,
    devKit: 2500,
    minRep: 5,
    workMult: 0.45,
    affinity: { horror: 1.7, fps: 1.25, simulation: 1.45, racing: 1.25, sports: 1.0, rpg: 0.6, strategy: 0.4, mmorpg: 0.5, battleRoyale: 0.6, openWorld: 0.5, indie: 0.9, survival: 0.8, sandbox: 0.8 },
    blurb: 'Small but fast growing. Immersion makes horror and sims shine.',
  },
  cloud: {
    name: 'Cloud Streaming',
    users: 45,
    growth: 0.3,
    spend: 0.85,
    premiumAffinity: 0.7,
    storeCut: 0.25,
    devKit: 1000,
    minRep: 3,
    workMult: 0.15,
    affinity: { openWorld: 1.05, fps: 1.0, rpg: 1.0, strategy: 0.8, indie: 0.8, horror: 0.8, mmorpg: 0.8, simulation: 0.8, sandbox: 0.8, survival: 0.8 },
    blurb: 'Play anywhere. Growing quickly, lower cut.',
  },
};

export function platformAffinity(p: PlatformId, g: GenreId): number {
  return PLATFORMS[p].affinity[g] ?? 1;
}

// ---------------------------------------------------------------- audiences

export interface AudienceDef {
  name: string;
  pool: number;
  spend: number;
  churn: number;
  qualitySensitivity: number;
  fit: Partial<Record<GenreId, number>>;
}

export const AUDIENCE_IDS: AudienceId[] = ['everyone', 'kids', 'teens', 'youngAdults', 'adults', 'hardcore', 'casual'];

export const AUDIENCES: Record<AudienceId, AudienceDef> = {
  everyone: {
    name: 'Everyone',
    pool: 0.75,
    spend: 1.0,
    churn: 1.05,
    qualitySensitivity: 1.0,
    fit: { sports: 1.08, racing: 1.08, sandbox: 1.08, horror: 0.55, fps: 0.9, battleRoyale: 0.95, mmorpg: 0.85, strategy: 0.9 },
  },
  kids: {
    name: 'Kids',
    pool: 0.28,
    spend: 0.6,
    churn: 1.1,
    qualitySensitivity: 0.8,
    fit: { sandbox: 1.3, racing: 1.2, sports: 1.1, indie: 1.05, horror: 0.1, fps: 0.35, battleRoyale: 0.75, survival: 0.7, mmorpg: 0.6, openWorld: 0.75, strategy: 0.7, rpg: 0.8 },
  },
  teens: {
    name: 'Teens',
    pool: 0.42,
    spend: 0.8,
    churn: 1.05,
    qualitySensitivity: 0.95,
    fit: { battleRoyale: 1.3, fps: 1.18, sandbox: 1.1, sports: 1.1, horror: 1.1, strategy: 0.8, simulation: 0.8, mmorpg: 1.05 },
  },
  youngAdults: {
    name: 'Young Adults',
    pool: 0.46,
    spend: 1.1,
    churn: 1.0,
    qualitySensitivity: 1.05,
    fit: { fps: 1.15, rpg: 1.15, survival: 1.15, openWorld: 1.15, horror: 1.15, mmorpg: 1.1, battleRoyale: 1.1 },
  },
  adults: {
    name: 'Adults',
    pool: 0.4,
    spend: 1.3,
    churn: 0.95,
    qualitySensitivity: 1.1,
    fit: { strategy: 1.25, simulation: 1.25, rpg: 1.1, sports: 1.1, racing: 1.1, battleRoyale: 0.8, sandbox: 0.9 },
  },
  hardcore: {
    name: 'Hardcore Gamers',
    pool: 0.16,
    spend: 1.65,
    churn: 0.75,
    qualitySensitivity: 1.35,
    fit: { mmorpg: 1.3, strategy: 1.2, fps: 1.15, survival: 1.2, rpg: 1.2, sandbox: 0.9, sports: 0.9, racing: 0.95 },
  },
  casual: {
    name: 'Casual Players',
    pool: 0.58,
    spend: 0.5,
    churn: 1.3,
    qualitySensitivity: 0.75,
    fit: { simulation: 1.3, indie: 1.25, sandbox: 1.15, racing: 1.1, mmorpg: 0.5, fps: 0.6, survival: 0.6, horror: 0.5, battleRoyale: 0.8, openWorld: 0.8 },
  },
};

export function audienceFit(a: AudienceId, g: GenreId): number {
  return AUDIENCES[a].fit[g] ?? 1;
}

// ---------------------------------------------------------------- engines

export interface EngineDef {
  name: string;
  licenseCost: number;
  royalty: number;
  cap: number;
  workMult: number;
  bugMult: number;
  minRep: number;
  research?: ResearchId;
  blurb: string;
}

export const ENGINE_IDS: EngineId[] = ['scratch', 'pixelforge', 'nimbus', 'titan', 'apex', 'inhouse'];

export const ENGINES: Record<EngineId, EngineDef> = {
  scratch: {
    name: 'From Scratch',
    licenseCost: 0,
    royalty: 0,
    cap: 62,
    workMult: 1.35,
    bugMult: 1.35,
    minRep: 0,
    blurb: 'Free, slow, buggy. Hard ceiling on polish.',
  },
  pixelforge: {
    name: 'PixelForge 2D',
    licenseCost: 0,
    royalty: 0,
    cap: 76,
    workMult: 0.9,
    bugMult: 1.0,
    minRep: 0,
    blurb: 'Free 2D engine. Great for pixel art; struggles with 3D realism and MMOs.',
  },
  nimbus: {
    name: 'Nimbus Engine',
    licenseCost: 2500,
    royalty: 0,
    cap: 84,
    workMult: 0.88,
    bugMult: 0.95,
    minRep: 0,
    blurb: 'Affordable all-rounder with a flat per-project license.',
  },
  titan: {
    name: 'Titan Engine',
    licenseCost: 0,
    royalty: 0.05,
    cap: 94,
    workMult: 0.82,
    bugMult: 0.9,
    minRep: 0,
    blurb: 'Industry standard. Free upfront, takes a royalty on revenue.',
  },
  apex: {
    name: 'Apex Engine',
    licenseCost: 400000,
    royalty: 0,
    cap: 100,
    workMult: 0.78,
    bugMult: 0.85,
    minRep: 35,
    blurb: 'Cutting-edge AAA tech. Expensive license, reputable studios only.',
  },
  inhouse: {
    name: 'In-House Engine',
    licenseCost: 0,
    royalty: 0,
    cap: 86,
    workMult: 0.85,
    bugMult: 0.9,
    minRep: 0,
    research: 'engine1',
    blurb: 'Your own tech. No royalties, improves with R&D.',
  },
};

// ---------------------------------------------------------------- monetization

export interface MonetizationDef {
  name: string;
  short: string;
  upfront: boolean;
  conversion: number;
  arpdau: number;
  churn: number;
  reach: number;
  userScore: number;
  repDrift: number;
  blurb: string;
}

export const MONETIZATION_IDS: MonetizationId[] = ['premium', 'premiumMtx', 'f2pCosmetic', 'f2pAggressive', 'subscription', 'ads'];

export const MONETIZATIONS: Record<MonetizationId, MonetizationDef> = {
  premium: {
    name: 'Premium',
    short: 'Premium',
    upfront: true,
    conversion: 0.14,
    arpdau: 0,
    churn: 1.0,
    reach: 1.0,
    userScore: 2,
    repDrift: 0.002,
    blurb: 'Pay once, own it. Players love it; revenue front-loaded.',
  },
  premiumMtx: {
    name: 'Premium + Microtransactions',
    short: 'Premium+MTX',
    upfront: true,
    conversion: 0.13,
    arpdau: 0.04,
    churn: 1.04,
    reach: 0.95,
    userScore: -3,
    repDrift: -0.001,
    blurb: 'Upfront price plus optional store. Some players grumble.',
  },
  f2pCosmetic: {
    name: 'Free-to-Play (Cosmetics)',
    short: 'F2P',
    upfront: false,
    conversion: 0.42,
    arpdau: 0.12,
    churn: 1.12,
    reach: 1.7,
    userScore: 0,
    repDrift: 0,
    blurb: 'Free download, sell skins and battle passes. Needs a big audience.',
  },
  f2pAggressive: {
    name: 'Free-to-Play (Loot Boxes)',
    short: 'F2P Aggro',
    upfront: false,
    conversion: 0.42,
    arpdau: 0.26,
    churn: 1.45,
    reach: 1.6,
    userScore: -14,
    repDrift: -0.012,
    blurb: 'Loot boxes and pay-to-win. Lucrative, toxic, a regulation target.',
  },
  subscription: {
    name: 'Subscription',
    short: 'Sub',
    upfront: false,
    conversion: 0.06,
    arpdau: 0.43,
    churn: 0.72,
    reach: 0.55,
    userScore: -1,
    repDrift: 0,
    blurb: '$12.99/month. Low reach, very sticky, steady income.',
  },
  ads: {
    name: 'Ad-Supported',
    short: 'Ads',
    upfront: false,
    conversion: 0.55,
    arpdau: 0.016,
    churn: 1.28,
    reach: 1.9,
    userScore: -5,
    repDrift: -0.002,
    blurb: 'Free with ads. Massive reach on mobile, tiny revenue per player.',
  },
};

// ---------------------------------------------------------------- art styles

export interface ArtStyleDef {
  name: string;
  workMult: number;
  costMult: number;
  fit: Partial<Record<GenreId, number>>;
  /** Freshness decay multiplier: realistic art ages faster. */
  aging: number;
  pixelforgeCap?: number;
}

export const ART_STYLE_IDS: ArtStyleId[] = ['pixel', 'lowPoly', 'stylized', 'anime', 'handDrawn', 'realistic', 'photoreal'];

export const ART_STYLES: Record<ArtStyleId, ArtStyleDef> = {
  pixel: { name: 'Pixel Art', workMult: 0.75, costMult: 0.6, aging: 0.85, fit: { indie: 1.2, strategy: 1.05, sandbox: 1.05, rpg: 1.05, fps: 0.7, racing: 0.8, sports: 0.7, openWorld: 0.75, battleRoyale: 0.75 } },
  lowPoly: { name: 'Low Poly', workMult: 0.85, costMult: 0.75, aging: 0.95, fit: { indie: 1.1, survival: 1.05, sandbox: 1.08, horror: 1.05, simulation: 1.0, sports: 0.85 } },
  stylized: { name: 'Stylized', workMult: 1.0, costMult: 1.0, aging: 0.85, fit: { battleRoyale: 1.1, sandbox: 1.05, mmorpg: 1.05, indie: 1.05, racing: 1.0 } },
  anime: { name: 'Anime', workMult: 1.05, costMult: 1.05, aging: 0.9, fit: { rpg: 1.2, mmorpg: 1.1, fps: 0.9, sports: 0.85, simulation: 0.9, horror: 0.95 } },
  handDrawn: { name: 'Hand-Drawn', workMult: 1.15, costMult: 1.1, aging: 0.8, fit: { indie: 1.18, rpg: 1.1, horror: 1.05, strategy: 1.0, fps: 0.7, racing: 0.8, sports: 0.7 } },
  realistic: { name: 'Realistic', workMult: 1.3, costMult: 1.4, aging: 1.2, pixelforgeCap: 55, fit: { fps: 1.15, racing: 1.15, sports: 1.15, openWorld: 1.1, horror: 1.1, simulation: 1.1, survival: 1.05, indie: 0.8 } },
  photoreal: { name: 'Photorealistic', workMult: 1.65, costMult: 2.0, aging: 1.35, pixelforgeCap: 45, fit: { fps: 1.2, racing: 1.2, sports: 1.2, openWorld: 1.15, horror: 1.12, simulation: 1.12, survival: 1.05, indie: 0.7, strategy: 0.9 } },
};

export function artFit(a: ArtStyleId, g: GenreId): number {
  return ART_STYLES[a].fit[g] ?? 1;
}

// ---------------------------------------------------------------- multiplayer

export interface MultiplayerDef {
  name: string;
  workMult: number;
  churn: number;
  ccuRatio: number;
  freshnessDecay: number;
  serverCostPerCcu: number;
  serverBase: number;
}

export const MULTIPLAYER_IDS: MultiplayerId[] = ['single', 'localCoop', 'online', 'massive'];

export const MULTIPLAYER: Record<MultiplayerId, MultiplayerDef> = {
  single: { name: 'Single-player', workMult: 1.0, churn: 1.35, ccuRatio: 0.06, freshnessDecay: 1.3, serverCostPerCcu: 0, serverBase: 0 },
  localCoop: { name: 'Local Co-op', workMult: 1.1, churn: 1.18, ccuRatio: 0.07, freshnessDecay: 1.1, serverCostPerCcu: 0, serverBase: 0 },
  online: { name: 'Online Multiplayer', workMult: 1.4, churn: 0.88, ccuRatio: 0.11, freshnessDecay: 0.6, serverCostPerCcu: 0.03, serverBase: 12 },
  massive: { name: 'Massively Multiplayer', workMult: 2.0, churn: 0.65, ccuRatio: 0.16, freshnessDecay: 0.45, serverCostPerCcu: 0.045, serverBase: 60 },
};

// ---------------------------------------------------------------- scope

export interface ScopeDef {
  name: string;
  work: number;
  budget: number;
  price: number;
  maxTeam: number;
  typicalTeam: number;
  freshnessDecay: number;
  reach: number;
  /** Market presence: how visible a game of this size is to shoppers. */
  presence: number;
}

export const SCOPE_IDS: ScopeId[] = ['tiny', 'small', 'medium', 'large', 'aaa', 'mega'];

export const SCOPES: Record<ScopeId, ScopeDef> = {
  tiny: { name: 'Tiny (Game Jam)', work: 45, budget: 1000, price: 4.99, maxTeam: 3, typicalTeam: 2, freshnessDecay: 0.022, reach: 0.25, presence: 0.002 },
  small: { name: 'Small', work: 300, budget: 20000, price: 12.99, maxTeam: 6, typicalTeam: 4, freshnessDecay: 0.013, reach: 0.45, presence: 0.005 },
  medium: { name: 'Medium', work: 1800, budget: 300000, price: 24.99, maxTeam: 20, typicalTeam: 12, freshnessDecay: 0.009, reach: 0.7, presence: 0.03 },
  large: { name: 'Large', work: 13000, budget: 4000000, price: 39.99, maxTeam: 70, typicalTeam: 45, freshnessDecay: 0.0065, reach: 0.9, presence: 0.12 },
  aaa: { name: 'AAA', work: 72000, budget: 50000000, price: 59.99, maxTeam: 320, typicalTeam: 200, freshnessDecay: 0.005, reach: 1.0, presence: 1.0 },
  mega: { name: 'Mega Blockbuster', work: 230000, budget: 180000000, price: 69.99, maxTeam: 1100, typicalTeam: 650, freshnessDecay: 0.004, reach: 1.1, presence: 1.25 },
};

export function scopeIndex(s: ScopeId): number {
  return SCOPE_IDS.indexOf(s);
}

// ---------------------------------------------------------------- roles

export interface RoleDef {
  name: string;
  plural: string;
  contributes: Partial<Focus>;
  baseSalary: number;
  dev: boolean;
  workShare: number;
  blurb: string;
}

export const HIREABLE_ROLES: RoleId[] = ['programmer', 'artist', 'designer', 'writer', 'audio', 'qa', 'producer', 'marketing', 'community'];

export const ROLES: Record<RoleId, RoleDef> = {
  founder: { name: 'Founder', plural: 'Founders', contributes: { gameplay: 1, graphics: 1, story: 1, audio: 1, tech: 1, content: 1 }, baseSalary: 0, dev: true, workShare: 1, blurb: 'You. Does a bit of everything.' },
  programmer: { name: 'Programmer', plural: 'Programmers', contributes: { tech: 0.55, gameplay: 0.35, content: 0.1 }, baseSalary: 6200, dev: true, workShare: 1, blurb: 'Technology and gameplay systems.' },
  artist: { name: 'Artist', plural: 'Artists', contributes: { graphics: 0.82, content: 0.18 }, baseSalary: 5200, dev: true, workShare: 1, blurb: 'Graphics and world art.' },
  designer: { name: 'Game Designer', plural: 'Designers', contributes: { gameplay: 0.55, content: 0.3, story: 0.15 }, baseSalary: 5600, dev: true, workShare: 1, blurb: 'Gameplay, levels and content.' },
  writer: { name: 'Writer', plural: 'Writers', contributes: { story: 0.8, content: 0.2 }, baseSalary: 4600, dev: true, workShare: 1, blurb: 'Story, dialogue and lore.' },
  audio: { name: 'Audio Designer', plural: 'Audio Designers', contributes: { audio: 1 }, baseSalary: 4700, dev: true, workShare: 1, blurb: 'Music and sound.' },
  qa: { name: 'QA Tester', plural: 'QA Testers', contributes: { gameplay: 0.2, tech: 0.2 }, baseSalary: 3400, dev: true, workShare: 0.5, blurb: 'Finds and fixes bugs.' },
  producer: { name: 'Producer', plural: 'Producers', contributes: {}, baseSalary: 7200, dev: true, workShare: 0.25, blurb: 'Boosts the whole team\'s efficiency.' },
  marketing: { name: 'Marketer', plural: 'Marketers', contributes: {}, baseSalary: 5000, dev: false, workShare: 0, blurb: 'Company-wide: boosts every campaign and passive hype.' },
  community: { name: 'Community Manager', plural: 'Community Managers', contributes: {}, baseSalary: 4100, dev: false, workShare: 0, blurb: 'Company-wide: reduces churn, builds reputation.' },
};

export function salaryFor(role: RoleId, skill: number): number {
  const base = ROLES[role].baseSalary;
  return Math.round((base * (0.25 + Math.pow(skill / 100, 1.5) * 1.8)) / 10) * 10;
}

// ---------------------------------------------------------------- traits

export const TRAITS: Record<TraitId, { name: string; blurb: string; good: boolean }> = {
  fastLearner: { name: 'Fast Learner', blurb: 'Gains skill twice as fast.', good: true },
  perfectionist: { name: 'Perfectionist', blurb: '+15% quality, -10% speed, fewer bugs.', good: true },
  speedster: { name: 'Speedster', blurb: '+20% speed, more bugs.', good: true },
  crunchProof: { name: 'Crunch-Proof', blurb: 'Morale unaffected by crunch.', good: true },
  toxic: { name: 'Toxic', blurb: 'Talented but drags team morale down.', good: false },
  genius: { name: 'Genius', blurb: '+30% quality output.', good: true },
  loyal: { name: 'Loyal', blurb: 'Rarely quits, immune to poaching.', good: true },
  mentor: { name: 'Mentor', blurb: 'Teammates learn faster.', good: true },
};

// ---------------------------------------------------------------- office

export interface OfficeDef {
  name: string;
  capacity: number;
  rent: number;
  productivity: number;
  morale: number;
  moveCost: number;
}

export const OFFICES: OfficeDef[] = [
  { name: 'Bedroom', capacity: 2, rent: 350, productivity: 0.95, morale: -4, moveCost: 0 },
  { name: 'Garage', capacity: 5, rent: 1500, productivity: 1.0, morale: 0, moveCost: 2000 },
  { name: 'Small Office', capacity: 15, rent: 7500, productivity: 1.03, morale: 3, moveCost: 15000 },
  { name: 'Studio Loft', capacity: 45, rent: 28000, productivity: 1.06, morale: 5, moveCost: 80000 },
  { name: 'Headquarters', capacity: 160, rent: 120000, productivity: 1.1, morale: 8, moveCost: 500000 },
  { name: 'Campus', capacity: 650, rent: 480000, productivity: 1.14, morale: 11, moveCost: 3000000 },
  { name: 'Global Tower', capacity: 3000, rent: 2100000, productivity: 1.18, morale: 14, moveCost: 20000000 },
];

// ---------------------------------------------------------------- research

export interface ResearchDef {
  name: string;
  cost: number;
  days: number;
  requires: ResearchId[];
  minRep: number;
  blurb: string;
}

export const RESEARCH_IDS: ResearchId[] = [
  'agile',
  'analytics',
  'netcode',
  'communityHub',
  'qaAutomation',
  'marketingData',
  'liveOps',
  'engine1',
  'crossplay',
  'antiCheat',
  'cloudInfra',
  'mocap',
  'engine2',
  'esports',
  'aiTools',
  'engine3',
];

export const RESEARCH: Record<ResearchId, ResearchDef> = {
  agile: { name: 'Agile Pipeline', cost: 12000, days: 30, requires: [], minRep: 0, blurb: '+10% development speed.' },
  analytics: { name: 'Player Analytics', cost: 20000, days: 30, requires: [], minRep: 0, blurb: '-8% churn. Reveals genre focus targets and quality estimates.' },
  netcode: { name: 'Netcode Expertise', cost: 45000, days: 40, requires: [], minRep: 5, blurb: '+tech quality on online games, -15% server costs.' },
  communityHub: { name: 'Community Platform', cost: 70000, days: 40, requires: ['analytics'], minRep: 5, blurb: '-6% churn, faster reputation growth.' },
  qaAutomation: { name: 'Automated QA', cost: 40000, days: 45, requires: ['agile'], minRep: 5, blurb: '-35% bugs created during development.' },
  marketingData: { name: 'Marketing Data Science', cost: 110000, days: 40, requires: ['analytics'], minRep: 10, blurb: '+30% marketing efficiency.' },
  liveOps: { name: 'Live Ops Toolkit', cost: 60000, days: 45, requires: ['agile'], minRep: 10, blurb: 'Updates build 35% faster and land better.' },
  engine1: { name: 'In-House Engine v1', cost: 250000, days: 120, requires: ['agile'], minRep: 15, blurb: 'Your own engine: no royalties, quality cap 86.' },
  crossplay: { name: 'Cross-Platform Tech', cost: 350000, days: 60, requires: ['netcode'], minRep: 20, blurb: 'Porting work -50%; multiplatform online games share one network.' },
  antiCheat: { name: 'Anti-Cheat Systems', cost: 150000, days: 50, requires: ['netcode'], minRep: 20, blurb: '-12% churn on competitive genres.' },
  cloudInfra: { name: 'Cloud Infrastructure', cost: 300000, days: 60, requires: ['netcode'], minRep: 20, blurb: '-40% server costs, prevents launch-day meltdowns.' },
  mocap: { name: 'Motion Capture Studio', cost: 600000, days: 60, requires: [], minRep: 30, blurb: '+graphics quality for realistic and photoreal games.' },
  engine2: { name: 'In-House Engine v2', cost: 3000000, days: 180, requires: ['engine1'], minRep: 35, blurb: 'Engine quality cap 95, faster production.' },
  esports: { name: 'Esports Program', cost: 2500000, days: 90, requires: ['antiCheat'], minRep: 45, blurb: 'Competitive games gain visibility and retention.' },
  aiTools: { name: 'AI-Assisted Tooling', cost: 9000000, days: 120, requires: ['engine1', 'qaAutomation'], minRep: 45, blurb: '+20% development speed, -20% bugs.' },
  engine3: { name: 'In-House Engine v3', cost: 25000000, days: 240, requires: ['engine2'], minRep: 60, blurb: 'Engine cap 100 and licensable: earns royalties from rivals.' },
};

// ---------------------------------------------------------------- marketing

export interface CampaignDef {
  name: string;
  cost: number;
  hype: number;
  blurb: string;
  minScopeHint: ScopeId;
}

export const CAMPAIGN_IDS: CampaignId[] = ['social', 'influencer', 'trailer', 'expo', 'global'];

export const CAMPAIGNS: Record<CampaignId, CampaignDef> = {
  social: { name: 'Social Media Push', cost: 500, hype: 6, blurb: 'Posts, devlogs and a tiny ad budget.', minScopeHint: 'tiny' },
  influencer: { name: 'Influencer Campaign', cost: 6000, hype: 22, blurb: 'Send keys to streamers and creators.', minScopeHint: 'small' },
  trailer: { name: 'Trailer & Ad Blitz', cost: 60000, hype: 70, blurb: 'Professional trailer and targeted ads.', minScopeHint: 'medium' },
  expo: { name: 'Gaming Expo Showcase', cost: 450000, hype: 180, blurb: 'A booth and stage slot at the biggest show.', minScopeHint: 'large' },
  global: { name: 'Global Mega Campaign', cost: 4500000, hype: 420, blurb: 'TV, billboards and celebrity tie-ins worldwide.', minScopeHint: 'aaa' },
};

// ---------------------------------------------------------------- updates

export interface UpdateDef {
  name: string;
  workFrac: number;
  minWork: number;
  costFrac: number;
  blurb: string;
}

export const UPDATE_IDS: UpdateTypeId[] = ['hotfix', 'balance', 'content', 'seasonal', 'expansion', 'monetization', 'port'];

export const UPDATES: Record<UpdateTypeId, UpdateDef> = {
  hotfix: { name: 'Hotfix Patch', workFrac: 0.03, minWork: 3, costFrac: 0.01, blurb: 'Squash most known bugs. Players appreciate it.' },
  balance: { name: 'Balance & QoL Patch', workFrac: 0.06, minWork: 5, costFrac: 0.02, blurb: 'Tune and polish. Raises user score.' },
  content: { name: 'Content Update', workFrac: 0.15, minWork: 8, costFrac: 0.05, blurb: 'New maps, modes and items. Brings lapsed players back.' },
  seasonal: { name: 'Seasonal Event', workFrac: 0.1, minWork: 6, costFrac: 0.03, blurb: '30-day event: more appeal, more spending.' },
  expansion: { name: 'Major Expansion (DLC)', workFrac: 0.4, minWork: 20, costFrac: 0.15, blurb: 'Big paid expansion. Strong revival and DLC sales.' },
  monetization: { name: 'Monetization Overhaul', workFrac: 0.08, minWork: 5, costFrac: 0.02, blurb: 'Switch business model or add a battle pass.' },
  port: { name: 'Platform Port', workFrac: 0.3, minWork: 10, costFrac: 0.08, blurb: 'Bring the game to another platform.' },
};

// ---------------------------------------------------------------- AI strategies

export interface StrategyDef {
  name: string;
  risk: number;
  hiring: number;
  quality: number;
  trend: number;
  acquisitive: number;
  ipo: number;
  updateEvery: number;
  monetization: Partial<Record<MonetizationId, number>>;
  blurb: string;
}

export const STRATEGY_IDS: StrategyId[] = ['aggressiveGrowth', 'qualityFocused', 'monetizer', 'indieArtisan', 'conglomerate', 'trendChaser'];

export const STRATEGIES: Record<StrategyId, StrategyDef> = {
  aggressiveGrowth: { name: 'Aggressive Growth', risk: 0.85, hiring: 1.35, quality: 0.96, trend: 0.6, acquisitive: 0.5, ipo: 0.9, updateEvery: 50, monetization: { f2pCosmetic: 3, f2pAggressive: 2, premiumMtx: 2, premium: 1 }, blurb: 'Grows fast, borrows heavily, overextends.' },
  qualityFocused: { name: 'Quality First', risk: 0.5, hiring: 1.0, quality: 1.1, trend: 0.25, acquisitive: 0.2, ipo: 0.4, updateEvery: 75, monetization: { premium: 5, premiumMtx: 1, subscription: 1 }, blurb: 'Fewer, better games. Strong reputation.' },
  monetizer: { name: 'Monetization Machine', risk: 0.6, hiring: 1.1, quality: 0.9, trend: 0.7, acquisitive: 0.4, ipo: 0.75, updateEvery: 40, monetization: { f2pAggressive: 4, ads: 2, premiumMtx: 2, f2pCosmetic: 2 }, blurb: 'Squeezes every dollar from every player.' },
  indieArtisan: { name: 'Indie Artisan', risk: 0.3, hiring: 0.8, quality: 1.08, trend: 0.1, acquisitive: 0.02, ipo: 0.05, updateEvery: 90, monetization: { premium: 6, premiumMtx: 1 }, blurb: 'Small, original, beloved games.' },
  conglomerate: { name: 'Conglomerate', risk: 0.6, hiring: 1.15, quality: 1.0, trend: 0.5, acquisitive: 1.0, ipo: 1.0, updateEvery: 55, monetization: { premium: 2, premiumMtx: 3, f2pCosmetic: 2, subscription: 1 }, blurb: 'Buys studios and builds an empire of franchises.' },
  trendChaser: { name: 'Trend Chaser', risk: 0.7, hiring: 1.2, quality: 0.92, trend: 1.0, acquisitive: 0.3, ipo: 0.6, updateEvery: 45, monetization: { f2pCosmetic: 3, f2pAggressive: 2, premiumMtx: 2, premium: 1 }, blurb: 'Jumps on whatever genre is hot right now.' },
};

// ---------------------------------------------------------------- difficulty

export const DIFFICULTIES = {
  relaxed: { name: 'Relaxed', cash: 25000, aiQuality: 0.95, eventSeverity: 0.7, market: 1.15, blurb: 'More starting cash, gentler rivals and events.' },
  normal: { name: 'Normal', cash: 10000, aiQuality: 1.0, eventSeverity: 1.0, market: 1.0, blurb: 'The intended experience. $10,000 and a dream.' },
  brutal: { name: 'Brutal', cash: 5000, aiQuality: 1.06, eventSeverity: 1.35, market: 0.88, blurb: 'Less cash, sharper rivals, harsher crises.' },
} as const;

// ---------------------------------------------------------------- misc tuning

export const TAX_RATE = 0.21;
export const MAX_ACTIVE_STUDIOS = 46;
export const INSOLVENCY_GRACE_DAYS = 45;
export const NEWS_CAP = 450;
