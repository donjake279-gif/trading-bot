// "Skip to next event": fast-forward day by day until something needs the
// player (a decision, a big moment, a game ready to ship, major news) or a
// quiet stretch runs out.
import { advanceDay } from './tick';
import type { World } from './types';
import { gamesOf } from './util';

export const SKIP_MAX_DAYS = 180;

export interface SkipWatch {
  days: number;
  /** Player games that were already ready to release when the skip started. */
  ready: Set<string>;
}

export function startSkip(w: World): SkipWatch {
  const ready = new Set<string>();
  for (const g of gamesOf(w, w.player.companyId)) if (g.status === 'development' && g.workDone >= g.workRequired) ready.add(g.id);
  return { days: 0, ready };
}

/** Advance one day. Returns why the skip should stop, or null to keep going. */
export function skipStep(w: World, watch: SkipWatch): string | null {
  const toastsBefore = w.toasts.length;
  const celebrationsBefore = w.celebrations.length;
  const keynotesBefore = w.keynoteShows?.length ?? 0;
  const pending = new Set(w.pendingEvents.map((e) => e.id));
  advanceDay(w);
  watch.days += 1;
  if (w.player.gameOver) return w.player.gameOver.title;
  const decision = w.pendingEvents.find((e) => !pending.has(e.id));
  if (decision) return decision.title;
  if (w.celebrations.length > celebrationsBefore) return w.celebrations[w.celebrations.length - 1].title;
  if ((w.keynoteShows?.length ?? 0) > keynotesBefore) return `${w.keynoteShows![w.keynoteShows!.length - 1].title} is on stage`;
  for (const g of gamesOf(w, w.player.companyId)) {
    if (g.status === 'development' && g.workDone >= g.workRequired && !watch.ready.has(g.id)) return `${g.title} is ready to release`;
  }
  const news = w.toasts.slice(toastsBefore).find((t) => t.tone === 'major');
  if (news) return news.title;
  if (watch.days >= SKIP_MAX_DAYS) return `Nothing big happened for ${SKIP_MAX_DAYS} days`;
  return null;
}

/** Headless helper (tests, tools): skip until the next stop. */
export function skipToNextEvent(w: World): { days: number; reason: string } {
  const watch = startSkip(w);
  for (;;) {
    const reason = skipStep(w, watch);
    if (reason) return { days: watch.days, reason };
  }
}
