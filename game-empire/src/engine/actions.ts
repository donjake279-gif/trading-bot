// Player actions. Every UI interaction that changes the world goes through
// here; each validates its preconditions and returns an ActionResult.
import {
  CAMPAIGNS,
  ENGINES,
  TOPIC_IDS,
  GENRES,
  MONETIZATIONS,
  OFFICES,
  PLATFORMS,
  RESEARCH,
  ROLES,
  SCOPES,
  salaryFor,
} from './constants';
import { cancelProject, shutdownGame } from './ai';
import {
  createGameRecord,
  engineStats,
  hasResearch,
  playerDailyWork,
  releaseGame,
  upfrontCosts,
  type GameParams,
} from './development';
import { ipValue } from './events';
import { debtOf, loanOffers, revenueTTM, takeLoan as financeTakeLoan, randomInvestorAppetite } from './finance';
import { investorName } from './names';
import { randInt, randRange } from './rng';
import { makeEmployee, recruitFee, refreshCandidates } from './staff';
import { perkRank } from './progression';
import { acquireCompany, acquisitionPrice, buyShares, floatShares, ipoCompany, marketCap, sellShares } from './stocks';
import type { ActionResult, CampaignId, Company, Focus, Game, LiveOpsSettings, MonetizationId, PlatformId, QueuedUpdate, ResearchId, StrategyId, UpdateTypeId, World } from './types';
import { startUpdateRecord, updateCost } from './updates';
import { addGame, clamp, newId, playerCompany, pushNews, toast } from './util';

const ok = (id?: string): ActionResult => ({ ok: true, id });
const fail = (error: string): ActionResult => ({ ok: false, error });

function ownGame(w: World, gameId: string): Game | null {
  const g = w.games[gameId];
  if (!g || g.companyId !== w.player.companyId) return null;
  return g;
}

// ------------------------------------------------------------ game creation

export function validateGameParams(w: World, p: GameParams): string | null {
  const c = playerCompany(w);
  if (!p.title.trim()) return 'Give your game a title.';
  if (p.platforms.length === 0) return 'Pick at least one platform.';
  for (const pl of p.platforms) {
    if (c.reputation < PLATFORMS[pl].minRep) return `${PLATFORMS[pl].name} requires reputation ${PLATFORMS[pl].minRep}.`;
  }
  const eng = ENGINES[p.engine];
  if (c.reputation < eng.minRep) return `${eng.name} requires reputation ${eng.minRep}.`;
  if (eng.research && !hasResearch(w, eng.research) && p.engine !== 'inhouse') return `${eng.name} requires ${RESEARCH[eng.research].name} research.`;
  if (MONETIZATIONS[p.monetization].upfront && !(p.price > 0)) return 'Set a price.';
  if (p.engine === 'inhouse' && !w.player.engine) return 'Found your engine first (Engine screen).';
  if (p.topic && !TOPIC_IDS.includes(p.topic)) return 'Pick a topic.';
  const upfront = upfrontCosts(w, p, true);
  if (upfront > c.cash) return `Licenses and dev kits cost $${upfront.toLocaleString()} up front.`;
  return null;
}

export function createGame(w: World, p: GameParams, teamIds: string[]): ActionResult {
  const err = validateGameParams(w, p);
  if (err) return fail(err);
  const c = playerCompany(w);
  if (p.ipId && (!w.ips[p.ipId] || w.ips[p.ipId].companyId !== c.id)) return fail('You do not own that IP.');
  const g = createGameRecord(w, c, { ...p, title: p.title.trim() }, true);
  addGame(w, g);
  const upfront = upfrontCosts(w, p, true);
  c.cash -= upfront;
  c.ledger.development += upfront;
  for (const id of teamIds) assignEmployee(w, id, g.id);
  const work = playerDailyWork(w, g);
  g.plannedDays = work > 0 ? g.workRequired / work : 0;
  pushNews(w, {
    kind: 'player',
    title: `${c.name} starts development on ${g.title}`,
    body: `${SCOPES[g.scope].name} ${GENRES[g.genre].name} for ${g.platforms.map((x) => PLATFORMS[x].name).join(', ')}.`,
    companyId: c.id,
    gameId: g.id,
    tone: 'neutral',
  });
  return ok(g.id);
}

export function assignEmployee(w: World, employeeId: string, gameId: string | null): ActionResult {
  const e = w.player.employees.find((x) => x.id === employeeId);
  if (!e) return fail('Employee not found.');
  if (gameId) {
    const g = ownGame(w, gameId);
    if (!g) return fail('Game not found.');
    if (!ROLES[e.role].dev) return fail(`${ROLES[e.role].plural} work company-wide, not on projects.`);
    if (g.status === 'released' && !g.update) return fail('Start an update first.');
    if (g.status !== 'development' && g.status !== 'released') return fail('That project is closed.');
  }
  e.assignment = gameId;
  return ok();
}

export function setFocus(w: World, gameId: string, focus: Focus): ActionResult {
  const g = ownGame(w, gameId);
  if (!g || g.status !== 'development') return fail('Not in development.');
  let t = 0;
  for (const k in focus) t += Math.max(0, focus[k as keyof Focus]);
  if (t <= 0) return fail('Invalid focus.');
  for (const k in focus) g.focus[k as keyof Focus] = Math.max(0, focus[k as keyof Focus]) / t;
  return ok();
}

export function setCrunch(w: World, gameId: string, on: boolean): ActionResult {
  const g = ownGame(w, gameId);
  if (!g || g.status !== 'development') return fail('Not in development.');
  g.crunch = on;
  if (!on) g.crunchDays = 0;
  return ok();
}

export function marketingEfficiency(w: World): number {
  let m = 1;
  let mk = 0;
  for (const e of w.player.employees) if (e.role === 'marketing') mk += e.skill / 50;
  m += Math.min(1, mk * 0.12);
  if (hasResearch(w, 'marketingData')) m *= 1.3;
  return m;
}

export function campaignHype(w: World, g: Game, id: CampaignId): number {
  const def = CAMPAIGNS[id];
  const c = playerCompany(w);
  const gain = def.hype * marketingEfficiency(w) * (1 + c.reputation / 150) * (1 + 0.12 * perkRank(w, 'marketing')) * Math.max(0.05, 1 - g.hype / 1400);
  return Math.max(0, Math.min(gain, 1400 - g.hype));
}

export function runCampaign(w: World, gameId: string, id: CampaignId): ActionResult {
  const g = ownGame(w, gameId);
  if (!g || (g.status !== 'development' && g.status !== 'released')) return fail('Game not found.');
  const def = CAMPAIGNS[id];
  const c = playerCompany(w);
  if (c.cash < def.cost) return fail('Not enough cash.');
  const gain = campaignHype(w, g, id);
  c.cash -= def.cost;
  c.ledger.marketing += def.cost;
  g.marketingSpent += def.cost;
  g.hype += gain;
  toast(w, `${def.name}: +${Math.round(gain)} hype for ${g.title}`, 'neutral', { category: 'game', link: { route: 'game', id: g.id }, silent: true });
  return ok();
}

export function releasePlayerGame(w: World, gameId: string): ActionResult {
  const g = ownGame(w, gameId);
  if (!g || g.status !== 'development') return fail('Not in development.');
  if (g.workDone < g.workRequired * 0.75) return fail('The game must be at least 75% complete to ship.');
  releaseGame(w, g);
  return ok();
}

export function cancelGame(w: World, gameId: string): ActionResult {
  const g = ownGame(w, gameId);
  if (!g || g.status !== 'development') return fail('Not in development.');
  cancelProject(w, g, 'the studio pulled the plug');
  return ok();
}

// ------------------------------------------------------------ live games

export function startUpdate(
  w: World,
  gameId: string,
  type: UpdateTypeId,
  teamIds: string[],
  extra: { platform?: PlatformId; monetization?: MonetizationId } = {},
): ActionResult {
  const g = ownGame(w, gameId);
  if (!g || g.status !== 'released') return fail('Game is not live.');
  if (g.update) return fail('An update is already in progress.');
  if (teamIds.length === 0) return fail('Assign at least one developer.');
  const c = playerCompany(w);
  if (type === 'port') {
    if (!extra.platform) return fail('Choose a platform.');
    if (g.platforms.includes(extra.platform)) return fail('Already on that platform.');
    if (c.reputation < PLATFORMS[extra.platform].minRep) return fail(`${PLATFORMS[extra.platform].name} requires reputation ${PLATFORMS[extra.platform].minRep}.`);
  }
  if (type === 'monetization' && !extra.monetization) return fail('Choose a business model.');
  if (type === 'expansion' && g.updates.filter((u) => u.type === 'expansion').length >= 4) return fail('Players are tired of expansions for this game.');
  const cost = updateCost(g, type, extra.platform);
  if (c.cash < cost) return fail('Not enough cash.');
  startUpdateRecord(w, g, c, type, teamIds, 0, extra);
  for (const id of teamIds) {
    const e = w.player.employees.find((x) => x.id === id);
    if (e && ROLES[e.role].dev) e.assignment = g.id;
  }
  return ok();
}

export function cancelUpdate(w: World, gameId: string): ActionResult {
  const g = ownGame(w, gameId);
  if (!g || (!g.update && g.updateQueue.length === 0)) return fail('No update in progress.');
  g.update = null;
  g.updateQueue = [];
  for (const e of w.player.employees) if (e.assignment === g.id) e.assignment = null;
  return ok();
}

function validateQueued(w: World, g: Game, item: QueuedUpdate): string | null {
  const c = playerCompany(w);
  if (item.type === 'port') {
    if (!item.platform) return 'Choose a platform for the port.';
    if (g.platforms.includes(item.platform)) return `Already on ${PLATFORMS[item.platform].name}.`;
    if (c.reputation < PLATFORMS[item.platform].minRep) return `${PLATFORMS[item.platform].name} requires reputation ${PLATFORMS[item.platform].minRep}.`;
  }
  if (item.type === 'monetization' && !item.monetization) return 'Choose a business model.';
  return null;
}

/**
 * Start one or more updates for a live game. The first starts now (or joins
 * the queue if one is running); the rest run back to back with the same team.
 */
export function queueUpdates(w: World, gameId: string, items: QueuedUpdate[], teamIds: string[]): ActionResult {
  const g = ownGame(w, gameId);
  if (!g || g.status !== 'released') return fail('Game is not live.');
  if (items.length === 0) return fail('Pick at least one update.');
  for (const it of items) {
    const err = validateQueued(w, g, it);
    if (err) return fail(err);
  }
  for (const id of teamIds) {
    const e = w.player.employees.find((x) => x.id === id);
    if (e && ROLES[e.role].dev) e.assignment = g.id;
  }
  if (g.update) {
    g.updateQueue.push(...items);
    return ok();
  }
  const team = w.player.employees.filter((e) => e.assignment === g.id).map((e) => e.id);
  if (team.length === 0) return fail('Assign at least one developer.');
  const [first, ...rest] = items;
  const res = startUpdate(w, gameId, first.type, team, { platform: first.platform, monetization: first.monetization });
  if (!res.ok) return res;
  g.updateQueue.push(...rest);
  return ok();
}

export function removeQueuedUpdate(w: World, gameId: string, index: number): ActionResult {
  const g = ownGame(w, gameId);
  if (!g || index < 0 || index >= g.updateQueue.length) return fail('Nothing to remove.');
  g.updateQueue.splice(index, 1);
  return ok();
}

export function setAutoUpdates(w: World, gameId: string, on: boolean): ActionResult {
  const g = ownGame(w, gameId);
  if (!g || g.status !== 'released') return fail('Game is not live.');
  g.autoUpdates = on;
  g.manualUpdates = !on;
  return ok();
}

/** Studio-wide live ops: auto-update every game, and hire a crew when developers are busy. */
export function setLiveOps(w: World, patch: Partial<LiveOpsSettings>): ActionResult {
  Object.assign(w.player.liveOps, patch);
  if (patch.auto) for (const g of Object.values(w.games)) if (g.companyId === w.player.companyId) g.manualUpdates = false;
  return ok();
}

export function setAutoAssign(w: World, on: boolean): ActionResult {
  w.player.autoAssign = on;
  return ok();
}

/** Put every idle developer, or every developer in the studio, on one game. */
export function assignDevs(w: World, gameId: string, who: 'idle' | 'everyone'): ActionResult {
  const g = ownGame(w, gameId);
  if (!g) return fail('Game not found.');
  if (g.status === 'released' && !g.update) return fail('Start an update first.');
  if (g.status !== 'development' && g.status !== 'released') return fail('That project is closed.');
  let moved = 0;
  for (const e of w.player.employees) {
    if (!ROLES[e.role].dev || e.assignment === g.id) continue;
    if (who === 'idle' && e.assignment) continue;
    e.assignment = g.id;
    moved++;
  }
  return moved > 0 ? ok() : fail(who === 'idle' ? 'Nobody is idle right now.' : 'Everyone is already on this game.');
}

export function setPrice(w: World, gameId: string, price: number): ActionResult {
  const g = ownGame(w, gameId);
  if (!g) return fail('Game not found.');
  if (!MONETIZATIONS[g.monetization].upfront) return fail('This game is free to play.');
  g.price = clamp(Math.round(price * 100) / 100, 0.99, 99.99);
  return ok();
}

export function startDiscount(w: World, gameId: string, pct: number, days: number): ActionResult {
  const g = ownGame(w, gameId);
  if (!g || g.status !== 'released') return fail('Game is not live.');
  if (!MONETIZATIONS[g.monetization].upfront) return fail('This game is free to play.');
  if (g.discountUntil > w.day) return fail('A sale is already running.');
  g.discount = clamp(pct, 0.1, 0.9);
  g.discountUntil = w.day + days;
  return ok();
}

export function shutdownServers(w: World, gameId: string): ActionResult {
  const g = ownGame(w, gameId);
  if (!g || g.status !== 'released') return fail('Game is not live.');
  for (const e of w.player.employees) if (e.assignment === g.id) e.assignment = null;
  shutdownGame(w, g, 'the studio ended support');
  return ok();
}

// ------------------------------------------------------------ staff

export function hire(w: World, candidateId: string): ActionResult {
  const k = w.player.candidates.find((x) => x.id === candidateId);
  if (!k) return fail('Candidate is no longer available.');
  const c = playerCompany(w);
  const cap = OFFICES[w.player.officeLevel].capacity;
  if (w.player.employees.length >= cap) return fail(`Your ${OFFICES[w.player.officeLevel].name} is full (${cap}). Move to a bigger office.`);
  const fee = recruitFee(w, k.salary);
  if (c.cash < fee) return fail(`Recruiting costs $${fee.toLocaleString()}.`);
  c.cash -= fee;
  c.ledger.salaries += fee;
  w.player.employees.push(makeEmployee(w, k));
  w.player.candidates = w.player.candidates.filter((x) => x.id !== candidateId);
  return ok();
}

export function fire(w: World, employeeId: string): ActionResult {
  const e = w.player.employees.find((x) => x.id === employeeId);
  if (!e) return fail('Employee not found.');
  if (e.isFounder) return fail('You cannot fire yourself.');
  const c = playerCompany(w);
  c.cash -= e.salary;
  c.ledger.salaries += e.salary;
  w.player.employees = w.player.employees.filter((x) => x.id !== employeeId);
  for (const o of w.player.employees) if (!o.isFounder) o.morale = Math.max(0, o.morale - 3);
  return ok();
}

export function giveRaise(w: World, employeeId: string): ActionResult {
  const e = w.player.employees.find((x) => x.id === employeeId);
  if (!e || e.isFounder) return fail('Not possible.');
  e.salary = Math.round(e.salary * 1.1);
  e.morale = Math.min(100, e.morale + 15);
  return ok();
}

export function trainingCost(w: World, employeeId: string): number {
  const e = w.player.employees.find((x) => x.id === employeeId);
  if (!e) return 0;
  return Math.round(Math.max(1500, (e.isFounder ? 4000 : e.salary) * 1.5 * (1 + Math.max(0, e.skill - 60) / 20)));
}

export function train(w: World, employeeId: string): ActionResult {
  const e = w.player.employees.find((x) => x.id === employeeId);
  if (!e) return fail('Employee not found.');
  if (e.skill >= 100) return fail('Already at maximum skill.');
  const c = playerCompany(w);
  const cost = trainingCost(w, employeeId);
  if (c.cash < cost) return fail('Not enough cash.');
  c.cash -= cost;
  c.ledger.misc += cost;
  const gain = e.skill < 60 ? randRange(w, 3, 6) : e.skill < 80 ? randRange(w, 2, 4) : randRange(w, 0.8, 2);
  e.skill = Math.min(100, e.skill + gain);
  e.morale = Math.min(100, e.morale + 5);
  return ok();
}

export function recruiterCost(w: World): number {
  return Math.round(2000 * (1 + playerCompany(w).reputation / 20));
}

export function paidRefresh(w: World): ActionResult {
  const c = playerCompany(w);
  const cost = recruiterCost(w);
  if (c.cash < cost) return fail('Not enough cash.');
  c.cash -= cost;
  c.ledger.misc += cost;
  refreshCandidates(w);
  return ok();
}

export function moveOffice(w: World, level: number): ActionResult {
  if (level < 0 || level >= OFFICES.length || level === w.player.officeLevel) return fail('Invalid office.');
  const target = OFFICES[level];
  if (w.player.employees.length > target.capacity) return fail(`Too many staff for a ${target.name}.`);
  const c = playerCompany(w);
  const cost = level > w.player.officeLevel ? target.moveCost : Math.round(target.moveCost * 0.25);
  if (c.cash < cost) return fail(`Moving costs $${cost.toLocaleString()}.`);
  c.cash -= cost;
  c.ledger.misc += cost;
  w.player.officeLevel = level;
  if (level >= 2) c.hq = target.name;
  pushNews(w, { kind: 'player', title: `${c.name} moves into a ${target.name}`, companyId: c.id, tone: 'good' });
  return ok();
}

export function startResearch(w: World, id: ResearchId): ActionResult {
  const r = w.player.research;
  if (r.active) return fail('Research already in progress.');
  if (r.completed.includes(id)) return fail('Already researched.');
  const def = RESEARCH[id];
  if (def.requires.some((q) => !r.completed.includes(q))) return fail(`Requires ${def.requires.map((q) => RESEARCH[q].name).join(', ')}.`);
  const c = playerCompany(w);
  if (c.reputation < def.minRep) return fail(`Requires reputation ${def.minRep}.`);
  if (c.cash < def.cost) return fail('Not enough cash.');
  c.cash -= def.cost;
  c.ledger.research += def.cost;
  r.active = { id, progress: 0, days: def.days };
  return ok();
}

// ------------------------------------------------------------ finance

export function takeLoanOffer(w: World, index: number): ActionResult {
  const c = playerCompany(w);
  const offer = loanOffers(w, c)[index];
  if (!offer) return fail('Offer unavailable.');
  const loan = financeTakeLoan(w, c, offer.amount, offer.months, offer.apr);
  pushNews(w, { kind: 'finance', title: `${c.name} borrows $${offer.amount.toLocaleString()} from ${loan.lender}`, body: `${(offer.apr * 100).toFixed(1)}% APR over ${offer.months} months.`, companyId: c.id, tone: 'neutral' });
  return ok();
}

export function repayLoan(w: World, loanId: string): ActionResult {
  const c = playerCompany(w);
  const l = c.loans.find((x) => x.id === loanId);
  if (!l) return fail('Loan not found.');
  if (c.cash < l.balance) return fail('Not enough cash to repay in full.');
  c.cash -= l.balance;
  c.loans = c.loans.filter((x) => x.id !== loanId);
  return ok();
}

export const FUNDING_ROUNDS = [
  { name: 'Seed', minRevenue: 0, minGames: 1, minRep: 3, equity: [0.1, 0.2], floor: 250000 },
  { name: 'Series A', minRevenue: 250000, minGames: 1, minRep: 12, equity: [0.12, 0.25], floor: 2e6 },
  { name: 'Series B', minRevenue: 2.5e6, minGames: 2, minRep: 22, equity: [0.1, 0.22], floor: 15e6 },
  { name: 'Series C', minRevenue: 15e6, minGames: 3, minRep: 30, equity: [0.08, 0.18], floor: 80e6 },
  { name: 'Growth Round', minRevenue: 60e6, minGames: 4, minRep: 40, equity: [0.05, 0.12], floor: 300e6 },
];

export function nextFundingRound(w: World) {
  return FUNDING_ROUNDS[w.player.fundingRoundsTaken] ?? null;
}

export function fundingBlocker(w: World): string | null {
  const c = playerCompany(w);
  if (c.isPublic) return 'Public companies raise money through share offerings.';
  const round = nextFundingRound(w);
  if (!round) return 'No more private rounds available — consider an IPO.';
  if (w.day - w.player.lastFundingDay < 120) return `Investors want to see progress first (${120 - (w.day - w.player.lastFundingDay)} days).`;
  if (w.player.stats.gamesReleased < round.minGames) return `Release at least ${round.minGames} game${round.minGames > 1 ? 's' : ''}.`;
  if (revenueTTM(c) < round.minRevenue) return `Needs $${round.minRevenue.toLocaleString()} trailing-12-month revenue.`;
  if (c.reputation < round.minRep) return `Needs reputation ${round.minRep}.`;
  return null;
}

export function pitchInvestors(w: World): ActionResult {
  const blocker = fundingBlocker(w);
  if (blocker) return fail(blocker);
  const c = playerCompany(w);
  const round = nextFundingRound(w)!;
  const count = randInt(w, 1, 3);
  w.player.fundingOffers = [];
  for (let i = 0; i < count; i++) {
    const preMoney = Math.max(round.floor * randRange(w, 0.8, 1.2), c.valuation * randomInvestorAppetite(w) * randRange(w, 0.85, 1.25)) * (1 + 0.08 * perkRank(w, 'deals'));
    const equity = randRange(w, round.equity[0], round.equity[1]);
    const amount = Math.round((preMoney * equity) / (1 - equity) / 1000) * 1000;
    w.player.fundingOffers.push({ id: newId(w, 'f'), investor: investorName(w), round: round.name, amount, equity, preMoney, expiresDay: w.day + 21 });
  }
  w.player.lastFundingDay = w.day;
  return ok();
}

export function acceptFunding(w: World, offerId: string): ActionResult {
  const o = w.player.fundingOffers.find((x) => x.id === offerId);
  if (!o) return fail('Offer expired.');
  if (o.expiresDay < w.day) return fail('Offer expired.');
  const c = playerCompany(w);
  const newShares = (c.shares * o.equity) / (1 - o.equity);
  c.shares += newShares;
  c.investorShares += newShares;
  c.cash += o.amount;
  c.ledger.other += 0;
  if (c.boardConfidence >= 100) c.boardConfidence = 70;
  w.player.fundingRoundsTaken += 1;
  w.player.fundingOffers = [];
  pushNews(w, { kind: 'finance', title: `${c.name} raises $${o.amount.toLocaleString()} ${o.round} from ${o.investor}`, body: `${(o.equity * 100).toFixed(1)}% equity at a $${Math.round(o.preMoney).toLocaleString()} pre-money valuation.`, companyId: c.id, tone: 'good' });
  return ok();
}

export function declineFunding(w: World): ActionResult {
  w.player.fundingOffers = [];
  return ok();
}

export function ipoBlocker(w: World): string | null {
  const c = playerCompany(w);
  if (c.isPublic) return 'Already public.';
  if (c.valuation < 50e6) return 'Needs a $50M valuation.';
  if (revenueTTM(c) < 10e6) return 'Needs $10M trailing revenue.';
  if (c.reputation < 35) return 'Needs reputation 35.';
  if (w.player.stats.gamesReleased < 3) return 'Needs at least 3 released games.';
  return null;
}

export function goPublic(w: World, floatFraction: number): ActionResult {
  const b = ipoBlocker(w);
  if (b) return fail(b);
  const c = playerCompany(w);
  ipoCompany(w, c, clamp(floatFraction, 0.1, 0.4));
  if (c.boardConfidence >= 100) c.boardConfidence = 70;
  return ok();
}

export function buyback(w: World, amount: number): ActionResult {
  const c = playerCompany(w);
  if (!c.isPublic) return fail('Only public companies can buy back shares.');
  if (amount <= 0 || amount > c.cash) return fail('Not enough cash.');
  const price = c.price * 1.03;
  const shares = Math.min(amount / price, floatShares(w, c) * 0.5);
  if (shares < 1) return fail('Nothing to buy back.');
  c.cash -= shares * price;
  c.shares -= shares;
  c.price *= 1 + Math.min(0.15, (shares / c.shares) * 0.5);
  pushNews(w, { kind: 'finance', title: `${c.name} buys back $${Math.round(shares * price).toLocaleString()} of stock`, companyId: c.id, tone: 'neutral' });
  return ok();
}

export function secondaryOffering(w: World, fraction: number): ActionResult {
  const c = playerCompany(w);
  if (!c.isPublic) return fail('Go public first.');
  const f = clamp(fraction, 0.01, 0.2);
  const newShares = c.shares * f;
  const price = c.price * 0.95;
  c.shares += newShares;
  c.cash += newShares * price * 0.97;
  c.price *= 1 - f * 0.4;
  pushNews(w, { kind: 'finance', title: `${c.name} raises $${Math.round(newShares * price).toLocaleString()} in a share offering`, companyId: c.id, tone: 'neutral' });
  return ok();
}

export function buyStock(w: World, targetId: string, shares: number): ActionResult {
  const t = w.companies[targetId];
  if (!t) return fail('Company not found.');
  if (t.id === w.player.companyId) return fail('Use a buyback for your own shares.');
  return buyShares(w, playerCompany(w), t, Math.floor(shares));
}

export function sellStock(w: World, targetId: string, shares: number): ActionResult {
  const t = w.companies[targetId];
  if (!t) return fail('Company not found.');
  return sellShares(w, playerCompany(w), t, Math.floor(shares));
}

export function acquisitionQuote(w: World, targetId: string): { price: number; blocker: string | null; note: string } {
  const p = playerCompany(w);
  const t = w.companies[targetId];
  if (!t || t.status !== 'active') return { price: 0, blocker: 'Not available.', note: '' };
  if (t.parentId) return { price: 0, blocker: t.parentId === p.id ? 'Already yours.' : `Owned by ${w.companies[t.parentId]?.name ?? 'another company'}.`, note: '' };
  let premium: number;
  let note: string;
  if (t.isPublic) {
    premium = 1.3;
    note = 'Tender offer at a 30% premium to market price.';
  } else if (t.distressDays > 30) {
    premium = 0.85;
    note = 'Distressed seller: they will take a discount.';
  } else {
    premium = t.strategy === 'indieArtisan' ? 1.8 : 1.4;
    note = t.strategy === 'indieArtisan' ? 'Independent founders demand a big premium.' : 'Founders want a 40% premium.';
  }
  const price = acquisitionPrice(w, p, t, premium);
  const blocker = price > p.cash ? `You need $${Math.round(price).toLocaleString()} in cash.` : null;
  return { price, blocker, note };
}

export function acquire(w: World, targetId: string): ActionResult {
  const q = acquisitionQuote(w, targetId);
  if (q.blocker) return fail(q.blocker);
  const t = w.companies[targetId];
  acquireCompany(w, playerCompany(w), t, q.price);
  return ok();
}

export function setSubsidiaryStrategy(w: World, subId: string, strategy: StrategyId): ActionResult {
  const s = w.companies[subId];
  if (!s || s.parentId !== w.player.companyId) return fail('Not your subsidiary.');
  s.strategy = strategy;
  return ok();
}

export function transferToSubsidiary(w: World, subId: string, amount: number): ActionResult {
  const s = w.companies[subId];
  const p = playerCompany(w);
  if (!s || s.parentId !== p.id) return fail('Not your subsidiary.');
  if (amount > 0) {
    if (p.cash < amount) return fail('Not enough cash.');
    p.cash -= amount;
    s.cash += amount;
  } else {
    const take = Math.min(-amount, Math.max(0, s.cash));
    s.cash -= take;
    p.cash += take;
  }
  return ok();
}

export function bidAuction(w: World, auctionId: string, amount: number): ActionResult {
  const a = w.auctions.find((x) => x.id === auctionId);
  if (!a || a.resolved) return fail('Auction closed.');
  if (amount < a.minBid) return fail(`Minimum bid is $${a.minBid.toLocaleString()}.`);
  if (amount > playerCompany(w).cash) return fail('You cannot bid more than your cash.');
  a.bids[w.player.companyId] = amount;
  return ok();
}

export function auctionEstimate(w: World, auctionId: string): number {
  const a = w.auctions.find((x) => x.id === auctionId);
  return a ? ipValue(w, a.ipId) : 0;
}

export function setAutoSupport(w: World, on: boolean): ActionResult {
  w.player.autoSupportSubsidiaries = on;
  return ok();
}

export function dismissTutorial(w: World): ActionResult {
  w.player.tutorialDismissed = true;
  return ok();
}

// ------------------------------------------------------------ derived info

export function playerNetWorth(w: World): number {
  const c = playerCompany(w);
  if (!c) return 0;
  const stake = c.shares > 0 ? c.founderShares / c.shares : 0;
  return stake * marketCap(c);
}

export function totalDebt(w: World): number {
  return debtOf(playerCompany(w));
}

export function marketSalary(role: Parameters<typeof salaryFor>[0], skill: number): number {
  return salaryFor(role, skill);
}

export function engineFor(w: World, id: Parameters<typeof engineStats>[1]) {
  return engineStats(w, id, true);
}

export type { Company };
