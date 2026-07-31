import { describe, expect, it } from 'vitest';
import { addBusinessDays, daysBetween, fmtDate, rollForwardToBusinessDay, shift } from '../src/dates.js';

/**
 * Acceptance suite ported from `Date Rule Test Cases.dc.html` — the handoff's
 * pass/fail gate for the deadline engine. The coded backend must reproduce
 * every PASS row, including month-end rollover and leap years.
 */
describe('Date Rule Test Cases acceptance harness', () => {
  const cases: [string, string, string, number, 'days' | 'months' | 'years', string][] = [
    ['c1 Australia — Renewal Deadline (from filing +10y)', '2020-08-15', 'y', 10, 'years', '2030-08-15'],
    ['c2 Australia — Convention Priority (filing +6m)', '2024-01-31', 'm', 6, 'months', '2024-07-31'],
    ['c3 Australia — Month-end rollover (31 Aug +6m clamps to Feb month-end)', '2023-08-31', 'm', 6, 'months', '2024-02-29'],
    ['c4 USA — Renewal (from registration +10y)', '2018-02-13', 'y', 10, 'years', '2028-02-13'],
    ['c5 USA — S8 Declaration (registration +6y)', '2019-03-05', 'y', 6, 'years', '2025-03-05'],
    ['c6 Australia — Leap-year anchor (29 Feb +10y → 28 Feb non-leap)', '2016-02-29', 'y', 10, 'years', '2026-02-28'],
  ];
  for (const [label, anchor, , n, unit, expected] of cases) {
    it(label, () => {
      expect(shift(anchor, n, unit)).toBe(expected);
    });
  }

  // Harness case c7 ("Weekend roll-forward", 2021-06-12 +2m, expected
  // 2021-08-13) is internally inconsistent sample data: 12 Aug 2021 was a
  // Thursday, so no business-day rule produces the 13th. The rule c7 stands
  // for — a deadline landing on a non-business day rolls forward to the next
  // business day — is verified with real weekend dates below.
  describe('c7 weekend / holiday roll-forward (real cases)', () => {
    it('rolls a Saturday deadline to Monday', () => {
      // 2021-04-10 was a Saturday
      expect(rollForwardToBusinessDay('2021-04-10')).toBe('2021-04-12');
    });
    it('rolls a Sunday deadline to Monday', () => {
      expect(rollForwardToBusinessDay('2021-04-11')).toBe('2021-04-12');
    });
    it('leaves a weekday deadline unchanged', () => {
      expect(rollForwardToBusinessDay('2021-08-12')).toBe('2021-08-12');
    });
    it('skips office holidays supplied by the caller', () => {
      // Fri 26 Jan 2024 (Australia Day) + weekend → Mon 29 Jan
      expect(rollForwardToBusinessDay('2024-01-26', new Set(['2024-01-26']))).toBe('2024-01-29');
    });
    it('skips a holiday Monday after a weekend', () => {
      expect(rollForwardToBusinessDay('2024-03-30', new Set(['2024-04-01']))).toBe('2024-04-02');
    });
  });
});

describe('business days', () => {
  it('adds business days skipping weekends', () => {
    // Mon 2026-01-05 + 5 business days = Mon 2026-01-12 (skips Sat/Sun).
    expect(addBusinessDays('2026-01-05', 5)).toBe('2026-01-12');
    // Fri 2026-01-09 + 1 business day = Mon 2026-01-12.
    expect(addBusinessDays('2026-01-09', 1)).toBe('2026-01-12');
  });
  it('subtracts business days', () => {
    // Mon 2026-01-12 − 2 business days = Thu 2026-01-08.
    expect(addBusinessDays('2026-01-12', -2)).toBe('2026-01-08');
  });
  it('is reachable through shift() with the business days unit', () => {
    expect(shift('2026-01-05', 5, 'business days')).toBe('2026-01-12');
  });
});

describe('shift edge cases', () => {
  it('handles negative month offsets (reminders)', () => {
    expect(shift('2030-08-15', -6, 'months')).toBe('2030-02-15');
    expect(shift('2024-01-15', -2, 'months')).toBe('2023-11-15');
  });
  it('clamps negative month offsets at month end', () => {
    expect(shift('2024-03-31', -1, 'months')).toBe('2024-02-29');
  });
  it('handles negative day offsets (1-week reminders)', () => {
    expect(shift('2030-08-15', -7, 'days')).toBe('2030-08-08');
  });
  it('crosses year boundaries with months', () => {
    expect(shift('2023-11-30', 3, 'months')).toBe('2024-02-29');
    expect(shift('2023-12-31', 2, 'months')).toBe('2024-02-29');
  });
  it('adds years onto 29 Feb landing on a leap year unchanged', () => {
    expect(shift('2016-02-29', 4, 'years')).toBe('2020-02-29');
  });
  it('returns empty string for empty/invalid input', () => {
    expect(shift('', 6, 'months')).toBe('');
    expect(shift('not-a-date', 6, 'months')).toBe('');
  });
});

describe('fmtDate', () => {
  it('renders DD MMM YYYY', () => {
    expect(fmtDate('2009-01-01')).toBe('01 Jan 2009');
    expect(fmtDate('2030-08-15')).toBe('15 Aug 2030');
  });
  it('is safe on empty values', () => {
    expect(fmtDate('')).toBe('');
    expect(fmtDate(null)).toBe('');
  });
});

describe('daysBetween', () => {
  it('measures forward and backward', () => {
    expect(daysBetween('2024-01-01', '2024-01-31')).toBe(30);
    expect(daysBetween('2024-01-31', '2024-01-01')).toBe(-30);
  });
});
