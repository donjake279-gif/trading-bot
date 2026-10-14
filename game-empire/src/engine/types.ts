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
export type TopicId =
  | 'zombies'
  | 'space'
  | 'fantasy'
  | 'cyberpunk'
  | 'pirates'
  | 'ninjas'
  | 'dinosaurs'
  | 'cats'
  | 'mythology'
  | 'postApoc'
  | 'wildWest'
  | 'medieval'
  | 'military'
  | 'superheroes'
  | 'cooking'
  | 'farming'
  | 'spies'
  | 'robots'
  | 'vampires'
  | 'underwater';
export type ComboGrade = 'legendary' | 'great' | 'good' | 'okay' | 'bad';
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
  | 'legend'
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
  bio?: string;
  /** Last day HR sent them on a training course. */
  trainedDay?: number;
  /** Skill gained at the last training. */
  trainedGain?: number;
}

export interface Candidate {
  id: string;
  name: string;
  role: RoleId;
  skill: number;
  salary: number;
  traits: TraitId[];
  /** Former employer, if they came out of a studio collapse. */
  formerStudio?: string;
  /** Industry legends come with a story. */
  bio?: string;
}

export interface ActiveUpdate {
  type: UpdateTypeId;
  workRequired: number;
  workDone: number;
  startDay: number;
  /** Player: employee ids. AI: uses aiTeam. */
  team: string[];
  /** AI: its team size. Player: contract live-ops crew. */
  aiTeam: number;
  cost: number;
  /** For 'port' updates: the platform being added. */
  platform?: PlatformId;
  /** For 'monetization' updates: target model. */
  monetization?: MonetizationId;
}

export interface QueuedUpdate {
  type: UpdateTypeId;
  platform?: PlatformId;
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
  /** Updates waiting to start after the current one (player only). */
  updateQueue: QueuedUpdate[];
  /** Player: the studio keeps this game updated automatically. */
  autoUpdates: boolean;
  /** Player switched auto updates off for this game even though they're on studio-wide. */
  manualUpdates?: boolean;
  /** How much the game has grown through updates: more players find it and fewer leave. */
  contentLevel?: number;
  verMajor?: number;
  verMinor?: number;
  /** One of the player's first releases: gets newcomer buzz. */
  newcomer: boolean;
  /** Players are angry about a bad update until this day. */
  backlashUntil: number;
  /** Player already warned that this game feels abandoned. */
  neglectWarned: boolean;
  /** Highest concurrent-player milestone already celebrated. */
  ccuMilestone: number;
  /** Yesterday's daily churn rate (for retention stats). */
  lastChurn: number;
  updates: UpdateRecord[];
  lastUpdateDay: number;
  awards: string[];
  /** Setting of the game; with the genre it forms a combo that critics love or hate. */
  topic: TopicId;
  /** Id of the original game when this is a remaster. */
  remasterOf: string | null;
  /** The original already has a remaster. */
  remastered: boolean;
  /** Sales certification level reached (0 none .. 5 legendary). */
  certified: number;
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
  store: number;
  contracts: number;
  investments: number;
  publishing: number;
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
  perks: number;
  misc: number;
  /** Console sales and platform fees. */
  hardware: number;
  /** AI services and anti-cheat licences. */
  tech: number;
  /** Box office and theme parks. */
  entertainment: number;
  /** Venture R&D, compute, production and upkeep. */
  ventures: number;
  /** Empire upkeep, fines and legal costs. */
  empire: number;
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
  /** Option applied if the player lets the offer lapse. */
  defaultOption?: string;
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
  reason: 'bankrupt' | 'ousted' | 'takeover' | 'sold' | 'retired';
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
  /** Idle developers join projects automatically. */
  autoAssign: boolean;
  lifelinesUsed: number;
  infra: InfraState;
  progression: Progression;
  objectives: Objective[];
  objectivesCompleted: number;
  objectiveRerollDay: number;
  contracts: Contract[];
  contractOffers: ContractOffer[];
  contractsRefreshDay: number;
  contractsCompleted: number;
  policies: Policies;
  investments: Investments;
  publishing: PublishingDeal[];
  licenses: LicenseDeal[];
  /** Booth tier booked for this year's GameExpo (0 = none). */
  expoBooking: { year: number; tier: number } | null;
  /** One-off notices already sent (keyed), so they don't repeat. */
  flags: Record<string, number>;
  rivalId: string | null;
  /** Your own game engine, once founded. */
  engine: StudioEngine | null;
  /** Genre x topic combos you have discovered ("genre:topic" -> grade). */
  combos: Record<string, ComboGrade>;
  facilities: FacilityId[];
  convention: { day: number; tier: number } | null;
  conventionsHeld: number;
  store: StoreState | null;
  /** Legacy bonuses this run started with (for display). */
  legacy: Partial<Record<LegacyId, number>>;
  legacyBanked: boolean;
  /** HR autopilot: raises, training and replacements on their own. */
  hr: HrSettings;
  empire: EmpireState;
  ventures: Ventures;
  liveOps: LiveOpsSettings;
  rivalry: RivalryState;
}

export interface RivalryState {
  /** Head-to-head record per rival: your launches against theirs. */
  records: Record<string, { won: number; lost: number }>;
  /** Have you overtaken your current rival (and not lost the lead since)? */
  ahead: boolean;
  /** Weekly checks in a row you were worth more than your rival. */
  leadWeeks: number;
  /** Rivals you overtook or outlasted. */
  beaten: string[];
  lastTauntDay: number;
  /** Recent trash talk, newest first. */
  quotes: { day: number; companyId: string; text: string }[];
}

export interface LiveOpsSettings {
  /** Auto-update every live game. */
  auto: boolean;
  /** Hire a contract crew so updates ship on time when developers are busy. */
  crew: boolean;
}

export type HrSpending = 'careful' | 'balanced' | 'generous';

export interface HrSettings {
  autoRaise: boolean;
  autoTrain: boolean;
  /** Fill empty desks and replace anyone who quits. */
  autoHire: boolean;
  /** Team size HR hires up to; 0 means fill the office. */
  teamTarget: number;
  spending: HrSpending;
  log: { day: number; text: string }[];
}

export type EngineModuleId = 'rendering' | 'physics' | 'tools' | 'networking' | 'platforms' | 'scripting';

export interface StudioEngine {
  name: string;
  foundedDay: number;
  /** Major version shipped (1..5). */
  version: number;
  modules: Record<EngineModuleId, number>;
  upgrade: { module: EngineModuleId; daysLeft: number; days: number } | null;
  licensing: boolean;
  /** Share of licensees' net revenue. */
  royalty: number;
  /** Upfront fee per project. */
  fee: number;
  /** Developer buzz around the engine, 0..100. */
  hype: number;
  royaltiesTotal: number;
  feesTotal: number;
  /** Rival projects ever started on your engine. */
  gamesBuilt: number;
}

export type FacilityId = 'coffee' | 'arcade' | 'napPods' | 'gym' | 'testLab' | 'soundStage' | 'rooftop' | 'daycare' | 'mocap' | 'arena' | 'renderFarm';

export interface StoreState {
  name: string;
  foundedDay: number;
  /** Share of PC digital sales flowing through your store, 0..1. */
  share: number;
  promoUntil: number;
  revenueTotal: number;
}

export type LegacyId = 'cash' | 'reputation' | 'skill' | 'engine' | 'perk' | 'garage';

export interface FundingOffer {
  id: string;
  investor: string;
  round: string;
  amount: number;
  equity: number;
  preMoney: number;
  expiresDay: number;
}

export type NoticeCategory = 'studio' | 'game' | 'team' | 'finance' | 'market' | 'industry' | 'offer' | 'achievement' | 'server' | 'goal';

export interface NoticeLink {
  /** A UI route name (dashboard, game, company, servers, ...). */
  route: string;
  id?: string;
}

/** A notification: shown briefly as a toast, kept in the notification history. */
export interface Notice {
  id: string;
  day: number;
  title: string;
  body?: string;
  tone: NewsItem['tone'];
  category: NoticeCategory;
  link?: NoticeLink;
  read: boolean;
}

export interface ServerIncident {
  day: number;
  days: number;
  cause: string;
  /** Where it happened: 'cloud' for rented hosting, or a data center name. */
  where?: string;
  /** True when every online game went down, not just part of the fleet. */
  full?: boolean;
}

export type RegionId = 'na' | 'eu' | 'asia' | 'sa' | 'oce';
export type DcUpgradeId = 'space' | 'power' | 'cooling' | 'network' | 'backup' | 'security';
export type ServerModelId = 'budget' | 'rack' | 'blade' | 'pod' | 'supercluster' | 'quantum' | 'photonic';

/** A building you own and fill with your own servers. */
export interface DataCenter {
  id: string;
  name: string;
  region: RegionId;
  /** Building tier (index into DC_BUILDINGS). */
  building: number;
  upgrades: Record<DcUpgradeId, number>;
  servers: Record<ServerModelId, number>;
  /** Construction finishes on this day; the building does nothing before. */
  readyDay: number;
  /** A bigger building being built around the old one (finishes on expandDay). */
  expandTo: number | null;
  expandDay: number;
  offlineUntil: number;
  /** Hardware wear, 0 (new) .. 1 (worn out). */
  wear: number;
  boughtDay: number;
}

export interface InfraState {
  tier: number;
  nodes: number;
  autoscale: boolean;
  incidents: ServerIncident[];
  /** Days in a row the servers ran nearly empty (autoscale shrink). */
  lowLoadDays: number;
  /** Yesterday's concurrent players on your online games and capacity use. */
  demand: number;
  load: number;
  outageUntil: number;
  overloadDays: number;
  /** Days the infrastructure was down in the trailing window (for uptime). */
  downtime: Point[];
  /** Online concurrent players and fleet capacity over time (for charts). */
  demandHistory: Point[];
  capacityHistory: Point[];
  /** Buildings you own, filled with your own servers. */
  dataCenters: DataCenter[];
}

export type PerkId =
  | 'prototyping'
  | 'polish'
  | 'press'
  | 'marketing'
  | 'hype'
  | 'patch'
  | 'community'
  | 'talent'
  | 'crunch'
  | 'lean'
  | 'deals'
  | 'merch';

export interface Progression {
  xp: number;
  level: number;
  perkPoints: number;
  perks: Partial<Record<PerkId, number>>;
}

export type ObjectiveKind =
  | 'ccu'
  | 'critic'
  | 'monthRevenue'
  | 'employees'
  | 'updates'
  | 'reputation'
  | 'valuation'
  | 'liveGames'
  | 'owners'
  | 'cash'
  | 'contracts'
  | 'serverTier'
  | 'dataCenter'
  | 'releases';

export interface Objective {
  id: string;
  kind: ObjectiveKind;
  title: string;
  target: number;
  /** Counter value when the goal was set, for "ship N more" style goals. */
  baseline: number;
  rewardCash: number;
  rewardXp: number;
  rewardRep: number;
  rewardPerk: boolean;
  createdDay: number;
}

export interface ContractOffer {
  id: string;
  client: string;
  kind: string;
  title: string;
  work: number;
  days: number;
  pay: number;
  rep: number;
  expiresDay: number;
}

export interface Contract extends ContractOffer {
  workDone: number;
  startDay: number;
  deadline: number;
}

export type BenefitsPolicy = 'basic' | 'standard' | 'premium';
export type HoursPolicy = 'flexible' | 'standard' | 'extended';
export type QaPolicy = 'fast' | 'standard' | 'rigorous';

export interface Policies {
  benefits: BenefitsPolicy;
  profitSharing: boolean;
  hours: HoursPolicy;
  qa: QaPolicy;
  retainer: boolean;
}

export interface Investments {
  bonds: number;
  indexUnits: number;
  indexCost: number;
}

export interface PublishingDeal {
  id: string;
  gameId: string;
  companyId: string;
  title: string;
  share: number;
  paid: number;
  earned: number;
  startDay: number;
}

export interface LicenseDeal {
  id: string;
  label: string;
  monthly: number;
  monthsLeft: number;
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
  /** Legacy (pre-v3 saves); the game no longer pauses itself. */
  pauseReason?: string | null;
  /** Notification history (newest first). */
  notices: Notice[];
  /** Toast queue for the UI (drained by the store). */
  toasts: { id: string; title: string; body?: string; tone: NewsItem['tone']; category?: NoticeCategory; link?: NoticeLink }[];
  awardsHistory: { year: number; category: string; gameId: string; title: string; companyId: string }[];
  /** The current (or most recent) Game Awards season. */
  awardSeason: AwardSeason | null;
  /** Past seasons, oldest first. */
  awardArchive: AwardSeason[];
  /** Big moments for the UI to celebrate (confetti); drained by the store. */
  celebrations: { id: string; title: string; big?: boolean }[];
  /** Player releases waiting for their launch-day reveal; drained by the store, never saved. */
  launches?: LaunchNote[];
}

export interface LaunchNote {
  gameId: string;
  /** Best critic score before this launch, for "new studio record". */
  prevBest: number;
  /** What your rival had to say about it. */
  rivalLine?: string;
}

export type AwardCategoryId =
  | 'goty'
  | 'narrative'
  | 'art'
  | 'audio'
  | 'multiplayer'
  | 'ongoing'
  | 'indie'
  | 'debut'
  | 'mobile'
  | 'innovation'
  | 'family'
  | 'players'
  | 'glitch'
  | 'studio';

export interface AwardNominee {
  /** Game id, or company id for Studio of the Year. */
  id: string;
  title: string;
  companyId: string;
  score: number;
}

export interface AwardCategory {
  id: AwardCategoryId;
  nominees: AwardNominee[];
  winnerId: string | null;
}

export interface AwardSeason {
  year: number;
  nominationsDay: number;
  ceremonyDay: number;
  categories: AwardCategory[];
  /** Your "For Your Consideration" campaign strength per game id. */
  campaigns: Record<string, number>;
  /** Your Game of the Year pick. */
  prediction: string | null;
  presenter: boolean;
  /** Your upcoming game revealed on stage. */
  premiere: string | null;
  done: boolean;
  /** Has the player watched the ceremony replay. */
  watched: boolean;
  highlights: string[];
}

export interface ActionResult {
  ok: boolean;
  error?: string;
  id?: string;
}

// ---------------------------------------------------------------- empire & ventures

export interface EmpireState {
  /** Highest empire level reached. */
  best: number;
  /** Challenge ids completed. */
  done: string[];
  /** Levels whose challenges are all complete (reward paid). */
  cleared: number[];
  investigations: number;
  courtWins: number;
  /** Consent decree: platform and licence income halved until this day. */
  decreeUntil: number;
  /** Staff strike: development crawls until this day. */
  strikeUntil: number;
  overheadPaid: number;
  finesPaid: number;
}

export type ConsoleSize = 'handheld' | 'home' | 'elite';

export interface ConsoleModel {
  id: string;
  name: string;
  gen: number;
  size: ConsoleSize;
  stage: 'design' | 'live' | 'retired';
  startDay: number;
  launchDay: number;
  rdCost: number;
  rdSpent: number;
  /** Raw power when it launched (rivals keep getting faster). */
  power: number;
  price: number;
  unitCost: number;
  /** Consoles in people's homes. */
  installed: number;
  sold: number;
  dailySales: number;
  revenue: number;
  fees: number;
  marketingUntil: number;
  shortageUntil: number;
}

export interface AiModel {
  id: string;
  gen: number;
  name: string;
  quality: number;
  day: number;
}

export interface AiLab {
  name: string;
  founded: number;
  researchers: number;
  models: AiModel[];
  training: { gen: number; start: number; days: number; cost: number; spent: number } | null;
  /** Sell AI dev tools to rival studios. */
  licensing: boolean;
  licensees: string[];
  revenue: number;
  incidents: number;
  dailyRevenue: number;
}

export interface AntiCheat {
  name: string;
  version: number;
  strength: number;
  mode: 'standard' | 'kernel';
  building: { version: number; start: number; days: number; cost: number; spent: number } | null;
  licensing: boolean;
  /** Share of a licensee's online revenue. */
  fee: number;
  licensees: string[];
  revenue: number;
  /** A cheating wave is hitting your online games until this day. */
  breachUntil: number;
}

export interface Film {
  id: string;
  title: string;
  gameId: string;
  ipId: string;
  tier: number;
  budget: number;
  start: number;
  releaseDay: number;
  stage: 'production' | 'released';
  score: number;
  gross: number;
  earned: number;
}

export interface ThemePark {
  id: string;
  name: string;
  region: RegionId;
  stage: 'building' | 'open';
  start: number;
  openDay: number;
  cost: number;
  /** IP ids with a themed land. */
  lands: string[];
  visitors: number;
  revenue: number;
  closedUntil: number;
}

export interface Ventures {
  consoles: ConsoleModel[];
  /** The best rival console's power. */
  rivalPower: number;
  /** Console store fees collected industry-wide today. */
  feePool: number;
  ai: AiLab | null;
  /** Rival AI labs' best model quality. */
  aiFrontier: number;
  /** Yearly AI market size. */
  aiMarket: number;
  antiCheat: AntiCheat | null;
  /** How good cheat makers are. */
  cheatLevel: number;
  films: Film[];
  parks: ThemePark[];
}
