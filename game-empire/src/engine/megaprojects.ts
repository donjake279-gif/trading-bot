// Empire megaprojects. Civilisation-scale projects for companies worth $10T
// and up: years of construction in phases, each phase ending in a hard call
// (cost overruns, protests, sabotage, breakthroughs). Finished projects
// change the rules of the game for good. The megacorps race you for them.
import { activeCorps } from './megacorps';
import { dlog, execPower, featureOpen, fmtMoney } from './dominionCore';
import { pushDecision } from './events';
import type { ActionResult, DecisionEvent, MegaprojectId, MegaprojectRun, World } from './types';
import { celebrate, clamp, fanChange, playerCompany, pushNews, spend, toast } from './util';
import { chance, pick } from './rng';

const fail = (error: string): ActionResult => ({ ok: false, error });
const ok = (): ActionResult => ({ ok: true });

export const MEGAPROJECTS: Record<MegaprojectId, { name: string; emoji: string; blurb: string; effect: string; budget: number; days: number; phases: string[]; requires: (w: World) => string | null }> = {
  neuralNet: {
    name: 'Planetary Neural Network',
    emoji: '🧬',
    blurb: 'A recommendation brain wired into every screen on Earth.',
    effect: 'Your games get +15% visibility and AI training costs 20% less.',
    budget: 2e12,
    days: 900,
    phases: ['Data centers on every continent', 'Training the planetary model', 'Switching it on'],
    requires: () => null,
  },
  fusionGrid: {
    name: 'Fusion Power Grid',
    emoji: '⚛️',
    blurb: 'Clean, almost free electricity for everything you own.',
    effect: 'Data center power costs fall 80%; your cities are happier.',
    budget: 4e12,
    days: 1080,
    phases: ['Reactor prototypes', 'Building the plants', 'Connecting the grid'],
    requires: () => null,
  },
  fullDive: {
    name: 'Full-Dive VR',
    emoji: '🥽',
    blurb: 'Neural interfaces: play with your whole mind.',
    effect: 'VR players triple; your universes hold twice as many residents.',
    budget: 6e12,
    days: 1080,
    phases: ['Neural interface research', 'Clinical trials', 'Mass production'],
    requires: () => null,
  },
  orbitalElevator: {
    name: 'Orbital Elevator',
    emoji: '🗼',
    blurb: 'A cable to orbit. Space gets cheap.',
    effect: 'Space construction costs halve and launches almost never fail.',
    budget: 1e13,
    days: 1440,
    phases: ['Anchor station', 'Spinning the carbon tether', 'The first climb'],
    requires: (w) => (w.player.dominion.space.assets.some((a) => a.kind === 'spaceport' && a.stage === 'active') ? null : 'Needs an active spaceport.'),
  },
  arcologies: {
    name: 'Arcology Network',
    emoji: '🏙️',
    blurb: 'Mile-high self-contained cities.',
    effect: 'Your cities hold twice the people and can grow to 18 districts.',
    budget: 8e12,
    days: 1260,
    phases: ['Foundations', 'Superstructures', 'Moving day'],
    requires: (w) => (w.player.dominion.cities.length ? null : 'Needs a company city.'),
  },
  quantumWeb: {
    name: 'Quantum Internet',
    emoji: '🔮',
    blurb: 'Unhackable, instant networking across the planet.',
    effect: 'Security defense +15 and cloud income doubles.',
    budget: 1.2e13,
    days: 1260,
    phases: ['Quantum repeaters', 'Entangling the backbone', 'Cutover'],
    requires: () => null,
  },
  dysonCompute: {
    name: 'Dyson Compute Swarm',
    emoji: '☀️',
    blurb: 'Solar-powered computers circling the Sun.',
    effect: 'Your AI jumps 50% ahead of every rival and the AI market grows tenfold.',
    budget: 4e13,
    days: 1800,
    phases: ['Mining Mercury', 'Launching the first collectors', 'Closing the swarm'],
    requires: (w) => (w.player.dominion.megaprojects.some((m) => m.id === 'orbitalElevator' && m.stage === 'done') ? null : 'Needs the Orbital Elevator.'),
  },
  terraform: {
    name: 'Terraform Mars',
    emoji: '🌍',
    blurb: 'A second Earth, and billions of new players.',
    effect: 'Mars colonies grow twentyfold.',
    budget: 6e13,
    days: 2160,
    phases: ['Thickening the atmosphere', 'Warming the planet', 'Oceans'],
    requires: (w) => (w.player.dominion.space.assets.some((a) => a.kind === 'marsColony' && a.stage === 'active') ? null : 'Needs an active Mars colony.'),
  },
  starship: {
    name: 'Interstellar Starship',
    emoji: '🌌',
    blurb: 'Leave the Solar System. The last project there is.',
    effect: 'Your legacy: the game’s greatest achievement, 10 billion fans and a legendary send-off.',
    budget: 1.5e14,
    days: 2520,
    phases: ['Fusion drive', 'The ark', 'Crew and launch'],
    requires: (w) =>
      w.player.dominion.megaprojects.some((m) => m.id === 'orbitalElevator' && m.stage === 'done') && w.player.dominion.space.assets.some((a) => a.kind === 'marsColony' && a.stage === 'active')
        ? null
        : 'Needs the Orbital Elevator and a Mars colony.',
  },
};

export const MEGAPROJECT_IDS = Object.keys(MEGAPROJECTS) as MegaprojectId[];

export function megaDone(w: World, id: MegaprojectId): boolean {
  return !!w.player.dominion?.megaprojects.some((m) => m.id === id && m.stage === 'done');
}

export function megaBlocker(w: World, id: MegaprojectId): string | null {
  if (!featureOpen(w, 'megaprojects')) return 'Megaprojects unlock at the World Power level ($10T).';
  const d = w.player.dominion;
  if (d.megaprojects.some((m) => m.id === id && m.stage !== 'abandoned')) return 'Already underway or finished.';
  if (d.megaprojects.filter((m) => m.stage === 'building').length >= 2) return 'At most two megaprojects at once.';
  const req = MEGAPROJECTS[id].requires(w);
  if (req) return req;
  if (playerCompany(w).cash < MEGAPROJECTS[id].budget * 0.1) return `Needs at least ${fmtMoney(MEGAPROJECTS[id].budget * 0.1)} in the bank to start.`;
  return null;
}

export function startMegaproject(w: World, id: MegaprojectId): ActionResult {
  const blocker = megaBlocker(w, id);
  if (blocker) return fail(blocker);
  const d = w.player.dominion;
  d.megaprojects = d.megaprojects.filter((m) => !(m.id === id && m.stage === 'abandoned'));
  const run: MegaprojectRun = { id, stage: 'building', phase: 0, progress: 0, start: w.day, spent: 0, budget: MEGAPROJECTS[id].budget, quality: 1, pausedUntil: 0, done: 0 };
  d.megaprojects.push(run);
  pushNews(w, { kind: 'player', title: `${playerCompany(w).name} begins the ${MEGAPROJECTS[id].name}`, body: fmtMoney(run.budget), companyId: w.player.companyId, tone: 'major' });
  dlog(w, `Megaproject started: ${MEGAPROJECTS[id].name} (${fmtMoney(run.budget)}).`, 'major');
  return ok();
}

export function abandonMegaproject(w: World, id: MegaprojectId): ActionResult {
  const m = w.player.dominion.megaprojects.find((x) => x.id === id && x.stage === 'building');
  if (!m) return fail('Nothing to abandon.');
  m.stage = 'abandoned';
  playerCompany(w).reputation = Math.max(0, playerCompany(w).reputation - 5);
  dlog(w, `${MEGAPROJECTS[id].name} abandoned after ${fmtMoney(m.spent)}.`, 'bad');
  return ok();
}

function phaseDays(m: MegaprojectRun): number {
  return MEGAPROJECTS[m.id].days / MEGAPROJECTS[m.id].phases.length;
}

export function megaprojectsDaily(w: World): void {
  const d = w.player.dominion;
  if (!d?.megaprojects.length) return;
  const p = playerCompany(w);
  for (const m of d.megaprojects) {
    if (m.stage !== 'building' || w.day < m.pausedUntil) continue;
    // no money, no progress
    if (p.cash < 0) continue;
    const def = MEGAPROJECTS[m.id];
    const today = m.budget / def.days;
    spend(p, 'buildout', today);
    m.spent += today;
    m.progress += (1 / phaseDays(m)) * (1 + 0.15 * execPower(w, 'coo'));
    if (m.progress < 1) continue;
    m.progress = 0;
    m.phase += 1;
    if (m.phase >= def.phases.length) {
      finish(w, m);
      continue;
    }
    phaseDecision(w, m);
  }
}

function phaseDecision(w: World, m: MegaprojectRun): void {
  const def = MEGAPROJECTS[m.id];
  const kind = pick(w, ['overrun', 'protest', 'breakthrough', 'sabotage'] as const);
  const p = playerCompany(w);
  const extra = Math.round(m.budget * 0.15);
  const done = def.phases[m.phase - 1];
  const next = def.phases[m.phase];
  const base = { kind: 'megaPhase', expiresDay: w.day + 30, data: { id: m.id, event: kind, cost: extra } };
  if (w.pendingEvents.some((e) => e.kind === 'megaPhase')) return;
  if (kind === 'overrun') {
    pushDecision(w, {
      ...base,
      title: `${def.name}: cost overrun`,
      body: `"${done}" is finished, but "${next}" will cost more than planned. Pay ${fmtMoney(extra)} to stay on schedule, cut scope (the finished project will be weaker), or pause 6 months to re-plan.`,
      options: [
        { id: 'pay', label: `Pay · ${fmtMoney(extra)}`, description: 'Full quality, on schedule.', disabled: p.cash < extra },
        { id: 'descope', label: 'Cut scope', description: 'Quality -20%.' },
        { id: 'pause', label: 'Pause 6 months', description: 'No extra cost, no progress.' },
      ],
      defaultOption: 'descope',
    });
  } else if (kind === 'protest') {
    pushDecision(w, {
      ...base,
      title: `${def.name}: protests at the site`,
      body: `Activists have blocked construction of "${next}". Lobby the government (${fmtMoney(extra / 3)}), move the site (90 days lost), or push through (${fanChange(p, -6)}).`,
      options: [
        { id: 'lobby', label: `Lobby · ${fmtMoney(extra / 3)}`, description: 'A great General Counsel makes it stick.', disabled: p.cash < extra / 3 },
        { id: 'relocate', label: 'Move the site', description: '90-day delay.' },
        { id: 'push', label: 'Push through', description: `${fanChange(p, -6)}.` },
      ],
      data: { id: m.id, event: kind, cost: extra / 3 },
      defaultOption: 'relocate',
    });
  } else if (kind === 'breakthrough') {
    pushDecision(w, {
      ...base,
      title: `${def.name}: a breakthrough`,
      body: `Your engineers found a better way to do "${next}". Spend ${fmtMoney(extra / 2)} to rush the next phase, or bank it and make the finished project better.`,
      options: [
        { id: 'rush', label: `Rush it · ${fmtMoney(extra / 2)}`, description: 'The next phase is 60% done already.', disabled: p.cash < extra / 2 },
        { id: 'bank', label: 'Bank it', description: 'Quality +15%.' },
      ],
      data: { id: m.id, event: kind, cost: extra / 2 },
      defaultOption: 'bank',
    });
  } else {
    pushDecision(w, {
      ...base,
      title: `${def.name}: sabotage suspected`,
      body: `Equipment keeps failing on "${next}" and security suspects a rival. Run a full security sweep (${fmtMoney(extra / 4)}), or press on and hope.`,
      options: [
        { id: 'sweep', label: `Security sweep · ${fmtMoney(extra / 4)}`, description: 'Catch them. A great CSO helps.', disabled: p.cash < extra / 4 },
        { id: 'press', label: 'Press on', description: '50% chance of a 120-day setback.' },
      ],
      data: { id: m.id, event: kind, cost: extra / 4 },
      defaultOption: 'press',
    });
  }
}

export function resolveMegaDecision(w: World, ev: DecisionEvent, optionId: string): boolean {
  if (ev.kind !== 'megaPhase') return false;
  const m = w.player.dominion.megaprojects.find((x) => x.id === ev.data.id && x.stage === 'building');
  const p = playerCompany(w);
  if (!m) return true;
  const cost = Number(ev.data.cost) || 0;
  switch (optionId) {
    case 'pay':
      if (p.cash >= cost) {
        spend(p, 'buildout', cost);
        m.spent += cost;
      } else m.quality = Math.max(0.5, m.quality - 0.2);
      break;
    case 'descope':
      m.quality = Math.max(0.5, m.quality - 0.2);
      break;
    case 'pause':
      m.pausedUntil = w.day + 180;
      break;
    case 'lobby':
      if (p.cash >= cost) spend(p, 'buildout', cost);
      if (!chance(w, 0.55 + 0.4 * execPower(w, 'counsel'))) m.pausedUntil = w.day + 60;
      break;
    case 'relocate':
      m.pausedUntil = w.day + 90;
      break;
    case 'push':
      p.reputation = Math.max(0, p.reputation - 6);
      break;
    case 'rush':
      if (p.cash >= cost) {
        spend(p, 'buildout', cost);
        m.spent += cost;
        m.progress = 0.6;
      }
      break;
    case 'bank':
      m.quality = Math.min(1.3, m.quality + 0.15);
      break;
    case 'sweep':
      if (p.cash >= cost) spend(p, 'buildout', cost);
      if (!chance(w, 0.6 + 0.35 * execPower(w, 'cso'))) m.pausedUntil = w.day + 60;
      break;
    case 'press':
      if (chance(w, 0.5)) {
        m.pausedUntil = w.day + 120;
        toast(w, `Sabotage set the ${MEGAPROJECTS[m.id].name} back four months`, 'bad', { category: 'studio', link: { route: 'dominion', id: 'megaprojects' } });
      }
      break;
  }
  return true;
}

function finish(w: World, m: MegaprojectRun): void {
  const d = w.player.dominion;
  const p = playerCompany(w);
  const def = MEGAPROJECTS[m.id];
  m.stage = 'done';
  m.done = w.day;
  d.stats.megaprojects += 1;
  const second = activeCorps(w).some((c) => (c.assets.projects[m.id] ?? 0) >= 1);
  p.reputation = Math.min(100, p.reputation + (second ? 2 : 8));
  applyEffect(w, m);
  celebrate(w, `${def.name} complete!`, true);
  toast(w, `${def.name} is complete`, 'major', { category: 'studio', link: { route: 'dominion', id: 'megaprojects' }, body: def.effect });
  pushNews(w, { kind: 'player', title: `${p.name} completes the ${def.name}`, body: def.effect, companyId: p.id, tone: 'major' });
  dlog(w, `${def.name} complete${second ? ' (a rival finished one first)' : ', a world first'}. ${def.effect}`, 'major');
  if (m.id === 'starship') {
    d.victory = w.day;
    p.reputation = 100;
  }
}

/** One-off changes when a project completes (ongoing effects are read where they apply). */
function applyEffect(w: World, m: MegaprojectRun): void {
  const v = w.player.ventures;
  if (m.id === 'fullDive') w.market.platforms.vr.users *= 3;
  if (m.id === 'dysonCompute') {
    v.aiMarket *= 10;
    const ai = v.ai;
    if (ai?.models.length) {
      const best = ai.models.reduce((a, b) => (b.quality > a.quality ? b : a));
      best.quality = Math.max(best.quality, v.aiFrontier * (1 + 0.5 * m.quality));
    }
  }
}

/** Monthly: rival megacorps chase megaprojects too. */
export function corpMegaprojectsMonthly(w: World): void {
  if (!featureOpen(w, 'megaprojects')) return;
  for (const c of activeCorps(w)) {
    if (c.valuation < 5e12) continue;
    const want = c.persona === 'visionary' ? 1 : c.persona === 'tycoon' ? 0.6 : 0.35;
    let current = MEGAPROJECT_IDS.find((id) => (c.assets.projects[id] ?? 0) > 0 && (c.assets.projects[id] ?? 0) < 1);
    if (!current) {
      if (!chance(w, 0.06 * want)) continue;
      current = MEGAPROJECT_IDS.find((id) => (c.assets.projects[id] ?? 0) === 0 && MEGAPROJECTS[id].budget < c.valuation * 0.4);
      if (!current) continue;
      c.assets.projects[current] = 0.001;
      pushNews(w, { kind: 'industry', title: `${c.name} announces its own ${MEGAPROJECTS[current].name}`, tone: 'major' });
      dlog(w, `${c.name} starts a ${MEGAPROJECTS[current].name}. The race is on.`, 'neutral');
    }
    const def = MEGAPROJECTS[current];
    const monthly = def.budget / (def.days / 30);
    if (c.cash < monthly) continue;
    c.cash -= monthly;
    c.assets.projects[current] = clamp((c.assets.projects[current] ?? 0) + 30 / def.days, 0, 1);
    if ((c.assets.projects[current] ?? 0) >= 1) {
      for (const s in c.power) c.power[s as keyof typeof c.power] *= 1.06;
      if (current === 'dysonCompute') c.power.ai *= 1.5;
      if (current === 'quantumWeb') c.security = Math.min(100, c.security + 15);
      const yours = megaDone(w, current);
      pushNews(w, { kind: 'industry', title: `${c.name} completes the ${def.name}`, tone: 'major' });
      dlog(w, `${c.name} completes the ${def.name}${yours ? '' : ', beating you to it'}.`, yours ? 'neutral' : 'bad');
      if (!yours) toast(w, `${c.name} finished the ${def.name} first`, 'bad', { category: 'industry', link: { route: 'dominion', id: 'megaprojects' } });
    }
  }
}

export function megaSummary(w: World): string {
  const ms = w.player.dominion.megaprojects;
  const building = ms.filter((m) => m.stage === 'building');
  const done = ms.filter((m) => m.stage === 'done').length;
  return `${building.length} underway · ${done} complete`;
}
