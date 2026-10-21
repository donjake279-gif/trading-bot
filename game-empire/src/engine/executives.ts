// CEO personalities. A big empire needs a C-suite, and executives are people:
// loyal or not, ambitious, feuding with each other, and acting on their own.
// Great ones make every system stronger; disloyal ones get poached by rival
// megacorps, leak secrets, or try to take your chair.
import { corpById, activeCorps, shiftRelation } from './megacorps';
import { dlog, empireScale, execPower, featureOpen, fmtMoney } from './dominionCore';
import { pushDecision } from './events';
import { personName } from './names';
import type { ActionResult, DecisionEvent, ExecRole, ExecTrait, Executive, World } from './types';
import { bumpRep, clamp, fanChange, newId, playerCompany, spend, toast } from './util';
import { chance, pick, rand, randRange, shuffle } from './rng';

const fail = (error: string): ActionResult => ({ ok: false, error });
const ok = (id?: string): ActionResult => ({ ok: true, id });

export const EXEC_ROLES: Record<ExecRole, { name: string; short: string; blurb: string }> = {
  coo: { name: 'Chief Operating Officer', short: 'COO', blurb: 'Faster development and construction. Stronger in wars.' },
  cfo: { name: 'Chief Financial Officer', short: 'CFO', blurb: 'Cheaper wars and empire upkeep. Spots money problems early.' },
  cto: { name: 'Chief Technology Officer', short: 'CTO', blurb: 'Faster research, better AI and megaprojects, tougher cyber defences.' },
  cmo: { name: 'Chief Marketing Officer', short: 'CMO', blurb: 'Bigger keynotes, more hype, faster ecosystem growth.' },
  cso: { name: 'Chief Security Officer', short: 'CSO', blurb: 'Catches moles and runs your spy operations.' },
  counsel: { name: 'General Counsel', short: 'Counsel', blurb: 'Wins antitrust cases and lobbying, keeps emergencies under control.' },
};

export const EXEC_ROLE_IDS: ExecRole[] = ['coo', 'cfo', 'cto', 'cmo', 'cso', 'counsel'];

export const EXEC_TRAITS: Record<ExecTrait, { name: string; blurb: string }> = {
  visionary: { name: 'Visionary', blurb: 'Pitches bold pet projects. Some of them work.' },
  ruthless: { name: 'Ruthless', blurb: 'Gets results, sometimes by going after rivals without asking.' },
  cautious: { name: 'Cautious', blurb: 'Pulls back from risky fights when money is tight.' },
  showman: { name: 'Showman', blurb: 'Loves a big stage. Pitches spectacular campaigns.' },
  loyalist: { name: 'Loyalist', blurb: 'Loyalty fades slowly. Never sells you out.' },
  schemer: { name: 'Schemer', blurb: 'Brilliant at intrigue. Can turn on you when unhappy.' },
  workaholic: { name: 'Workaholic', blurb: 'Plays well above their skill.' },
  diplomat: { name: 'Diplomat', blurb: 'Quietly improves relations with rival megacorps.' },
};

const TRAIT_IDS = Object.keys(EXEC_TRAITS) as ExecTrait[];

/** Monthly pay scales with the size of the empire. */
export function execSalary(w: World, skill: number): number {
  return Math.round(Math.max(4e5, empireScale(w) * 0.00008 * Math.pow(skill / 70, 2)));
}

export function signingBonus(e: Executive): number {
  return e.salary * (e.fromCorp ? 10 : 6);
}

function makeExec(w: World, role: ExecRole, skillCenter: number, fromCorp: string | null): Executive {
  const skill = clamp(Math.round(randRange(w, skillCenter - 15, skillCenter + 15)), 35, 99);
  const traits = shuffle(w, [...TRAIT_IDS]).slice(0, chance(w, 0.45) ? 2 : 1);
  if (traits.includes('loyalist') && traits.includes('schemer')) traits.pop();
  const e: Executive = {
    id: newId(w, 'ex'),
    name: personName(w),
    role,
    skill: traits.includes('workaholic') ? Math.min(99, skill + 5) : skill,
    loyalty: Math.round(randRange(w, 55, 80)),
    ambition: Math.round(randRange(w, 20, 95)),
    traits,
    salary: 0,
    hired: w.day,
    feudWith: null,
    fromCorp,
    mole: null,
    lastAgenda: w.day,
    grants: 0,
  };
  e.salary = execSalary(w, e.skill) * (fromCorp ? 1.4 : 1);
  return e;
}

export function refreshExecPool(w: World): void {
  const d = w.player.dominion;
  d.execPoolDay = w.day;
  const pool: Executive[] = [];
  const roles = shuffle(w, [...EXEC_ROLE_IDS]);
  for (let i = 0; i < 4; i++) pool.push(makeExec(w, roles[i], randRange(w, 55, 78), null));
  // a star from a rival megacorp, sometimes
  const corps = activeCorps(w);
  if (corps.length && chance(w, 0.6)) {
    const c = pick(w, corps);
    const star = makeExec(w, pick(w, EXEC_ROLE_IDS), 86, c.id);
    // schemers plant their own people
    if (c.persona === 'schemer' ? chance(w, 0.35) : chance(w, 0.08)) star.mole = c.id;
    pool.push(star);
  }
  d.execPool = pool;
}

export function hireExec(w: World, candidateId: string): ActionResult {
  if (!featureOpen(w, 'execs')) return fail('Executives unlock at the Major Publisher level ($1B).');
  const d = w.player.dominion;
  const cand = d.execPool.find((x) => x.id === candidateId);
  if (!cand) return fail('That candidate is gone.');
  const bonus = signingBonus(cand);
  const p = playerCompany(w);
  if (p.cash < bonus) return fail(`Signing bonus ${fmtMoney(bonus)}.`);
  spend(p, 'execs', bonus);
  const old = d.execs.find((x) => x.role === cand.role);
  if (old) departExec(w, old, 'replaced');
  d.execPool = d.execPool.filter((x) => x.id !== cand.id);
  cand.hired = w.day;
  cand.lastAgenda = w.day;
  d.execs.push(cand);
  if (cand.fromCorp) {
    const c = corpById(w, cand.fromCorp);
    if (c) {
      c.intel = Math.max(0, c.intel - 8);
      shiftRelation(w, 'player', c.id, -10);
      dlog(w, `You poach ${cand.name} from ${c.name}. They are not pleased.`, 'good');
    }
  }
  // a careful security chief vets new hires
  if (cand.mole && chance(w, 0.35 * execPower(w, 'cso'))) {
    const c = corpById(w, cand.mole);
    cand.mole = null;
    toast(w, `Your CSO found ${cand.name} was still reporting to ${c?.name ?? 'a rival'}`, 'good', { category: 'team', link: { route: 'dominion', id: 'execs' }, body: 'They have been turned. Now they work for you.' });
  }
  return ok(cand.id);
}

/** Someone leaves: severance, and they may take what they know to a rival. */
function departExec(w: World, e: Executive, why: 'fired' | 'replaced' | 'quit' | 'poached', corpId?: string): void {
  const d = w.player.dominion;
  const p = playerCompany(w);
  d.execs = d.execs.filter((x) => x.id !== e.id);
  for (const o of d.execs) if (o.feudWith === e.id) o.feudWith = null;
  if (why === 'fired' || why === 'replaced') spend(p, 'execs', e.salary * 6);
  if (why === 'fired') for (const o of d.execs) o.loyalty = Math.max(0, o.loyalty - 4);
  const dest = corpId ? corpById(w, corpId) : activeCorps(w).length && chance(w, 0.5) ? pick(w, activeCorps(w)) : null;
  if (dest) {
    dest.intel = Math.min(100, dest.intel + (e.skill > 80 ? 12 : 6));
    dlog(w, `${e.name} (${EXEC_ROLES[e.role].short}) joins ${dest.name}, taking what they know.`, 'bad');
  }
}

export function fireExec(w: World, id: string): ActionResult {
  const e = w.player.dominion.execs.find((x) => x.id === id);
  if (!e) return fail('No such executive.');
  departExec(w, e, 'fired');
  dlog(w, `You fire ${e.name} (${EXEC_ROLES[e.role].short}).`);
  return ok();
}

export function grantCost(e: Executive): number {
  return Math.round(e.salary * 12 * (1 + e.grants * 0.5));
}

/** Stock grants buy loyalty (each one a little less). */
export function grantStock(w: World, id: string): ActionResult {
  const e = w.player.dominion.execs.find((x) => x.id === id);
  if (!e) return fail('No such executive.');
  const cost = grantCost(e);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Costs ${fmtMoney(cost)}.`);
  spend(p, 'execs', cost);
  e.loyalty = Math.min(100, e.loyalty + Math.max(6, 22 - e.grants * 4));
  e.ambition = Math.max(0, e.ambition - 5);
  e.grants += 1;
  return ok();
}

/** Settle a feud by backing one side. */
export function settleFeud(w: World, winnerId: string): ActionResult {
  const d = w.player.dominion;
  const win = d.execs.find((x) => x.id === winnerId);
  const lose = win?.feudWith ? d.execs.find((x) => x.id === win.feudWith) : null;
  if (!win || !lose) return fail('There is no feud to settle.');
  win.feudWith = null;
  lose.feudWith = null;
  win.loyalty = Math.min(100, win.loyalty + 10);
  lose.loyalty = Math.max(0, lose.loyalty - 28);
  dlog(w, `You back ${win.name} over ${lose.name}. ${lose.name} is furious.`);
  return ok();
}

/** Lock them in a room until they make up: works more often than not. */
export function mediateFeud(w: World, id: string): ActionResult {
  const d = w.player.dominion;
  const a = d.execs.find((x) => x.id === id);
  const b = a?.feudWith ? d.execs.find((x) => x.id === a.feudWith) : null;
  if (!a || !b) return fail('There is no feud to settle.');
  const odds = 0.55 + (a.traits.includes('diplomat') || b.traits.includes('diplomat') ? 0.25 : 0);
  if (chance(w, odds)) {
    a.feudWith = null;
    b.feudWith = null;
    toast(w, `${a.name} and ${b.name} have made peace`, 'good', { category: 'team', link: { route: 'dominion', id: 'execs' } });
  } else {
    a.loyalty = Math.max(0, a.loyalty - 8);
    b.loyalty = Math.max(0, b.loyalty - 8);
    toast(w, `Mediation failed: ${a.name} and ${b.name} are still at each other's throats`, 'bad', { category: 'team', link: { route: 'dominion', id: 'execs' } });
  }
  return ok();
}

// ------------------------------------------------------------ monthly life

export function execsMonthly(w: World): void {
  const d = w.player.dominion;
  if (!featureOpen(w, 'execs')) return;
  const p = playerCompany(w);
  if (w.day - d.execPoolDay >= 60 || !d.execPool.length) refreshExecPool(w);
  if (!d.execs.length) return;
  const hist = p.valuationHistory;
  const growing = hist.length > 90 ? p.valuation > hist[hist.length - 90][1] : true;
  const losingWar = d.wars.some((x) => (x.attackers.includes('player') ? x.score : -x.score) < -40 && (x.attackers.includes('player') || x.defenders.includes('player')));
  for (const e of [...d.execs]) {
    // salaries keep up with the size of the company
    e.salary = Math.max(e.salary, execSalary(w, e.skill) * 0.8);
    spend(p, 'execs', e.salary);
    let drift = growing ? 1 : -2;
    if (losingWar) drift -= 2;
    if (e.feudWith) drift -= 2;
    if (e.ambition > 70) drift -= 1;
    if (e.traits.includes('loyalist')) drift = Math.max(drift, 0) + 0.5;
    e.loyalty = clamp(e.loyalty + drift, 0, 100);
    if (e.skill < 95 && chance(w, 0.08)) e.skill += 1;
  }
  feuds(w);
  for (const e of [...d.execs]) {
    if (!d.execs.includes(e)) continue;
    if (poachAttempt(w, e)) continue;
    if (coupAttempt(w, e)) continue;
    agenda(w, e);
  }
  moles(w);
}

function feuds(w: World): void {
  const d = w.player.dominion;
  const free = d.execs.filter((e) => !e.feudWith);
  if (free.length >= 2 && chance(w, 0.06 + 0.04 * free.filter((e) => e.traits.includes('ruthless') || e.traits.includes('schemer')).length)) {
    const [a, b] = shuffle(w, [...free]);
    if (a.traits.includes('diplomat') && chance(w, 0.6)) return;
    a.feudWith = b.id;
    b.feudWith = a.id;
    toast(w, `Boardroom feud: ${a.name} vs ${b.name}`, 'bad', { category: 'team', link: { route: 'dominion', id: 'execs' }, body: `Your ${EXEC_ROLES[a.role].short} and ${EXEC_ROLES[b.role].short} are fighting. Both work worse until you settle it.` });
    dlog(w, `${a.name} (${EXEC_ROLES[a.role].short}) and ${b.name} (${EXEC_ROLES[b.role].short}) are feuding.`, 'bad');
  }
  for (const e of d.execs) {
    if (!e.feudWith || !chance(w, 0.06)) continue;
    const other = d.execs.find((x) => x.id === e.feudWith);
    const loser = other && other.loyalty < e.loyalty ? other : e;
    departExec(w, loser, 'quit');
    toast(w, `${loser.name} quits after the feud`, 'bad', { category: 'team', link: { route: 'dominion', id: 'execs' } });
    return;
  }
}

function poachAttempt(w: World, e: Executive): boolean {
  if (e.loyalty >= 32 || !featureOpen(w, 'wars')) return false;
  const corps = activeCorps(w);
  if (!corps.length || !chance(w, 0.18)) return false;
  const c = corps.reduce((a, b) => (b.intel - b.relation > a.intel - a.relation ? b : a));
  if (w.pendingEvents.some((x) => x.kind === 'execPoach')) return false;
  const match = Math.round(e.salary * 12);
  pushDecision(w, {
    kind: 'execPoach',
    title: `${c.name} is poaching your ${EXEC_ROLES[e.role].short}`,
    body: `${e.name} has an offer from ${c.name} and is tempted (loyalty ${Math.round(e.loyalty)}). Counter with a retention package (${fmtMoney(match)}, double pay) or let them walk, along with everything they know.`,
    options: [
      { id: 'match', label: `Counter-offer · ${fmtMoney(match)}`, description: 'Salary doubles, loyalty +30.', disabled: playerCompany(w).cash < match },
      { id: 'release', label: 'Let them go', description: `${c.name} gains intel on you.` },
    ],
    data: { execId: e.id, corpId: c.id, cost: match },
    expiresDay: w.day + 21,
    defaultOption: 'release',
  });
  return true;
}

function coupAttempt(w: World, e: Executive): boolean {
  if (e.ambition < 85 || e.loyalty > 22 || e.skill < 78 || !chance(w, 0.25)) return false;
  if (w.pendingEvents.some((x) => x.kind === 'execCoup')) return false;
  const p = playerCompany(w);
  const stake = p.founderShares / Math.max(1, p.shares);
  const severance = Math.round(e.salary * 24);
  pushDecision(w, {
    kind: 'execCoup',
    title: `${e.name} is plotting to replace you`,
    body: `Your ${EXEC_ROLES[e.role].name} has been lobbying the board to make them CEO. ${stake < 0.5 ? 'You don’t own a majority: the board is listening.' : 'You own a majority, so it can’t work, but the infighting is hurting the company.'} Fire them now (${fmtMoney(severance)} payout) or buy them off with a huge grant and a seat at the table.`,
    options: [
      { id: 'fire', label: `Fire them · ${fmtMoney(severance)}`, description: 'They leave for a rival with your secrets.' },
      { id: 'appease', label: 'Buy them off', description: 'Loyalty +35, ambition fed. Costs a year’s pay and some board confidence.' },
    ],
    data: { execId: e.id, cost: severance },
    expiresDay: w.day + 21,
    defaultOption: 'fire',
  });
  return true;
}

/** Executives with their own ideas: some ask first, some don't. */
function agenda(w: World, e: Executive): void {
  if (w.day - e.lastAgenda < 120 || !chance(w, 0.35)) return;
  e.lastAgenda = w.day;
  const d = w.player.dominion;
  const p = playerCompany(w);
  const t = e.traits;
  if (t.includes('ruthless') && featureOpen(w, 'wars') && activeCorps(w).length) {
    const c = activeCorps(w).reduce((a, b) => (b.relation < a.relation ? b : a));
    c.valuation *= 0.98;
    for (const s in c.power) c.power[s as keyof typeof c.power] *= 0.99;
    shiftRelation(w, 'player', c.id, -12);
    const scandal = chance(w, 0.3);
    const lost = scandal ? bumpRep(p, -3) : '';
    toast(w, `${e.name} went after ${c.name} without asking`, scandal ? 'bad' : 'neutral', { category: 'team', link: { route: 'dominion', id: 'execs' }, body: scandal ? `A smear campaign that blew up in the press: ${lost}.` : `A quiet campaign knocked ${c.name} back a little. They know it was you.` });
    dlog(w, `Your ${EXEC_ROLES[e.role].short} ${e.name} hit ${c.name} on their own initiative.`, scandal ? 'bad' : 'neutral');
    return;
  }
  if (t.includes('cautious') && d.wars.some((x) => (x.intensity.player ?? 0) > 1) && p.cash < empireScale(w) * 0.1) {
    for (const war of d.wars) if ((war.intensity.player ?? 0) > 1) war.intensity.player = (war.intensity.player ?? 1) - 1;
    toast(w, `${e.name} scaled back your war effort`, 'neutral', { category: 'team', link: { route: 'dominion', id: 'wars' }, body: 'Cash is tight, so your cautious executive lowered the intensity of your wars.' });
    return;
  }
  if (t.includes('diplomat') && activeCorps(w).length) {
    const c = activeCorps(w).reduce((a, b) => (b.relation < a.relation ? b : a));
    shiftRelation(w, 'player', c.id, 10);
    dlog(w, `${e.name} quietly mended fences with ${c.name}.`, 'good');
    return;
  }
  if (t.includes('visionary') || t.includes('showman')) {
    if (w.pendingEvents.some((x) => x.kind === 'execPitch')) return;
    const cost = Math.round(empireScale(w) * (t.includes('visionary') ? 0.006 : 0.003));
    const odds = clamp(0.4 + e.skill / 200, 0.4, 0.85);
    pushDecision(w, {
      kind: 'execPitch',
      title: t.includes('visionary') ? `${e.name} pitches a moonshot` : `${e.name} pitches a spectacular campaign`,
      body: t.includes('visionary')
        ? `Your ${EXEC_ROLES[e.role].short} wants ${fmtMoney(cost)} for a secret project. About ${Math.round(odds * 100)}% to pay off: research leaps ahead, a megaproject phase speeds up, or your AI gets smarter. Saying no will sting.`
        : `Your ${EXEC_ROLES[e.role].short} wants ${fmtMoney(cost)} for a global campaign. About ${Math.round(odds * 100)}% to land: hype for every game in development and new fans. Saying no will sting.`,
      options: [
        { id: 'fund', label: `Fund it · ${fmtMoney(cost)}`, description: 'Loyalty +8.', disabled: p.cash < cost },
        { id: 'deny', label: 'Not now', description: 'Loyalty -12.' },
      ],
      data: { execId: e.id, cost, odds, kind: t.includes('visionary') ? 'moonshot' : 'campaign' },
      expiresDay: w.day + 21,
      defaultOption: 'deny',
    });
    return;
  }
  if (t.includes('schemer') && e.loyalty < 30 && !e.mole && activeCorps(w).length) {
    // turned
    e.mole = pick(w, activeCorps(w)).id;
  }
}

/** Executive moles leak to their real employer. */
function moles(w: World): void {
  const d = w.player.dominion;
  for (const e of d.execs) {
    if (!e.mole) continue;
    const c = corpById(w, e.mole);
    if (!c || c.status !== 'active') {
      e.mole = null;
      continue;
    }
    c.intel = Math.min(100, c.intel + 4);
    d.spy.stats.leaks += 1;
    // war plans leak too
    for (const war of d.wars) if ((war.attackers.includes(c.id) || war.defenders.includes(c.id)) && (war.attackers.includes('player') || war.defenders.includes('player'))) war.score += war.attackers.includes('player') ? -2 : 2;
  }
}

/** Security audits and a good CSO catch executive moles too. */
export function catchExecMole(w: World, odds: number): string | null {
  const d = w.player.dominion;
  const e = d.execs.find((x) => x.mole);
  if (!e || !chance(w, odds)) return null;
  const c = corpById(w, e.mole!);
  e.mole = null;
  d.spy.stats.caught += 1;
  if (c) shiftRelation(w, 'player', c.id, -25);
  pushDecision(w, {
    kind: 'execMole',
    title: `Your ${EXEC_ROLES[e.role].short}, ${e.name}, is a mole`,
    body: `Security found ${e.name} has been reporting to ${c?.name ?? 'a rival'} all along. Fire them publicly, or keep them and feed ${c?.name ?? 'them'} false information (your intel on them +40, but they may work it out).`,
    options: [
      { id: 'fire', label: 'Fire them', description: `${fanChange(playerCompany(w), 1)} for cleaning house.` },
      { id: 'double', label: 'Make them a double agent', description: `Intel on ${c?.name ?? 'them'} +40. 25% chance they flip back.` },
    ],
    data: { execId: e.id, corpId: c?.id ?? '' },
    expiresDay: w.day + 21,
    defaultOption: 'fire',
  });
  return e.name;
}

export function resolveExecDecision(w: World, ev: DecisionEvent, optionId: string): boolean {
  const d = w.player.dominion;
  const p = playerCompany(w);
  const e = d.execs.find((x) => x.id === ev.data.execId);
  if (ev.kind === 'execPoach') {
    if (!e) return true;
    if (optionId === 'match' && p.cash >= Number(ev.data.cost)) {
      spend(p, 'execs', Number(ev.data.cost));
      e.salary *= 2;
      e.loyalty = Math.min(100, e.loyalty + 30);
      dlog(w, `You kept ${e.name} with a retention package.`, 'good');
    } else {
      departExec(w, e, 'poached', String(ev.data.corpId));
      d.spy.stats.poached += 1;
      toast(w, `${e.name} leaves for ${corpById(w, String(ev.data.corpId))?.name ?? 'a rival'}`, 'bad', { category: 'team', link: { route: 'dominion', id: 'execs' } });
    }
    return true;
  }
  if (ev.kind === 'execCoup') {
    if (!e) return true;
    if (optionId === 'fire') {
      departExec(w, e, 'quit');
      spend(p, 'execs', Number(ev.data.cost));
      p.boardConfidence = Math.max(0, p.boardConfidence - 4);
    } else {
      spend(p, 'execs', e.salary * 12);
      e.loyalty = Math.min(100, e.loyalty + 35);
      e.ambition = Math.max(0, e.ambition - 30);
      p.boardConfidence = Math.max(0, p.boardConfidence - 10);
    }
    return true;
  }
  if (ev.kind === 'execPitch') {
    if (!e) return true;
    if (optionId === 'fund' && p.cash >= Number(ev.data.cost)) {
      spend(p, 'execs', Number(ev.data.cost));
      e.loyalty = Math.min(100, e.loyalty + 8);
      if (rand(w) < Number(ev.data.odds)) pitchPaysOff(w, e, String(ev.data.kind));
      else toast(w, `${e.name}'s project didn't pan out`, 'neutral', { category: 'team', link: { route: 'dominion', id: 'execs' } });
    } else {
      e.loyalty = Math.max(0, e.loyalty - 12);
    }
    return true;
  }
  if (ev.kind === 'execMole') {
    if (!e) return true;
    if (optionId === 'fire') {
      departExec(w, e, 'quit');
      p.reputation = Math.min(100, p.reputation + 1);
    } else {
      const corpId = String(ev.data.corpId);
      d.spy.intel[corpId] = Math.min(100, (d.spy.intel[corpId] ?? 0) + 40);
      if (chance(w, 0.25)) e.mole = corpId;
    }
    return true;
  }
  return false;
}

function pitchPaysOff(w: World, e: Executive, kind: string): void {
  const p = playerCompany(w);
  const d = w.player.dominion;
  if (kind === 'campaign') {
    let n = 0;
    for (const id in w.games) {
      const g = w.games[id];
      if (g.companyId === p.id && g.status === 'development') {
        g.hype += 150;
        n++;
      }
    }
    const gained = bumpRep(p, 2);
    toast(w, `${e.name}'s campaign is everywhere`, 'good', { category: 'team', link: { route: 'dominion', id: 'execs' }, body: `${n ? `+150 hype for ${n} game${n === 1 ? '' : 's'} in development, ` : ''}${gained}.` });
    return;
  }
  const options: (() => string | null)[] = [
    () => {
      const r = w.player.research.active;
      if (!r) return null;
      r.progress = r.days;
      return 'Your current research is done.';
    },
    () => {
      const m = d.megaprojects.find((x) => x.stage === 'building');
      if (!m) return null;
      m.progress = Math.min(0.99, m.progress + 0.25);
      return 'Your megaproject leaps ahead.';
    },
    () => {
      const ai = w.player.ventures.ai;
      if (!ai?.models.length) return null;
      const best = ai.models.reduce((a, b) => (b.quality > a.quality ? b : a));
      best.quality += 4;
      return `${best.name} gets 4 points smarter.`;
    },
    () => {
      if (!featureOpen(w, 'space')) return null;
      d.space.launchTech = Math.min(5, d.space.launchTech + 1);
      return 'Reusable rockets: launch tech +1.';
    },
  ];
  for (const f of shuffle(w, options)) {
    const msg = f();
    if (msg) {
      toast(w, `${e.name}'s moonshot worked`, 'good', { category: 'team', link: { route: 'dominion', id: 'execs' }, body: msg });
      dlog(w, `${e.name}'s secret project paid off. ${msg}`, 'good');
      return;
    }
  }
  const gained = bumpRep(p, 2);
  toast(w, `${e.name}'s moonshot worked`, 'good', { category: 'team', link: { route: 'dominion', id: 'execs' }, body: `A breakthrough the press loves: ${gained}.` });
}

