// Core data model for the Game Empire simulation.
// Everything in here is plain serialisable data: the whole World can be
// JSON-stringified into a save file and resumed deterministically.

export type GenreId =
  | 'fps'
  | 'battleRoyale'
  | 'survival'
  | 'horror'
  | 'rpg'
  | 'mmorpg'
  | 'sandbox'
  | 'racing'
  | 'strategy'
  | 'simulation'
  | 'sports'
  | 'indie'
  | 'openWorld';

export type PlatformId = 'pc' | 'console' | 'mobile' | 'handheld' | 'vr' | 'cloud';
export type AudienceId = 'everyone' | 'kids' | 'teens' | 'youngAdults' | 'adults' | 'hardcore' | 'casual';
export type EngineId = 'scratch' | 'pixelforge' | 'nimbus' | 'titan' | 'apex' | 'inhouse';
export type MonetizationId = 'premium' | 'premiumMtx' | 'f2pCosmetic' | 'f2pAggressive' | 'subscription' | 'ads';
export type ArtStyleId = 'pixel' | 'lowPoly' | 'stylized' | 'anime' | 'handDrawn' | 'realistic' | 'photoreal';
export type MultiplayerId = 'single' | 'localCoop' | 'online' | 'massive';
export type ScopeId = 'tiny' | 'small' | 'medium' | 'large' | 'aaa' | 'mega';
export type FocusId = 'gameplay' | 'graphics' | 'story' | 'audio' | 'tech' | 'content';
export type RoleId =
  | 'founder'
  | 'programmer'
  | 'artist'
  | 'designer'
  | 'writer'
  | 'audio'
  | 'qa'
  | 'producer'
  | 'marketing'
  | 'community';
export type StrategyId =
  | 'aggressiveGrowth'
  | 'qualityFocused'
  | 'monetizer'
  | 'indieArtisan'
  | 'conglomerate'
  | 'trendChaser';
export type UpdateTypeId = 'hotfix' | 'balance' | 'content' | 'seasonal' | 'expansion' | 'monetization' | 'port';
export type TraitId =
  | 'fastLearner'
  | 'perfectionist'
  | 'speedster'
  | 'crunchProof'
  | 'toxic'
  | 'genius'
  | 'loyal'
  | 'mentor';
export type ResearchId =
  | 'agile'
  | 'qaAutomation'
  | 'analytics'
  | 'liveOps'
  | 'netcode'
  | 'cloudInfra'
  | 'mocap'
  | 'marketingData'
  | 'communityHub'
  | 'antiCheat'
  | 'esports'
  | 'crossplay'
  | 'engine1'
  | 'engine2'
  | 'engine3'
  | 'aiTools';
export type CampaignId = 'social' | 'influencer' | 'trailer' | 'expo' | 'global';
export type Difficulty = 'relaxed' | 'normal' | 'brutal';

export type Focus = Record<FocusId, number>;

/** Compact time series point: [day, value]. */
export type Point = [number, number];

export interface Employee {
  id: string;
  name: string;
  role: RoleId;
  /** Founder only: which discipline they are strongest in. */
  specialty?: 'programmer' | 'artist' | 'designer';
  skill: number;
  /** Monthly salary in dollars. */
  salary: number;
  morale: number;
  xp: number;
  traits: TraitId[];
  hiredDay: number;
  /** Game id the employee is assigned to (development or live-ops update), or null. */
  assignment: string | null;
  isFounder: boolean;
}

export interface Candidate {
  id: string;
  name: string;
  role: RoleId;
  skill: number;
  salary: number;
  traits: TraitId[];
  /** Former employer, if they came out of a studio collapse or poach. */
  formerStudio?: string;
}

export interface ActiveUpdate {
  type: UpdateTypeId;
  workRequired: number;
  workDone: number;
  startDay: number;
  /** Player: employee ids. AI: uses aiTeam. */
  team: string[];
  aiTeam: number;
  cost: number;
  /** For 'port' updates: the platform being added. */
  platform?: PlatformId;
  /** For 'monetization' updates: target model. */
  monetization?: MonetizationId;
}

export interface UpdateRecord {
  day: number;
  type: UpdateTypeId;
  reception: number; // 0..100
  label: string;
}

export interface Game {
  id: string;
  title: string;
  companyId: string;
  developerName: string;
  ipId: string;
  sequelNo: number;
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
  budgetSpent: number;
  /** Salaries (and overhead) paid to the team while in development. */
  staffCost: number;
  status: 'development' | 'released' | 'shutdown' | 'cancelled' | 'retired';

  // ---- development
  createdDay: number;
  workRequired: number;
  workDone: number;
  focus: Focus;
  points: Focus;
  bugs: number;
  crunch: boolean;
  crunchDays: number;
  team: string[];
  aiTeam: number;
  aiTalent: number;
  hype: number;
  wishlists: number;
  marketingSpent: number;
  plannedDays: number;
  /** AI: marketing milestones already hit (0.5, 0.85). */
  aiMarketingStage: number;
  /** Revenue share owed to a publisher (0..1). */
  publisherCut: number;

  // ---- release / live
  releaseDay: number | null;
  quality: number;
  criticScore: number;
  userScore: number;
  userScoreTarget: number;
  breakout: number;
  freshness: number;
  owners: number;
  active: number;
  ccu: number;
  peakCcu: number;
  peakActive: number;
  dailyNew: number;
  dailyRevenue: number;
  dailyCost: number;
  revenueTotal: number;
  costTotal: number;
  rev30: number;
  cost30: number;
  dlcOwners: number;
  viralUntil: number;
  viralMult: number;
  seasonalUntil: number;
  discount: number;
  discountUntil: number;
  meltdownUntil: number;
  goodwill: number;
  update: ActiveUpdate | null;
  updates: UpdateRecord[];
  lastUpdateDay: number;
  awards: string[];
  shutdownDay: number | null;
  /** [day, active, ccu, dailyRevenue] */
  history: [number, number, number, number][];
}

export interface IP {
  id: string;
  name: string;
  companyId: string;
  games: string[];
  fans: number;
  createdDay: number;
}

export interface Loan {
  id: string;
  principal: number;
  balance: number;
  apr: number;
  monthlyPayment: number;
  monthsLeft: number;
  takenDay: number;
  lender: string;
}

export interface Ledger {
  sales: number;
  microtransactions: number;
  subscriptions: number;
  ads: number;
  dlc: number;
  licensing: number;
  other: number;
  salaries: number;
  rent: number;
  servers: number;
  development: number;
  marketing: number;
  royalties: number;
  interest: number;
  taxes: number;
  research: number;
  misc: number;
}

export interface MonthRecord {
  day: number; // day the month closed
  label: string;
  revenue: number;
  expenses: number;
  profit: number;
  cash: number;
  ledger: Ledger;
}

export interface Holding {
  shares: number;
  cost: number;
}

export interface Company {
  id: string;
  name: string;
  isPlayer: boolean;
  founded: number;
  strategy: StrategyId;
  specialties: GenreId[];
  color: string;
  ceo: string;
  hq: string;
  status: 'active' | 'bankrupt' | 'acquired';
  parentId: string | null;
  endDay: number | null;

  reputation: number;
  fans: number;
  cash: number;
  loans: Loan[];
  headcount: number;
  talent: number;
  avgSalary: number;
  genreXp: Partial<Record<GenreId, number>>;

  // ---- ownership & stock
  isPublic: boolean;
  shares: number;
  founderShares: number;
  investorShares: number;
  price: number;
  ipoDay: number | null;
  priceHistory: Point[];
  valuation: number;
  valuationHistory: Point[];
  expectedQuarter: number;
  quarterRevenue: number;
  lastQuarterRevenue: number;
  /** Other companies' shares this company owns. */
  holdings: Record<string, Holding>;

  // ---- finances
  ledger: Ledger;
  monthly: MonthRecord[];
  cashHistory: Point[];
  revenueTotal: number;
  insolventDays: number;
  boardConfidence: number;
  defaults: number;
  rev30: number;
  lastDecisionDay: number;
  decisionOffset: number;
  distressDays: number;
}

export interface MarketEffect {
  id: string;
  kind: 'genreBoost' | 'platformBoost' | 'sentiment' | 'regulation' | 'engineRoyalty' | 'surge';
  genre?: GenreId;
  platform?: PlatformId;
  mult: number;
  until: number;
  label: string;
}

export interface GenreState {
  trend: number;
  target: number;
  history: Point[];
}

export interface PlatformState {
  users: number; // millions
  growth: number; // annual
  history: Point[];
}

export interface MarketState {
  genres: Record<GenreId, GenreState>;
  platforms: Record<PlatformId, PlatformState>;
  sentiment: number;
  sentimentTarget: number;
  regime: 'bull' | 'bear' | 'neutral';
  index: number;
  indexHistory: Point[];
  baseRate: number;
  effects: MarketEffect[];
  titanRoyalty: number;
  talentSurgeUntil: number;
  /** [day, total active players, total daily revenue] monthly snapshots. */
  industryHistory: [number, number, number][];
}

export type NewsKind = 'player' | 'release' | 'industry' | 'market' | 'finance' | 'event' | 'awards';

export interface NewsItem {
  id: string;
  day: number;
  kind: NewsKind;
  title: string;
  body?: string;
  companyId?: string;
  gameId?: string;
  tone: 'good' | 'bad' | 'neutral' | 'major';
}

export interface DecisionOption {
  id: string;
  label: string;
  description: string;
  disabled?: boolean;
}

export interface DecisionEvent {
  id: string;
  day: number;
  kind: string;
  title: string;
  body: string;
  options: DecisionOption[];
  data: Record<string, string | number | boolean | null>;
  expiresDay: number;
}

export interface Auction {
  id: string;
  ipId: string;
  ipName: string;
  fromCompany: string;
  minBid: number;
  endsDay: number;
  /** Sealed bids. */
  bids: Record<string, number>;
  resolved: boolean;
}

export interface ResearchState {
  completed: ResearchId[];
  active: { id: ResearchId; progress: number; days: number } | null;
}

export interface PlayerStats {
  gamesReleased: number;
  peakCcu: number;
  bestCritic: number;
  totalRevenue: number;
  acquisitions: number;
  peakValuation: number;
  hitsOver1M: number;
}

export interface GameOverState {
  reason: 'bankrupt' | 'ousted' | 'takeover' | 'sold';
  day: number;
  title: string;
  body: string;
  netWorth: number;
}

export interface PlayerState {
  companyId: string;
  founderName: string;
  employees: Employee[];
  candidates: Candidate[];
  candidatesRefreshDay: number;
  research: ResearchState;
  officeLevel: number;
  achievements: Record<string, number>;
  stats: PlayerStats;
  gameOver: GameOverState | null;
  /** Funding round offers currently on the table. */
  fundingOffers: FundingOffer[];
  fundingRoundsTaken: number;
  lastFundingDay: number;
  autoSupportSubsidiaries: boolean;
  tutorialDismissed: boolean;
}

export interface FundingOffer {
  id: string;
  investor: string;
  round: string;
  amount: number;
  equity: number;
  preMoney: number;
  expiresDay: number;
}

export interface World {
  version: number;
  seed: number;
  rng: number;
  day: number;
  difficulty: Difficulty;
  nextId: number;
  companies: Record<string, Company>;
  games: Record<string, Game>;
  ips: Record<string, IP>;
  market: MarketState;
  news: NewsItem[];
  pendingEvents: DecisionEvent[];
  auctions: Auction[];
  player: PlayerState;
  /** Set by the engine when the player must react now; the UI pauses and clears it. */
  pauseReason?: string | null;
  /** Toast queue for the UI (drained by the store). */
  toasts: { id: string; title: string; tone: NewsItem['tone'] }[];
  awardsHistory: { year: number; category: string; gameId: string; title: string; companyId: string }[];
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}
