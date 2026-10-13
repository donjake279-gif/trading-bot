// The Game Awards: the industry's big night, every December.
// Nominations land in mid-November; for four weeks studios campaign for
// votes, you can predict Game of the Year and book a world-premiere slot for
// an upcoming game; then the ceremony crowns winners in 14 categories,
// including Studio of the Year and the infamous Golden Glitch. Winning sends
// sales and reputation through the roof.
import { SCOPE_IDS } from './constants';
import { bugDensity } from './development';
import { addXp } from './progression';
import { chance, pick, randNormal } from './rng';
import { comboGrade } from './topics';
import type { ActionResult, AwardCategory, AwardCategoryId, AwardNominee, AwardSeason, Company, Game, World } from './types';
import { celebrate, clamp, dayToDate, gamesOf, playerCompany, pushNews, spend, toast } from './util';

export const NOMINATIONS_DATE: [number, number] = [10, 18]; // Nov 18
export const CEREMONY_DATE: [number, number] = [11, 12]; // Dec 12

export const AWARD_CATEGORIES: Record<AwardCategoryId, { name: string; blurb: string; emoji: string }> = {
  goty: { name: 'Game of the Year', blurb: 'The biggest prize in games.', emoji: '🏆' },
  narrative: { name: 'Best Narrative', blurb: 'Stories that stay with you.', emoji: '📖' },
  art: { name: 'Best Art Direction', blurb: 'The most striking look of the year.', emoji: '🎨' },
  audio: { name: 'Best Score & Audio', blurb: 'Music and sound you can feel.', emoji: '🎵' },
  multiplayer: { name: 'Best Multiplayer', blurb: 'The best time with other people.', emoji: '🎮' },
  ongoing: { name: 'Best Ongoing Game', blurb: 'A live game that kept getting better.', emoji: '🔄' },
  indie: { name: 'Best Indie Game', blurb: 'Small teams, big ideas.', emoji: '🌱' },
  debut: { name: 'Best Debut', blurb: "A studio's very first release.", emoji: '✨' },
  mobile: { name: 'Best Mobile Game', blurb: 'The best game in your pocket.', emoji: '📱' },
  innovation: { name: 'Most Innovative', blurb: 'An idea nobody had tried before.', emoji: '💡' },
  family: { name: 'Best Family Game', blurb: 'Fun for everyone on the couch.', emoji: '👨‍👩‍👧' },
  players: { name: "Players' Voice", blurb: 'Voted by millions of players.', emoji: '📣' },
  glitch: { name: 'The Golden Glitch', blurb: 'For outstanding achievement in bugs. Nobody wants this one.', emoji: '🐛' },
  studio: { name: 'Studio of the Year', blurb: 'The studio that defined the year.', emoji: '🏢' },
};

export const AWARD_ORDER: AwardCategoryId[] = ['glitch', 'debut', 'family', 'mobile', 'audio', 'art', 'narrative', 'innovation', 'indie', 'multiplayer', 'ongoing', 'players', 'studio', 'goty'];

export const CAMPAIGN_TIERS = [
  { name: 'Trade ads', points: 2, cost: 25000 },
  { name: 'Screening tour', points: 4, cost: 150000 },
  { name: 'Global "For Your Consideration" blitz', points: 7, cost: 1000000 },
];
export const MAX_CAMPAIGN = 7;
export const PREMIERE_COST = 75000;

const HIGHLIGHTS = [
  'The orchestra started playing a winner off the stage before they reached the microphone.',
  'A winner thanked their cat for a full four minutes. The crowd loved it.',
  'Someone in the audience shouted "Release the sequel!" and got a standing ovation.',
  'The host tripped over a cable and turned it into the best bit of the night.',
  'A surprise world premiere crashed the venue Wi-Fi for ten minutes.',
  'Two rival CEOs were seated next to each other. Neither blinked all night.',
  'An acceptance speech was delivered entirely in the voice of a game character.',
  'A legendary composer played a medley of the nominees live on stage.',
  'The kid who won the cosplay contest got to hand out an award.',
];

function onDate(day: number, md: [number, number]): boolean {
  const d = dayToDate(day);
  return d.getUTCMonth() === md[0] && d.getUTCDate() === md[1];
}

function nominationsDayOf(day: number): number {
  for (let d = day; d < day + 370; d++) if (onDate(d, NOMINATIONS_DATE)) return d;
  return day + 365;
}

/** Day the current eligibility window opened (the day after last year's nominations). */
export function eligibilityStart(w: World): number {
  const last = w.awardArchive[w.awardArchive.length - 1];
  if (last) return last.nominationsDay + 1;
  return nominationsDayOf(w.day) - 365;
}

function eligibleGames(w: World, start: number, end: number): Game[] {
  return Object.values(w.games).filter((g) => g.releaseDay !== null && g.releaseDay >= start && g.releaseDay <= end && g.status !== 'cancelled');
}

function focusShare(g: Game, d: keyof Game['points']): number {
  let t = 0;
  for (const k in g.points) t += g.points[k as keyof Game['points']];
  return t > 0 ? g.points[d] / t : 0;
}

const reach = (g: Game) => Math.log10(10 + Math.max(g.peakActive, g.active));

/** Candidate scores for every category, from the games and studios of the season. */
export function scoreCategories(w: World, start: number, end: number): Record<AwardCategoryId, AwardNominee[]> {
  const games = eligibleGames(w, start, end);
  const nom = (g: Game, score: number): AwardNominee => ({ id: g.id, title: g.title, companyId: g.companyId, score });
  const out = {} as Record<AwardCategoryId, AwardNominee[]>;
  const big = games.filter((g) => SCOPE_IDS.indexOf(g.scope) >= 2);
  out.goty = (big.length >= 3 ? big : games).map((g) => nom(g, g.criticScore + SCOPE_IDS.indexOf(g.scope) * 2 + reach(g) * 1.5));
  out.narrative = games
    .filter((g) => focusShare(g, 'story') >= 0.1)
    .map((g) => nom(g, g.criticScore * 0.75 + 70 * focusShare(g, 'story') + (['rpg', 'openWorld', 'horror', 'indie'].includes(g.genre) ? 3 : 0)));
  out.art = games.map((g) => nom(g, g.criticScore * 0.75 + 60 * focusShare(g, 'graphics') + (['stylized', 'handDrawn', 'anime', 'photoreal'].includes(g.artStyle) ? 3 : 0)));
  out.audio = games.filter((g) => focusShare(g, 'audio') >= 0.07).map((g) => nom(g, g.criticScore * 0.75 + 80 * focusShare(g, 'audio')));
  out.multiplayer = games.filter((g) => (g.multiplayer === 'online' || g.multiplayer === 'massive') && SCOPE_IDS.indexOf(g.scope) >= 1).map((g) => nom(g, g.criticScore + reach(g) * 3));
  out.indie = games.filter((g) => SCOPE_IDS.indexOf(g.scope) <= 2 && (w.companies[g.companyId]?.headcount ?? 0) < 60).map((g) => nom(g, g.criticScore + reach(g)));
  out.mobile = games.filter((g) => g.platforms.includes('mobile')).map((g) => nom(g, g.criticScore + reach(g) * 1.5));
  out.innovation = games
    .filter((g) => g.topic && ['great', 'legendary'].includes(comboGrade(g.genre, g.topic)))
    .map((g) => nom(g, g.criticScore + (comboGrade(g.genre, g.topic) === 'legendary' ? 12 : 4)));
  out.family = games.filter((g) => g.audience === 'kids' || g.audience === 'everyone').map((g) => nom(g, g.criticScore * 0.8 + g.userScore * 0.2));
  out.players = games.filter((g) => g.owners > 1000).map((g) => nom(g, (g.userScore * reach(g)) / 4));
  out.glitch = games.filter((g) => g.owners >= 5000 && bugDensity(g) >= 2).map((g) => nom(g, bugDensity(g) * 5 + Math.log10(g.owners)));
  // debut: the studio's first ever release
  out.debut = games
    .filter((g) => !gamesOf(w, g.companyId).some((o) => o.id !== g.id && o.releaseDay !== null && o.releaseDay < g.releaseDay!))
    .map((g) => nom(g, g.criticScore + reach(g)));
  // ongoing: older games that kept shipping updates this season
  out.ongoing = Object.values(w.games)
    .filter((g) => g.status === 'released' && g.releaseDay !== null && g.releaseDay < start)
    .map((g) => ({ g, n: g.updates.filter((u) => u.day >= start && u.day <= end).length }))
    .filter((x) => x.n >= 2 && x.g.active > 1000)
    .map(({ g, n }) => nom(g, g.userScore + 3 * Math.min(6, n) + reach(g) * 2));
  // studio of the year
  const byStudio = new Map<string, Game[]>();
  for (const g of games) {
    const list = byStudio.get(g.companyId) ?? [];
    list.push(g);
    byStudio.set(g.companyId, list);
  }
  out.studio = [...byStudio.entries()]
    .filter(([id]) => w.companies[id]?.status === 'active')
    .map(([id, list]) => {
      const c = w.companies[id];
      const avg = list.reduce((s, g) => s + g.criticScore, 0) / list.length;
      const best = Math.max(...list.map((g) => g.criticScore));
      return { id, title: c.name, companyId: id, score: avg * 0.5 + best * 0.5 + Math.min(4, list.length) * 2 + Math.log10(10 + c.rev30) };
    });
  for (const k of Object.keys(out) as AwardCategoryId[]) out[k].sort((a, b) => b.score - a.score);
  return out;
}

// ------------------------------------------------------------ the season

/** Nov 18: announce nominees. */
export function announceNominations(w: World): void {
  const start = eligibilityStart(w);
  const scored = scoreCategories(w, start, w.day);
  const categories: AwardCategory[] = [];
  for (const id of AWARD_ORDER) {
    // at most two nominees per studio in a category, like the real thing
    const perStudio = new Map<string, number>();
    const list: AwardNominee[] = [];
    for (const n of scored[id]) {
      if (list.length >= 5) break;
      const k = perStudio.get(n.companyId) ?? 0;
      if (id !== 'studio' && k >= 2) continue;
      perStudio.set(n.companyId, k + 1);
      list.push(n);
    }
    const min = id === 'goty' ? 3 : 2;
    if (list.length < min) continue;
    categories.push({ id, nominees: list, winnerId: null });
  }
  if (!categories.some((c) => c.id === 'goty')) return;
  const p = playerCompany(w);
  const season: AwardSeason = {
    year: dayToDate(w.day).getUTCFullYear(),
    nominationsDay: w.day,
    ceremonyDay: nextCeremony(w.day),
    categories,
    campaigns: {},
    prediction: null,
    presenter: !!p && p.reputation >= 40 && chance(w, 0.6),
    premiere: null,
    done: false,
    watched: false,
    highlights: [],
  };
  w.awardSeason = season;
  // a nomination alone puts a game in the spotlight
  const nominated = new Set<string>();
  for (const c of categories) for (const n of c.nominees) if (c.id !== 'studio' && c.id !== 'glitch') nominated.add(n.id);
  for (const id of nominated) {
    const g = w.games[id];
    if (!g) continue;
    g.hype = Math.min(1400, g.hype + 30);
    if (g.status === 'released') {
      g.viralMult = Math.max(g.viralMult, 1.1);
      g.viralUntil = Math.max(g.viralUntil, w.day + 25);
    }
  }
  const gotyNoms = categories.find((c) => c.id === 'goty')!.nominees;
  pushNews(w, { kind: 'awards', title: `The ${season.year} Game Awards nominees are in`, body: `Game of the Year: ${gotyNoms.map((n) => n.title).join(', ')}.`, tone: 'major' });
  if (!p) return;
  const mine = playerNominations(w, season);
  if (mine.length) {
    addXp(w, 25 * mine.length);
    celebrate(w, `${mine.length} nomination${mine.length > 1 ? 's' : ''}!`);
    toast(w, `Your studio earned ${mine.length} Game Awards nomination${mine.length > 1 ? 's' : ''}!`, 'major', {
      category: 'game',
      link: { route: 'awards' },
      body: `${[...new Set(mine.map((m) => AWARD_CATEGORIES[m.category].name))].slice(0, 3).join(', ')}${mine.length > 3 ? ' and more' : ''}. Campaign for votes before the ceremony on ${dayToDate(season.ceremonyDay).toUTCString().slice(5, 11)}.`,
    });
  } else {
    toast(w, 'The Game Awards nominations are out', 'neutral', { category: 'industry', link: { route: 'awards' }, body: 'Pick your Game of the Year to win XP. Next year, it could be you.' });
  }
  if (season.presenter) toast(w, "You've been invited to present an award on stage", 'good', { category: 'industry', link: { route: 'awards' }, body: 'A great look for your studio: +2 reputation on the night.' });
}

function nextCeremony(day: number): number {
  for (let d = day; d < day + 370; d++) if (onDate(d, CEREMONY_DATE)) return d;
  return day + 30;
}

export function playerNominations(w: World, season: AwardSeason | null = w.awardSeason): { category: AwardCategoryId; id: string }[] {
  if (!season) return [];
  const pid = w.player.companyId;
  const out: { category: AwardCategoryId; id: string }[] = [];
  for (const c of season.categories) for (const n of c.nominees) if (n.companyId === pid) out.push({ category: c.id, id: n.id });
  return out;
}

export function seasonOpen(w: World): boolean {
  const s = w.awardSeason;
  return !!s && !s.done && w.day < s.ceremonyDay;
}

export function campaignBlocker(w: World, gameId: string, tier: number): string | null {
  const s = w.awardSeason;
  const t = CAMPAIGN_TIERS[tier];
  if (!s || !seasonOpen(w)) return 'Campaigns run between nominations and the ceremony.';
  if (!t) return 'Unknown campaign.';
  if (!playerNominations(w).some((n) => n.id === gameId && n.category !== 'glitch' && n.category !== 'studio')) return 'Only your nominated games can campaign.';
  const have = s.campaigns[gameId] ?? 0;
  if (have >= MAX_CAMPAIGN) return 'This campaign is already at full strength.';
  if (playerCompany(w).cash < t.cost) return `Costs $${t.cost.toLocaleString()}.`;
  return null;
}

export function runAwardCampaign(w: World, gameId: string, tier: number): ActionResult {
  const blocker = campaignBlocker(w, gameId, tier);
  if (blocker) return { ok: false, error: blocker };
  const t = CAMPAIGN_TIERS[tier];
  const s = w.awardSeason!;
  spend(playerCompany(w), 'marketing', t.cost);
  s.campaigns[gameId] = Math.min(MAX_CAMPAIGN, (s.campaigns[gameId] ?? 0) + t.points);
  const g = w.games[gameId];
  if (g) g.hype = Math.min(1400, g.hype + t.points * 6);
  return { ok: true };
}

export function predictGoty(w: World, gameId: string): ActionResult {
  const s = w.awardSeason;
  if (!s || !seasonOpen(w)) return { ok: false, error: 'Predictions are open between nominations and the ceremony.' };
  if (!s.categories.find((c) => c.id === 'goty')?.nominees.some((n) => n.id === gameId)) return { ok: false, error: 'Pick one of the nominees.' };
  s.prediction = gameId;
  return { ok: true };
}

export function premiereCandidates(w: World): Game[] {
  return gamesOf(w, w.player.companyId).filter((g) => g.status === 'development');
}

export function bookPremiere(w: World, gameId: string): ActionResult {
  const s = w.awardSeason;
  if (!s || !seasonOpen(w)) return { ok: false, error: 'World premieres are booked between nominations and the ceremony.' };
  if (s.premiere) return { ok: false, error: 'You already booked a premiere.' };
  const g = w.games[gameId];
  if (!g || g.companyId !== w.player.companyId || g.status !== 'development') return { ok: false, error: 'Pick one of your games in development.' };
  if (playerCompany(w).cash < PREMIERE_COST) return { ok: false, error: `Costs $${PREMIERE_COST.toLocaleString()}.` };
  spend(playerCompany(w), 'marketing', PREMIERE_COST);
  s.premiere = gameId;
  return { ok: true };
}

export function markCeremonyWatched(w: World): ActionResult {
  if (w.awardSeason) w.awardSeason.watched = true;
  return { ok: true };
}

/** AI studios run their own campaigns, quietly. */
function aiCampaign(c: Company | undefined): number {
  if (!c || c.isPlayer) return 0;
  return c.cash > 50e6 ? 2 : c.cash > 5e6 ? 1 : 0;
}

/** Dec 12: the ceremony. */
export function holdCeremony(w: World): void {
  const s = w.awardSeason;
  if (!s || s.done) return;
  const p = playerCompany(w);
  const pid = w.player.companyId;
  let playerWins = 0;
  const lines: string[] = [];
  for (const cat of s.categories) {
    let best: AwardNominee | null = null;
    let bestScore = -Infinity;
    for (const n of cat.nominees) {
      const campaign = cat.id === 'glitch' || cat.id === 'studio' ? 0 : n.companyId === pid ? (s.campaigns[n.id] ?? 0) : aiCampaign(w.companies[n.companyId]);
      const score = n.score + campaign + randNormal(w, 0, 2.5);
      if (score > bestScore) {
        best = n;
        bestScore = score;
      }
    }
    if (!best) continue;
    cat.winnerId = best.id;
    const def = AWARD_CATEGORIES[cat.id];
    const c = w.companies[best.companyId];
    lines.push(`${def.name}: ${best.title}`);
    w.awardsHistory.push({ year: s.year, category: def.name, gameId: cat.id === 'studio' ? '' : best.id, title: best.title, companyId: best.companyId });
    if (cat.id === 'studio') {
      if (c) {
        c.reputation = clamp(c.reputation + 6, 0, 100);
        if (c.isPublic) c.price *= 1.06;
      }
    } else {
      const g = w.games[best.id];
      if (g) {
        g.awards.push(`${def.name} ${s.year}`);
        if (cat.id === 'glitch') {
          g.viralMult = Math.max(g.viralMult, 1.2);
          g.viralUntil = Math.max(g.viralUntil, w.day + 14);
          if (c) c.reputation = clamp(c.reputation - 1, 0, 100);
        } else {
          const goty = cat.id === 'goty';
          g.hype = Math.min(1400, g.hype + (goty ? 300 : 120));
          g.viralMult = Math.max(g.viralMult, goty ? 1.8 : 1.4);
          g.viralUntil = Math.max(g.viralUntil, w.day + (goty ? 45 : 21));
          g.goodwill += goty ? 4 : 2;
          if (c) c.reputation = clamp(c.reputation + (goty ? 8 : 3), 0, 100);
        }
      }
    }
    // everyone else gets the honour of the nomination
    for (const n of cat.nominees) {
      if (n.id === best.id || cat.id === 'glitch') continue;
      const nc = w.companies[n.companyId];
      if (nc) nc.reputation = clamp(nc.reputation + 0.5, 0, 100);
    }
    if (best.companyId === pid) {
      if (cat.id === 'glitch') {
        addXp(w, 60);
        toast(w, `${best.title} "wins" the Golden Glitch`, 'neutral', { category: 'game', link: { route: 'awards' }, body: 'The internet will never let you forget it. At least people are talking about your game.' });
      } else {
        playerWins++;
        addXp(w, cat.id === 'goty' ? 500 : cat.id === 'studio' ? 300 : 150);
        celebrate(w, `${def.name}!`, cat.id === 'goty' || cat.id === 'studio');
        toast(w, `${best.title} wins ${def.name}!`, 'good', { category: 'game', link: { route: 'awards' }, body: cat.id === 'goty' ? 'The biggest prize in games. Sales are about to explode.' : undefined });
      }
    }
  }
  if (p) {
    if (playerWins > 0) for (const e of w.player.employees) e.morale = Math.min(100, e.morale + 8 + 2 * playerWins);
    const goty = s.categories.find((c) => c.id === 'goty');
    if (s.prediction && goty?.winnerId) {
      if (s.prediction === goty.winnerId) {
        addXp(w, 120);
        w.player.flags.oracle = (w.player.flags.oracle ?? 0) + 1;
        toast(w, 'You called it! Your Game of the Year pick won', 'good', { category: 'goal', link: { route: 'awards' }, body: '+120 XP for your industry instincts.' });
      } else {
        toast(w, 'Your Game of the Year pick did not win', 'neutral', { category: 'goal', link: { route: 'awards' }, silent: true });
      }
    }
    if (s.presenter) p.reputation = clamp(p.reputation + 2, 0, 100);
    if (s.premiere) {
      const g = w.games[s.premiere];
      if (g && g.status === 'development') {
        g.hype = Math.min(1400, g.hype + 150 * (1 + p.reputation / 100));
        toast(w, `The world premiere of ${g.title} stole the show`, 'good', { category: 'game', link: { route: 'game', id: g.id }, body: 'Hype is through the roof.' });
      }
    }
  }
  s.highlights = [pick(w, HIGHLIGHTS), pick(w, HIGHLIGHTS)].filter((x, i, a) => a.indexOf(x) === i);
  s.done = true;
  const gotyWinner = s.categories.find((c) => c.id === 'goty')?.nominees.find((n) => n.id === s.categories.find((c) => c.id === 'goty')?.winnerId);
  pushNews(w, { kind: 'awards', title: `${gotyWinner?.title ?? 'A surprise'} wins Game of the Year at The ${s.year} Game Awards`, body: lines.join(' · '), tone: 'major', gameId: gotyWinner?.id });
  toast(w, `The ${s.year} Game Awards are over: watch the ceremony`, playerWins ? 'good' : 'major', {
    category: 'industry',
    link: { route: 'awards' },
    body: playerWins ? `Your studio took home ${playerWins} award${playerWins > 1 ? 's' : ''}!` : `${gotyWinner?.title ?? 'A rival'} won Game of the Year.`,
  });
  w.awardArchive.push(s);
  if (w.awardArchive.length > 40) w.awardArchive.shift();
}

/** Daily hook: nominations in November, the ceremony in December. */
export function awardsDaily(w: World): void {
  if (onDate(w.day, NOMINATIONS_DATE)) announceNominations(w);
  const s = w.awardSeason;
  if (s && !s.done && w.day >= s.ceremonyDay) holdCeremony(w);
}

/** Trophies won by the player's studio, newest first. */
export function playerTrophies(w: World): { year: number; category: string; title: string; gameId: string }[] {
  return w.awardsHistory.filter((a) => a.companyId === w.player.companyId && a.category !== AWARD_CATEGORIES.glitch.name).reverse();
}
