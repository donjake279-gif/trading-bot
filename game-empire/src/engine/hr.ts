// HR autopilot. People get better at their jobs every month, but their pay
// doesn't follow on its own: underpaid staff lose morale and quit. HR keeps
// pay in line with each person's pay grade, sends people on training when
// the studio can afford it, and can hire replacements when someone leaves.
import { ROLES, salaryFor } from './constants';
import { train, trainingCost } from './actions';
import { monthlyBurn } from './finance';
import { makeEmployee, recruitFee } from './staff';
import type { ActionResult, Employee, HrSettings, HrSpending, World } from './types';
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

export const HR_SPENDING: Record<HrSpending, { name: string; blurb: string; runway: number; reserve: number; trainingShare: number; payTarget: number }> = {
  careful: { name: 'Careful', blurb: 'Pays the market rate. Trains with 6 months of costs (at least $150K) in the bank.', runway: 6, reserve: 150_000, trainingShare: 0.05, payTarget: 1.0 },
  balanced: { name: 'Balanced', blurb: 'Pays a little above market. Trains with 3 months of costs (at least $75K) in the bank.', runway: 3, reserve: 75_000, trainingShare: 0.1, payTarget: 1.05 },
  generous: { name: 'Generous', blurb: 'Pays well above market. Trains with a month of costs (at least $30K) in the bank.', runway: 1, reserve: 30_000, trainingShare: 0.2, payTarget: 1.12 },
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
  return { ok: true };
}

/** Cash HR keeps in the bank before paying for training. */
export function trainingFloor(w: World): number {
  const p = playerCompany(w);
  const burn = Math.max(1, p ? monthlyBurn(w, p) : 1);
  const style = HR_SPENDING[w.player.hr?.spending ?? 'balanced'];
  return Math.max(style.reserve, burn * style.runway);
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

  if (hr.autoRaise) {
    let n = 0;
    let total = 0;
    const names: string[] = [];
    for (const e of w.player.employees) {
      if (!needsRaise(e)) continue;
      // when money is tight, only protect people who are about to walk
      if (p.cash < 0 && e.morale >= 40) continue;
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
    let n = 0;
    for (const { e, cost } of trainingQueue(w)) {
      if ((n > 0 && cost > budget) || p.cash - cost < floor) continue;
      if (train(w, e.id).ok) {
        e.trainedDay = w.day;
        if (n > 0) budget -= cost;
        n++;
      }
    }
    if (n > 0) log(w, `Sent ${n} ${n > 1 ? 'people' : 'person'} on training`);
  }
}

/** Someone quit: hire the best available candidate for the same role. */
export function hrReplace(w: World, quitter: Employee): void {
  const hr = w.player.hr;
  const p = playerCompany(w);
  if (!hr?.autoReplace || !p) return;
  const pick = w.player.candidates.filter((k) => k.role === quitter.role).sort((a, b) => b.skill - a.skill)[0];
  if (!pick) {
    log(w, `No ${ROLES[quitter.role].name.toLowerCase()} candidates to replace ${quitter.name}`);
    return;
  }
  const fee = recruitFee(w, pick.salary);
  const burn = Math.max(1, monthlyBurn(w, p));
  if (p.cash - fee < burn) {
    log(w, `Could not afford to replace ${quitter.name}`);
    return;
  }
  p.cash -= fee;
  p.ledger.salaries += fee;
  w.player.employees.push(makeEmployee(w, pick));
  w.player.candidates = w.player.candidates.filter((k) => k.id !== pick.id);
  log(w, `Hired ${pick.name} to replace ${quitter.name}`);
  toast(w, `HR hired ${pick.name} to replace ${quitter.name}`, 'neutral', { category: 'team', link: { route: 'team' } });
}
