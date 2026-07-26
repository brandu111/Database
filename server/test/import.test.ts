import { describe, expect, it } from 'vitest';
import { csvRowToMark, parseImportDate } from '../src/import-marks.js';

describe('parseImportDate', () => {
  it('accepts dd/mm/yyyy, yyyy-mm-dd and 2-digit years, rejects nonsense', () => {
    expect(parseImportDate('15/08/2020')).toBe('2020-08-15');
    expect(parseImportDate('2021-02-10')).toBe('2021-02-10');
    expect(parseImportDate('5-3-99')).toBe('1999-03-05');
    expect(parseImportDate('31/02/2020')).toBe('');
    expect(parseImportDate('')).toBe('');
  });
});

describe('csvRowToMark', () => {
  it('maps loose headers, cleans classes, and builds anchor dates', () => {
    const m = csvRowToMark({
      'Mark Name': 'BRANDU',
      Country: 'Australia',
      Status: 'Registered',
      'Application No': '2345678',
      Class: '09, 42 ; 9',
      'Owner Name': 'BrandU Pty Ltd',
      ABN: '12 600 123 456',
      'Filed Date': '15/08/2020',
      'Registration Date': '10/02/2021',
      'Client Contact Email': 'jane@example.com',
    });
    expect(m.name).toBe('BRANDU');
    expect(m.jurisdiction).toBe('Australia');
    expect(m.classes).toBe('9, 42');
    expect(m.registration).toBe('2345678'); // AU: reg = app once registered
    expect(m.ownerType).toBe('Company');
    expect(m.dates?.find((d) => d.name === 'Application Filed')?.date).toBe('2020-08-15');
    expect(m.dates?.find((d) => d.name === 'Registration Date')?.date).toBe('2021-02-10');
    expect(m.contacts?.[0]?.email).toBe('jane@example.com');
  });

  it('pins an explicit renewal date and infers status', () => {
    const m = csvRowToMark({ MarkName: 'ACME', RegistrationDate: '2021-02-10', RenewalDate: '2031-02-10' });
    expect(m.status).toBe('Registered');
    const ren = m.dates?.find((d) => d.name === 'Renewal Deadline');
    expect(ren?.date).toBe('2031-02-10');
    expect(ren?.pinned).toBe(true);
  });

  it('maps the new practice-management fields (attorney, associate, tags, fee)', () => {
    const m = csvRowToMark({
      MarkName: 'ACME',
      ResponsibleAttorney: 'Natalie Brandu',
      Associate: 'Smith IP',
      AssociateRef: 'SIP-1',
      Tags: 'key brand; watch',
      RenewalFee: '$450',
    });
    expect(m.attorney).toBe('Natalie Brandu');
    expect(m.associate).toBe('Smith IP');
    expect(m.associateRef).toBe('SIP-1');
    expect(m.tags).toEqual(['key brand', 'watch']);
    expect(m.renewalFee).toBe(450);
  });

  it('throws when the mark name is missing', () => {
    expect(() => csvRowToMark({ Jurisdiction: 'Australia' })).toThrow(/MarkName/);
  });
});
