// Persistent saves: IndexedDB for the world blob (large), localStorage for the
// slot index (small, synchronous). Falls back to localStorage if IndexedDB is
// unavailable. Saves can also be exported/imported as JSON files.
import type { World } from './types';
import { playerCompany } from './util';
import { SAVE_VERSION } from './world';

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
  return typeof indexedDB !== 'undefined';
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
    const raw = localStorage.getItem(INDEX_KEY);
    const list = raw ? (JSON.parse(raw) as SlotMeta[]) : [];
    return list.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

function writeIndex(list: SlotMeta[]): void {
  try {
    localStorage.setItem(INDEX_KEY, JSON.stringify(list));
  } catch {
    // storage full or blocked: saves still exist in IndexedDB
  }
}

export function serializeWorld(w: World): string {
  return JSON.stringify({ ...w, toasts: [] });
}

export function deserializeWorld(json: string): World {
  const w = JSON.parse(json) as World;
  if (!w || typeof w !== 'object' || !w.companies || !w.player) throw new Error('Not a Game Empire save file.');
  if ((w.version ?? 0) > SAVE_VERSION) throw new Error('This save was made with a newer version of the game.');
  w.toasts = [];
  return w;
}

export async function saveToSlot(w: World, slotId: string, name?: string): Promise<SlotMeta> {
  const json = serializeWorld(w);
  const key = `slot:${slotId}`;
  if (hasIDB()) {
    try {
      await idbPut(key, json);
    } catch {
      localStorage.setItem(`game-empire:${key}`, json);
    }
  } else {
    localStorage.setItem(`game-empire:${key}`, json);
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
  if (!json) json = localStorage.getItem(`game-empire:${key}`);
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
  localStorage.removeItem(`game-empire:${key}`);
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
