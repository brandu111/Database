import { describe, expect, it } from 'vitest';
import { mergeTemplate, mergeTemplateHtml, stripInlineFormat } from '../src/merge.js';
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

describe('mergeTemplateHtml', () => {
  it('renders the mark as text when the case has no graphic', () => {
    const out = mergeTemplateHtml('Re: [TrademarkName]', { ...mark, image: null });
    expect(out).toBe('Re: BRANDU');
  });

  it('renders the mark as an inline image when the case has a graphic', () => {
    const out = mergeTemplateHtml('Re: [TrademarkName]', { ...mark, image: '/files/logo.png' });
    expect(out).toContain('<img src="/files/logo.png"');
    expect(out).toContain('alt="BRANDU"');
    expect(out).not.toContain('BRANDU<');
  });

  it('prefers the provided data-URI image (for pasting into email)', () => {
    const out = mergeTemplateHtml('[Logo]', mark, { markImage: 'data:image/png;base64,AAAA' });
    expect(out).toContain('src="data:image/png;base64,AAAA"');
  });

  it('escapes literal text and converts newlines to <br>', () => {
    const out = mergeTemplateHtml('A < B\nnext', { ...mark, image: null });
    expect(out).toBe('A &lt; B<br>next');
  });

  it('leaves unknown tokens and resolves dates in HTML', () => {
    const out = mergeTemplateHtml('Due [RenewalDeadline]; fee [FEES]', { ...mark, image: null });
    expect(out).toBe('Due 15 Aug 2030; fee [FEES]');
  });

  it('renders **bold** and __underline__ markers in the HTML, safely', () => {
    const out = mergeTemplateHtml('Please **note** the __deadline__ for [RenewalDeadline].', { ...mark, image: null });
    expect(out).toBe('Please <strong>note</strong> the <u>deadline</u> for 15 Aug 2030.');
    // Markers only format literal text; they never let raw HTML through.
    const safe = mergeTemplateHtml('**<b>x</b>**', { ...mark, image: null });
    expect(safe).toBe('<strong>&lt;b&gt;x&lt;/b&gt;</strong>');
  });

  it('strips the markers for the plain-text version', () => {
    expect(stripInlineFormat('Please **note** the __deadline__')).toBe('Please note the deadline');
  });

  it('inserts an HTML signature unescaped, but escapes a plain-text one', () => {
    const withHtml = mergeTemplateHtml('[Signature]', { ...mark, image: null }, { signatureHtml: '<b>Nat</b><img src="data:x">' });
    expect(withHtml).toBe('<b>Nat</b><img src="data:x">');
    const plain = mergeTemplateHtml('[Signature]', { ...mark, image: null }, { signature: 'Nat & Co' });
    expect(plain).toBe('Nat &amp; Co');
  });
});
