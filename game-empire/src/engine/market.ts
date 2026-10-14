// The player market: millions of simulated gamers choosing what to play.
//
// Every released game competes for attention inside its genre. Each day a
// slice of the genre's audience goes "shopping"; they pick games with a
// probability proportional to appeal x visibility (a logit-style share with
// an outside option). Owners accumulate, active players churn away, and
// revenue follows the game's business model.
import { contentLevelOf } from './updates';
import { addConsoleGross, antiCheatChurn } from './ventures';
import {
  AUDIENCES,
  GENRES,
  GENRE_IDS,
  MONETIZATIONS,
  MULTIPLAYER,
  PLATFORMS,
  SCOPES,
  ART_STYLES,
  artFit,
  audienceFit,
  platformAffinity,
} from './constants';
import { engineStats, hasResearch, bugDensity } from './development';
import { ccuMult, saleActive, shopperMult } from './calendar';
import { infraEffects } from './infra';
import { collectRoyalty } from './studioEngine';
import { facilityEffects } from './fun';
import { addXp, perkRank } from './progression';
import { rand } from './rng';
import type { Company, Game, GenreId, World } from './types';
import { clamp, earn, gamesOf, spend, isPlayerGroup, toast } from './util';

export const OUTSIDE_OPTION = 30;
export const SHOP_RATE = 0.02;
export const WISHLIST_RATE = 0.00003;

export function genreTrend(w: World, g: GenreId): number {
  let t = w.market.genres[g].trend;
  for (const e of w.market.effects) if (e.kind === 'genreBoost' && e.genre === g) t *= e.mult;
  return t;
}

function surgeMult(w: World): number {
  let m = 1;
  for (const e of w.market.effects) if (e.kind === 'surge') m *= e.mult;
  return m;
}

export function platformUsers(w: World, p: Game['platforms'][number]): number {
  let u = w.market.platforms[p].users;
  for (const e of w.market.effects) if (e.kind === 'platformBoost' && e.platform === p) u *= e.mult;
  return u;
}

/** Number of people (not millions) in the game's addressable audience. */
export function audiencePool(w: World, g: Pick<Game, 'platforms' | 'genre' | 'audience'>): number {
  let pool = 0;
  for (const p of g.platforms) pool += platformUsers(w, p) * 1e6 * platformAffinity(p, g.genre);
  return pool * GENRES[g.genre].interest * AUDIENCES[g.audience].pool * genreTrend(w, g.genre);
}

export function platformMix(w: World, g: Pick<Game, 'platforms' | 'genre'>) {
  let total = 0;
  let spendW = 0;
  let premium = 0;
  let cut = 0;
  let consoleW = 0;
  for (const p of g.platforms) {
    const wt = platformUsers(w, p) * platformAffinity(p, g.genre);
    const def = PLATFORMS[p];
    total += wt;
    spendW += wt * def.spend;
    premium += wt * def.premiumAffinity;
    cut += wt * def.storeCut;
    if (p === 'console') consoleW = wt;
  }
  if (total <= 0) return { spend: 1, premium: 1, storeCut: 0.3, console: 0 };
  return { spend: spendW / total, premium: premium / total, storeCut: cut / total, console: consoleW / total };
}

export function ratingOf(g: Game): number {
  if (g.releaseDay === null) return 0;
  return clamp((g.criticScore * 0.45 + g.userScore * 0.55) / 100, 0.01, 1);
}

function soft(f: number, k = 0.75): number {
  return 1 + (f - 1) * k;
}

export function appealOf(w: World, g: Game): number {
  const r = ratingOf(g);
  const quality = 1.6 * Math.pow(r, 2.5) * Math.pow(AUDIENCES[g.audience].qualitySensitivity, r > 0.7 ? 0.3 : -0.3);
  const fit = soft(GENRES[g.genre].mp[g.multiplayer], 0.9) * soft(audienceFit(g.audience, g.genre)) * soft(artFit(g.artStyle, g.genre), 0.6);
  const fresh = 0.2 + 0.8 * g.freshness;
  const viral = w.day < g.viralUntil ? g.viralMult : 1;
  const seasonal = w.day < g.seasonalUntil ? 1.25 : 1;
  const meltdown = w.day < g.meltdownUntil ? 0.55 : 1;
  return quality * fit * fresh * viral * seasonal * meltdown * g.breakout;
}

export function visibilityOf(w: World, g: Game, c: Company): number {
  const r = ratingOf(g);
  const age = w.day - (g.releaseDay ?? w.day);
  const featuring = age < 28 ? 6 * r * r * (1 - age / 28) : 0;
  const hype = g.hype * 0.08;
  const wom = 2.2 * r * r * Math.log10(1 + g.active / 1000);
  const rep = (c.reputation / 100) * 2;
  const ip = w.ips[g.ipId];
  const ipV = ip ? Math.log10(1 + ip.fans) / 2 : 0;
  let esports = 0;
  if (GENRES[g.genre].competitive && g.active > 50000) {
    if (c.isPlayer ? hasResearch(w, 'esports') : c.reputation > 72) esports = c.isPlayer ? 3 : 1.5;
  }
  let v = 1 + featuring + hype + wom + rep + ipV + esports;
  if (g.multiplayer === 'online' || g.multiplayer === 'massive') v *= 1 + 0.1 * Math.log10(1 + g.ccu / 100);
  return v;
}

/** Share-of-attention weight: appeal x visibility^1.3 x market presence. */
export function attentionWeight(w: World, g: Game, c: Company): number {
  // a new studio's first releases get press and storefront curiosity
  const buzz = g.newcomer && w.day - (g.releaseDay ?? w.day) < 180 ? 2.2 : 1;
  return appealOf(w, g) * Math.pow(visibilityOf(w, g, c), 1.3) * SCOPES[g.scope].presence * buzz;
}

function regulationMult(w: World): number {
  let m = 1;
  for (const e of w.market.effects) if (e.kind === 'regulation') m *= e.mult;
  return m;
}

function churnMods(w: World, g: Game, c: Company): number {
  let m = 1;
  if (isPlayerGroup(w, c)) {
    if (c.isPlayer) {
      if (hasResearch(w, 'analytics')) m *= 0.92;
      if (hasResearch(w, 'communityHub')) m *= 0.94;
      if (GENRES[g.genre].competitive && hasResearch(w, 'antiCheat')) m *= 0.88;
      if (GENRES[g.genre].competitive && hasResearch(w, 'esports')) m *= 0.94;
      // community managers: each skilled CM looks after ~250k players
      let cm = 0;
      for (const e of w.player.employees) if (e.role === 'community') cm += e.skill / 50;
      const load = Math.max(1, g.active / 250000);
      m *= 1 - Math.min(0.15, (0.05 * cm) / load);
      m *= 1 - 0.04 * perkRank(w, 'community');
      if (GENRES[g.genre].competitive) m *= facilityEffects(w).competitiveChurn;
    }
  } else if (c.reputation > 60) {
    m *= 0.95;
  }
  return m * antiCheatChurn(w, g, c) * (1 - 0.01 * contentLevelOf(g));
}

export function serverCostMult(w: World, c: Company): number {
  if (!c.isPlayer) return c.headcount > 300 ? 0.75 : 1;
  let m = 1;
  if (hasResearch(w, 'netcode')) m *= 0.85;
  if (hasResearch(w, 'cloudInfra')) m *= 0.6;
  return m;
}

/** Simulate one day of the whole player market. */
export function marketDay(w: World): void {
  const day = w.day;
  const live: Game[] = [];
  for (const id in w.games) {
    const g = w.games[id];
    if (g.status === 'released') live.push(g);
  }

  const weights = new Map<string, number>();
  const genreWeight: Record<string, number> = {};
  for (const gid of GENRE_IDS) genreWeight[gid] = 0;
  for (const g of live) {
    const c = w.companies[g.companyId];
    const wgt = attentionWeight(w, g, c);
    weights.set(g.id, wgt);
    genreWeight[g.genre] += wgt;
  }

  const sentiment = w.market.sentiment * surgeMult(w);
  const regulation = regulationMult(w);
  const player = w.companies[w.player.companyId];
  const hasPlayer = !!player && player.status === 'active';
  const fx = hasPlayer ? infraEffects(w) : null;
  const shopDay = shopperMult(day);
  const ccuDay = ccuMult(day);
  const sale = saleActive(day);
  const deals = new Map((w.player.publishing ?? []).map((d) => [d.gameId, d]));
  const merchRank = hasPlayer ? perkRank(w, 'merch') : 0;
  const hypeRank = hasPlayer ? perkRank(w, 'hype') : 0;

  for (const g of live) {
    const c = w.companies[g.companyId];
    const r = ratingOf(g);
    const age = day - (g.releaseDay ?? day);
    const mon = MONETIZATIONS[g.monetization];
    const mp = MULTIPLAYER[g.multiplayer];
    const aud = AUDIENCES[g.audience];
    const scope = SCOPES[g.scope];
    const mix = platformMix(w, g);
    const pool = audiencePool(w, g);
    const wgt = weights.get(g.id) ?? 0;
    const share = wgt / (genreWeight[g.genre] + OUTSIDE_OPTION);
    const shoppers = pool * SHOP_RATE * sentiment * shopDay;
    const playerOnline = c.isPlayer && fx !== null && (g.multiplayer === 'online' || g.multiplayer === 'massive');

    // conversion
    if (g.discountUntil <= day) g.discount = 0;
    const unitPrice = g.price * (1 - g.discount);
    let conv: number;
    let priceFactor = 1;
    if (mon.upfront) {
      const expected = scope.price * (0.6 + 0.8 * r);
      priceFactor = clamp(Math.pow(expected / Math.max(0.99, unitPrice), 1.15), 0.12, 3);
      conv = mon.conversion * priceFactor * mix.premium * (0.6 + 0.4 * aud.spend);
      if (sale && g.discount > 0) conv *= 1.35; // seasonal sale shoppers
    } else {
      conv = mon.conversion * (g.monetization === 'subscription' ? Math.min(1.4, aud.spend * mix.spend * 1.2) : 1);
    }
    const size = contentLevelOf(g);
    const penCap = Math.min(0.85, (0.03 + 0.55 * r * r * r) * mon.reach * scope.reach * (1 + 0.025 * size));
    const reachMax = Math.max(1, pool * penCap);
    const remaining = Math.max(0, 1 - g.owners / reachMax);
    let newPlayers = shoppers * share * conv * remaining * (1 + 0.02 * size);

    // launch window: wishlists convert
    if (age < 12 && g.wishlists > 0) {
      const buy = clamp(r * 1.35, 0.08, 1) * (mon.upfront ? Math.sqrt(Math.min(1.5, priceFactor)) : 1.2);
      newPlayers += g.wishlists * 0.12 * buy;
      g.wishlists *= 0.88;
      if (age === 11) g.wishlists = 0;
    }
    if (playerOnline) newPlayers *= fx.acquire;
    if (!(newPlayers > 0)) newPlayers = 0;
    g.owners += newPlayers;
    g.dailyNew = newPlayers;

    // churn
    const density = bugDensity(g);
    const churn = clamp(
      GENRES[g.genre].churn *
        aud.churn *
        mp.churn *
        mon.churn *
        (1.8 - 1.2 * r) *
        (1.6 - 0.6 * g.freshness) *
        (1 + density / 40) *
        (w.day < g.meltdownUntil ? 1.5 : 1) *
        (w.day < g.backlashUntil ? 1.3 : 1) *
        (playerOnline ? fx.churn : 1) *
        churnMods(w, g, c),
      0.001,
      0.25,
    );
    g.lastChurn = churn;
    // lapsed players drift back to games that stay fresh and well-liked
    const lapsed = Math.max(0, g.owners - g.active);
    const returning = lapsed * 0.0018 * g.freshness * r * (mp.serverBase > 0 ? 1.4 : 0.6);
    g.active = Math.max(0, g.active * (1 - churn) + newPlayers * 0.92 + returning);
    if (g.active < 0.5) g.active = 0;
    g.ccu = g.active * mp.ccuRatio * ccuDay * (0.93 + 0.14 * rand(w));
    if (g.ccu > g.peakCcu) g.peakCcu = g.ccu;
    if (g.active > g.peakActive) g.peakActive = g.active;

    // revenue
    const salesGross = mon.upfront ? newPlayers * unitPrice : 0;
    let arpdau = mon.arpdau * mix.spend * aud.spend * sentiment * Math.sqrt(r);
    if (g.monetization === 'subscription') arpdau = mon.arpdau * (0.75 + 0.25 * mix.spend);
    if (w.day < g.seasonalUntil && !mon.upfront) arpdau *= 1.3;
    if (g.monetization === 'f2pAggressive') arpdau *= regulation;
    const recurringGross = g.active * arpdau;
    const net = (salesGross + recurringGross) * (1 - mix.storeCut);
    const eng = engineStats(w, g.engine, c.isPlayer, c);
    const royalty = net * eng.royalty;
    const pubCut = net * g.publisherCut;

    if (mix.console > 0) addConsoleGross(w, (salesGross + recurringGross) * mix.console);
    if (salesGross > 0) earn(c, 'sales', salesGross * (1 - mix.storeCut));
    if (recurringGross > 0) {
      const key = g.monetization === 'subscription' ? 'subscriptions' : g.monetization === 'ads' ? 'ads' : 'microtransactions';
      earn(c, key, recurringGross * (1 - mix.storeCut));
    }
    if (royalty > 0) {
      spend(c, 'royalties', royalty);
      if (g.engine === 'inhouse' && hasPlayer) collectRoyalty(w, royalty);
    }
    if (pubCut > 0) {
      spend(c, 'royalties', pubCut);
      const deal = deals.get(g.id);
      if (deal && hasPlayer) {
        earn(player, 'publishing', pubCut);
        deal.earned += pubCut;
      }
    }

    // servers: rivals pay per game; the player's fleet is billed in infra.ts
    let server = 0;
    if (!c.isPlayer && mp.serverBase > 0) server = (mp.serverBase + g.ccu * mp.serverCostPerCcu) * serverCostMult(w, c);
    if (server > 0) spend(c, 'servers', server);

    let revenue = net - royalty - pubCut;
    if (merchRank > 0 && c.isPlayer && revenue > 0) {
      const extra = revenue * 0.03 * merchRank;
      earn(c, 'licensing', extra);
      revenue += extra;
    }
    g.dailyRevenue = revenue;
    g.revenueTotal += revenue;
    g.rev30 = g.rev30 * (29 / 30) + revenue;
    if (!c.isPlayer) {
      g.dailyCost = server;
      g.costTotal += server;
      g.cost30 = g.cost30 * (29 / 30) + server;
    }
    c.rev30 = c.rev30 + revenue;

    // ageing
    const decay = scope.freshnessDecay * mp.freshnessDecay * ART_STYLES[g.artStyle].aging;
    g.freshness = Math.max(0.03, g.freshness - decay * (0.6 + 0.4 * g.freshness));
    g.hype *= c.isPlayer ? 1 - 0.035 * (1 - 0.25 * hypeRank) : 0.965;
    g.goodwill *= 0.995;
    // neglect: live-service and popular games that go quiet lose their players' patience
    const neglectAfter = !mon.upfront || mp.serverBase > 0 ? 100 : 160;
    if (g.active > 2000 && day - g.lastUpdateDay > neglectAfter) {
      g.goodwill = Math.max(-10, g.goodwill - 0.05);
      if (c.isPlayer && !g.neglectWarned) {
        g.neglectWarned = true;
        toast(w, `Players feel ${g.title} has been abandoned`, 'bad', { category: 'game', link: { route: 'game', id: g.id }, body: 'No update in months. Reviews and retention will slide until you ship one.' });
      }
    }
    const target = clamp(
      g.quality + mon.userScore - density * 1.2 + g.goodwill - (g.monetization === 'f2pAggressive' && regulation < 1 ? 5 : 0) + (playerOnline ? fx.score : 0),
      1,
      99,
    );
    g.userScoreTarget = target;
    g.userScore = clamp(g.userScore + (target - g.userScore) * 0.03, 1, 99);

    if (g.history.length === 0 || day - g.history[g.history.length - 1][0] >= 1) {
      g.history.push([day, Math.round(g.active), Math.round(g.ccu), Math.round(revenue)]);
      if (g.history.length > 320) thinGameHistory(g, day);
    }

    if (c.isPlayer) celebrateMilestones(w, g);

    // retire long-dead offline games to keep the simulation lean
    if (age > 400 && g.active < 25 && newPlayers < 1 && mp.serverBase === 0) {
      g.status = 'retired';
      g.ccu = 0;
      g.active = 0;
      compactDeadHistory(g);
    }
  }

  devHypeAndWishlists(w);
}

/** Keep only ~monthly samples for games that are no longer simulated. */
export function compactDeadHistory(g: Game): void {
  const out: Game['history'] = [];
  let last = -Infinity;
  for (const p of g.history) {
    if (p[0] - last >= 30) {
      out.push(p);
      last = p[0];
    }
  }
  g.history = out.slice(-48);
}

function thinGameHistory(g: Game, day: number) {
  const out: Game['history'] = [];
  let lastKept = -Infinity;
  for (const p of g.history) {
    const age = day - p[0];
    const step = age <= 120 ? 1 : age <= 730 ? 7 : 30;
    if (age <= 120 || p[0] - lastKept >= step) {
      out.push(p);
      lastKept = p[0];
    }
  }
  g.history = out;
}

const CCU_MILESTONES = [1000, 10000, 100000, 1000000, 10000000];

function celebrateMilestones(w: World, g: Game): void {
  for (const m of CCU_MILESTONES) {
    if (g.ccu >= m && g.ccuMilestone < m) {
      g.ccuMilestone = m;
      const label = m >= 1e6 ? `${m / 1e6}M` : `${m / 1e3}K`;
      addXp(w, 40 * Math.log10(m));
      toast(w, `${g.title} just passed ${label} players online`, 'good', { category: 'game', link: { route: 'game', id: g.id } });
    }
  }
}

/** Weekly: warn when one of the player's games is losing players fast. */
export function playerGameAlerts(w: World): void {
  for (const g of gamesOf(w, w.player.companyId)) {
    if (g.status !== 'released' || g.ccu < 150) continue;
    const weekAgo = [...g.history].reverse().find((h) => h[0] <= w.day - 7);
    if (!weekAgo || weekAgo[2] <= 0) continue;
    const change = g.ccu / weekAgo[2] - 1;
    const key = `drop:${g.id}`;
    if (change < -0.3 && w.day - (w.player.flags[key] ?? -999) > 45) {
      w.player.flags[key] = w.day;
      toast(w, `Players are leaving ${g.title} (${Math.round(change * 100)}% this week)`, 'bad', {
        category: 'game',
        link: { route: 'game', id: g.id },
        body: g.update ? 'An update is on the way.' : 'A content update or seasonal event would bring them back.',
      });
    }
  }
}

/** Pre-release hype decay and wishlist accumulation. */
function devHypeAndWishlists(w: World) {
  for (const id in w.games) {
    const g = w.games[id];
    if (g.status !== 'development') continue;
    const mine = g.companyId === w.player.companyId;
    const rank = mine ? perkRank(w, 'hype') : 0;
    g.hype *= 1 - 0.004 * (1 - 0.25 * rank);
    if (g.hype > 1) {
      const pool = audiencePool(w, g);
      const cap = pool * 0.25;
      g.wishlists += pool * WISHLIST_RATE * SCOPES[g.scope].presence * (g.hype / 100) * Math.max(0, 1 - g.wishlists / cap) * (1 + 0.1 * rank);
    }
  }
}

export function totalActivePlayers(w: World): number {
  let t = 0;
  for (const id in w.games) if (w.games[id].status === 'released') t += w.games[id].active;
  return t;
}
