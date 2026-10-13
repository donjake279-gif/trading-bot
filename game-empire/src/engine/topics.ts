// Game topics and the combo book. Every genre x topic pairing has a hidden
// grade: critics love some pairings and hate others, and a few secret
// "legendary" combos nobody expects to work become instant hits. You learn a
// pairing's grade by shipping it (or by watching rivals' hits).
import { COMBO_BAD, COMBO_GREAT, COMBO_QUALITY, GENRES, LEGENDARY_COMBOS, TOPICS, TOPIC_IDS } from './constants';
import { chance, weightedPick } from './rng';
import type { ComboGrade, Game, GenreId, TopicId, World } from './types';
import { hashString, pushNews, toast } from './util';

export function comboKey(genre: GenreId, topic: TopicId): string {
  return `${genre}:${topic}`;
}

export function legendaryCombo(genre: GenreId, topic: TopicId) {
  return LEGENDARY_COMBOS.find((c) => c.genre === genre && c.topic === topic) ?? null;
}

export function comboGrade(genre: GenreId, topic: TopicId): ComboGrade {
  if (legendaryCombo(genre, topic)) return 'legendary';
  if (COMBO_GREAT[genre].includes(topic)) return 'great';
  if (COMBO_BAD[genre].includes(topic)) return 'bad';
  const h = hashString(comboKey(genre, topic)) % 10;
  return h < 3 ? 'good' : h === 9 ? 'bad' : 'okay';
}

export function comboQuality(g: Pick<Game, 'genre' | 'topic'>): number {
  if (!g.topic) return 0;
  return COMBO_QUALITY[comboGrade(g.genre, g.topic)];
}

export const TOTAL_COMBOS = TOPIC_IDS.length * Object.keys(GENRES).length;

/** What the player knows about a pairing before shipping it. */
export function comboHint(w: World, genre: GenreId, topic: TopicId): ComboGrade | 'promising' | 'risky' | null {
  const known = w.player.combos[comboKey(genre, topic)];
  if (known) return known;
  if (w.player.research.completed.includes('analytics')) {
    const g = comboGrade(genre, topic);
    if (g === 'bad') return 'risky';
    if (g === 'great' || g === 'good') return 'promising';
  }
  return null;
}

/** Record a pairing in the combo book. Returns true if it was new. */
export function discoverCombo(w: World, genre: GenreId, topic: TopicId): boolean {
  const key = comboKey(genre, topic);
  if (w.player.combos[key]) return false;
  w.player.combos[key] = comboGrade(genre, topic);
  return true;
}

/** A default topic for games created without one (old saves, quick starts). */
export function defaultTopic(seed: string): TopicId {
  return TOPIC_IDS[hashString(seed) % TOPIC_IDS.length];
}

/** Rival studios have a nose for what works, but not a perfect one. */
export function aiPickTopic(w: World, genre: GenreId): TopicId {
  const weights = TOPIC_IDS.map((t) => {
    const g = comboGrade(genre, t);
    return g === 'legendary' ? 0.15 : g === 'great' ? 3 : g === 'good' ? 2 : g === 'okay' ? 1 : 0.3;
  });
  return weightedPick(w, TOPIC_IDS, weights);
}

/** Called when any game releases. */
export function comboOnRelease(w: World, g: Game, isPlayer: boolean): void {
  if (!g.topic) return;
  if (isPlayer) {
    const isNew = discoverCombo(w, g.genre, g.topic);
    const grade = comboGrade(g.genre, g.topic);
    const legend = legendaryCombo(g.genre, g.topic);
    if (legend) {
      g.viralMult = Math.max(g.viralMult, 1.6);
      g.viralUntil = Math.max(g.viralUntil, w.day + 30);
      g.hype = Math.min(1400, g.hype + 120);
      pushNews(w, { kind: 'player', title: `${legend.pitch}? ${g.title} is the surprise hit nobody saw coming`, body: 'Players and critics cannot stop talking about it.', gameId: g.id, companyId: g.companyId, tone: 'major' });
      toast(w, isNew ? `Legendary combo discovered: ${GENRES[g.genre].name} × ${TOPICS[g.topic].name}!` : `${g.title} rides a legendary combo`, 'good', {
        category: 'game',
        link: { route: 'game', id: g.id },
        body: `${legend.pitch}. The internet is losing its mind.`,
      });
    } else if (isNew) {
      const label = grade === 'great' ? 'a great combo' : grade === 'good' ? 'a good combo' : grade === 'bad' ? 'a bad combo' : 'an okay combo';
      toast(w, `Combo book: ${GENRES[g.genre].name} × ${TOPICS[g.topic].name} is ${label}`, grade === 'bad' ? 'bad' : grade === 'okay' ? 'neutral' : 'good', {
        category: 'goal',
        link: { route: 'achievements' },
        silent: grade === 'okay',
      });
    }
  } else if (g.criticScore >= 80 && w.player.companyId && w.companies[w.player.companyId] && chance(w, 0.2)) {
    // watching a rival's hit teaches you something too
    if (discoverCombo(w, g.genre, g.topic)) {
      toast(w, `Market research: ${GENRES[g.genre].name} × ${TOPICS[g.topic].name} works (${g.title})`, 'neutral', { category: 'industry', link: { route: 'achievements' }, silent: true });
    }
  }
}
