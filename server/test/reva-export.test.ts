import { describe, expect, it } from 'vitest';
import type { Mark } from '@brandu/shared';
import { fullRowToMark } from '../src/import-marks.js';
import { REVA_COLUMNS, toRevaCsv } from '../src/reva-export.js';

/** Parse the single data row of a CSV back into a {header: value} map. */
function parseRow(csv: string): Record<string, string> {
  const [head, body] = csv.trim().split('\r\n');
  const cols: string[] = [];
  const cells: string[] = [];
  for (const [line, out] of [[head, cols], [body, cells]] as const) {
    let cur = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { out.push(cur); cur = ''; }
      else cur += c;
    }
    out.push(cur);
  }
  return Object.fromEntries(cols.map((c, i) => [c, cells[i] ?? '']));
}

describe('Reva-format export', () => {
  it('round-trips core fields and legacy date columns verbatim', () => {
    const today = '2999-01-01'; // force all past dates to import ticked/pinned
    const row: Record<string, string> = {
      MarkName: 'ROUNDTRIP',
      Type: 'Word',
      Jurisdiction: 'Australia',
      Status: 'Registered',
      ApplicationNo: '1234567',
      RegistrationNo: '7654321',
      OurRef: 'TM-1001',
      ClientRef: 'CL-9',
      GoodsServices: 'Class 9 software, with, comma',
      OwnerName: 'Acme Pty Ltd',
      'Application Filed': '2020-08-15',
      'Registration Date': '2021-02-10',
      'Renewal Deadline': '2030-08-15',
    };
    const m = fullRowToMark(row, today) as Mark;
    const back = parseRow(toRevaCsv([m]));

    // Header is the exact 205-column Reva layout.
    expect(toRevaCsv([m]).split('\r\n')[0].split(',').length).toBe(REVA_COLUMNS.length);
    // Core fields.
    expect(back.MarkName).toBe('ROUNDTRIP');
    expect(back.ApplicationNo).toBe('1234567');
    expect(back.OurRef).toBe('TM-1001');
    expect(back.OwnerName).toBe('Acme Pty Ltd');
    // A value containing commas survives quoting.
    expect(back.GoodsServices).toBe('Class 9 software, with, comma');
    // Legacy date columns come back verbatim, ISO.
    expect(back['Application Filed']).toBe('2020-08-15');
    expect(back['Renewal Deadline']).toBe('2030-08-15');
    // A column with no data on the case stays empty.
    expect(back['Appeal deadline']).toBe('');
  });
});
