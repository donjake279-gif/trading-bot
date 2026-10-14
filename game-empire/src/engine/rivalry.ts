// Rival bosses. Your rival studio is run by a CEO with a personality: they
// talk trash, copy your hits, move their launches to clash with yours, and
// gloat when they pull ahead. Overtake them and you earn a reward and a
// bigger rival.
import { GENRES, xpForLevel } from './constants';
import { startCloneProject } from './ai';
import { releaseGame } from './development';
import { addXp } from './progression';
import type { Company, Game, World } from './types';
import { activeCompanies, celebrate, gamesOf, hashString, playerCompany, pushNews, toast } from './util';
import { chance, pick } from './rng';

export type PersonaId = 'showboat' | 'copycat' | 'shark' | 'grump' | 'sport';
export const PERSONA_IDS: PersonaId[] = ['showboat', 'copycat', 'shark', 'grump', 'sport'];

export const PERSONAS: Record<PersonaId, { name: string; emoji: string; blurb: string }> = {
  showboat: { name: 'The Showboat', emoji: '🎤', blurb: 'Loves a microphone. Every one of their games is the greatest of all time.' },
  copycat: { name: 'The Copycat', emoji: '🐒', blurb: 'If your game is a hit, theirs is coming next. Same idea, new logo.' },
  shark: { name: 'The Shark', emoji: '🦈', blurb: 'Ruthless. Moves their launches to steal your thunder.' },
  grump: { name: 'The Grump', emoji: '😤', blurb: 'Nothing you make is good enough, and they will tell everyone.' },
  sport: { name: 'The Good Sport', emoji: '🤝', blurb: 'A friendly rival who still really wants to win.' },
};

type Moment = 'intro' | 'yourHit' | 'yourMid' | 'yourFlop' | 'theirHit' | 'overtaken' | 'theyPass' | 'jabBehind' | 'jabAhead' | 'clone' | 'clash' | 'defeated';

const LINES: Record<PersonaId, Partial<Record<Moment, string[]>>> = {
  showboat: {
    intro: ['Heard of {you}? Me neither. Let’s change that: I’ll beat them in public.', '{you} wants to be the next big thing. Cute. There can only be one.'],
    yourHit: ['Nice little game, {you}. Ours will be bigger.', '{game} is good. For a {you} game.'],
    yourMid: ['{game} is fine. Fine is a word.', '{game}: a solid seven. On a good day.'],
    yourFlop: ['{game}? Bold of {you} to call that a game.', 'We would never ship something like {game}. Just saying.'],
    theirHit: ['{their} is the best game ever made. You’re welcome, world.', '{score} for {their}. Somebody frame that.'],
    overtaken: ['Valuations are just numbers. Our hearts are bigger.', 'Enjoy it, {you}. The comeback tour starts now.'],
    theyPass: ['Number one! Did anyone see {you} back there?', 'Top of the mountain. The view is lovely, {you}.'],
    jabBehind: ['{you} is cute. Like a tiny indie version of us.', 'I’d mention {you} in my keynote, but I ran out of time.'],
    jabAhead: ['Size isn’t everything, {you}. Talent is. We have the talent.', 'Big studio, small ideas. That’s {you}.'],
    clash: ['We moved {their} up. The fans deserve the best game that week.'],
    defeated: ['This isn’t over. I’ll be back with a bigger studio.'],
  },
  copycat: {
    intro: ['{you} seems to know what players want. We’ll be watching. Closely.', 'Big fan of {you}. Huge fan. We study everything they do.'],
    yourHit: ['{game}? Interesting idea. Very interesting. No reason.', 'Taking notes on {game}. For a friend.'],
    yourFlop: ['Glad we didn’t copy that one.', 'Note to self: don’t do whatever {you} just did.'],
    theirHit: ['{their}: totally original, {score} from critics.', '{score} for {their}. Nobody can prove where the idea came from.'],
    overtaken: ['We’ll copy your business plan next, {you}.', 'Fine. We’ll study how you did that.'],
    theyPass: ['Turns out copying works.', 'Thanks for the inspiration, {you}.'],
    jabBehind: ['{you} keeps making our next game for us.', 'What’s {you} working on? Asking for a roadmap.'],
    jabAhead: ['We’re studying your every move, {you}.', 'Every hit {you} makes is a free idea for us.'],
    clone: ['{their} is a completely original idea and any resemblance to {game} is a coincidence.', 'Introducing {their}. Not like {game} at all. Well, a bit.'],
    defeated: ['We’ll copy that ending into our next game.'],
  },
  shark: {
    intro: ['{you} is in our way. Not for long.', 'Nice studio, {you}. Shame if someone outsold it.'],
    yourHit: ['Enjoy the spotlight, {you}. It won’t last.', 'Good scores don’t pay the bills forever.'],
    yourFlop: ['Blood in the water. {you}’s players are welcome at our place.', 'Thanks for the free customers, {you}.'],
    theirHit: ['{their} just hit {score}. Your move, {you}.', '{score}. That’s what winning looks like.'],
    overtaken: ['Enjoy the view from the top, {you}. We’re coming.', 'Big companies fall harder.'],
    theyPass: ['That’s the top spot taken. Don’t get comfortable at number two, {you}.', 'Ate your lunch, {you}. Dinner’s next.'],
    jabBehind: ['We could buy {you} with our couch-cushion money.', '{you} is a snack.'],
    jabAhead: ['Big companies fall harder, {you}.', 'We smell weakness at {you}.'],
    clash: ['We moved {their} up to launch against {game}. Nothing personal. Okay, a little personal.', 'Launch week is ours now, {you}.'],
    defeated: ['You got lucky. Sharks don’t forget.'],
  },
  grump: {
    intro: ['{you}? Never heard of them. Overrated already.', 'Another studio that thinks it’s special. Wake me when {you} ships something good.'],
    yourHit: ['The critics have gone soft.', '{game}? Overrated. I said what I said.'],
    yourMid: ['Mediocre. Next.', '{game}: exactly as average as I predicted.'],
    yourFlop: ['Exactly what I expected from {you}.', 'I give {game} a zero. Out of a hundred.'],
    theirHit: ['{score}? Should have been higher.', 'Of course {their} is great. We made it.'],
    overtaken: ['Lucky. Pure luck.', 'The market is broken. {you} proves it.'],
    theyPass: ['Finally, the market makes sense.', 'Took everyone long enough to notice we’re better than {you}.'],
    jabBehind: ['{you} is all marketing, no game.', 'I tried a {you} game once. Never again.'],
    jabAhead: ['Bigger, not better, {you}.', 'Money can’t buy taste. Ask {you}.'],
    defeated: ['Good riddance to this whole industry.'],
  },
  sport: {
    intro: ['Hey {you}! Let’s have a good, clean rivalry.', 'Excited to compete with {you}. May the best game win!'],
    yourHit: ['Okay, {game} is genuinely great. Congrats, {you}!', 'Hats off for {game}. Now we have to try harder.'],
    yourFlop: ['Rough launch. Happens to the best of us, {you}.', 'Tough one. {you} will bounce back, they always do.'],
    theirHit: ['Proud of the team for {their}! Your move, {you}.', '{score} for {their}! Bring it on, {you}.'],
    overtaken: ['Well played, {you}. Well played.', 'You earned it, {you}. Rematch?'],
    theyPass: ['Sorry {you}, we’re ahead now! For now.', 'Good game, {you}. We’re on top this round.'],
    jabBehind: ['Keep going {you}, you’ll catch us one day. Maybe.', 'Love what {you} is doing. Still beating them, though.'],
    jabAhead: ['You’re ahead for now, {you}! Game on.', 'Chasing {you} keeps us sharp.'],
    defeated: ['It was an honour, {you}. Truly.'],
  },
};

/** Reward for overtaking your rival (plus +3 reputation): most of a level, whatever your level. */
export function overtakeXp(w: World): number {
  return Math.max(150, Math.round(xpForLevel(w.player.progression?.level ?? 1) * 0.6));
}

/** Rivals are picked this much bigger than you, so beating one takes real growth. */
const RIVAL_GAP = 1.5;

/** Overtaking means staying worth more for this many weekly checks in a row: a launch spike isn't enough. */
export const HOLD_WEEKS = 4;

export function personaOf(c: Company): PersonaId {
  return PERSONA_IDS[(hashString(`persona:${c.id}`) >>> 0) % PERSONA_IDS.length];
}

export function nemesis(w: World): Company | null {
  const id = w.player.rivalId;
  const c = id ? w.companies[id] : null;
  return c && c.status === 'active' && c.parentId !== w.player.companyId ? c : null;
}

export function rivalRecord(w: World, id: string): { won: number; lost: number } {
  return w.player.rivalry?.records[id] ?? { won: 0, lost: 0 };
}

function fill(text: string, v: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (_, k) => String(v[k] ?? ''));
}

/** Say something in character; logged, in the news, and optionally a toast. Returns the full line. */
function speak(w: World, c: Company, moment: Moment, vars: Record<string, string | number>, show = true): string | null {
  const options = LINES[personaOf(c)][moment];
  if (!options?.length) return null;
  const p = playerCompany(w);
  const text = fill(pick(w, options), { you: p.name, ...vars });
  const r = w.player.rivalry;
  r.quotes.unshift({ day: w.day, companyId: c.id, text });
  if (r.quotes.length > 12) r.quotes.length = 12;
  pushNews(w, { kind: 'industry', title: `${c.ceo} (${c.name}): “${text}”`, companyId: c.id, tone: 'neutral' });
  if (show) toast(w, `${PERSONAS[personaOf(c)].emoji} ${c.ceo}: “${text}”`, 'neutral', { category: 'industry', link: { route: 'company', id: c.id }, body: `CEO of ${c.name}, your rival.` });
  return `${c.ceo}, ${c.name}: “${text}”`;
}

function latestRelease(w: World, companyId: string, within = 180): Game | null {
  let best: Game | null = null;
  for (const g of gamesOf(w, companyId)) {
    if (g.releaseDay === null || g.status === 'cancelled' || w.day - g.releaseDay > within) continue;
    if (!best || g.releaseDay > (best.releaseDay ?? 0)) best = g;
  }
  return best;
}

function record(w: World, id: string, won: boolean): void {
  const r = w.player.rivalry;
  const rec = (r.records[id] ??= { won: 0, lost: 0 });
  if (won) rec.won += 1;
  else rec.lost += 1;
}

const CLONE_NAMES = ['Super {t}', '{t} Rivals', 'Not {t}', '{t}: Totally Different', '{t} Legends', 'Mega {t}', '{t} Deluxe Remix'];

/** Your rival reacts to your launch. Returns their line for the launch reveal. */
export function rivalReactToLaunch(w: World, g: Game): string | null {
  const c = nemesis(w);
  if (!c || !w.player.rivalry) return null;
  // head to head: your launch against their latest release
  const theirs = latestRelease(w, c.id);
  if (theirs && theirs.criticScore !== g.criticScore) record(w, c.id, g.criticScore > theirs.criticScore);
  const persona = personaOf(c);
  const hit = g.criticScore >= 85 || g.breakout > 1;

  // the shark (and sometimes others) ships a nearly-done game today to clash with yours,
  // unpolished: the gamble costs them quality
  if (persona === 'shark' || chance(w, 0.2)) {
    const rush = gamesOf(w, c.id).find((x) => x.status === 'development' && x.genre === g.genre && x.workDone >= x.workRequired * 0.8);
    if (rush) {
      releaseGame(w, rush);
      toast(w, `${c.name} rushed ${rush.title} out to clash with ${g.title}`, 'bad', { category: 'industry', link: { route: 'game', id: rush.id }, body: `Same genre, same day, ${rush.criticScore}/100. Marketing or a quick update keeps your players with you.` });
      speak(w, c, 'clash', { their: rush.title, game: g.title }, false);
    }
  }

  // the copycat (and sometimes others) clones your hit
  if (hit && (persona === 'copycat' || chance(w, 0.15))) {
    const base = g.title.split(':')[0].trim();
    const title = pick(w, CLONE_NAMES).replace('{t}', base);
    const clone = startCloneProject(w, c, g, title);
    if (clone) {
      toast(w, `${c.name} announces ${clone.title}. It looks… familiar.`, 'bad', { category: 'industry', link: { route: 'company', id: c.id }, body: `A ${GENRES[g.genre].name} game about the same thing as ${g.title}.` });
      speak(w, c, 'clone', { their: clone.title, game: g.title }, false);
    }
  }

  const moment = hit ? 'yourHit' : g.criticScore < 55 ? 'yourFlop' : 'yourMid';
  return speak(w, c, moment, { game: g.title }, false);
}

/**
 * Pick a rival: the closest studio worth at least half as much again as you,
 * else the closest bigger one, else the closest one if nobody is bigger.
 */
function chooseNemesis(w: World, exclude: Set<string>): Company | null {
  const p = playerCompany(w);
  const mine = Math.max(1, p.valuation);
  let target: Company | null = null;
  let targetRatio = Infinity;
  let bigger: Company | null = null;
  let biggerRatio = Infinity;
  let closest: Company | null = null;
  let closestGap = Infinity;
  for (const c of activeCompanies(w)) {
    if (c.isPlayer || c.parentId === p.id || exclude.has(c.id)) continue;
    const ratio = Math.max(1, c.valuation) / mine;
    if (ratio >= RIVAL_GAP && ratio < targetRatio) {
      target = c;
      targetRatio = ratio;
    }
    if (ratio > 1 && ratio < biggerRatio) {
      bigger = c;
      biggerRatio = ratio;
    }
    const gap = Math.abs(Math.log(ratio));
    if (gap < closestGap) {
      closest = c;
      closestGap = gap;
    }
  }
  return target ?? bigger ?? closest;
}

function setNemesis(w: World, c: Company, announce: boolean): void {
  w.player.rivalId = c.id;
  const p = playerCompany(w);
  w.player.rivalry.ahead = p.valuation > c.valuation;
  w.player.rivalry.leadWeeks = 0;
  if (!announce) return;
  const persona = PERSONAS[personaOf(c)];
  toast(w, `New rival: ${c.ceo} of ${c.name}`, 'neutral', { category: 'industry', link: { route: 'company', id: c.id }, body: `${persona.emoji} ${persona.name}. ${persona.blurb}` });
  speak(w, c, 'intro', {}, false);
}

/** A new company's first rival, picked quietly. */
export function initNemesis(w: World): void {
  const c = chooseNemesis(w, new Set());
  if (c) setNemesis(w, c, false);
}

/** Monthly: make sure there is a rival. Rivals stick until you beat them. */
export function ensureNemesis(w: World): void {
  if (!w.player.rivalry) return;
  if (nemesis(w)) return;
  const old = w.player.rivalId ? w.companies[w.player.rivalId] : null;
  if (old) {
    // the old rival went bust or was bought: that counts as a win
    if (!w.player.rivalry.beaten.includes(old.id)) w.player.rivalry.beaten.push(old.id);
    const xp = overtakeXp(w);
    celebrate(w, `${old.name} is gone. Rival defeated!`, true);
    speak(w, old, 'defeated', {}, true);
    addXp(w, xp);
  }
  const next = chooseNemesis(w, new Set(w.player.rivalry.beaten));
  if (next) setNemesis(w, next, true);
}

/** Daily: their launches, the race for value, and the odd jab. */
export function rivalryDaily(w: World): void {
  const r = w.player.rivalry;
  const c = nemesis(w);
  if (!r || !c) return;
  const p = playerCompany(w);

  // their launches today
  for (const g of gamesOf(w, c.id)) {
    if (g.releaseDay !== w.day || g.status !== 'released') continue;
    const yours = latestRelease(w, p.id);
    if (yours && yours.criticScore !== g.criticScore) record(w, c.id, yours.criticScore > g.criticScore);
    if (g.criticScore >= 85) speak(w, c, 'theirHit', { their: g.title, score: g.criticScore });
  }

  if (w.day % 7 !== 0) return;
  // the race: who is worth more, week after week?
  const ahead = p.valuation > c.valuation;
  r.leadWeeks = ahead ? (r.leadWeeks ?? 0) + 1 : 0;
  if (ahead && !r.ahead) {
    if (r.leadWeeks === 1) {
      toast(w, `You're worth more than ${c.name}`, 'good', { category: 'industry', link: { route: 'company', id: c.id }, body: `Hold the lead for ${HOLD_WEEKS} weeks in a row to beat them.` });
    }
    if (r.leadWeeks < HOLD_WEEKS) return;
    r.ahead = true;
    if (!r.beaten.includes(c.id)) r.beaten.push(c.id);
    p.reputation = Math.min(100, p.reputation + 3);
    const xp = overtakeXp(w);
    addXp(w, xp);
    celebrate(w, `You overtook ${c.name}!`, true);
    speak(w, c, 'overtaken', {});
    toast(w, `Rival beaten: ${c.name} (+3 reputation, +${xp.toLocaleString()} XP)`, 'good', { category: 'industry', link: { route: 'company', id: c.id } });
    // a bigger fish, if there is one
    const next = chooseNemesis(w, new Set(r.beaten));
    if (next && next.valuation > p.valuation) setNemesis(w, next, true);
    return;
  }
  if (!ahead && r.ahead) {
    r.ahead = false;
    speak(w, c, 'theyPass', {});
    return;
  }
  // now and then, a jab
  if (w.day - r.lastTauntDay >= 45 && chance(w, 0.12)) {
    r.lastTauntDay = w.day;
    speak(w, c, ahead ? 'jabAhead' : 'jabBehind', {});
  }
}
