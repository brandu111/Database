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
  if (u === 'business days') return addBusinessDays(iso, v);
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

/**
 * Add (or subtract, when `n` is negative) `n` business days to an ISO date,
 * skipping Saturdays and Sundays. The result itself is always a business day.
 * Used for deadlines quoted in working days (e.g. the AU Headstart Part 2 fee).
 */
export function addBusinessDays(iso: string, n: number): string {
  if (!iso || !isValidISO(iso)) return '';
  const step = n >= 0 ? 1 : -1;
  let remaining = Math.abs(n);
  let cur = iso;
  while (remaining > 0) {
    cur = shift(cur, step, 'days');
    const dow = dayOfWeek(cur);
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return cur;
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

/** Whole days from `fromISO` to `toISO` (positive when toISO is later). */
export function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + 'T00:00:00Z').getTime();
  const b = new Date(toISO + 'T00:00:00Z').getTime();
  return Math.round((b - a) / 86400000);
}
