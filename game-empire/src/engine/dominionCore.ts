// Dominion core: shared definitions and helpers for the late game. The
// systems themselves live in their own modules and import from here; the
// orchestrator (dominion.ts) imports them all.
import { OFFICES } from './constants';
import { infraCapacity } from './infra';
import { revenueTTM } from './finance';
import type { DistrictKind, DominionState, ExecRole, Ledger, PartyId, ScarKey, SectorId, World } from './types';
import { clamp, playerCompany } from './util';

export const SECTOR_IDS: SectorId[] = ['games', 'hardware', 'platforms', 'cloud', 'ai', 'media', 'space'];

export const SECTORS: Record<SectorId, { name: string; emoji: string; blurb: string }> = {
  games: { name: 'Games', emoji: '🎮', blurb: 'Game sales, live services, publishing and stores.' },
  hardware: { name: 'Hardware', emoji: '🕹️', blurb: 'Consoles, devices and platform fees.' },
  platforms: { name: 'Platforms', emoji: '🪟', blurb: 'Operating systems, subscriptions and marketplaces.' },
  cloud: { name: 'Cloud', emoji: '☁️', blurb: 'Cloud gaming, compute and server capacity.' },
  ai: { name: 'AI', emoji: '🧠', blurb: 'AI models, AI tools and anti-cheat.' },
  media: { name: 'Media', emoji: '🎬', blurb: 'Films, theme parks and virtual universes.' },
  space: { name: 'Space', emoji: '🚀', blurb: 'Orbital industry, the Moon and the off-world market.' },
};

export type DominionFeature = 'execs' | 'keynotes' | 'espionage' | 'ecosystem' | 'wars' | 'universes' | 'emergencies' | 'space' | 'cities' | 'megaprojects';

export const FEATURES: Record<DominionFeature, { name: string; level: number; blurb: string }> = {
  execs: { name: 'Executives', level: 2, blurb: 'Hire a C-suite with real personalities: loyalty, ambitions, feuds and plans of their own.' },
  keynotes: { name: 'Keynotes', level: 2, blurb: 'Host huge live events to reveal games, consoles and technology, and watch rivals react.' },
  espionage: { name: 'Espionage', level: 3, blurb: 'Moles, leaks, poaching and cyberattacks. Defend yourself, then go on the offensive.' },
  ecosystem: { name: 'Ecosystem', level: 3, blurb: 'An operating system, subscription, marketplace, cloud and devices that lock players in.' },
  wars: { name: 'Empire Wars', level: 4, blurb: 'Rival megacorporations form alliances and fight for control of whole markets.' },
  universes: { name: 'Universes', level: 4, blurb: 'Persistent virtual worlds with millions of residents and real economies.' },
  emergencies: { name: 'Emergencies', level: 4, blurb: 'Empire-scale crises with hard choices and lasting consequences.' },
  space: { name: 'Space', level: 5, blurb: 'Orbital factories, lunar facilities and the interplanetary entertainment market.' },
  cities: { name: 'Cities', level: 5, blurb: 'Found company cities and grow them district by district.' },
  megaprojects: { name: 'Megaprojects', level: 6, blurb: 'Civilisation-scale projects for $10T+ companies.' },
};

export const FEATURE_ORDER: DominionFeature[] = ['wars', 'execs', 'espionage', 'keynotes', 'ecosystem', 'universes', 'space', 'cities', 'megaprojects', 'emergencies'];

/** Highest empire level reached (features never re-lock when value dips). */
export function bestLevel(w: World): number {
  return w.player.empire?.best ?? 0;
}

export function featureOpen(w: World, f: DominionFeature): boolean {
  return bestLevel(w) >= FEATURES[f].level;
}

export function dominionOpen(w: World): boolean {
  return bestLevel(w) >= 2;
}

const zeroSectors = (): Record<SectorId, number> => ({ games: 0, hardware: 0, platforms: 0, cloud: 0, ai: 0, media: 0, space: 0 });
export { zeroSectors };

export function emptyDominion(): DominionState {
  return {
    seen: 0,
    corps: [],
    alliances: [],
    wars: [],
    warHistory: [],
    mods: [],
    annexed: [],
    power: zeroSectors(),
    indieGames: 0,
    execs: [],
    execPool: [],
    execPoolDay: -9999,
    spy: { level: 0, auditDay: -9999, threats: [], ops: [], intel: {}, plants: [], stats: { opsWon: 0, opsFailed: 0, opsExposed: 0, caught: 0, leaks: 0, poached: 0 }, log: [] },
    ecosystem: null,
    keynotes: { plan: null, history: [], lastDay: -9999, rivalSpotlightUntil: 0, upcoming: [] },
    space: { assets: [], launchTech: 0, shield: 0, offworld: 0, firsts: {}, monthRevenue: 0, revenue: 0, incidents: 0 },
    universes: [],
    cities: [],
    megaprojects: [],
    emergency: null,
    emergencyHistory: [],
    nextEmergency: 0,
    scars: [],
    feed: [],
    stats: { warsWon: 0, warsLost: 0, keynotes: 0, annexed: 0, megaprojects: 0, emergencies: 0, disasters: 0 },
    victory: null,
  };
}

/** Money for any size of empire: $12.3M, $4.56T, $7.8Q (quadrillion), $1.2Qi (quintillion). */
export function fmtMoney(n: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const s = n < 0 ? '-' : '';
  if (a >= 1e18) return `${s}$${(a / 1e18).toFixed(2)}Qi`;
  if (a >= 1e15) return `${s}$${(a / 1e15).toFixed(2)}Q`;
  if (a >= 1e12) return `${s}$${(a / 1e12).toFixed(2)}T`;
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(1)}M`;
  return `${s}$${Math.round(a / 1000)}K`;
}

export function fmtPeople(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${Math.round(n / 1e3)}K`;
  return `${Math.round(n)}`;
}

/** The Dominion's own news feed (newest first). */
export function dlog(w: World, text: string, tone: DominionState['feed'][number]['tone'] = 'neutral'): void {
  const d = w.player.dominion;
  if (!d) return;
  d.feed.unshift({ day: w.day, text, tone });
  if (d.feed.length > 80) d.feed.length = 80;
}

/** The size of your business: most late-game prices scale with it. */
export function empireScale(w: World): number {
  return Math.max(1e9, revenueTTM(playerCompany(w)));
}

// ------------------------------------------------------------ sectors

function gameRevenue(l: Ledger): number {
  return l.sales + l.microtransactions + l.subscriptions + l.ads + l.dlc + l.licensing + l.store + l.publishing + l.contracts;
}

/** Server capacity counts toward the cloud sector: about $2 a year per player seat. */
const CLOUD_SEAT_VALUE = 2;

/** Your yearly revenue in each sector, from the last three closed months. */
export function playerRevenueBySector(w: World): Record<SectorId, number> {
  const p = playerCompany(w);
  const d = w.player.dominion;
  const out = zeroSectors();
  const months = p.monthly.slice(-3);
  if (months.length) {
    for (const m of months) {
      const l = m.ledger;
      out.games += gameRevenue(l);
      out.hardware += l.hardware;
      out.ai += l.tech;
      out.media += l.entertainment + l.worlds;
      out.space += l.space;
      out.platforms += l.ecosystem;
    }
    const k = 12 / months.length;
    for (const s of SECTOR_IDS) out[s] *= k;
  }
  // the cloud part of the ecosystem counts as cloud
  const eco = d?.ecosystem;
  if (eco && eco.monthRevenue > 0) {
    const cloud = out.platforms * clamp(eco.partRevenue.cloud / eco.monthRevenue, 0, 1);
    out.platforms -= cloud;
    out.cloud += cloud;
  }
  out.cloud += infraCapacity(w) * CLOUD_SEAT_VALUE;
  // your subsidiaries' games
  for (const id in w.companies) {
    const c = w.companies[id];
    if (c.parentId === p.id && c.status === 'active') {
      const last = c.monthly[c.monthly.length - 1];
      if (last) out.games += last.revenue * 12;
    }
  }
  for (const a of d?.annexed ?? []) for (const s of SECTOR_IDS) out[s] += a.power[s];
  return out;
}

/** Monthly: refresh your sector power and the independents' game revenue. */
export function refreshPower(w: World): void {
  const d = w.player.dominion;
  d.power = playerRevenueBySector(w);
  const owned = new Set<string>();
  for (const c of d.corps) if (c.status === 'active') for (const id of c.studios) owned.add(id);
  let indie = 0;
  for (const id in w.companies) {
    const c = w.companies[id];
    if (c.isPlayer || c.status !== 'active' || c.parentId === w.player.companyId || owned.has(c.id)) continue;
    const last = c.monthly[c.monthly.length - 1];
    if (last) indie += last.revenue * 12;
  }
  d.indieGames = indie;
}

/** Power of one party in one sector. */
export function partyPower(w: World, party: PartyId, sector: SectorId): number {
  const d = w.player.dominion;
  if (party === 'player') return d.power[sector];
  const c = d.corps.find((x) => x.id === party);
  return c && c.status === 'active' ? c.power[sector] : 0;
}

export function sectorTotal(w: World, sector: SectorId): number {
  const d = w.player.dominion;
  let t = d.power[sector];
  for (const c of d.corps) if (c.status === 'active') t += c.power[sector];
  if (sector === 'games') t += d.indieGames;
  return t;
}

/** 0..1 share of a sector. */
export function sectorShare(w: World, sector: SectorId, party: PartyId = 'player'): number {
  const total = sectorTotal(w, sector);
  return total > 0 ? partyPower(w, party, sector) / total : 0;
}

/** Who leads a sector (party id), or null if nobody has any. */
export function sectorLeader(w: World, sector: SectorId): PartyId | null {
  const d = w.player.dominion;
  let best: PartyId | null = d.power[sector] > 0 ? 'player' : null;
  let top = d.power[sector];
  for (const c of d.corps) {
    if (c.status === 'active' && c.power[sector] > top) {
      top = c.power[sector];
      best = c.id;
    }
  }
  return best;
}

/** Extra income for leading a sector: up to +12% of what you earn there. */
export function dominanceBonus(share: number): number {
  return clamp((share - 0.3) * 0.4, 0, 0.12);
}

/** Antitrust heat: dominating markets (and old scandals) make regulators circle. */
export function antitrustFactor(w: World): number {
  const d = w.player.dominion;
  if (!d) return 1;
  let f = 1;
  if (d.corps.length) for (const s of SECTOR_IDS) f += Math.max(0, sectorShare(w, s) - 0.4) * 2;
  return f + scarValue(w, 'antitrust');
}

/** Income multiplier from war spoils, sanctions and the like, for one sector. */
export function sectorMult(w: World, sector: SectorId): number {
  let m = 1;
  for (const x of w.player.dominion?.mods ?? []) if ((x.sector === sector || x.sector === 'all') && w.day < x.until) m *= x.mult;
  return m;
}

// ------------------------------------------------------------ lasting consequences

export function scarValue(w: World, key: ScarKey): number {
  let v = 0;
  for (const s of w.player.dominion?.scars ?? []) if (s.key === key && w.day < s.until) v += s.value;
  return v;
}

export function addScar(w: World, label: string, key: ScarKey, value: number, days: number): void {
  const d = w.player.dominion;
  d.scars.push({ id: `sc${w.day}-${d.scars.length}`, label, key, value, until: w.day + days });
}

// ------------------------------------------------------------ valuation

/** Book value of what you've built: so building a city doesn't crash your valuation. */
export function dominionAssetValue(w: World): number {
  const d = w.player.dominion;
  if (!d) return 0;
  let v = 0;
  for (const a of d.space.assets) {
    if (a.stage === 'active') v += a.cost * 0.7;
    else if (a.stage === 'building') v += (a.cost - a.buildCost * clamp((a.ready - w.day) / Math.max(1, a.ready - a.start), 0, 1)) * 0.5;
  }
  for (const c of d.cities) v += c.invested * 0.6;
  for (const u of d.universes) {
    if (u.stage === 'live') v += u.cost * 0.6;
    else if (u.stage === 'building') v += u.cost * 0.6 * clamp((w.day - u.founded) / Math.max(1, u.ready - u.founded), 0, 1);
  }
  for (const m of d.megaprojects) v += m.stage === 'done' ? m.budget * 0.8 : m.spent * 0.5;
  if (d.ecosystem) v += d.ecosystem.invested * 0.6;
  return v;
}

// ------------------------------------------------------------ executives

/**
 * How much an executive role is doing for you, 0..1. Empty seats do nothing;
 * disloyal or feuding executives do less.
 */
export function execPower(w: World, role: ExecRole): number {
  const e = w.player.dominion?.execs.find((x) => x.role === role);
  if (!e) return 0;
  const feud = e.feudWith ? 0.75 : 1;
  return clamp((e.skill / 100) * (0.55 + (0.45 * e.loyalty) / 100) * feud, 0, 1);
}

// ------------------------------------------------------------ hooks for the rest of the game

/** Your games get extra visibility from your own platform, less while a rival keynote steals the show. */
export function dominionVisibility(w: World): number {
  const d = w.player.dominion;
  if (!d) return 1;
  let v = d.ecosystem?.promo ?? 1;
  if (w.day < d.keynotes.rivalSpotlightUntil) v *= 0.92;
  for (const m of d.megaprojects) if (m.id === 'neuralNet' && m.stage === 'done') v *= 1 + 0.15 * m.quality;
  return v;
}

function megaDone(w: World, id: string): boolean {
  return !!w.player.dominion?.megaprojects.some((m) => m.id === id && m.stage === 'done');
}

function spaceActive(w: World, kind: string): boolean {
  return !!w.player.dominion?.space.assets.some((a) => a.kind === kind && a.stage === 'active');
}

/** Finished district levels of a kind across your cities. */
export function districtLevels(w: World, kind: DistrictKind): number {
  let t = 0;
  for (const c of w.player.dominion?.cities ?? []) {
    if (w.day < c.ready) continue;
    for (const dd of c.districts) if (dd.kind === kind && w.day >= dd.ready) t += dd.level;
  }
  return t;
}

/** Desks: your office plus campus districts in your cities. */
export function deskCapacity(w: World): number {
  return OFFICES[w.player.officeLevel].capacity + 2500 * districtLevels(w, 'campus');
}

/** Server room in your cities' data districts. */
export function cityServerCapacity(w: World): number {
  return 8e7 * districtLevels(w, 'data');
}

/** Research parks speed up R&D (up to +40%). */
export function researchSpeed(w: World): number {
  return 1 + 0.1 * Math.min(4, districtLevels(w, 'research'));
}

/** Console and device costs: cheaper with orbital factories and industry, dearer after supply shocks. */
export function hardwareCostMult(w: World): number {
  return Math.max(0.3, (1 + scarValue(w, 'hardwareCost')) * (1 - 0.04 * Math.min(5, districtLevels(w, 'industry'))) * (spaceActive(w, 'orbitalFactory') ? 0.9 : 1));
}

export function aiRevenueMult(w: World): number {
  return Math.max(0, 1 + scarValue(w, 'aiRevenue'));
}

/** Power bills: fusion, helium-3 and clean-energy districts. */
export function energyMult(w: World): number {
  return (megaDone(w, 'fusionGrid') ? 0.2 : 1) * (spaceActive(w, 'heliumMine') ? 0.6 : 1) * (1 - 0.05 * Math.min(6, districtLevels(w, 'energy')));
}

/** Happier staff when they live in your cities (morale points). */
export function cityMorale(w: World): number {
  return Math.min(10, 2 * districtLevels(w, 'residential'));
}

/** Better AI training odds from research parks. */
export function trainingBonus(w: World): number {
  return Math.min(0.08, 0.02 * districtLevels(w, 'research'));
}

export function aiTrainDiscount(w: World): number {
  return megaDone(w, 'neuralNet') ? 0.8 : 1;
}

/** Your OS and devices make your consoles more appealing. */
export function ecoConsoleBoost(w: World): number {
  const e = w.player.dominion?.ecosystem;
  return e ? 1 + 0.03 * e.levels.os + 0.05 * e.levels.devices : 1;
}
