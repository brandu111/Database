import type { DateUnit } from './types.js';

/**
 * Calendar arithmetic for statutory deadlines.
 *
 * Semantics follow the acceptance harness ("Date Rule Test Cases"), which is
 * the spec for the coded engine:
 *  - adding months clamps to the end of the target month
 *    (31 Aug + 6 months → 29 Feb in a leap year, 28 Feb otherwise);
 *  - adding years clamps 29 Feb to 28 Feb in non-leap target years;
 *  - days are exact.
 * All dates are ISO `yyyy-mm-dd` strings in the local civil calendar — no
 * timezone component is ever involved.
 */

const pad = (n: number) => String(n).padStart(2, '0');

export function isValidISO(iso: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(iso) && !Number.isNaN(Date.parse(iso + 'T00:00:00Z'));
}

function toParts(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map((x) => parseInt(x, 10));
  return { y, m, d };
}

function fromParts(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** Shift an ISO date by v units. Returns '' for empty/invalid input. */
export function shift(iso: string, v: number, u: DateUnit): string {
  if (!iso || !isValidISO(iso)) return '';
  const { y, m, d } = toParts(iso);
  if (u === 'days') {
    const t = new Date(Date.UTC(y, m - 1, d));
    t.setUTCDate(t.getUTCDate() + v);
    return fromParts(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
  }
  if (u === 'years') {
    const ty = y + v;
    return fromParts(ty, m, Math.min(d, daysInMonth(ty, m)));
  }
  // months: clamp to end of target month
  const total = y * 12 + (m - 1) + v;
  const ty = Math.floor(total / 12);
  const tm = (total % 12 + 12) % 12; // 0-based
  return fromParts(ty, tm + 1, Math.min(d, daysInMonth(ty, tm + 1)));
}

/** Day of week for an ISO date: 0=Sunday … 6=Saturday. */
export function dayOfWeek(iso: string): number {
  const { y, m, d } = toParts(iso);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/**
 * Roll a deadline that lands on a non-business day forward to the next
 * business day. `holidays` is a set of ISO dates from the relevant
 * IP office's calendar (jurisdiction-specific; supplied by the caller —
 * weekends alone are handled by default).
 */
export function rollForwardToBusinessDay(iso: string, holidays?: ReadonlySet<string>): string {
  if (!iso || !isValidISO(iso)) return '';
  let cur = iso;
  for (let i = 0; i < 366; i++) {
    const dow = dayOfWeek(cur);
    const isWeekend = dow === 0 || dow === 6;
    const isHoliday = holidays ? holidays.has(cur) : false;
    if (!isWeekend && !isHoliday) return cur;
    cur = shift(cur, 1, 'days');
  }
  return cur;
}

/** Format ISO yyyy-mm-dd as DD MMM YYYY — the single system-wide display format. */
export function fmtDate(v: string | null | undefined): string {
  if (!v) return '';
  const p = String(v).slice(0, 10).split('-');
  if (p.length !== 3) return String(v);
  const mons = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const m = parseInt(p[1], 10);
  if (!m || m < 1 || m > 12) return String(v);
  return `${p[2]} ${mons[m - 1]} ${p[0]}`;
}

export function todayISO(now: Date = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

/** Normalise a possibly 2-digit year to a 4-digit one (windowed around 2000). */
function normYear(y: number): number {
  if (y >= 100) return y;
  return y <= 69 ? 2000 + y : 1900 + y;
}

function makeISO(y: number, m: number, d: number): string {
  if (!y || m < 1 || m > 12 || d < 1) return '';
  const yy = normYear(y);
  if (d > daysInMonth(yy, m)) return '';
  return fromParts(yy, m, d);
}

/**
 * Parse a human-typed date into ISO `yyyy-mm-dd`, so dates can be edited by
 * typing instead of using a date picker. Day-first (Australian) convention.
 * Accepts, case-insensitively:
 *   2026-07-25 · 2026/07/25 · 25/07/2026 · 25-07-2026 · 25.07.2026 · 25 07 2026
 *   25 Jul 2026 · 25 July 2026 · Jul 25 2026 · Jul 25, 2026 · 25Jul2026
 *   25/7/26 (2-digit year)
 * Returns '' if the text cannot be understood.
 */
export function parseDateInput(input: string): string {
  const s = (input || '').trim();
  if (!s) return '';
  // ISO / year-first: 2026-07-25 or 2026/07/25
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/);
  if (m) return makeISO(+m[1], +m[2], +m[3]);
  // Day-first numeric: 25/07/2026, 25-07-26, 25.7.2026, 25 07 2026
  m = s.match(/^(\d{1,2})[-/.\s](\d{1,2})[-/.\s](\d{2,4})$/);
  if (m) return makeISO(+m[3], +m[2], +m[1]);
  // Day then month name: 25 Jul 2026 / 25July2026 / 25-Jul-2026
  m = s.match(/^(\d{1,2})[-/.\s]*([A-Za-z]{3,})[-/.,\s]*(\d{2,4})$/);
  if (m) {
    const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mon >= 0) return makeISO(+m[3], mon + 1, +m[1]);
  }
  // Month name then day: Jul 25 2026 / July 25, 2026
  m = s.match(/^([A-Za-z]{3,})[-/.,\s]*(\d{1,2})[-/.,\s]+(\d{2,4})$/);
  if (m) {
    const mon = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase());
    if (mon >= 0) return makeISO(+m[3], mon + 1, +m[2]);
  }
  return '';
}

/** Whole days from `fromISO` to `toISO` (positive when toISO is later). */
export function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + 'T00:00:00Z').getTime();
  const b = new Date(toISO + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}
