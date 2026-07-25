import { describe, expect, it } from 'vitest';
import { mapApiTrademark } from '../src/ipaustralia.js';

/**
 * Field-mapping tests for the IP Australia ApiTrademark → Mark conversion,
 * shaped from the Australian Trade Mark Search API OAS response schema.
 */
describe('mapApiTrademark', () => {
  const sample = {
    number: '1234567',
    words: ['SCOLIBRACE'],
    kind: ['Word'],
    markCategories: ['Word'],
    goodsAndServices: [
      { class: '10', descriptionText: 'Orthopaedic braces' },
      { class: '10', descriptionText: 'Orthotic supports' },
      { class: '44', descriptionText: 'Medical services' },
    ],
    owner: [
      {
        name: 'ScoliCare IP Pty Ltd',
        abn: '12345678901',
        acnOrArbn: '123456789',
        jurisdiction: 'AU',
        structuredAddress: { addressLineText: '1 Example St', suburb: 'Kogarah', state: 'NSW', postalCode: '2217', countryName: 'Australia' },
      },
    ],
    filingDate: '2014-03-04',
    firstReportDate: '2014-05-01',
    acceptanceAdvertisedDate: '2014-09-18',
    enteredOnRegisterDate: '2014-11-18',
    statusGroup: 'Registered',
    statusDetail: 'Registered/protected',
  };

  it('maps mark name, classes and goods/services', () => {
    const m = mapApiTrademark(sample);
    expect(m.name).toBe('SCOLIBRACE');
    expect(m.type).toBe('Word');
    expect(m.application).toBe('1234567');
    expect(m.classes).toBe('10, 44');
    expect(m.goods).toContain('Class 10: Orthopaedic braces');
    expect(m.goods).toContain('Class 44: Medical services');
    expect(m.status).toBe('Registered');
    expect(m.jurisdiction).toBe('Australia');
  });

  it('maps owner name, address, ABN and ACN', () => {
    const m = mapApiTrademark(sample);
    expect(m.owner).toBe('ScoliCare IP Pty Ltd');
    expect(m.ownerType).toBe('Company');
    expect(m.ownerAbn).toBe('12345678901');
    expect(m.ownerAcn).toBe('123456789');
    expect(m.address1).toBe('1 Example St');
    expect(m.city).toBe('Kogarah');
    expect(m.state).toBe('NSW');
    expect(m.zip).toBe('2217');
    expect(m.country).toBe('Australia');
  });

  it('maps the register dates onto the engine anchor rows (done=true)', () => {
    const m = mapApiTrademark(sample);
    const byName = Object.fromEntries((m.dates || []).map((d) => [d.name, d]));
    expect(byName['Application Filed'].date).toBe('2014-03-04');
    expect(byName['Application Filed'].done).toBe(true);
    expect(byName['OA Issued'].date).toBe('2014-05-01');
    expect(byName['Publication Date'].date).toBe('2014-09-18');
    expect(byName['Registration Date'].date).toBe('2014-11-18');
  });

  it('handles the spec\'s nullable fields without throwing', () => {
    const m = mapApiTrademark({ number: '999', words: null, owner: null, goodsAndServices: null, filingDate: null });
    expect(m.application).toBe('999');
    expect(m.name).toBe('');
    expect(m.classes).toBe('');
    expect(m.dates).toEqual([]);
    expect(m.status).toBe('Pending');
  });

  it('extracts classes from the classNumber / niceClass field variants', () => {
    const m = mapApiTrademark({
      number: '7',
      words: ['ACME'],
      goodsAndServices: [
        { classNumber: 25, descriptionText: 'Clothing' },
        { niceClass: '9', descriptionText: 'Software' },
      ],
    } as never);
    expect(m.classes).toBe('9, 25');
    expect(m.goods).toContain('Class 25: Clothing');
    expect(m.goods).toContain('Class 9: Software');
  });

  it('falls back to a top-level class list and sorts numerically', () => {
    const m = mapApiTrademark({ number: '8', words: ['ACME'], classes: [3, 30, 5] } as never);
    expect(m.classes).toBe('3, 5, 30');
  });

  it('classifies an individual owner (no ABN/ACN) and a logo mark', () => {
    const m = mapApiTrademark({
      number: '5',
      words: [],
      markCategories: ['Fancy/Device'],
      images: { description: ['device'], images: ['https://cdn.search.ipaustralia.gov.au/x/T1/1.0/T1.MEDIUM.png'] },
      owner: [{ name: 'Jane Smith' }],
    });
    expect(m.type).toBe('Logo');
    expect(m.ownerType).toBe('Individual');
    expect(m.image).toBe('https://cdn.search.ipaustralia.gov.au/x/T1/1.0/T1.MEDIUM.png');
  });
});
