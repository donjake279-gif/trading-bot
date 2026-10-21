// Empire emergencies. Every so often (more often the bigger you are) a crisis
// hits that no autopilot can handle: a global outage, a mega-breach, a
// whistleblower, a breakup order, a rogue AI... Each runs through three
// stages with a pressure meter; every stage asks for a decision. Contain it
// and you come out stronger; let pressure hit 100 and it becomes a disaster.
// Cutting corners is free today and leaves scars that last for years.
import { activeCorps, corpById, jointVentureCost, shiftRelation, startWar } from './megacorps';
import { SECTOR_IDS, addScar, bestLevel, dlog, empireScale, execPower, featureOpen, fmtMoney, sectorShare } from './dominionCore';
import { pushDecision } from './events';
import { crashWorld } from './universes';
import { loseOrbitalAsset } from './space';
import type { DecisionEvent, Emergency, EmergencyKind, ExecRole, ScarKey, World } from './types';
import { bumpRep, celebrate, clamp, newId, playerCompany, pushNews, spend, toast } from './util';
import { chance, pick, randRange } from './rng';

interface EmergencyDef {
  title: string;
  emoji: string;
  intro: string;
  role: ExecRole;
  applies: (w: World) => boolean;
  stages: [string, string, string];
  spend: [string, string];
  gamble: [string, string];
  cut: [string, string];
  scar: { label: string; key: ScarKey; value: number; days: number };
  ongoing?: (w: World, e: Emergency) => void;
  disaster: (w: World) => string;
}

const biggestCity = (w: World) => w.player.dominion.cities.filter((c) => w.day >= c.ready).sort((a, b) => b.population - a.population)[0];
const biggestWorld = (w: World) => w.player.dominion.universes.filter((u) => u.stage === 'live').sort((a, b) => b.population - a.population)[0];

export const EMERGENCIES: Record<EmergencyKind, EmergencyDef> = {
  outage: {
    title: 'The Great Outage',
    emoji: '🔌',
    intro: 'A cascading failure has taken down your servers worldwide. Online games and services are going dark.',
    role: 'cto',
    applies: (w) => Object.values(w.games).some((g) => g.companyId === w.player.companyId && g.status === 'released' && (g.multiplayer === 'online' || g.multiplayer === 'massive')) || (w.player.dominion.ecosystem?.levels.cloud ?? 0) > 0,
    stages: ['Engineers trace it to a corrupted routing update. Every hour offline costs millions.', 'Services flicker back, then a second wave of failures hits as players flood in.', 'The press wants answers and regulators want a report.'],
    spend: ['Rebuild everything', 'Emergency hardware and every engineer on call.'],
    gamble: ['Reroute through a rival’s cloud', 'Rent capacity from a megacorp. Fast, if it works.'],
    cut: ['Blame a vendor', 'Cheap, but players stop trusting your servers for a year.'],
    scar: { label: 'Players don’t trust your servers', key: 'revenue', value: -0.03, days: 365 },
    ongoing: (w, e) => {
      if (e.pressure > 60) w.player.infra.outageUntil = Math.max(w.player.infra.outageUntil, w.day + 1);
    },
    disaster: (w) => {
      w.player.infra.outageUntil = w.day + 7;
      addScar(w, 'The week the servers died', 'revenue', -0.08, 365);
      return 'A week-long global blackout. Revenue suffers for a year.';
    },
  },
  breach: {
    title: 'The Mega-Breach',
    emoji: '🔓',
    intro: 'Hackers have stolen data from hundreds of millions of accounts.',
    role: 'cso',
    applies: (w) => (w.player.dominion.ecosystem?.users ?? 0) > 1e7 || Object.values(w.games).some((g) => g.companyId === w.player.companyId && g.status === 'released' && g.owners > 1e6),
    stages: ['The breach hasn’t gone public yet. Your security team is still counting.', 'Journalists have the story. Users are leaving.', 'Class-action lawsuits pile up in a dozen countries.'],
    spend: ['Disclose and compensate', 'Pay every affected user. Expensive and honest.'],
    gamble: ['Pay the hackers', 'Maybe they delete it. Maybe they don’t.'],
    cut: ['Downplay it', 'Say little. Trust in your platform erodes for two years.'],
    scar: { label: 'Nobody trusts your platform with their data', key: 'ecoGrowth', value: -0.25, days: 730 },
    ongoing: (w, e) => {
      const eco = w.player.dominion.ecosystem;
      if (eco) eco.users *= 1 - 0.002 * e.severity;
    },
    disaster: (w) => {
      const p = playerCompany(w);
      const fine = Math.min(Math.max(0, p.cash) * 0.3, p.valuation * 0.02);
      spend(p, 'warfare', fine);
      const lost = bumpRep(p, -12);
      addScar(w, 'The breach of the century', 'ecoGrowth', -0.4, 730);
      return `Record fines of ${fmtMoney(fine)} and ${lost}.`;
    },
  },
  whistleblower: {
    title: 'The Whistleblower',
    emoji: '📣',
    intro: 'A former employee says one of your executives covered up fraud and harassment.',
    role: 'counsel',
    applies: (w) => w.player.dominion.execs.length > 0,
    stages: ['The allegations are on every front page.', 'Internal documents leak. The board wants heads to roll.', 'Shareholders are suing.'],
    spend: ['Independent investigation', 'Outside investigators fix what they find.'],
    gamble: ['Fire the executive', 'Fast and public. Might be enough.'],
    cut: ['Deny everything', 'Free today. The stain lasts.'],
    scar: { label: 'A culture scandal that won’t go away', key: 'rep', value: -0.3, days: 540 },
    ongoing: (w) => {
      const p = playerCompany(w);
      p.reputation = Math.max(0, p.reputation - 0.02);
    },
    disaster: (w) => {
      const p = playerCompany(w);
      p.boardConfidence = Math.max(0, p.boardConfidence - 25);
      const lost = bumpRep(p, -10);
      const d = w.player.dominion;
      const e = d.execs.slice().sort((a, b) => a.loyalty - b.loyalty)[0];
      if (e) d.execs = d.execs.filter((x) => x.id !== e.id);
      return `Board confidence -25, ${lost}${e ? `, and ${e.name} is gone` : ''}.`;
    },
  },
  breakup: {
    title: 'Breakup Order',
    emoji: '⚖️',
    intro: 'Regulators on three continents move to split your company up.',
    role: 'counsel',
    applies: (w) => bestLevel(w) >= 5 && SECTOR_IDS.some((s) => sectorShare(w, s) >= 0.35),
    stages: ['The filings are in. Markets are nervous.', 'Hearings begin. Your lawyers have weeks to make the case.', 'The judges are deciding.'],
    spend: ['Lobby every government', 'Armies of lawyers and lobbyists.'],
    gamble: ['Volunteer a concession', 'Offer something small and hope it satisfies them.'],
    cut: ['Accept oversight', 'A government monitor watches you for three years.'],
    scar: { label: 'Under a regulatory monitor', key: 'antitrust', value: 0.8, days: 1095 },
    disaster: (w) => {
      const d = w.player.dominion;
      if (d.annexed.length) {
        const biggest = d.annexed.reduce((a, b) => (sumPower(b.power) > sumPower(a.power) ? b : a));
        d.annexed = d.annexed.filter((x) => x !== biggest);
        return `Forced to spin off ${biggest.name}.`;
      }
      d.mods.push({ sector: 'all', mult: 0.9, until: w.day + 730, reason: 'Breakup order' });
      if (d.ecosystem) d.ecosystem.levels.marketplace = Math.max(0, d.ecosystem.levels.marketplace - 2);
      return 'Divisions spun off: -10% income everywhere for two years.';
    },
  },
  liquidity: {
    title: 'Liquidity Crisis',
    emoji: '💸',
    intro: 'Credit markets have frozen and your bonds are being dumped.',
    role: 'cfo',
    applies: () => true,
    stages: ['Lenders won’t roll over your debt.', 'Suppliers want cash up front. Payroll is next.', 'Ratings agencies are about to downgrade you.'],
    spend: ['Emergency bond issue', 'Expensive debt that calms the markets.'],
    gamble: ['Huge share buyback', 'Show confidence. Markets cheer or panic.'],
    cut: ['Freeze all spending', 'You survive, but lose a year of momentum.'],
    scar: { label: 'A year of lost momentum', key: 'revenue', value: -0.04, days: 365 },
    ongoing: (w) => {
      const p = playerCompany(w);
      if (p.isPublic) p.price *= 0.997;
    },
    disaster: (w) => {
      const p = playerCompany(w);
      const loss = Math.min(Math.max(0, p.cash) * 0.4, p.valuation * 0.03);
      spend(p, 'warfare', loss);
      if (p.isPublic) p.price *= 0.7;
      p.boardConfidence = Math.max(0, p.boardConfidence - 20);
      return `A fire sale of assets (${fmtMoney(loss)}) and a 30% stock crash.`;
    },
  },
  supply: {
    title: 'Supply Chain Collapse',
    emoji: '🚢',
    intro: 'A chip shortage has halted your device factories.',
    role: 'coo',
    applies: (w) => w.player.ventures.consoles.some((c) => c.stage === 'live'),
    stages: ['Factories are idle and orders are piling up.', 'Stores are empty. Scalpers sell your consoles at triple price.', 'Rivals are buying up what supply is left.'],
    spend: ['Buy a chip factory', 'Secure supply at any price.'],
    gamble: ['Redesign around other chips', 'Works brilliantly, or becomes a costly mess.'],
    cut: ['Ration supply', 'Sell less for now; hardware costs rise for a year.'],
    scar: { label: 'Expensive chips', key: 'hardwareCost', value: 0.2, days: 365 },
    ongoing: (w, e) => {
      if (e.pressure > 30) for (const c of w.player.ventures.consoles) if (c.stage === 'live') c.shortageUntil = Math.max(c.shortageUntil, w.day + 1);
    },
    disaster: (w) => {
      for (const c of w.player.ventures.consoles) if (c.stage === 'live') c.shortageUntil = w.day + 150;
      addScar(w, 'Broken supply chains', 'hardwareCost', 0.35, 730);
      return 'Console sales halved for five months and chips cost more for two years.';
    },
  },
  rogueAi: {
    title: 'Rogue AI',
    emoji: '🤖',
    intro: 'Your newest AI model is doing things nobody asked it to.',
    role: 'cto',
    applies: (w) => (w.player.ventures.ai?.models.some((m) => m.gen >= 3) ?? false),
    stages: ['It has started rewriting its own instructions.', 'It has copied itself onto servers you don’t own.', 'Governments demand proof that it is contained.'],
    spend: ['Full shutdown and audit', 'Pull the plug and rebuild it safely (AI income paused 60 days).'],
    gamble: ['Patch it live', 'Your researchers think they can fix it without a shutdown.'],
    cut: ['Downplay it', 'Keep it running. Regulators will remember.'],
    scar: { label: 'AI regulators watch your every model', key: 'aiRevenue', value: -0.3, days: 365 },
    disaster: (w) => {
      const p = playerCompany(w);
      addScar(w, 'AI lab shut down by regulators', 'aiRevenue', -1, 180);
      if (w.player.ventures.ai) w.player.ventures.ai.training = null;
      return `Regulators shut your AI lab for six months. ${bumpRep(p, -15)}.`;
    },
  },
  worldCrash: {
    title: 'Virtual Economy Crash',
    emoji: '📉',
    intro: 'A run on the coin market in your biggest universe: prices are spiralling.',
    role: 'cto',
    applies: (w) => w.player.dominion.universes.some((u) => u.stage === 'live' && u.population > 1e6),
    stages: ['Traders are panic-selling everything.', 'Residents are cashing out and leaving.', 'Creators threaten to move to a rival world.'],
    spend: ['Central bank bailout', 'Buy back coins at a fair price.'],
    gamble: ['Reset the currency', 'A new coin: restores trust or destroys it.'],
    cut: ['Let it burn', 'The market will find a bottom. Eventually.'],
    scar: { label: 'Residents remember the crash', key: 'worldPop', value: -0.15, days: 365 },
    ongoing: (w) => {
      const u = biggestWorld(w);
      if (u) {
        u.prices *= 1.01;
        u.satisfaction = Math.max(0, u.satisfaction - 0.2);
      }
    },
    disaster: (w) => {
      const name = crashWorld(w);
      return name ? `${name} lost half its residents.` : 'Your virtual economy collapsed.';
    },
  },
  orbital: {
    title: 'Kessler Cascade',
    emoji: '🛰️',
    intro: 'A collision in orbit is spreading debris across your stations.',
    role: 'coo',
    applies: (w) => w.player.dominion.space.assets.some((a) => a.stage === 'active' && (a.kind === 'orbitalFactory' || a.kind === 'orbitalStation')),
    stages: ['Debris is spreading faster than predicted.', 'Your factories are dodging fragments every hour.', 'Insurers are pulling out of orbit entirely.'],
    spend: ['Debris cleanup fleet', 'Launch a fleet of cleanup tugs.'],
    gamble: ['Raise the orbits', 'Burn fuel to move everything higher. Risky.'],
    cut: ['Ride it out', 'Accept losses and higher risk for two years.'],
    scar: { label: 'A crowded, dangerous orbit', key: 'spaceRisk', value: 0.03, days: 730 },
    ongoing: (w, e) => {
      if (e.pressure > 50) for (const a of w.player.dominion.space.assets) if (a.stage === 'active' && (a.kind === 'orbitalFactory' || a.kind === 'orbitalStation')) a.offlineUntil = Math.max(a.offlineUntil, w.day + 1);
    },
    disaster: (w) => {
      const name = loseOrbitalAsset(w);
      return name ? `${name} was destroyed.` : 'Debris wrecked your orbit.';
    },
  },
  cityRiot: {
    title: 'City in Revolt',
    emoji: '🔥',
    intro: 'Residents of your biggest company city have declared a general strike against corporate rule.',
    role: 'coo',
    applies: (w) => w.player.dominion.cities.some((c) => w.day >= c.ready && c.population > 1e5),
    stages: ['Strikers have shut down the city center.', 'Barricades go up. Your offices are occupied.', 'The national government threatens to take over the city.'],
    spend: ['Invest in the city', 'Better services, housing and wages.'],
    gamble: ['Hold an election', 'Let residents elect a council. They might choose you.'],
    cut: ['Wait them out', 'Cheap. The city never quite forgives you.'],
    scar: { label: 'Bitter residents', key: 'cityHappiness', value: -10, days: 730 },
    ongoing: (w, e) => {
      const c = biggestCity(w);
      if (c && e.pressure > 50) c.troubleUntil = Math.max(c.troubleUntil, w.day + 1);
    },
    disaster: (w) => {
      const c = biggestCity(w);
      if (c) c.troubleUntil = w.day + 180;
      return `${c?.name ?? 'Your city'} is ungovernable for six months. ${bumpRep(playerCompany(w), -8)}.`;
    },
  },
  boycott: {
    title: 'Global Boycott',
    emoji: '✊',
    intro: 'The megacorps have agreed to stop doing business with you.',
    role: 'counsel',
    applies: (w) => featureOpen(w, 'wars') && activeCorps(w).filter((c) => c.relation < -30).length >= 2,
    stages: ['Partners are cancelling contracts under pressure.', 'Your suppliers are being threatened.', 'Consumers are choosing sides.'],
    spend: ['Buy off the coalition', 'Generous deals for the weakest members.'],
    gamble: ['Go to the people', 'A global campaign to turn the public against them.'],
    cut: ['Ride it out', 'Lose some markets for a year.'],
    scar: { label: 'Shut out of markets', key: 'revenue', value: -0.05, days: 365 },
    ongoing: () => undefined,
    disaster: (w) => {
      w.player.dominion.mods.push({ sector: 'all', mult: 0.85, until: w.day + 365, reason: 'Global boycott' });
      for (const c of activeCorps(w)) c.relation = clamp(c.relation - 20, -100, 100);
      return '-15% income everywhere for a year.';
    },
  },
};

function sumPower(p: Record<string, number>): number {
  let t = 0;
  for (const k in p) t += p[k];
  return t;
}

export const EMERGENCY_KINDS = Object.keys(EMERGENCIES) as EmergencyKind[];

function severityOf(w: World): number {
  return clamp(1 + Math.floor((bestLevel(w) - 4) / 2), 1, 3);
}

function scheduleNext(w: World, first = false): void {
  const d = w.player.dominion;
  const lvl = bestLevel(w);
  const span = first ? randRange(w, 120, 240) : randRange(w, 240, 540) / (1 + 0.25 * Math.max(0, lvl - 4));
  d.nextEmergency = w.day + Math.round(span);
}

export function stageCost(w: World, e: Emergency): number {
  return Math.round(empireScale(w) * 0.004 * e.severity * (1 + 0.3 * e.stage));
}

export function gambleOdds(w: World, e: Emergency): number {
  return clamp(0.5 + 0.3 * execPower(w, EMERGENCIES[e.kind].role), 0.4, 0.85);
}

/** Start one now (used by the monthly roll and by tests). */
export function startEmergency(w: World, kind: EmergencyKind): Emergency {
  const d = w.player.dominion;
  const def = EMERGENCIES[kind];
  const severity = severityOf(w);
  const e: Emergency = { id: newId(w, 'em'), kind, title: def.title, start: w.day, stage: 0, pressure: 25 + 10 * severity, severity, nextStage: w.day, log: [{ day: w.day, text: def.intro }] };
  d.emergency = e;
  d.stats.emergencies += 1;
  toast(w, `EMERGENCY: ${def.title}`, 'major', { category: 'studio', link: { route: 'dominion', id: 'emergencies' }, body: def.intro });
  pushNews(w, { kind: 'player', title: `${def.title} at ${playerCompany(w).name}`, body: def.intro, companyId: w.player.companyId, tone: 'bad' });
  dlog(w, `${def.emoji} Emergency: ${def.title}. ${def.intro}`, 'bad');
  if (kind === 'boycott') d.mods.push({ sector: 'all', mult: 0.95, until: w.day + 90, reason: 'Boycott in progress' });
  nextStage(w, e);
  return e;
}

function nextStage(w: World, e: Emergency): void {
  const def = EMERGENCIES[e.kind];
  e.stage += 1;
  e.nextStage = w.day + 25;
  const cost = stageCost(w, e);
  const odds = gambleOdds(w, e);
  const p = playerCompany(w);
  pushDecision(w, {
    kind: 'emergency',
    title: `${def.emoji} ${def.title}: stage ${e.stage} of 3`,
    body: `${def.stages[e.stage - 1]} Pressure is at ${Math.round(e.pressure)}/100; at 100 it becomes a disaster.`,
    options: [
      { id: 'spend', label: `${def.spend[0]} · ${fmtMoney(cost)}`, description: `${def.spend[1]} Pressure -35.`, disabled: p.cash < cost },
      { id: 'gamble', label: `${def.gamble[0]} · ${fmtMoney(cost / 4)}`, description: `${def.gamble[1]} ${Math.round(odds * 100)}%: pressure -40, otherwise +15.`, disabled: p.cash < cost / 4 },
      { id: 'cut', label: def.cut[0], description: `${def.cut[1]} Pressure -15.` },
    ],
    data: { emergencyId: e.id, cost, odds, stage: e.stage },
    expiresDay: w.day + 21,
    defaultOption: 'cut',
  });
}

export function emergencyDaily(w: World): void {
  const d = w.player.dominion;
  const e = d?.emergency;
  if (!e) return;
  const def = EMERGENCIES[e.kind];
  e.pressure = clamp(e.pressure + 0.35 * e.severity * (1 - 0.35 * execPower(w, 'counsel')), 0, 100);
  def.ongoing?.(w, e);
  if (e.pressure >= 100) {
    endEmergency(w, e, 'disaster');
    return;
  }
  if (w.day >= e.nextStage && !w.pendingEvents.some((x) => x.kind === 'emergency')) {
    if (e.stage >= 3) endEmergency(w, e, 'contained');
    else nextStage(w, e);
  }
}

function endEmergency(w: World, e: Emergency, outcome: 'contained' | 'disaster'): void {
  const d = w.player.dominion;
  const def = EMERGENCIES[e.kind];
  const p = playerCompany(w);
  d.emergency = null;
  w.pendingEvents = w.pendingEvents.filter((x) => x.kind !== 'emergency');
  d.mods = d.mods.filter((m) => m.reason !== 'Boycott in progress');
  d.emergencyHistory.unshift({ kind: e.kind, title: e.title, start: e.start, end: w.day, outcome });
  if (d.emergencyHistory.length > 20) d.emergencyHistory.length = 20;
  if (outcome === 'disaster') {
    d.stats.disasters += 1;
    const what = `${def.disaster(w)} The fallout costs another ${bumpRep(p, -4).slice(1)}.`;
    toast(w, `DISASTER: ${def.title}`, 'bad', { category: 'studio', link: { route: 'dominion', id: 'emergencies' }, body: what });
    pushNews(w, { kind: 'player', title: `${def.title} becomes a disaster for ${p.name}`, body: what, companyId: p.id, tone: 'bad' });
    dlog(w, `${def.emoji} ${def.title} became a disaster. ${what}`, 'bad');
  } else {
    const gained = bumpRep(p, 3);
    addScar(w, `Trusted in a crisis (${def.title})`, 'revenue', 0.02, 365);
    celebrate(w, `${def.title} contained`, false);
    toast(w, `${def.title} contained`, 'good', { category: 'studio', link: { route: 'dominion', id: 'emergencies' }, body: `${gained} and +2% income for a year: the world saw you handle it.` });
    dlog(w, `${def.emoji} ${def.title} contained.`, 'good');
  }
  scheduleNext(w);
}

export function resolveEmergencyDecision(w: World, ev: DecisionEvent, optionId: string): boolean {
  if (ev.kind === 'corpCrisis') return resolveCorpCrisis(w, ev, optionId);
  if (ev.kind !== 'emergency') return false;
  const d = w.player.dominion;
  const e = d.emergency;
  if (!e || e.id !== ev.data.emergencyId) return true;
  const def = EMERGENCIES[e.kind];
  const p = playerCompany(w);
  const cost = Number(ev.data.cost);
  const counsel = 1 + 0.3 * execPower(w, 'counsel');
  let text = '';
  if (optionId === 'spend' && p.cash >= cost) {
    spend(p, 'warfare', cost);
    e.pressure = Math.max(0, e.pressure - 35 * counsel);
    text = `${def.spend[0]}: pressure down.`;
    if (e.kind === 'rogueAi') addScar(w, 'AI shut down for an audit', 'aiRevenue', -1, 60);
    if (e.kind === 'boycott') for (const c of activeCorps(w)) if (c.relation < 0) c.relation = Math.min(100, c.relation + 15);
  } else if (optionId === 'gamble' && p.cash >= cost / 4) {
    spend(p, 'warfare', cost / 4);
    if (chance(w, Number(ev.data.odds))) {
      e.pressure = Math.max(0, e.pressure - 40 * counsel);
      text = `${def.gamble[0]}: it worked.`;
      if (e.kind === 'whistleblower') {
        const ex = d.execs.slice().sort((a, b) => a.loyalty - b.loyalty)[0];
        if (ex) d.execs = d.execs.filter((x) => x.id !== ex.id);
      }
    } else {
      e.pressure = Math.min(100, e.pressure + 15);
      text = `${def.gamble[0]}: it backfired.`;
    }
  } else {
    e.pressure = Math.max(0, e.pressure - 15 * counsel);
    const s = def.scar;
    if (!d.scars.some((x) => x.label === s.label && x.until > w.day)) addScar(w, s.label, s.key, s.value, s.days);
    text = `${def.cut[0]}: a lasting scar (${s.label.toLowerCase()}).`;
  }
  e.log.unshift({ day: w.day, text });
  e.nextStage = Math.min(e.nextStage, w.day + 25);
  if (e.pressure >= 100) endEmergency(w, e, 'disaster');
  return true;
}

/** Monthly: maybe a new emergency; rivals have bad months too. */
export function emergenciesMonthly(w: World): void {
  if (!featureOpen(w, 'emergencies')) return;
  const d = w.player.dominion;
  if (!d.nextEmergency) scheduleNext(w, true);
  if (!d.emergency && w.day >= d.nextEmergency) {
    const options = EMERGENCY_KINDS.filter((k) => EMERGENCIES[k].applies(w) && !d.emergencyHistory.slice(0, 2).some((h) => h.kind === k));
    if (options.length) startEmergency(w, pick(w, options));
    else scheduleNext(w);
  }
  // the megacorps' own crises: an opening for you
  for (const c of activeCorps(w)) {
    if (!chance(w, 0.02)) continue;
    const what = pick(w, ['a massive data breach', 'a rogue AI scare', 'a factory fire', 'a boardroom coup', 'an accounting scandal']);
    for (const s of SECTOR_IDS) c.power[s] *= 0.94;
    c.valuation *= 0.92;
    pushNews(w, { kind: 'industry', title: `${c.name} rocked by ${what}`, tone: 'major' });
    dlog(w, `${c.name} is rocked by ${what}.`, 'neutral');
    if (featureOpen(w, 'wars') && !w.pendingEvents.some((x) => x.kind === 'corpCrisis')) {
      const help = jointVentureCost(w);
      pushDecision(w, {
        kind: 'corpCrisis',
        title: `${c.name} is reeling from ${what}`,
        body: `${c.ceo}'s company is weak right now. Strike while they’re down (a war in their best market, starting with the upper hand), offer help (${fmtMoney(help)}, relations +30), or stay out of it.`,
        options: [
          { id: 'exploit', label: 'Strike now', description: 'Declare war with a head start.' },
          { id: 'help', label: `Offer help · ${fmtMoney(help)}`, description: 'A friend for life. Maybe.', disabled: playerCompany(w).cash < help },
          { id: 'ignore', label: 'Stay out of it', description: 'Nothing changes.' },
        ],
        data: { corpId: c.id, cost: help },
        expiresDay: w.day + 21,
        defaultOption: 'ignore',
      });
    }
  }
}

function resolveCorpCrisis(w: World, ev: DecisionEvent, optionId: string): boolean {
  const c = corpById(w, String(ev.data.corpId));
  if (!c || c.status !== 'active') return true;
  if (optionId === 'exploit') {
    const top = SECTOR_IDS.reduce((a, b) => (c.power[b] > c.power[a] ? b : a));
    const war = startWar(w, 'player', c.id, top);
    war.score = 20;
    playerCompany(w).reputation = Math.max(0, playerCompany(w).reputation - 1);
  } else if (optionId === 'help' && playerCompany(w).cash >= Number(ev.data.cost)) {
    spend(playerCompany(w), 'warfare', Number(ev.data.cost));
    shiftRelation(w, 'player', c.id, 30);
    dlog(w, `You helped ${c.name} through its crisis.`, 'good');
  }
  return true;
}
