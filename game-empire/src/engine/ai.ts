// Autonomous AI studios. Every studio periodically looks at its finances, the
// market and its own catalogue, then decides what to build, whom to hire or
// fire, which games to support, whether to borrow, go public or buy rivals.
// Nothing is scripted: outcomes emerge from these decisions meeting the market.
import { rivalQualityBoost } from './empire';
import {
  DIFFICULTIES,
  GENRES,
  GENRE_IDS,
  MONETIZATIONS,
  PLATFORMS,
  SCOPES,
  SCOPE_IDS,
  STRATEGIES,
  UPDATES,
  audienceFit,
  artFit,
  focus,
  AUDIENCE_IDS,
  ART_STYLE_IDS,
  MAX_ACTIVE_STUDIOS,
  STRATEGY_IDS,
  INSOLVENCY_GRACE_DAYS,
} from './constants';
import { adoptionChance, chargeLicenseFee } from './studioEngine';
import { aiPickTopic } from './topics';
import { aiDevDay, createGameRecord, estimateWork, recommendedBudget, releaseGame, upfrontCosts, type GameParams } from './development';
import { aiAvgSalary, aiSizeFactor, borrowingLimit, debtOf, monthlyBurn, recentRevenue, revenueTTM, takeLoan, creditRisk, computeValuation } from './finance';
import { compactDeadHistory, genreTrend } from './market';
import { cityName, gameTitle, personName, sequelTitle, studioName, STUDIO_COLORS } from './names';
import { chance, pick, rand, randInt, randNormal, randRange, weightedPick } from './rng';
import { acquireCompany, ipoCompany } from './stocks';
import { startUpdateRecord } from './updates';
import type {
  ArtStyleId,
  AudienceId,
  Company,
  EngineId,
  Focus,
  Game,
  GenreId,
  MonetizationId,
  MultiplayerId,
  PlatformId,
  ScopeId,
  StrategyId,
  UpdateTypeId,
  World,
} from './types';
import { activeCompanies, addGame, clamp, emptyLedger, gamesOf, newId, pushNews } from './util';

// ------------------------------------------------------------ helpers

export function allocatedStaff(w: World, c: Company): number {
  let n = 0;
  for (const g of gamesOf(w, c.id)) {
    if (g.status === 'development') n += g.aiTeam;
    if (g.update) n += g.update.aiTeam;
  }
  return n;
}

function liveOpsReserve(w: World, c: Company): number {
  let live = 0;
  for (const g of gamesOf(w, c.id)) if (g.status === 'released' && g.active > 1000) live++;
  return Math.ceil(live * Math.max(1, c.headcount * 0.01));
}

function companyDevGames(w: World, c: Company): Game[] {
  return gamesOf(w, c.id).filter((g) => g.status === 'development');
}

function companyLiveGames(w: World, c: Company): Game[] {
  return gamesOf(w, c.id).filter((g) => g.status === 'released');
}

export function aiQualityMult(w: World, c: Company): number {
  return STRATEGIES[c.strategy].quality * DIFFICULTIES[w.difficulty].aiQuality;
}

/** AI allocation of effort: ideal genre weights distorted by inexperience. */
export function aiFocus(w: World, genre: GenreId, talent: number): Focus {
  const ideal = GENRES[genre].ideal;
  const err = clamp(0.55 - talent / 200, 0.08, 0.5);
  return focus(
    ideal.gameplay * Math.max(0.2, 1 + randNormal(w, 0, err)),
    ideal.graphics * Math.max(0.2, 1 + randNormal(w, 0, err)),
    ideal.story * Math.max(0.2, 1 + randNormal(w, 0, err)),
    ideal.audio * Math.max(0.2, 1 + randNormal(w, 0, err)),
    ideal.tech * Math.max(0.2, 1 + randNormal(w, 0, err)),
    ideal.content * Math.max(0.2, 1 + randNormal(w, 0, err)),
  );
}

function genreSaturation(w: World, genre: GenreId): number {
  let n = 0;
  for (const id in w.games) {
    const g = w.games[id];
    if (g.genre !== genre) continue;
    if (g.status === 'development') n += 0.6;
    else if (g.status === 'released' && g.releaseDay !== null && w.day - g.releaseDay < 365) n += 1;
  }
  return n;
}

// ------------------------------------------------------------ concept choice

export function chooseConcept(w: World, c: Company, scope: ScopeId): GameParams {
  const strat = STRATEGIES[c.strategy];
  const sIdx = SCOPE_IDS.indexOf(scope);

  // sequel?
  let ipId: string | undefined;
  let genre: GenreId | undefined;
  const ownIps = Object.values(w.ips).filter((ip) => ip.companyId === c.id && ip.fans > 20000);
  if (ownIps.length > 0 && chance(w, 0.4)) {
    const ip = weightedPick(w, ownIps, ownIps.map((i) => i.fans));
    const last = ip.games.map((id) => w.games[id]).filter(Boolean).sort((a, b) => b.createdDay - a.createdDay)[0];
    const busy = ip.games.some((id) => w.games[id]?.status === 'development');
    if (last && !busy && (last.releaseDay === null || w.day - last.releaseDay > 300) && SCOPE_IDS.indexOf(last.scope) <= sIdx + 1) {
      ipId = ip.id;
      genre = last.genre;
    }
  }

  if (!genre) {
    const candidates = GENRE_IDS.filter((gid) => SCOPE_IDS.indexOf(GENRES[gid].minScope) <= sIdx && !(gid === 'indie' && sIdx > 2));
    const weights = candidates.map((gid) => {
      const trend = genreTrend(w, gid);
      const spec = c.specialties.includes(gid) ? 1.8 : 1;
      const xp = 1 + Math.min(0.6, (c.genreXp[gid] ?? 0) * 0.1);
      const sat = 1 / (1 + genreSaturation(w, gid) * 0.08);
      return Math.pow(trend, 1 + 3 * strat.trend) * spec * xp * sat * GENRES[gid].interest * randRange(w, 0.6, 1.4);
    });
    genre = weightedPick(w, candidates, weights);
  }

  // multiplayer
  const mpOpts: MultiplayerId[] = ['single', 'localCoop', 'online', 'massive'];
  const mpWeights = mpOpts.map((m) => {
    let wt = Math.pow(GENRES[genre!].mp[m], 6);
    if (m === 'massive' && sIdx < 3) wt *= 0.05;
    if (m === 'online' && sIdx < 1) wt *= 0.3;
    return wt;
  });
  const multiplayer = weightedPick(w, mpOpts, mpWeights);

  // audience
  const audience = weightedPick<AudienceId>(
    w,
    AUDIENCE_IDS,
    AUDIENCE_IDS.map((a) => Math.pow(audienceFit(a, genre!), 5) * (a === 'everyone' ? 0.8 : 1)),
  );

  // art
  const artWeights = ART_STYLE_IDS.map((a: ArtStyleId) => {
    let wt = Math.pow(artFit(a, genre!), 4);
    if ((a === 'realistic' || a === 'photoreal') && sIdx < 3) wt *= 0.15;
    if (a === 'photoreal' && sIdx < 4) wt *= 0.3;
    if ((a === 'pixel' || a === 'lowPoly' || a === 'handDrawn') && sIdx >= 3) wt *= 0.1;
    return wt;
  });
  const artStyle = weightedPick(w, ART_STYLE_IDS, artWeights);

  // platforms
  const platforms: PlatformId[] = [];
  const platOpts: PlatformId[] = ['pc', 'console', 'mobile', 'handheld', 'vr', 'cloud'];
  const ranked = platOpts
    .filter((p) => c.reputation >= PLATFORMS[p].minRep)
    .map((p) => ({ p, s: w.market.platforms[p].users * (PLATFORMS[p].affinity[genre!] ?? 1) * PLATFORMS[p].spend * randRange(w, 0.7, 1.3) }))
    .sort((a, b) => b.s - a.s);
  const count = clamp(1 + Math.floor(sIdx * 0.7 + rand(w) * 1.5), 1, 4);
  for (const r of ranked) {
    if (platforms.length >= count) break;
    if (r.p === 'mobile' && c.strategy !== 'monetizer' && sIdx >= 3 && !chance(w, 0.35)) continue;
    platforms.push(r.p);
  }
  if (platforms.length === 0) platforms.push('pc');

  // monetization
  const monOpts = Object.keys(MONETIZATIONS) as MonetizationId[];
  const monWeights = monOpts.map((m) => {
    let wt = strat.monetization[m] ?? 0.2;
    if (genre === 'battleRoyale' && (m === 'f2pCosmetic' || m === 'f2pAggressive')) wt *= 5;
    if (genre === 'mmorpg' && (m === 'subscription' || m === 'f2pCosmetic')) wt *= 4;
    if (m === 'subscription' && genre !== 'mmorpg') wt *= 0.05;
    if (m === 'ads' && !platforms.includes('mobile')) wt *= 0.02;
    if (platforms.includes('mobile') && !MONETIZATIONS[m].upfront) wt *= 2.5;
    if ((m === 'f2pCosmetic' || m === 'f2pAggressive') && multiplayer === 'single') wt *= 0.25;
    if (audience === 'kids' && m === 'f2pAggressive') wt *= 0.4;
    return wt;
  });
  const monetization = weightedPick(w, monOpts, monWeights);

  // engine: your subsidiaries use your engine for free; rivals may license it
  let engine: EngineId;
  if (sIdx >= 4) engine = c.reputation >= 35 && chance(w, 0.65) ? 'apex' : 'titan';
  else if (sIdx >= 2) engine = chance(w, 0.6) ? 'titan' : 'nimbus';
  else engine = artStyle === 'pixel' && multiplayer !== 'massive' ? 'pixelforge' : chance(w, 0.5) ? 'nimbus' : 'titan';
  if (w.player.engine && c.parentId === w.player.companyId) engine = 'inhouse';
  else if (w.player.engine?.licensing && chance(w, adoptionChance(w, c, scope))) engine = 'inhouse';
  const topic = aiPickTopic(w, genre);

  const price = MONETIZATIONS[monetization].upfront ? priceFor(scope, w) : 0;
  const rec = recommendedBudget(scope, artStyle, platforms);
  const budget = rec * randRange(w, 0.6, 1.4) * strat.quality;

  let title: string;
  if (ipId) {
    const ip = w.ips[ipId];
    title = sequelTitle(w, ip.name, ip.games.length + 1);
  } else {
    title = gameTitle(w, genre);
  }

  return {
    title,
    genre,
    platforms,
    audience,
    engine,
    monetization,
    price,
    artStyle,
    multiplayer,
    scope,
    budget,
    focus: aiFocus(w, genre, c.talent),
    ipId,
    topic,
  };
}

function priceFor(scope: ScopeId, w: World): number {
  const base = SCOPES[scope].price;
  const options = [base - 5, base, base + 5, base + 10].filter((p) => p > 0);
  return Math.max(0.99, Math.round(pick(w, options)) - 0.01);
}

// ------------------------------------------------------------ project start

function projectCostEstimate(c: Company, scope: ScopeId, team: number, w: World, params?: GameParams): number {
  const days = params ? estimateWork(w, params, false) / Math.max(1, team * Math.pow(c.talent / 50, 0.8)) : 365;
  return team * (c.avgSalary + 1100) * (days / 30) * 0.6 + (params ? params.budget : SCOPES[scope].budget);
}

function startProject(w: World, c: Company, idle: number): boolean {
  const strat = STRATEGIES[c.strategy];
  const cash = c.cash;
  const monthlyRev = recentRevenue(c, 3) / 3;
  // biggest scope the studio can staff and afford
  let chosen: ScopeId | null = null;
  for (let i = SCOPE_IDS.length - 1; i >= 0; i--) {
    const s = SCOPE_IDS[i];
    const team = SCOPES[s].typicalTeam;
    if (idle < team * 0.55) continue;
    if (c.strategy === 'indieArtisan' && i > 2) continue;
    if (s === 'mega' && (c.headcount < 2500 || companyDevGames(w, c).some((g) => g.scope === 'mega') || !chance(w, 0.3))) continue;
    const cost = projectCostEstimate(c, s, Math.min(idle, team), w);
    const affordable = cash * (0.5 + strat.risk * 0.6) + monthlyRev * 10 * strat.risk;
    if (cost <= affordable) {
      chosen = s;
      break;
    }
  }
  if (!chosen) return false;
  // occasionally pick one scope smaller for variety
  if (SCOPE_IDS.indexOf(chosen) > 0 && chance(w, 0.25)) chosen = SCOPE_IDS[SCOPE_IDS.indexOf(chosen) - 1];

  let params = chooseConcept(w, c, chosen);
  // staff the project so it ships in a sensible time; downscale if impossible
  const speed = Math.pow(c.talent / 50, 0.8) * 1.05;
  let team = 0;
  for (let guard = 0; guard < 4; guard++) {
    const work = estimateWork(w, params, false);
    const maxTeam = SCOPES[params.scope].maxTeam;
    const wanted = Math.ceil(work / (520 * speed));
    team = Math.max(1, Math.min(idle, maxTeam, Math.max(Math.round(SCOPES[params.scope].typicalTeam * 0.75), wanted)));
    const days = work / Math.max(0.5, team * speed);
    if (days <= 820 || SCOPE_IDS.indexOf(params.scope) === 0) break;
    const smaller = SCOPE_IDS[SCOPE_IDS.indexOf(params.scope) - 1];
    params = chooseConcept(w, c, smaller);
  }
  const upfront = upfrontCosts(w, params, false);
  if (upfront > c.cash * 0.5) params.engine = 'titan';
  if (params.engine === 'inhouse' && c.parentId !== w.player.companyId && (w.player.engine?.fee ?? 0) > c.cash * 0.3) params.engine = 'titan';
  const g = createGameRecord(w, c, params, false);
  if (g.engine === 'inhouse') chargeLicenseFee(w, c, g);
  g.aiTeam = team;
  g.aiTalent = c.talent;
  g.plannedDays = g.workRequired / Math.max(0.5, team * speed);
  addGame(w, g);
  c.cash -= upfrontCosts(w, params, false);
  if (SCOPE_IDS.indexOf(g.scope) >= 4 || (g.sequelNo > 1 && w.ips[g.ipId].fans > 1e6)) {
    pushNews(w, {
      kind: 'industry',
      title: `${c.name} announces ${g.title}`,
      body: `A ${SCOPES[g.scope].name} ${GENRES[g.genre].name} project${g.sequelNo > 1 ? ' and sequel in a beloved franchise' : ''}.`,
      companyId: c.id,
      gameId: g.id,
      tone: 'neutral',
    });
  }
  return true;
}

// ------------------------------------------------------------ live ops

function aiLiveOps(w: World, c: Company, idleRef: { idle: number }): void {
  const strat = STRATEGIES[c.strategy];
  for (const g of companyLiveGames(w, c)) {
    const age = w.day - (g.releaseDay ?? w.day);
    const online = g.multiplayer === 'online' || g.multiplayer === 'massive';
    // shut down money-losing online games
    if (online && age > 120 && g.rev30 < g.cost30 * 1.15 && !g.update) {
      shutdownGame(w, g, 'unprofitable');
      continue;
    }
    if (online && age > 200 && g.active < 200) {
      shutdownGame(w, g, 'player base evaporated');
      continue;
    }
    if (g.update) continue;
    if (g.active < 3000 && !online) continue;
    const since = w.day - g.lastUpdateDay;
    let type: UpdateTypeId | null = null;
    const density = (g.bugs / Math.max(1, g.workRequired)) * 100;
    if (density > 4 && since > 10) type = 'hotfix';
    else if (since > strat.updateEvery * randRange(w, 0.8, 1.3)) {
      const bigEnough = SCOPE_IDS.indexOf(g.scope) >= 2;
      if (bigEnough && age > 300 && g.criticScore > 70 && chance(w, 0.25) && g.updates.filter((u) => u.type === 'expansion').length < 3) type = 'expansion';
      else if (!MONETIZATIONS[g.monetization].upfront && chance(w, 0.5)) type = 'seasonal';
      else if (chance(w, 0.15)) type = 'balance';
      else type = 'content';
    }
    if (!type) continue;
    // only bother if the game still matters
    if (g.rev30 < 2000 && type !== 'hotfix') continue;
    const team = Math.max(1, Math.round(Math.min(idleRef.idle, SCOPES[g.scope].typicalTeam * (type === 'expansion' ? 0.5 : 0.2))));
    if (team < 1 || idleRef.idle < 1) continue;
    const def = UPDATES[type];
    const cost = g.budget * def.costFrac;
    if (cost > c.cash * 0.3) continue;
    startUpdateRecord(w, g, c, type, [], team);
    idleRef.idle -= team;
  }

  // retire dead offline games' discounts: run a sale on aging premium games
  for (const g of companyLiveGames(w, c)) {
    if (!MONETIZATIONS[g.monetization].upfront) continue;
    const age = w.day - (g.releaseDay ?? w.day);
    if (age > 150 && g.discountUntil < w.day && chance(w, 0.06)) {
      g.discount = pick(w, [0.25, 0.4, 0.5, 0.6, 0.75]);
      g.discountUntil = w.day + 10;
    }
  }
}

export function shutdownGame(w: World, g: Game, reason: string): void {
  g.status = 'shutdown';
  compactDeadHistory(g);
  g.shutdownDay = w.day;
  g.active = 0;
  g.ccu = 0;
  g.update = null;
  const c = w.companies[g.companyId];
  if (g.peakCcu > 50000 || c.isPlayer) {
    pushNews(w, {
      kind: c.isPlayer ? 'player' : 'industry',
      title: `${c.name} shuts down ${g.title} servers`,
      body: reason ? `Reason: ${reason}.` : undefined,
      companyId: c.id,
      gameId: g.id,
      tone: c.isPlayer ? 'neutral' : 'bad',
    });
  }
}

// ------------------------------------------------------------ staffing

function aiStaffing(w: World, c: Company): void {
  const strat = STRATEGIES[c.strategy];
  const monthlyRev = Math.max(recentRevenue(c, 3) / 3, c.rev30);
  const perHead = c.avgSalary + 1100 * aiSizeFactor(c.headcount);
  const burn = monthlyBurn(w, c);
  const net = monthlyRev - burn;
  const runway = net >= 0 ? Infinity : c.cash / -net;

  if ((runway < 3 || (runway < 9 && burn > monthlyRev * 1.25)) && c.headcount > 2) {
    // layoffs
    const frac = runway < 1.5 ? randRange(w, 0.2, 0.35) : randRange(w, 0.08, 0.18);
    const cut = Math.max(1, Math.floor(c.headcount * frac));
    c.headcount = Math.max(1, c.headcount - cut);
    c.talent = clamp(c.talent - randRange(w, 0, 2), 15, 95);
    trimTeams(w, c);
    if (cut >= 50) {
      pushNews(w, { kind: 'industry', title: `${c.name} lays off ${cut.toLocaleString()} staff`, body: 'Cash is running short as costs outpace revenue.', companyId: c.id, tone: 'bad' });
    }
    return;
  }

  // sustainable payroll: a share of revenue plus a slice of the war chest
  const sustainable = (monthlyRev * 0.3) / perHead;
  const warChest = (c.cash / 48 / perHead) * strat.risk;
  const desired = Math.max(2, sustainable * strat.hiring + warChest);
  if (desired > c.headcount * 1.03 && runway > 6) {
    const maxStep = Math.ceil(c.headcount * 0.025 * strat.hiring) + 1;
    const hire = Math.min(maxStep, Math.ceil(desired - c.headcount));
    if (hire > 0) {
      // new hires pull talent toward the market average
      const marketTalent = 45 + c.reputation * 0.3;
      c.talent = (c.talent * c.headcount + marketTalent * hire) / (c.headcount + hire);
      c.headcount += hire;
    }
  } else if (desired < c.headcount * 0.7 && runway < 12 && c.headcount > 4) {
    // gradual attrition when the studio is too big for its revenue
    c.headcount = Math.max(2, Math.floor(c.headcount * 0.97));
    trimTeams(w, c);
  }
  // talent drift: reputation attracts better people
  const targetTalent = clamp(38 + c.reputation * 0.38 + (strat.quality - 1) * 40, 25, 92);
  c.talent = clamp(c.talent + (targetTalent - c.talent) * 0.01, 15, 95);
  c.avgSalary = aiAvgSalary(c.talent, c.headcount);
}

function trimTeams(w: World, c: Company): void {
  let allocated = allocatedStaff(w, c);
  if (allocated <= c.headcount) return;
  const ratio = c.headcount / allocated;
  for (const g of companyDevGames(w, c)) g.aiTeam = Math.max(1, Math.floor(g.aiTeam * ratio));
  allocated = allocatedStaff(w, c);
  // cancel weakest project if still overallocated
  if (allocated > c.headcount) {
    const devs = companyDevGames(w, c).sort((a, b) => a.workDone / a.workRequired - b.workDone / b.workRequired);
    if (devs[0]) cancelProject(w, devs[0], 'cost cutting');
  }
}

export function cancelProject(w: World, g: Game, reason: string, quiet = false): void {
  g.status = 'cancelled';
  g.aiTeam = 0;
  g.team = [];
  const c = w.companies[g.companyId];
  for (const e of w.player.employees) if (e.assignment === g.id) e.assignment = null;
  if (!quiet && (g.budgetSpent > 2e6 || c.isPlayer)) {
    pushNews(w, { kind: c.isPlayer ? 'player' : 'industry', title: `${c.name} cancels ${g.title}`, body: `Reason: ${reason}.`, companyId: c.id, gameId: g.id, tone: 'bad' });
  }
}

// ------------------------------------------------------------ finance decisions

function aiFinance(w: World, c: Company): void {
  const strat = STRATEGIES[c.strategy];
  const burn = monthlyBurn(w, c);
  const monthlyRev = Math.max(recentRevenue(c, 3) / 3, c.rev30);

  // borrow when cash is short
  if (c.cash < burn * 2 && !c.parentId) {
    const limit = borrowingLimit(w, c);
    if (limit > burn * 0.5) {
      const amount = Math.min(limit * 0.6, burn * 6);
      const risk = creditRisk(w, c);
      takeLoan(w, c, amount, 36, w.market.baseRate + risk);
      if (amount > 5e6) pushNews(w, { kind: 'finance', title: `${c.name} takes on $${(amount / 1e6).toFixed(0)}M in debt`, companyId: c.id, tone: 'neutral' });
    } else if (!c.isPublic && c.valuation > 2e6 && chance(w, 0.5)) {
      // raise venture money: dilutes founders
      const raise = Math.min(c.valuation * 0.25, burn * 12);
      const equity = raise / (c.valuation + raise);
      const newShares = (c.shares * equity) / (1 - equity);
      c.shares += newShares;
      c.investorShares += newShares;
      c.cash += raise;
      if (raise > 10e6) pushNews(w, { kind: 'finance', title: `${c.name} raises $${(raise / 1e6).toFixed(0)}M from investors`, companyId: c.id, tone: 'neutral' });
    }
  }

  // repay debt when flush
  if (c.loans.length > 0 && c.cash > burn * 12) {
    const loan = c.loans[0];
    const pay = Math.min(loan.balance, c.cash - burn * 8);
    if (pay > 0) {
      loan.balance -= pay;
      c.cash -= pay;
      if (loan.balance < 1) c.loans.shift();
    }
  }

  // IPO
  const rev = revenueTTM(c);
  if (!c.isPublic && !c.parentId && c.valuation > 350e6 && rev > 60e6 && chance(w, 0.04 * strat.ipo)) {
    ipoCompany(w, c);
  }

  // acquisitions
  if (!c.parentId && c.cash > 40e6 && chance(w, 0.006 * strat.acquisitive) && monthlyRev > burn * 0.8) {
    const targets = activeCompanies(w).filter(
      (t) => t.id !== c.id && !t.isPlayer && !t.parentId && t.valuation > 0 && t.valuation < c.cash * 0.6 && (t.isPublic ? t.price * t.shares < c.cash * 0.6 : true),
    );
    if (targets.length > 0) {
      const scores = targets.map((t) => {
        const distress = t.distressDays > 30 ? 2 : 1;
        const quality = 1 + t.reputation / 50;
        const synergy = t.specialties.some((s) => c.specialties.includes(s)) ? 1.3 : 1;
        return distress * quality * synergy * (t.strategy === 'indieArtisan' ? 0.4 : 1);
      });
      const target = weightedPick(w, targets, scores);
      const premium = target.distressDays > 30 ? randRange(w, 0.7, 1.0) : randRange(w, 1.15, 1.5);
      const base = target.isPublic ? target.price * target.shares : target.valuation;
      const price = base * premium;
      const willing = target.distressDays > 30 || chance(w, target.isPublic ? 0.7 : 0.45);
      if (willing && price < c.cash * 0.7) acquireCompany(w, c, target, price);
    }
  }
}

// ------------------------------------------------------------ the decision loop

export function aiDecide(w: World, c: Company): void {
  c.lastDecisionDay = w.day;
  aiStaffing(w, c);
  if (c.status !== 'active') return;
  const allocated = allocatedStaff(w, c);
  const idleRef = { idle: Math.max(0, c.headcount - allocated - liveOpsReserve(w, c)) };
  aiLiveOps(w, c, idleRef);

  const devs = companyDevGames(w, c);
  const maxProjects = Math.min(12, 1 + Math.floor(c.headcount / 120));
  if (devs.length < maxProjects && idleRef.idle >= 1) {
    if (startProject(w, c, idleRef.idle)) idleRef.idle = Math.max(0, c.headcount - allocatedStaff(w, c));
  }
  // top up understaffed projects
  for (const g of devs) {
    const want = SCOPES[g.scope].typicalTeam;
    if (g.aiTeam < want && idleRef.idle > 0) {
      const add = Math.min(idleRef.idle, want - g.aiTeam);
      g.aiTeam += add;
      idleRef.idle -= add;
    }
  }
  aiFinance(w, c);
}

/** Daily AI work: development progress, marketing beats and releases. */
export function aiDaily(w: World, c: Company): void {
  const qm = aiQualityMult(w, c) * rivalQualityBoost(w);
  const strat = STRATEGIES[c.strategy];
  for (const g of gamesOf(w, c.id)) {
    if (g.status !== 'development' || g.aiTeam <= 0) continue;
    aiDevDay(w, g, c, qm);
    const progress = g.workDone / g.workRequired;
    // marketing beats at 50% and 85%
    const beats = [0.5, 0.85];
    if (g.aiMarketingStage < beats.length && progress >= beats[g.aiMarketingStage]) {
      const spendAmt = Math.min(c.cash * 0.15, g.budget * (0.18 + 0.12 * strat.risk));
      if (spendAmt > 0) {
        c.cash -= spendAmt;
        c.ledger.marketing += spendAmt;
        g.marketingSpent += spendAmt;
        g.hype += hypeFromSpend(spendAmt, g.hype, 1 + c.reputation / 150);
      }
      g.aiMarketingStage += 1;
    }
    const polish = strat.quality > 1.05 ? 0.12 : strat.risk > 0.75 ? 0.0 : 0.05;
    if (g.workDone >= g.workRequired * (1 + polish)) releaseGame(w, g);
  }
}

export const HYPE_CAP = 1400;

export function hypeFromSpend(amount: number, currentHype: number, efficiency: number): number {
  const raw = 9 * Math.pow(amount / 1000, 0.55) * efficiency;
  const gain = raw * Math.max(0.05, 1 - currentHype / HYPE_CAP);
  return Math.max(0, Math.min(gain, HYPE_CAP - currentHype));
}

// ------------------------------------------------------------ distress & bankruptcy

export function aiSolvency(w: World, c: Company): void {
  if (c.cash < 0) {
    c.insolventDays += 1;
    c.distressDays += 1;
    if (c.parentId) {
      const parent = w.companies[c.parentId];
      if (parent && parent.cash > -c.cash * 2 && (!parent.isPlayer || w.player.autoSupportSubsidiaries)) {
        const amt = -c.cash + monthlyBurn(w, c);
        parent.cash -= amt;
        c.cash += amt;
        c.insolventDays = 0;
        return;
      }
    }
    if (c.insolventDays > INSOLVENCY_GRACE_DAYS) declareBankruptcy(w, c);
  } else {
    c.insolventDays = 0;
    const burn = monthlyBurn(w, c);
    if (c.cash < burn * 2) c.distressDays += 1;
    else c.distressDays = Math.max(0, c.distressDays - 2);
  }
}

export function declareBankruptcy(w: World, c: Company): void {
  c.status = 'bankrupt';
  c.endDay = w.day;
  const laidOff = c.headcount;
  c.headcount = 0;
  for (const g of companyDevGames(w, c)) cancelProject(w, g, 'studio bankruptcy', true);
  const valuableIps = Object.values(w.ips).filter((ip) => ip.companyId === c.id && ip.fans > 5000);
  for (const g of companyLiveGames(w, c)) {
    const hasAuction = valuableIps.some((ip) => ip.id === g.ipId);
    if (!hasAuction) shutdownGame(w, g, '');
  }
  for (const ip of valuableIps) {
    w.auctions.push({
      id: newId(w, 'a'),
      ipId: ip.id,
      ipName: ip.name,
      fromCompany: c.name,
      minBid: Math.max(10000, Math.round(ip.fans * 1.5)),
      endsDay: w.day + 21,
      bids: {},
      resolved: false,
    });
  }
  if (c.isPublic) c.price = Math.max(0.01, c.price * 0.05);
  w.market.talentSurgeUntil = Math.max(w.market.talentSurgeUntil, w.day + 60);
  pushNews(w, {
    kind: 'industry',
    title: `${c.name} files for bankruptcy`,
    body: `${laidOff.toLocaleString()} employees lose their jobs.${valuableIps.length ? ` ${valuableIps.length} IP${valuableIps.length > 1 ? 's go' : ' goes'} to auction.` : ''} Talented developers flood the job market.`,
    companyId: c.id,
    tone: 'major',
  });
}

// ------------------------------------------------------------ studio generation

export interface StudioTier {
  cash: [number, number];
  headcount: [number, number];
  talent: [number, number];
  reputation: [number, number];
  publicChance: number;
}

export const TIERS: Record<'mega' | 'large' | 'mid' | 'small' | 'indie', StudioTier> = {
  mega: { cash: [1.5e9, 7e9], headcount: [2500, 9000], talent: [62, 78], reputation: [65, 88], publicChance: 1 },
  large: { cash: [1.2e8, 9e8], headcount: [350, 1800], talent: [55, 72], reputation: [45, 75], publicChance: 0.6 },
  mid: { cash: [6e6, 7e7], headcount: [40, 300], talent: [48, 68], reputation: [25, 60], publicChance: 0.1 },
  small: { cash: [6e5, 6e6], headcount: [8, 40], talent: [42, 66], reputation: [10, 40], publicChance: 0 },
  indie: { cash: [4e4, 6e5], headcount: [2, 8], talent: [38, 70], reputation: [0, 22], publicChance: 0 },
};

export function makeStudio(w: World, tier: keyof typeof TIERS, taken: Set<string>, strategy?: StrategyId): Company {
  const t = TIERS[tier];
  const strat: StrategyId =
    strategy ??
    weightedPick<StrategyId>(
      w,
      STRATEGY_IDS,
      tier === 'indie' || tier === 'small' ? [1, 2, 1, 4, 0.2, 1.5] : tier === 'mega' ? [2, 2, 2, 0, 4, 1] : [2, 2, 2, 0.5, 1.5, 2],
    );
  const specialties: GenreId[] = [];
  const nSpec = randInt(w, 1, 3);
  while (specialties.length < nSpec) {
    const g = pick(w, GENRE_IDS);
    if (!specialties.includes(g)) specialties.push(g);
  }
  const talent = randRange(w, t.talent[0], t.talent[1]);
  const shares = tier === 'mega' ? randInt(w, 200, 900) * 1e6 : tier === 'large' ? randInt(w, 40, 200) * 1e6 : 10e6;
  const founderFrac = tier === 'mega' ? randRange(w, 0.05, 0.2) : tier === 'large' ? randRange(w, 0.15, 0.45) : randRange(w, 0.45, 1);
  const c: Company = {
    id: newId(w, 'c'),
    name: studioName(w, taken),
    isPlayer: false,
    founded: w.day - randInt(w, 200, tier === 'mega' ? 12000 : 4000),
    strategy: strat,
    specialties,
    color: pick(w, STUDIO_COLORS),
    ceo: personName(w),
    hq: cityName(w),
    status: 'active',
    parentId: null,
    endDay: null,
    reputation: randRange(w, t.reputation[0], t.reputation[1]),
    fans: 0,
    cash: randRange(w, t.cash[0], t.cash[1]),
    loans: [],
    headcount: Math.round(randRange(w, t.headcount[0], t.headcount[1])),
    talent,
    avgSalary: 0,
    genreXp: Object.fromEntries(specialties.map((s) => [s, randRange(w, 1, 6)])),
    isPublic: false,
    shares,
    founderShares: shares * founderFrac,
    investorShares: shares * (1 - founderFrac),
    price: 0,
    ipoDay: null,
    priceHistory: [],
    valuation: 0,
    valuationHistory: [],
    expectedQuarter: 0,
    quarterRevenue: 0,
    lastQuarterRevenue: 0,
    holdings: {},
    ledger: emptyLedger(),
    monthly: [],
    cashHistory: [],
    revenueTotal: 0,
    insolventDays: 0,
    boardConfidence: 60,
    defaults: 0,
    rev30: 0,
    lastDecisionDay: 0,
    decisionOffset: randInt(w, 0, 6),
    distressDays: 0,
  };
  c.avgSalary = aiAvgSalary(talent, c.headcount);
  c.valuation = computeValuation(w, c) + c.headcount * 120000 * (c.talent / 60);
  if (chance(w, t.publicChance)) {
    // most non-founder shares trade publicly
    c.investorShares = c.shares * randRange(w, 0.02, 0.12);
    c.isPublic = true;
    c.ipoDay = w.day - randInt(w, 300, 6000);
    c.price = c.valuation / c.shares;
  }
  return c;
}

/** Seed a back-catalogue of games released before the simulation starts. */
export function seedCatalog(w: World, c: Company, count: number): void {
  for (let i = 0; i < count; i++) {
    const sIdx = clamp(Math.round(Math.log10(Math.max(2, c.headcount)) * 1.35 - 0.6 + randNormal(w, 0, 0.7)), 0, 5);
    const scope = SCOPE_IDS[sIdx];
    const params = chooseConcept(w, c, scope);
    const g = createGameRecord(w, c, params, false);
    const age = randInt(w, 30, 1600);
    g.createdDay = w.day - age - 400;
    g.workDone = g.workRequired;
    const qm = aiQualityMult(w, c) * Math.pow(c.talent / 50, 0.6);
    for (const k of Object.keys(g.points) as (keyof Focus)[]) g.points[k] = g.workRequired * GENRES[g.genre].ideal[k] * qm * randRange(w, 0.85, 1.15);
    g.budgetSpent = g.budget;
    g.bugs = g.workRequired * randRange(w, 0.005, 0.03);
    addGame(w, g);
    releaseGameQuiet(w, g, age);
  }
}

function releaseGameQuiet(w: World, g: Game, age: number): void {
  const savedNews = w.news.length;
  releaseGame(w, g);
  w.news.splice(0, w.news.length - savedNews);
  g.releaseDay = w.day - age;
  g.lastUpdateDay = w.day - Math.min(age, randInt(w, 0, 120));
  g.hype = 0;
  g.wishlists = 0;
  const r = (g.criticScore + g.userScore) / 200;
  const scale = SCOPES[g.scope].reach * Math.pow(r, 3);
  const f2p = !MONETIZATIONS[g.monetization].upfront;
  const pool = 2e8 * GENRES[g.genre].interest * scale * (f2p ? 1.6 : 1);
  g.owners = pool * randRange(w, 0.02, 0.12) * (0.4 + Math.min(1, age / 400));
  const decay = Math.exp(-age / (g.multiplayer === 'single' ? 120 : 420));
  g.active = g.owners * randRange(w, 0.05, 0.2) * (0.2 + decay);
  if (g.breakout > 1) g.active *= 1.5;
  g.freshness = clamp(Math.exp(-age / 500), 0.15, 1);
  g.peakActive = g.active * randRange(w, 1.5, 3);
  g.peakCcu = g.peakActive * 0.12;
}

/** Possibly spawn a brand-new studio into the industry. */
export function maybeSpawnStudio(w: World): void {
  const active = activeCompanies(w).filter((c) => !c.isPlayer).length;
  if (active >= MAX_ACTIVE_STUDIOS) return;
  const p = 0.02 * w.market.sentiment * (1 - active / MAX_ACTIVE_STUDIOS) * (active < 12 ? 3 : 1);
  if (!chance(w, p)) return;
  const taken = new Set(Object.values(w.companies).map((c) => c.name));
  const roll = rand(w);
  const tier = roll < 0.75 ? 'indie' : roll < 0.95 ? 'small' : 'mid';
  const c = makeStudio(w, tier, taken);
  c.founded = w.day;
  c.genreXp = {};
  w.companies[c.id] = c;
  const funded = tier !== 'indie';
  pushNews(w, {
    kind: 'industry',
    title: funded ? `New studio ${c.name} launches with $${(c.cash / 1e6).toFixed(1)}M in funding` : `Indie studio ${c.name} opens its doors in ${c.hq}`,
    body: `Founded by ${c.ceo}. Focus: ${c.specialties.map((s) => GENRES[s].name).join(', ')}.`,
    companyId: c.id,
    tone: 'neutral',
  });
}

export { debtOf, revenueTTM };
