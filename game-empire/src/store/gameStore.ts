// Zustand store: owns the World, the game loop, routing and saves.
// The simulation mutates the World in place for speed; components subscribe to
// `version`, which is bumped whenever the world changes.
import { create } from 'zustand';
import { advanceDay } from '../engine/tick';
import { createWorld, type NewGameOptions } from '../engine/world';
import { deserializeWorld, loadFromSlot, saveToSlot } from '../engine/save';
import type { ActionResult, NewsItem, NoticeCategory, NoticeLink, World } from '../engine/types';

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
  | { name: 'servers' }
  | { name: 'goals' }
  | { name: 'engine' }
  | { name: 'awards' }
  | { name: 'empire'; tab?: string }
  | { name: 'settings' };

const SIMPLE_ROUTES = ['dashboard', 'projects', 'team', 'office', 'industry', 'competitors', 'stocks', 'finance', 'news', 'achievements', 'servers', 'goals', 'engine', 'awards', 'empire', 'settings'] as const;

export const SPEEDS = [
  { label: '1×', dps: 1 },
  { label: '2×', dps: 3 },
  { label: '3×', dps: 8 },
  { label: '4×', dps: 25 },
] as const;

export interface UiToast {
  id: string;
  title: string;
  body?: string;
  tone: NewsItem['tone'];
  category?: NoticeCategory;
  link?: NoticeLink;
  /** When it became the visible toast (0 = still queued). */
  at: number;
  /** How long the toast stays up (ms). */
  ttl: number;
  leaving?: boolean;
}

export type DrawerTab = 'inbox' | 'all';
export type ToastLevel = 'all' | 'important' | 'off';

function readToastLevel(): ToastLevel {
  try {
    const v = typeof localStorage !== 'undefined' ? localStorage.getItem('game-empire:toasts') : null;
    return v === 'important' || v === 'off' ? v : 'all';
  } catch {
    return 'all';
  }
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
  drawer: DrawerTab | null;
  toastLevel: ToastLevel;
  celebrations: { id: string; title: string; big?: boolean }[];
  clearCelebration: (id: string) => void;
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
  pushToast: (title: string, tone?: NewsItem['tone'], body?: string) => void;
  dismissToast: (id: string) => void;
  holdToast: (id: string, hold: boolean) => void;
  startToast: (id: string) => void;
  follow: (link: NoticeLink | undefined) => void;
  openDrawer: (tab: DrawerTab | null) => void;
  quitToMenu: () => void;
  setAutosave: (v: boolean) => void;
  setToastLevel: (v: ToastLevel) => void;
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
  drawer: null,
  toastLevel: readToastLevel(),
  celebrations: [],
  clearCelebration: (id) => set({ celebrations: get().celebrations.filter((c) => c.id !== id) }),
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
  togglePause: () => get().setPaused(!get().paused),
  setPaused: (p) => {
    const s = get();
    if (p && !s.paused && s.world) {
      // show exactly where the game stopped, and save while nothing is running
      drainWorldToasts();
      if (s.autosave && s.world.day - s.lastAutosaveDay >= 30 && !s.world.player.gameOver) {
        set({ lastAutosaveDay: s.world.day });
        // let the paused screen draw first; saving a big world takes a moment
        setTimeout(() => {
          if (get().paused) void get().saveNow(get().slotId);
        }, 250);
      }
    }
    set({ paused: p, version: get().version + 1 });
  },

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

  pushToast: (title, tone = 'neutral', body) => {
    const t: UiToast = { id: `ui${++toastSeq}`, title, body, tone, at: 0, ttl: toastTtl(tone, body) };
    set({ toasts: limitToasts([...get().toasts, t]) });
  },
  dismissToast: (id) => {
    const t = get().toasts.find((x) => x.id === id);
    if (!t || t.leaving) return;
    set({ toasts: get().toasts.map((x) => (x.id === id ? { ...x, leaving: true } : x)) });
    setTimeout(() => set({ toasts: get().toasts.filter((x) => x.id !== id) }), 220);
  },
  holdToast: (id, hold) => {
    // hovering keeps a toast up; leaving restarts a short countdown
    set({ toasts: get().toasts.map((x) => (x.id === id ? { ...x, at: hold ? Number.POSITIVE_INFINITY : Date.now() - x.ttl + 1500 } : x)) });
  },
  startToast: (id) => set({ toasts: get().toasts.map((x) => (x.id === id && x.at === 0 ? { ...x, at: Date.now() } : x)) }),
  follow: (link) => {
    if (!link) return;
    if (link.route === 'inbox') return set({ drawer: 'inbox' });
    const nav = get().navigate;
    if (link.route === 'game' && link.id) nav({ name: 'game', id: link.id });
    else if (link.route === 'company' && link.id) nav({ name: 'company', id: link.id });
    else if (link.route === 'empire') nav({ name: 'empire', tab: link.id });
    else if ((SIMPLE_ROUTES as readonly string[]).includes(link.route)) nav({ name: link.route } as Route);
    set({ drawer: null });
  },
  openDrawer: (tab) => {
    const w = get().world;
    // closing the history marks everything as read
    if (tab === null && w) for (const n of w.notices) n.read = true;
    set({ drawer: tab, version: get().version + 1 });
  },

  quitToMenu: () => {
    const s = get();
    if (s.world && !s.world.player.gameOver) void s.saveNow();
    set({ world: null, status: 'menu', paused: true, toasts: [], drawer: null });
  },
  setAutosave: (v) => set({ autosave: v }),
  setToastLevel: (v) => {
    try {
      localStorage.setItem('game-empire:toasts', v);
    } catch {
      /* storage blocked: keep it for this session */
    }
    set({ toastLevel: v });
  },
  clearError: () => set({ error: null }),
}));

/** Toasts show one at a time; this many can wait in line. */
const MAX_TOASTS = 4;

function toastTtl(tone: NewsItem['tone'], body?: string): number {
  return (tone === 'bad' || tone === 'major' ? 5000 : 3500) + (body ? 1000 : 0);
}

/** Keep the line short: drop the oldest waiting calm toasts first, never the one on screen. */
function limitToasts(list: UiToast[]): UiToast[] {
  const live = list.filter((t) => !t.leaving);
  if (live.length <= MAX_TOASTS) return list;
  const queued = live.filter((t) => t.at === 0);
  const calm = queued.filter((t) => t.tone !== 'bad' && t.tone !== 'major');
  const order = [...calm, ...queued.filter((t) => !calm.includes(t))];
  const drop = new Set(order.slice(0, live.length - MAX_TOASTS).map((t) => t.id));
  return list.filter((t) => !drop.has(t.id));
}

function drainWorldToasts() {
  const s = useGameStore.getState();
  const w = s.world;
  if (w && w.celebrations?.length) {
    // only the latest few, so a fast-forward doesn't bury the screen in confetti
    useGameStore.setState({ celebrations: [...s.celebrations, ...w.celebrations].slice(-2) });
    w.celebrations = [];
  }
  if (!w || w.toasts.length === 0) return;
  const level = s.toastLevel;
  const incoming = level === 'off' ? [] : level === 'important' ? w.toasts.filter((t) => t.tone === 'bad' || t.tone === 'major' || t.category === 'offer') : w.toasts;
  if (incoming.length === 0) {
    w.toasts = [];
    return;
  }
  // at high speed many things happen at once: show the most recent few
  const add: UiToast[] = incoming.slice(-MAX_TOASTS).map((t) => ({ id: `w${++toastSeq}`, title: t.title, body: t.body, tone: t.tone, category: t.category, link: t.link, at: 0, ttl: toastTtl(t.tone, t.body) }));
  w.toasts = [];
  useGameStore.setState({ toasts: limitToasts([...s.toasts, ...add]) });
}

/** Subscribe a component to world changes and return the (mutable) world. */
export function useWorld(): World {
  useGameStore((s) => s.version);
  return useGameStore.getState().world as World;
}

// ------------------------------------------------------------ the game loop

// The simulation runs in small, even slices (a day or two every 50 ms) so no
// single tick blocks the page for long. The screen is redrawn less often at
// high speed: drawing is what costs the most, and 5 redraws a second still
// reads as live. Autosave waits for both 30 game days and 45 real seconds.
const TICK_MS = 50;
const AUTOSAVE_MS = 45_000;
let accumulator = 0;
let lastRender = 0;
let lastAutosaveAt = typeof performance !== 'undefined' ? performance.now() : 0;

function renderInterval(speed: number): number {
  return speed >= 2 ? 200 : 100;
}

function loop() {
  const s = useGameStore.getState();
  const w = s.world;
  if (!w || s.status !== 'playing') return;
  if (w.player.gameOver) {
    if (!s.paused) useGameStore.setState({ paused: true });
    return;
  }
  if (s.paused) return;
  accumulator += SPEEDS[s.speed].dps * (TICK_MS / 1000);
  let days = Math.floor(accumulator);
  if (days <= 0) return;
  accumulator -= days;
  days = Math.min(days, 3);
  for (let i = 0; i < days; i++) {
    advanceDay(w);
    if (w.player.gameOver) break;
  }
  w.pauseReason = null;
  const now = performance.now();
  // a celebration or game over redraws straight away; toasts wait for the next redraw
  const urgent = !!w.player.gameOver || w.celebrations.length > 0;
  if (urgent || now - lastRender >= renderInterval(s.speed)) {
    lastRender = now;
    drainWorldToasts();
    const patch: Partial<GameStore> = { version: s.version + 1 };
    if (w.player.gameOver) patch.paused = true;
    useGameStore.setState(patch);
  }
  if (s.autosave && w.day - s.lastAutosaveDay >= 30 && now - lastAutosaveAt >= AUTOSAVE_MS && !w.player.gameOver) {
    lastAutosaveAt = now;
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
