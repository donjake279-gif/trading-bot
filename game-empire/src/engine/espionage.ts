// Corporate espionage. Rival megacorps plant insiders, leak your projects,
// poach your people, hack your servers and steal your tech; your security
// tier and CSO decide how much gets through. You can play the same game:
// steal roadmaps, plant moles, poach executives, sabotage launches, smear
// rivals or hack them, and live with the scandal if you're caught.
import { catchExecMole, refreshExecPool } from './executives';
import { activeCorps, corpById, corpRevenue, shiftRelation, startWar, warsOf } from './megacorps';
import { SECTOR_IDS, addScar, dlog, empireScale, execPower, featureOpen, fmtMoney } from './dominionCore';
import { rivalPace } from './empire';
import { pushDecision } from './events';
import type { ActionResult, DecisionEvent, Megacorp, OpKind, SectorId, SpyOp, Threat, ThreatKind, World } from './types';
import { clamp, newId, playerCompany, pushNews, spend, toast } from './util';
import { chance, pick, rand, weightedPick } from './rng';

const fail = (error: string): ActionResult => ({ ok: false, error });
const ok = (id?: string): ActionResult => ({ ok: true, id });

export const SECURITY_TIERS = [
  { name: 'Basic IT', rate: 0, defense: 10, blurb: 'Antivirus and a strongly worded password policy.' },
  { name: 'Hardened Network', rate: 0.002, defense: 30, blurb: 'Firewalls, audits and a real security team.' },
  { name: 'Zero Trust', rate: 0.004, defense: 45, blurb: 'Nobody gets in without proving who they are, every time.' },
  { name: 'Counter-Intelligence Division', rate: 0.007, defense: 60, blurb: 'Former spies hunting for moles inside your company.' },
  { name: 'Quantum Encryption', rate: 0.011, defense: 72, blurb: 'Unbreakable keys for everything that matters.' },
  { name: 'Sentinel AI', rate: 0.016, defense: 85, blurb: 'An AI that watches every packet and every person. A little creepy.' },
];

/** What a security tier costs per month. */
export function securityCost(w: World, level: number): number {
  return (SECURITY_TIERS[level].rate * empireScale(w)) / 12;
}

/** 0..100: how hard you are to spy on. */
export function defense(w: World): number {
  const lvl = w.player.dominion.spy.level;
  const quantum = w.player.dominion.megaprojects.some((m) => m.id === 'quantumWeb' && m.stage === 'done') ? 15 : 0;
  return clamp(SECURITY_TIERS[lvl].defense + 15 * execPower(w, 'cso') + 5 * execPower(w, 'cto') + quantum, 0, 99);
}

/** Your spies' skill. */
export function offense(w: World): number {
  return 25 + 45 * execPower(w, 'cso') + 4 * w.player.dominion.spy.level;
}

export function setSecurityLevel(w: World, level: number): ActionResult {
  if (!featureOpen(w, 'espionage')) return fail('Espionage unlocks at the Industry Giant level ($10B).');
  const lvl = clamp(Math.round(level), 0, SECURITY_TIERS.length - 1);
  const spy = w.player.dominion.spy;
  if (lvl > spy.level) {
    const setup = securityCost(w, lvl) * 3;
    const p = playerCompany(w);
    if (p.cash < setup) return fail(`Setting it up costs ${fmtMoney(setup)}.`);
    spend(p, 'warfare', setup);
  }
  spy.level = lvl;
  return ok();
}

export function auditCost(w: World): number {
  return Math.round(empireScale(w) * 0.0015);
}

/** Sweep the company for moles. */
export function securityAudit(w: World): ActionResult {
  if (!featureOpen(w, 'espionage')) return fail('Espionage is locked.');
  const spy = w.player.dominion.spy;
  if (w.day - spy.auditDay < 60) return fail(`Your last audit was ${w.day - spy.auditDay} days ago. Wait until ${60 - (w.day - spy.auditDay)} more days have passed.`);
  const cost = auditCost(w);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`An audit costs ${fmtMoney(cost)}.`);
  spend(p, 'warfare', cost);
  spy.auditDay = w.day;
  const odds = clamp(0.45 + defense(w) / 200, 0.45, 0.95);
  let found = 0;
  for (const t of spy.threats) {
    if (t.kind === 'insider' && !t.detected && chance(w, odds)) {
      revealInsider(w, t);
      found++;
    }
  }
  const exec = catchExecMole(w, odds * 0.8);
  if (exec) found++;
  if (!found) spyLog(w, 'Security audit: no moles found.', 'neutral');
  toast(w, found ? `Audit found ${found} mole${found === 1 ? '' : 's'}` : 'Audit complete: the company looks clean', found ? 'bad' : 'good', { category: 'studio', link: { route: 'dominion', id: 'espionage' } });
  return ok();
}

function spyLog(w: World, text: string, tone: 'good' | 'bad' | 'neutral'): void {
  const spy = w.player.dominion.spy;
  spy.log.unshift({ day: w.day, text, tone });
  if (spy.log.length > 40) spy.log.length = 40;
}

// ------------------------------------------------------------ threats against you

const THREAT_NAMES: Record<ThreatKind, string> = { insider: 'Insider', leak: 'Project leak', poach: 'Poaching', cyber: 'Cyberattack', theft: 'Tech theft' };

/** Weekly: every megacorp with spies might try something. */
export function threatsWeekly(w: World): void {
  if (!featureOpen(w, 'espionage')) return;
  const corps = activeCorps(w);
  const spy = w.player.dominion.spy;
  // before the megacorps arrive, rival studios still try the odd thing
  const sources: { corp: Megacorp | null; odds: number }[] = corps.length
    ? corps.map((c) => ({ corp: c, odds: attemptOdds(w, c) }))
    : [{ corp: null, odds: 0.015 * (1 + rivalPace(w)) }];
  for (const s of sources) {
    if (!chance(w, s.odds)) continue;
    const kind = weightedPick(w, ['insider', 'leak', 'poach', 'cyber', 'theft'] as ThreatKind[], [s.corp?.persona === 'schemer' ? 3 : 1.5, 2, 2, 1.5, 1]);
    const name = s.corp?.name ?? 'A rival';
    if (chance(w, defense(w) / 120)) {
      if (chance(w, 0.4)) spyLog(w, `Security stopped ${THREAT_NAMES[kind].toLowerCase()} attempt by ${name}.`, 'good');
      continue;
    }
    attack(w, s.corp, kind);
  }
  // hidden insiders keep leaking
  for (const t of spy.threats) {
    if (t.kind !== 'insider' || t.detected) continue;
    const c = corpById(w, t.corpId);
    if (c) c.intel = Math.min(100, c.intel + 0.8);
  }
}

function attemptOdds(w: World, c: Megacorp): number {
  const persona = c.persona === 'schemer' ? 3 : c.persona === 'warlord' ? 1.3 : c.persona === 'diplomat' ? 0.5 : 1;
  const hostility = c.relation < 0 ? 1 + -c.relation / 60 : 0.6;
  const war = warsOf(w, c.id).some((x) => x.attackers.includes('player') || x.defenders.includes('player')) ? 2 : 1;
  return 0.012 * (c.intel / 50) * persona * hostility * war * (1 + rivalPace(w));
}

function attack(w: World, c: Megacorp | null, kind: ThreatKind): void {
  const d = w.player.dominion;
  const spy = d.spy;
  const p = playerCompany(w);
  const name = c?.name ?? 'A rival';
  if (kind === 'insider') {
    if (!c) return;
    const t: Threat = { id: newId(w, 'th'), kind, corpId: c.id, day: w.day, detected: false, target: null, strength: c.intel };
    spy.threats.push(t);
    return; // nobody notices... yet
  }
  if (kind === 'leak') {
    const games = Object.values(w.games).filter((g) => g.companyId === p.id && g.status === 'development' && g.hype > 20);
    const plan = d.keynotes.plan;
    if (plan && chance(w, 0.4)) {
      w.player.flags[`leak:${plan.id}`] = w.day;
      spy.stats.leaks += 1;
      spyLog(w, `${name} leaked your keynote line-up. The surprises won't land as hard.`, 'bad');
      toast(w, 'Your keynote line-up leaked', 'bad', { category: 'studio', link: { route: 'dominion', id: 'keynotes' }, body: `${name} got hold of the run sheet. Reactions will be muted unless you change it.` });
      return;
    }
    if (!games.length) return;
    const g = pick(w, games);
    g.hype *= 0.7;
    spy.stats.leaks += 1;
    if (!w.pendingEvents.some((e) => e.kind === 'spyLeak')) {
      pushDecision(w, {
        kind: 'spyLeak',
        title: `${g.title} leaked online`,
        body: `Builds and screenshots of ${g.title} are everywhere, apparently via ${name}. Lean into it with an official reveal (hype recovers, reputation +1), or go after the leakers with lawyers (${fmtMoney(auditCost(w))}; you might trace it back and learn a lot about ${name}).`,
        options: [
          { id: 'embrace', label: 'Official reveal', description: 'Hype recovers to where it was.' },
          { id: 'legal', label: `Lawyers · ${fmtMoney(auditCost(w))}`, description: `Trace the leak. Intel on ${name} +30 if it works.`, disabled: p.cash < auditCost(w) },
        ],
        data: { gameId: g.id, corpId: c?.id ?? '', hype: g.hype / 0.7, cost: auditCost(w) },
        expiresDay: w.day + 21,
        defaultOption: 'embrace',
      });
    }
    spyLog(w, `${g.title} leaked, apparently via ${name}.`, 'bad');
    return;
  }
  if (kind === 'poach') {
    const staff = w.player.employees.filter((e) => !e.isFounder).sort((a, b) => b.skill - a.skill);
    const target = staff[Math.min(staff.length - 1, Math.floor(rand(w) * Math.min(5, staff.length)))];
    if (!target) return;
    // HR handles the routine ones: a counter-offer, if the money is there
    if (w.player.hr.autoRaise && p.cash > target.salary * 24) {
      target.salary = Math.round(target.salary * 1.3);
      target.morale = Math.min(100, target.morale + 10);
      spyLog(w, `${name} tried to poach ${target.name}; HR kept them with a 30% raise.`, 'neutral');
      return;
    }
    w.player.employees = w.player.employees.filter((e) => e.id !== target.id);
    spy.stats.poached += 1;
    if (c) c.intel = Math.min(100, c.intel + 2);
    spyLog(w, `${name} poached ${target.name} (skill ${Math.round(target.skill)}).`, 'bad');
    toast(w, `${name} poached ${target.name}`, 'bad', { category: 'team', link: { route: 'team' }, body: 'Turn on auto raises in HR to counter-offer automatically.' });
    return;
  }
  if (kind === 'cyber') {
    const sev = 1 - defense(w) / 140;
    const days = Math.max(1, Math.round(4 * sev));
    w.player.infra.outageUntil = Math.max(w.player.infra.outageUntil, w.day + days);
    if (d.ecosystem) d.ecosystem.users *= 1 - 0.03 * sev;
    p.reputation = Math.max(0, p.reputation - 1);
    spyLog(w, `${name} hit your servers with a cyberattack: ${days} day${days === 1 ? '' : 's'} of outages.`, 'bad');
    toast(w, `Cyberattack by ${name}`, 'bad', { category: 'server', link: { route: 'servers' }, body: `Your online services are down for ${days} day${days === 1 ? '' : 's'}. More security makes attacks rarer and shorter.` });
    return;
  }
  // tech theft
  const v = w.player.ventures;
  let what = 'engine source code';
  if (v.ai?.models.length) {
    v.aiFrontier += 2;
    what = 'AI model weights';
  } else if (v.consoles.length) {
    v.rivalPower *= 1.03;
    what = 'console designs';
  }
  if (c) c.intel = Math.min(100, c.intel + 3);
  spyLog(w, `${name} stole your ${what}.`, 'bad');
  toast(w, `${name} stole your ${what}`, 'bad', { category: 'studio', link: { route: 'dominion', id: 'espionage' } });
}

/** Monthly: insiders get caught (or keep digging), intel fades, plants report in. */
export function espionageMonthly(w: World): void {
  if (!featureOpen(w, 'espionage')) return;
  const d = w.player.dominion;
  const spy = d.spy;
  const p = playerCompany(w);
  const cost = securityCost(w, spy.level) * (1 - 0.2 * execPower(w, 'cfo'));
  if (cost > 0) spend(p, 'warfare', cost);
  const odds = 0.06 + defense(w) / 260 + 0.2 * execPower(w, 'cso');
  for (const t of spy.threats) {
    if (t.kind !== 'insider' || t.detected) continue;
    if (chance(w, odds)) revealInsider(w, t);
    else if (chance(w, 0.25)) {
      // the insider leaks something
      const c = corpById(w, t.corpId);
      if (c) {
        c.intel = Math.min(100, c.intel + 5);
        for (const war of d.wars) if ((war.attackers.includes(c.id) || war.defenders.includes(c.id)) && (war.attackers.includes('player') || war.defenders.includes('player'))) war.score += war.attackers.includes('player') ? -3 : 3;
      }
    }
  }
  catchExecMole(w, odds * 0.5);
  spy.threats = spy.threats.filter((t) => !t.detected || w.day - t.day < 365);
  for (const id in spy.intel) spy.intel[id] = Math.max(0, spy.intel[id] - 3);
  for (const id of [...spy.plants]) {
    const c = corpById(w, id);
    if (!c || c.status !== 'active') {
      spy.plants = spy.plants.filter((x) => x !== id);
      continue;
    }
    spy.intel[id] = Math.min(100, (spy.intel[id] ?? 0) + 8);
    if (chance(w, 0.05 * (c.security / 50))) {
      spy.plants = spy.plants.filter((x) => x !== id);
      shiftRelation(w, 'player', id, -20);
      spyLog(w, `${c.name} found and fired your mole.`, 'bad');
      toast(w, `${c.name} caught your mole`, 'bad', { category: 'industry', link: { route: 'dominion', id: 'espionage' } });
    }
  }
  corpVsCorp(w);
}

function revealInsider(w: World, t: Threat): void {
  const spy = w.player.dominion.spy;
  t.detected = true;
  spy.stats.caught += 1;
  const c = corpById(w, t.corpId);
  spyLog(w, `Mole caught: an insider working for ${c?.name ?? 'a rival'}.`, 'good');
  if (w.pendingEvents.some((e) => e.kind === 'spyMole')) return;
  pushDecision(w, {
    kind: 'spyMole',
    title: `Security caught a mole working for ${c?.name ?? 'a rival'}`,
    body: `An engineer has been passing your plans to ${c?.name ?? 'a rival'} for ${Math.max(1, Math.round((w.day - t.day) / 30))} month(s). Fire and prosecute, feed them false information to mislead ${c?.name ?? 'them'}, or expose ${c?.name ?? 'them'} publicly.`,
    options: [
      { id: 'fire', label: 'Fire and prosecute', description: 'Clean and simple. Reputation +1.' },
      { id: 'feed', label: 'Feed them false information', description: `Intel on ${c?.name ?? 'them'} +35. 20% chance they notice.` },
      { id: 'expose', label: 'Expose them publicly', description: `${c?.name ?? 'They'} lose value and friends. Relations collapse.` },
    ],
    data: { corpId: t.corpId },
    expiresDay: w.day + 21,
    defaultOption: 'fire',
  });
}

/** AI megacorps spy on each other too. */
function corpVsCorp(w: World): void {
  const corps = activeCorps(w);
  if (corps.length < 2) return;
  for (const c of corps) {
    const want = c.persona === 'schemer' ? 0.25 : 0.05;
    if (!chance(w, want)) continue;
    const targets = corps.filter((o) => o.id !== c.id);
    const t = targets.reduce((a, b) => ((c.relations[b.id] ?? 0) < (c.relations[a.id] ?? 0) ? b : a));
    const odds = clamp(0.35 + (c.intel - t.security) / 120, 0.1, 0.9);
    if (chance(w, odds)) {
      const top = SECTOR_IDS.reduce((a, b) => (t.power[b] > t.power[a] ? b : a));
      t.power[top] *= 0.98;
      if (chance(w, 0.3)) pushNews(w, { kind: 'industry', title: `${t.name} blames ${c.name} for a string of leaks`, tone: 'neutral' });
    } else if (chance(w, 0.5)) {
      shiftRelation(w, c.id, t.id, -20);
      pushNews(w, { kind: 'industry', title: `${t.name} catches a ${c.name} spy`, tone: 'neutral' });
      dlog(w, `${t.name} catches a ${c.name} spy. Relations sour.`);
    }
  }
}

// ------------------------------------------------------------ your operations

export const OPS: Record<OpKind, { name: string; blurb: string; cost: number; days: number; risk: number; min?: number }> = {
  roadmap: { name: 'Steal their roadmap', blurb: 'Intel +35: better odds in wars and operations, and early warning of their keynotes.', cost: 0.0008, days: 30, risk: 0.1 },
  plant: { name: 'Plant a mole', blurb: 'A long-term source: intel keeps flowing every month until they catch it.', cost: 0.0015, days: 60, risk: 0.15 },
  poach: { name: 'Poach an executive', blurb: 'One of their best people shows up in your executive pool.', cost: 0.001, days: 20, risk: 0.12 },
  sabotage: { name: 'Sabotage a launch', blurb: 'Their strongest market takes a hit; a big swing if you are at war with them.', cost: 0.002, days: 45, risk: 0.3 },
  smear: { name: 'Smear campaign', blurb: 'Their value drops and the other megacorps trust them less.', cost: 0.001, days: 30, risk: 0.2 },
  hack: { name: 'Hack their systems', blurb: 'Steal their tech and set them back in their best market. If it’s traced to you, it’s a global scandal.', cost: 0.003, days: 30, risk: 0.4 },
};

export function opCost(w: World, kind: OpKind, corpId: string): number {
  const c = corpById(w, corpId);
  return Math.round(Math.max(5e7, OPS[kind].cost * (c ? corpRevenue(c) : 1e10)));
}

export function opOdds(w: World, corpId: string): number {
  const c = corpById(w, corpId);
  if (!c) return 0;
  const spy = w.player.dominion.spy;
  return clamp(0.35 + (offense(w) - c.security) / 120 + (spy.intel[corpId] ?? 0) / 300 + (spy.plants.includes(corpId) ? 0.1 : 0), 0.1, 0.92);
}

export function opRisk(w: World, kind: OpKind, corpId: string): number {
  const c = corpById(w, corpId);
  if (!c) return 0;
  return clamp(OPS[kind].risk * (1 - 0.4 * execPower(w, 'cso')) * (c.security / 60), 0.03, 0.8);
}

export function launchOp(w: World, kind: OpKind, corpId: string): ActionResult {
  if (!featureOpen(w, 'espionage')) return fail('Espionage unlocks at the Industry Giant level ($10B).');
  const c = corpById(w, corpId);
  if (!c || c.status !== 'active') return fail('Pick a megacorp to target.');
  const spy = w.player.dominion.spy;
  if (spy.ops.length >= 3) return fail('Your spies are busy: at most 3 operations at once.');
  if (spy.ops.some((o) => o.target === corpId && o.kind === kind)) return fail('That operation is already running.');
  if (kind === 'plant' && spy.plants.includes(corpId)) return fail(`You already have a mole inside ${c.name}.`);
  const cost = opCost(w, kind, corpId);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Costs ${fmtMoney(cost)}.`);
  spend(p, 'warfare', cost);
  const op: SpyOp = { id: newId(w, 'op'), kind, target: corpId, start: w.day, days: OPS[kind].days, cost, odds: opOdds(w, corpId), risk: opRisk(w, kind, corpId) };
  spy.ops.push(op);
  spyLog(w, `Operation launched: ${OPS[kind].name.toLowerCase()} against ${c.name}.`, 'neutral');
  return ok(op.id);
}

export function opsDaily(w: World): void {
  const spy = w.player.dominion?.spy;
  if (!spy?.ops.length) return;
  for (const op of [...spy.ops]) {
    if (w.day - op.start < op.days) continue;
    spy.ops = spy.ops.filter((x) => x.id !== op.id);
    finishOp(w, op);
  }
}

function finishOp(w: World, op: SpyOp): void {
  const d = w.player.dominion;
  const spy = d.spy;
  const c = corpById(w, op.target);
  if (!c || c.status !== 'active') return;
  const success = rand(w) < op.odds;
  const exposed = rand(w) < op.risk * (success ? 0.7 : 1.3);
  const def = OPS[op.kind];
  if (success) {
    spy.stats.opsWon += 1;
    let what = '';
    if (op.kind === 'roadmap') {
      spy.intel[c.id] = Math.min(100, (spy.intel[c.id] ?? 0) + 35);
      const next = d.keynotes.upcoming.find((k) => k.corpId === c.id);
      what = next ? `Intel +35. Their next keynote is on day ${next.day}: "${next.title}".` : 'Intel +35.';
    } else if (op.kind === 'plant') {
      spy.plants.push(c.id);
      spy.intel[c.id] = Math.min(100, (spy.intel[c.id] ?? 0) + 15);
      what = 'Your mole is in place.';
    } else if (op.kind === 'poach') {
      refreshExecPool(w);
      const star = d.execPool[d.execPool.length - 1];
      if (star) {
        star.fromCorp = c.id;
        star.skill = Math.max(star.skill, 88);
        star.mole = null;
      }
      c.intel = Math.max(0, c.intel - 10);
      what = 'One of their best executives is ready to join you (see Executives).';
    } else if (op.kind === 'sabotage') {
      const top = topSector(c);
      c.power[top] *= 0.94;
      for (const war of warsOf(w, c.id)) {
        const mine = war.attackers.includes('player') ? 'attackers' : war.defenders.includes('player') ? 'defenders' : null;
        if (mine) war.score += mine === 'attackers' ? 10 : -10;
      }
      what = `Their ${top} business takes a hit.`;
    } else if (op.kind === 'smear') {
      c.valuation *= 0.96;
      for (const o of activeCorps(w)) if (o.id !== c.id) shiftRelation(w, o.id, c.id, -10);
      what = 'Their value drops and the other megacorps trust them less.';
    } else {
      const top = topSector(c);
      c.power[top] *= 0.9;
      d.mods.push({ sector: top, mult: 1.05, until: w.day + 365, reason: `Stolen ${c.name} tech` });
      what = `Their ${top} business is set back and you earn 5% more there for a year.`;
    }
    spyLog(w, `${def.name} against ${c.name} worked. ${what}`, 'good');
    toast(w, `Operation succeeded: ${def.name.toLowerCase()}`, 'good', { category: 'industry', link: { route: 'dominion', id: 'espionage' }, body: what });
  } else {
    spy.stats.opsFailed += 1;
    spyLog(w, `${def.name} against ${c.name} failed.`, 'bad');
  }
  if (exposed) exposeOp(w, op, c);
}

function topSector(c: Megacorp): SectorId {
  return SECTOR_IDS.reduce((a, b) => (c.power[b] > c.power[a] ? b : a));
}

function exposeOp(w: World, op: SpyOp, c: Megacorp): void {
  const d = w.player.dominion;
  const p = playerCompany(w);
  d.spy.stats.opsExposed += 1;
  const severe = op.kind === 'hack';
  p.reputation = Math.max(0, p.reputation - (severe ? 8 : 3));
  shiftRelation(w, 'player', c.id, severe ? -45 : -30);
  for (const o of activeCorps(w)) if (o.id !== c.id) shiftRelation(w, 'player', o.id, severe ? -10 : -4);
  if (severe) addScar(w, 'Hacking scandal: regulators are watching', 'antitrust', 0.6, 540);
  d.spy.plants = d.spy.plants.filter((x) => x !== c.id);
  pushNews(w, { kind: 'industry', title: `${c.name} accuses ${p.name} of corporate espionage`, tone: 'bad' });
  spyLog(w, `Exposed! ${c.name} traced the ${OPS[op.kind].name.toLowerCase()} back to you.`, 'bad');
  toast(w, `Your spies were exposed by ${c.name}`, 'bad', { category: 'industry', link: { route: 'dominion', id: 'espionage' }, body: severe ? 'A global hacking scandal: reputation -8 and regulators on your back.' : 'Reputation -3 and relations collapse.' });
  // some won't let it go
  if ((c.persona === 'warlord' || c.persona === 'schemer') && featureOpen(w, 'wars') && !warsOf(w, c.id).length && chance(w, 0.35)) {
    startWar(w, c.id, 'player', topSector(c), `${c.name} declares war on ${p.name} over the spying scandal`);
  }
}

export function resolveSpyDecision(w: World, ev: DecisionEvent, optionId: string): boolean {
  const d = w.player.dominion;
  const p = playerCompany(w);
  if (ev.kind === 'spyLeak') {
    const g = w.games[String(ev.data.gameId)];
    if (optionId === 'embrace') {
      if (g && g.status === 'development') g.hype = Math.max(g.hype, Number(ev.data.hype) || g.hype);
      p.reputation = Math.min(100, p.reputation + 1);
    } else if (p.cash >= Number(ev.data.cost)) {
      spend(p, 'warfare', Number(ev.data.cost));
      const corpId = String(ev.data.corpId);
      if (corpId && chance(w, 0.55)) {
        d.spy.intel[corpId] = Math.min(100, (d.spy.intel[corpId] ?? 0) + 30);
        shiftRelation(w, 'player', corpId, -10);
        toast(w, `The leak was traced to ${corpById(w, corpId)?.name ?? 'a rival'}`, 'good', { category: 'industry', link: { route: 'dominion', id: 'espionage' }, body: 'Intel on them +30.' });
      }
    }
    return true;
  }
  if (ev.kind === 'spyMole') {
    const corpId = String(ev.data.corpId);
    const c = corpById(w, corpId);
    if (optionId === 'fire') p.reputation = Math.min(100, p.reputation + 1);
    else if (optionId === 'feed') {
      d.spy.intel[corpId] = Math.min(100, (d.spy.intel[corpId] ?? 0) + 35);
      if (c && chance(w, 0.2)) {
        c.intel = Math.min(100, c.intel + 10);
        spyLog(w, `${c.name} realised their mole was compromised.`, 'bad');
      } else if (c) c.intel = Math.max(0, c.intel - 15);
    } else if (c) {
      c.valuation *= 0.97;
      shiftRelation(w, 'player', corpId, -40);
      for (const o of activeCorps(w)) if (o.id !== corpId) shiftRelation(w, o.id, corpId, -12);
      p.reputation = Math.min(100, p.reputation + 2);
      pushNews(w, { kind: 'industry', title: `${p.name} exposes ${c.name} spy ring`, tone: 'major' });
    }
    d.spy.threats = d.spy.threats.filter((t) => !(t.corpId === corpId && t.detected && t.kind === 'insider'));
    return true;
  }
  return false;
}

/** Hidden insiders, for tests and the end-of-game reveal. */
export function hiddenInsiders(w: World): number {
  return w.player.dominion.spy.threats.filter((t) => t.kind === 'insider' && !t.detected).length;
}
