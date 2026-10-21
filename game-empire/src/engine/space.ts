// The space economy. A trillion-dollar empire can leave the planet: build a
// spaceport, orbital factories and stations, a lunar base with helium-3 mines
// and a resort, a Mars colony, asteroid mines and an outpost at Jupiter.
// Launches can fail, solar storms knock things offline, the megacorps race
// you for every "first", and colonists become a new market for your games.
import { activeCorps } from './megacorps';
import { addScar, dlog, execPower, featureOpen, fmtMoney, fmtPeople, scarValue } from './dominionCore';
import { pushDecision } from './events';
import { ecoShare } from './ecosystem';
import type { ActionResult, DecisionEvent, SpaceAsset, SpaceKind, World } from './types';
import { bumpRep, celebrate, clamp, earn, newId, playerCompany, pushNews, spend, toast } from './util';
import { chance, pick, randNormal, randRange } from './rng';

const fail = (error: string): ActionResult => ({ ok: false, error });
const ok = (id?: string): ActionResult => ({ ok: true, id });

export const SPACE: Record<SpaceKind, { name: string; blurb: string; cost: number; days: number; output: number; requires: SpaceKind[]; tech: number; colonists: number; emoji: string }> = {
  spaceport: { name: 'Spaceport', emoji: '🛫', blurb: 'Your own launch site. Everything else starts here, and other companies pay to launch from it.', cost: 4e10, days: 365, output: 3e9, requires: [], tech: 0, colonists: 0 },
  orbitalFactory: { name: 'Orbital factory', emoji: '🏭', blurb: 'Zero-gravity chips and materials. Makes your consoles cheaper to build.', cost: 1.2e11, days: 420, output: 1.5e10, requires: ['spaceport'], tech: 0, colonists: 0 },
  orbitalStation: { name: 'Orbital station', emoji: '🛰️', blurb: 'A hotel and esports arena in orbit. Unlocks the orbital keynote.', cost: 2e11, days: 480, output: 2e10, requires: ['spaceport'], tech: 0, colonists: 0 },
  lunarBase: { name: 'Lunar base', emoji: '🌕', blurb: 'A permanent base on the Moon. Research, tourism and the gateway to everything further out.', cost: 5e11, days: 600, output: 2.5e10, requires: ['spaceport'], tech: 1, colonists: 2000 },
  heliumMine: { name: 'Helium-3 mine', emoji: '⛏️', blurb: 'Fuel for fusion. Cuts the power bills of your data centers and cities.', cost: 8e11, days: 540, output: 6e10, requires: ['lunarBase'], tech: 1, colonists: 1000 },
  lunarResort: { name: 'Lunar resort', emoji: '🏨', blurb: 'Theme-park hotels on the Moon. Your franchises sell the tickets.', cost: 4e11, days: 480, output: 4e10, requires: ['lunarBase'], tech: 1, colonists: 3000 },
  marsColony: { name: 'Mars colony', emoji: '🔴', blurb: 'A city on Mars. Colonists grow into a new market for your games.', cost: 3e12, days: 900, output: 1e11, requires: ['lunarBase'], tech: 3, colonists: 2e6 },
  asteroidMining: { name: 'Asteroid mining', emoji: '☄️', blurb: 'Platinum and water from the belt. Huge, volatile income.', cost: 5e12, days: 720, output: 4e11, requires: ['spaceport'], tech: 4, colonists: 5e4 },
  jovianOutpost: { name: 'Jovian outpost', emoji: '🪐', blurb: 'A station at Jupiter. The edge of the known economy.', cost: 1.5e13, days: 1080, output: 6e11, requires: ['marsColony'], tech: 5, colonists: 1e6 },
};

export const SPACE_KINDS = Object.keys(SPACE) as SpaceKind[];
const MAX_LEVEL = 5;

export function launchTechCost(level: number): number {
  return Math.round(2e10 * Math.pow(3, level));
}

export function shieldCost(level: number): number {
  return Math.round(1e10 * Math.pow(2.5, level));
}

/** Cheaper with better rockets, a megaproject elevator and industry districts. */
export function spaceCostMult(w: World): number {
  const d = w.player.dominion;
  const elevator = d.megaprojects.some((m) => m.id === 'orbitalElevator' && m.stage === 'done') ? 0.5 : 1;
  return (1 - 0.08 * d.space.launchTech) * elevator;
}

export function assetCost(w: World, kind: SpaceKind, level = 1): number {
  return Math.round(SPACE[kind].cost * Math.pow(1.5, level - 1) * spaceCostMult(w));
}

export function launchRisk(w: World): number {
  const d = w.player.dominion;
  if (d.megaprojects.some((m) => m.id === 'orbitalElevator' && m.stage === 'done')) return 0.01;
  return clamp(0.12 * (1 - 0.18 * d.space.launchTech) * (1 - 0.3 * execPower(w, 'coo')) + scarValue(w, 'spaceRisk'), 0.01, 0.4);
}

export function spaceBlocker(w: World, kind: SpaceKind): string | null {
  if (!featureOpen(w, 'space')) return 'Space unlocks at the Trillion-Dollar Empire level ($1T).';
  const d = w.player.dominion;
  const def = SPACE[kind];
  if (d.space.launchTech < def.tech) return `Needs launch tech ${def.tech}.`;
  for (const r of def.requires) if (!d.space.assets.some((a) => a.kind === r && a.stage === 'active')) return `Needs an active ${SPACE[r].name.toLowerCase()}.`;
  if (d.space.assets.some((a) => a.kind === kind && a.stage === 'building')) return 'One is already being built.';
  if (playerCompany(w).cash < assetCost(w, kind) * 0.25) return `Needs at least ${fmtMoney(assetCost(w, kind) * 0.25)} in the bank.`;
  return null;
}

export function buildSpace(w: World, kind: SpaceKind): ActionResult {
  const blocker = spaceBlocker(w, kind);
  if (blocker) return fail(blocker);
  const d = w.player.dominion;
  const n = d.space.assets.filter((a) => a.kind === kind).length;
  const cost = assetCost(w, kind);
  const days = Math.round(SPACE[kind].days * (1 - 0.15 * execPower(w, 'coo')));
  const a: SpaceAsset = { id: newId(w, 'sp'), kind, name: n ? `${SPACE[kind].name} ${n + 1}` : SPACE[kind].name, stage: 'building', start: w.day, ready: w.day + days, cost, buildCost: cost, level: 1, offlineUntil: 0, output: 0 };
  d.space.assets.push(a);
  dlog(w, `Construction begins: ${a.name} (${fmtMoney(cost)}).`, 'neutral');
  return ok(a.id);
}

export function upgradeSpace(w: World, id: string): ActionResult {
  const d = w.player.dominion;
  const a = d.space.assets.find((x) => x.id === id);
  if (!a || a.stage !== 'active') return fail('Only active assets can be expanded.');
  if (a.level >= MAX_LEVEL) return fail('Fully expanded.');
  const cost = assetCost(w, a.kind, a.level + 1);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Costs ${fmtMoney(cost)}.`);
  spend(p, 'buildout', cost);
  a.cost += cost;
  a.level += 1;
  return ok();
}

export function upgradeLaunchTech(w: World): ActionResult {
  if (!featureOpen(w, 'space')) return fail('Space is locked.');
  const s = w.player.dominion.space;
  if (s.launchTech >= 5) return fail('Your rockets are as good as they get.');
  const cost = launchTechCost(s.launchTech);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Costs ${fmtMoney(cost)}.`);
  spend(p, 'buildout', cost);
  s.launchTech += 1;
  dlog(w, `Reusable rockets, generation ${s.launchTech}: cheaper and safer launches.`, 'good');
  return ok();
}

export function upgradeShield(w: World): ActionResult {
  if (!featureOpen(w, 'space')) return fail('Space is locked.');
  const s = w.player.dominion.space;
  if (s.shield >= 5) return fail('Fully shielded.');
  const cost = shieldCost(s.shield);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Costs ${fmtMoney(cost)}.`);
  spend(p, 'buildout', cost);
  s.shield += 1;
  return ok();
}

// ------------------------------------------------------------ simulation

export function spaceDaily(w: World): void {
  const d = w.player.dominion;
  if (!d?.space.assets.length) return;
  const p = playerCompany(w);
  for (const a of d.space.assets) {
    if (a.stage !== 'building') continue;
    spend(p, 'buildout', a.buildCost / Math.max(1, a.ready - a.start));
    if (w.day < a.ready) continue;
    // the launch
    if (chance(w, launchRisk(w))) {
      a.stage = 'lost';
      d.space.incidents += 1;
      p.reputation = Math.max(0, p.reputation - 2);
      toast(w, `Launch failure: ${a.name} is lost`, 'bad', { category: 'studio', link: { route: 'dominion', id: 'space' }, body: 'A decision is waiting: rebuild or write it off.' });
      dlog(w, `${a.name} exploded on launch.`, 'bad');
      if (!w.pendingEvents.some((e) => e.kind === 'spaceFail')) {
        pushDecision(w, {
          kind: 'spaceFail',
          title: `${a.name} was lost on launch`,
          body: `The rocket carrying ${a.name} failed. Rebuild it at 40% of the cost (another ${Math.round(SPACE[a.kind].days * 0.5)} days), or write it off and recover ${fmtMoney(a.cost * 0.2)} from insurance.`,
          options: [
            { id: 'rebuild', label: `Rebuild · ${fmtMoney(a.cost * 0.4)}`, description: 'Try again. Paid over the rebuild.' },
            { id: 'writeoff', label: 'Write it off', description: `Insurance pays ${fmtMoney(a.cost * 0.2)}.` },
          ],
          data: { assetId: a.id, cost: a.cost * 0.4 },
          expiresDay: w.day + 30,
          defaultOption: 'writeoff',
        });
      }
      continue;
    }
    a.stage = 'active';
    const first = !d.space.firsts[a.kind];
    let gained = '';
    if (first) {
      d.space.firsts[a.kind] = 'player';
      gained = bumpRep(p, 3);
      celebrate(w, `First ever ${SPACE[a.kind].name.toLowerCase()}!`, true);
      pushNews(w, { kind: 'player', title: `${p.name} opens the first ${SPACE[a.kind].name.toLowerCase()} in history`, companyId: p.id, tone: 'good' });
    }
    toast(w, `${a.name} is operational`, 'good', { category: 'studio', link: { route: 'dominion', id: 'space' }, body: first ? `A world first: ${gained}.` : undefined });
    dlog(w, `${a.name} is operational${first ? ' (a world first)' : ''}.`, 'good');
  }
}

export function playerColonists(w: World): number {
  let t = 0;
  for (const a of w.player.dominion.space.assets) {
    if (a.stage !== 'active') continue;
    const def = SPACE[a.kind];
    if (!def.colonists) continue;
    const years = Math.max(0, (w.day - a.ready) / 365);
    const terraform = w.player.dominion.megaprojects.some((m) => m.id === 'terraform' && m.stage === 'done') && a.kind === 'marsColony' ? 20 : 1;
    t += def.colonists * a.level * terraform * Math.min(1, 0.15 + years / 6);
  }
  return t;
}

/** Off-world spending on games and entertainment you capture. */
export function offworldShare(w: World): number {
  const total = Math.max(1, w.player.dominion.space.offworld);
  return clamp(0.6 * (playerColonists(w) / total) + 0.4 * Math.min(1, ecoShare(w) * 2), 0, 1);
}

export function spaceMonthly(w: World): void {
  const d = w.player.dominion;
  if (!featureOpen(w, 'space')) return;
  const s = d.space;
  const p = playerCompany(w);
  // ore prices wander
  const ore = (w.player.flags.oreIndex ?? 1000) / 1000;
  const nextOre = clamp(ore * Math.exp(randNormal(w, 0, 0.08)) + (1 - ore) * 0.05, 0.3, 2.5);
  w.player.flags.oreIndex = Math.round(nextOre * 1000);
  let revenue = 0;
  for (const a of s.assets) {
    a.output = 0;
    if (a.stage !== 'active') continue;
    // upkeep: 4% a year of what it cost
    spend(p, 'buildout', (a.cost * 0.04) / 12);
    if (w.day < a.offlineUntil) continue;
    let out = (SPACE[a.kind].output * (1 + 0.8 * (a.level - 1))) / 12;
    if (a.kind === 'asteroidMining') out *= nextOre;
    if (a.kind === 'lunarResort' || a.kind === 'orbitalStation') out *= 0.6 + p.reputation / 125;
    out *= randRange(w, 0.92, 1.08);
    a.output = out;
    revenue += out;
    // storms and debris
    if (chance(w, 0.015 * (1 - 0.15 * s.shield) + scarValue(w, 'spaceRisk') / 10)) {
      const days = Math.round(randRange(w, 30, 90) * (1 - 0.1 * s.shield));
      a.offlineUntil = w.day + days;
      spend(p, 'buildout', a.cost * 0.03);
      toast(w, `${pickHazard(w)} knocked ${a.name} offline`, 'bad', { category: 'studio', link: { route: 'dominion', id: 'space' }, body: `${days} days of repairs (${fmtMoney(a.cost * 0.03)}). Shielding helps.` });
    }
  }
  // the off-world market
  const corpColonists = activeCorps(w).reduce((t, c) => t + Math.max(0, c.assets.spaceAssets - 3) * 4e5, 0);
  s.offworld = playerColonists(w) + corpColonists;
  const offworldRevenue = (s.offworld * 600 * offworldShare(w)) / 12;
  revenue += offworldRevenue;
  s.monthRevenue = revenue;
  s.revenue += revenue;
  earn(p, 'space', revenue);
  corpSpaceRace(w);
}

function pickHazard(w: World): string {
  return pick(w, ['A solar storm', 'Orbital debris', 'A micrometeorite strike']);
}

/** The megacorps go to space too, and race you for every first. */
function corpSpaceRace(w: World): void {
  const d = w.player.dominion;
  for (const c of activeCorps(w)) {
    const want = c.persona === 'visionary' ? 0.12 : c.persona === 'tycoon' ? 0.05 : 0.03;
    if (!chance(w, want) || c.cash < c.valuation * 0.02) continue;
    const kind = SPACE_KINDS[Math.min(SPACE_KINDS.length - 1, c.assets.spaceAssets)];
    const cost = SPACE[kind].cost * 0.8;
    if (c.cash < cost) continue;
    c.cash -= cost;
    c.assets.spaceAssets += 1;
    c.power.space += SPACE[kind].output * 1.1;
    if (!d.space.firsts[kind]) {
      d.space.firsts[kind] = c.id;
      pushNews(w, { kind: 'industry', title: `${c.name} opens the first ${SPACE[kind].name.toLowerCase()} in history`, tone: 'major' });
      dlog(w, `${c.name} beat everyone to the first ${SPACE[kind].name.toLowerCase()}.`, featureOpen(w, 'space') ? 'bad' : 'neutral');
    } else {
      dlog(w, `${c.name} opens a ${SPACE[kind].name.toLowerCase()}.`);
    }
  }
}

export function resolveSpaceDecision(w: World, ev: DecisionEvent, optionId: string): boolean {
  if (ev.kind !== 'spaceFail') return false;
  const d = w.player.dominion;
  const a = d.space.assets.find((x) => x.id === ev.data.assetId);
  const p = playerCompany(w);
  if (!a) return true;
  if (optionId === 'rebuild' && p.cash >= Number(ev.data.cost) * 0.25) {
    // only the rebuild is charged, spread over the new build
    a.stage = 'building';
    a.start = w.day;
    a.ready = w.day + Math.round(SPACE[a.kind].days * 0.5);
    a.buildCost = Number(ev.data.cost);
    a.cost += a.buildCost;
  } else {
    p.cash += a.cost * 0.2;
    d.space.assets = d.space.assets.filter((x) => x.id !== a.id);
  }
  return true;
}

/** Disaster helper for emergencies: lose one orbital asset. */
export function loseOrbitalAsset(w: World): string | null {
  const d = w.player.dominion;
  const orbital = d.space.assets.filter((a) => a.stage === 'active' && (a.kind === 'orbitalFactory' || a.kind === 'orbitalStation'));
  if (!orbital.length) return null;
  const a = orbital[0];
  a.stage = 'lost';
  addScar(w, 'Orbital debris field', 'spaceRisk', 0.03, 365);
  return a.name;
}

export function spaceSummary(w: World): string {
  const s = w.player.dominion.space;
  const active = s.assets.filter((a) => a.stage === 'active').length;
  return `${active} active · ${fmtPeople(playerColonists(w))} colonists · ${fmtMoney(s.monthRevenue * 12)}/yr`;
}
