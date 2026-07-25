import { describe, expect, it } from 'vitest';
import { mergeTemplate } from '../src/merge.js';
import type { Mark } from '../src/types.js';

/**
 * Merge engine: `[Field]` / `{{field}}` placeholders resolve from static case
 * fields, the case's date rows (by name), or are left untouched when unknown
 * (attorney fill-ins). Covers the real Reva-style templates the firm imports.
 */
const mark: Partial<Mark> = {
  name: 'BRANDU',
  jurisdiction: 'Australia',
  application: '2345678',
  registration: '2345678',
  irNumber: '1650000',
  classes: '9, 42',
  goods: 'Software; legal services',
  status: 'Registered',
  owner: 'BrandU Pty Ltd',
  ownerAcn: '600 123 456',
  ownerAbn: '12 600 123 456',
  matter: 'TM-1001',
  address1: '1 Legal St',
  city: 'Sydney',
  state: 'NSW',
  zip: '2000',
  country: 'Australia',
  contacts: [{ name: 'Natalie Smith', position: 'Client', email: 'n@x.com' } as never],
  dates: [
    { name: 'Application Filed', date: '2020-08-15' },
    { name: 'Renewal Deadline', date: '2030-08-15' },
    { name: 'OA Response Due', date: '2026-09-01' },
  ] as never,
};

describe('mergeTemplate', () => {
  it('resolves static bracket fields', () => {
    expect(mergeTemplate('Re: [TrademarkName] ([ApplicationNumber])', mark)).toBe('Re: BRANDU (2345678)');
  });

  it('resolves curly and case-insensitive tokens', () => {
    expect(mergeTemplate('Owner: {{OwnerName}} / {{ owner name }}', mark)).toBe('Owner: BrandU Pty Ltd / BrandU Pty Ltd');
  });

  it('resolves date-row names by placeholder', () => {
    expect(mergeTemplate('Your renewal falls due on [RenewalDeadline].', mark)).toBe('Your renewal falls due on 15 Aug 2030.');
    expect(mergeTemplate('Please respond by [OA Response Due].', mark)).toBe('Please respond by 01 Sep 2026.');
  });

  it('leaves unknown attorney fill-in tokens untouched', () => {
    expect(mergeTemplate('Our fee is [FEES]. [ATTORNEY TO COMPLETE]', mark)).toBe('Our fee is [FEES]. [ATTORNEY TO COMPLETE]');
  });

  it('fills firm signature and due date from context', () => {
    const out = mergeTemplate('Deadline [DueDate].\n[Signature]', mark, { dueDate: '2026-12-01', signature: 'BrandU Legal' });
    expect(out).toBe('Deadline 01 Dec 2026.\nBrandU Legal');
  });

  it('supports ACN / ABN and client first name', () => {
    expect(mergeTemplate('Dear [FirstName], ACN [ACN] ABN [ABN]', mark)).toBe('Dear Natalie, ACN 600 123 456 ABN 12 600 123 456');
  });
});
