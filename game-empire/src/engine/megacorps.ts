// Global Empire Wars. Once you're a Megacorp, rival megacorporations notice:
// AI empires with CEOs and personalities who grow, buy studios, form
// alliances, merge, and go to war over whole markets: with each other, and
// with you. Wars are won with sector power, money, executives and tactics;
// winners take market share and can swallow what's left of the losers.
import { ALLIANCE_NAMES, CORP_COLORS, CORP_LINES, CORP_NAMES, CORP_PERSONAS, CORP_PERSONA_IDS, fillLine, type CorpMoment } from './corpLines';
import { REGION_IDS } from './constants';
import { SECTORS, SECTOR_IDS, bestLevel, dlog, empireScale, execPower, featureOpen, fmtMoney, partyPower, sectorShare, zeroSectors } from './dominionCore';
import { rivalPace } from './empire';
import { pushDecision } from './events';
import { personName } from './names';
import type { ActionResult, Alliance, DecisionEvent, Megacorp, PartyId, SectorId, War, WarTactic, World } from './types';
import { celebrate, clamp, newId, playerCompany, pushNews, spend, earn, toast } from './util';
import { chance, pick, randNormal, randRange, shuffle } from './rng';

const fail = (error: string): ActionResult => ({ ok: false, error });
const ok = (id?: string): ActionResult => ({ ok: true, id });

export const MAX_CORPS = 10;
const MAX_WARS = 5;
const WAR_COST_RATE = 0.03;
const WAR_MAX_DAYS = 540;

// ------------------------------------------------------------ lookups

export function activeCorps(w: World): Megacorp[] {
  return (w.player.dominion?.corps ?? []).filter((c) => c.status === 'active');
}

export function corpById(w: World, id: string): Megacorp | undefined {
  return w.player.dominion?.corps.find((c) => c.id === id);
}

export function partyName(w: World, party: PartyId): string {
  if (party === 'player') return playerCompany(w).name;
  return corpById(w, party)?.name ?? 'A rival';
}

export function corpRevenue(c: Megacorp): number {
  let t = 0;
  for (const s of SECTOR_IDS) t += c.power[s];
  return t;
}

function partyRevenue(w: World, party: PartyId): number {
  if (party === 'player') {
    let t = 0;
    for (const s of SECTOR_IDS) t += w.player.dominion.power[s];
    return Math.max(t, empireScale(w));
  }
  const c = corpById(w, party);
  return c ? corpRevenue(c) : 0;
}

export function allianceOf(w: World, party: PartyId): Alliance | null {
  return w.player.dominion.alliances.find((a) => a.members.includes(party)) ?? null;
}

export function allied(w: World, a: PartyId, b: PartyId): boolean {
  const al = allianceOf(w, a);
  return !!al && al.members.includes(b);
}

/** How a party feels about another (-100..100). */
export function relationOf(w: World, from: PartyId, to: PartyId): number {
  if (from === to) return 100;
  if (from === 'player') return corpById(w, to)?.relation ?? 0;
  const c = corpById(w, from);
  if (!c) return 0;
  return to === 'player' ? c.relation : (c.relations[to] ?? 0);
}

export function shiftRelation(w: World, a: PartyId, b: PartyId, delta: number): void {
  const bump = (from: PartyId, to: PartyId) => {
    if (from === 'player') return;
    const c = corpById(w, from);
    if (!c) return;
    if (to === 'player') c.relation = clamp(c.relation + delta, -100, 100);
    else c.relations[to] = clamp((c.relations[to] ?? 0) + delta, -100, 100);
  };
  bump(a, b);
  bump(b, a);
}

export function corpSay(w: World, c: Megacorp, moment: CorpMoment, vars: { them?: string; sector?: SectorId } = {}): string {
  const lines = CORP_LINES[c.persona][moment];
  const text = fillLine(pick(w, lines), { you: playerCompany(w).name, them: vars.them ?? playerCompany(w).name, sector: vars.sector ? SECTORS[vars.sector].name.toLowerCase() : 'the' });
  return `${c.ceo}: “${text}”`;
}

export function warsOf(w: World, party: PartyId): War[] {
  return w.player.dominion.wars.filter((x) => x.attackers.includes(party) || x.defenders.includes(party));
}

export function sideOf(war: War, party: PartyId): 'attackers' | 'defenders' | null {
  return war.attackers.includes(party) ? 'attackers' : war.defenders.includes(party) ? 'defenders' : null;
}

function atWar(w: World, a: PartyId, b: PartyId): War | undefined {
  return w.player.dominion.wars.find((x) => (x.attackers.includes(a) && x.defenders.includes(b)) || (x.attackers.includes(b) && x.defenders.includes(a)));
}

// ------------------------------------------------------------ the corps appear

const PERSONA_GROWTH: Record<Megacorp['persona'], number> = { warlord: 0.0, schemer: 0.01, visionary: 0.03, showman: 0.01, diplomat: 0.015, tycoon: 0.025 };
const PERSONA_FOCUS: Record<Megacorp['persona'], SectorId[]> = {
  warlord: ['games', 'hardware', 'cloud'],
  schemer: ['ai', 'platforms', 'games'],
  visionary: ['ai', 'space', 'cloud'],
  showman: ['media', 'games', 'hardware'],
  diplomat: ['platforms', 'cloud', 'media'],
  tycoon: ['platforms', 'media', 'games'],
};

function makeCorp(w: World, valuation: number): Megacorp {
  const d = w.player.dominion;
  const taken = new Set(d.corps.map((c) => c.name));
  const name = shuffle(w, CORP_NAMES.filter((n) => !taken.has(n)))[0] ?? `Consolidated ${d.corps.length + 1}`;
  const persona = pick(w, CORP_PERSONA_IDS);
  const revenue = valuation / 11;
  const focus = PERSONA_FOCUS[persona];
  const weights = zeroSectors();
  for (const s of SECTOR_IDS) weights[s] = s === 'space' ? (bestLevel(w) >= 5 ? 0.15 : 0.02) : randRange(w, 0.2, 0.6);
  for (const s of focus) weights[s] += randRange(w, 0.8, 1.6);
  let wsum = 0;
  for (const s of SECTOR_IDS) wsum += weights[s];
  const power = zeroSectors();
  for (const s of SECTOR_IDS) power[s] = (revenue * weights[s]) / wsum;
  const usedColors = new Set(d.corps.map((c) => c.color));
  const relations: Record<string, number> = {};
  for (const o of d.corps) if (o.status === 'active') relations[o.id] = Math.round(randRange(w, -30, 30));
  const c: Megacorp = {
    id: newId(w, 'mc'),
    name,
    ceo: personName(w),
    persona,
    color: CORP_COLORS.find((x) => !usedColors.has(x)) ?? pick(w, CORP_COLORS),
    hq: pick(w, REGION_IDS),
    founded: w.day,
    status: 'active',
    endDay: null,
    cash: valuation * 0.08,
    valuation,
    power,
    security: Math.round(randRange(w, 30, 70)),
    intel: Math.round(randRange(w, 30, 70) + (persona === 'schemer' ? 20 : 0)),
    allianceId: null,
    relation: Math.round(randRange(w, -20, 20) + (persona === 'diplomat' ? 15 : persona === 'warlord' ? -15 : 0)),
    relations,
    assets: { ecosystemUsers: power.platforms / 40, universePop: power.media / 300, cities: 0, spaceAssets: 0, projects: {} },
    exhaustion: 0,
    studios: [],
    lastKeynote: w.day - Math.round(randRange(w, 0, 150)),
    lastWar: -9999,
    talksDay: -9999,
    history: [[w.day, valuation]],
  };
  for (const o of d.corps) if (o.status === 'active') o.relations[c.id] = relations[o.id];
  return c;
}

/** Monthly (and on unlock): the megacorps arrive, and new challengers rise as you climb. */
export function ensureCorps(w: World): void {
  if (!featureOpen(w, 'wars')) return;
  const d = w.player.dominion;
  const pv = Math.max(1e11, playerCompany(w).valuation);
  if (!d.corps.length) {
    for (const k of [1.9, 1.3, 0.95, 0.7, 0.5, 0.35]) d.corps.push(makeCorp(w, pv * k * randRange(w, 0.85, 1.15)));
    toast(w, 'Six megacorporations now see you as a threat', 'major', { category: 'industry', link: { route: 'dominion', id: 'wars' }, body: 'They grow, form alliances and fight for whole markets. Some are bigger than you.' });
    dlog(w, 'The megacorps take notice. The fight for whole markets begins.', 'major');
    for (const c of d.corps) dlog(w, `${c.name} (${CORP_PERSONAS[c.persona].emoji} ${c.ceo}): ${corpSay(w, c, 'intro').split(': ')[1]}`);
    return;
  }
  // a new challenger for every empire level past Megacorp
  const want = Math.min(MAX_CORPS, 6 + Math.max(0, bestLevel(w) - 4));
  const last = w.player.flags.corpSpawn ?? -9999;
  if (activeCorps(w).length < want && w.day - last > 120) {
    w.player.flags.corpSpawn = w.day;
    const c = makeCorp(w, pv * randRange(w, 0.6, 1.5));
    d.corps.push(c);
    toast(w, `A new megacorp rises: ${c.name}`, 'major', { category: 'industry', link: { route: 'dominion', id: 'wars' }, body: `Run by ${c.ceo}, ${CORP_PERSONAS[c.persona].name.toLowerCase()}. Worth ${fmtMoney(c.valuation)}.` });
    pushNews(w, { kind: 'industry', title: `${c.name} emerges as a new tech superpower`, body: `CEO ${c.ceo}. Valued at ${fmtMoney(c.valuation)}.`, tone: 'major' });
    dlog(w, `New challenger: ${c.name}. ${corpSay(w, c, 'intro')}`, 'major');
  }
}

// ------------------------------------------------------------ economy

function corpEconomy(w: World, c: Megacorp): void {
  const pv = Math.max(1, playerCompany(w).valuation);
  const catchUp = 0.12 * clamp(Math.log10(pv / Math.max(1, c.valuation)), -1, 2.5);
  const pace = 1 + rivalPace(w);
  let g = (0.1 + PERSONA_GROWTH[c.persona] + catchUp) * pace;
  for (const war of warsOf(w, c.id)) g -= 0.03 * (war.intensity[c.id] ?? 1);
  const factor = 1 + g / 12 + randNormal(w, 0, 0.012);
  for (const s of SECTOR_IDS) {
    let f = factor;
    for (const war of warsOf(w, c.id)) if (war.sector === s && w.day < war.priceWarUntil) f *= 0.97;
    c.power[s] = Math.max(0, c.power[s] * f);
  }
  const revenue = corpRevenue(c);
  c.cash += (revenue / 12) * 0.18;
  c.valuation = Math.max(1e9, revenue * clamp(9 + g * 25, 5, 18) + c.cash);
  c.history.push([w.day, c.valuation]);
  if (c.history.length > 120) c.history.shift();
  if (!warsOf(w, c.id).length) c.exhaustion = Math.max(0, c.exhaustion - 6);
  c.lastWar = warsOf(w, c.id).length ? w.day : c.lastWar;
}

function relationsDrift(w: World, c: Megacorp): void {
  c.relation += -c.relation * 0.04;
  // nobody likes a monopolist, and everyone envies the biggest company in the room
  let resent = 0;
  for (const s of SECTOR_IDS) resent += Math.max(0, sectorShare(w, s) - 0.4) * 6;
  const envy = 1.2 * clamp(Math.log10(Math.max(1, playerCompany(w).valuation) / Math.max(1, c.valuation)) + 0.5, 0, 2.5);
  c.relation -= (resent + envy) * (1 + 0.25 * Math.max(0, bestLevel(w) - 4));
  if (allied(w, c.id, 'player')) c.relation += 2;
  if (atWar(w, c.id, 'player')) c.relation -= 4;
  c.relation = clamp(c.relation, -100, 100);
  for (const id in c.relations) {
    c.relations[id] += -c.relations[id] * 0.04 + (allied(w, c.id, id) ? 2 : 0) - (atWar(w, c.id, id) ? 4 : 0);
    c.relations[id] = clamp(c.relations[id], -100, 100);
  }
}

// ------------------------------------------------------------ the AI's monthly turn

const WARLIKE: Record<Megacorp['persona'], number> = { warlord: 0.14, schemer: 0.05, visionary: 0.025, showman: 0.045, diplomat: 0.012, tycoon: 0.045 };

function aiWar(w: World, c: Megacorp): void {
  const d = w.player.dominion;
  if (d.wars.length >= MAX_WARS || warsOf(w, c.id).length || c.exhaustion > 40 || w.day - c.lastWar < 180) return;
  const myRevenue = corpRevenue(c);
  if (c.cash < myRevenue * 0.05) return;
  // allies count: an alliance can take on someone none of them could alone
  const allies = (allianceOf(w, c.id)?.members ?? []).filter((m) => m !== c.id && m !== 'player').map((m) => corpById(w, m)).filter((x): x is Megacorp => !!x && x.status === 'active');
  let best: { target: PartyId; sector: SectorId; score: number } | null = null;
  const targets: PartyId[] = ['player', ...activeCorps(w).filter((o) => o.id !== c.id).map((o) => o.id)];
  for (const t of targets) {
    if (allied(w, c.id, t) || atWar(w, c.id, t)) continue;
    if (t === 'player' && (warsOf(w, 'player').length >= (bestLevel(w) >= 6 ? 2 : 1) || w.day - (w.player.flags.lastWarOnPlayer ?? -9999) < 240)) continue;
    const rel = relationOf(w, c.id, t);
    const hostility = rel < 0 ? Math.pow(1 + -rel / 40, 2) : 0.6 - rel / 250;
    if (hostility <= 0) continue;
    for (const s of SECTOR_IDS) {
      const mine = c.power[s] + 0.5 * allies.reduce((sum, a) => sum + a.power[s], 0);
      const theirs = partyPower(w, t, s);
      if (theirs <= 0 || mine <= 0) continue;
      const ratio = mine / theirs;
      // the angrier they are, the longer the odds they'll take
      if (ratio < (rel < -40 ? 0.25 : 0.45)) continue;
      let score = theirs * Math.min(ratio, 1.6) * hostility;
      if (t === 'player' && sectorShare(w, s) > 0.35) score *= 1.5 + 0.25 * Math.max(0, bestLevel(w) - 5);
      // everyone watches the player: rivals pick on each other a little less
      if (t !== 'player') score *= 0.6;
      if (!best || score > best.score) best = { target: t, sector: s, score };
    }
  }
  // a bitter enough rival attacks your strongest market even when outmatched
  if ((!best || best.target !== 'player') && c.relation <= -50 && !atWar(w, c.id, 'player') && !allied(w, c.id, 'player') && warsOf(w, 'player').length < (bestLevel(w) >= 6 ? 2 : 1) && w.day - (w.player.flags.lastWarOnPlayer ?? -9999) >= 240) {
    const top = SECTOR_IDS.reduce((a, b) => (partyPower(w, 'player', b) > partyPower(w, 'player', a) ? b : a));
    const force = (power: number, total: number) => Math.sqrt(Math.max(0, power + 0.15 * total));
    let mine = force(c.power[top], myRevenue) * 1.3;
    for (const a of allies) mine += 0.5 * force(a.power[top], corpRevenue(a));
    const theirs = force(partyPower(w, 'player', top), partyRevenue(w, 'player'));
    if (theirs > 0 && mine / theirs >= 0.3) best = { target: 'player', sector: top, score: 1 };
  }
  if (!best) return;
  // grudges make wars far more likely
  const rel = relationOf(w, c.id, best.target);
  const grudge = 1 + Math.max(0, -rel - 20) / 20;
  if (chance(w, Math.min(0.5, WARLIKE[c.persona] * (1 + rivalPace(w)) * grudge))) startWar(w, c.id, best.target, best.sector);
}

/** At the top, whole alliances turn on you. */
function coalitionWar(w: World): void {
  const lvl = bestLevel(w);
  if (lvl < 6 || warsOf(w, 'player').length >= 2) return;
  if (w.day - (w.player.flags.lastWarOnPlayer ?? -9999) < 200) return;
  for (const al of w.player.dominion.alliances) {
    if (al.members.includes('player') || al.members.length < 2) continue;
    const members = al.members.map((id) => corpById(w, id)).filter((x): x is Megacorp => !!x && x.status === 'active');
    const hostile = members.reduce((s, m) => s + m.relation, 0) / Math.max(1, members.length);
    if (hostile > -10) continue;
    let target: SectorId | null = null;
    let top = 0.45;
    for (const s of SECTOR_IDS) {
      const share = sectorShare(w, s);
      if (share > top) {
        top = share;
        target = s;
      }
    }
    if (!target || !chance(w, 0.05 * (lvl - 5))) continue;
    const leader = members.reduce((a, b) => (corpRevenue(b) > corpRevenue(a) ? b : a));
    startWar(w, leader.id, 'player', target, `${al.name} unites against you`);
    return;
  }
}

function aiAlliances(w: World, c: Megacorp): void {
  const d = w.player.dominion;
  const al = allianceOf(w, c.id);
  // fallouts: members who hate each other leave
  if (al) {
    for (const m of al.members) {
      if (m === c.id) continue;
      if (relationOf(w, c.id, m) < -25 && chance(w, 0.4)) {
        leaveAllianceParty(w, c.id, `${c.name} storms out of ${al.name}`);
        return;
      }
    }
    return;
  }
  const want = c.persona === 'diplomat' ? 0.2 : 0.05;
  if (!chance(w, want)) return;
  // the player gets an invitation now and then
  if (featureOpen(w, 'wars') && c.relation >= 45 && !atWar(w, c.id, 'player') && w.day - (w.player.flags.allianceInvite ?? -9999) > 180 && chance(w, 0.5)) {
    w.player.flags.allianceInvite = w.day;
    const theirs = allianceOf(w, c.id);
    pushDecision(w, {
      kind: 'allianceOffer',
      title: `${c.name} proposes an alliance`,
      body: `${c.ceo} wants to stand together. Allies defend each other in wars and share technology (+2% income for each ally, up to +8%). You may be called to arms when they're attacked, and refusing ends the alliance.${theirs ? '' : ''}`,
      options: [
        { id: 'accept', label: 'Join forces', description: 'Allies fight beside you and boost your income.' },
        { id: 'decline', label: 'Stay independent', description: `${c.name} is a little offended.` },
      ],
      data: { corpId: c.id },
      expiresDay: w.day + 30,
      defaultOption: 'decline',
    });
    return;
  }
  let partner: Megacorp | null = null;
  let bestRel = 15;
  for (const o of activeCorps(w)) {
    if (o.id === c.id || atWar(w, c.id, o.id)) continue;
    const rel = relationOf(w, c.id, o.id) + (o.relation < -20 && c.relation < -20 ? 25 : 0);
    const theirs = allianceOf(w, o.id);
    if (theirs && (theirs.members.length >= 4 || theirs.members.includes('player'))) continue;
    if (rel > bestRel) {
      bestRel = rel;
      partner = o;
    }
  }
  if (!partner) return;
  const theirs = allianceOf(w, partner.id);
  if (theirs) {
    theirs.members.push(c.id);
    c.allianceId = theirs.id;
    pushNews(w, { kind: 'industry', title: `${c.name} joins ${theirs.name}`, tone: 'neutral' });
    dlog(w, `${c.name} joins ${theirs.name}.`);
  } else {
    const used = new Set(d.alliances.map((a) => a.name));
    const name = ALLIANCE_NAMES.find((n) => !used.has(n)) ?? `The ${c.name} Pact`;
    const a: Alliance = { id: newId(w, 'al'), name, members: [c.id, partner.id], formed: w.day };
    d.alliances.push(a);
    c.allianceId = a.id;
    partner.allianceId = a.id;
    pushNews(w, { kind: 'industry', title: `${c.name} and ${partner.name} form ${name}`, tone: 'major' });
    dlog(w, `${c.name} and ${partner.name} form ${name}. ${corpSay(w, c, 'alliance')}`, 'neutral');
  }
}

function leaveAllianceParty(w: World, party: PartyId, headline: string): void {
  const d = w.player.dominion;
  const al = allianceOf(w, party);
  if (!al) return;
  al.members = al.members.filter((m) => m !== party);
  for (const m of al.members) shiftRelation(w, party, m, -20);
  const c = party === 'player' ? null : corpById(w, party);
  if (c) c.allianceId = null;
  if (al.members.length < 2) {
    for (const m of al.members) {
      const mc = corpById(w, m);
      if (mc) mc.allianceId = null;
    }
    d.alliances = d.alliances.filter((x) => x.id !== al.id);
  }
  pushNews(w, { kind: 'industry', title: headline, tone: 'neutral' });
  dlog(w, headline);
}

function aiAcquire(w: World, c: Megacorp): void {
  const want = c.persona === 'tycoon' ? 0.18 : 0.04;
  if (!chance(w, want)) return;
  const owned = new Set<string>();
  for (const o of w.player.dominion.corps) for (const id of o.studios) owned.add(id);
  let best: { id: string; price: number; rev: number } | null = null;
  for (const id in w.companies) {
    const s = w.companies[id];
    if (s.isPlayer || s.status !== 'active' || s.parentId || owned.has(id)) continue;
    const price = Math.max(s.valuation, 1e8) * 1.3;
    if (price > c.cash * 0.3) continue;
    const last = s.monthly[s.monthly.length - 1];
    const rev = last ? last.revenue * 12 : 0;
    if (!best || rev > best.rev) best = { id, price, rev };
  }
  if (!best) return;
  const s = w.companies[best.id];
  c.cash -= best.price;
  s.cash += best.price * 0.1;
  s.corpId = c.id;
  c.studios.push(s.id);
  c.power.games += best.rev;
  pushNews(w, { kind: 'industry', title: `${c.name} buys ${s.name} for ${fmtMoney(best.price)}`, companyId: s.id, tone: 'neutral' });
  dlog(w, `${c.name} buys the studio ${s.name}.`);
}

function aiMerge(w: World): void {
  const pv = playerCompany(w).valuation;
  for (const al of w.player.dominion.alliances) {
    const members = al.members.map((id) => corpById(w, id)).filter((x): x is Megacorp => !!x && x.status === 'active');
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i];
        const b = members[j];
        if (a.valuation > pv * 0.4 || b.valuation > pv * 0.4 || relationOf(w, a.id, b.id) < 40 || !chance(w, 0.03)) continue;
        const [big, small] = a.valuation >= b.valuation ? [a, b] : [b, a];
        for (const s of SECTOR_IDS) big.power[s] += small.power[s] * 0.95;
        big.cash += small.cash;
        big.studios.push(...small.studios);
        for (const id of small.studios) if (w.companies[id]) w.companies[id].corpId = big.id;
        big.assets.ecosystemUsers += small.assets.ecosystemUsers;
        big.assets.universePop += small.assets.universePop;
        big.assets.cities += small.assets.cities;
        big.assets.spaceAssets += small.assets.spaceAssets;
        big.valuation += small.valuation;
        endCorp(w, small, 'collapsed', `${small.name} merges into ${big.name}`);
        toast(w, `${big.name} and ${small.name} merge to take you on`, 'major', { category: 'industry', link: { route: 'dominion', id: 'wars' }, body: `The combined company is worth ${fmtMoney(big.valuation)}.` });
        dlog(w, `${big.name} swallows ${small.name}. ${corpSay(w, big, 'alliance')}`, 'major');
        return;
      }
    }
  }
}

function endCorp(w: World, c: Megacorp, status: 'collapsed' | 'annexed', headline: string): void {
  const d = w.player.dominion;
  c.status = status;
  c.endDay = w.day;
  if (allianceOf(w, c.id)) leaveAllianceParty(w, c.id, headline);
  else pushNews(w, { kind: 'industry', title: headline, tone: 'major' });
  for (const war of [...d.wars]) {
    if (!war.attackers.includes(c.id) && !war.defenders.includes(c.id)) continue;
    war.attackers = war.attackers.filter((x) => x !== c.id);
    war.defenders = war.defenders.filter((x) => x !== c.id);
    if (!war.attackers.length) endWar(w, war, 'defenders');
    else if (!war.defenders.length) endWar(w, war, 'attackers');
  }
  if (status === 'collapsed') for (const id of c.studios) if (w.companies[id]?.corpId === c.id) w.companies[id].corpId = null;
}

function maybeCollapse(w: World, c: Megacorp): void {
  if (c.cash >= 0) return;
  // a fire sale: they shrink while they're broke
  for (const s of SECTOR_IDS) c.power[s] *= 0.93;
  c.cash += corpRevenue(c) * 0.02;
  if (c.valuation < playerCompany(w).valuation * 0.01 && corpRevenue(c) < 5e9) {
    endCorp(w, c, 'collapsed', `${c.name} collapses under its debts`);
    dlog(w, `${c.name} collapses. ${corpSay(w, c, 'lost')}`, 'major');
  }
}

export function corpsMonthly(w: World): void {
  if (!featureOpen(w, 'wars')) return;
  ensureCorps(w);
  for (const c of activeCorps(w)) {
    corpEconomy(w, c);
    relationsDrift(w, c);
    maybeCollapse(w, c);
  }
  for (const c of activeCorps(w)) {
    aiAlliances(w, c);
    aiWar(w, c);
    aiAcquire(w, c);
  }
  coalitionWar(w);
  aiMerge(w);
  // studios owned by a corp that went bust or were bought by you leave the corp
  for (const c of activeCorps(w)) c.studios = c.studios.filter((id) => w.companies[id]?.status === 'active' && w.companies[id].corpId === c.id);
}

// ------------------------------------------------------------ wars

export function startWar(w: World, attacker: PartyId, defender: PartyId, sector: SectorId, headline?: string): War {
  const d = w.player.dominion;
  const war: War = {
    id: newId(w, 'wr'),
    sector,
    attacker,
    defender,
    attackers: [attacker],
    defenders: [defender],
    score: 0,
    start: w.day,
    intensity: {},
    cooldowns: {},
    priceWarUntil: 0,
    peaceOffered: false,
    log: [],
    spent: {},
  };
  // allies honour their pacts
  const atkAl = allianceOf(w, attacker);
  const defAl = allianceOf(w, defender);
  for (const m of defAl?.members ?? []) {
    if (m === defender || m === 'player' || war.attackers.includes(m) || (atkAl && atkAl.members.includes(m))) continue;
    war.defenders.push(m);
  }
  for (const m of atkAl?.members ?? []) {
    if (m === attacker || m === 'player' || war.defenders.includes(m)) continue;
    if (relationOf(w, m, defender) < 10) war.attackers.push(m);
  }
  for (const p of [...war.attackers, ...war.defenders]) {
    const c = corpById(w, p);
    war.intensity[p] = p === 'player' ? 1 : c ? (c.persona === 'warlord' ? 2 : c.cash > corpRevenue(c) * 0.5 ? 2 : 1) : 1;
    war.spent[p] = 0;
  }
  for (const a of war.attackers) for (const b of war.defenders) shiftRelation(w, a, b, -35);
  d.wars.push(war);
  const title = headline ?? `${partyName(w, attacker)} declares war on ${partyName(w, defender)} over ${SECTORS[sector].name.toLowerCase()}`;
  pushNews(w, { kind: 'industry', title, tone: 'major' });
  const ac = corpById(w, attacker);
  const quote = ac ? ` ${corpSay(w, ac, 'declare', { them: partyName(w, defender), sector })}` : '';
  dlog(w, `${title}.${quote}`, 'major');
  if (defender === 'player') {
    w.player.flags.lastWarOnPlayer = w.day;
    toast(w, title, 'major', { category: 'industry', link: { route: 'dominion', id: 'wars' }, body: `${war.attackers.length > 1 ? `${war.attackers.length} megacorps attack together. ` : ''}Set your war intensity and use tactics before they take your market.` });
  }
  // you're allied with someone in this fight: a call to arms
  const myAl = allianceOf(w, 'player');
  if (myAl && attacker !== 'player' && defender !== 'player') {
    const side = myAl.members.includes(defender) ? 'defenders' : myAl.members.includes(attacker) ? 'attackers' : null;
    if (side && !w.pendingEvents.some((e) => e.kind === 'warCall')) {
      const friend = side === 'defenders' ? defender : attacker;
      const foe = side === 'defenders' ? attacker : defender;
      pushDecision(w, {
        kind: 'warCall',
        title: `Your ally ${partyName(w, friend)} calls you to war`,
        body: `${partyName(w, foe)} and ${partyName(w, friend)} are fighting over ${SECTORS[sector].name.toLowerCase()}. Join your ally (and share the spoils) or stay out, which ends your alliance.`,
        options: [
          { id: 'join', label: 'Answer the call', description: `Fight beside ${partyName(w, friend)}. ${partyName(w, foe)} becomes your enemy.` },
          { id: 'refuse', label: 'Stay out', description: 'Your alliance breaks and your ally never forgets.' },
        ],
        data: { warId: war.id, side },
        expiresDay: w.day + 21,
        defaultOption: 'join',
      });
    }
  }
  return war;
}

function partyForce(w: World, war: War, party: PartyId): number {
  const sectorPower = partyPower(w, party, war.sector);
  const total = partyRevenue(w, party);
  const intensity = war.intensity[party] ?? 1;
  let f = Math.sqrt(Math.max(0, sectorPower + 0.15 * total)) * (0.6 + 0.35 * intensity);
  if (party === 'player') {
    f *= 1 + 0.25 * execPower(w, 'coo') + 0.15 * execPower(w, 'cmo');
    const enemies = sideOf(war, 'player') === 'attackers' ? war.defenders : war.attackers;
    let intel = 0;
    for (const e of enemies) intel = Math.max(intel, w.player.dominion.spy.intel[e] ?? 0);
    f *= 1 + intel / 400;
  } else {
    const c = corpById(w, party);
    if (c) f *= (1 + c.intel / 500) * (1 - c.exhaustion / 250);
  }
  return f;
}

export function sideForce(w: World, war: War, side: 'attackers' | 'defenders'): number {
  let f = 0;
  war[side].forEach((p, i) => (f += partyForce(w, war, p) * (i === 0 ? 1 : 0.5)));
  return f;
}

/** The player's daily war bill for one war. */
export function warDailyCost(w: World, war: War, party: PartyId = 'player'): number {
  return ((war.intensity[party] ?? 1) * WAR_COST_RATE * partyRevenue(w, party)) / 365;
}

const BATTLES: Record<SectorId, string[]> = {
  games: ['{a} undercuts {b} with a wave of discounted releases', '{a} signs three top studios away from {b}', '{a}’s new release outsells {b}’s flagship'],
  hardware: ['{a} slashes device prices and {b} loses shelf space', 'Retailers side with {a} in the hardware war', '{a} ships a faster chip than {b}'],
  platforms: ['{a} pays developers to leave {b}’s store', '{a} offers a year of free subscriptions to {b}’s users', '{a} signs a platform exclusive {b} wanted'],
  cloud: ['{a} cuts cloud prices 40% to lure {b}’s customers', 'An outage at {b} sends customers to {a}', '{a} opens new regions in {b}’s home market'],
  ai: ['{a}’s new model tops every benchmark and {b} scrambles', '{a} hires {b}’s top researchers', '{a} open-sources a model to undercut {b}'],
  media: ['{a}’s blockbuster crushes {b} at the box office', '{a} opens a rival park next to {b}’s', '{a} lures {b}’s virtual-world creators'],
  space: ['{a} wins the lunar launch contract over {b}', '{a} beats {b} to orbit with a cheaper rocket', '{a} lands cargo on the Moon ahead of {b}'],
};

function involvesPlayer(war: War): boolean {
  return war.attackers.includes('player') || war.defenders.includes('player');
}

function warLog(w: World, war: War, text: string, swing: number): void {
  war.log.unshift({ day: w.day, text, swing });
  if (war.log.length > 30) war.log.length = 30;
}

/** Positive: good for the player. */
export function playerScore(war: War): number {
  return sideOf(war, 'player') === 'defenders' ? -war.score : war.score;
}

export function warsDaily(w: World): void {
  const d = w.player.dominion;
  if (!d?.wars.length) return;
  const p = playerCompany(w);
  for (const war of [...d.wars]) {
    const fa = sideForce(w, war, 'attackers');
    const fd = sideForce(w, war, 'defenders');
    const drift = (1.1 * (fa - fd)) / Math.max(1, fa + fd);
    const before = war.score;
    war.score = clamp(war.score + drift + randNormal(w, 0, 0.5), -100, 100);
    for (const party of [...war.attackers, ...war.defenders]) {
      const cost = warDailyCost(w, war, party);
      war.spent[party] = (war.spent[party] ?? 0) + cost;
      if (party === 'player') spend(p, 'warfare', cost * (1 - 0.3 * execPower(w, 'cfo')));
      else {
        const c = corpById(w, party);
        if (c) {
          c.cash -= cost;
          c.exhaustion = Math.min(100, c.exhaustion + 0.07 * (1 + (war.intensity[party] ?? 1)));
        }
      }
    }
    const age = w.day - war.start;
    if (age > 0 && age % 7 === 0) {
      const swing = clamp(randNormal(w, drift * 5, 4), -12, 12);
      war.score = clamp(war.score + swing, -100, 100);
      const gain = swing >= 0 ? war.attackers[0] : war.defenders[0];
      const lose = swing >= 0 ? war.defenders[0] : war.attackers[0];
      const text = fillLine(pick(w, BATTLES[war.sector]), { a: partyName(w, gain), b: partyName(w, lose) });
      warLog(w, war, text, swing);
      if (involvesPlayer(war) && Math.abs(swing) >= 8) dlog(w, text, (sideOf(war, 'player') === 'attackers') === swing > 0 ? 'good' : 'bad');
      aiPeace(w, war);
    }
    if (involvesPlayer(war)) {
      const ps = playerScore(war);
      const prev = sideOf(war, 'player') === 'defenders' ? -before : before;
      if (prev < 50 && ps >= 50) toast(w, `You're winning the ${SECTORS[war.sector].name.toLowerCase()} war`, 'good', { category: 'industry', link: { route: 'dominion', id: 'wars' } });
      if (prev > -50 && ps <= -50) toast(w, `You're losing the ${SECTORS[war.sector].name.toLowerCase()} war`, 'bad', { category: 'industry', link: { route: 'dominion', id: 'wars' }, body: 'Raise the intensity, use tactics, or sue for peace.' });
    }
    if (war.score >= 100) endWar(w, war, 'attackers');
    else if (war.score <= -100) endWar(w, war, 'defenders');
    else if (age > WAR_MAX_DAYS) endWar(w, war, 'peace');
  }
}

function aiPeace(w: World, war: War): void {
  for (const side of ['attackers', 'defenders'] as const) {
    const lead = war[side][0];
    if (lead === 'player') continue;
    const c = corpById(w, lead);
    if (!c) continue;
    const myScore = side === 'attackers' ? war.score : -war.score;
    if (myScore > -45 && c.exhaustion < 70) continue;
    const other = side === 'attackers' ? war.defenders[0] : war.attackers[0];
    if (other === 'player') {
      if (war.peaceOffered || w.pendingEvents.some((e) => e.kind === 'peaceOffer') || w.day - (w.player.flags[`peace:${war.id}`] ?? -9999) < 60) return;
      const losing = myScore < 0;
      const reparations = losing ? Math.round(Math.max(0, Math.min(c.cash * 0.25, c.valuation * 0.02))) : 0;
      war.peaceOffered = true;
      pushDecision(w, {
        kind: 'peaceOffer',
        title: `${c.name} sues for peace`,
        body: `${corpSay(w, c, 'peace')} They offer to end the ${SECTORS[war.sector].name.toLowerCase()} war${reparations ? ` and pay ${fmtMoney(reparations)} in reparations` : ''}. Keep fighting to win outright: a decisive victory takes market share and could let you swallow them.`,
        options: [
          { id: 'accept', label: reparations ? `Accept · +${fmtMoney(reparations)}` : 'Accept peace', description: 'The war ends now. No market share changes hands.' },
          { id: 'decline', label: 'Fight on', description: 'Go for a decisive victory.' },
        ],
        data: { warId: war.id, reparations, corpId: c.id },
        expiresDay: w.day + 21,
        defaultOption: 'accept',
      });
      return;
    }
    const oc = corpById(w, other);
    if (oc && (oc.exhaustion > 40 || chance(w, 0.3))) {
      endWar(w, war, 'peace');
      return;
    }
  }
}

export function endWar(w: World, war: War, result: 'attackers' | 'defenders' | 'peace'): void {
  const d = w.player.dominion;
  const p = playerCompany(w);
  d.wars = d.wars.filter((x) => x.id !== war.id);
  const title = `${partyName(w, war.attacker)} vs ${partyName(w, war.defender)}`;
  const sector = war.sector;
  const sname = SECTORS[sector].name.toLowerCase();
  let playerResult: 'won' | 'lost' | 'peace' | null = involvesPlayer(war) ? 'peace' : null;
  let resultText = 'Peace treaty';
  if (result !== 'peace') {
    const winners = war[result];
    const losers = result === 'attackers' ? war.defenders : war.attackers;
    resultText = `${partyName(w, winners[0])} won`;
    let taken = 0;
    for (let i = 0; i < losers.length; i++) {
      const l = losers[i];
      const k = i === 0 ? 0.3 : 0.15;
      if (l === 'player') {
        d.mods.push({ sector, mult: 0.85, until: w.day + 540, reason: `Lost the ${sname} war to ${partyName(w, winners[0])}` });
        const reparations = Math.max(0, Math.min(Math.max(0, p.cash) * 0.1, p.valuation * 0.01));
        if (reparations > 0) spend(p, 'warfare', reparations);
        const winnerCorp = corpById(w, winners[0]);
        if (winnerCorp) winnerCorp.cash += reparations;
        p.reputation = Math.max(0, p.reputation - 4);
        if (p.isPublic) p.price *= 0.92;
        d.stats.warsLost += 1;
        playerResult = 'lost';
        taken += d.power[sector] * 0.15;
      } else {
        const c = corpById(w, l);
        if (!c) continue;
        taken += c.power[sector] * k;
        c.power[sector] *= 1 - k;
        c.exhaustion = Math.min(100, c.exhaustion + 20);
        dlog(w, `${c.name}: ${corpSay(w, c, 'lost').split(': ')[1]}`, 'neutral');
      }
    }
    const winCorps = winners.map((x) => corpById(w, x)).filter((x): x is Megacorp => !!x);
    for (const c of winCorps) c.power[sector] += (taken * 0.5) / Math.max(1, winCorps.length + (winners.includes('player') ? 1 : 0));
    if (winners.includes('player')) {
      d.mods.push({ sector, mult: 1.2, until: w.day + 730, reason: `Spoils: won the ${sname} war` });
      const main = corpById(w, losers[0]);
      const reparations = main ? Math.max(0, Math.min(main.cash * 0.25, main.valuation * 0.03)) : 0;
      if (main && reparations > 0) {
        main.cash -= reparations;
        earn(p, 'dominion', reparations);
      }
      p.reputation = Math.min(100, p.reputation + 3);
      d.stats.warsWon += 1;
      playerResult = 'won';
      celebrate(w, `Victory in the ${sname} war!`, true);
      toast(w, `You won the ${sname} war`, 'good', { category: 'industry', link: { route: 'dominion', id: 'wars' }, body: `+20% ${sname} income for two years${reparations ? `, ${fmtMoney(reparations)} in reparations` : ''}.` });
      if (main && main.status === 'active' && main.valuation < p.valuation * 0.6) offerAnnex(w, main, 0.35, 'conquest');
    } else if (playerResult === 'lost') {
      toast(w, `You lost the ${sname} war`, 'bad', { category: 'industry', link: { route: 'dominion', id: 'wars' }, body: `-15% ${sname} income for 18 months, reparations paid, reputation -4.` });
    }
    for (const c of winCorps) dlog(w, `${c.name}: ${corpSay(w, c, 'won', { sector }).split(': ')[1]}`, 'neutral');
  } else {
    for (const party of [...war.attackers, ...war.defenders]) {
      const c = corpById(w, party);
      if (c) c.exhaustion = Math.max(0, c.exhaustion - 10);
    }
    if (playerResult) toast(w, `Peace in the ${sname} war`, 'neutral', { category: 'industry', link: { route: 'dominion', id: 'wars' } });
  }
  d.warHistory.unshift({ id: war.id, sector, title, result: resultText, start: war.start, end: w.day, player: playerResult });
  if (d.warHistory.length > 30) d.warHistory.length = 30;
  pushNews(w, { kind: 'industry', title: `${title}: ${resultText.toLowerCase()} in ${sname}`, tone: 'major' });
  dlog(w, `War over: ${title} (${sname}). ${resultText}.`, playerResult === 'won' ? 'good' : playerResult === 'lost' ? 'bad' : 'neutral');
}

// ------------------------------------------------------------ the player at war

export function declareWar(w: World, corpId: string, sector: SectorId): ActionResult {
  if (!featureOpen(w, 'wars')) return fail('Empire Wars unlock at the Megacorp level ($100B).');
  const c = corpById(w, corpId);
  if (!c || c.status !== 'active') return fail('No such megacorp.');
  if (allied(w, 'player', corpId)) return fail('You can’t attack an ally. Leave the alliance first.');
  if (atWar(w, 'player', corpId)) return fail('You are already at war with them.');
  if (warsOf(w, 'player').length >= 3) return fail('You are already fighting three wars.');
  if (w.player.dominion.wars.length >= MAX_WARS + 2) return fail('The world can’t take another war right now.');
  const p = playerCompany(w);
  p.reputation = Math.max(0, p.reputation - 1);
  const war = startWar(w, 'player', corpId, sector);
  shiftRelation(w, 'player', corpId, -20);
  for (const ally of allianceOf(w, corpId)?.members ?? []) if (ally !== corpId) shiftRelation(w, 'player', ally, -10);
  dlog(w, `${corpSay(w, c, 'betrayed', { them: p.name })}`, 'bad');
  return ok(war.id);
}

export function setWarIntensity(w: World, warId: string, level: number): ActionResult {
  const war = w.player.dominion.wars.find((x) => x.id === warId);
  if (!war || !sideOf(war, 'player')) return fail('You are not in that war.');
  war.intensity.player = clamp(Math.round(level), 0, 3);
  return ok();
}

export const TACTICS: Record<WarTactic, { name: string; blurb: string; cost: number; swing: number; cooldown: number; needs?: 'espionage' }> = {
  priceWar: { name: 'Price war', blurb: 'Slash prices across the sector. A big swing, but everyone (you too) earns 20% less there for 60 days.', cost: 0.008, swing: 12, cooldown: 120 },
  adBlitz: { name: 'Ad blitz', blurb: 'Saturate every screen on Earth. Stronger with a great CMO.', cost: 0.003, swing: 6, cooldown: 45 },
  exclusives: { name: 'Exclusive deals', blurb: 'Lock up partners and studios. Strongest in games, platforms and hardware.', cost: 0.007, swing: 8, cooldown: 90 },
  lobbying: { name: 'Lobbying', blurb: 'Get regulators to lean on the enemy. Stronger with a great General Counsel; can backfire into antitrust trouble.', cost: 0.004, swing: 7, cooldown: 90 },
  talentRaid: { name: 'Talent raid', blurb: 'Poach the enemy’s best people. Their intel suffers. Can be exposed.', cost: 0.005, swing: 8, cooldown: 90, needs: 'espionage' },
  sabotage: { name: 'Sabotage', blurb: 'Quietly wreck their launch. The biggest swing, and the biggest scandal if you’re caught.', cost: 0.006, swing: 14, cooldown: 120, needs: 'espionage' },
};

export function tacticCost(w: World, t: WarTactic): number {
  return Math.round(TACTICS[t].cost * empireScale(w));
}

export function useTactic(w: World, warId: string, tactic: WarTactic): ActionResult {
  const war = w.player.dominion.wars.find((x) => x.id === warId);
  const side = war ? sideOf(war, 'player') : null;
  if (!war || !side) return fail('You are not in that war.');
  const def = TACTICS[tactic];
  if (def.needs && !featureOpen(w, def.needs)) return fail('Needs Espionage.');
  if (w.day < (war.cooldowns[tactic] ?? 0)) return fail(`Ready again in ${(war.cooldowns[tactic] ?? 0) - w.day} days.`);
  const cost = tacticCost(w, tactic);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Costs ${fmtMoney(cost)}.`);
  spend(p, 'warfare', cost);
  war.cooldowns[tactic] = w.day + def.cooldown;
  const mine = sideForce(w, war, side);
  const theirs = sideForce(w, war, side === 'attackers' ? 'defenders' : 'attackers');
  let swing = def.swing * (0.6 + 0.8 * (mine / Math.max(1, mine + theirs)));
  const enemies = side === 'attackers' ? war.defenders : war.attackers;
  let note = '';
  if (tactic === 'priceWar') {
    war.priceWarUntil = w.day + 60;
    w.player.dominion.mods.push({ sector: war.sector, mult: 0.8, until: w.day + 60, reason: 'Price war' });
    for (const e of enemies) {
      const c = corpById(w, e);
      if (c) c.power[war.sector] *= 0.94;
    }
  } else if (tactic === 'adBlitz') {
    swing *= 1 + 0.6 * execPower(w, 'cmo');
    p.reputation = Math.min(100, p.reputation + 1);
  } else if (tactic === 'exclusives') {
    if (war.sector !== 'games' && war.sector !== 'platforms' && war.sector !== 'hardware') swing *= 0.5;
  } else if (tactic === 'lobbying') {
    swing *= 0.7 + 0.8 * execPower(w, 'counsel');
    if (chance(w, 0.18 * (1 - execPower(w, 'counsel')))) {
      w.player.dominion.scars.push({ id: newId(w, 'sc'), label: 'Lobbying scandal: regulators are watching', key: 'antitrust', value: 0.5, until: w.day + 365 });
      note = ' The lobbying leaked: regulators are watching you for a year.';
    }
  } else if (tactic === 'talentRaid' || tactic === 'sabotage') {
    const risk = (tactic === 'sabotage' ? 0.35 : 0.22) * (1 - 0.5 * execPower(w, 'cso'));
    for (const e of enemies) {
      const c = corpById(w, e);
      if (c) c.intel = Math.max(0, c.intel - (tactic === 'talentRaid' ? 10 : 4));
    }
    if (chance(w, risk)) {
      swing *= 0.3;
      p.reputation = Math.max(0, p.reputation - (tactic === 'sabotage' ? 5 : 2));
      for (const e of enemies) shiftRelation(w, 'player', e, -15);
      w.player.dominion.spy.stats.opsExposed += 1;
      note = ' It was exposed: the press is calling it corporate warfare.';
    }
  }
  war.score = clamp(war.score + (side === 'attackers' ? swing : -swing), -100, 100);
  warLog(w, war, `${playerCompany(w).name}: ${def.name.toLowerCase()} (${fmtMoney(cost)}).${note}`, side === 'attackers' ? swing : -swing);
  dlog(w, `You used ${def.name.toLowerCase()} in the ${SECTORS[war.sector].name.toLowerCase()} war.${note}`, note ? 'bad' : 'good');
  if (war.score >= 100) endWar(w, war, 'attackers');
  else if (war.score <= -100) endWar(w, war, 'defenders');
  return ok();
}

/** Ask for peace. Winning? They pay you. Losing? You pay them. */
export function peaceTerms(w: World, warId: string): { accept: boolean; payment: number; note: string } {
  const war = w.player.dominion.wars.find((x) => x.id === warId);
  if (!war || !sideOf(war, 'player')) return { accept: false, payment: 0, note: 'You are not in that war.' };
  const ps = playerScore(war);
  const enemy = corpById(w, sideOf(war, 'player') === 'attackers' ? war.defenders[0] : war.attackers[0]);
  const p = playerCompany(w);
  if (!enemy) return { accept: true, payment: 0, note: 'They have nobody left to fight.' };
  if (ps >= 20) {
    const pay = Math.round(Math.max(0, Math.min(enemy.cash * 0.15, enemy.valuation * 0.01)));
    return { accept: true, payment: pay, note: `${enemy.name} will pay ${fmtMoney(pay)} to stop the war.` };
  }
  if (ps > -20) return { accept: enemy.exhaustion > 30 || enemy.persona === 'diplomat', payment: 0, note: enemy.exhaustion > 30 || enemy.persona === 'diplomat' ? 'A white peace: nobody pays.' : `${enemy.name} thinks it can still win.` };
  const pay = Math.round(Math.max(0, Math.min(Math.max(0, p.cash) * 0.2, p.valuation * 0.015 * (1 + -ps / 100))));
  return { accept: true, payment: -pay, note: `${enemy.name} demands ${fmtMoney(pay)} to stop.` };
}

export function makePeace(w: World, warId: string): ActionResult {
  const war = w.player.dominion.wars.find((x) => x.id === warId);
  if (!war || !sideOf(war, 'player')) return fail('You are not in that war.');
  const t = peaceTerms(w, warId);
  if (!t.accept) return fail(t.note);
  const p = playerCompany(w);
  const enemy = corpById(w, sideOf(war, 'player') === 'attackers' ? war.defenders[0] : war.attackers[0]);
  if (t.payment > 0 && enemy) {
    enemy.cash -= t.payment;
    earn(p, 'dominion', t.payment);
  } else if (t.payment < 0) {
    if (p.cash < -t.payment) return fail(`You need ${fmtMoney(-t.payment)} to pay for peace.`);
    spend(p, 'warfare', -t.payment);
    if (enemy) enemy.cash += -t.payment;
  }
  if (enemy) dlog(w, `${enemy.name}: ${corpSay(w, enemy, 'peace').split(': ')[1]}`, 'neutral');
  endWar(w, war, 'peace');
  return ok();
}

/** Jump into a war between two megacorps. */
export function joinWar(w: World, warId: string, side: 'attackers' | 'defenders'): ActionResult {
  if (!featureOpen(w, 'wars')) return fail('Empire Wars are locked.');
  const war = w.player.dominion.wars.find((x) => x.id === warId);
  if (!war) return fail('No such war.');
  if (sideOf(war, 'player')) return fail('You are already in this war.');
  if (warsOf(w, 'player').length >= 3) return fail('You are already fighting three wars.');
  const foes = side === 'attackers' ? war.defenders : war.attackers;
  if (foes.some((f) => allied(w, 'player', f))) return fail('You can’t fight your own ally.');
  war[side].push('player');
  war.intensity.player = 1;
  war.spent.player = 0;
  for (const f of war[side]) if (f !== 'player') shiftRelation(w, 'player', f, 20);
  for (const f of foes) shiftRelation(w, 'player', f, -40);
  dlog(w, `You join the ${SECTORS[war.sector].name.toLowerCase()} war on the side of ${partyName(w, war[side][0])}.`, 'major');
  return ok();
}

// ------------------------------------------------------------ diplomacy

export function allianceChance(w: World, corpId: string): number {
  const c = corpById(w, corpId);
  if (!c || c.status !== 'active' || atWar(w, 'player', corpId)) return 0;
  let p = 0.15 + (c.relation - 20) / 100;
  if (c.persona === 'diplomat') p += 0.2;
  if (c.persona === 'warlord') p -= 0.1;
  // a common enemy brings people together
  for (const war of warsOf(w, 'player')) if ((sideOf(war, 'player') === 'attackers' ? war.defenders : war.attackers).some((e) => relationOf(w, c.id, e) < -20)) p += 0.25;
  return clamp(p, 0, 0.9);
}

export function proposeAlliance(w: World, corpId: string): ActionResult {
  if (!featureOpen(w, 'wars')) return fail('Empire Wars are locked.');
  const c = corpById(w, corpId);
  if (!c || c.status !== 'active') return fail('No such megacorp.');
  if (allied(w, 'player', corpId)) return fail('Already allies.');
  if (w.day - (w.player.flags[`ask:${corpId}`] ?? -9999) < 90) return fail('They are still thinking about your last offer.');
  w.player.flags[`ask:${corpId}`] = w.day;
  if (!chance(w, allianceChance(w, corpId))) {
    shiftRelation(w, 'player', corpId, -3);
    toast(w, `${c.name} turns down your alliance`, 'neutral', { category: 'industry', link: { route: 'dominion', id: 'wars' } });
    return ok();
  }
  joinAlliance(w, c);
  return ok();
}

function joinAlliance(w: World, c: Megacorp): void {
  const d = w.player.dominion;
  leaveAllianceParty(w, 'player', `${playerCompany(w).name} leaves its alliance`);
  const theirs = allianceOf(w, c.id);
  if (theirs) {
    // their alliance must not be at war with you
    if (theirs.members.some((m) => atWar(w, 'player', m))) {
      toast(w, `${c.name}'s allies are at war with you`, 'bad', { category: 'industry' });
      return;
    }
    theirs.members.push('player');
    for (const m of theirs.members) if (m !== 'player') shiftRelation(w, 'player', m, 10);
  } else {
    const used = new Set(d.alliances.map((a) => a.name));
    const name = ALLIANCE_NAMES.find((n) => !used.has(n)) ?? `The ${playerCompany(w).name} Accord`;
    const a: Alliance = { id: newId(w, 'al'), name, members: ['player', c.id], formed: w.day };
    d.alliances.push(a);
    c.allianceId = a.id;
  }
  shiftRelation(w, 'player', c.id, 15);
  const al = allianceOf(w, 'player');
  toast(w, `You are now allied with ${c.name}`, 'good', { category: 'industry', link: { route: 'dominion', id: 'wars' }, body: al ? `${al.name}: allies defend each other and share technology.` : undefined });
  dlog(w, `Alliance: ${playerCompany(w).name} and ${c.name}. ${corpSay(w, c, 'alliance')}`, 'good');
}

export function leaveAlliance(w: World): ActionResult {
  if (!allianceOf(w, 'player')) return fail('You are not in an alliance.');
  leaveAllianceParty(w, 'player', `${playerCompany(w).name} leaves its alliance`);
  return ok();
}

/** Allies share technology: +2% income each, up to +8%. */
export function allianceBonus(w: World): number {
  const al = allianceOf(w, 'player');
  return al ? Math.min(0.08, 0.02 * (al.members.length - 1)) : 0;
}

export function jointVentureCost(w: World): number {
  return Math.round(Math.max(1e9, empireScale(w) * 0.0015));
}

/** Spend money together on something: relations improve. */
export function jointVenture(w: World, corpId: string): ActionResult {
  const c = corpById(w, corpId);
  if (!c || c.status !== 'active') return fail('No such megacorp.');
  if (atWar(w, 'player', corpId)) return fail('Not while you are at war with them.');
  if (w.day - c.talksDay < 120) return fail(`Ready again in ${120 - (w.day - c.talksDay)} days.`);
  const cost = jointVentureCost(w);
  const p = playerCompany(w);
  if (p.cash < cost) return fail(`Costs ${fmtMoney(cost)}.`);
  spend(p, 'warfare', cost);
  c.talksDay = w.day;
  shiftRelation(w, 'player', corpId, c.persona === 'diplomat' ? 22 : c.persona === 'warlord' ? 9 : 15);
  dlog(w, `Joint venture with ${c.name}: relations improve.`, 'good');
  return ok();
}

// ------------------------------------------------------------ annexation

function offerAnnex(w: World, c: Megacorp, priceMult: number, why: 'conquest' | 'merger'): void {
  if (w.pendingEvents.some((e) => e.kind === 'annex')) return;
  const intel = w.player.dominion.spy.intel[c.id] ?? 0;
  const price = Math.round(c.valuation * priceMult * (1 - Math.min(0.3, intel / 300)));
  pushDecision(w, {
    kind: 'annex',
    title: why === 'conquest' ? `${c.name} is beaten: absorb it?` : `${c.name} agrees to merge`,
    body: `${c.ceo} ${why === 'conquest' ? 'has lost the war and the board wants out' : 'is ready to sell'}. Pay ${fmtMoney(price)} and ${c.name} becomes part of your empire: its markets add to yours and it earns for you every month.`,
    options: [
      { id: 'accept', label: `Absorb · ${fmtMoney(price)}`, description: `Takes ${fmtMoney(price)} in cash. One less rival.`, disabled: playerCompany(w).cash < price },
      { id: 'decline', label: 'Not now', description: 'They limp on as an independent.' },
    ],
    data: { corpId: c.id, price },
    expiresDay: w.day + 30,
    defaultOption: 'decline',
  });
}

export function mergerPrice(w: World, corpId: string): number {
  const c = corpById(w, corpId);
  return c ? Math.round(c.valuation * 0.9) : 0;
}

export function mergerBlocker(w: World, corpId: string): string | null {
  const c = corpById(w, corpId);
  if (!c || c.status !== 'active') return 'No such megacorp.';
  if (c.relation < 60) return `Needs relations of 60 (now ${Math.round(c.relation)}).`;
  if (c.valuation > playerCompany(w).valuation * 0.35) return 'They must be worth under 35% of you.';
  if (playerCompany(w).cash < mergerPrice(w, corpId)) return `Needs ${fmtMoney(mergerPrice(w, corpId))} in cash.`;
  return null;
}

/** A friendly merger with a much smaller megacorp that likes you. */
export function proposeMerger(w: World, corpId: string): ActionResult {
  const blocker = mergerBlocker(w, corpId);
  if (blocker) return fail(blocker);
  absorbCorp(w, corpById(w, corpId)!, mergerPrice(w, corpId));
  return ok();
}

export function absorbCorp(w: World, c: Megacorp, price: number): void {
  const d = w.player.dominion;
  const p = playerCompany(w);
  p.cash -= price;
  const power = zeroSectors();
  for (const s of SECTOR_IDS) power[s] = c.power[s] * 0.75;
  d.annexed.push({ id: c.id, name: c.name, day: w.day, power });
  d.stats.annexed += 1;
  dlog(w, `${c.name}: ${corpSay(w, c, 'annexed').split(': ')[1]}`, 'neutral');
  endCorp(w, c, 'annexed', `${p.name} absorbs ${c.name}`);
  for (const id of c.studios) if (w.companies[id]?.corpId === c.id) w.companies[id].corpId = null;
  for (const o of activeCorps(w)) o.relation = clamp(o.relation - 8, -100, 100);
  celebrate(w, `${c.name} is now yours`, true);
  toast(w, `You absorbed ${c.name}`, 'good', { category: 'industry', link: { route: 'dominion', id: 'wars' }, body: 'Its markets are yours and it earns for you every month. The other megacorps are nervous.' });
}

/** Monthly: what absorbed megacorps earn for you (they keep growing a little). */
export function annexedIncome(w: World): number {
  let t = 0;
  for (const a of w.player.dominion.annexed) {
    for (const s of SECTOR_IDS) a.power[s] *= 1 + 0.06 / 12;
    let rev = 0;
    for (const s of SECTOR_IDS) rev += a.power[s];
    t += (rev / 12) * 0.5;
  }
  return t;
}

// ------------------------------------------------------------ decisions

export function resolveWarDecision(w: World, ev: DecisionEvent, optionId: string): boolean {
  const d = w.player.dominion;
  const data = ev.data;
  if (ev.kind === 'warCall') {
    const war = d.wars.find((x) => x.id === data.warId);
    if (!war) return true;
    const side = data.side as 'attackers' | 'defenders';
    if (optionId === 'join') {
      if (!sideOf(war, 'player')) {
        war[side].push('player');
        war.intensity.player = 1;
        war.spent.player = 0;
        for (const f of side === 'attackers' ? war.defenders : war.attackers) shiftRelation(w, 'player', f, -35);
        dlog(w, `You answer your ally's call in the ${SECTORS[war.sector].name.toLowerCase()} war.`, 'major');
      }
    } else {
      const friend = war[side][0];
      leaveAllianceParty(w, 'player', `${playerCompany(w).name} abandons ${partyName(w, friend)}`);
      shiftRelation(w, 'player', friend, -30);
      const c = corpById(w, friend);
      if (c) dlog(w, `${c.name}: ${corpSay(w, c, 'betrayed', { them: playerCompany(w).name }).split(': ')[1]}`, 'bad');
    }
    return true;
  }
  if (ev.kind === 'peaceOffer') {
    const war = d.wars.find((x) => x.id === data.warId);
    if (!war) return true;
    if (optionId === 'accept') {
      const c = corpById(w, String(data.corpId));
      const pay = Number(data.reparations) || 0;
      if (c && pay > 0) {
        c.cash -= pay;
        earn(playerCompany(w), 'dominion', pay);
      }
      endWar(w, war, 'peace');
    } else {
      // they'll ask again later if it keeps going badly
      war.peaceOffered = false;
      w.player.flags[`peace:${war.id}`] = w.day;
    }
    return true;
  }
  if (ev.kind === 'annex') {
    const c = corpById(w, String(data.corpId));
    const price = Number(data.price);
    if (optionId === 'accept' && c && c.status === 'active' && playerCompany(w).cash >= price) absorbCorp(w, c, price);
    return true;
  }
  if (ev.kind === 'allianceOffer') {
    const c = corpById(w, String(data.corpId));
    if (optionId === 'accept' && c && c.status === 'active') joinAlliance(w, c);
    else if (c) shiftRelation(w, 'player', c.id, -5);
    return true;
  }
  return false;
}

/** For the UI: a quick read on a corp's threat to you. */
export function corpThreat(w: World, c: Megacorp): 'ally' | 'hostile' | 'wary' | 'friendly' {
  if (allied(w, 'player', c.id)) return 'ally';
  if (c.relation <= -30 || atWar(w, 'player', c.id)) return 'hostile';
  if (c.relation >= 30) return 'friendly';
  return 'wary';
}

export function warEta(w: World, war: War): number | null {
  const fa = sideForce(w, war, 'attackers');
  const fd = sideForce(w, war, 'defenders');
  const drift = (1.1 * (fa - fd)) / Math.max(1, fa + fd);
  if (Math.abs(drift) < 0.05) return null;
  const left = drift > 0 ? 100 - war.score : war.score + 100;
  return Math.round(left / Math.abs(drift));
}

