import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  applyStage,
  daysBetween,
  ensureRuleRows,
  oppSchedule,
  shift,
  todayISO,
  type AlertRow,
  type Company,
  type Mark,
  type MarkDate,
  type Opposition,
  type OppositionDate,
  type StaffLevel,
} from '@brandu/shared';
import {
  deleteCompany,
  deleteMark,
  deleteOpposition,
  getCompany,
  getFirmSettings,
  getMark,
  getOppDatesMaster,
  getOpposition,
  listCompanies,
  listMarks,
  listOppositions,
  newId,
  saveCompany,
  saveMark,
  saveOpposition,
  saveJurisdictionRules,
  setFirmSettings,
  setOppDatesMaster,
  loadRules,
  type DB,
} from './db.js';
import { IpAuError, ipAuConfigured, lookupTradeMark } from './ipaustralia.js';
import {
  checkPassword,
  clearSessionCookie,
  generatePassword,
  getSecret,
  hashPassword,
  makeSession,
  readSession,
  requireClient,
  requireStaff,
  setSessionCookie,
} from './auth.js';

const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

function blankMark(over: Partial<Mark>): Mark {
  return {
    id: newId('m'),
    name: '',
    jurisdiction: 'Australia',
    application: '',
    registration: '',
    status: 'Pending',
    owner: '',
    filingBasis: '',
    type: 'Word',
    classes: '',
    regType: '',
    city: '',
    state: '',
    zip: '',
    country: 'Australia',
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
    ...over,
  };
}

/**
 * All mark writes flow through here: run the status stage transition when the
 * status changed, then activate/recompute rule rows — including Madrid
 * designation renewal propagation across the family — and persist every mark
 * the engine touched. The deadline engine runs exclusively server-side.
 */
function processMarkWrite(db: DB, incoming: Mark, previous: Mark | null): Mark {
  const rules = loadRules(db);
  const all = listMarks(db).filter((x) => x.id !== incoming.id);
  const m = incoming;
  all.push(m);
  if (previous && previous.status !== m.status) applyStage(m, rules, m.status);
  ensureRuleRows(m, rules, all);
  m.dates.sort((a, b) => ((a.date || '9999') < (b.date || '9999') ? -1 : 1));
  // Keep the International Registration number in sync across the Madrid family:
  // it is entered once on the IR case and copied down to every designation
  // (initial and subsequent). Designations are saved below via `touched`.
  if (m.jurisdiction === 'Madrid Protocol (WIPO)') {
    for (const x of all) {
      if (x.irId === m.id) x.irNumber = m.irNumber || '';
    }
  }
  const touched = all.filter((x) => x.id === m.id || x.irId === m.id);
  const tx = db.transaction(() => touched.forEach((x) => saveMark(db, x)));
  tx();
  return m;
}

function computeAlerts(db: DB, alertDays: number, forCompany?: string): AlertRow[] {
  const nowIso = todayISO();
  const win = (iso: string) => !!iso && daysBetween(nowIso, iso) <= alertDays;
  const rows: AlertRow[] = [];
  for (const m of listMarks(db)) {
    if (forCompany && m.owner !== forCompany) continue;
    (m.actions || []).forEach((a) => {
      if (a.alert && !a.done && a.alertDate)
        rows.push({ date: a.alertDate, kind: 'Action', refType: 'mark', refId: m.id, mark: m.name || '(untitled)', jur: m.jurisdiction || '', text: a.text || 'Action alert' });
    });
    (m.dates || []).forEach((d) => {
      if (d.done || !d.date) return;
      if (win(d.date))
        rows.push({
          date: d.date,
          kind: d.reminder ? 'Client reminder' : 'Deadline',
          refType: 'mark',
          refId: m.id,
          mark: m.name || '(untitled)',
          jur: m.jurisdiction || '',
          text: (d.name || '').replace(/ — Reminder.*$/, ''),
        });
    });
  }
  for (const o of listOppositions(db)) {
    if (forCompany && o.client !== forCompany) continue;
    (o.dates || []).forEach((d) => {
      if (d.done || !d.date || d.suspend) return;
      if (win(d.date))
        rows.push({ date: d.date, kind: 'Opposition', refType: 'opposition', refId: o.id, mark: o.name || '(opposition)', jur: o.jurisdiction || '', text: d.name || '' });
    });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : 1));
  rows.forEach((r) => (r.overdue = daysBetween(r.date, nowIso) > 1));
  return rows;
}

export function createApp(db: DB, opts: { uploadsDir?: string; clientDist?: string } = {}): Express {
  const app = express();
  const secret = getSecret(db);
  const uploadsDir = opts.uploadsDir || path.resolve('uploads');
  fs.mkdirSync(uploadsDir, { recursive: true });
  app.use(express.json({ limit: '25mb' }));
  app.use(cookieParser());

  // Never let a proxy/CDN (e.g. LiteSpeed LSCache) cache API or file responses:
  // caching an authenticated response would both break sessions and leak one
  // user's data to another. Mark everything under /api and /files no-store.
  app.use((req, res, next) => {
    if (req.path.startsWith('/api') || req.path.startsWith('/files')) {
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, private');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      // LiteSpeed-specific opt-out, honoured even if the server default caches.
      res.setHeader('X-LiteSpeed-Cache-Control', 'no-cache');
    }
    next();
  });

  const view = requireStaff(db, 'view');
  const edit = requireStaff(db, 'edit');
  const full = requireStaff(db, 'full');

  // ---- auth ----------------------------------------------------------------

  app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body || {};
    const row = db
      .prepare(`SELECT id, name, level, password_hash FROM staff_users WHERE name=? COLLATE NOCASE`)
      .get(String(username || '')) as { id: string; name: string; level: StaffLevel; password_hash: string } | undefined;
    if (!row || !checkPassword(String(password || ''), row.password_hash)) {
      return res.status(401).json({ error: 'Invalid username or password' });
    }
    if (row.level === 'No Access') return res.status(403).json({ error: 'Access disabled' });
    const session = makeSession({ kind: 'staff', id: row.id, name: row.name, level: row.level });
    setSessionCookie(res, secret, session);
    res.json({ name: row.name, level: row.level });
  });

  app.post('/api/auth/client-login', (req, res) => {
    const { userId, password } = req.body || {};
    const row = db
      .prepare(`SELECT company, password_hash, active FROM client_access WHERE user_id=?`)
      .get(String(userId || '')) as { company: string; password_hash: string; active: number } | undefined;
    if (!row || !row.active || !checkPassword(String(password || ''), row.password_hash)) {
      return res.status(401).json({ error: 'Invalid login' });
    }
    const session = makeSession({ kind: 'client', company: row.company });
    setSessionCookie(res, secret, session);
    res.json({ company: row.company });
  });

  app.post('/api/auth/logout', (_req, res) => {
    clearSessionCookie(res);
    res.json({ ok: true });
  });

  app.get('/api/auth/me', (req, res) => {
    const session = readSession(db, req);
    if (!session) return res.status(401).json({ error: 'Not signed in' });
    if (session.kind === 'staff') {
      const row = db.prepare(`SELECT signature FROM staff_users WHERE id=?`).get(session.id) as { signature?: string } | undefined;
      return res.json({ kind: 'staff', id: session.id, name: session.name, level: session.level, signature: row?.signature || '' });
    }
    res.json({ kind: 'client', company: session.company });
  });

  // A staff member updates their own email sign-off (individual signature).
  app.put('/api/auth/me/signature', edit, (req, res) => {
    const session = readSession(db, req);
    if (!session || session.kind !== 'staff') return res.status(401).json({ error: 'Not signed in' });
    const signature = String((req.body || {}).signature || '');
    db.prepare(`UPDATE staff_users SET signature=? WHERE id=?`).run(signature, session.id);
    res.json({ ok: true });
  });

  // ---- marks ---------------------------------------------------------------

  app.get('/api/marks', view, (_req, res) => res.json(listMarks(db)));

  app.get('/api/marks/:id', view, (req, res) => {
    const m = getMark(db, req.params.id);
    if (!m) return res.status(404).json({ error: 'Not found' });
    res.json(m);
  });

  app.post('/api/marks', edit, (req, res) => {
    const m = blankMark(req.body || {});
    saveMark(db, m);
    res.status(201).json(m);
  });

  app.put('/api/marks/:id', edit, (req, res) => {
    const previous = getMark(db, req.params.id);
    if (!previous) return res.status(404).json({ error: 'Not found' });
    const incoming = { ...clone(req.body), id: req.params.id } as Mark;
    res.json(processMarkWrite(db, incoming, previous));
  });

  app.delete('/api/marks/:id', edit, (req, res) => {
    deleteMark(db, req.params.id);
    res.json({ ok: true });
  });

  /**
   * From an AU/NZ basic case, spawn the linked Madrid International
   * Registration; with {country} also add a designation case under the IR.
   */
  /**
   * File a Madrid Protocol international registration from an AU/NZ basic case,
   * and/or add designations to it. Body:
   *   { countries?: string[], country?: string, filingDate?: string,
   *     subsequent?: boolean }
   * The IR and each designated jurisdiction are created as separate, related
   * cases (shared madridId). Initial designations share the IR filing date;
   * subsequent designations are dated the day they are filed. Convention
   * priority recorded on the basic case is carried forward. Basic-case details
   * are copied (and remain editable on the new cases).
   */
  app.post('/api/marks/:id/madrid', edit, (req, res) => {
    const basic = getMark(db, req.params.id);
    if (!basic) return res.status(404).json({ error: 'Not found' });
    const body = req.body || {};
    const countries: string[] = Array.isArray(body.countries)
      ? body.countries.map(String)
      : body.country
        ? [String(body.country)]
        : [];
    const subsequent = !!body.subsequent;

    const fam = basic.madridId || `fam-${basic.id}`;
    basic.madridId = fam;
    const all = listMarks(db);
    let ir = all.find((x) => x.madridId === fam && x.jurisdiction === 'Madrid Protocol (WIPO)');

    const ownerBits: Partial<Mark> = {
      owner: basic.owner,
      ownerType: basic.ownerType,
      ownerFirst: basic.ownerFirst,
      ownerMiddle: basic.ownerMiddle,
      ownerLast: basic.ownerLast,
      ownerAbn: basic.ownerAbn,
      ownerAcn: basic.ownerAcn,
      address1: basic.address1,
      address2: basic.address2,
      city: basic.city,
      state: basic.state,
      zip: basic.zip,
      country: basic.country,
      phone: basic.phone,
    };

    // Convention priority carried forward from the basic case (if recorded there).
    const priorityRows = (basic.dates || []).filter((d) => d.date && /^priority date$/i.test(d.name || ''));
    const withPriority = (dates: MarkDate[]): MarkDate[] => {
      priorityRows.forEach((p) => {
        if (!dates.some((d) => d.name === p.name)) dates.push({ name: p.name, date: p.date, done: true });
      });
      return dates;
    };

    const created: Mark[] = [];
    if (!ir) {
      if (!['Australia', 'New Zealand'].includes(basic.jurisdiction)) {
        return res.status(400).json({ error: 'A Madrid case can only be filed from an Australian or New Zealand basic application.' });
      }
      const irFilingDate = body.filingDate ? String(body.filingDate) : todayISO();
      ir = blankMark({
        id: newId('ir'),
        name: basic.name,
        jurisdiction: 'Madrid Protocol (WIPO)',
        status: 'Pending',
        filingBasis: 'Madrid Protocol',
        type: basic.type,
        wordText: basic.wordText || '',
        classes: basic.classes,
        goods: basic.goods,
        disclaimers: basic.disclaimers,
        matter: basic.matter,
        clientDocket: basic.clientDocket,
        comments: `Based on ${basic.jurisdiction} case ${basic.registration || basic.application || ''}`,
        madridId: fam,
        basicId: basic.id,
        treaty: { basis: 'Madrid Protocol', date: irFilingDate, desigs: [] },
        dates: withPriority([{ name: 'Application Filed', date: irFilingDate, done: true, auInput: true }]),
        contacts: clone(basic.contacts || []),
        image: basic.image || null,
        ...ownerBits,
      });
      created.push(ir);
    }

    const irFilingDate = (ir.dates || []).find((d) => d.name === 'Application Filed')?.date || todayISO();
    // Initial designations share the IR filing date; subsequent designations
    // are dated when they are filed (the supplied date, or today).
    const desigFilingDate = subsequent ? (body.filingDate ? String(body.filingDate) : todayISO()) : irFilingDate;
    const cp = { classes: true, goods: true, disclaimers: true, contacts: true, ...(basic.madridCopy || {}) };

    for (const country of countries) {
      if (!country || country === 'Madrid Protocol (WIPO)') continue;
      if (all.some((x) => x.irId === ir!.id && x.jurisdiction === country)) continue;
      if (created.some((x) => x.irId === ir!.id && x.jurisdiction === country)) continue;
      created.push(
        blankMark({
          id: newId('des'),
          name: basic.name,
          jurisdiction: country,
          status: 'Pending',
          filingBasis: 'Madrid Protocol',
          type: basic.type,
          wordText: basic.wordText || '',
          classes: cp.classes ? basic.classes : '',
          goods: cp.goods ? basic.goods : '',
          disclaimers: cp.disclaimers ? basic.disclaimers : '',
          matter: basic.matter,
          clientDocket: basic.clientDocket,
          comments: `${subsequent ? 'Subsequent designation' : 'Designation'} under Madrid IR (basic: ${basic.name})`,
          madridId: fam,
          irId: ir.id,
          irNumber: ir.irNumber || '',
          treaty: { basis: 'Madrid Protocol', date: desigFilingDate, desigs: [] },
          dates: withPriority([{ name: 'Application Filed', date: desigFilingDate, done: true, auInput: true }]),
          contacts: cp.contacts ? clone(basic.contacts || []) : [],
          ...ownerBits,
        })
      );
    }

    const tx = db.transaction(() => {
      saveMark(db, basic);
      created.forEach((x) => saveMark(db, x));
    });
    tx();
    // Compute the IR renewal (from its filing date) first, then propagate it to
    // every designation.
    const irNow = getMark(db, ir.id)!;
    processMarkWrite(db, irNow, irNow);
    created
      .filter((x) => x.irId)
      .forEach((x) => {
        const m = getMark(db, x.id)!;
        processMarkWrite(db, m, m);
      });
    res.json({ ir: getMark(db, ir.id), created: created.map((x) => getMark(db, x.id)) });
  });

  /**
   * Look up an Australian trade mark on the IP Australia register and return
   * the mapped fields for the client to pre-populate a case. Editors only; the
   * API credentials never leave the server.
   */
  app.get('/api/lookup/ip-australia/:number', edit, async (req, res) => {
    try {
      const fields = await lookupTradeMark(req.params.number, {
        saveImage: (buffer, contentType) => {
          const ext = contentType.includes('png') ? '.png' : contentType.includes('gif') ? '.gif' : contentType.includes('svg') ? '.svg' : '.jpg';
          const name = `${randomBytes(8).toString('hex')}${ext}`;
          fs.writeFileSync(path.join(uploadsDir, name), buffer);
          return `/files/${name}`;
        },
      });
      res.json(fields);
    } catch (e) {
      const err = e as IpAuError;
      res.status(err.status && err.status >= 400 && err.status < 600 ? err.status : 502).json({ error: err.message || 'Lookup failed' });
    }
  });

  app.get('/api/lookup/ip-australia', view, (_req, res) => res.json({ configured: ipAuConfigured() }));

  app.get('/api/marks/:id/correspondence', view, (req, res) => {
    res.json(db.prepare(`SELECT * FROM correspondence WHERE mark_id=? ORDER BY sent_at DESC`).all(req.params.id));
  });

  app.post('/api/marks/:id/correspondence', edit, (req, res) => {
    const { to = '', subject = '', body = '' } = req.body || {};
    const who = req.session && req.session.kind === 'staff' ? req.session.name : '';
    db.prepare(`INSERT INTO correspondence(mark_id, sent_at, to_email, subject, body, user_name) VALUES(?,?,?,?,?,?)`).run(
      req.params.id,
      new Date().toISOString(),
      String(to),
      String(subject),
      String(body),
      who
    );
    res.status(201).json({ ok: true });
  });

  // ---- oppositions ---------------------------------------------------------

  app.get('/api/oppositions', view, (_req, res) => res.json(listOppositions(db)));

  app.post('/api/oppositions', edit, (req, res) => {
    const o: Opposition = {
      id: newId('o'),
      name: 'New opposition',
      client: '',
      opponent: '',
      proceeding: '',
      jurisdiction: 'Australia',
      status: 'Opposition filed',
      clientIsPlaintiff: false,
      notes: '',
      clientMarks: [],
      oppMarks: [],
      dates: [],
      contacts: [],
      ...(req.body || {}),
    };
    saveOpposition(db, o);
    res.status(201).json(o);
  });

  app.put('/api/oppositions/:id', edit, (req, res) => {
    if (!getOpposition(db, req.params.id)) return res.status(404).json({ error: 'Not found' });
    const o = { ...clone(req.body), id: req.params.id } as Opposition;
    saveOpposition(db, o);
    res.json(o);
  });

  app.delete('/api/oppositions/:id', edit, (req, res) => {
    deleteOpposition(db, req.params.id);
    res.json({ ok: true });
  });

  /**
   * "Get Dates From Template": if the jurisdiction has a researched opposition
   * schedule and an anchor date is supplied, generate the chained timeline
   * (with the statutory notes/citations attached); otherwise append the
   * opposition master date list. Existing rows are never duplicated.
   */
  app.post('/api/oppositions/:id/dates-from-template', edit, (req, res) => {
    const o = getOpposition(db, req.params.id);
    if (!o) return res.status(404).json({ error: 'Not found' });
    o.dates = o.dates || [];
    const sched = oppSchedule(o.jurisdiction);
    const anchorDate = req.body?.anchorDate ? String(req.body.anchorDate) : '';
    if (sched && anchorDate) {
      const resolved: Record<string, string> = {};
      const push = (name: string, date: string, note: string, email = false) => {
        if (!o.dates.some((x) => x.name === name)) {
          o.dates.push({ date, name, note, done: false, email, suspend: false } as OppositionDate);
        }
        resolved[name] = date;
      };
      push(sched.anchor, anchorDate, sched.role);
      for (const s of sched.steps) {
        const fromDate = s.from === 'anchor' ? anchorDate : resolved[s.from] || '';
        const date = fromDate ? shift(fromDate, s.off, s.unit === 'd' ? 'days' : 'months') : '';
        push(s.name, date, s.note, true);
      }
    } else {
      for (const md of getOppDatesMaster(db)) {
        if (o.dates.some((x) => (x.name || '') === md.name)) continue;
        o.dates.push({ date: '', name: md.name, note: '', done: false, email: !!md.email, suspend: false });
      }
    }
    saveOpposition(db, o);
    res.json(o);
  });

  // ---- companies (Contacts tab) --------------------------------------------

  app.get('/api/companies', view, (_req, res) => res.json(listCompanies(db)));

  app.post('/api/companies', edit, (req, res) => {
    const c: Company = {
      id: newId('c'),
      type: 'Company',
      name: '',
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
      ...(req.body || {}),
    };
    saveCompany(db, c);
    res.status(201).json(c);
  });

  app.put('/api/companies/:id', edit, (req, res) => {
    if (!getCompany(db, req.params.id)) return res.status(404).json({ error: 'Not found' });
    const c = { ...clone(req.body), id: req.params.id } as Company;
    saveCompany(db, c);
    res.json(c);
  });

  app.delete('/api/companies/:id', edit, (req, res) => {
    deleteCompany(db, req.params.id);
    res.json({ ok: true });
  });

  // ---- alerts ---------------------------------------------------------------

  app.get('/api/alerts', view, (req, res) => {
    const days = Math.max(7, Math.min(365, parseInt(String(req.query.days || '30'), 10) || 30));
    res.json(computeAlerts(db, days));
  });

  // ---- rules / preferences --------------------------------------------------

  app.get('/api/rules', view, (_req, res) => {
    const row = db.prepare(`SELECT value FROM meta WHERE key='rulesVersion'`).get() as { value: string } | undefined;
    res.json({ rulesVersion: row ? parseInt(row.value, 10) : null, rules: loadRules(db) });
  });

  app.put('/api/rules/:jurisdiction', full, (req, res) => {
    const list = Array.isArray(req.body?.rules) ? req.body.rules : null;
    if (!list) return res.status(400).json({ error: 'rules array required' });
    saveJurisdictionRules(db, req.params.jurisdiction, list);
    res.json({ ok: true });
  });

  app.get('/api/opp-dates-master', view, (_req, res) => res.json(getOppDatesMaster(db)));
  app.put('/api/opp-dates-master', full, (req, res) => {
    if (!Array.isArray(req.body)) return res.status(400).json({ error: 'array required' });
    setOppDatesMaster(db, req.body);
    res.json({ ok: true });
  });

  // ---- email templates -------------------------------------------------------

  app.get('/api/templates', view, (_req, res) => {
    res.json((db.prepare(`SELECT doc FROM email_templates`).all() as { doc: string }[]).map((r) => JSON.parse(r.doc)));
  });

  const upsertTemplate = db.prepare(`INSERT INTO email_templates(id,doc) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET doc=excluded.doc`);
  const normaliseTemplate = (raw: Record<string, unknown>, id: string) => ({
    id,
    ref: String(raw.ref || ''),
    jurisdiction: String(raw.jurisdiction || 'Australia'),
    category: String(raw.category || 'General'),
    stage: String(raw.stage || ''),
    dateField: String(raw.dateField || ''),
    subject: String(raw.subject || ''),
    body: String(raw.body || ''),
  });

  app.post('/api/templates', full, (req, res) => {
    const t = normaliseTemplate(req.body || {}, newId('tpl'));
    upsertTemplate.run(t.id, JSON.stringify(t));
    res.status(201).json(t);
  });

  app.put('/api/templates/:id', full, (req, res) => {
    const t = normaliseTemplate(req.body || {}, req.params.id);
    upsertTemplate.run(t.id, JSON.stringify(t));
    res.json(t);
  });

  app.delete('/api/templates/:id', full, (req, res) => {
    db.prepare(`DELETE FROM email_templates WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  });

  /** Bulk import — accepts an array of templates or { templates: [...] }. */
  app.post('/api/templates/import', full, (req, res) => {
    const list: Record<string, unknown>[] = Array.isArray(req.body) ? req.body : Array.isArray(req.body?.templates) ? req.body.templates : [];
    if (!list.length) return res.status(400).json({ error: 'Provide a JSON array of templates, or { "templates": [ ... ] }.' });
    let count = 0;
    const tx = db.transaction(() => {
      for (const raw of list) {
        const id = raw.id ? String(raw.id) : newId('tpl');
        const t = normaliseTemplate(raw, id);
        upsertTemplate.run(t.id, JSON.stringify(t));
        count++;
      }
    });
    tx();
    res.status(201).json({ imported: count });
  });

  // ---- settings & users ------------------------------------------------------

  app.get('/api/settings', view, (_req, res) => res.json(getFirmSettings(db)));
  app.put('/api/settings', full, (req, res) => {
    setFirmSettings(db, req.body || {});
    res.json(getFirmSettings(db));
  });

  app.get('/api/users', full, (_req, res) => {
    res.json(db.prepare(`SELECT id, name, level, signature FROM staff_users ORDER BY name`).all());
  });

  app.post('/api/users', full, (req, res) => {
    const { name, level = 'Edit Only', password } = req.body || {};
    if (!name || !password) return res.status(400).json({ error: 'name and password required' });
    const id = newId('u');
    try {
      db.prepare(`INSERT INTO staff_users(id,name,level,password_hash) VALUES(?,?,?,?)`).run(id, String(name), String(level), hashPassword(String(password)));
    } catch {
      return res.status(409).json({ error: 'User name already exists' });
    }
    res.status(201).json({ id, name, level });
  });

  app.put('/api/users/:id', full, (req, res) => {
    const { name, level, password } = req.body || {};
    const row = db.prepare(`SELECT id FROM staff_users WHERE id=?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const { signature } = req.body || {};
    if (name) db.prepare(`UPDATE staff_users SET name=? WHERE id=?`).run(String(name), req.params.id);
    if (level) db.prepare(`UPDATE staff_users SET level=? WHERE id=?`).run(String(level), req.params.id);
    if (password) db.prepare(`UPDATE staff_users SET password_hash=? WHERE id=?`).run(hashPassword(String(password)), req.params.id);
    if (signature !== undefined) db.prepare(`UPDATE staff_users SET signature=? WHERE id=?`).run(String(signature || ''), req.params.id);
    res.json(db.prepare(`SELECT id, name, level, signature FROM staff_users WHERE id=?`).get(req.params.id));
  });

  app.delete('/api/users/:id', full, (req, res) => {
    db.prepare(`DELETE FROM staff_users WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  });

  // ---- client extranet access -----------------------------------------------

  app.get('/api/client-access', full, (_req, res) => {
    res.json(db.prepare(`SELECT id, company, user_id AS userId, active, created_at AS createdAt FROM client_access ORDER BY created_at DESC`).all());
  });

  /** Invite a company: unique login id + generated password (returned once, stored hashed). */
  app.post('/api/client-access', full, (req, res) => {
    const company = String(req.body?.company || '').trim();
    if (!company) return res.status(400).json({ error: 'company required' });
    const uid = company.replace(/[^A-Za-z0-9]/g, '').slice(0, 10).toLowerCase() + Math.floor(10 + Math.random() * 89);
    const password = generatePassword();
    const id = newId('ca');
    db.prepare(`INSERT INTO client_access(id, company, user_id, password_hash, active, created_at) VALUES(?,?,?,?,1,?)`).run(
      id,
      company,
      uid,
      hashPassword(password),
      new Date().toISOString()
    );
    res.status(201).json({ id, company, userId: uid, password, active: 1 });
  });

  app.post('/api/client-access/:id/regenerate', full, (req, res) => {
    const row = db.prepare(`SELECT id FROM client_access WHERE id=?`).get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Not found' });
    const password = generatePassword();
    db.prepare(`UPDATE client_access SET password_hash=? WHERE id=?`).run(hashPassword(password), req.params.id);
    res.json({ password });
  });

  app.put('/api/client-access/:id', full, (req, res) => {
    db.prepare(`UPDATE client_access SET active=? WHERE id=?`).run(req.body?.active ? 1 : 0, req.params.id);
    res.json({ ok: true });
  });

  app.delete('/api/client-access/:id', full, (req, res) => {
    db.prepare(`DELETE FROM client_access WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  });

  // ---- client extranet (read-only, scoped to the signed-in company) ---------

  app.get('/api/portal/marks', requireClient(db), (req, res) => {
    const company = (req.session as { company: string }).company;
    res.json(listMarks(db).filter((m) => m.owner === company));
  });

  app.get('/api/portal/oppositions', requireClient(db), (req, res) => {
    const company = (req.session as { company: string }).company;
    res.json(listOppositions(db).filter((o) => o.client === company));
  });

  // ---- file uploads (documents, mark images) --------------------------------

  const upload = multer({
    storage: multer.diskStorage({
      destination: uploadsDir,
      filename: (_req, file, cb) => cb(null, `${randomBytes(8).toString('hex')}${path.extname(file.originalname).slice(0, 12)}`),
    }),
    limits: { fileSize: 25 * 1024 * 1024 },
  });

  app.post('/api/files', edit, upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'file required' });
    res.status(201).json({ url: `/files/${req.file.filename}`, fileName: req.file.originalname });
  });

  app.use('/files', (req, res, next) => {
    const session = readSession(db, req);
    if (!session) return res.status(401).json({ error: 'Not signed in' });
    next();
  });
  app.use('/files', express.static(uploadsDir));

  // ---- static client (production build) -------------------------------------

  if (opts.clientDist && fs.existsSync(opts.clientDist)) {
    // Hashed assets (/assets/*) are immutable and cache freely; index.html must
    // revalidate so a front-end update is never stuck behind a stale shell that
    // references a since-deleted bundle.
    app.use(
      express.static(opts.clientDist, {
        setHeaders: (res, filePath) => {
          if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
        },
      })
    );
    app.get(/^\/(?!api\/|files\/).*/, (_req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(opts.clientDist!, 'index.html'));
    });
  }

  return app;
}
