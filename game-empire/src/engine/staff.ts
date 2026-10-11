// Player staff: candidates, morale, growth, research progress.
import { HIREABLE_ROLES, OFFICES, RESEARCH, ROLES, TRAITS, salaryFor } from './constants';
import { chance, pick, randInt, randNormal, randRange } from './rng';
import type { Candidate, Employee, RoleId, TraitId, World } from './types';
import { clamp, newId, playerCompany, pushNews, toast } from './util';
import { personName } from './names';

const TRAIT_IDS = Object.keys(TRAITS) as TraitId[];

export function rollTraits(w: World): TraitId[] {
  const out: TraitId[] = [];
  if (chance(w, 0.35)) out.push(pick(w, TRAIT_IDS));
  if (chance(w, 0.08)) {
    const t = pick(w, TRAIT_IDS);
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

export function makeCandidate(w: World, role: RoleId, skillCenter: number, formerStudio?: string): Candidate {
  const skill = clamp(Math.round(randNormal(w, skillCenter, 11)), 8, 98);
  const traits = rollTraits(w);
  let salary = salaryFor(role, skill);
  if (traits.includes('genius')) salary = Math.round(salary * 1.3);
  if (traits.includes('toxic')) salary = Math.round(salary * 0.9);
  return { id: newId(w, 'k'), name: personName(w), role, skill, salary, traits, formerStudio };
}

export function refreshCandidates(w: World): void {
  const p = playerCompany(w);
  const surge = w.day < w.market.talentSurgeUntil;
  const count = 6 + Math.min(10, Math.floor(p.reputation / 8)) + (surge ? 4 : 0);
  const center = 26 + p.reputation * 0.45 + (surge ? 8 : 0);
  const fallen = surge
    ? Object.values(w.companies)
        .filter((c) => c.status === 'bankrupt' && c.endDay !== null && w.day - c.endDay < 90)
        .map((c) => c.name)
    : [];
  const out: Candidate[] = [];
  for (let i = 0; i < count; i++) {
    const role = i < HIREABLE_ROLES.length ? HIREABLE_ROLES[(i + randInt(w, 0, 8)) % HIREABLE_ROLES.length] : pick(w, HIREABLE_ROLES);
    const former = fallen.length && chance(w, 0.5) ? pick(w, fallen) : undefined;
    out.push(makeCandidate(w, role, center + (former ? 10 : 0) + randRange(w, -6, 10), former));
  }
  out.sort((a, b) => b.skill - a.skill);
  w.player.candidates = out;
  w.player.candidatesRefreshDay = w.day;
}

export function makeEmployee(w: World, c: Candidate): Employee {
  return {
    id: newId(w, 'e'),
    name: c.name,
    role: c.role,
    skill: c.skill,
    salary: c.salary,
    morale: 75,
    xp: 0,
    traits: [...c.traits],
    hiredDay: w.day,
    assignment: null,
    isFounder: false,
  };
}

export function staffDaily(w: World): void {
  for (const e of w.player.employees) {
    if (e.xp >= 1) {
      e.xp -= 1;
      const gain = (e.skill < 50 ? 1.2 : e.skill < 75 ? 0.7 : 0.35) * (e.traits.includes('fastLearner') ? 1.5 : 1);
      e.skill = Math.min(100, e.skill + gain);
    }
  }
}

export function staffMonthly(w: World): void {
  const p = playerCompany(w);
  const office = OFFICES[w.player.officeLevel];
  const headcount = w.player.employees.length;
  const crowded = headcount > office.capacity;
  const toxic = w.player.employees.filter((e) => e.traits.includes('toxic')).length;
  const quitters: Employee[] = [];
  for (const e of w.player.employees) {
    if (e.isFounder) {
      e.morale = clamp(e.morale + (75 - e.morale) * 0.2, 0, 100);
      continue;
    }
    const market = salaryFor(e.role, e.skill);
    let target = 70 + office.morale + clamp(((e.salary - market) / market) * 60, -25, 15) + p.reputation * 0.1;
    if (crowded) target -= 15;
    if (toxic > 0 && !e.traits.includes('toxic')) target -= Math.min(18, (toxic / Math.max(1, headcount)) * 120);
    const crunching = e.assignment && w.games[e.assignment]?.crunch;
    if (crunching && !e.traits.includes('crunchProof')) target -= 18;
    if (p.cash < 0) target -= 10;
    e.morale = clamp(e.morale + (target - e.morale) * 0.4 + randNormal(w, 0, 3), 0, 100);
    const quitChance = e.traits.includes('loyal') ? 0.01 : e.morale < 25 ? 0.25 : e.morale < 40 ? 0.08 : 0.005;
    if (chance(w, quitChance)) quitters.push(e);
  }
  for (const q of quitters) {
    w.player.employees = w.player.employees.filter((e) => e.id !== q.id);
    pushNews(w, { kind: 'player', title: `${q.name} quits ${p.name}`, body: `Morale was ${Math.round(q.morale)}%. ${ROLES[q.role].name}, skill ${Math.round(q.skill)}.`, companyId: p.id, tone: 'bad' });
    toast(w, `${q.name} quit (low morale)`, 'bad');
  }
}

export function researchDaily(w: World): void {
  const r = w.player.research.active;
  if (!r) return;
  r.progress += 1;
  if (r.progress >= r.days) {
    w.player.research.completed.push(r.id);
    w.player.research.active = null;
    const def = RESEARCH[r.id];
    pushNews(w, { kind: 'player', title: `R&D complete: ${def.name}`, body: def.blurb, companyId: w.player.companyId, tone: 'good' });
    toast(w, `Research complete: ${def.name}`, 'good');
  }
}

/** Monthly licensing income once the player's engine v3 is licensable. */
export function engineLicensing(w: World): void {
  if (!w.player.research.completed.includes('engine3')) return;
  const p = playerCompany(w);
  let pool = 0;
  for (const id in w.games) {
    const g = w.games[id];
    if (g.status === 'released' && !w.companies[g.companyId].isPlayer && g.engine !== 'titan') pool += g.rev30;
  }
  const share = clamp(p.reputation / 100, 0.1, 0.9) * 0.15;
  const income = pool * share * 0.03;
  if (income > 0) {
    p.cash += income;
    p.ledger.licensing += income;
    p.revenueTotal += income;
    p.quarterRevenue += income;
  }
}
