// Company keynotes. Book a venue, choose what to reveal (games, consoles, AI,
// your ecosystem, worlds, rockets, megaprojects) and hold one thing back for
// "one more thing". On the day, every reveal gets a live reaction: hype for
// games, preorders for consoles, a stock move, and the rival CEOs' verdicts.
// Leaks spoil surprises, and a rival keynote the same week splits the room.
import { activeCorps, corpSay, sideOf } from './megacorps';
import { SECTOR_IDS, dlog, empireScale, execPower, featureOpen, fmtMoney, bestLevel } from './dominionCore';
import { baseQuality } from './development';
import { SCOPE_IDS } from './constants';
import { aiLead, bestModel } from './ventures';
import { MEGAPROJECTS } from './megaprojects';
import type { ActionResult, KeynotePlan, KeynoteResult, KeynoteShowItem, RevealItem, RevealKind, SectorId, World } from './types';
import { celebrate, clamp, dayToDate, newId, playerCompany, pushNews, spend, toast } from './util';
import { chance, pick, randNormal, randRange } from './rng';

const fail = (error: string): ActionResult => ({ ok: false, error });
const ok = (id?: string): ActionResult => ({ ok: true, id });

export const VENUES = [
  { name: 'Livestream', blurb: 'A studio, a camera and a lot of coffee.', cost: 0.0004, min: 2e7, reach: 1, prep: 30, level: 2 },
  { name: 'Arena show', blurb: 'Twenty thousand fans and a light show.', cost: 0.0012, min: 1.5e8, reach: 1.6, prep: 45, level: 2 },
  { name: 'Stadium spectacular', blurb: 'Fireworks, a live orchestra and celebrity guests.', cost: 0.003, min: 1e9, reach: 2.4, prep: 60, level: 3 },
  { name: 'Global simulcast', blurb: 'Every screen on Earth, all at once.', cost: 0.007, min: 8e9, reach: 3.4, prep: 75, level: 4 },
  { name: 'Orbital keynote', blurb: 'Live from your station in orbit. Needs an active orbital station.', cost: 0.015, min: 5e10, reach: 5, prep: 90, level: 5 },
];

export const KEYNOTE_COOLDOWN = 90;

export function venueCost(w: World, venue: number): number {
  const v = VENUES[venue];
  return Math.round(Math.max(v.min, v.cost * empireScale(w)));
}

export function maxReveals(venue: number): number {
  return Math.min(6, 3 + venue);
}

export function venueBlocker(w: World, venue: number): string | null {
  const v = VENUES[venue];
  if (!v) return 'Pick a venue.';
  if (bestLevel(w) < v.level) return `Unlocks at empire level ${v.level}.`;
  if (venue === 4 && !w.player.dominion.space.assets.some((a) => a.kind === 'orbitalStation' && a.stage === 'active')) return 'Needs an active orbital station.';
  return null;
}

/** Everything you could show off right now, with a rough audience score. */
export function revealOptions(w: World): (RevealItem & { base: number; readiness: number; stale?: boolean })[] {
  const p = playerCompany(w);
  const d = w.player.dominion;
  const out: (RevealItem & { base: number; readiness: number; stale?: boolean })[] = [];
  for (const id in w.games) {
    const g = w.games[id];
    if (g.companyId !== p.id || g.status !== 'development') continue;
    const q = baseQuality(w, g, p);
    const base = 38 + 22 * Math.min(1, SCOPE_IDS.indexOf(g.scope) / 4) + (q - 60) * 0.6 + Math.min(15, g.hype / 40);
    out.push({ kind: 'game', refId: g.id, label: g.title, surprise: false, base, readiness: g.workDone / Math.max(1, g.workRequired) });
  }
  for (const c of w.player.ventures.consoles) {
    if (c.stage !== 'design') continue;
    out.push({ kind: 'console', refId: c.id, label: c.name, surprise: false, base: 55 + 6 * Math.min(5, c.gen - 1) + (c.size === 'elite' ? 8 : 0), readiness: (w.day - c.startDay) / Math.max(1, c.launchDay - c.startDay) });
  }
  const ai = w.player.ventures.ai;
  if (ai?.training) out.push({ kind: 'ai', refId: 'training', label: `${ai.name} generation ${ai.training.gen}`, surprise: false, base: 50 + 4 * ai.training.gen, readiness: (w.day - ai.training.start) / ai.training.days });
  else if (bestModel(w)) out.push({ kind: 'ai', refId: 'best', label: bestModel(w)!.name, surprise: false, base: 35 + 25 * Math.min(1.2, aiLead(w)), readiness: 1 });
  const eng = w.player.engine;
  if (eng && eng.version > 0) out.push({ kind: 'engine', refId: 'engine', label: `${eng.name} ${eng.version + (eng.upgrade ? 1 : 0)}.0`, surprise: false, base: 42 + 6 * eng.version, readiness: 1 });
  const eco = d.ecosystem;
  if (eco) {
    let lv = 0;
    for (const k in eco.levels) lv += eco.levels[k as keyof typeof eco.levels];
    out.push({ kind: 'ecosystem', refId: 'eco', label: eco.building ? `${eco.name}: new ${eco.building.part}` : eco.name, surprise: false, base: 45 + 2 * lv + (eco.building ? 8 : 0), readiness: 1 });
  }
  for (const u of d.universes) if (u.stage !== 'closed') out.push({ kind: 'universe', refId: u.id, label: u.name, surprise: false, base: 52 + 6 * u.scale - (u.stage === 'live' ? 8 : 0), readiness: u.stage === 'live' ? 1 : (w.day - u.founded) / Math.max(1, u.ready - u.founded) });
  for (const a of d.space.assets) if (a.stage === 'building') out.push({ kind: 'space', refId: a.id, label: a.name, surprise: false, base: 62 + 3 * spaceRank(a.kind), readiness: (w.day - a.start) / Math.max(1, a.ready - a.start) });
  for (const m of d.megaprojects) if (m.stage === 'building') out.push({ kind: 'megaproject', refId: m.id, label: MEGAPROJECTS[m.id].name, surprise: false, base: 76, readiness: 1 });
  for (const c of d.cities) if (w.day < c.ready || c.districts.some((x) => w.day < x.ready)) out.push({ kind: 'city', refId: c.id, label: c.name, surprise: false, base: 55, readiness: 1 });
  // old news: what you showed at your last two keynotes gets a cooler reception
  const recent = new Set(d.keynotes.history.slice(0, 2).flatMap((h) => h.items.map((x) => `${x.kind}:${x.label}`)));
  for (const o of out) {
    if (!recent.has(`${o.kind}:${o.label}`)) continue;
    o.base -= 20;
    o.stale = true;
  }
  return out;
}

const SPACE_ORDER = ['spaceport', 'orbitalFactory', 'orbitalStation', 'lunarBase', 'heliumMine', 'lunarResort', 'marsColony', 'asteroidMining', 'jovianOutpost'];
function spaceRank(kind: string): number {
  return Math.max(0, SPACE_ORDER.indexOf(kind));
}

export function planKeynote(w: World, opts: { title: string; venue: number; reveals: RevealItem[] }): ActionResult {
  if (!featureOpen(w, 'keynotes')) return fail('Keynotes unlock at the Major Publisher level ($1B).');
  const d = w.player.dominion;
  if (d.keynotes.plan) return fail('A keynote is already booked.');
  if (w.day - d.keynotes.lastDay < KEYNOTE_COOLDOWN) return fail(`Your last keynote was ${w.day - d.keynotes.lastDay} days ago. The press needs ${KEYNOTE_COOLDOWN - (w.day - d.keynotes.lastDay)} more days.`);
  const blocker = venueBlocker(w, opts.venue);
  if (blocker) return fail(blocker);
  const options = revealOptions(w);
  const reveals = opts.reveals.filter((r) => options.some((o) => o.kind === r.kind && o.refId === r.refId)).slice(0, maxReveals(opts.venue));
  if (!reveals.length) return fail('Pick at least one thing to reveal.');
  let surprise = false;
  for (const r of reveals) {
    if (r.surprise && !surprise) surprise = true;
    else r.surprise = false;
  }
  const cost = venueCost(w, opts.venue);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`The venue costs ${fmtMoney(cost)}.`);
  spend(p, 'marketing', cost);
  const title = opts.title.trim().slice(0, 40) || `${p.name} Live ${dayToDate(w.day).getUTCFullYear()}`;
  const plan: KeynotePlan = { id: newId(w, 'kn'), title, venue: opts.venue, day: w.day + VENUES[opts.venue].prep, booked: w.day, reveals, cost };
  d.keynotes.plan = plan;
  dlog(w, `Keynote booked: "${title}" (${VENUES[opts.venue].name}) in ${VENUES[opts.venue].prep} days.`, 'neutral');
  const clash = d.keynotes.upcoming.find((k) => Math.abs(k.day - plan.day) <= 3);
  if (clash) toast(w, `Heads up: ${activeCorps(w).find((c) => c.id === clash.corpId)?.name ?? 'a rival'} has a keynote the same week`, 'neutral', { category: 'industry', link: { route: 'dominion', id: 'keynotes' }, body: 'Two shows split the audience.' });
  return ok(plan.id);
}

export function cancelKeynote(w: World): ActionResult {
  const d = w.player.dominion;
  const plan = d.keynotes.plan;
  if (!plan) return fail('Nothing is booked.');
  playerCompany(w).cash += plan.cost * 0.4;
  d.keynotes.plan = null;
  return ok();
}

function reactionText(score: number, flop: boolean): string {
  if (flop) return 'The demo crashed live on stage.';
  if (score >= 85) return 'The crowd lost its mind.';
  if (score >= 70) return 'Huge applause.';
  if (score >= 55) return 'Polite applause.';
  if (score >= 40) return 'A few confused claps.';
  return 'Silence. Someone coughed.';
}

/** Daily: the show happens, and rival keynotes too. */
export function keynotesDaily(w: World): void {
  const d = w.player.dominion;
  if (!d) return;
  const plan = d.keynotes.plan;
  if (plan && w.day >= plan.day) {
    d.keynotes.plan = null;
    runKeynote(w, plan);
  }
  if (d.keynotes.upcoming.length) {
    for (const k of [...d.keynotes.upcoming]) {
      if (w.day < k.day) continue;
      d.keynotes.upcoming = d.keynotes.upcoming.filter((x) => x !== k);
      corpKeynote(w, k);
    }
  }
}

export function runKeynote(w: World, plan: KeynotePlan): KeynoteResult {
  const d = w.player.dominion;
  const p = playerCompany(w);
  const venue = VENUES[plan.venue];
  const options = revealOptions(w);
  const leaked = (w.player.flags[`leak:${plan.id}`] ?? 0) > 0 || (d.spy.threats.some((t) => t.kind === 'insider' && !t.detected) && chance(w, 0.3));
  const clashK = d.keynotes.upcoming.find((k) => Math.abs(k.day - plan.day) <= 3) ?? null;
  const clashCorp = clashK ? activeCorps(w).find((c) => c.id === clashK.corpId) : null;
  const cmo = execPower(w, 'cmo');
  const cto = execPower(w, 'cto');
  const items: KeynoteShowItem[] = [];
  const shown: RevealItem[] = [];
  for (const r of plan.reveals) {
    const o = options.find((x) => x.kind === r.kind && x.refId === r.refId);
    if (!o) continue;
    const flop = chance(w, clamp(0.06 + (1 - clamp(o.readiness, 0, 1)) * 0.2 - 0.04 * cto, 0.02, 0.4));
    let score = flop ? randRange(w, 8, 25) : clamp(o.base + randNormal(w, 0, 9) + 10 * cmo + (leaked ? -8 : 0), 5, 99);
    if (r.surprise && !flop) score = clamp(score * (leaked ? 0.95 : score >= 60 ? 1.15 : 0.85), 5, 100);
    items.push({ kind: r.kind, label: o.label, score: Math.round(score), reaction: reactionText(score, flop), surprise: r.surprise });
    shown.push(r);
  }
  const weights = items.map((x) => (x.surprise ? 1.5 : 1));
  const wsum = weights.reduce((s, x) => s + x, 0) || 1;
  const overall = Math.round(items.reduce((s, x, i) => s + x.score * weights[i], 0) / wsum);
  const reach = venue.reach * (clashCorp ? 0.75 : 1);
  const flop = items.some((x) => x.reaction.startsWith('The demo crashed'));
  // effects
  let hype = 0;
  let preorders = 0;
  items.forEach((it, i) => {
    const r = shown[i];
    if (it.kind === 'game') {
      const g = w.games[r.refId];
      if (g && g.status === 'development') {
        const h = reach * it.score * 2;
        g.hype += h;
        hype += h;
      }
    } else if (it.kind === 'console') {
      const c = w.player.ventures.consoles.find((x) => x.id === r.refId);
      if (c && c.stage === 'design') {
        const units = reach * (it.score / 100) * 2e6;
        const cash = units * c.price * 0.1;
        preorders += cash;
        p.cash += cash;
        p.ledger.hardware += cash;
        c.marketingUntil = Math.max(c.marketingUntil, c.launchDay + 60);
      }
    } else if (it.kind === 'ai') {
      w.player.ventures.aiMarket *= 1 + it.score / 2500;
    } else if (it.kind === 'ecosystem' && d.ecosystem) {
      d.ecosystem.users *= 1 + (it.score / 1000) * reach;
      d.ecosystem.developers = Math.min(0.95, d.ecosystem.developers + 0.02 * reach);
    } else if (it.kind === 'universe') {
      const u = d.universes.find((x) => x.id === r.refId);
      if (u) u.population *= 1 + (it.score / 600) * reach;
    } else if (it.kind === 'engine' && w.player.engine) {
      w.player.engine.hype = Math.min(100, w.player.engine.hype + it.score / 4);
    }
  });
  const rep = clamp((overall - 50) / 15, -3, 4) * (flop ? 1.4 : 1);
  p.reputation = clamp(p.reputation + rep, 0, 100);
  // giants' share prices move less
  const stockMove = clamp(((overall - 55) / 250) * Math.sqrt(reach), -0.12, 0.18) / (1 + 0.15 * Math.max(0, bestLevel(w) - 3));
  if (p.isPublic) p.price *= Math.exp(stockMove);
  // wartime propaganda
  for (const war of d.wars) {
    const side = sideOf(war, 'player');
    if (side) war.score = clamp(war.score + (side === 'attackers' ? 1 : -1) * (overall - 45) / 8, -100, 100);
  }
  // the rival CEOs weigh in
  const reactions: KeynoteResult['reactions'] = [];
  const corps = activeCorps(w)
    .slice()
    .sort((a, b) => a.relation - b.relation)
    .slice(0, 3);
  for (const c of corps) {
    const line = corpSay(w, c, overall >= 65 ? 'reactGood' : 'reactBad');
    reactions.push({ corpId: c.id, name: c.name, text: line });
    if (overall >= 70 && (c.persona === 'showman' || c.persona === 'warlord') && chance(w, 0.4)) {
      const sector = topSector(c);
      if (!d.keynotes.upcoming.some((k) => k.corpId === c.id)) d.keynotes.upcoming.push({ corpId: c.id, day: w.day + Math.round(randRange(w, 14, 30)), title: `${c.name} Response`, sector });
    }
  }
  if (clashCorp && overall >= 60) {
    // you won the week: their show lands softer
    const k = d.keynotes.upcoming.find((x) => x.corpId === clashCorp.id);
    if (k) k.title = `${k.title} (overshadowed)`;
  }
  const result: KeynoteResult = {
    id: plan.id,
    day: w.day,
    title: plan.title,
    venue: plan.venue,
    items,
    score: overall,
    hype: Math.round(hype),
    stockMove,
    rep,
    preorders,
    reactions,
    leaked,
    flop,
    clash: clashCorp?.name ?? null,
  };
  d.keynotes.history.unshift(result);
  if (d.keynotes.history.length > 20) d.keynotes.history.length = 20;
  d.keynotes.lastDay = w.day;
  d.stats.keynotes += 1;
  (w.keynoteShows ??= []).push(result);
  if (overall >= 85) celebrate(w, `${plan.title}: a legendary keynote`, true);
  pushNews(w, { kind: 'player', title: `${p.name} ${overall >= 70 ? 'wows the world' : overall >= 50 ? 'holds' : 'stumbles through'} ${plan.title}`, body: items.map((x) => x.label).join(', '), companyId: p.id, tone: overall >= 70 ? 'good' : overall < 45 ? 'bad' : 'neutral' });
  dlog(w, `${plan.title}: audience score ${overall}/100${leaked ? ' (leaked)' : ''}${clashCorp ? `, up against ${clashCorp.name}` : ''}.`, overall >= 65 ? 'good' : overall < 45 ? 'bad' : 'neutral');
  return result;
}

function topSector(c: { power: Record<SectorId, number> }): SectorId {
  return SECTOR_IDS.reduce((a, b) => (c.power[b] > c.power[a] ? b : a));
}

const SHOW_NAMES = ['Live', 'Unleashed', 'Forward', 'Summit', 'Showcase', 'Horizons', 'Next', 'Ignite'];

/** Monthly: rival megacorps book their own keynotes. */
export function corpKeynotesMonthly(w: World): void {
  const d = w.player.dominion;
  for (const c of activeCorps(w)) {
    if (w.day - c.lastKeynote < 120 || d.keynotes.upcoming.some((k) => k.corpId === c.id)) continue;
    if (!chance(w, c.persona === 'showman' ? 0.35 : 0.08)) continue;
    d.keynotes.upcoming.push({ corpId: c.id, day: w.day + Math.round(randRange(w, 20, 40)), title: `${c.name} ${pick(w, SHOW_NAMES)} ${dayToDate(w.day).getUTCFullYear()}`, sector: topSector(c) });
  }
}

function corpKeynote(w: World, k: KeynotePlanLike): void {
  const d = w.player.dominion;
  const c = activeCorps(w).find((x) => x.id === k.corpId);
  if (!c) return;
  c.lastKeynote = w.day;
  const overshadowed = k.title.endsWith('(overshadowed)');
  c.power[k.sector] *= overshadowed ? 1.01 : 1.03;
  if (!overshadowed) d.keynotes.rivalSpotlightUntil = w.day + 10;
  pushNews(w, { kind: 'industry', title: `${c.name} holds ${k.title.replace(' (overshadowed)', '')}`, body: overshadowed ? 'Nobody was paying attention.' : `Big ${k.sector} announcements.`, tone: 'neutral' });
  dlog(w, `${k.title.replace(' (overshadowed)', '')}. ${corpSay(w, c, 'keynote')}${overshadowed ? ' (Your keynote stole the week.)' : ''}`, 'neutral');
}

type KeynotePlanLike = { corpId: string; day: number; title: string; sector: SectorId };

/** Preview of what a planned line-up is likely to score (for the planner). */
export function previewScore(w: World, reveals: RevealItem[], venue: number): number {
  const options = revealOptions(w);
  const scores = reveals.map((r) => options.find((o) => o.kind === r.kind && o.refId === r.refId)?.base ?? 0).filter((x) => x > 0);
  if (!scores.length) return 0;
  return Math.round(clamp(scores.reduce((s, x) => s + x, 0) / scores.length + 10 * execPower(w, 'cmo') + (venue >= 3 ? 2 : 0), 0, 99));
}

export const REVEAL_LABELS: Record<RevealKind, string> = {
  game: 'Game',
  console: 'Console',
  ai: 'AI model',
  engine: 'Engine',
  ecosystem: 'Ecosystem',
  universe: 'Universe',
  space: 'Space',
  megaproject: 'Megaproject',
  city: 'City',
};
