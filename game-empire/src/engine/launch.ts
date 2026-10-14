// After launch: a first-week report card for each of your releases.
import { GENRES } from './constants';
import type { World } from './types';
import { allGames, celebrate, gamesOf, toast } from './util';

const short = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}K` : `${Math.round(n)}`);

/** Where a live game ranks in its genre by players right now (1 = top). */
export function genreRank(w: World, gameId: string): { rank: number; of: number } {
  const g = w.games[gameId];
  if (!g) return { rank: 0, of: 0 };
  let rank = 1;
  let of = 0;
  for (const x of allGames(w)) {
    if (x.status !== 'released' || x.genre !== g.genre) continue;
    of += 1;
    if (x.id !== g.id && x.active > g.active) rank += 1;
  }
  return { rank, of };
}

export function firstWeekReports(w: World): void {
  for (const g of gamesOf(w, w.player.companyId)) {
    if (g.status !== 'released' || g.releaseDay === null || w.day - g.releaseDay !== 7) continue;
    const { rank, of } = genreRank(w, g.id);
    const genre = GENRES[g.genre].name;
    const top = rank === 1 && of >= 3;
    const tone = top || rank <= 3 ? 'good' : rank > of / 2 ? 'bad' : 'neutral';
    if (top) celebrate(w, `${g.title} is the #1 ${genre} game!`, true);
    toast(w, `${g.title}: first week`, tone, {
      category: 'game',
      link: { route: 'game', id: g.id },
      body: `${short(g.owners)} players · $${short(g.revenueTotal)} earned · #${rank} of ${of} in ${genre}`,
    });
  }
}
