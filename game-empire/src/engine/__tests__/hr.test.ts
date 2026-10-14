// HR autopilot: hiring, raises to pay grade, skill training and replacements.
import { describe, expect, it } from 'vitest';
import { createWorld } from '../world';
import { advanceDays } from '../tick';
import { createGame, hire } from '../actions';
import { ROLES, focus } from '../constants';
import { fixAllPay, hireStatus, hrHire, hrMonthly, hrReplace, marketPay, needsRaise, payFairly, payGrade, payRatio, payReview, setHr } from '../hr';
import { staffMonthly } from '../staff';
import type { World } from '../types';
import { emptyLedger, playerCompany } from '../util';

const opts = { seed: 'hr-1', companyName: 'People First', founderName: 'H', specialty: 'designer' as const, difficulty: 'normal' as const, rivals: 16 };

function withStaff(n = 3): World {
  const w = createWorld(opts);
  playerCompany(w).cash = 1e6;
  w.player.officeLevel = 2;
  for (const k of w.player.candidates.slice(0, n)) expect(hire(w, k.id).ok).toBe(true);
  return w;
}

/** A game in development, so there is work for new hires. */
function startGame(w: World): void {
  const founder = w.player.employees[0];
  const r = createGame(
    w,
    { title: 'Busy Work', genre: 'indie', topic: 'cats', platforms: ['pc', 'mobile'], audience: 'everyone', engine: 'pixelforge', monetization: 'premium', price: 4.99, artStyle: 'pixel', multiplayer: 'single', scope: 'tiny', budget: 500, focus: focus(1, 1, 1, 1, 1, 1) },
    [founder.id],
  );
  expect(r.ok, r.error).toBe(true);
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
    setHr(w, { autoTrain: false, autoHire: false });
    hrMonthly(w);
    expect(e.salary).toBeGreaterThan(before);
    expect(payRatio(e)).toBeGreaterThanOrEqual(1);
    expect(w.player.hr.log[0].text).toMatch(/Raised/);
  });

  it('without auto-raises, underpaid people get unhappy', () => {
    const run = (autoRaise: boolean) => {
      const w = withStaff();
      setHr(w, { autoRaise, autoTrain: false, autoHire: false });
      for (const e of w.player.employees) if (!e.isFounder) e.skill = Math.min(99, e.skill + 30);
      for (let m = 0; m < 4; m++) staffMonthly(w);
      const staff = w.player.employees.filter((e) => !e.isFounder);
      return staff.reduce((s, e) => s + e.morale, 0) / Math.max(1, staff.length);
    };
    expect(run(true)).toBeGreaterThan(run(false) + 5);
  });

  it('trains people up when the studio can afford it, and not when it cannot', () => {
    const w = withStaff();
    setHr(w, { autoRaise: false, autoTrain: true, autoHire: false, spending: 'generous' });
    const skills = w.player.employees.map((e) => e.skill);
    hrMonthly(w);
    expect(w.player.employees.some((e, i) => e.skill > skills[i])).toBe(true);
    const trained = w.player.employees.filter((e) => e.trainedDay === w.day);
    expect(trained.length).toBeGreaterThan(0);
    for (const e of trained) expect(e.trainedGain).toBeGreaterThan(0);
    expect(w.player.hr.log[0].text).toMatch(/Training: .*\+\d/);

    const broke = withStaff();
    playerCompany(broke).cash = 100;
    setHr(broke, { autoRaise: false, autoTrain: true, autoHire: false });
    const before = broke.player.employees.map((e) => e.skill);
    hrMonthly(broke);
    expect(broke.player.employees.map((e) => e.skill)).toEqual(before);
  });

  it('upgrades skills once the studio makes money, sooner on Generous', () => {
    const w = createWorld(opts);
    const founder = w.player.employees[0];
    const skill = founder.skill;
    hrMonthly(w);
    expect(founder.skill).toBe(skill); // Balanced waits for income
    setHr(w, { spending: 'generous', autoHire: false });
    hrMonthly(w);
    expect(founder.skill).toBeGreaterThan(skill);

    const earning = createWorld(opts);
    const p = playerCompany(earning);
    for (let m = 0; m < 6; m++) p.monthly.push({ day: m * 30, label: `M${m}`, revenue: 60000, expenses: 10000, profit: 50000, cash: p.cash, ledger: emptyLedger() });
    const s2 = earning.player.employees[0].skill;
    hrMonthly(earning);
    expect(earning.player.employees[0].skill).toBeGreaterThan(s2);
  });

  it('hires to fill empty desks when the studio can afford it', () => {
    const w = createWorld(opts);
    startGame(w);
    playerCompany(w).cash = 1e6;
    w.player.officeLevel = 2;
    expect(w.player.hr.autoHire).toBe(true);
    hrHire(w);
    expect(w.player.employees.length).toBe(2);
    advanceDays(w, 120);
    expect(w.player.employees.length).toBeGreaterThan(2);
    expect(w.player.hr.log.some((l) => l.text.startsWith('Hired'))).toBe(true);
    // a tiny game can't use more people: HR stops once developers sit idle
    const n = w.player.employees.length;
    advanceDays(w, 60);
    expect(w.player.employees.length).toBe(n);
  });

  it('stops at the team target and at the office size', () => {
    const w = createWorld(opts);
    startGame(w);
    playerCompany(w).cash = 1e6;
    w.player.officeLevel = 2;
    setHr(w, { teamTarget: 3 });
    advanceDays(w, 90);
    expect(w.player.employees.length).toBe(3);
    expect(hireStatus(w).text).toMatch(/target of 3/);

    const small = createWorld(opts);
    startGame(small);
    playerCompany(small).cash = 1e6;
    advanceDays(small, 90);
    expect(small.player.employees.length).toBeLessThanOrEqual(3);
    expect(hireStatus(small).office).toBe(true);
  });

  it('does not hire people it cannot afford', () => {
    const w = createWorld(opts);
    startGame(w);
    playerCompany(w).cash = 3000;
    hrHire(w);
    expect(w.player.employees.length).toBe(1);
    expect(hireStatus(w).text).toMatch(/Waiting for cash|No good candidates/);
  });

  it('waits for work before hiring when the studio is not making money', () => {
    const w = createWorld(opts); // $50K in a bedroom office
    hrHire(w);
    expect(w.player.employees.length).toBe(1);
    expect(hireStatus(w).text).toMatch(/Waiting for work/);
    startGame(w);
    hrHire(w);
    expect(w.player.employees.length).toBe(2);
    expect(ROLES[w.player.employees[1].role].dev).toBe(true);
  });

  it('hires for the roles the team is missing', () => {
    const w = createWorld(opts);
    startGame(w);
    playerCompany(w).cash = 1e6;
    w.player.officeLevel = 2;
    w.player.candidates = [
      { id: 'k-m', name: 'Mark Eting', role: 'marketing', skill: 52, salary: 3000, traits: [] },
      { id: 'k-c', name: 'Com Munity', role: 'community', skill: 52, salary: 2500, traits: [] },
      { id: 'k-p', name: 'Pro Grammer', role: 'programmer', skill: 48, salary: 3500, traits: [] },
    ];
    hrHire(w);
    expect(w.player.employees.map((e) => e.role)).toContain('programmer');
  });

  it('replaces people who quit with the best candidate for the job', () => {
    const w = withStaff(2);
    setHr(w, { autoHire: true, teamTarget: 3 });
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
