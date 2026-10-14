// HR autopilot: raises to pay grade, training and replacements.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { advanceDays } from '../tick';
import { hire } from '../actions';
import { fixAllPay, hrMonthly, hrReplace, marketPay, needsRaise, payFairly, payGrade, payRatio, payReview, setHr } from '../hr';
import { staffMonthly } from '../staff';
import type { World } from '../types';
import { playerCompany } from '../util';

const opts = { seed: 'hr-1', companyName: 'People First', founderName: 'H', specialty: 'designer' as const, difficulty: 'normal' as const, rivals: 16 };

function withStaff(n = 3): World {
  const w = createWorld(opts);
  playerCompany(w).cash = 1e6;
  w.player.officeLevel = 2;
  for (const k of w.player.candidates.slice(0, n)) expect(hire(w, k.id).ok).toBe(true);
  return w;
}

describe('hr autopilot', () => {
  it('knows pay grades', () => {
    expect(payGrade(20)).toBe('Junior');
    expect(payGrade(55)).toBe('Mid-level');
    expect(payGrade(70)).toBe('Senior');
    expect(payGrade(85)).toBe('Lead');
    expect(payGrade(97)).toBe('Principal');
  });

  it('raises people who grew out of their pay grade', () => {
    const w = withStaff();
    const e = w.player.employees.find((x) => !x.isFounder)!;
    e.skill = Math.min(99, e.skill + 30); // years of experience later
    expect(needsRaise(e)).toBe(true);
    const before = e.salary;
    setHr(w, { autoTrain: false });
    hrMonthly(w);
    expect(e.salary).toBeGreaterThan(before);
    expect(payRatio(e)).toBeGreaterThanOrEqual(1);
    expect(w.player.hr.log[0].text).toMatch(/Raised/);
  });

  it('without auto-raises, underpaid people get unhappy', () => {
    const run = (autoRaise: boolean) => {
      const w = withStaff();
      setHr(w, { autoRaise, autoTrain: false });
      for (const e of w.player.employees) if (!e.isFounder) e.skill = Math.min(99, e.skill + 30);
      for (let m = 0; m < 4; m++) staffMonthly(w);
      const staff = w.player.employees.filter((e) => !e.isFounder);
      return staff.reduce((s, e) => s + e.morale, 0) / Math.max(1, staff.length);
    };
    expect(run(true)).toBeGreaterThan(run(false) + 5);
  });

  it('sends people on training when the studio can afford it, and not when it cannot', () => {
    const w = withStaff();
    setHr(w, { autoRaise: false, autoTrain: true, spending: 'generous' });
    const skills = w.player.employees.map((e) => e.skill);
    hrMonthly(w);
    expect(w.player.employees.some((e, i) => e.skill > skills[i])).toBe(true);
    expect(w.player.employees.some((e) => e.trainedDay === w.day)).toBe(true);

    const broke = withStaff();
    playerCompany(broke).cash = 100;
    setHr(broke, { autoRaise: false, autoTrain: true });
    const before = broke.player.employees.map((e) => e.skill);
    hrMonthly(broke);
    expect(broke.player.employees.map((e) => e.skill)).toEqual(before);
  });

  it('replaces people who quit with the best candidate for the job', () => {
    const w = withStaff(2);
    setHr(w, { autoReplace: true });
    const quitter = w.player.employees.find((e) => !e.isFounder)!;
    w.player.candidates.push({ id: 'k-test', name: 'Rep Lacement', role: quitter.role, skill: 70, salary: 4000, traits: [] });
    w.player.employees = w.player.employees.filter((e) => e.id !== quitter.id);
    const count = w.player.employees.length;
    hrReplace(w, quitter);
    expect(w.player.employees.length).toBe(count + 1);
    expect(w.player.employees.some((e) => e.role === quitter.role && e.name !== quitter.name)).toBe(true);
  });

  it('fixes everyone\'s pay in one click', () => {
    const w = withStaff();
    for (const e of w.player.employees) if (!e.isFounder) e.salary = Math.round(marketPay(e) * 0.6);
    expect(fixAllPay(w).ok).toBe(true);
    expect(w.player.employees.filter((e) => !e.isFounder).every((e) => payRatio(e) >= 1)).toBe(true);
    expect(fixAllPay(w).ok).toBe(false);
  });

  it('shows what fixing pay would cost and raises one person at a time', () => {
    const w = withStaff();
    const [a, b] = w.player.employees.filter((e) => !e.isFounder);
    a.salary = Math.round(marketPay(a) * 0.7);
    b.salary = Math.round(marketPay(b) * 1.2);
    const review = payReview(w);
    expect(review.underpaid.map((e) => e.id)).toEqual([a.id]);
    expect(review.cost).toBeGreaterThan(0);
    expect(payFairly(w, b.id).ok).toBe(false);
    expect(payFairly(w, w.player.employees[0].id).ok).toBe(false); // founder
    expect(payFairly(w, a.id).ok).toBe(true);
    expect(payReview(w).underpaid).toHaveLength(0);
  });

  it('runs for years without breaking the studio', () => {
    const w = withStaff(4);
    advanceDays(w, 365 * 2);
    expect(Number.isFinite(playerCompany(w).cash)).toBe(true);
  });
});
