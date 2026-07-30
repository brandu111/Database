import type { Company, CompanyContact } from '@brandu/shared';

/**
 * CSV → Company mapping for bulk contact/company import. One CSV row = one
 * contact; rows are grouped into companies by CompanyName. Headers are matched
 * case/space/underscore-insensitively against the aliases below.
 */

const ALIASES: Record<string, string[]> = {
  name: ['companyname', 'company', 'name', 'owner'],
  type: ['type', 'companytype', 'structure'],
  contactType: ['contacttype', 'role', 'category'],
  address1: ['addressone', 'address1', 'address', 'addressline1'],
  address2: ['addresstwo', 'address2', 'addressline2'],
  city: ['city', 'suburb', 'town'],
  state: ['state', 'stateprovince', 'province'],
  zip: ['postcode', 'postalcode', 'zip', 'zipcode'],
  country: ['country'],
  companyPhone: ['companyphone', 'phone', 'telephone'],
  companyEmail: ['companyemail', 'email'],
  website: ['website', 'web', 'url'],
  contactName: ['contactname', 'contact'],
  contactFirst: ['contactfirstname', 'firstname', 'first'],
  contactLast: ['contactlastname', 'lastname', 'last', 'surname'],
  contactTitle: ['contacttitle', 'title', 'position'],
  contactEmail: ['contactemail', 'emailaddress'],
  contactPhone: ['contactphone', 'directphone'],
  contactMobile: ['contactmobile', 'contactmobilephone', 'mobile', 'cell'],
  notes: ['notes', 'comments'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

function fieldGetter(row: Record<string, string>): (field: string) => string {
  const byNorm = new Map<string, string>();
  for (const key of Object.keys(row)) byNorm.set(norm(key), key);
  return (field: string) => {
    for (const alias of ALIASES[field] || []) {
      const real = byNorm.get(alias);
      if (real != null && row[real] != null && String(row[real]).trim() !== '') return String(row[real]).trim();
    }
    return '';
  };
}

/** A contact name from either the full name or first/last, "Last, First" tidied. */
function contactName(full: string, first: string, last: string): string {
  if (full) {
    const m = /^\s*([^,]+),\s*(.+)$/.exec(full); // "Last, First" → "First Last"
    return m ? `${m[2].trim()} ${m[1].trim()}` : full;
  }
  return [first, last].filter(Boolean).join(' ');
}

/**
 * Group flat contact rows into companies (keyed by normalised CompanyName).
 * Company-level fields are taken from the first row that supplies them; each
 * row with a contact name/email contributes a CompanyContact.
 */
export function groupCompanies(rows: Record<string, string>[]): { companies: Partial<Company>[]; skipped: number } {
  const byKey = new Map<string, Partial<Company>>();
  let skipped = 0;
  for (const row of rows) {
    const g = fieldGetter(row);
    const name = g('name');
    if (!name) { skipped++; continue; }
    const key = norm(name);
    let comp = byKey.get(key);
    if (!comp) {
      comp = { name, type: 'Company', contacts: [] };
      byKey.set(key, comp);
    }
    const fill = (k: keyof Company, v: string) => { if (v && !comp![k]) (comp as Record<string, unknown>)[k] = v; };
    const rawType = g('type');
    if (rawType && /individual|partnership|company/i.test(rawType)) {
      comp.type = (/individual/i.test(rawType) ? 'Individual' : /partnership/i.test(rawType) ? 'Partnership' : 'Company');
    }
    fill('contactType', g('contactType'));
    fill('address', g('address1'));
    fill('address2', g('address2'));
    fill('city', g('city'));
    fill('state', g('state'));
    fill('zip', g('zip'));
    fill('country', g('country'));
    fill('phone', g('companyPhone'));
    fill('email', g('companyEmail'));
    const website = g('website');
    const notes = g('notes');
    const extra = [website ? `Website: ${website}` : '', notes].filter(Boolean).join('\n');
    if (extra) comp.notes = [comp.notes, extra].filter(Boolean).join('\n');

    const cname = contactName(g('contactName'), g('contactFirst'), g('contactLast'));
    const cemail = g('contactEmail');
    if (cname || cemail) {
      const contact: CompanyContact = {
        name: cname,
        first: g('contactFirst') || undefined,
        last: g('contactLast') || undefined,
        title: g('contactTitle') || undefined,
        position: g('contactTitle') || undefined,
        email: cemail || undefined,
        phone: g('contactPhone') || g('contactMobile') || undefined,
      };
      // De-dupe identical contacts (same email or same name).
      const dup = (comp.contacts || []).some((c) => (cemail && c.email === cemail) || (!cemail && c.name === cname));
      if (!dup) comp.contacts!.push(contact);
    }
  }
  return { companies: [...byKey.values()], skipped };
}
