// The Global Game Jam: every July a theme drops and your team gets one
// weekend to make something. The jam game ships for 99 cents, reveals a
// combo for your combo book, cheers the team up, and once in a while turns
// into a surprise hit you can build a franchise on.
import { FOCUS_IDS, GENRES, GENRE_IDS, ROLES, TOPICS, TOPIC_IDS } from './constants';
import { createGameRecord, releaseGame } from './development';
import { pushDecision } from './events';
import { addXp } from './progression';
import { pick, randRange, shuffle } from './rng';
import type { DecisionEvent, GenreId, World } from './types';
import { addGame, celebrate, dayToDate, playerCompany, toast } from './util';

export const JAM_DATE: [number, number] = [6, 20]; // Jul 20

export function jamDaily(w: World): void {
  const d = dayToDate(w.day);
  if (d.getUTCMonth() !== JAM_DATE[0] || d.getUTCDate() !== JAM_DATE[1]) return;
  const p = playerCompany(w);
  if (!p || p.status !== 'active' || w.player.gameOver) return;
  const topic = pick(w, TOPIC_IDS);
  const genres = shuffle(w, GENRE_IDS.filter((g) => GENRES[g].minScope === 'tiny' || GENRES[g].minScope === 'small')).slice(0, 3);
  pushDecision(w, {
    kind: 'gameJam',
    title: `Global Game Jam: this year's theme is "${TOPICS[topic].name}"`,
    body: 'Your team gets one weekend to make a tiny game. It ships for 99 cents, fills in your combo book and lifts morale. Jam games occasionally become surprise hits.',
    options: [
      ...genres.map((g) => ({ id: `jam:${g}`, label: `Make a ${GENRES[g].name} game`, description: `${GENRES[g].name} × ${TOPICS[topic].name}` })),
      { id: 'skip', label: 'Sit this one out', description: '' },
    ],
    data: { topic },
    expiresDay: w.day + 21,
    defaultOption: 'skip',
  });
}

const JAM_A = ['Tiny', 'Super', 'Pocket', 'Mini', 'Hyper', 'Ultra', 'Micro'];
const JAM_B = ['Panic', 'Party', 'Rush', 'Quest', 'Dash', 'Mayhem', 'Frenzy'];

export function resolveJam(w: World, ev: DecisionEvent, optionId: string): boolean {
  if (ev.kind !== 'gameJam') return false;
  if (!optionId.startsWith('jam:')) return true;
  const genre = optionId.slice(4) as GenreId;
  const topic = ev.data.topic as (typeof TOPIC_IDS)[number];
  const p = playerCompany(w);
  const devs = w.player.employees.filter((e) => ROLES[e.role].dev).sort((a, b) => b.skill - a.skill).slice(0, 4);
  if (!GENRES[genre] || !TOPICS[topic] || devs.length === 0) return true;
  const g = createGameRecord(
    w,
    p,
    {
      title: `${pick(w, JAM_A)} ${TOPICS[topic].name} ${pick(w, JAM_B)}`,
      genre,
      topic,
      platforms: ['pc'],
      audience: 'casual',
      engine: w.player.engine ? 'inhouse' : 'pixelforge',
      monetization: 'premium',
      price: 0.99,
      artStyle: 'pixel',
      multiplayer: 'single',
      scope: 'tiny',
      budget: 0,
      focus: { ...GENRES[genre].ideal },
    },
    true,
  );
  addGame(w, g);
  const skill = devs.reduce((s, e) => s + e.skill, 0) / devs.length;
  const craft = Math.pow(skill / 50, 0.6) * randRange(w, 0.8, 1.3);
  g.workDone = g.workRequired;
  for (const d of FOCUS_IDS) g.points[d] = g.workRequired * GENRES[genre].ideal[d] * craft;
  g.bugs = g.workRequired * 0.05;
  releaseGame(w, g);
  for (const e of w.player.employees) e.morale = Math.min(100, e.morale + 5);
  addXp(w, 60);
  if (g.criticScore >= 75) {
    g.viralMult = Math.max(g.viralMult, 1.5);
    g.viralUntil = Math.max(g.viralUntil, w.day + 30);
    const ip = w.ips[g.ipId];
    if (ip) ip.fans += 20000;
    celebrate(w, 'Jam hit!');
    toast(w, `Your jam game ${g.title} is a surprise hit!`, 'good', { category: 'game', link: { route: 'game', id: g.id }, body: 'Players want more. A full sequel could do very well.' });
  } else {
    toast(w, `Jam game shipped: ${g.title} (${g.criticScore})`, 'good', { category: 'game', link: { route: 'game', id: g.id }, body: 'The team had a blast. Check your combo book.' });
  }
  return true;
}
