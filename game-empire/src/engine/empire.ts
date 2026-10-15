// Empire levels. The bigger the company gets, the harder the game plays:
// regulators circle, upkeep grows, critics expect masterpieces and rivals
// race faster. Every level has challenges; clearing them all pays a reward
// and trims the upkeep.
import { pushDecision } from './events';
import { infraCapacity } from './infra';
import { addXp } from './progression';
import { bestModel, consolesInstalled, aiLead } from './ventures';
import { SECTOR_IDS, antitrustFactor, fmtMoney, sectorLeader, sectorTotal } from './dominionCore';
import { playerColonists } from './space';
import type { DecisionEvent, World } from './types';
import { celebrate, ledgerRevenue, playerCompany, pushNews, spend, toast } from './util';
import { chance, rand } from './rng';

export interface EmpireLevelDef {
  name: string;
  min: number;
  blurb: string;
  /** Share of each month's revenue spent on lawyers, lobbyists and compliance. */
  overhead: number;
  /** Share of cash spent each month guarding and moving it. */
  cashDrag: number;
  /** Monthly chance of an antitrust investigation. */
  antitrust: number;
  /** Monthly chance of a crisis (data breach, union drive). */
  crisis: number;
  /** Critic score penalty: everyone expects a masterpiece. */
  critics: number;
  /** How much faster rivals, cheat makers and AI labs move. */
  rivalPace: number;
  /** Rival studios' game quality boost. */
  rivalQuality: number;
}

export const EMPIRE_LEVELS: EmpireLevelDef[] = [
  { name: 'Indie Studio', min: 0, blurb: 'Nobody is watching yet.', overhead: 0, cashDrag: 0, antitrust: 0, crisis: 0, critics: 0, rivalPace: 0, rivalQuality: 0 },
  { name: 'Rising Studio', min: 1e8, blurb: 'The industry has noticed you.', overhead: 0, cashDrag: 0, antitrust: 0, crisis: 0, critics: 0, rivalPace: 0, rivalQuality: 0 },
  { name: 'Major Publisher', min: 1e9, blurb: 'A household name. Rivals start copying you.', overhead: 0.01, cashDrag: 0, antitrust: 0, crisis: 0, critics: 0, rivalPace: 0.05, rivalQuality: 0.01 },
  { name: 'Industry Giant', min: 1e10, blurb: 'Regulators open a file on you. Critics expect more.', overhead: 0.02, cashDrag: 0.0005, antitrust: 0.03, crisis: 0, critics: 1, rivalPace: 0.15, rivalQuality: 0.02 },
  { name: 'Megacorp', min: 1e11, blurb: 'Hackers, unions and lawmakers all want a piece.', overhead: 0.04, cashDrag: 0.001, antitrust: 0.05, crisis: 0.03, critics: 2, rivalPace: 0.3, rivalQuality: 0.035 },
  { name: 'Trillion-Dollar Empire', min: 1e12, blurb: 'Every government on Earth is investigating you.', overhead: 0.06, cashDrag: 0.002, antitrust: 0.08, crisis: 0.05, critics: 3, rivalPace: 0.5, rivalQuality: 0.05 },
  { name: 'World Power', min: 1e13, blurb: 'You are bigger than most countries. They have noticed.', overhead: 0.08, cashDrag: 0.003, antitrust: 0.12, crisis: 0.07, critics: 4, rivalPace: 0.75, rivalQuality: 0.065 },
  { name: 'Galactic Conglomerate', min: 1e14, blurb: 'The world’s governments and megacorps unite against you.', overhead: 0.1, cashDrag: 0.004, antitrust: 0.16, crisis: 0.09, critics: 5, rivalPace: 1, rivalQuality: 0.08 },
  { name: 'Solar Dynasty', min: 1e15, blurb: 'You own a slice of the Solar System. Every rival alive wants you gone.', overhead: 0.12, cashDrag: 0.005, antitrust: 0.2, crisis: 0.11, critics: 6, rivalPace: 1.3, rivalQuality: 0.095 },
  { name: 'Cosmic Sovereign', min: 1e16, blurb: 'The final level. Only the stars are left.', overhead: 0.14, cashDrag: 0.006, antitrust: 0.24, crisis: 0.13, critics: 7, rivalPace: 1.6, rivalQuality: 0.11 },
];

/** Current empire level from the company's valuation. */
export function empireLevel(w: World): number {
  const p = playerCompany(w);
  if (!p || p.status !== 'active') return 0;
  let lvl = 0;
  for (let i = 0; i < EMPIRE_LEVELS.length; i++) if (p.valuation >= EMPIRE_LEVELS[i].min) lvl = i;
  return lvl;
}

export function empireDef(w: World): EmpireLevelDef {
  return EMPIRE_LEVELS[empireLevel(w)];
}

export function criticPenalty(w: World): number {
  return empireDef(w).critics;
}

export function rivalPace(w: World): number {
  return empireDef(w).rivalPace;
}

export function rivalQualityBoost(w: World): number {
  return 1 + empireDef(w).rivalQuality;
}

/** Each cleared level cuts upkeep by 10% (up to half). */
export function upkeepDiscount(w: World): number {
  return Math.max(0.5, 1 - 0.1 * (w.player.empire?.cleared.length ?? 0));
}

/** What the empire costs to run this month, before it is charged. */
export function empireUpkeep(w: World): { revenue: number; cash: number; total: number } {
  const p = playerCompany(w);
  const def = empireDef(w);
  const k = upkeepDiscount(w);
  const revenue = Math.max(0, ledgerRevenue(p.ledger)) * def.overhead * k;
  const cash = Math.max(0, p.cash) * def.cashDrag * k;
  return { revenue, cash, total: revenue + cash };
}

export function decreeActive(w: World): boolean {
  return w.day < (w.player.empire?.decreeUntil ?? 0);
}

export function strikeActive(w: World): boolean {
  return w.day < (w.player.empire?.strikeUntil ?? 0);
}

const money = fmtMoney;

// ------------------------------------------------------------ monthly pressure

export function empireMonthly(w: World): void {
  const p = playerCompany(w);
  if (!p || p.status !== 'active' || w.player.gameOver) return;
  const e = w.player.empire;
  const lvl = empireLevel(w);
  const def = EMPIRE_LEVELS[lvl];

  const upkeep = empireUpkeep(w);
  if (upkeep.total > 0) {
    spend(p, 'empire', upkeep.total);
    e.overheadPaid += upkeep.total;
  }

  if (def.antitrust > 0 && chance(w, Math.min(0.6, def.antitrust * antitrustFactor(w)))) {
    const fine = Math.round(Math.max(0, p.cash) * 0.015);
    const fees = Math.round(Math.max(0, p.cash) * 0.003);
    const odds = Math.round(courtOdds(w) * 100);
    e.investigations += 1;
    pushDecision(w, {
      kind: 'antitrust',
      title: 'Antitrust regulators are coming for you',
      body: `Regulators say ${p.name} has grown too powerful. Settle for ${money(fine)}, fight it in court (${money(fees)} in legal fees, about ${odds}% to win; losing costs twice the settlement and a consent decree), or accept a consent decree: no fine, but your platform and licence income is halved for a year.`,
      options: [
        { id: 'settle', label: `Settle · ${money(fine)}`, description: 'Pay the fine and move on.' },
        { id: 'fight', label: `Fight in court · ${odds}%`, description: `Legal fees ${money(fees)}. Win and your reputation grows.` },
        { id: 'decree', label: 'Consent decree', description: 'No fine. Console fees and licence income halved for 12 months.' },
      ],
      data: { fine, fees },
      expiresDay: w.day + 30,
      defaultOption: 'settle',
    });
  }

  if (def.crisis > 0 && chance(w, def.crisis)) {
    if (rand(w) < 0.5) {
      const cost = Math.round(Math.max(0, p.cash) * 0.004);
      pushDecision(w, {
        kind: 'breach',
        title: 'Hackers stole player data',
        body: `A breach exposed millions of player accounts across your games. A full security response costs ${money(cost)}. Downplaying it is free, unless journalists dig it up.`,
        options: [
          { id: 'respond', label: `Full response · ${money(cost)}`, description: 'Reputation -1. The story dies down.' },
          { id: 'downplay', label: 'Downplay it', description: 'Free, but 60% chance it blows up later: reputation -8 and a fine.' },
        ],
        data: { cost },
        expiresDay: w.day + 21,
        defaultOption: 'respond',
      });
    } else {
      pushDecision(w, {
        kind: 'union',
        title: 'Your developers want to unionise',
        body: 'Staff across your studios are organising. Recognise the union (salaries +6%, morale +15) or resist it (risk a month-long strike that halves development speed).',
        options: [
          { id: 'recognise', label: 'Recognise the union', description: 'Salaries +6%, morale +15.' },
          { id: 'resist', label: 'Resist', description: '50% chance of a 30-day strike and reputation -3.' },
        ],
        data: {},
        expiresDay: w.day + 21,
        defaultOption: 'recognise',
      });
    }
  }
}

/** Your odds in court: better with a good reputation, worse the bigger you are. */
export function courtOdds(w: World): number {
  const p = playerCompany(w);
  return Math.max(0.2, Math.min(0.75, 0.55 + (p.reputation - 60) / 200 - 0.04 * Math.max(0, empireLevel(w) - 3)));
}

export function resolveEmpire(w: World, ev: DecisionEvent, optionId: string): boolean {
  const p = playerCompany(w);
  const e = w.player.empire;
  if (ev.kind === 'antitrust') {
    const fine = Number(ev.data.fine);
    const fees = Number(ev.data.fees);
    if (optionId === 'settle') {
      spend(p, 'empire', fine);
      e.finesPaid += fine;
      pushNews(w, { kind: 'player', title: `${p.name} settles antitrust case for ${money(fine)}`, companyId: p.id, tone: 'neutral' });
    } else if (optionId === 'fight') {
      spend(p, 'empire', fees);
      if (rand(w) < courtOdds(w)) {
        e.courtWins += 1;
        p.reputation = Math.min(100, p.reputation + 2);
        toast(w, 'You won the antitrust case!', 'good', { category: 'finance', link: { route: 'empire' } });
        pushNews(w, { kind: 'player', title: `Court clears ${p.name} in landmark antitrust case`, companyId: p.id, tone: 'good' });
      } else {
        spend(p, 'empire', fine * 2);
        e.finesPaid += fine * 2;
        e.decreeUntil = w.day + 365;
        p.reputation = Math.max(0, p.reputation - 3);
        toast(w, `You lost the antitrust case: ${money(fine * 2)} fine and a consent decree`, 'bad', { category: 'finance', link: { route: 'empire' } });
        pushNews(w, { kind: 'player', title: `${p.name} loses antitrust case`, body: `Fined ${money(fine * 2)} and placed under a consent decree.`, companyId: p.id, tone: 'bad' });
      }
    } else if (optionId === 'decree') {
      e.decreeUntil = w.day + 365;
      pushNews(w, { kind: 'player', title: `${p.name} accepts consent decree`, companyId: p.id, tone: 'neutral' });
    }
    return true;
  }
  if (ev.kind === 'breach') {
    if (optionId === 'respond') {
      spend(p, 'empire', Number(ev.data.cost));
      p.reputation = Math.max(0, p.reputation - 1);
    } else if (rand(w) < 0.6) {
      const fine = Math.round(Math.max(0, p.cash) * 0.01);
      spend(p, 'empire', fine);
      e.finesPaid += fine;
      p.reputation = Math.max(0, p.reputation - 8);
      toast(w, `The cover-up leaked: ${money(fine)} fine and reputation -8`, 'bad', { category: 'finance', link: { route: 'empire' } });
      pushNews(w, { kind: 'player', title: `${p.name} hid a massive data breach`, companyId: p.id, tone: 'bad' });
    }
    return true;
  }
  if (ev.kind === 'union') {
    if (optionId === 'recognise') {
      for (const emp of w.player.employees) {
        if (emp.isFounder) continue;
        emp.salary = Math.round(emp.salary * 1.06);
        emp.morale = Math.min(100, emp.morale + 15);
      }
      pushNews(w, { kind: 'player', title: `${p.name} recognises its developers' union`, companyId: p.id, tone: 'good' });
    } else if (rand(w) < 0.5) {
      e.strikeUntil = w.day + 30;
      p.reputation = Math.max(0, p.reputation - 3);
      toast(w, 'Your developers are on strike for 30 days', 'bad', { category: 'team', link: { route: 'team' } });
      pushNews(w, { kind: 'player', title: `Developers walk out at ${p.name}`, companyId: p.id, tone: 'bad' });
    }
    return true;
  }
  return false;
}

// ------------------------------------------------------------ challenges

export interface EmpireChallenge {
  id: string;
  level: number;
  name: string;
  progress: (w: World) => [number, number];
}

const v = (w: World) => w.player.ventures;
const countGoty = (w: World) => w.awardsHistory.filter((a) => a.companyId === w.player.companyId && a.category === 'Game of the Year').length;

export const EMPIRE_CHALLENGES: EmpireChallenge[] = [
  { id: 'l1_games', level: 1, name: 'Release 10 games', progress: (w) => [w.player.stats.gamesReleased, 10] },
  { id: 'l1_ac', level: 1, name: 'Ship your own anti-cheat', progress: (w) => [v(w).antiCheat?.version ?? 0, 1] },
  { id: 'l1_award', level: 1, name: 'Win a Game Award', progress: (w) => [w.awardsHistory.filter((a) => a.companyId === w.player.companyId).length, 1] },
  { id: 'l2_film', level: 2, name: 'Release a film of one of your games', progress: (w) => [v(w).films.filter((f) => f.stage === 'released').length, 1] },
  { id: 'l2_aclic', level: 2, name: 'License your anti-cheat to 5 studios', progress: (w) => [v(w).antiCheat?.licensees.length ?? 0, 5] },
  { id: 'l2_dc', level: 2, name: 'Own 2 data centers', progress: (w) => [w.player.infra.dataCenters.length, 2] },
  { id: 'l3_console', level: 3, name: 'Launch your own console', progress: (w) => [v(w).consoles.filter((c) => c.stage !== 'design').length, 1] },
  { id: 'l3_park', level: 3, name: 'Open a theme park', progress: (w) => [v(w).parks.filter((x) => x.stage === 'open').length, 1] },
  { id: 'l3_ai', level: 3, name: 'Train an AI model', progress: (w) => [v(w).ai?.models.length ?? 0, 1] },
  { id: 'l4_install', level: 4, name: '50 million of your consoles in homes', progress: (w) => [consolesInstalled(w), 50e6] },
  { id: 'l4_ai', level: 4, name: 'Train a generation 4 AI model', progress: (w) => [bestModel(w)?.gen ?? 0, 4] },
  { id: 'l4_film', level: 4, name: 'A film that grosses $1B', progress: (w) => [Math.max(0, ...v(w).films.filter((f) => f.stage === 'released').map((f) => f.gross)), 1e9] },
  { id: 'l5_install', level: 5, name: '200 million of your consoles in homes', progress: (w) => [consolesInstalled(w), 200e6] },
  { id: 'l5_lead', level: 5, name: 'Lead the AI race by 20%', progress: (w) => [Math.round(aiLead(w) * 100), 120] },
  { id: 'l5_parks', level: 5, name: 'Run 5 theme parks', progress: (w) => [v(w).parks.filter((x) => x.stage === 'open').length, 5] },
  { id: 'l5_court', level: 5, name: 'Win an antitrust case in court', progress: (w) => [w.player.empire.courtWins, 1] },
  { id: 'l6_ai', level: 6, name: 'Train a generation 8 AI model', progress: (w) => [bestModel(w)?.gen ?? 0, 8] },
  { id: 'l6_parks', level: 6, name: 'Run 12 theme parks', progress: (w) => [v(w).parks.filter((x) => x.stage === 'open').length, 12] },
  { id: 'l6_orbit', level: 6, name: 'Run the Orbital Server Ring', progress: (w) => [w.player.infra.tier >= 7 ? 1 : 0, 1] },
  { id: 'l6_aclic', level: 6, name: 'Your anti-cheat in 30 studios', progress: (w) => [v(w).antiCheat?.licensees.length ?? 0, 30] },
  { id: 'l7_ai', level: 7, name: 'Build a superintelligence (AI generation 10)', progress: (w) => [bestModel(w)?.gen ?? 0, 10] },
  { id: 'l7_console', level: 7, name: 'Launch a generation 6 console', progress: (w) => [Math.max(0, ...v(w).consoles.filter((c) => c.stage !== 'design').map((c) => c.gen)), 6] },
  { id: 'l7_parks', level: 7, name: 'Run 25 theme parks', progress: (w) => [v(w).parks.filter((x) => x.stage === 'open').length, 25] },
  { id: 'l7_servers', level: 7, name: 'Room for 100 billion players on your servers', progress: (w) => [infraCapacity(w), 1e11] },
  { id: 'l7_goty', level: 7, name: 'Win Game of the Year 3 times', progress: (w) => [countGoty(w), 3] },
  // the Dominion
  { id: 'l2_execs', level: 2, name: 'Hire 3 executives', progress: (w) => [dom(w).execs.length, 3] },
  { id: 'l2_keynote', level: 2, name: 'Hold a keynote that scores 70+', progress: (w) => [Math.max(0, ...dom(w).keynotes.history.map((k) => k.score)), 70] },
  { id: 'l3_eco', level: 3, name: 'Launch your own operating system', progress: (w) => [dom(w).ecosystem?.levels.os ?? 0, 1] },
  { id: 'l3_spy', level: 3, name: 'Pull off 3 spy operations', progress: (w) => [dom(w).spy.stats.opsWon, 3] },
  { id: 'l4_war', level: 4, name: 'Win an empire war', progress: (w) => [dom(w).stats.warsWon, 1] },
  { id: 'l4_world', level: 4, name: 'A universe with 10 million residents', progress: (w) => [Math.max(0, ...dom(w).universes.map((u) => u.population)), 1e7] },
  { id: 'l4_crisis', level: 4, name: 'Contain an emergency', progress: (w) => [dom(w).emergencyHistory.filter((e) => e.outcome === 'contained').length, 1] },
  { id: 'l5_moon', level: 5, name: 'Open a lunar base', progress: (w) => [dom(w).space.assets.filter((a) => a.kind === 'lunarBase' && a.stage === 'active').length, 1] },
  { id: 'l5_city', level: 5, name: 'A company city of 1 million people', progress: (w) => [Math.max(0, ...dom(w).cities.map((c) => c.population)), 1e6] },
  { id: 'l5_annex', level: 5, name: 'Absorb a megacorp', progress: (w) => [dom(w).stats.annexed, 1] },
  { id: 'l6_mega', level: 6, name: 'Complete a megaproject', progress: (w) => [dom(w).stats.megaprojects, 1] },
  { id: 'l6_users', level: 6, name: '1 billion people in your ecosystem', progress: (w) => [dom(w).ecosystem?.users ?? 0, 1e9] },
  { id: 'l6_lead', level: 6, name: 'Lead 4 markets', progress: (w) => [leadCount(w), 4] },
  { id: 'l7_mars', level: 7, name: 'Found a Mars colony', progress: (w) => [dom(w).space.assets.filter((a) => a.kind === 'marsColony' && a.stage === 'active').length, 1] },
  { id: 'l7_wars', level: 7, name: 'Win 5 empire wars', progress: (w) => [dom(w).stats.warsWon, 5] },
  { id: 'l7_mega3', level: 7, name: 'Complete 3 megaprojects', progress: (w) => [dom(w).stats.megaprojects, 3] },
  { id: 'l8_dyson', level: 8, name: 'Complete the Dyson Compute Swarm', progress: (w) => [dom(w).megaprojects.some((m) => m.id === 'dysonCompute' && m.stage === 'done') ? 1 : 0, 1] },
  { id: 'l8_colonists', level: 8, name: '100 million colonists off Earth', progress: (w) => [playerColonists(w), 1e8] },
  { id: 'l8_annex', level: 8, name: 'Absorb 3 megacorps', progress: (w) => [dom(w).stats.annexed, 3] },
  { id: 'l8_lead', level: 8, name: 'Lead every market', progress: (w) => [leadCount(w), SECTOR_IDS.length] },
  { id: 'l9_starship', level: 9, name: 'Launch the Interstellar Starship', progress: (w) => [dom(w).victory ? 1 : 0, 1] },
  { id: 'l9_worlds', level: 9, name: '5 billion residents in your universes', progress: (w) => [dom(w).universes.reduce((s, u) => s + u.population, 0), 5e9] },
  { id: 'l9_half', level: 9, name: 'Own half of every market', progress: (w) => [halfCount(w), SECTOR_IDS.length] },
];

function dom(w: World) {
  return w.player.dominion;
}

function leadCount(w: World): number {
  return SECTOR_IDS.filter((s) => sectorLeader(w, s) === 'player' && sectorTotal(w, s) > 0).length;
}

function halfCount(w: World): number {
  return SECTOR_IDS.filter((s) => sectorTotal(w, s) > 0 && w.player.dominion.power[s] / sectorTotal(w, s) >= 0.5).length;
}

export const LEVEL_REWARD = { perkPoints: 2, xp: 5000 };

/** Weekly: level-ups and challenge completion. */
export function empireWeekly(w: World): void {
  const p = playerCompany(w);
  if (!p || p.status !== 'active') return;
  const e = w.player.empire;
  const lvl = empireLevel(w);
  if (lvl > e.best) {
    e.best = lvl;
    const def = EMPIRE_LEVELS[lvl];
    celebrate(w, `Empire level ${lvl}: ${def.name}`, lvl >= 4);
    toast(w, `Empire level up: ${def.name}`, 'major', { category: 'studio', link: { route: 'empire' }, body: `${def.blurb} New challenges are waiting.` });
    pushNews(w, { kind: 'player', title: `${p.name} becomes a ${def.name.toLowerCase()}`, companyId: p.id, tone: 'good' });
  }
  for (const ch of EMPIRE_CHALLENGES) {
    if (ch.level > e.best || e.done.includes(ch.id)) continue;
    const [have, need] = ch.progress(w);
    if (have >= need) {
      e.done.push(ch.id);
      toast(w, `Empire challenge complete: ${ch.name}`, 'good', { category: 'goal', link: { route: 'empire' } });
    }
  }
  for (let l = 1; l <= e.best; l++) {
    if (e.cleared.includes(l)) continue;
    const list = EMPIRE_CHALLENGES.filter((c) => c.level === l);
    if (list.length && list.every((c) => e.done.includes(c.id))) {
      e.cleared.push(l);
      w.player.progression.perkPoints += LEVEL_REWARD.perkPoints;
      addXp(w, LEVEL_REWARD.xp);
      celebrate(w, `${EMPIRE_LEVELS[l].name} level cleared!`, true);
      toast(w, `Cleared ${EMPIRE_LEVELS[l].name}: +${LEVEL_REWARD.perkPoints} perk points, empire upkeep -10%`, 'good', { category: 'goal', link: { route: 'empire' } });
    }
  }
}

export function challengeState(w: World, id: string): 'done' | 'open' | 'locked' {
  const ch = EMPIRE_CHALLENGES.find((c) => c.id === id);
  if (!ch) return 'locked';
  if (w.player.empire.done.includes(id)) return 'done';
  return ch.level <= w.player.empire.best ? 'open' : 'locked';
}
