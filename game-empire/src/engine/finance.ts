// Company finances: running costs, monthly close, loans, valuation, insolvency.
import { MONETIZATIONS, OFFICES, TAX_RATE } from './constants';
import { bankName } from './names';
import { randRange } from './rng';
import type { Company, Loan, World } from './types';
import {
  clamp,
  emptyLedger,
  formatMonth,
  gamesOf,
  ledgerExpenses,
  ledgerRevenue,
  newId,
  pushPoint,
  spend,
} from './util';

export const AI_OVERHEAD_PER_HEAD = 1100;

/** Small studios pay less and run leaner offices than big publishers. */
export function aiSizeFactor(headcount: number): number {
  return 0.55 + 0.45 * Math.min(1, headcount / 200);
}

export function aiAvgSalary(talent: number, headcount = 200): number {
  return (3800 + talent * 75) * aiSizeFactor(headcount);
}

export function debtOf(c: Company): number {
  let d = 0;
  for (const l of c.loans) d += l.balance;
  return d;
}

/** Monthly payroll for the player company. */
export function playerPayroll(w: World): number {
  let t = 0;
  for (const e of w.player.employees) t += e.salary;
  return t;
}

export function monthlyBurn(w: World, c: Company): number {
  let burn: number;
  if (c.isPlayer) burn = playerPayroll(w) + OFFICES[w.player.officeLevel].rent;
  else burn = c.headcount * (c.avgSalary + AI_OVERHEAD_PER_HEAD * aiSizeFactor(c.headcount));
  for (const l of c.loans) burn += l.monthlyPayment;
  burn += (servers30(w, c) * 1);
  return burn;
}

export function servers30(w: World, c: Company): number {
  let t = 0;
  for (const g of gamesOf(w, c.id)) if (g.status === 'released') t += g.cost30;
  return t;
}

/** Revenue over the trailing twelve months (closed months + current ledger). */
export function revenueTTM(c: Company): number {
  let t = ledgerRevenue(c.ledger);
  const n = c.monthly.length;
  for (let i = Math.max(0, n - 11); i < n; i++) t += c.monthly[i].revenue;
  return t;
}

export function profitTTM(c: Company): number {
  let t = ledgerRevenue(c.ledger) - ledgerExpenses(c.ledger);
  const n = c.monthly.length;
  for (let i = Math.max(0, n - 11); i < n; i++) t += c.monthly[i].profit;
  return t;
}

export function recentRevenue(c: Company, months: number): number {
  let t = 0;
  const n = c.monthly.length;
  for (let i = Math.max(0, n - months); i < n; i++) t += c.monthly[i].revenue;
  return t;
}

// ------------------------------------------------------------ daily costs

export function dailyCosts(w: World, c: Company): void {
  if (c.isPlayer) {
    spend(c, 'salaries', playerPayroll(w) / 30);
    spend(c, 'rent', OFFICES[w.player.officeLevel].rent / 30);
  } else {
    spend(c, 'salaries', (c.headcount * c.avgSalary) / 30);
    spend(c, 'rent', (c.headcount * AI_OVERHEAD_PER_HEAD * aiSizeFactor(c.headcount)) / 30);
  }
}

// ------------------------------------------------------------ loans

export function creditRisk(w: World, c: Company): number {
  const rev = revenueTTM(c);
  const debt = debtOf(c);
  let risk = 0.05 + 0.1 * clamp(debt / Math.max(1, rev), 0, 2) + c.defaults * 0.04 + (c.cash < 0 ? 0.07 : 0);
  if (rev <= 0) risk += 0.05;
  risk -= clamp(c.reputation / 100, 0, 1) * 0.03;
  void w;
  return clamp(risk, 0.02, 0.32);
}

export function borrowingLimit(_w: World, c: Company): number {
  const rev = revenueTTM(c);
  const base = c.isPlayer ? 15000 * (1 + c.reputation / 15) : 50000;
  const limit = base + rev * 0.6 + Math.max(0, c.valuation) * 0.12 - debtOf(c);
  const insolventPenalty = c.cash < 0 ? 0.4 : 1;
  return Math.max(0, limit * insolventPenalty * (c.defaults >= 3 ? 0 : 1));
}

export interface LoanOffer {
  amount: number;
  months: number;
  apr: number;
  monthlyPayment: number;
}

export function amortizedPayment(principal: number, apr: number, months: number): number {
  const r = apr / 12;
  if (r <= 0) return principal / months;
  return (principal * r) / (1 - Math.pow(1 + r, -months));
}

export function loanOffers(w: World, c: Company): LoanOffer[] {
  const limit = borrowingLimit(w, c);
  if (limit < 1000) return [];
  const risk = creditRisk(w, c);
  const terms: [number, number, number][] = [
    [0.25, 12, -0.01],
    [0.6, 36, 0],
    [1.0, 60, 0.015],
  ];
  return terms.map(([frac, months, extra]) => {
    const amount = Math.floor((limit * frac) / 1000) * 1000;
    const apr = w.market.baseRate + risk + extra;
    return { amount, months, apr, monthlyPayment: amortizedPayment(amount, apr, months) };
  }).filter((o) => o.amount >= 1000);
}

export function takeLoan(w: World, c: Company, amount: number, months: number, apr: number): Loan {
  const loan: Loan = {
    id: newId(w, 'l'),
    principal: amount,
    balance: amount,
    apr,
    monthlyPayment: amortizedPayment(amount, apr, months),
    monthsLeft: months,
    takenDay: w.day,
    lender: bankName(w),
  };
  c.loans.push(loan);
  c.cash += amount;
  return loan;
}

function serviceLoans(c: Company): void {
  for (const l of c.loans) {
    const interest = l.balance * (l.apr / 12);
    const payment = Math.min(l.monthlyPayment, l.balance + interest);
    const principal = payment - interest;
    c.cash -= payment;
    c.ledger.interest += interest;
    l.balance = Math.max(0, l.balance - principal);
    l.monthsLeft -= 1;
    if (c.cash < 0) c.defaults += 1;
  }
  c.loans = c.loans.filter((l) => l.balance > 1 && l.monthsLeft > 0);
}

// ------------------------------------------------------------ valuation

export function pipelineValue(w: World, c: Company): number {
  let v = 0;
  for (const g of gamesOf(w, c.id)) {
    if (g.status !== 'development') continue;
    const progress = Math.min(1, g.workDone / Math.max(1, g.workRequired));
    v += (g.budgetSpent + g.workDone * 180) * (0.5 + progress * 0.5) * (0.6 + Math.min(2, g.hype / 300));
  }
  return v;
}

export function holdingsValue(w: World, c: Company): number {
  let v = 0;
  for (const id in c.holdings) {
    const t = w.companies[id];
    if (t && t.status === 'active') v += c.holdings[id].shares * t.price;
  }
  return v;
}

export function computeValuation(w: World, c: Company): number {
  const rev = revenueTTM(c);
  const recent = recentRevenue(c, 3);
  const annualRecent = recent * 4;
  const growth = rev > 0 ? clamp(annualRecent / rev - 1, -0.6, 1.2) : 0;
  const profit = profitTTM(c);
  const margin = rev > 0 ? clamp(profit / rev, -0.6, 0.6) : 0;
  let multiple = clamp(2.2 + 4.5 * growth + 3 * margin, 0.5, 9);
  multiple *= Math.sqrt(clamp(w.market.index / 1000, 0.3, 3));

  // live revenue run-rate catches recent hits before TTM does
  let liveRun = 0;
  let ipFans = 0;
  for (const g of gamesOf(w, c.id)) if (g.status === 'released') liveRun += g.rev30 * 12;
  for (const id in w.ips) if (w.ips[id].companyId === c.id) ipFans += w.ips[id].fans;

  let subs = 0;
  for (const id in w.companies) {
    const s = w.companies[id];
    if (s.parentId === c.id && s.status === 'active') subs += Math.max(0, s.valuation);
  }

  const earnings = Math.max(rev, liveRun * 0.85);
  const v =
    c.cash -
    debtOf(c) +
    earnings * multiple +
    pipelineValue(w, c) +
    ipFans * 2.5 +
    subs +
    holdingsValue(w, c) +
    c.reputation * 20000;
  return Math.max(Math.max(1000, c.cash * 0.3), v);
}

// ------------------------------------------------------------ monthly close

export function monthlyClose(w: World, c: Company): void {
  serviceLoans(c);
  const revenue = ledgerRevenue(c.ledger);
  let expenses = ledgerExpenses(c.ledger);
  const preTax = revenue - expenses;
  if (preTax > 0) {
    const tax = preTax * TAX_RATE;
    c.cash -= tax;
    c.ledger.taxes += tax;
    expenses += tax;
  }
  c.monthly.push({
    day: w.day,
    label: formatMonth(w.day - 1),
    revenue,
    expenses,
    profit: revenue - expenses,
    cash: c.cash,
    ledger: c.ledger,
  });
  if (c.monthly.length > 84) c.monthly.splice(0, c.monthly.length - 84);
  c.ledger = emptyLedger();

  // reputation drifts toward the reception of the studio's recent work
  const recent = gamesOf(w, c.id).filter((g) => g.releaseDay !== null && w.day - g.releaseDay < 1100);
  if (recent.length > 0) {
    let s = 0;
    let wsum = 0;
    let bad = 0;
    for (const g of recent) {
      const wt = 1 + Math.log10(1 + g.owners / 1000);
      s += (g.criticScore * 0.5 + g.userScore * 0.5) * wt;
      wsum += wt;
      bad += MONETIZATIONS[g.monetization].repDrift * 30;
    }
    const avg = s / wsum;
    const scale = Math.min(1, Math.log10(1 + c.fans) / 7);
    const target = clamp((avg - 35) * 1.5 * (0.35 + 0.65 * scale), 0, 100);
    c.reputation = clamp(c.reputation + (target - c.reputation) * 0.08 + Math.max(-2.5, bad), 0, 100);
  }
  let fans = 0;
  for (const id in w.ips) if (w.ips[id].companyId === c.id) fans += w.ips[id].fans;
  c.fans = fans;

  c.valuation = computeValuation(w, c);
  pushPoint(c.valuationHistory, w.day, c.valuation, 120);
}

export function updateIpFans(w: World): void {
  for (const id in w.ips) {
    const ip = w.ips[id];
    let best = 0;
    for (const gid of ip.games) {
      const g = w.games[gid];
      if (!g || g.releaseDay === null) continue;
      const r = (g.criticScore + g.userScore) / 200;
      best += g.owners * r * r * 0.35;
    }
    ip.fans = Math.max(ip.fans * 0.995, best);
  }
}

export function recordCash(w: World, c: Company): void {
  pushPoint(c.cashHistory, w.day, c.cash, 400);
}

export function randomInvestorAppetite(w: World): number {
  return randRange(w, 0.85, 1.2) * clamp(w.market.index / 1000, 0.5, 1.8) ** 0.5;
}
