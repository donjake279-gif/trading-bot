// Live ops for your released games. Every game has a backlog of changes (fixes,
// balance, quality of life, content, events, cosmetics, expansions, ports...)
// that its live team works through in parallel, each person on what their role
// is good at. Finished changes wait for patch day (every Tuesday, every other
// Friday, whatever you choose) and ship together as one patch with notes and a
// version number. Shipping on schedule builds trust; bigger, varied patches go
// down better; QA and a public test server keep new bugs out; every few patches
// is a major update. Your live-ops lead can plan the backlog for you.
import { MONETIZATIONS, PLATFORMS, ROLES, SCOPES, UPDATES } from './constants';
import { bugDensity, hasResearch, memberOutput, teamFactors } from './development';
import { BIG_UPDATES, CREW_OUTPUT, CREW_SKILL, applyUpdateEffect, bumpVersion, updateCost, updateFatigue, updateReaction, updateWork, versionLabel } from './updates';
import { CREW_TARGET_DAYS, bestPort, crewFor, isAutoUpdated, liveOpsTeamSize, recruitTeam, updateValue } from './automation';
import { struggling } from './hr';
import { addXp, perkRank } from './progression';
import { pick, randInt, randNormal } from './rng';
import type { ActionResult, Employee, Game, PatchItem, PatchPlan, QueuedUpdate, RoleId, ScheduleDefaults, UpdateRecord, UpdateTypeId, World } from './types';
import { clamp, dayToDate, fansFromRep, fmtFans, gamesOf, newId, playerCompany, pushNews, toast } from './util';

const fail = (error: string): ActionResult => ({ ok: false, error });
const ok = (id?: string): ActionResult => ({ ok: true, id });

export const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
export const CADENCES = [1, 2, 3, 4, 6, 8];
export const DEFAULT_SCHEDULE: ScheduleDefaults = { scheduled: true, weekday: 2, everyWeeks: 2, minItems: 1, majorEvery: 4, testServer: false };
export const MAX_BACKLOG = 12;
/** How many changes the team works on at once. */
export const SPRINT_SIZE = 4;
export const TEST_SERVER_DAYS = 7;
export const CRUNCH_DAYS = 3;

/** Who is good at what. The founder is good at everything. */
export const UPDATE_ROLES: Record<UpdateTypeId, RoleId[]> = {
  hotfix: ['programmer', 'qa'],
  performance: ['programmer', 'qa'],
  balance: ['designer', 'qa'],
  qol: ['designer', 'programmer'],
  content: ['designer', 'artist', 'writer', 'audio'],
  seasonal: ['artist', 'designer', 'audio'],
  cosmetics: ['artist'],
  expansion: ['designer', 'artist', 'writer', 'programmer', 'audio'],
  monetization: ['designer', 'producer'],
  port: ['programmer'],
};

/** Off-role work is slower. */
const OFF_ROLE = 0.6;

export function fitsRole(e: Employee, type: UpdateTypeId): boolean {
  return e.role === 'founder' || UPDATE_ROLES[type].includes(e.role);
}

/** Live-ops experience level, 0..10: +3% patch output and better reception per level. */
export function liveLevel(e: Employee): number {
  return Math.min(10, Math.floor(Math.sqrt((e.liveXp ?? 0) / 2)));
}

export function weekdayOf(day: number): number {
  return dayToDate(day).getUTCDay();
}

/** The first day after `after` that falls on `weekday`. */
export function nextOnWeekday(after: number, weekday: number): number {
  const d = after + 1;
  return d + ((weekday - weekdayOf(d) + 7) % 7);
}

export function scheduleDefaults(w: World): ScheduleDefaults {
  return w.player.liveOps?.defaults ?? DEFAULT_SCHEDULE;
}

export function newPlan(w: World): PatchPlan {
  const d = scheduleDefaults(w);
  return {
    backlog: [],
    scheduled: d.scheduled,
    weekday: d.weekday,
    everyWeeks: d.everyWeeks,
    minItems: d.minItems,
    majorEvery: d.majorEvery,
    testServer: d.testServer,
    crunch: false,
    teamTarget: 0,
    nextDay: nextOnWeekday(w.day, d.weekday),
    streak: 0,
    bestStreak: 0,
    slipped: 0,
    patches: 0,
    planDay: -999,
  };
}

/** The game's plan, created on first use. */
export function planOf(w: World, g: Game): PatchPlan {
  return (g.patchPlan ??= newPlan(w));
}

export function liveTeam(w: World, g: Game): Employee[] {
  return w.player.employees.filter((e) => e.assignment === g.id && ROLES[e.role].dev);
}

export function makeItem(w: World, g: Game, q: QueuedUpdate, auto = false): PatchItem {
  return {
    id: newId(w, 'pi'),
    type: q.type,
    platform: q.platform,
    monetization: q.monetization,
    work: updateWork(w, g, q.type, true, q.platform),
    done: 0,
    cost: updateCost(g, q.type, q.platform),
    paid: false,
    crew: 0,
    added: w.day,
    ready: null,
    auto: auto || undefined,
  };
}

/** Will the next patch be a major update? */
export function nextIsMajor(plan: PatchPlan): boolean {
  return plan.majorEvery > 0 && (plan.patches + 1) % plan.majorEvery === 0;
}

// ------------------------------------------------------------ the daily loop

export function patchesDaily(w: World): void {
  const p = playerCompany(w);
  if (!p || p.status !== 'active') return;
  let teams: Map<string, Employee[]> | null = null;
  const teamOf = (id: string): Employee[] => {
    if (!teams) {
      teams = new Map();
      for (const e of w.player.employees) {
        if (!e.assignment || !ROLES[e.role].dev) continue;
        const list = teams.get(e.assignment);
        if (list) list.push(e);
        else teams.set(e.assignment, [e]);
      }
    }
    return teams.get(id) ?? [];
  };
  for (const g of gamesOf(w, p.id)) {
    if (g.status !== 'released') continue;
    const plan = planOf(w, g);
    const auto = isAutoUpdated(w, g);
    if (auto && w.day - plan.planDay >= 7) planBacklog(w, g, plan, teamOf(g.id).length);
    const due = plan.scheduled && w.day >= plan.nextDay;
    if (!plan.backlog.length && !due && !(plan.teamTarget > 0)) continue;
    let team = teamOf(g.id);
    const staffed = staffTeam(w, g, plan, team, auto);
    if (staffed !== team) {
      team = staffed;
      teams = null;
    }
    workDay(w, g, plan, team);
    releaseCheck(w, g, plan);
    // nobody stays on a game with nothing to do, unless it has a dedicated team
    if (plan.teamTarget === 0 && team.length && !plan.backlog.some((i) => i.done < i.work)) {
      for (const e of team) e.assignment = null;
      teams = null;
    }
  }
}

function idleDevs(w: World): Employee[] {
  return w.player.employees.filter((e) => !e.assignment && ROLES[e.role].dev);
}

/** Keep dedicated teams at strength; auto-updated games borrow people when there's work and nobody on it. */
function staffTeam(w: World, g: Game, plan: PatchPlan, team: Employee[], auto: boolean): Employee[] {
  const open = plan.backlog.some((i) => i.done < i.work);
  if (plan.teamTarget > team.length && (w.day + g.id.length) % 7 === 0) {
    const add = idleDevs(w).slice(0, plan.teamTarget - team.length);
    if (add.length) {
      for (const e of add) e.assignment = g.id;
      return [...team, ...add];
    }
  }
  if (!auto || !open || team.length) return team;
  const tight = struggling(w);
  const crewOn = w.player.liveOps.crew;
  // with contractors on call, only free developers join; without them, borrow a few from projects
  const pickd = crewOn || tight ? idleDevs(w).slice(0, liveOpsTeamSize(g)) : recruitTeam(w, liveOpsTeamSize(g));
  if (!pickd.length) return team;
  for (const e of pickd) e.assignment = g.id;
  return pickd;
}

/** How long contractors get for a change: small ones should make the next patch day. */
export function crewDays(plan: PatchPlan, type: UpdateTypeId): number {
  const base = CREW_TARGET_DAYS[type];
  if (!plan.scheduled || BIG_UPDATES.includes(type)) return base;
  return Math.min(base, Math.max(3, 7 * plan.everyWeeks - 2 - (plan.testServer ? TEST_SERVER_DAYS : 0)));
}

/** Pay for a change when work on it starts, and hire contractors if it would run late. */
function startItem(w: World, g: Game, plan: PatchPlan, it: PatchItem, teamSize: number, openCount: number): boolean {
  const p = playerCompany(w);
  const crewOn = w.player.liveOps.crew && !struggling(w);
  const { crew, cost: crewCost } = crewOn && (it.auto || teamSize === 0) ? crewFor(w, g, { type: it.type, platform: it.platform }, teamSize / Math.max(1, openCount), crewDays(plan, it.type)) : { crew: 0, cost: 0 };
  const cost = updateCost(g, it.type, it.platform) + crewCost;
  if (p.cash < cost) return false;
  p.cash -= cost;
  p.ledger.development += cost;
  it.cost = cost;
  it.crew = crew;
  it.paid = true;
  return true;
}

export function crunching(w: World, plan: PatchPlan): boolean {
  return plan.crunch && plan.scheduled && plan.nextDay >= w.day && plan.nextDay - w.day <= CRUNCH_DAYS;
}

function workDay(w: World, g: Game, plan: PatchPlan, team: Employee[]): void {
  let openCount = 0;
  for (const it of plan.backlog) if (it.done < it.work) openCount++;
  if (!openCount) return;
  const sprint: PatchItem[] = [];
  for (const it of plan.backlog) {
    if (sprint.length >= SPRINT_SIZE) break;
    if (it.done >= it.work) continue;
    if (!it.paid && !startItem(w, g, plan, it, team.length, openCount)) continue;
    sprint.push(it);
  }
  if (!sprint.length) return;
  const crunch = crunching(w, plan);
  if (team.length) {
    const { teamEff, producerBoost } = teamFactors(team, g.scope);
    for (const e of team) {
      const target = sprint.find((it) => it.done < it.work && fitsRole(e, it.type)) ?? sprint.find((it) => it.done < it.work);
      if (!target) break;
      const out = memberOutput(w, e, g.focus, false, teamEff, producerBoost).work * (1 + 0.03 * liveLevel(e)) * (crunch ? 1.35 : 1);
      target.done += out * (fitsRole(e, target.type) ? 1 : OFF_ROLE);
      e.xp += 0.015;
      if (crunch) e.morale = Math.max(0, e.morale - 0.6);
    }
  }
  for (const it of sprint) {
    if (it.crew) it.done += it.crew * CREW_OUTPUT;
    if (it.done >= it.work && it.ready === null) {
      it.done = it.work;
      it.ready = w.day + (plan.testServer ? TEST_SERVER_DAYS : 0);
    }
  }
}

export function readyItems(w: World, plan: PatchPlan): PatchItem[] {
  return plan.backlog.filter((i) => i.ready !== null && i.ready <= w.day);
}

function releaseCheck(w: World, g: Game, plan: PatchPlan): void {
  let ready = readyItems(w, plan);
  // critical bugs don't wait for patch day
  if (ready.some((i) => i.type === 'hotfix') && bugDensity(g) > 2.5) {
    shipPatch(w, g, plan, ready.filter((i) => i.type === 'hotfix' || i.type === 'performance'), 'hotfix');
    ready = readyItems(w, plan);
  }
  if (plan.scheduled) {
    if (w.day < plan.nextDay) return;
    if (ready.length && ready.length >= plan.minItems) {
      plan.streak += 1;
      plan.bestStreak = Math.max(plan.bestStreak, plan.streak);
      shipPatch(w, g, plan, ready, 'scheduled');
    } else if (plan.backlog.length) slip(w, g, plan);
    const step = 7 * plan.everyWeeks;
    plan.nextDay += step;
    while (plan.nextDay <= w.day) plan.nextDay += step;
    return;
  }
  const inProgress = plan.backlog.some((i) => i.ready === null);
  if (ready.length && (ready.length >= plan.minItems || !inProgress)) shipPatch(w, g, plan, ready, 'asap');
}

function slip(w: World, g: Game, plan: PatchPlan): void {
  plan.slipped += 1;
  const hadStreak = plan.streak;
  plan.streak = 0;
  if (g.active < 2000) return;
  g.goodwill -= 1;
  const key = `slip:${g.id}`;
  if (w.day - (w.player.flags[key] ?? -999) < 60) return;
  w.player.flags[key] = w.day;
  toast(w, `${g.title} missed patch day`, 'neutral', {
    category: 'game',
    link: { route: 'game', id: g.id },
    body: hadStreak >= 3 ? `Nothing was ready. Your ${hadStreak}-patch streak is over and players noticed.` : 'Nothing was ready to ship. Players noticed.',
  });
}

// ------------------------------------------------------------ shipping

type ShipKind = 'scheduled' | 'asap' | 'hotfix' | 'manual';

const ORDER: UpdateTypeId[] = ['hotfix', 'performance', 'balance', 'qol', 'monetization', 'port', 'cosmetics', 'seasonal', 'content', 'expansion'];
const NAME_A = ['Frozen', 'Neon', 'Crimson', 'Hollow', 'Iron', 'Starlit', 'Savage', 'Silent', 'Golden', 'Shattered', 'Endless', 'Wild', 'Emerald', 'Burning', 'Midnight', 'Sunken'];
const NAME_B = ['Frontier', 'Uprising', 'Tides', 'Crown', 'Horizon', 'Reckoning', 'Echoes', 'Dominion', 'Bloom', 'Depths', 'Legacy', 'Rift', 'Harvest', 'Storm', 'Kingdom', 'Odyssey'];
const QOL = ['Added a photo mode', 'Fully remappable controls', 'Menus load twice as fast', 'Better matchmaking', 'Cross-save between platforms', 'New colorblind modes', 'Skippable cutscenes', 'A proper inventory sort', 'Auto-save on quit', 'Ping display in lobbies'];
const SEASONS = ['Winter Festival', 'Lunar New Year', 'Spring Bloom', 'Spring Bloom', 'Summer Kickoff', 'Summer Games', 'Summer Games', 'Back to School', 'Harvest Moon', 'Halloween Nights', 'Feast Week', 'Winter Festival'];

function noteFor(w: World, g: Game, it: PatchItem, label: string): string {
  switch (it.type) {
    case 'hotfix':
      return `Fixed ${randInt(w, 12, 90)} bugs, including a crash on ${PLATFORMS[pick(w, g.platforms)].name}`;
    case 'performance':
      return `Loading times cut by ${randInt(w, 15, 45)}% and ${randInt(w, 20, 60)}% fewer crashes`;
    case 'balance':
      return `Rebalanced ${randInt(w, 8, 40)} weapons, abilities and items`;
    case 'qol':
      return pick(w, QOL);
    case 'content':
      return `New: ${randInt(w, 2, 6)} maps, ${randInt(w, 1, 3)} modes and ${randInt(w, 10, 40)} items`;
    case 'seasonal':
      return `${SEASONS[dayToDate(w.day).getUTCMonth()]} event: 30 days of limited-time rewards`;
    case 'cosmetics':
      return `${randInt(w, 8, 30)} new cosmetics in the store`;
    case 'expansion':
      return `Expansion "${pick(w, NAME_A)} ${pick(w, NAME_B)}": a new region and ${randInt(w, 10, 30)} hours of story`;
    default:
      return label;
  }
}

function summarize(items: PatchItem[]): string {
  const counts = new Map<UpdateTypeId, number>();
  for (const i of items) counts.set(i.type, (counts.get(i.type) ?? 0) + 1);
  const parts: string[] = [];
  for (const t of ORDER) {
    const n = counts.get(t);
    if (!n) continue;
    parts.push(n > 1 ? `${n}× ${UPDATES[t].name}` : UPDATES[t].name);
  }
  return parts.join(', ');
}

/** Ship a bundle of finished changes as one patch. */
export function shipPatch(w: World, g: Game, plan: PatchPlan, items: PatchItem[], kind: ShipKind): UpdateRecord | null {
  if (!items.length) return null;
  const p = playerCompany(w);
  const team = liveTeam(w, g);
  const sorted = [...items].sort((a, b) => ORDER.indexOf(a.type) - ORDER.indexOf(b.type));
  const types = sorted.map((i) => i.type);
  const distinct = [...new Set(types)];
  // who made it
  const crew = Math.min(sorted.reduce((s, i) => s + i.crew, 0), Math.max(3, team.length));
  let skill = 0;
  let lvl = 0;
  for (const e of team) {
    skill += e.skill;
    lvl += liveLevel(e);
  }
  const avgSkill = team.length + crew > 0 ? (skill + CREW_SKILL * crew) / (team.length + crew) : 45;
  const major = kind !== 'hotfix' && nextIsMajor(plan) && distinct.some((t) => BIG_UPDATES.includes(t));
  const onTime = kind === 'scheduled';
  let rec = 42 + (avgSkill - 50) * 0.7 + randNormal(w, 0, 8);
  if (hasResearch(w, 'liveOps')) rec += 8;
  rec += 3 * perkRank(w, 'patch');
  rec += team.length ? (lvl / team.length) * 0.6 : 0;
  // a bit of everything goes down well
  rec += Math.min(9, 3 * (distinct.length - 1));
  if (plan.testServer) rec += 4;
  if (onTime) rec += Math.min(6, plan.streak - 1);
  if (major) rec += 4;
  const fatigue = Math.max(0, ...distinct.map((t) => updateFatigue(w, g, t))) * (distinct.length >= 3 ? 0.5 : 1);
  rec = clamp(rec - fatigue, 5, 98);
  const recF = rec / 70;
  // the changes themselves
  const notes: string[] = [];
  for (const it of sorted) {
    const label = applyUpdateEffect(w, g, p, it.type, recF, { platform: it.platform, monetization: it.monetization });
    notes.push(noteFor(w, g, it, label));
  }
  // new bugs sneak in with every change; QA and a test server catch most of them
  const work = sorted.reduce((s, i) => s + i.work, 0);
  const qaShare = team.length ? team.filter((e) => e.role === 'qa').length / team.length : 0;
  const regressions = work * 0.02 * (1 - Math.min(0.8, qaShare * 3)) * (plan.testServer ? 0.35 : 1) * (plan.crunch ? 1.3 : 1);
  g.bugs += regressions;
  if ((regressions / Math.max(1, g.workRequired)) * 100 > 0.3) notes.push('Known issues: a few new bugs slipped through testing');
  updateReaction(w, g, rec, distinct);
  bumpVersion(g, distinct);
  if (major) {
    g.hype += 40 * recF;
    g.viralMult = Math.max(g.viralMult, 1.15);
    g.viralUntil = Math.max(g.viralUntil, w.day + 7);
  }
  if (onTime) {
    g.hype += 3;
    g.goodwill += 0.5;
  }
  g.hype = Math.min(1400, g.hype);
  const ver = versionLabel(g);
  const fixesOnly = distinct.every((t) => t === 'hotfix' || t === 'performance');
  const title = kind === 'hotfix' && fixesOnly ? `Hotfix ${ver}` : major ? `Major update ${ver} “${pick(w, NAME_A)} ${pick(w, NAME_B)}”` : `Patch ${ver}`;
  const dominant = sorted.reduce((a, b) => (b.work > a.work ? b : a)).type;
  const record: UpdateRecord = { day: w.day, type: dominant, reception: Math.round(rec), label: `${title} · ${summarize(sorted)}`, items: types, notes, major: major || undefined, onTime: onTime || undefined };
  g.updates.push(record);
  if (g.updates.length > 40) g.updates.splice(0, g.updates.length - 40);
  g.lastUpdateDay = w.day;
  g.neglectWarned = false;
  plan.patches += 1;
  // the lead plans the next patch straight away
  plan.planDay = -999;
  const shipped = new Set(sorted.map((i) => i.id));
  plan.backlog = plan.backlog.filter((i) => !shipped.has(i.id));
  // the people behind it
  for (const e of team) {
    e.liveXp = (e.liveXp ?? 0) + 1 + 0.5 * (sorted.length - 1);
    e.morale = clamp(e.morale + (rec >= 75 ? 3 : rec < 35 ? -4 : 1), 0, 100);
  }
  let xp = 0;
  for (const t of types) xp += (6 + rec / 8) * (t === 'expansion' ? 3 : BIG_UPDATES.includes(t) ? 1.5 : 1);
  addXp(w, Math.round(xp * (major ? 1.3 : 1)));
  const bigDrop = distinct.some((t) => BIG_UPDATES.includes(t));
  const tone = rec >= 60 ? 'good' : rec < 35 ? 'bad' : 'neutral';
  pushNews(w, { kind: 'player', title: `${g.title}: ${title} is live`, body: `${summarize(sorted)}. Player reception: ${Math.round(rec)}/100.`, companyId: p.id, gameId: g.id, tone });
  const why =
    rec >= 75 && bigDrop
      ? 'Players love it. Lapsed players are coming back.'
      : rec < 35 && !fixesOnly
        ? 'Players hated it. Expect a month of backlash.'
        : fatigue > 0
          ? 'Players are tired of the same kind of change. Mix it up.'
          : onTime && plan.streak >= 3
            ? `${plan.streak} patches on schedule in a row: players trust you.`
            : undefined;
  toast(w, `${g.title} ${title.replace(/^Patch /, 'patch ')}: ${sorted.length} change${sorted.length === 1 ? '' : 's'} (${Math.round(rec)}/100)`, major ? 'major' : tone, { category: 'game', link: { route: 'game', id: g.id }, body: why });
  return record;
}

// ------------------------------------------------------------ the live-ops lead

function lastBigDay(g: Game): number {
  for (let i = g.updates.length - 1; i >= 0; i--) {
    const u = g.updates[i];
    if ((u.items ?? [u.type]).some((t) => BIG_UPDATES.includes(t))) return u.day;
  }
  return g.releaseDay ?? 0;
}

/** Plan the backlog the way a sensible live-ops lead would. */
export function planBacklog(w: World, g: Game, plan: PatchPlan, teamSize: number): void {
  plan.planDay = w.day;
  // games nobody plays get nothing, not even patches
  if (g.active < 100 && g.rev30 < 500) return;
  const has = (t: UpdateTypeId) => plan.backlog.some((i) => i.type === t);
  // quick wins go ahead of big content so something is always ready for patch day
  const add = (q: QueuedUpdate, front = false, valueMult = 2, quick = false): boolean => {
    if (plan.backlog.length >= MAX_BACKLOG) return false;
    const base = updateCost(g, q.type, q.platform);
    const crew = w.player.liveOps.crew ? crewFor(w, g, q, teamSize, crewDays(plan, q.type)).cost : 0;
    if (playerCompany(w).cash < (base + crew) * 3) return false;
    // every change has to be worth what it costs
    if (updateValue(g, q.type) < valueMult * (base + crew)) return false;
    const it = makeItem(w, g, q, true);
    const firstBig = plan.backlog.findIndex((i) => BIG_UPDATES.includes(i.type) && i.ready === null);
    if (front) plan.backlog.unshift(it);
    else if (quick && firstBig >= 0) plan.backlog.splice(firstBig, 0, it);
    else plan.backlog.push(it);
    return true;
  };
  if (bugDensity(g) > 1.5 && !has('hotfix')) add({ type: 'hotfix' }, true, 1);
  if (struggling(w)) return;
  if (plan.backlog.filter((i) => i.done < i.work).length >= 6) return;
  const f2p = !MONETIZATIONS[g.monetization].upfront;
  const gap = g.scope === 'tiny' ? 90 : f2p ? 35 : 55;
  const since = w.day - lastBigDay(g);
  const major = nextIsMajor(plan);
  const age = w.day - (g.releaseDay ?? w.day);
  if (!plan.backlog.some((i) => BIG_UPDATES.includes(i.type)) && (since >= gap || (major && since >= gap / 2))) {
    const recentPort = g.updates.some((u) => (u.items ?? [u.type]).includes('port') && w.day - u.day < 180);
    const platform = !recentPort && age > 120 && (g.owners >= 200000 || g.peakActive >= 20000) ? bestPort(w, g) : null;
    if (platform) add({ type: 'port', platform });
    else {
      const expansions = g.updates.filter((u) => (u.items ?? [u.type]).includes('expansion')).length;
      const bigN = g.updates.filter((u) => (u.items ?? [u.type]).some((t) => t === 'content' || t === 'expansion' || t === 'seasonal')).length;
      const options: UpdateTypeId[] = [];
      if (g.scope !== 'tiny' && age > 200 && expansions < 4 && (major || bigN % 3 === 2)) options.push('expansion');
      options.push('content');
      if (f2p) options.push('seasonal');
      options.sort((a, b) => updateFatigue(w, g, a) - updateFatigue(w, g, b));
      add({ type: options[0] });
    }
  }
  // busy games always have a few small changes in the pipeline so every patch
  // day has something to ship (more for longer gaps, bigger games and bigger bundles)
  if (g.active > 2000) {
    const target = plan.scheduled ? Math.min(4, Math.max(1, plan.everyWeeks) + (g.active > 50000 ? 1 : 0) + (plan.testServer ? 1 : 0)) : Math.min(4, plan.minItems - 1);
    const small: UpdateTypeId[] = ['balance', 'qol', 'performance'];
    if (f2p || g.active > 20000) small.push('cosmetics');
    const lastOf = (t: UpdateTypeId) => {
      for (let i = g.updates.length - 1; i >= 0; i--) if ((g.updates[i].items ?? [g.updates[i].type]).includes(t)) return g.updates[i].day;
      return -9999;
    };
    const pending = () => plan.backlog.filter((i) => !BIG_UPDATES.includes(i.type) && i.type !== 'hotfix' && i.ready === null);
    for (let guard = 0; guard < 4 && pending().length < target; guard++) {
      // variety first: kinds not already waiting, then the least tiring, then the longest ago
      const options = small.filter((t) => !plan.backlog.some((i) => i.type === t));
      if (!options.length) break;
      options.sort((a, b) => updateFatigue(w, g, a) - updateFatigue(w, g, b) || lastOf(a) - lastOf(b));
      if (!add({ type: options[0] }, false, 2, true)) break;
    }
  }
}

// ------------------------------------------------------------ player actions

function ownLive(w: World, gameId: string): Game | null {
  const g = w.games[gameId];
  return g && g.companyId === w.player.companyId && g.status === 'released' ? g : null;
}

function validate(w: World, g: Game, plan: PatchPlan, q: QueuedUpdate, adding: QueuedUpdate[]): string | null {
  const c = playerCompany(w);
  if (!UPDATES[q.type]) return 'Unknown change.';
  if (q.type === 'port') {
    if (!q.platform) return 'Choose a platform for the port.';
    if (g.platforms.includes(q.platform)) return `Already on ${PLATFORMS[q.platform].name}.`;
    if (c.reputation < PLATFORMS[q.platform].minRep) return `${PLATFORMS[q.platform].name} needs ${fmtFans(fansFromRep(PLATFORMS[q.platform].minRep))} fans.`;
    if (plan.backlog.some((i) => i.type === 'port' && i.platform === q.platform) || adding.filter((x) => x.type === 'port' && x.platform === q.platform).length > 1) return `A port to ${PLATFORMS[q.platform].name} is already planned.`;
  }
  if (q.type === 'monetization' && !q.monetization) return 'Choose a business model.';
  if (q.type === 'expansion') {
    const shipped = g.updates.filter((u) => (u.items ?? [u.type]).includes('expansion')).length;
    const planned = plan.backlog.filter((i) => i.type === 'expansion').length + adding.filter((x) => x.type === 'expansion').length;
    if (shipped + planned > 4) return 'Players are tired of expansions for this game.';
  }
  return null;
}

/** Add changes to a game's next patches (and optionally put people on its live team). */
export function addPatchItems(w: World, gameId: string, items: QueuedUpdate[], teamIds: string[] = []): ActionResult {
  const g = ownLive(w, gameId);
  if (!g) return fail('Game is not live.');
  if (!items.length) return fail('Pick at least one change.');
  const plan = planOf(w, g);
  if (plan.backlog.length + items.length > MAX_BACKLOG) return fail(`The backlog holds ${MAX_BACKLOG} changes. Ship some first.`);
  for (const q of items) {
    const err = validate(w, g, plan, q, items);
    if (err) return fail(err);
  }
  for (const id of teamIds) {
    const e = w.player.employees.find((x) => x.id === id);
    if (e && ROLES[e.role].dev) e.assignment = g.id;
  }
  for (const q of items) plan.backlog.push(makeItem(w, g, q));
  return ok();
}

export function removePatchItem(w: World, gameId: string, itemId: string): ActionResult {
  const g = ownLive(w, gameId);
  const plan = g?.patchPlan;
  if (!g || !plan || !plan.backlog.some((i) => i.id === itemId)) return fail('Nothing to remove.');
  plan.backlog = plan.backlog.filter((i) => i.id !== itemId);
  return ok();
}

export function movePatchItem(w: World, gameId: string, itemId: string, delta: number): ActionResult {
  const g = ownLive(w, gameId);
  const plan = g?.patchPlan;
  if (!g || !plan) return fail('Nothing to move.');
  const i = plan.backlog.findIndex((x) => x.id === itemId);
  const j = i + delta;
  if (i < 0 || j < 0 || j >= plan.backlog.length) return fail('It can’t move further.');
  const [it] = plan.backlog.splice(i, 1);
  plan.backlog.splice(j, 0, it);
  return ok();
}

/** Drop every change that hasn't shipped (money already spent is gone). */
export function clearBacklog(w: World, gameId: string): ActionResult {
  const g = ownLive(w, gameId);
  const plan = g?.patchPlan;
  if (!g || !plan || !plan.backlog.length) return fail('The backlog is empty.');
  plan.backlog = [];
  if (plan.teamTarget === 0) for (const e of w.player.employees) if (e.assignment === g.id) e.assignment = null;
  return ok();
}

export type PlanSettings = Partial<Pick<PatchPlan, 'scheduled' | 'weekday' | 'everyWeeks' | 'minItems' | 'majorEvery' | 'testServer' | 'crunch' | 'teamTarget'>>;

function applySettings(w: World, g: Game, plan: PatchPlan, s: PlanSettings): void {
  const reschedule = (s.weekday !== undefined && s.weekday !== plan.weekday) || (s.everyWeeks !== undefined && s.everyWeeks !== plan.everyWeeks) || (s.scheduled === true && !plan.scheduled);
  if (s.scheduled !== undefined) plan.scheduled = s.scheduled;
  if (s.weekday !== undefined) plan.weekday = clamp(Math.round(s.weekday), 0, 6);
  if (s.everyWeeks !== undefined) plan.everyWeeks = CADENCES.includes(s.everyWeeks) ? s.everyWeeks : plan.everyWeeks;
  if (s.minItems !== undefined) plan.minItems = clamp(Math.round(s.minItems), 1, 6);
  if (s.majorEvery !== undefined) plan.majorEvery = clamp(Math.round(s.majorEvery), 0, 12);
  if (s.testServer !== undefined) plan.testServer = s.testServer;
  if (s.crunch !== undefined) plan.crunch = s.crunch;
  if (s.teamTarget !== undefined) plan.teamTarget = clamp(Math.round(s.teamTarget), 0, SCOPES[g.scope].maxTeam);
  if (reschedule) {
    plan.nextDay = nextOnWeekday(w.day, plan.weekday);
    // a new schedule takes a while for players to trust
    plan.streak = 0;
  }
}

export function setPatchPlan(w: World, gameId: string, s: PlanSettings): ActionResult {
  const g = ownLive(w, gameId);
  if (!g) return fail('Game is not live.');
  const plan = planOf(w, g);
  applySettings(w, g, plan, s);
  if (s.teamTarget !== undefined && plan.teamTarget > 0) {
    const have = liveTeam(w, g).length;
    for (const e of idleDevs(w).slice(0, Math.max(0, plan.teamTarget - have))) e.assignment = g.id;
  }
  return ok();
}

/** Ship everything that's ready right now, without waiting for patch day. */
export function shipPatchNow(w: World, gameId: string): ActionResult {
  const g = ownLive(w, gameId);
  const plan = g?.patchPlan;
  if (!g || !plan) return fail('Game is not live.');
  const ready = readyItems(w, plan);
  if (!ready.length) return fail('Nothing is ready to ship yet.');
  shipPatch(w, g, plan, ready, 'manual');
  if (plan.teamTarget === 0 && !plan.backlog.some((i) => i.done < i.work)) for (const e of w.player.employees) if (e.assignment === g.id) e.assignment = null;
  return ok();
}

/** Studio-wide schedule for new live games, optionally applied to every live game now. */
export function setScheduleDefaults(w: World, patch: Partial<ScheduleDefaults>, applyToAll = false): ActionResult {
  const cur = { ...scheduleDefaults(w), ...patch };
  cur.weekday = clamp(Math.round(cur.weekday), 0, 6);
  if (!CADENCES.includes(cur.everyWeeks)) cur.everyWeeks = DEFAULT_SCHEDULE.everyWeeks;
  cur.minItems = clamp(Math.round(cur.minItems), 1, 6);
  cur.majorEvery = clamp(Math.round(cur.majorEvery), 0, 12);
  w.player.liveOps.defaults = cur;
  if (applyToAll) {
    for (const g of gamesOf(w, w.player.companyId)) {
      if (g.status !== 'released') continue;
      applySettings(w, g, planOf(w, g), { scheduled: cur.scheduled, weekday: cur.weekday, everyWeeks: cur.everyWeeks, minItems: cur.minItems, majorEvery: cur.majorEvery, testServer: cur.testServer });
    }
  }
  return ok();
}

// ------------------------------------------------------------ for the UI

export type ItemStatus = 'waiting' | 'unpaid' | 'working' | 'testing' | 'ready';

export function itemStatus(w: World, it: PatchItem, index: number, plan: PatchPlan): ItemStatus {
  if (it.ready !== null) return it.ready <= w.day ? 'ready' : 'testing';
  if (it.paid) return 'working';
  // only the first few open changes are being worked on
  let open = 0;
  for (let i = 0; i < index; i++) if (plan.backlog[i].done < plan.backlog[i].work) open++;
  return open < SPRINT_SIZE ? 'unpaid' : 'waiting';
}

/** Rough daily output the live team (plus contractors) puts into the backlog. */
export function liveDailyWork(w: World, g: Game, team = liveTeam(w, g)): number {
  if (!team.length) return 0;
  const { teamEff, producerBoost } = teamFactors(team, g.scope);
  let t = 0;
  for (const e of team) t += memberOutput(w, e, g.focus, false, teamEff, producerBoost).work * (1 + 0.03 * liveLevel(e));
  return t;
}

/** One-line summary for lists. */
export function patchSummary(w: World, g: Game): string {
  const plan = g.patchPlan;
  if (!plan) return '';
  const ready = readyItems(w, plan).length;
  const open = plan.backlog.length;
  const when = plan.scheduled ? `next patch ${WEEKDAY_NAMES[weekdayOf(plan.nextDay)].slice(0, 3)} (${Math.max(0, plan.nextDay - w.day)}d)` : 'ships when ready';
  return open ? `${when} · ${ready}/${open} ready` : when;
}

/** Studio overview of every live game's patch pipeline. */
export function patchCalendar(w: World): { game: Game; plan: PatchPlan; team: number; ready: number; open: number }[] {
  const out: { game: Game; plan: PatchPlan; team: number; ready: number; open: number }[] = [];
  const size = new Map<string, number>();
  for (const e of w.player.employees) if (e.assignment) size.set(e.assignment, (size.get(e.assignment) ?? 0) + 1);
  for (const g of gamesOf(w, w.player.companyId)) {
    if (g.status !== 'released' || !g.patchPlan) continue;
    out.push({ game: g, plan: g.patchPlan, team: size.get(g.id) ?? 0, ready: readyItems(w, g.patchPlan).length, open: g.patchPlan.backlog.length });
  }
  return out;
}

/** What a team member is working on today (the same rule the daily loop uses). */
export function memberTask(e: Employee, plan: PatchPlan): PatchItem | null {
  const sprint: PatchItem[] = [];
  for (const it of plan.backlog) {
    if (sprint.length >= SPRINT_SIZE) break;
    if (it.done < it.work) sprint.push(it);
  }
  return sprint.find((it) => fitsRole(e, it.type)) ?? sprint[0] ?? null;
}
