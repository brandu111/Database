import fs from 'node:fs';
import path from 'node:path';
import type { Company, Mark, MarkContact, Opposition } from '@brandu/shared';
import { hashPassword } from './auth.js';
import { newId, saveCompany, saveMark, saveOpposition, type DB } from './db.js';

/**
 * One-off database seed from the design-handoff data bundle:
 *  - staff users (initial password: env SEED_STAFF_PASSWORD or "brandu-change-me")
 *  - firm settings
 *  - email template libraries (AU + international, merge-field syntax preserved)
 *  - oppositions from the client's spreadsheet
 *  - the full Reva case export, with Madrid families linked relationally
 *  - contact prefill: known contacts propagated onto company records and cases
 * Safe to re-run: it refuses to touch a database that already has marks.
 *
 * The importable `seed(db, {...})` is free of `import.meta` so it bundles into
 * the single-file deploy artifact; the CLI wrapper lives in `seed-cli.ts`.
 */

function readJson<T>(dir: string, name: string): T | null {
  const p = path.join(dir, name);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8')) as T;
}

function blankMark(o: Partial<Mark>): Mark {
  return {
    id: newId('m'),
    name: '',
    jurisdiction: '',
    application: '',
    registration: '',
    status: '',
    owner: '',
    filingBasis: '',
    type: '',
    classes: '',
    regType: '',
    city: '',
    state: '',
    zip: '',
    country: '',
    phone: '',
    matter: '',
    ourDocket: '',
    clientDocket: '',
    goods: '',
    comments: '',
    disclaimers: '',
    dates: [],
    actions: [],
    contacts: [],
    docs: [],
    image: null,
    treaty: { basis: '', date: '', desigs: [] },
    ...o,
  };
}

/** Group imported marks by name and wire up Madrid IR / basic / designation links. */
function linkMadridFamilies(marks: Mark[]): void {
  const byName = new Map<string, Mark[]>();
  for (const m of marks) {
    const k = (m.name || '').toLowerCase().trim();
    if (!byName.has(k)) byName.set(k, []);
    byName.get(k)!.push(m);
  }
  for (const group of byName.values()) {
    const ir = group.find((m) => m.jurisdiction === 'Madrid Protocol (WIPO)');
    if (!ir) continue;
    const fam = `fam-${ir.id}`;
    ir.madridId = fam;
    ir.treaty = {
      basis: 'Madrid Protocol',
      date: (ir.dates || []).find((x) => x.name === 'Application Filed')?.date || '',
      desigs: [],
    };
    for (const m of group) {
      if (m === ir) continue;
      if ((m.filingBasis || '').includes('Madrid')) {
        m.madridId = fam;
        m.irId = ir.id;
        m.treaty = { basis: 'Madrid Protocol', date: ir.treaty!.date, desigs: [] };
      } else if ((m.jurisdiction === 'Australia' || m.jurisdiction === 'New Zealand') && !ir.basicId) {
        ir.basicId = m.id;
        m.madridId = fam;
      }
    }
  }
}

/** Copy known contacts (from oppositions / cases) onto matching companies and bare cases. */
function contactPrefill(marks: Mark[], oppositions: Opposition[], companies: Company[]): void {
  const norm = (s: string) => (s || '').toLowerCase().replace(/pty ltd|limited|ltd|inc|llc|\.|,/g, '').replace(/\s+/g, ' ').trim();
  const idx = new Map<string, MarkContact[]>();
  const add = (co: string, list: { name?: string; firstName?: string; lastName?: string; email?: string; position?: string; role?: string; phone?: string }[]) => {
    if (!co || !list?.length) return;
    const k = norm(co);
    if (!k) return;
    if (!idx.has(k)) idx.set(k, []);
    const bucket = idx.get(k)!;
    for (const c of list) {
      const name = c.name || [c.firstName, c.lastName].filter(Boolean).join(' ');
      const email = c.email || '';
      if (!name && !email) continue;
      if (!bucket.some((x) => x.email === email && x.name === name)) {
        bucket.push({ name, company: co, position: c.position || c.role || '', phone: c.phone || '', email });
      }
    }
  };
  oppositions.forEach((o) => add(o.client, o.contacts || []));
  marks.forEach((m) => {
    if ((m.contacts || []).length) add(m.owner, m.contacts);
  });
  companies.forEach((co) => {
    const hit = idx.get(norm(co.name));
    if (hit?.length) co.contacts = hit.map((c) => ({ ...c }));
  });
  marks.forEach((m) => {
    if (!(m.contacts || []).length) {
      const hit = idx.get(norm(m.owner));
      if (hit?.length) m.contacts = hit.map((c) => ({ ...c }));
    }
  });
}

export function seed(db: DB, opts: { staffPassword?: string; seedDir: string }): { marks: number; oppositions: number; companies: number; templates: number } {
  const seedDir = opts.seedDir;
  const existing = db.prepare(`SELECT COUNT(*) AS n FROM marks`).get() as { n: number };
  if (existing.n > 0) throw new Error(`Database already contains ${existing.n} marks — refusing to re-seed. Delete the database file to start over.`);

  const staffPassword = opts.staffPassword || process.env.SEED_STAFF_PASSWORD || 'brandu-change-me';
  const users: [string, string][] = [
    ['Kerrie', 'Full Permissions'],
    ['BeaPark', 'Full Permissions'],
    ['Natalie', 'Full Permissions'],
    ['AlexMJ', 'Full Permissions'],
    ['Admin', 'Full Permissions'],
    ['Fiona', 'View and Print Only'],
  ];
  const hash = hashPassword(staffPassword);
  const insUser = db.prepare(`INSERT OR IGNORE INTO staff_users(id,name,level,password_hash) VALUES(?,?,?,?)`);
  users.forEach(([name, level]) => insUser.run(newId('u'), name, level, hash));

  db.prepare(`INSERT INTO singletons(key,doc) VALUES('firmSettings',?) ON CONFLICT(key) DO UPDATE SET doc=excluded.doc`).run(
    JSON.stringify({ lawFirmName: 'BrandU Legal', firmContactEmail: 'natalie@brandulegal.com.au', documentsFolder: '', logo: '' })
  );

  // Email template libraries — keep the client's original merge-field syntax.
  let templates = 0;
  const insTpl = db.prepare(`INSERT INTO email_templates(id,doc) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc`);
  for (const file of ['au-email-templates.json', 'intl-email-templates.json']) {
    const j = readJson<{ templates: { id: string }[] }>(seedDir, file);
    if (!j) continue;
    for (const t of j.templates || []) {
      insTpl.run(t.id, JSON.stringify(t));
      templates++;
    }
  }

  const oppData = readJson<{ oppositions: Partial<Opposition>[] }>(seedDir, 'opposition-data.json');
  const oppositions: Opposition[] = (oppData?.oppositions || []).map((o) => {
    const base: Opposition = {
      id: o.id || newId('o'),
      name: '',
      client: '',
      opponent: '',
      proceeding: '',
      jurisdiction: '',
      status: '',
      clientIsPlaintiff: false,
      notes: '',
      clientMarks: [],
      oppMarks: [],
      dates: [],
      contacts: [],
    };
    const merged = Object.assign(base, o);
    merged.contacts = (merged.contacts || []).map((c) => Object.assign({ company: '', position: c.role || '', phone: '', email: '' }, c));
    return merged;
  });

  const reva = readJson<Partial<Mark>[]>(seedDir, 'reva-data.json') || [];
  const marks = reva.map((r) => blankMark(r));
  linkMadridFamilies(marks);

  // Company records derived from case owners and opposition clients.
  const names = new Set<string>();
  marks.forEach((m) => m.owner && names.add(m.owner.trim()));
  oppositions.forEach((o) => o.client && names.add(o.client.trim()));
  const companies: Company[] = [...names].sort().map((name) => ({
    id: newId('c'),
    type: 'Company',
    name,
    address: '',
    address2: '',
    city: '',
    state: '',
    zip: '',
    country: '',
    phone: '',
    email: '',
    notes: '',
    contacts: [],
  }));

  contactPrefill(marks, oppositions, companies);

  const tx = db.transaction(() => {
    marks.forEach((m) => saveMark(db, m));
    oppositions.forEach((o) => saveOpposition(db, o));
    companies.forEach((c) => saveCompany(db, c));
  });
  tx();

  return { marks: marks.length, oppositions: oppositions.length, companies: companies.length, templates };
}
