// "What players are saying": short, mostly silly player reviews generated
// from what is actually true about a game (score, bugs, monetization, mode,
// topic, servers). Deterministic per game so they don't flicker.
import { GENRES, MONETIZATIONS, TOPICS } from './constants';
import { bugDensity } from './development';
import { legendaryCombo } from './topics';
import type { Game, World } from './types';
import { hashString } from './util';

export interface PlayerReview {
  text: string;
  recommended: boolean;
  hours: number;
  helpful: number;
}

const POSITIVE = [
  'Called in sick to play this. Called in sick the next day too.',
  'My partner asked me to choose between them and {title}. I miss them sometimes.',
  '10/10, would lose an entire weekend again.',
  'I bought it on sale and now I feel like I owe the developers money.',
  'The first game in years that made me forget to check my phone.',
  'Finished it, immediately started a new save. Send help.',
  'Came for the {genre}, stayed for literally everything else.',
  'My cat sits on my lap only when I play this. Even she approves.',
];
const MIXED_YES = [
  'Fun for about 6 hours, then fun again after a nap.',
  "It's good. Not life-changing good. Sandwich good.",
  'Solid {genre}. Would recommend to a friend I like a normal amount.',
];
const MIXED_NO = [
  'Great ideas, wobbly execution. Like my cooking.',
  'I wanted to love it. I settled for liking it a lot on Tuesdays.',
  'Wait for a sale. A big one.',
  'Has potential. So did my last three diets.',
];
const NEGATIVE = [
  'I have played better games on a calculator.',
  'Refunded it, then bought it back to refund it again out of spite.',
  'The tutorial was the best part, and the tutorial was bad.',
  'Uninstalling this was the most satisfying thing I did all week.',
  "I've seen more content in a cereal box.",
];
const BUGGY = [
  'My character fell through the floor and is now living in the void. Honestly, upgrade.',
  'Got stuck in a wall for 40 minutes. Made friends with the wall.',
  'The physics engine has a sense of humour and it is not on my side.',
  'Every patch fixes one bug and adds two fun new ones.',
];
const AGGRESSIVE_MTX = [
  'The loot boxes have loot boxes.',
  'I spent $40 on a hat. The hat does nothing. I love my hat. I hate myself.',
  'Free-to-play, pay-to-breathe.',
];
const ONLINE = [
  "Met my best friend here. We have never seen each other's faces.",
  'Queue times are shorter than my attention span. Perfect.',
  'Lost to a 9-year-old who then explained what I did wrong. Humbling.',
];
const SERVER_TROUBLE = ['Servers went down mid-boss fight. I will remember this.', 'More time in queues than in matches lately.'];
const TOPIC_LINES: Partial<Record<string, string[]>> = {
  cats: ['As a cat, I approve of this game. Typed with paws.'],
  zombies: ['Finally a game that prepares me for Mondays.'],
  cooking: ['Burned the same virtual omelette 47 times. Personal growth.'],
  dinosaurs: ['Rode a T-rex. My childhood self just fainted.'],
  pirates: ['Arr. That is the whole review. Arr.'],
  space: ['Got lost in space for 30 hours. Exactly what I wanted.'],
  farming: ['My virtual crops are thriving. My real plants are dead.'],
  vampires: ['Played it all night. Thematically appropriate.'],
  robots: ['Beep boop. (Translation: this rules.)'],
};

function fill(t: string, g: Game): string {
  return t.split('{title}').join(g.title).split('{genre}').join(GENRES[g.genre].name.toLowerCase());
}

export function playerReviews(w: World, g: Game, count = 4): PlayerReview[] {
  if (g.releaseDay === null || g.owners < 20) return [];
  const pools: { lines: string[]; rec: boolean }[] = [];
  const score = g.userScore;
  if (score >= 70) pools.push({ lines: POSITIVE, rec: true }, { lines: POSITIVE, rec: true });
  else if (score >= 50) pools.push({ lines: MIXED_YES, rec: true }, { lines: MIXED_NO, rec: false });
  else pools.push({ lines: NEGATIVE, rec: false }, { lines: NEGATIVE, rec: false });
  if (bugDensity(g) > 3) pools.push({ lines: BUGGY, rec: score >= 60 });
  if (g.monetization === 'f2pAggressive') pools.push({ lines: AGGRESSIVE_MTX, rec: false });
  if (g.multiplayer === 'online' || g.multiplayer === 'massive') pools.push({ lines: w.day < g.meltdownUntil ? SERVER_TROUBLE : ONLINE, rec: w.day >= g.meltdownUntil });
  const topical = g.topic ? TOPIC_LINES[g.topic] : undefined;
  if (topical) pools.push({ lines: topical, rec: score >= 40 });
  const legend = g.topic ? legendaryCombo(g.genre, g.topic) : null;
  if (legend) pools.push({ lines: [`${legend.pitch}. I didn't know I needed this until today.`], rec: true });
  if (!MONETIZATIONS[g.monetization].upfront && score >= 70) pools.push({ lines: ['Free and better than most games I paid for. Suspicious.'], rec: true });

  const out: PlayerReview[] = [];
  const used = new Set<string>();
  for (let i = 0; out.length < count && i < count * 6; i++) {
    const h = hashString(`${g.id}:${i}`) >>> 0;
    const pool = pools[h % pools.length];
    const text = fill(pool.lines[(h >>> 3) % pool.lines.length], g);
    if (used.has(text)) continue;
    used.add(text);
    const age = Math.max(1, w.day - g.releaseDay);
    out.push({ text, recommended: pool.rec, hours: Math.round(((h >>> 7) % 300) * Math.min(1, age / 60)) + 1, helpful: (h >>> 11) % (40 + Math.round(Math.sqrt(g.owners))) });
  }
  return out;
}

export function topicLabel(g: Game): string {
  return g.topic ? `${TOPICS[g.topic].emoji} ${TOPICS[g.topic].name}` : '';
}
