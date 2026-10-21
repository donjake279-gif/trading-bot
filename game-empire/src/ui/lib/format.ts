import { formatDate } from '../../engine/util';

/** Short names for huge numbers: quintillion up to decillion. */
const BIG: [number, string][] = [
  [1e33, 'Dc'],
  [1e30, 'No'],
  [1e27, 'Oc'],
  [1e24, 'Sp'],
  [1e21, 'Sx'],
  [1e18, 'Qi'],
];

function huge(a: number, digits: number): string | null {
  if (a >= 0.9995e36) return a.toExponential(digits);
  for (const [v, u] of BIG) if (a >= v * 0.9995) return `${(a / v).toFixed(digits)}${u}`;
  return null;
}

export function money(n: number, digits?: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const h = huge(a, digits ?? 2);
  if (h) return `${sign}$${h}`;
  if (a >= 0.9995e15) return `${sign}$${(a / 1e15).toFixed(digits ?? 2)}Q`;
  if (a >= 0.9995e12) return `${sign}$${(a / 1e12).toFixed(digits ?? 2)}T`;
  if (a >= 0.9995e9) return `${sign}$${(a / 1e9).toFixed(digits ?? 2)}B`;
  if (a >= 0.9995e6) return `${sign}$${(a / 1e6).toFixed(digits ?? 1)}M`;
  if (a >= 9999.5) return `${sign}$${(a / 1e3).toFixed(digits ?? 0)}K`;
  if (a >= 999.5) return `${sign}$${(a / 1e3).toFixed(digits ?? 1)}K`;
  return `${sign}$${a.toFixed(digits ?? 0)}`;
}

export function moneyFull(n: number): string {
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
}

export function num(n: number, digits?: number): string {
  if (!Number.isFinite(n)) return '—';
  const a = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  const h = huge(a, digits ?? 2);
  if (h) return `${sign}${h}`;
  if (a >= 1e15) return `${sign}${(a / 1e15).toFixed(digits ?? 2)}Q`;
  if (a >= 1e12) return `${sign}${(a / 1e12).toFixed(digits ?? 2)}T`;
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(digits ?? 2)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(digits ?? 2)}M`;
  if (a >= 1e4) return `${sign}${(a / 1e3).toFixed(digits ?? 0)}K`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(digits ?? 1)}K`;
  return `${sign}${Math.round(a)}`;
}

export function int(n: number): string {
  return Math.round(n).toLocaleString('en-US');
}

export function pct(n: number, digits = 0): string {
  if (!Number.isFinite(n)) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function signedPct(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return '—';
  return `${n >= 0 ? '+' : ''}${(n * 100).toFixed(digits)}%`;
}

export function signedMoney(n: number): string {
  return `${n >= 0 ? '+' : ''}${money(n)}`;
}

export function date(day: number): string {
  return formatDate(day);
}

export function days(n: number): string {
  if (n < 1) return '<1 day';
  if (n < 60) return `${Math.round(n)} days`;
  if (n < 730) return `${(n / 30).toFixed(1)} months`;
  return `${(n / 365).toFixed(1)} years`;
}

export function scoreTone(score: number): 'good' | 'warn' | 'bad' {
  return score >= 75 ? 'good' : score >= 50 ? 'warn' : 'bad';
}

/** Dark-mode categorical series (validated against the app surface). */
export const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9', '#e66767'];
export const OTHER = '#5b6878';
export const GRID = '#1f2a37';
export const AXIS = '#6b7a8a';
