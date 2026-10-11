// Zustand store: owns the World, the game loop, routing and saves.
// The simulation mutates the World in place for speed; components subscribe to
// `version`, which is bumped whenever the world changes.
import { create } from 'zustand';
import { advanceDay } from '../engine/tick';
import { createWorld, type NewGameOptions } from '../engine/world';
import { deserializeWorld, loadFromSlot, saveToSlot } from '../engine/save';
import type { ActionResult, NewsItem, World } from '../engine/types';

export type Route =
  | { name: 'dashboard' }
  | { name: 'projects' }
  | { name: 'create'; ipId?: string }
  | { name: 'game'; id: string }
  | { name: 'team' }
  | { name: 'office' }
  | { name: 'industry' }
  | { name: 'competitors' }
  | { name: 'company'; id: string }
  | { name: 'stocks' }
  | { name: 'finance' }
  | { name: 'news' }
  | { name: 'achievements' }
  | { name: 'settings' };

export const SPEEDS = [
  { label: '1×', dps: 1 },
  { label: '2×', dps: 3 },
  { label: '3×', dps: 8 },
  { label: '4×', dps: 25 },
] as const;

export interface UiToast {
  id: string;
  title: string;
  tone: NewsItem['tone'];
  at: number;
}

interface GameStore {
  world: World | null;
  version: number;
  status: 'menu' | 'generating' | 'playing';
  speed: number;
  paused: boolean;
  route: Route;
  backStack: Route[];
  toasts: UiToast[];
  slotId: string;
  autosave: boolean;
  pauseOnEvents: boolean;
  lastAutosaveDay: number;
  lastSavedAt: number | null;
  error: string | null;

  newGame: (opts: NewGameOptions) => void;
  loadSlot: (id: string) => Promise<void>;
  importSave: (json: string) => void;
  saveNow: (slotId?: string, name?: string) => Promise<void>;
  setSpeed: (i: number) => void;
  togglePause: () => void;
  setPaused: (p: boolean) => void;
  navigate: (r: Route) => void;
  back: () => void;
  act: (fn: (w: World) => ActionResult | void, successToast?: string) => ActionResult;
  bump: () => void;
  pushToast: (title: string, tone?: NewsItem['tone']) => void;
  dismissToast: (id: string) => void;
  quitToMenu: () => void;
  setAutosave: (v: boolean) => void;
  setPauseOnEvents: (v: boolean) => void;
  clearError: () => void;
}

let toastSeq = 0;

export const useGameStore = create<GameStore>((set, get) => ({
  world: null,
  version: 0,
  status: 'menu',
  speed: 1,
  paused: true,
  route: { name: 'dashboard' },
  backStack: [],
  toasts: [],
  slotId: 'slot-1',
  autosave: true,
  pauseOnEvents: true,
  lastAutosaveDay: 0,
  lastSavedAt: null,
  error: null,

  newGame: (opts) => {
    set({ status: 'generating', error: null });
    // let the loading screen paint before the (synchronous) world generation
    setTimeout(() => {
      try {
        const world = createWorld(opts);
        const slotId = `slot-${Date.now().toString(36)}`;
        set({ world, status: 'playing', paused: true, route: { name: 'dashboard' }, backStack: [], slotId, lastAutosaveDay: world.day, version: get().version + 1, toasts: [] });
        void get().saveNow(slotId);
      } catch (e) {
        set({ status: 'menu', error: e instanceof Error ? e.message : String(e) });
      }
    }, 60);
  },

  loadSlot: async (id) => {
    try {
      const world = await loadFromSlot(id);
      set({ world, status: 'playing', paused: true, route: { name: 'dashboard' }, backStack: [], slotId: id, lastAutosaveDay: world.day, version: get().version + 1, toasts: [], error: null });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  importSave: (json) => {
    try {
      const world = deserializeWorld(json);
      const slotId = `slot-${Date.now().toString(36)}`;
      set({ world, status: 'playing', paused: true, route: { name: 'dashboard' }, backStack: [], slotId, lastAutosaveDay: world.day, version: get().version + 1, toasts: [], error: null });
      void get().saveNow(slotId);
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    }
  },

  saveNow: async (slotId, name) => {
    const w = get().world;
    if (!w) return;
    try {
      await saveToSlot(w, slotId ?? get().slotId, name);
      set({ lastSavedAt: Date.now(), lastAutosaveDay: w.day });
    } catch (e) {
      get().pushToast(`Save failed: ${e instanceof Error ? e.message : String(e)}`, 'bad');
    }
  },

  setSpeed: (i) => set({ speed: i, paused: false }),
  togglePause: () => set({ paused: !get().paused }),
  setPaused: (p) => set({ paused: p }),

  navigate: (r) => {
    const cur = get().route;
    if (JSON.stringify(cur) === JSON.stringify(r)) return;
    set({ route: r, backStack: [...get().backStack.slice(-30), cur] });
    if (typeof window !== 'undefined') window.scrollTo({ top: 0 });
  },
  back: () => {
    const stack = get().backStack;
    if (!stack.length) return set({ route: { name: 'dashboard' } });
    set({ route: stack[stack.length - 1], backStack: stack.slice(0, -1) });
  },

  act: (fn, successToast) => {
    const w = get().world;
    if (!w) return { ok: false, error: 'No game loaded.' };
    const res = fn(w) ?? { ok: true };
    drainWorldToasts();
    set({ version: get().version + 1 });
    if (!res.ok && res.error) get().pushToast(res.error, 'bad');
    else if (res.ok && successToast) get().pushToast(successToast, 'good');
    return res;
  },

  bump: () => set({ version: get().version + 1 }),

  pushToast: (title, tone = 'neutral') => {
    const t: UiToast = { id: `ui${++toastSeq}`, title, tone, at: Date.now() };
    set({ toasts: [...get().toasts.slice(-5), t] });
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  quitToMenu: () => {
    const s = get();
    if (s.world && !s.world.player.gameOver) void s.saveNow();
    set({ world: null, status: 'menu', paused: true, toasts: [] });
  },
  setAutosave: (v) => set({ autosave: v }),
  setPauseOnEvents: (v) => set({ pauseOnEvents: v }),
  clearError: () => set({ error: null }),
}));

function drainWorldToasts() {
  const s = useGameStore.getState();
  const w = s.world;
  if (!w || w.toasts.length === 0) return;
  const now = Date.now();
  const add = w.toasts.map((t) => ({ id: `w${++toastSeq}`, title: t.title, tone: t.tone, at: now }));
  w.toasts = [];
  useGameStore.setState({ toasts: [...s.toasts, ...add].slice(-6) });
}

/** Subscribe a component to world changes and return the (mutable) world. */
export function useWorld(): World {
  useGameStore((s) => s.version);
  return useGameStore.getState().world as World;
}

// ------------------------------------------------------------ the game loop

const TICK_MS = 100;
let accumulator = 0;

function loop() {
  const s = useGameStore.getState();
  const w = s.world;
  if (!w || s.status !== 'playing') return;
  if (w.player.gameOver) {
    if (!s.paused) useGameStore.setState({ paused: true });
    return;
  }
  if (s.paused) return;
  if (s.pauseOnEvents && w.pendingEvents.length > 0) {
    useGameStore.setState({ paused: true });
    return;
  }
  accumulator += SPEEDS[s.speed].dps * (TICK_MS / 1000);
  let days = Math.floor(accumulator);
  if (days <= 0) return;
  accumulator -= days;
  days = Math.min(days, 6);
  for (let i = 0; i < days; i++) {
    advanceDay(w);
    if (w.player.gameOver || w.pauseReason) break;
    if (s.pauseOnEvents && w.pendingEvents.length > 0) break;
  }
  drainWorldToasts();
  const patch: Partial<GameStore> = { version: s.version + 1 };
  if (w.player.gameOver || (s.pauseOnEvents && w.pendingEvents.length > 0)) patch.paused = true;
  if (w.pauseReason) {
    patch.paused = true;
    useGameStore.getState().pushToast(`Paused: ${w.pauseReason}`, 'bad');
    w.pauseReason = null;
  }
  useGameStore.setState(patch);
  if (s.autosave && w.day - s.lastAutosaveDay >= 30 && !w.player.gameOver) {
    useGameStore.setState({ lastAutosaveDay: w.day });
    void s.saveNow(s.slotId);
  }
}

if (typeof window !== 'undefined') {
  window.setInterval(loop, TICK_MS);
  window.addEventListener('beforeunload', () => {
    const s = useGameStore.getState();
    if (s.world && !s.world.player.gameOver) void saveToSlot(s.world, s.slotId);
  });
}
