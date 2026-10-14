// HR autopilot. People get better at their jobs every month, but their pay
// doesn't follow on its own: underpaid staff lose morale and quit. HR keeps
// pay in line with each person's pay grade, trains people up, and hires to
// fill empty desks (and replace anyone who leaves) when the studio can afford it.
import { OFFICES, ROLES, salaryFor } from './constants';
import { hire, paidRefresh, recruiterCost, train, trainingCost } from './actions';
import { monthlyBurn } from './finance';
import { recruitFee } from './staff';
import type { ActionResult, Candidate, Company, Employee, HrSettings, HrSpending, RoleId, World } from './types';
import { ledgerRevenue, playerCompany, toast } from './util';

export const PAY_GRADES = [
  { name: 'Junior', min: 0 },
  { name: 'Mid-level', min: 40 },
  { name: 'Senior', min: 60 },
  { name: 'Lead', min: 80 },
  { name: 'Principal', min: 92 },
];

export function payGrade(skill: number): string {
  let g = PAY_GRADES[0].name;
  for (const x of PAY_GRADES) if (skill >= x.min) g = x.name;
  return g;
}

export const HR_SPENDING: Record<
  HrSpending,
  { name: string; blurb: string; payTarget: number; hireCushion: number; hireRunway: number; runway: number; reserve: number; trainingShare: number }
> = {
  careful: { name: 'Careful', blurb: 'Market pay. Hires and trains only with plenty of cash in the bank.', payTarget: 1.0, hireCushion: 9, hireRunway: 24, runway: 6, reserve: 50_000, trainingShare: 0.05 },
  balanced: { name: 'Balanced', blurb: 'A little above market. Hires and trains while keeping a safe cushion.', payTarget: 1.05, hireCushion: 6, hireRunway: 12, runway: 3, reserve: 15_000, trainingShare: 0.1 },
  generous: { name: 'Generous', blurb: 'Well above market. Hires and trains whenever it can.', payTarget: 1.12, hireCushion: 3, hireRunway: 6, runway: 1, reserve: 5_000, trainingShare: 0.2 },
};

/** Fair monthly pay for someone's role and skill today. */
export function marketPay(e: Employee): number {
  return salaryFor(e.role, e.skill);
}

/** Pay compared with the market: 0.9 means 10% underpaid. */
export function payRatio(e: Employee): number {
  const m = marketPay(e);
  return m > 0 ? e.salary / m : 1;
}

export function payStatus(e: Employee): { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' } {
  if (e.isFounder) return { label: 'Founder', tone: 'neutral' };
  const r = payRatio(e);
  if (r < 0.85) return { label: `Underpaid ${Math.round((1 - r) * 100)}%`, tone: 'bad' };
  if (r < 0.97) return { label: `Slightly under ${Math.round((1 - r) * 100)}%`, tone: 'warn' };
  if (r > 1.15) return { label: 'Well paid', tone: 'good' };
  return { label: 'Fair', tone: 'neutral' };
}

/** Should HR give this person a raise? Underpaid, or unhappy and not overpaid. */
export function needsRaise(e: Employee): boolean {
  if (e.isFounder) return false;
  const r = payRatio(e);
  return r < 0.95 || (e.morale < 50 && r < 1.1);
}

function log(w: World, text: string): void {
  const hr = w.player.hr;
  hr.log.unshift({ day: w.day, text });
  if (hr.log.length > 12) hr.log.length = 12;
}

/** Raise someone to their pay grade's market rate (times the spending style). */
export function raiseToMarket(w: World, e: Employee, target = HR_SPENDING[w.player.hr?.spending ?? 'balanced'].payTarget): number {
  const want = Math.round((marketPay(e) * target) / 10) * 10;
  if (want <= e.salary) return 0;
  const delta = want - e.salary;
  e.salary = want;
  e.morale = Math.min(100, e.morale + 10);
  return delta;
}

/** What it would cost each month to bring everyone up to their pay grade. */
export function payReview(w: World): { underpaid: Employee[]; cost: number } {
  const target = HR_SPENDING[w.player.hr?.spending ?? 'balanced'].payTarget;
  const underpaid = w.player.employees.filter(needsRaise);
  const cost = underpaid.reduce((s, e) => s + Math.max(0, Math.round((marketPay(e) * target) / 10) * 10 - e.salary), 0);
  return { underpaid, cost };
}

/** Manual: raise one person to their pay grade. */
export function payFairly(w: World, id: string): ActionResult {
  const e = w.player.employees.find((x) => x.id === id);
  if (!e || e.isFounder) return { ok: false, error: 'No such employee.' };
  const d = raiseToMarket(w, e);
  if (d <= 0) return { ok: false, error: `${e.name} is already paid fairly.` };
  log(w, `Raised ${e.name} to ${payGrade(e.skill).toLowerCase()} pay (+$${d.toLocaleString()}/mo)`);
  return { ok: true };
}

/** Manual one-click: bring everyone who is underpaid up to market. */
export function fixAllPay(w: World): ActionResult {
  let n = 0;
  let total = 0;
  for (const e of w.player.employees) {
    if (!needsRaise(e)) continue;
    const d = raiseToMarket(w, e);
    if (d > 0) {
      n++;
      total += d;
    }
  }
  if (n === 0) return { ok: false, error: 'Everyone is already paid fairly.' };
  log(w, `Raised ${n} salar${n > 1 ? 'ies' : 'y'} (+$${total.toLocaleString()}/mo)`);
  return { ok: true };
}

export function setHr(w: World, patch: Partial<Omit<HrSettings, 'log'>>): ActionResult {
  Object.assign(w.player.hr, patch);
  if (patch.autoHire || patch.teamTarget !== undefined || patch.spending) hrHire(w);
  return { ok: true };
}

/** Cash HR keeps in the bank before paying for training. */
export function trainingFloor(w: World): number {
  const p = playerCompany(w);
  const burn = Math.max(1, p ? monthlyBurn(w, p) : 1);
  const style = HR_SPENDING[w.player.hr?.spending ?? 'balanced'];
  return Math.max(style.reserve, burn * style.runway);
}

/** Why HR can't pay for a training right now, or null if it can. While the
 * studio is losing money a session may cost at most 15% of the cash. */
export function trainingWait(w: World, cost: number): 'cash' | 'income' | null {
  const p = playerCompany(w);
  if (!p || p.cash - cost < trainingFloor(w)) return 'cash';
  if (struggling(w)) return 'income';
  if (!profitable(w, p) && cost > p.cash * 0.15) return 'income';
  return null;
}

/** Developers due for training, least skilled first. */
export function trainingQueue(w: World): { e: Employee; cost: number }[] {
  return w.player.employees
    .filter((e) => e.skill < 95 && w.day - (e.trainedDay ?? -9999) >= 90 && (ROLES[e.role].dev || e.isFounder))
    .sort((a, b) => a.skill - b.skill)
    .map((e) => ({ e, cost: trainingCost(w, e.id) }));
}

/** Monthly, before morale is calculated: raises and training. */
export function hrMonthly(w: World): void {
  const hr = w.player.hr;
  const p = playerCompany(w);
  if (!hr || !p || p.status !== 'active') return;
  const style = HR_SPENDING[hr.spending];

  const tight = struggling(w);
  if (hr.autoRaise) {
    let n = 0;
    let total = 0;
    const names: string[] = [];
    for (const e of w.player.employees) {
      if (!needsRaise(e)) continue;
      // when money is tight, only protect people who are about to walk
      if (tight && e.morale >= 45) continue;
      const d = raiseToMarket(w, e, style.payTarget);
      if (d > 0) {
        n++;
        total += d;
        if (names.length < 3) names.push(e.name.split(' ')[0]);
      }
    }
    if (n > 0) {
      log(w, `Raised ${n} salar${n > 1 ? 'ies' : 'y'} to their pay grade (+$${total.toLocaleString()}/mo)`);
      toast(w, `HR gave ${n} raise${n > 1 ? 's' : ''} to keep your team happy`, 'neutral', {
        category: 'team',
        link: { route: 'team' },
        body: `${names.join(', ')}${n > names.length ? ` and ${n - names.length} more` : ''}. Payroll +$${total.toLocaleString()}/mo.`,
      });
    }
  }

  if (hr.autoTrain) {
    // one person a month whenever the reserve allows; revenue pays for more
    const floor = trainingFloor(w);
    const last = p.monthly[p.monthly.length - 1];
    let budget = Math.max(last?.revenue ?? 0, ledgerRevenue(p.ledger)) * style.trainingShare;
    const trained: string[] = [];
    for (const { e, cost } of trainingQueue(w)) {
      if (trained.length > 0 ? cost > budget : trainingWait(w, cost)) continue;
      if (p.cash - cost < floor) continue;
      const before = e.skill;
      if (train(w, e.id).ok) {
        e.trainedDay = w.day;
        e.trainedGain = Math.round((e.skill - before) * 10) / 10;
        if (trained.length > 0) budget -= cost;
        trained.push(`${e.isFounder ? 'You' : e.name.split(' ')[0]} +${Math.max(1, Math.round(e.skill - before))}`);
      }
    }
    if (trained.length) {
      log(w, `Training: ${trained.join(', ')} skill`);
      toast(w, `HR training: ${trained.slice(0, 3).join(', ')} skill${trained.length > 3 ? ` and ${trained.length - 3} more` : ''}`, 'good', { category: 'team', link: { route: 'team' } });
    }
  }
}

// ---------------------------------------------------------------- hiring

/** The team mix HR aims for (shares of the whole team). */
const ROLE_MIX: Record<RoleId, number> = {
  founder: 0,
  programmer: 0.22,
  artist: 0.18,
  designer: 0.16,
  writer: 0.07,
  audio: 0.07,
  qa: 0.11,
  producer: 0.06,
  marketing: 0.08,
  community: 0.05,
};

/** How many people HR will grow the team to. */
export function hireLimit(w: World): number {
  const cap = OFFICES[w.player.officeLevel].capacity;
  const t = w.player.hr?.teamTarget ?? 0;
  return t > 0 ? Math.min(cap, t) : cap;
}

/** How short the team is of a role, in people. Positive means HR wants one. */
function roleNeed(w: World, role: RoleId): number {
  const heads = w.player.employees.length;
  const have = w.player.employees.filter((e) => e.role === role).length;
  return ROLE_MIX[role] * (heads + 1) - have;
}

function minSkill(w: World): number {
  const staff = w.player.employees;
  const avg = staff.reduce((s, e) => s + e.skill, 0) / Math.max(1, staff.length);
  return Math.max(20, Math.min(55, avg - 30));
}

/** Income HR can count on: the lower of the 6-month and 2-month averages, so a
 * hit that is fading doesn't look like steady money. */
function recentIncome(p: Company): number {
  const avg = (n: number) => {
    const recent = p.monthly.slice(-n);
    return recent.length ? recent.reduce((s, m) => s + m.revenue, 0) / recent.length : 0;
  };
  return Math.min(avg(6), avg(2));
}

function profitable(w: World, p: Company): boolean {
  return recentIncome(p) >= monthlyBurn(w, p);
}

/** Losing money with less runway than the spending style likes: HR tightens its belt. */
export function struggling(w: World): boolean {
  const p = playerCompany(w);
  if (!p) return false;
  const loss = monthlyBurn(w, p) - recentIncome(p);
  return p.cash < 0 || (loss > 0 && p.cash / loss < HR_SPENDING[w.player.hr?.spending ?? 'balanced'].hireRunway);
}

/** Is there anything for new people to work on? */
export function hasWork(w: World): boolean {
  const id = w.player.companyId;
  return w.player.contracts.length > 0 || Object.values(w.games).some((g) => g.companyId === id && (g.status === 'development' || (g.status === 'released' && !!g.update)));
}

/** Can the studio carry another salary? A cushion of months of costs in the
 * bank, and when the studio is losing money, enough cash for the style's runway. */
function affordable(w: World, p: Company, salary: number, fee: number): boolean {
  const style = HR_SPENDING[w.player.hr.spending];
  const burn = monthlyBurn(w, p) + salary;
  const cash = p.cash - fee;
  if (cash < burn * style.hireCushion) return false;
  const net = recentIncome(p) - burn;
  return net >= 0 || cash / -net >= style.hireRunway;
}

function score(w: World, k: Candidate): number {
  // tiny teams need people who make games before testers, marketers and producers
  const support = !ROLES[k.role].dev || k.role === 'producer' || k.role === 'qa';
  const early = support && w.player.employees.length < 5 ? 30 : 0;
  return k.skill + 40 * roleNeed(w, k.role) - early;
}

/** The candidate HR would hire next, ignoring money. */
export function nextHire(w: World): Candidate | null {
  const min = minSkill(w);
  const pool = w.player.candidates.filter((k) => k.skill >= min);
  pool.sort((a, b) => score(w, b) - score(w, a));
  return pool[0] ?? null;
}

function bestAffordable(w: World, p: Company): Candidate | null {
  const min = minSkill(w);
  const pool = w.player.candidates.filter((k) => k.skill >= min && affordable(w, p, k.salary, recruitFee(w, k.salary)));
  pool.sort((a, b) => score(w, b) - score(w, a));
  return pool[0] ?? null;
}

/** Why HR is or isn't hiring right now, for the Team screen. */
export function hireStatus(w: World): { text: string; tone: 'good' | 'warn' | 'neutral'; office?: boolean } {
  const hr = w.player.hr;
  const p = playerCompany(w);
  const heads = w.player.employees.length;
  const cap = OFFICES[w.player.officeLevel].capacity;
  const limit = hireLimit(w);
  if (!hr.autoHire) return { text: `${Math.max(0, limit - heads)} open desk${limit - heads === 1 ? '' : 's'}`, tone: 'neutral' };
  if (heads >= cap) return { text: `Office full (${heads}/${cap}). Move to a bigger office so HR can keep hiring.`, tone: 'warn', office: true };
  if (heads >= limit) return { text: `At your target of ${limit} people`, tone: 'good' };
  if (p && !profitable(w, p) && !hasWork(w)) return { text: 'Waiting for work: start a game or take a contract and HR will staff it.', tone: 'neutral' };
  const next = nextHire(w);
  const refresh = Math.max(0, 28 - (w.day - w.player.candidatesRefreshDay));
  if (!next) return { text: `No good candidates right now. New ones in ${refresh} day${refresh === 1 ? '' : 's'}.`, tone: 'neutral' };
  const pick = p ? bestAffordable(w, p) : null;
  if (!pick) return { text: `Waiting for cash: the next hire (${ROLES[next.role].name.toLowerCase()}, ${moneyShort(next.salary)}/mo) would leave too little in the bank.`, tone: 'warn' };
  return { text: `Hiring this week: ${pick.name} (${ROLES[pick.role].name.toLowerCase()}, skill ${pick.skill})`, tone: 'good' };
}

function moneyShort(n: number): string {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}K` : `$${Math.round(n)}`;
}

/** Fill empty desks: runs weekly, and straight away when hiring is switched on. */
export function hrHire(w: World): void {
  const hr = w.player.hr;
  const p = playerCompany(w);
  if (!hr?.autoHire || !p || p.status !== 'active') return;
  // a studio that isn't making money only hires when there is work to do
  if (!profitable(w, p) && !hasWork(w)) return;
  const limit = hireLimit(w);
  const perWeek = 1 + Math.floor(w.player.employees.length / 8);
  const hired: Candidate[] = [];
  let headhunted = false;
  while (hired.length < perWeek && w.player.employees.length < limit) {
    let k = bestAffordable(w, p);
    // pool is dry: a busy studio with cash pays a headhunter (at most every two weeks)
    if (!k && !headhunted && limit - w.player.employees.length >= 2 && w.day - w.player.candidatesRefreshDay >= 14 && p.cash > recruiterCost(w) * 15) {
      headhunted = true;
      if (paidRefresh(w).ok) {
        log(w, 'Paid a headhunter for fresh candidates');
        k = bestAffordable(w, p);
      }
    }
    if (!k || !hire(w, k.id).ok) break;
    hired.push(k);
  }
  if (!hired.length) return;
  const names = hired.map((k) => `${k.name} (${ROLES[k.role].name.toLowerCase()})`);
  log(w, `Hired ${names.join(', ')}`);
  toast(w, hired.length === 1 ? `HR hired ${hired[0].name}` : `HR hired ${hired.length} people`, 'good', {
    category: 'team',
    link: { route: 'team' },
    body: hired.length === 1 ? `${ROLES[hired[0].role].name}, skill ${hired[0].skill}, ${moneyShort(hired[0].salary)}/mo.` : names.join(', '),
  });
}

/** Someone quit: hire the best available candidate for the same job straight away. */
export function hrReplace(w: World, quitter: Employee): void {
  const hr = w.player.hr;
  const p = playerCompany(w);
  if (!hr?.autoHire || !p || p.status !== 'active') return;
  const pick = w.player.candidates
    .filter((k) => k.role === quitter.role && affordable(w, p, k.salary, recruitFee(w, k.salary)))
    .sort((a, b) => b.skill - a.skill)[0];
  if (pick && hire(w, pick.id).ok) {
    log(w, `Hired ${pick.name} to replace ${quitter.name}`);
    toast(w, `HR hired ${pick.name} to replace ${quitter.name}`, 'neutral', { category: 'team', link: { route: 'team' } });
    return;
  }
  hrHire(w);
}
