// The yearly rhythm of the games industry: weekends, holidays, seasonal sales,
// GameExpo and the awards. Pure date helpers plus market multipliers.
import { dayToDate } from './util';

export interface DateParts {
  year: number;
  month: number; // 0-11
  date: number; // 1-31
  weekday: number; // 0 Sunday .. 6 Saturday
}

export function parts(day: number): DateParts {
  const d = dayToDate(day);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), date: d.getUTCDate(), weekday: d.getUTCDay() };
}

/** Is month/date inside [start, end] (inclusive), allowing a wrap over New Year. */
function within(month: number, date: number, start: [number, number], end: [number, number]): boolean {
  const v = month * 100 + date;
  const a = start[0] * 100 + start[1];
  const b = end[0] * 100 + end[1];
  return a <= b ? v >= a && v <= b : v >= a || v <= b;
}

export const SUMMER_SALE: { start: [number, number]; end: [number, number] } = { start: [5, 25], end: [6, 8] };
export const HOLIDAY_SALE: { start: [number, number]; end: [number, number] } = { start: [11, 18], end: [0, 2] };
export const EXPO_DATE: [number, number] = [5, 10];
export const AWARDS_DATE: [number, number] = [11, 12];
export const NOMINATIONS_DAY: [number, number] = [10, 18];

export function saleActive(day: number): 'summer' | 'holiday' | null {
  const p = parts(day);
  if (within(p.month, p.date, SUMMER_SALE.start, SUMMER_SALE.end)) return 'summer';
  if (within(p.month, p.date, HOLIDAY_SALE.start, HOLIDAY_SALE.end)) return 'holiday';
  return null;
}

export function saleEndDay(day: number): number {
  let d = day;
  while (saleActive(d) && d - day < 40) d++;
  return d;
}

/** How many more people browse for games today than on an average day. */
export function shopperMult(day: number): number {
  const p = parts(day);
  let m = p.weekday === 0 || p.weekday === 6 ? 1.15 : p.weekday === 5 ? 1.05 : 0.96;
  if (within(p.month, p.date, [10, 20], [0, 5])) m *= 1.25; // holiday season
  else if (within(p.month, p.date, [5, 15], [7, 31])) m *= 1.08; // summer break
  return m;
}

/** Concurrent players swing with the week: busy weekends, quiet mid-week. */
export function ccuMult(day: number): number {
  const w = parts(day).weekday;
  return w === 0 || w === 6 ? 1.12 : w === 5 ? 1.05 : 0.96;
}

export interface CalendarEvent {
  name: string;
  day: number;
  kind: 'sale' | 'expo' | 'awards' | 'season';
  detail: string;
}

function nextOccurrence(day: number, md: [number, number]): number {
  for (let d = day; d < day + 370; d++) {
    const p = parts(d);
    if (p.month === md[0] && p.date === md[1]) return d;
  }
  return day + 365;
}

export function upcomingEvents(day: number, count = 4): CalendarEvent[] {
  const events: CalendarEvent[] = [
    { name: 'GameExpo', day: nextOccurrence(day, EXPO_DATE), kind: 'expo', detail: 'Book a booth to hype your games in development.' },
    { name: 'Summer Sale', day: nextOccurrence(day, SUMMER_SALE.start), kind: 'sale', detail: 'Discounted games sell far more for two weeks.' },
    { name: 'Holiday season', day: nextOccurrence(day, [10, 20]), kind: 'season', detail: 'Players buy 25% more games until early January.' },
    { name: 'Holiday Sale', day: nextOccurrence(day, HOLIDAY_SALE.start), kind: 'sale', detail: 'The biggest sale of the year.' },
    { name: 'Global Game Jam', day: nextOccurrence(day, [6, 20]), kind: 'season', detail: 'One weekend, one theme, one tiny game. Great for your combo book.' },
    { name: 'Game Awards nominations', day: nextOccurrence(day, NOMINATIONS_DAY), kind: 'awards', detail: 'Games released in the last year compete in 14 categories.' },
    { name: 'The Game Awards', day: nextOccurrence(day, AWARDS_DATE), kind: 'awards', detail: 'The biggest night in games. Winners get a huge boost in players and reputation.' },
  ];
  const now = saleActive(day);
  if (now) events.push({ name: now === 'summer' ? 'Summer Sale (on now)' : 'Holiday Sale (on now)', day, kind: 'sale', detail: 'Put your premium games on sale to cash in.' });
  return events.sort((a, b) => a.day - b.day).slice(0, count);
}
