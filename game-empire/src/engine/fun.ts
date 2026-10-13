// Studio life and late-game ambitions: office facilities, sales
// certifications, remasters of your classics, your own fan convention, your
// own game store, and industry legends you can hire.
import {
  CERTIFICATIONS,
  CONVENTIONS,
  FACILITIES,
  MONETIZATIONS,
  OFFICES,
  SCOPES,
  STORE_COST,
  STORE_MIN_REP,
  STORE_MONTHLY_COST,
  salaryFor,
} from './constants';
import { createGameRecord, playerDailyWork, recommendedBudget } from './development';
import { addXp } from './progression';
import { chance, pick, randInt } from './rng';
import type { ActionResult, Candidate, FacilityId, Game, RoleId, World } from './types';
import { addGame, celebrate, earn, gamesOf, newId, playerCompany, pushNews, spend, toast } from './util';

// ------------------------------------------------------------ facilities

export function hasFacility(w: World, id: FacilityId): boolean {
  return w.player.facilities?.includes(id) ?? false;
}

export interface FacilityEffects {
  morale: number;
  quality: number;
  realismQuality: number;
  crunchMult: number;
  quitMult: number;
  bugMult: number;
  speedMult: number;
  competitiveChurn: number;
  candidateSkill: number;
}

export function facilityEffects(w: World): FacilityEffects {
  const f = (id: FacilityId) => hasFacility(w, id);
  return {
    morale: (f('coffee') ? 4 : 0) + (f('arcade') ? 3 : 0) + (f('gym') ? 2 : 0) + (f('rooftop') ? 4 : 0),
    quality: (f('arcade') ? 1 : 0) + (f('soundStage') ? 1 : 0),
    realismQuality: f('mocap') ? 3 : 0,
    crunchMult: f('napPods') ? 0.6 : 1,
    quitMult: (f('gym') ? 0.75 : 1) * (f('daycare') ? 0.7 : 1),
    bugMult: f('testLab') ? 0.9 : 1,
    speedMult: f('renderFarm') ? 1.06 : 1,
    competitiveChurn: f('arena') ? 0.94 : 1,
    candidateSkill: f('daycare') ? 2 : 0,
  };
}

export function facilityUpkeep(w: World): number {
  let t = 0;
  for (const id of w.player.facilities ?? []) t += FACILITIES[id].upkeep;
  return t;
}

export function buildFacility(w: World, id: FacilityId): ActionResult {
  const def = FACILITIES[id];
  if (hasFacility(w, id)) return { ok: false, error: 'Already built.' };
  if (w.player.officeLevel < def.minOffice) return { ok: false, error: `Needs a ${OFFICES[def.minOffice].name} or bigger.` };
  const p = playerCompany(w);
  if (p.cash < def.cost) return { ok: false, error: 'Not enough cash.' };
  spend(p, 'misc', def.cost);
  w.player.facilities.push(id);
  for (const e of w.player.employees) if (!e.isFounder) e.morale = Math.min(100, e.morale + 3);
  addXp(w, 20);
  return { ok: true };
}

export function closeFacility(w: World, id: FacilityId): ActionResult {
  if (!hasFacility(w, id)) return { ok: false, error: 'Not built.' };
  w.player.facilities = w.player.facilities.filter((x) => x !== id);
  for (const e of w.player.employees) if (!e.isFounder) e.morale = Math.max(0, e.morale - 4);
  return { ok: true };
}

export function facilitiesDaily(w: World): void {
  const up = facilityUpkeep(w);
  if (up > 0) spend(playerCompany(w), 'rent', up / 30);
}

// ------------------------------------------------------------ certifications

export function certificationName(level: number): string {
  return level > 0 ? CERTIFICATIONS[level - 1].name : '';
}

/** Weekly: award sales certifications to the player's games. */
export function certificationsWeekly(w: World): void {
  const p = playerCompany(w);
  for (const g of gamesOf(w, p.id)) {
    if (g.releaseDay === null) continue;
    while (g.certified < CERTIFICATIONS.length && g.owners >= CERTIFICATIONS[g.certified].owners) {
      const c = CERTIFICATIONS[g.certified];
      g.certified += 1;
      addXp(w, c.xp);
      p.reputation = Math.min(100, p.reputation + c.rep);
      const what = MONETIZATIONS[g.monetization].upfront ? 'copies sold' : 'players';
      toast(w, `${g.title} went ${c.name}!`, 'good', { category: 'game', link: { route: 'game', id: g.id }, body: `${c.owners.toLocaleString()} ${what}. It's going on the Hall of Fame wall.` });
      if (g.certified >= 3) {
        pushNews(w, { kind: 'player', title: `${g.title} is certified ${c.name}`, companyId: p.id, gameId: g.id, tone: 'good' });
        celebrate(w, `${c.name}!`, g.certified >= 4);
      }
    }
  }
}

// ------------------------------------------------------------ remasters

export const REMASTER_MIN_AGE = 3 * 365;

export function remasterBlocker(w: World, g: Game): string | null {
  if (g.companyId !== w.player.companyId) return 'Not your game.';
  if (g.releaseDay === null) return 'Not released yet.';
  if (g.remasterOf) return 'This is already a remaster.';
  if (g.remastered) return 'Already remastered.';
  if (w.day - g.releaseDay < REMASTER_MIN_AGE) return `Fans need to miss it first: available ${Math.ceil((REMASTER_MIN_AGE - (w.day - g.releaseDay)) / 30)} months after launch.`;
  if (g.criticScore < 65 && g.owners < 100000) return 'Only well-loved or big-selling games are worth remastering.';
  const busy = gamesOf(w, g.companyId).some((x) => x.ipId === g.ipId && x.status === 'development');
  if (busy) return 'A game in this franchise is already in development.';
  return null;
}

/** Nostalgia: start hype for a remaster. */
export function remasterHype(w: World, g: Game): number {
  const fans = w.ips[g.ipId]?.fans ?? 0;
  return Math.min(500, Math.log10(1 + g.owners) * 35 + Math.log10(1 + fans) * 15 + Math.max(0, g.criticScore - 60) * 3);
}

export function startRemaster(w: World, gameId: string): ActionResult {
  const orig = w.games[gameId];
  if (!orig) return { ok: false, error: 'Game not found.' };
  const blocker = remasterBlocker(w, orig);
  if (blocker) return { ok: false, error: blocker };
  const p = playerCompany(w);
  const art = orig.artStyle;
  const budget = Math.round(recommendedBudget(orig.scope, art, orig.platforms) * 0.5);
  if (p.cash < budget * 0.2) return { ok: false, error: 'You need some cash to fund the remaster.' };
  const engine = w.player.engine ? 'inhouse' : orig.engine;
  const g = createGameRecord(
    w,
    p,
    {
      title: `${orig.title} Remastered`,
      genre: orig.genre,
      topic: orig.topic,
      platforms: [...new Set([...orig.platforms, 'pc' as const])],
      audience: orig.audience,
      engine,
      monetization: orig.monetization,
      price: orig.price > 0 ? Math.max(9.99, Math.round(orig.price * 0.75) - 0.01) : orig.price,
      artStyle: art,
      multiplayer: orig.multiplayer,
      scope: orig.scope,
      budget,
      focus: { ...orig.focus },
      ipId: orig.ipId,
      remasterOf: orig.id,
    },
    true,
  );
  addGame(w, g);
  orig.remastered = true;
  // idle developers start right away; auto-assign fills the rest
  for (const e of w.player.employees) if (!e.assignment && e.role !== 'marketing' && e.role !== 'community') e.assignment = g.id;
  const work = playerDailyWork(w, g);
  g.plannedDays = work > 0 ? g.workRequired / work : 0;
  pushNews(w, { kind: 'player', title: `${p.name} announces ${g.title}`, body: `Fans of the ${SCOPES[orig.scope].name.toLowerCase()} classic are thrilled.`, companyId: p.id, gameId: g.id, tone: 'good' });
  return { ok: true, id: g.id };
}

// ------------------------------------------------------------ fan convention

export function conventionBlocker(w: World, tier: number): string | null {
  const def = CONVENTIONS[tier];
  if (!def) return 'Unknown event.';
  const p = playerCompany(w);
  if (w.player.convention) return 'Your convention is already scheduled.';
  if (p.reputation < def.minRep) return `Needs reputation ${def.minRep}.`;
  if (!gamesOf(w, p.id).some((g) => g.status === 'released')) return 'You need at least one released game for fans to celebrate.';
  const last = w.player.flags.lastConvention ?? -9999;
  if (w.day - last < 300) return `Fans need time to save up: next one in ${300 - (w.day - last)} days.`;
  if (p.cash < def.cost) return `Costs $${def.cost.toLocaleString()}.`;
  return null;
}

export function conventionName(w: World, tier: number): string {
  const first = playerCompany(w).name.split(' ')[0];
  return tier === 2 ? `${first}Con` : `${first} ${CONVENTIONS[tier].name}`;
}

export function hostConvention(w: World, tier: number): ActionResult {
  const blocker = conventionBlocker(w, tier);
  if (blocker) return { ok: false, error: blocker };
  const def = CONVENTIONS[tier];
  spend(playerCompany(w), 'marketing', def.cost);
  w.player.convention = { day: w.day + 45, tier };
  w.player.flags.lastConvention = w.day;
  toast(w, `${conventionName(w, tier)} is booked`, 'good', { category: 'studio', link: { route: 'goals' }, body: 'Doors open in 45 days. Games in development get the spotlight.' });
  return { ok: true };
}

const CON_MOMENTS = [
  'A fan proposed on stage dressed as your mascot. They said yes.',
  'The cosplay contest winner spent 900 hours on their armour.',
  'Your lead designer got a standing ovation for a bug they never fixed.',
  'Someone queued for 31 hours to be first in line for a keychain.',
  'The surprise reveal trailer broke the venue Wi-Fi.',
  'A kid beat your QA lead at your own game, live on stage.',
];

export function conventionDaily(w: World): void {
  const con = w.player.convention;
  if (!con || w.day < con.day) return;
  const p = playerCompany(w);
  const def = CONVENTIONS[con.tier];
  const name = conventionName(w, con.tier);
  w.player.convention = null;
  w.player.conventionsHeld += 1;
  let fans = 0;
  for (const id in w.ips) if (w.ips[id].companyId === p.id) fans += w.ips[id].fans;
  const visitors = Math.round(Math.min(def.scale * 60000, 800 + Math.sqrt(fans) * 40 * def.scale));
  const tickets = visitors * (25 + 15 * con.tier);
  earn(p, 'other', tickets);
  const boost = (30 + 25 * def.scale) * (1 + p.reputation / 150);
  let shown = 0;
  for (const g of gamesOf(w, p.id)) {
    if (g.status === 'development') {
      g.hype = Math.min(1400, g.hype + boost);
      shown++;
    } else if (g.status === 'released' && g.active > 0) {
      g.goodwill += 1 + con.tier;
      g.viralMult = Math.max(g.viralMult, 1.1 + 0.07 * def.scale);
      g.viralUntil = Math.max(g.viralUntil, w.day + 21);
    }
  }
  for (const id in w.ips) if (w.ips[id].companyId === p.id) w.ips[id].fans *= 1 + 0.03 * def.scale;
  for (const e of w.player.employees) e.morale = Math.min(100, e.morale + 6);
  p.reputation = Math.min(100, p.reputation + 1 + con.tier);
  addXp(w, 80 * (con.tier + 1));
  const moment = pick(w, CON_MOMENTS);
  pushNews(w, { kind: 'player', title: `${visitors.toLocaleString()} fans flood ${name}`, body: moment, companyId: p.id, tone: 'major' });
  toast(w, `${name}: ${visitors.toLocaleString()} fans showed up!`, 'good', {
    category: 'studio',
    body: `${moment} Tickets brought in $${Math.round(tickets).toLocaleString()}${shown ? `, and ${shown} upcoming game${shown > 1 ? 's' : ''} gained hype` : ''}.`,
  });
}

// ------------------------------------------------------------ your own store

export function storeBlocker(w: World): string | null {
  const p = playerCompany(w);
  if (w.player.store) return 'Your store is already open.';
  if (p.reputation < STORE_MIN_REP) return `Needs reputation ${STORE_MIN_REP}.`;
  if (gamesOf(w, p.id).filter((g) => g.releaseDay !== null && g.platforms.includes('pc')).length < 3) return 'Release at least 3 PC games first.';
  if (p.cash < STORE_COST) return `Costs $${STORE_COST.toLocaleString()}.`;
  return null;
}

export function launchStore(w: World, name: string): ActionResult {
  const blocker = storeBlocker(w);
  if (blocker) return { ok: false, error: blocker };
  const clean = name.trim().slice(0, 32) || `${playerCompany(w).name.split(' ')[0]} Store`;
  const p = playerCompany(w);
  spend(p, 'misc', STORE_COST);
  w.player.store = { name: clean, foundedDay: w.day, share: 0.01, promoUntil: 0, revenueTotal: 0 };
  addXp(w, 400);
  pushNews(w, { kind: 'player', title: `${p.name} launches ${clean}, its own PC game store`, body: 'Analysts call it a bold bet against the giants.', companyId: p.id, tone: 'major' });
  toast(w, `${clean} is open for business`, 'good', { category: 'finance', link: { route: 'industry' }, body: 'Every PC game sold through it pays you a cut.' });
  return { ok: true };
}

export function storePromoCost(w: World): number {
  return Math.round(Math.max(500000, (w.player.store?.share ?? 0) * 40e6) / 10000) * 10000;
}

export function runStorePromo(w: World): ActionResult {
  const s = w.player.store;
  if (!s) return { ok: false, error: 'Open your store first.' };
  if (w.day < s.promoUntil) return { ok: false, error: 'A promotion is already running.' };
  const cost = storePromoCost(w);
  const p = playerCompany(w);
  if (p.cash < cost) return { ok: false, error: 'Not enough cash.' };
  spend(p, 'marketing', cost);
  s.promoUntil = w.day + 60;
  toast(w, `${s.name}: free-game giveaway is live`, 'good', { category: 'finance', link: { route: 'industry' }, body: 'Millions of new accounts for the next two months.' });
  return { ok: true };
}

/** Where the store's share is heading. */
export function storeTargetShare(w: World): number {
  const s = w.player.store;
  if (!s) return 0;
  const p = playerCompany(w);
  let mine = 0;
  let all = 0;
  for (const id in w.games) {
    const g = w.games[id];
    if (g.status !== 'released' || !g.platforms.includes('pc')) continue;
    all += g.active;
    if (g.companyId === p.id) mine += g.active;
  }
  const exclusives = all > 0 ? mine / all : 0;
  const promo = w.day < s.promoUntil ? 0.06 : 0;
  return Math.min(0.35, 0.02 + exclusives * 0.6 + p.reputation / 800 + promo);
}

/** Daily: the store earns a 30% cut of the PC sales that flow through it. */
export function storeDaily(w: World): void {
  const s = w.player.store;
  const p = playerCompany(w);
  if (!s || !p || p.status !== 'active') return;
  const target = storeTargetShare(w);
  s.share += (target - s.share) * 0.01;
  let pcRevenue = 0;
  for (const id in w.games) {
    const g = w.games[id];
    if (g.status !== 'released' || !g.platforms.includes('pc') || g.dailyRevenue <= 0) continue;
    pcRevenue += g.dailyRevenue / g.platforms.length;
  }
  // dailyRevenue is net of the 30% store cut, so gross it back up
  const cut = pcRevenue * (0.3 / 0.7) * s.share;
  earn(p, 'store', cut);
  s.revenueTotal += cut;
  spend(p, 'misc', STORE_MONTHLY_COST / 30);
}

// ------------------------------------------------------------ industry legends

const LEGENDS: { name: string; role: RoleId; bio: string }[] = [
  { name: "Dara 'Pixelwitch' Okafor", role: 'designer', bio: 'Designed three cult classics on a laptop in a laundromat.' },
  { name: 'Viktor Hallgrimsson', role: 'programmer', bio: 'Wrote a 3D engine in 4 KB of code. For fun. On a Tuesday.' },
  { name: 'Mei Lin Takahara', role: 'artist', bio: 'Her concept art has its own museum exhibit and a fan club.' },
  { name: "Gus 'The Composer' Delacroix", role: 'audio', bio: 'His boss-fight themes are played at weddings. Unironically.' },
  { name: 'Professor Ada Byte', role: 'programmer', bio: 'Retired from academia because games were "a more interesting problem".' },
  { name: 'Rosa Montenegro', role: 'writer', bio: 'Made a million players cry over a talking lamp.' },
  { name: 'Sam "One More Turn" Okonkwo', role: 'designer', bio: 'Responsible for an estimated 40 million lost nights of sleep.' },
  { name: 'Ingrid Solberg', role: 'producer', bio: 'Has shipped 22 games and never once missed a date. Witchcraft, probably.' },
  { name: 'Kenji Arakawa', role: 'artist', bio: 'Can draw a perfect circle freehand. Has proven it on live TV.' },
  { name: 'Lou Ferreira', role: 'qa', bio: 'Once found a bug just by looking at a loading screen.' },
];

export function makeLegend(w: World): Candidate | null {
  const hired = new Set([...w.player.employees.map((e) => e.name), ...w.player.candidates.map((k) => k.name)]);
  const pool = LEGENDS.filter((l) => !hired.has(l.name) && !(w.player.flags[`legend:${l.name}`] > 0));
  if (!pool.length) return null;
  const l = pick(w, pool);
  const skill = randInt(w, 92, 99);
  return {
    id: newId(w, 'k'),
    name: l.name,
    role: l.role,
    skill,
    salary: Math.round(salaryFor(l.role, skill) * 1.8),
    traits: ['legend'],
    bio: l.bio,
  };
}

/** Monthly: sometimes a legend is looking for a new home. */
export function legendsMonthly(w: World): void {
  const p = playerCompany(w);
  if (p.reputation < 20 || w.player.candidates.some((k) => k.traits.includes('legend'))) return;
  if (!chance(w, 0.06 + p.reputation / 1500)) return;
  const k = makeLegend(w);
  if (!k) return;
  w.player.candidates.unshift(k);
  toast(w, `Industry legend ${k.name} is looking for a new studio`, 'major', { category: 'studio', link: { route: 'team' }, body: k.bio });
}

/** Legends attract press attention to whatever they are working on. */
export function legendsDaily(w: World): void {
  for (const e of w.player.employees) {
    if (!e.traits.includes('legend') || !e.assignment) continue;
    const g = w.games[e.assignment];
    if (g && g.status === 'development') g.hype = Math.min(1400, g.hype + 0.6);
  }
}
