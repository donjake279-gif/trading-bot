// Persistent saves: IndexedDB for the world blob (large), localStorage for the
// slot index (small, synchronous). Falls back to localStorage if IndexedDB is
// unavailable. Saves can also be exported/imported as JSON files.
import type { World } from './types';
import { normalizeLedger, playerCompany } from './util';
import { SAVE_VERSION, playerExtras } from './world';
import { CERTIFICATIONS } from './constants';
import { migrateEngine } from './studioEngine';
import { defaultTopic } from './topics';

export interface SlotMeta {
  id: string;
  name: string;
  companyName: string;
  day: number;
  valuation: number;
  cash: number;
  savedAt: number;
  gameOver: boolean;
}

const INDEX_KEY = 'game-empire:slots';
const DB_NAME = 'game-empire';
const STORE = 'saves';

function hasIDB(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

// Storage can be missing or throw (private windows, blocked site data,
// sandboxed frames). Every access goes through these guards.
function lsGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function lsSet(key: string, value: string): boolean {
  try {
    localStorage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

function lsRemove(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // nothing to clean up
  }
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbPut(key: string, value: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

async function idbGet(key: string): Promise<string | undefined> {
  const db = await openDb();
  const v = await new Promise<string | undefined>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result as string | undefined);
    req.onerror = () => reject(req.error);
  });
  db.close();
  return v;
}

async function idbDelete(key: string): Promise<void> {
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
  db.close();
}

export function listSlots(): SlotMeta[] {
  try {
    const raw = lsGet(INDEX_KEY);
    const list = raw ? (JSON.parse(raw) as SlotMeta[]) : [];
    return list.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

function writeIndex(list: SlotMeta[]): void {
  // storage full or blocked: saves may still exist in IndexedDB
  lsSet(INDEX_KEY, JSON.stringify(list));
}

export function serializeWorld(w: World): string {
  return JSON.stringify({ ...w, toasts: [] });
}

export function deserializeWorld(json: string): World {
  const w = JSON.parse(json) as World;
  if (!w || typeof w !== 'object' || !w.companies || !w.player) throw new Error('Not a Game Empire save file.');
  if ((w.version ?? 0) > SAVE_VERSION) throw new Error('This save was made with a newer version of the game.');
  migrate(w);
  w.toasts = [];
  return w;
}

/** Fill in fields added after a save was written. */
function migrate(w: World): void {
  for (const id in w.games) {
    const g = w.games[id];
    g.updateQueue ??= [];
    g.autoUpdates ??= false;
    g.newcomer ??= false;
    g.backlashUntil ??= 0;
    g.neglectWarned ??= false;
    g.ccuMilestone ??= 0;
    g.lastChurn ??= 0;
    g.topic ??= defaultTopic(g.id);
    g.remasterOf ??= null;
    g.remastered ??= false;
    if (g.certified === undefined) {
      // award old certifications quietly
      let lvl = 0;
      while (lvl < CERTIFICATIONS.length && g.owners >= CERTIFICATIONS[lvl].owners) lvl++;
      g.certified = lvl;
    }
  }
  for (const id in w.companies) {
    const c = w.companies[id];
    c.ledger = normalizeLedger(c.ledger);
    for (const m of c.monthly) m.ledger = normalizeLedger(m.ledger);
  }
  w.player.autoAssign ??= true;
  w.player.lifelinesUsed ??= 0;
  const extras = playerExtras();
  const pl = w.player as unknown as Record<string, unknown>;
  for (const [k, v] of Object.entries(extras)) if (pl[k] === undefined) pl[k] = v;
  if ((w.version ?? 0) < 4) migrateEngine(w);
  w.player.infra.demandHistory ??= [];
  w.player.infra.dataCenters ??= [];
  w.player.infra.capacityHistory ??= [];
  w.notices ??= [];
  w.pauseReason = null;
  w.version = SAVE_VERSION;
}

export async function saveToSlot(w: World, slotId: string, name?: string): Promise<SlotMeta> {
  const json = serializeWorld(w);
  const key = `slot:${slotId}`;
  let stored = false;
  if (hasIDB()) {
    try {
      await idbPut(key, json);
      stored = true;
    } catch {
      stored = false;
    }
  }
  if (!stored && !lsSet(`game-empire:${key}`, json)) {
    throw new Error('This browser is blocking storage. Copy your save code from Game & Saves to keep your progress.');
  }
  const c = playerCompany(w);
  const meta: SlotMeta = {
    id: slotId,
    name: name ?? (slotId === 'autosave' ? 'Autosave' : c.name),
    companyName: c.name,
    day: w.day,
    valuation: c.valuation,
    cash: c.cash,
    savedAt: Date.now(),
    gameOver: !!w.player.gameOver,
  };
  const list = listSlots().filter((s) => s.id !== slotId);
  list.push(meta);
  writeIndex(list);
  return meta;
}

export async function loadFromSlot(slotId: string): Promise<World> {
  const key = `slot:${slotId}`;
  let json: string | undefined | null;
  if (hasIDB()) {
    try {
      json = await idbGet(key);
    } catch {
      json = undefined;
    }
  }
  if (!json) json = lsGet(`game-empire:${key}`);
  if (!json) throw new Error('Save not found.');
  return deserializeWorld(json);
}

export async function deleteSlot(slotId: string): Promise<void> {
  const key = `slot:${slotId}`;
  if (hasIDB()) {
    try {
      await idbDelete(key);
    } catch {
      // ignore
    }
  }
  lsRemove(`game-empire:${key}`);
  writeIndex(listSlots().filter((s) => s.id !== slotId));
}

export function exportFile(w: World): void {
  const blob = new Blob([serializeWorld(w)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const c = playerCompany(w);
  a.href = url;
  a.download = `game-empire-${c.name.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-day${w.day}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
