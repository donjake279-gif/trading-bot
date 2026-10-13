import { NEWS_CAP, START_YEAR } from './constants';
import type { Company, Game, Ledger, NewsItem, Notice, NoticeCategory, NoticeLink, Point, World } from './types';

export const DAY_MS = 86400000;
const EPOCH = Date.UTC(START_YEAR, 0, 1);

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function dayToDate(day: number): Date {
  return new Date(EPOCH + day * DAY_MS);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function formatDate(day: number, withWeekday = false): string {
  const d = dayToDate(day);
  const s = `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
  return withWeekday ? `${WEEKDAYS[d.getUTCDay()]}, ${s}` : s;
}

export function formatMonth(day: number): string {
  const d = dayToDate(day);
  return `${MONTHS[d.getUTCMonth()]} '${String(d.getUTCFullYear()).slice(2)}`;
}

export function yearOf(day: number): number {
  return dayToDate(day).getUTCFullYear();
}

export function monthOf(day: number): number {
  return dayToDate(day).getUTCMonth();
}

export function isMonthStart(day: number): boolean {
  return dayToDate(day).getUTCDate() === 1;
}

export function dayOfMonth(day: number): number {
  return dayToDate(day).getUTCDate();
}

export function newId(w: World, prefix: string): string {
  w.nextId += 1;
  return `${prefix}${w.nextId.toString(36)}`;
}

export function emptyLedger(): Ledger {
  return {
    sales: 0,
    microtransactions: 0,
    subscriptions: 0,
    ads: 0,
    dlc: 0,
    licensing: 0,
    store: 0,
    contracts: 0,
    investments: 0,
    publishing: 0,
    other: 0,
    salaries: 0,
    rent: 0,
    servers: 0,
    development: 0,
    marketing: 0,
    royalties: 0,
    interest: 0,
    taxes: 0,
    research: 0,
    perks: 0,
    misc: 0,
  };
}

/** Fill categories missing from ledgers written by older versions. */
export function normalizeLedger(l: Partial<Ledger> | undefined): Ledger {
  const out = emptyLedger();
  if (l) for (const k of Object.keys(out) as (keyof Ledger)[]) out[k] = Number.isFinite(l[k]) ? (l[k] as number) : 0;
  return out;
}

export const REVENUE_KEYS = ['sales', 'microtransactions', 'subscriptions', 'ads', 'dlc', 'licensing', 'store', 'contracts', 'investments', 'publishing', 'other'] as const;
export const EXPENSE_KEYS = [
  'salaries',
  'rent',
  'servers',
  'development',
  'marketing',
  'royalties',
  'interest',
  'taxes',
  'research',
  'perks',
  'misc',
] as const;

export type RevenueKey = (typeof REVENUE_KEYS)[number];
export type ExpenseKey = (typeof EXPENSE_KEYS)[number];

export function ledgerRevenue(l: Ledger): number {
  let t = 0;
  for (const k of REVENUE_KEYS) t += l[k];
  return t;
}

export function ledgerExpenses(l: Ledger): number {
  let t = 0;
  for (const k of EXPENSE_KEYS) t += l[k];
  return t;
}

export function earn(c: Company, key: RevenueKey, amount: number): void {
  if (!(amount > 0)) return;
  c.cash += amount;
  c.ledger[key] += amount;
  c.revenueTotal += amount;
  c.quarterRevenue += amount;
}

export function spend(c: Company, key: ExpenseKey, amount: number): void {
  if (!(amount > 0)) return;
  c.cash -= amount;
  c.ledger[key] += amount;
}

export function pushNews(w: World, item: Omit<NewsItem, 'id' | 'day'>): void {
  w.news.unshift({ ...item, id: newId(w, 'n'), day: w.day });
  if (w.news.length > NEWS_CAP) w.news.length = NEWS_CAP;
}

export interface NotifyInput {
  title: string;
  body?: string;
  tone?: NewsItem['tone'];
  category?: NoticeCategory;
  link?: NoticeLink;
  /** Keep it in the history only, without a toast. */
  silent?: boolean;
}

const NOTICE_CAP = 300;

/** Record a notification in the history and show it briefly as a toast. */
export function notify(w: World, n: NotifyInput): void {
  const notice: Notice = {
    id: newId(w, 'nt'),
    day: w.day,
    title: n.title,
    body: n.body,
    tone: n.tone ?? 'neutral',
    category: n.category ?? 'studio',
    link: n.link,
    read: false,
  };
  if (!w.notices) w.notices = [];
  w.notices.unshift(notice);
  if (w.notices.length > NOTICE_CAP) w.notices.length = NOTICE_CAP;
  if (!n.silent) {
    w.toasts.push({ id: notice.id, title: notice.title, body: notice.body, tone: notice.tone, category: notice.category, link: notice.link });
    if (w.toasts.length > 12) w.toasts.splice(0, w.toasts.length - 12);
  }
}

/** Queue a celebration (confetti) for a big moment. */
export function celebrate(w: World, title: string, big = false): void {
  if (!w.celebrations) w.celebrations = [];
  w.celebrations.push({ id: newId(w, 'cb'), title, big });
  if (w.celebrations.length > 5) w.celebrations.splice(0, w.celebrations.length - 5);
}

export function toast(w: World, title: string, tone: NewsItem['tone'] = 'neutral', extra: Omit<NotifyInput, 'title' | 'tone'> = {}): void {
  notify(w, { title, tone, ...extra });
}

export function playerCompany(w: World): Company {
  return w.companies[w.player.companyId];
}

export function isPlayerGroup(w: World, c: Company): boolean {
  return c.isPlayer || c.parentId === w.player.companyId;
}

/** Top-level company of a group (parent if subsidiary). */
export function groupRoot(w: World, c: Company): Company {
  let cur = c;
  let guard = 0;
  while (cur.parentId && w.companies[cur.parentId] && guard++ < 5) cur = w.companies[cur.parentId];
  return cur;
}

export function activeCompanies(w: World): Company[] {
  const out: Company[] = [];
  for (const id in w.companies) {
    const c = w.companies[id];
    if (c.status === 'active') out.push(c);
  }
  return out;
}

// Per-company game index (not serialised). Rebuilt lazily when games are
// added or change hands; status changes don't need a rebuild.
const gameIndex = new WeakMap<World, Map<string, Game[]>>();

export function markGamesDirty(w: World): void {
  gameIndex.delete(w);
}

export function addGame(w: World, g: Game): void {
  w.games[g.id] = g;
  markGamesDirty(w);
}

export function gamesOf(w: World, companyId: string): Game[] {
  let idx = gameIndex.get(w);
  if (!idx) {
    idx = new Map();
    for (const id in w.games) {
      const g = w.games[id];
      let list = idx.get(g.companyId);
      if (!list) idx.set(g.companyId, (list = []));
      list.push(g);
    }
    gameIndex.set(w, idx);
  }
  return idx.get(companyId) ?? [];
}

export function companyGames(w: World, companyId: string): Game[] {
  return gamesOf(w, companyId);
}

export function liveGames(w: World): Game[] {
  const out: Game[] = [];
  for (const id in w.games) {
    const g = w.games[id];
    if (g.status === 'released') out.push(g);
  }
  return out;
}

/** Push a sample onto a series; thin older samples so saves stay small. */
export function pushPoint(series: Point[], day: number, value: number, maxLen = 420): void {
  series.push([day, value]);
  if (series.length > maxLen) thinSeries(series, day);
}

export function thinSeries<T extends [number, ...number[]]>(series: T[], day: number): void {
  // Keep daily resolution for 120 days, weekly for 2 years, monthly beyond.
  const out: T[] = [];
  let lastKept = -Infinity;
  for (const p of series) {
    const age = day - p[0];
    const step = age <= 120 ? 1 : age <= 730 ? 7 : 30;
    if (p[0] - lastKept >= step || age <= 120) {
      out.push(p);
      lastKept = p[0];
    }
  }
  series.length = 0;
  for (const p of out) series.push(p);
}

export function sumBy<T>(items: T[], f: (t: T) => number): number {
  let s = 0;
  for (const it of items) s += f(it);
  return s;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Stable 32-bit hash of a string (for deterministic per-item variation). */
export function hashString(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Steam-style label for a player review score. */
export function reviewLabel(score: number, players = 1000): string {
  if (players < 50) return 'Too few reviews';
  if (score >= 95) return 'Overwhelmingly Positive';
  if (score >= 85) return 'Very Positive';
  if (score >= 75) return 'Mostly Positive';
  if (score >= 55) return 'Mixed';
  if (score >= 35) return 'Mostly Negative';
  return 'Overwhelmingly Negative';
}
