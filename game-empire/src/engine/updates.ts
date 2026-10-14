// Post-launch updates: patches, content drops, expansions, ports.
import { MONETIZATIONS, PLATFORMS, UPDATES } from './constants';
import { hasResearch, memberOutput, teamFactors } from './development';
import { ratingOf } from './market';
import { randNormal } from './rng';
import type { Company, Game, MonetizationId, PlatformId, UpdateTypeId, World } from './types';
import { clamp, earn, pushNews, toast } from './util';
import { addXp, perkRank } from './progression';
import { enginePortDiscount } from './studioEngine';

export function updateWork(w: World, g: Game, type: UpdateTypeId, isPlayer: boolean, platform?: PlatformId): number {
  const def = UPDATES[type];
  let work = Math.max(def.minWork, g.workRequired * def.workFrac);
  if (type === 'port' && platform) work *= PLATFORMS[platform].workMult / 0.3;
  if (isPlayer && hasResearch(w, 'liveOps')) work *= 0.65;
  if (isPlayer && type === 'port' && hasResearch(w, 'crossplay')) work *= 0.5;
  if (isPlayer) work *= 1 - 0.12 * perkRank(w, 'patch');
  if (isPlayer && type === 'port') work *= 1 - enginePortDiscount(w, g.engine);
  return work;
}

export function updateCost(g: Game, type: UpdateTypeId, platform?: PlatformId): number {
  let cost = Math.max(200, g.budget * UPDATES[type].costFrac);
  if (type === 'port' && platform) cost += PLATFORMS[platform].devKit;
  return cost;
}

export function startUpdateRecord(
  w: World,
  g: Game,
  c: Company,
  type: UpdateTypeId,
  team: string[],
  aiTeam: number,
  extra: { platform?: PlatformId; monetization?: MonetizationId } = {},
): void {
  const cost = updateCost(g, type, extra.platform);
  c.cash -= cost;
  c.ledger.development += cost;
  g.update = {
    type,
    workRequired: updateWork(w, g, type, c.isPlayer, extra.platform),
    workDone: 0,
    startDay: w.day,
    team,
    aiTeam,
    cost,
    platform: extra.platform,
    monetization: extra.monetization,
  };
}

/** Player: start the next queued update with the team already on the game. */
export function startNextQueued(w: World, g: Game, c: Company): boolean {
  const team = w.player.employees.filter((e) => e.assignment === g.id).map((e) => e.id);
  while (g.updateQueue.length > 0) {
    const next = g.updateQueue.shift()!;
    if (next.type === 'port' && (!next.platform || g.platforms.includes(next.platform))) continue;
    const cost = updateCost(g, next.type, next.platform);
    if (c.cash < cost) {
      toast(w, `${g.title}: skipped queued ${UPDATES[next.type].name} (needs $${Math.round(cost).toLocaleString()})`, 'bad', { category: 'game', link: { route: 'game', id: g.id } });
      continue;
    }
    if (team.length === 0) {
      g.updateQueue.unshift(next);
      return false;
    }
    startUpdateRecord(w, g, c, next.type, team, 0, { platform: next.platform, monetization: next.monetization });
    return true;
  }
  return false;
}

export function updateDaily(w: World, g: Game, c: Company): void {
  const u = g.update;
  if (!u) return;
  let work = 0;
  let skillSum = 0;
  let n = 0;
  if (c.isPlayer) {
    const team = w.player.employees.filter((e) => e.assignment === g.id);
    const { teamEff, producerBoost } = teamFactors(team, g.scope);
    for (const e of team) {
      work += memberOutput(w, e, g.focus, false, teamEff, producerBoost).work;
      skillSum += e.skill;
      n++;
      e.xp += 0.015;
    }
    // the contract live-ops crew
    if (u.aiTeam > 0) {
      work += u.aiTeam * CREW_OUTPUT;
      skillSum += CREW_SKILL;
      n++;
    }
  } else {
    work = u.aiTeam * Math.pow(c.talent / 50, 0.8);
    skillSum = c.talent;
    n = 1;
  }
  u.workDone += work;
  if (u.workDone >= u.workRequired) completeUpdate(w, g, c, n > 0 ? skillSum / n : 40);
}

export function completeUpdate(w: World, g: Game, c: Company, avgSkill: number): void {
  const u = g.update;
  if (!u) return;
  let reception = 42 + (avgSkill - 50) * 0.7 + randNormal(w, 0, 9);
  if (c.isPlayer && hasResearch(w, 'liveOps')) reception += 8;
  if (c.isPlayer) reception += 3 * perkRank(w, 'patch');
  const fatigue = updateFatigue(w, g, u.type);
  reception -= fatigue;
  reception = clamp(reception, 5, 98);
  const recF = reception / 70;
  const lapsed = Math.max(0, g.owners - g.active);
  const def = UPDATES[u.type];
  let label = def.name;

  switch (u.type) {
    case 'hotfix':
      g.bugs *= 0.3;
      g.goodwill += 2;
      break;
    case 'balance':
      g.goodwill += 3 * recF;
      g.freshness = Math.min(1.2, g.freshness + 0.05);
      g.bugs *= 0.8;
      break;
    case 'content':
      g.freshness = Math.min(1.2, g.freshness + 0.3 * recF);
      g.active += lapsed * 0.05 * recF;
      g.hype += 25 * recF;
      g.goodwill += 1.5 * recF;
      break;
    case 'seasonal':
      g.seasonalUntil = w.day + 30;
      g.freshness = Math.min(1.2, g.freshness + 0.15 * recF);
      g.active += lapsed * 0.025 * recF;
      g.hype += 15 * recF;
      break;
    case 'expansion': {
      g.freshness = Math.min(1.2, g.freshness + 0.55 * recF);
      g.active += lapsed * 0.11 * recF;
      g.hype += 80 * recF;
      g.goodwill += 2 * recF;
      if (MONETIZATIONS[g.monetization].upfront) {
        const buyers = Math.max(0, (g.owners - g.dlcOwners) * 0.14 * recF * ratingOf(g));
        const dlcPrice = Math.max(9.99, Math.round(g.price * 0.4) - 0.01);
        g.dlcOwners += buyers;
        const revenue = buyers * dlcPrice * 0.7;
        earn(c, 'dlc', revenue);
        g.revenueTotal += revenue;
        label = `${def.name} — ${Math.round(buyers).toLocaleString()} copies sold`;
      }
      break;
    }
    case 'monetization': {
      const target = u.monetization ?? g.monetization;
      const from = g.monetization;
      g.monetization = target;
      if (!MONETIZATIONS[target].upfront) g.price = 0;
      else if (g.price <= 0) g.price = 19.99;
      const delta = MONETIZATIONS[target].userScore - MONETIZATIONS[from].userScore;
      g.goodwill += Math.min(0, delta) * 0.6 - (target === from ? 2 : 0);
      if (target === from) g.seasonalUntil = Math.max(g.seasonalUntil, w.day + 20); // battle pass refresh
      label = target === from ? 'Battle Pass Season' : `Switched to ${MONETIZATIONS[target].short}`;
      break;
    }
    case 'port':
      if (u.platform && !g.platforms.includes(u.platform)) {
        g.platforms.push(u.platform);
        g.freshness = Math.min(1.2, g.freshness + 0.2);
        g.hype += 30 * recF;
        label = `Ported to ${PLATFORMS[u.platform].name}`;
      }
      break;
  }

  // how players react: a great drop brings lapsed players back, a flop starts a backlash
  const bigDrop = u.type === 'content' || u.type === 'expansion' || u.type === 'seasonal' || u.type === 'port';
  if (reception >= 75 && bigDrop) {
    g.active += lapsed * 0.04 * recF;
    g.viralMult = Math.max(g.viralMult, 1.2);
    g.viralUntil = Math.max(g.viralUntil, w.day + 10);
  } else if (reception < 35 && u.type !== 'hotfix') {
    g.backlashUntil = w.day + 30;
    g.goodwill -= 3;
  }
  // content makes the game permanently bigger
  // (your live-ops advantage: rival games refresh but don't grow)
  const grow = !c.isPlayer ? 0 : u.type === 'expansion' ? 3 : u.type === 'content' ? 1 : 0;
  if (grow) g.contentLevel = (g.contentLevel ?? 0) + grow;
  if (u.type === 'expansion') {
    g.verMajor = (g.verMajor ?? 0) + 1;
    g.verMinor = 0;
  } else if (u.type === 'content' || u.type === 'seasonal' || u.type === 'port') g.verMinor = (g.verMinor ?? 0) + 1;
  if (grow) label = `${label} (${versionLabel(g)})`;
  g.neglectWarned = false;
  g.updates.push({ day: w.day, type: u.type, reception: Math.round(reception), label });
  if (g.updates.length > 40) g.updates.splice(0, g.updates.length - 40);
  g.lastUpdateDay = w.day;
  g.update = null;
  g.hype = Math.min(1400, g.hype);
  if (c.isPlayer) {
    if (!startNextQueued(w, g, c)) for (const e of w.player.employees) if (e.assignment === g.id) e.assignment = null;
    pushNews(w, { kind: 'player', title: `${g.title}: ${label} is live`, body: `Player reception: ${Math.round(reception)}/100.`, companyId: c.id, gameId: g.id, tone: reception >= 60 ? 'good' : reception < 35 ? 'bad' : 'neutral' });
    addXp(w, Math.round((8 + reception / 6) * (u.type === 'expansion' ? 3 : bigDrop ? 1.5 : 1)));
    const body =
      reception >= 75 && bigDrop
        ? 'Players love it. Lapsed players are coming back.'
        : reception < 35 && u.type !== 'hotfix'
          ? 'Players hated it. Expect a month of backlash and higher churn.'
          : fatigue > 0
            ? 'Players are getting tired of the same kind of update. Mix it up.'
            : undefined;
    toast(w, `${g.title}: ${def.name} released (${Math.round(reception)}/100)`, reception >= 60 ? 'good' : reception < 35 ? 'bad' : 'neutral', { category: 'game', link: { route: 'game', id: g.id }, body });
  } else if (u.type === 'expansion' && g.peakCcu > 100000) {
    pushNews(w, { kind: 'release', title: `${c.name} launches a major expansion for ${g.title}`, companyId: c.id, gameId: g.id, tone: 'neutral' });
  }
}

/** Contract live-ops crew: output per person per day, and the skill they bring. */
export const CREW_OUTPUT = 1;
export const CREW_SKILL = 55;
/** What contractors charge per unit of work. */
export const CREW_WORK_COST = 250;
export const MAX_CONTENT_LEVEL = 30;

export function versionLabel(g: Game): string {
  return `v${1 + (g.verMajor ?? 0)}.${g.verMinor ?? 0}`;
}

export function contentLevelOf(g: Game): number {
  return Math.min(MAX_CONTENT_LEVEL, g.contentLevel ?? 0);
}

/** Shipping the same kind of update back to back wears players out. */
export function updateFatigue(w: World, g: Game, type: UpdateTypeId): number {
  if (type === 'hotfix' || type === 'port') return 0;
  let n = 0;
  for (const u of g.updates) if (u.type === type && w.day - u.day < 45) n++;
  return Math.min(18, n * 6);
}
