// Work-for-hire contracts: steady income between your own projects.
// Finish before the deadline for full pay and new fans; deliver late
// for half pay; blow past the deadline by a month and the client walks away.
import { CONTRACT_KINDS, CONTRACT_RATE, ROLES, focus } from './constants';
import { memberOutput, playerSpeedMods, teamFactors } from './development';
import { addXp, perkRank } from './progression';
import { pick, randInt, randRange } from './rng';
import type { ActionResult, Contract, ContractOffer, Employee, World } from './types';
import { activeCompanies, bumpRep, earn, newId, playerCompany, toast } from './util';

export const MAX_CONTRACTS = 3;
const FLAT = focus(1, 1, 1, 1, 1, 1);

function developers(w: World): Employee[] {
  return w.player.employees.filter((e) => ROLES[e.role].dev);
}

/** Rough daily work the whole development staff could produce. */
function studioCapacity(w: World): number {
  let t = 0;
  for (const e of developers(w)) t += Math.pow(e.skill / 50, 0.8) * playerSpeedMods(w) * ROLES[e.role].workShare;
  return Math.max(0.6, t);
}

export function contractPayRate(w: World): number {
  const p = playerCompany(w);
  return CONTRACT_RATE * (1 + p.reputation / 120) * (1 + 0.1 * perkRank(w, 'deals'));
}

export function refreshContractOffers(w: World): void {
  const p = playerCompany(w);
  const cap = studioCapacity(w);
  const rivals = activeCompanies(w).filter((c) => !c.isPlayer).map((c) => c.name);
  const offers: ContractOffer[] = [];
  const count = 3 + (p.reputation >= 30 ? 1 : 0);
  for (let i = 0; i < count; i++) {
    const k = pick(w, CONTRACT_KINDS);
    const client = k.clients.length ? pick(w, k.clients) : rivals.length ? pick(w, rivals) : 'A rival studio';
    const days = randInt(w, 25, 90);
    const share = randRange(w, 0.35, 1);
    const work = Math.max(6, Math.round(cap * share * days * randRange(w, 0.55, 0.85)));
    const pay = Math.round((work * contractPayRate(w) * randRange(w, 0.85, 1.2)) / 100) * 100;
    offers.push({
      id: newId(w, 'k'),
      client,
      kind: k.kind,
      title: k.title,
      work,
      days,
      pay,
      rep: work > 400 ? 2 : 1,
      expiresDay: w.day + 30,
    });
  }
  w.player.contractOffers = offers;
  w.player.contractsRefreshDay = w.day;
}

export function acceptContract(w: World, offerId: string, teamIds: string[]): ActionResult {
  const offer = w.player.contractOffers.find((o) => o.id === offerId);
  if (!offer) return { ok: false, error: 'That offer is gone.' };
  if (w.player.contracts.length >= MAX_CONTRACTS) return { ok: false, error: `You can run at most ${MAX_CONTRACTS} contracts at once.` };
  const team = w.player.employees.filter((e) => teamIds.includes(e.id) && ROLES[e.role].dev);
  if (team.length === 0) return { ok: false, error: 'Assign at least one developer.' };
  const contract: Contract = { ...offer, workDone: 0, startDay: w.day, deadline: w.day + offer.days };
  w.player.contracts.push(contract);
  w.player.contractOffers = w.player.contractOffers.filter((o) => o.id !== offerId);
  for (const e of team) e.assignment = contract.id;
  return { ok: true, id: contract.id };
}

export function abandonContract(w: World, id: string): ActionResult {
  const c = w.player.contracts.find((x) => x.id === id);
  if (!c) return { ok: false, error: 'Contract not found.' };
  finish(w, c, 'abandoned');
  return { ok: true };
}

function finish(w: World, c: Contract, how: 'done' | 'late' | 'failed' | 'abandoned') {
  const p = playerCompany(w);
  for (const e of w.player.employees) if (e.assignment === c.id) e.assignment = null;
  w.player.contracts = w.player.contracts.filter((x) => x.id !== c.id);
  if (how === 'done' || how === 'late') {
    const pay = how === 'done' ? c.pay : Math.round(c.pay * 0.5);
    earn(p, 'contracts', pay);
    p.reputation = Math.max(0, Math.min(100, p.reputation + (how === 'done' ? c.rep : -1)));
    w.player.contractsCompleted += 1;
    addXp(w, Math.min(200, 20 + c.work / 10));
    toast(w, how === 'done' ? `Contract delivered to ${c.client}: +$${pay.toLocaleString()}` : `Late delivery to ${c.client}: half pay ($${pay.toLocaleString()})`, how === 'done' ? 'good' : 'bad', {
      category: 'studio',
      link: { route: 'projects' },
    });
  } else {
    const lost = bumpRep(p, how === 'failed' ? -4 : -3);
    toast(w, how === 'failed' ? `${c.client} cancelled your contract for missing the deadline` : `You walked away from the ${c.client} contract`, 'bad', {
      category: 'studio',
      link: { route: 'projects' },
      body: `${lost}.`,
    });
  }
}

export function contractTeam(w: World, id: string): Employee[] {
  return w.player.employees.filter((e) => e.assignment === id);
}

/** Daily work a given set of employees would put into a contract. */
export function teamContractWork(w: World, team: Employee[]): number {
  const { teamEff, producerBoost } = teamFactors(team, 'medium');
  let work = 0;
  for (const e of team) work += memberOutput(w, e, FLAT, false, teamEff, producerBoost).work;
  return work;
}

/** Move developers onto a running contract (from whatever they were doing). */
export function staffContract(w: World, id: string, employeeIds: string[]): ActionResult {
  const c = w.player.contracts.find((x) => x.id === id);
  if (!c) return { ok: false, error: 'Contract not found.' };
  const team = w.player.employees.filter((e) => employeeIds.includes(e.id) && ROLES[e.role].dev);
  if (team.length === 0) return { ok: false, error: 'No developers selected.' };
  for (const e of team) e.assignment = id;
  return { ok: true };
}

export function contractDailyWork(w: World, id: string): number {
  const team = contractTeam(w, id);
  const { teamEff, producerBoost } = teamFactors(team, 'medium');
  let work = 0;
  for (const e of team) work += memberOutput(w, e, FLAT, false, teamEff, producerBoost).work;
  return work;
}

export function contractsDaily(w: World): void {
  const p = playerCompany(w);
  if (!p || p.status !== 'active') return;
  for (const c of [...w.player.contracts]) {
    const work = contractDailyWork(w, c.id);
    c.workDone += work;
    for (const e of contractTeam(w, c.id)) e.xp += 0.015;
    if (c.workDone >= c.work) finish(w, c, w.day <= c.deadline ? 'done' : 'late');
    else if (w.day > c.deadline + 30) finish(w, c, 'failed');
    else if (w.day === c.deadline - 7 && c.workDone < c.work * 0.8) {
      toast(w, `Contract for ${c.client} is due in a week and only ${Math.round((c.workDone / c.work) * 100)}% done`, 'bad', { category: 'studio', link: { route: 'projects' } });
    }
  }
  w.player.contractOffers = w.player.contractOffers.filter((o) => o.expiresDay > w.day);
  if (w.day - w.player.contractsRefreshDay >= 30) refreshContractOffers(w);
}
