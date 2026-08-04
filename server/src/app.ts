import express, { type Express } from 'express';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import {
  applyStage,
  daysBetween,
  designRulesFor,
  ensureRuleRows,
  fmtDate,
  isDesign,
  oppSchedule,
  rulesFor,
  shift,
  todayISO,
  type AlertRow,
  type Company,
  type Mark,
  type MarkDate,
  type Opposition,
  type OppositionDate,
  type Rule,
  type RuleBook,
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
  saveRules,
  snapshotDatabase,
  setFirmSettings,
  setOppDatesMaster,
  loadRules,
  type DB,
} from './db.js';
import { IpAuError, ipAuConfigured, lookupTradeMark } from './ipaustralia.js';
import { csvRowToMark, fullRowToMark, parseImportDate } from './import-marks.js';
import { toRevaCsv } from './reva-export.js';
import { indexCases, isStandardDateName, matchCase, normName, toAction } from './import-actions.js';
import { groupCompanies } from './import-companies.js';
import { mailerConfigured, sendMail } from './mailer.js';
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
// Firm administrator contact recorded on every case's Case contacts.
const ADMIN_CONTACT = { name: 'Admin', company: 'BrandU Legal', position: 'Admin', phone: '', email: 'admin@brandulegal.com.au' };
/** Ensure the Admin contact is present on a case. Returns true if it was added. */
function ensureAdminContact(m: Mark): boolean {
  m.contacts = m.contacts || [];
  if (m.contacts.some((c) => (c.email || '').toLowerCase() === ADMIN_CONTACT.email)) return false;
  m.contacts.push({ ...ADMIN_CONTACT });
  return true;
}

function processMarkWrite(db: DB, incoming: Mark, previous: Mark | null): Mark {
  const rules = loadRules(db);
  const all = listMarks(db).filter((x) => x.id !== incoming.id);
  const m = incoming;
  all.push(m);
  if (previous && previous.status !== m.status) applyStage(m, rules, m.status);
  ensureRuleRows(m, rules, all, getFirmSettings(db).caseUpdateMonths);
  ensureAdminContact(m);
  m.dates.sort((a, b) => ((a.date || '9999') < (b.date || '9999') ? -1 : 1));
  // Keep the International Registration number in sync across the Madrid family:
  // it is entered once on the IR case and copied down to every designation
  // (initial and subsequent). Designations are saved below via `touched`.
  if (m.jurisdiction === 'Madrid Protocol (WIPO)') {
    for (const x of all) {
      if (x.irId === m.id) {
        x.irNumber = m.irNumber || '';
        // A designation is the same mark as the IR — backfill its logo/graphic
        // (and audio) if missing, so existing logo designations get repaired on
        // the next save / "Recompute all".
        if (m.image && !x.image) x.image = m.image;
        if (m.audioUrl && !x.audioUrl) x.audioUrl = m.audioUrl;
      }
    }
  }
  const touched = all.filter((x) => x.id === m.id || x.irId === m.id);
  const tx = db.transaction(() => touched.forEach((x) => saveMark(db, x)));
  tx();
  ensureOwnerCompany(db, m);
  // Notify the staff member attributed to any newly added, alert-flagged date
  // that action is required in the system. Only fires for genuinely new rows.
  if (mailerConfigured()) {
    // Notify only when a genuinely NEW alert date (by name) is added — not when
    // an existing date's value is edited, so changing a date never re-emails.
    const prevNames = new Set((previous?.dates || []).map((d) => d.name));
    for (const d of m.dates) {
      if (d.notify && d.createdBy && !d.done && d.date && !prevNames.has(d.name)) {
        const to = staffEmailByName(db, d.createdBy);
        if (to) {
          const mail = actionRequiredEmail(m, d);
          sendMail({ to, ...mail }).catch((e) => console.log('Alert email failed:', (e as Error).message));
        }
      }
    }
  }
  return m;
}

const escHtml = (s: unknown) => String(s ?? '').split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');

/**
 * Alert/digest suppression: some rows should never nag on the Alerts list.
 * Non-use vulnerability dates are informational, not deadlines — never alerted.
 * Convention Priority deadlines (and their reminders) are only relevant while
 * the 6-month window is open — once expired (date in the past) they're dropped.
 */
function alertSuppressed(name: string, date: string, today: string, status?: string): boolean {
  if (/non-use vulnerability/i.test(name)) return true;
  if (/convention priority/i.test(name) && date < today) return true;
  // Dead/closed matters: nothing should alert once the matter is lapsed,
  // withdrawn, abandoned, refused, removed, ceased or otherwise closed (renewal
  // reminders included — a lapsed case isn't being renewed).
  if (status && /lapse|dead|withdraw|abandon|refus|remov|ceas|not renewed|expired|closed|finalis|finaliz|transfer/i.test(status)) return true;
  return false;
}

/** Human-readable summary of what changed between two versions of a mark. */
function diffMarkSummary(prev: Mark | null, next: Mark): string {
  const parts: string[] = [];
  if (!prev) return 'Case created';
  const fields: [keyof Mark, string][] = [
    ['name', 'name'], ['status', 'status'], ['owner', 'owner'], ['application', 'application no.'],
    ['registration', 'registration no.'], ['classes', 'classes'], ['jurisdiction', 'jurisdiction'],
    ['attorney', 'attorney'], ['associate', 'associate'], ['matter', 'file no.'], ['clientDocket', 'client ref'],
    ['irNumber', 'IR no.'], ['renewalFee', 'renewal fee'],
  ];
  for (const [k, label] of fields) {
    const a = prev[k] ?? '';
    const b = next[k] ?? '';
    if (String(a) !== String(b)) parts.push(`${label} ${a ? `“${a}”` : '(blank)'} → ${b ? `“${b}”` : '(blank)'}`);
  }
  const key = (d: { name: string; date: string }) => `${d.name}|${d.date}`;
  const prevDates = new Map((prev.dates || []).map((d) => [key(d), d]));
  const nextDates = new Map((next.dates || []).map((d) => [key(d), d]));
  for (const [k, d] of nextDates) {
    const before = prevDates.get(k);
    if (!before) parts.push(`added date ${d.name}${d.date ? ` (${d.date})` : ''}`);
    else if (!before.done && d.done) parts.push(`completed ${d.name}`);
  }
  for (const [k, d] of prevDates) if (!nextDates.has(k)) parts.push(`removed date ${d.name}`);
  return parts.slice(0, 12).join('; ');
}

/**
 * One-time, idempotent correction of three email-template date mappings on
 * instances seeded before the fix. Only rewrites a template still holding the
 * known-old value, so user edits are never clobbered.
 */
function fixTemplateMappings(db: DB): void {
  const fixes: { id: string; from: string; to: string }[] = [
    { id: 'au-28', from: '', to: 'Accepted - Awaiting Advertisement' },
    { id: 'au-29', from: 'Opposition period expires', to: 'Publication Date' },
    { id: 'au-32', from: 'Renewal Deadline', to: 'Registration Date' },
    // AU examination uses a single "Acceptance Deadline", not "OA Response Due".
    { id: 'au-10', from: 'OA Response Due', to: 'Acceptance Deadline' },
    { id: 'au-12', from: 'OA Response Due', to: 'Acceptance Deadline' },
    { id: 'au-14', from: 'OA Response Due', to: 'Acceptance Deadline' },
    { id: 'au-76', from: 'OA Response Due', to: 'Acceptance Deadline' },
    { id: 'au-30', from: 'Registration Fee Due', to: 'Opposition period expires' },
    // US certificate of registration belongs on the registration date.
    { id: 'us-6', from: 'US Declaration of Use (5th-6th year)', to: 'Registration Date' },
    // AU opposition-stage emails must match the schedule's date names exactly
    // (ampersand + title case) so the send button appears on those dates.
    { id: 'au-55', from: 'Statement of Grounds and Particulars due', to: 'Statement of Grounds & Particulars due' },
    { id: 'au-56', from: 'Notice of intention to defend due', to: 'Notice of Intention to Defend due' },
  ];
  for (const f of fixes) {
    const row = db.prepare('SELECT doc FROM email_templates WHERE id=?').get(f.id) as { doc: string } | undefined;
    if (!row) continue;
    try {
      const t = JSON.parse(row.doc);
      if (t.dateField === f.from) {
        t.dateField = f.to;
        db.prepare('UPDATE email_templates SET doc=? WHERE id=?').run(JSON.stringify(t), f.id);
      }
    } catch {
      /* leave malformed rows alone */
    }
  }
}

/**
 * When a case's owner isn't already a contact, create a company record for them
 * so the case links to a contact and the owner appears under the Contacts tab.
 * Matched case/space/punctuation-insensitively; carries across any address the
 * case holds. Never creates duplicates and never overwrites an existing record.
 */
function ensureOwnerCompany(db: DB, m: Mark): void {
  const owner = (m.owner || '').trim();
  if (!owner) return;
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const key = norm(owner);
  if (!key) return;
  if (listCompanies(db).some((c) => norm(c.name || '') === key)) return;
  const abnAcn = [m.ownerAbn ? `ABN ${m.ownerAbn}` : '', m.ownerAcn ? `ACN ${m.ownerAcn}` : ''].filter(Boolean).join(' · ');
  const company: Company = {
    id: newId('c'),
    type: m.ownerType === 'Individual' ? 'Individual' : 'Company',
    contactType: 'Owner',
    name: owner,
    first: m.ownerFirst || '',
    last: m.ownerLast || '',
    address: m.address1 || '',
    address2: m.address2 || '',
    city: m.city || '',
    state: m.state || '',
    zip: m.zip || '',
    country: m.country || '',
    phone: m.phone || '',
    email: '',
    notes: abnAcn,
    contacts: [],
  } as Company;
  saveCompany(db, company);
}

function recordHistory(db: DB, markId: string, userName: string, summary: string): void {
  if (!summary) return;
  db.prepare('INSERT INTO mark_history(mark_id, at, user_name, summary) VALUES(?,?,?,?)').run(markId, new Date().toISOString(), userName || '', summary);
}

/** Look up a staff member's email address by their name (case-insensitive). */
function staffEmailByName(db: DB, name: string): string | null {
  if (!name) return null;
  const row = db.prepare(`SELECT email FROM staff_users WHERE name=? COLLATE NOCASE`).get(name) as { email?: string } | undefined;
  const email = row?.email?.trim();
  return email || null;
}

const portalUrl = () => (process.env.PORTAL_URL || '').trim();

/** "Action required" email for a single newly added deadline. */
function actionRequiredEmail(m: Mark, d: MarkDate): { subject: string; html: string } {
  const due = fmtDate(d.date);
  const link = portalUrl();
  const subject = `Action required: ${d.name} — ${m.name || 'trade mark'} (due ${due})`;
  const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#16233b">
    <p>A deadline attributed to you has been added in the trade marks system:</p>
    <table cellpadding="4" style="border-collapse:collapse">
      <tr><td><b>Matter</b></td><td>${escHtml(m.name)}${m.jurisdiction ? ' · ' + escHtml(m.jurisdiction) : ''}</td></tr>
      <tr><td><b>Deadline</b></td><td>${escHtml(d.name)}</td></tr>
      <tr><td><b>Due</b></td><td>${due}</td></tr>
      ${m.owner ? `<tr><td><b>Owner</b></td><td>${escHtml(m.owner)}</td></tr>` : ''}
    </table>
    <p>Please review this matter in the system.${link ? ` <a href="${escHtml(link)}">Open the trade marks system</a>.` : ''}</p>
  </div>`;
  return { subject, html };
}

interface DigestItem { date: string; name: string; mark: string; jur: string; overdue: boolean; }

/**
 * Send each staff member one email listing all of their outstanding items that
 * are due today or overdue. Items attributed to a staff member go to them; any
 * unattributed item (a system/seeded deadline, a reminder, or an opposition
 * date) goes to the fallback recipients (DIGEST_FALLBACK, default alexMJ,admin)
 * so nothing falls through the cracks. Intended to run once a day via a cPanel
 * cron using `RUN_TASK=daily-digest node app.cjs`.
 */
export interface DigestBucket { name: string; email: string; items: DigestItem[] }

/**
 * Group every outstanding item (due today or overdue) into one bucket per
 * recipient. Attributed items go to that staff member; unattributed ones go to
 * the fallback recipients (DIGEST_FALLBACK, default alexMJ,admin). Pure over the
 * database so it can be unit-tested without a mail server.
 */
export function buildDigests(db: DB, today: string): DigestBucket[] {
  const users = db.prepare(`SELECT name, email FROM staff_users WHERE email <> ''`).all() as { name: string; email: string }[];
  const emailByName = new Map(users.map((u) => [u.name.toLowerCase(), u.email.trim()]));
  const byUser = new Map<string, DigestBucket>();
  const fallbackNames = (process.env.DIGEST_FALLBACK || 'alexMJ,admin').split(',').map((s) => s.trim()).filter(Boolean);

  const addFor = (name: string, item: DigestItem) => {
    const email = emailByName.get(name.toLowerCase());
    if (!email) return;
    const key = name.toLowerCase();
    if (!byUser.has(key)) byUser.set(key, { name, email, items: [] });
    byUser.get(key)!.items.push(item);
  };
  // Attributed → the staff member; unattributed (or owner with no email set) →
  // the fallback recipients (alexMJ and admin by default).
  const add = (owner: string | undefined, item: DigestItem) => {
    if (owner && emailByName.has(owner.toLowerCase())) addFor(owner, item);
    else fallbackNames.forEach((n) => addFor(n, item));
  };

  const due = (iso: string | undefined) => !!iso && iso <= today; // today or overdue

  for (const m of listMarks(db)) {
    for (const d of m.dates || []) {
      if (d.done || !due(d.date)) continue;
      if (alertSuppressed(d.name, d.date, today, m.status)) continue;
      add(d.createdBy, { date: d.date, name: d.name, mark: m.name || '(untitled)', jur: m.jurisdiction || '', overdue: d.date < today });
    }
    for (const a of m.actions || []) {
      if (a.done || !a.alert) continue;
      const when = a.alertDate || a.date;
      if (!due(when)) continue;
      add(a.assignee || a.createdBy, { date: when, name: a.text || 'Action', mark: m.name || '(untitled)', jur: m.jurisdiction || '', overdue: when < today });
    }
  }
  // Opposition deadlines have no individual owner — route them to the fallback.
  for (const o of listOppositions(db)) {
    for (const d of o.dates || []) {
      if (d.done || d.suspend || !due(d.date)) continue;
      add(undefined, { date: d.date, name: d.name || 'Opposition deadline', mark: o.name || '(opposition)', jur: o.jurisdiction || '', overdue: d.date < today });
    }
  }
  for (const b of byUser.values()) b.items.sort((a, c) => (a.date < c.date ? -1 : 1));
  return [...byUser.values()];
}

export async function runDailyDigest(db: DB, opts: { today?: string } = {}): Promise<{ sent: number; recipients: string[] }> {
  if (!mailerConfigured()) return { sent: 0, recipients: [] };
  const today = opts.today || todayISO();
  const buckets = buildDigests(db, today);

  const sends: Promise<unknown>[] = [];
  const recipients: string[] = [];
  for (const { name, email, items } of buckets) {
    const rows = items
      .map(
        (it) =>
          `<tr><td style="padding:4px 8px;border:1px solid #ddd;color:${it.overdue ? '#d34b44' : '#16233b'}">${fmtDate(it.date)}${it.overdue ? ' · overdue' : ''}</td>` +
          `<td style="padding:4px 8px;border:1px solid #ddd">${escHtml(it.mark)}</td>` +
          `<td style="padding:4px 8px;border:1px solid #ddd">${escHtml(it.jur)}</td>` +
          `<td style="padding:4px 8px;border:1px solid #ddd">${escHtml(it.name)}</td></tr>`
      )
      .join('');
    const link = portalUrl();
    const html = `<div style="font-family:Calibri,Arial,sans-serif;font-size:11pt;color:#16233b">
      <p>Good morning ${escHtml(name.split(' ')[0] || name)},</p>
      <p>You have <b>${items.length}</b> item${items.length === 1 ? '' : 's'} requiring attention today:</p>
      <table style="border-collapse:collapse">
        <tr><th style="padding:4px 8px;border:1px solid #ddd;background:#eee;text-align:left">Due</th>
        <th style="padding:4px 8px;border:1px solid #ddd;background:#eee;text-align:left">Matter</th>
        <th style="padding:4px 8px;border:1px solid #ddd;background:#eee;text-align:left">Jurisdiction</th>
        <th style="padding:4px 8px;border:1px solid #ddd;background:#eee;text-align:left">Deadline</th></tr>
        ${rows}
      </table>
      <p>${link ? `<a href="${escHtml(link)}">Open the trade marks system</a>` : 'Open the trade marks system'} to action these.</p>
    </div>`;
    recipients.push(email);
    sends.push(sendMail({ to: email, subject: `Trade marks — ${items.length} action${items.length === 1 ? '' : 's'} due (${fmtDate(today)})`, html }).catch((e) => console.log(`Digest to ${email} failed:`, (e as Error).message)));
  }
  await Promise.allSettled(sends);
  return { sent: recipients.length, recipients };
}

function computeAlerts(db: DB, alertDays: number, forCompany?: string): AlertRow[] {
  const nowIso = todayISO();
  const win = (iso: string) => !!iso && daysBetween(nowIso, iso) <= alertDays;
  const rows: AlertRow[] = [];
  for (const m of listMarks(db)) {
    if (forCompany && m.owner !== forCompany) continue;
    (m.actions || []).forEach((a) => {
      if (a.alert && !a.done && a.alertDate)
        rows.push({ date: a.alertDate, kind: 'Action', refType: 'mark', refId: m.id, mark: m.name || '(untitled)', jur: m.jurisdiction || '', text: a.text || 'Action alert', owner: a.assignee || a.createdBy });
    });
    (m.dates || []).forEach((d) => {
      if (d.done || !d.date) return;
      if (alertSuppressed(d.name, d.date, nowIso, m.status)) return;
      if (win(d.date))
        rows.push({
          date: d.date,
          kind: d.reminder ? 'Client reminder' : 'Deadline',
          refType: 'mark',
          refId: m.id,
          mark: m.name || '(untitled)',
          jur: m.jurisdiction || '',
          text: (d.name || '').replace(/ — Reminder.*$/, ''),
          owner: d.createdBy,
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
  fixTemplateMappings(db);
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
      const row = db.prepare(`SELECT signature, email FROM staff_users WHERE id=?`).get(session.id) as { signature?: string; email?: string } | undefined;
      return res.json({ kind: 'staff', id: session.id, name: session.name, level: session.level, signature: row?.signature || '', email: row?.email || '' });
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

  // A staff member sets their own contact email (used for alert notifications).
  app.put('/api/auth/me/email', edit, (req, res) => {
    const session = readSession(db, req);
    if (!session || session.kind !== 'staff') return res.status(401).json({ error: 'Not signed in' });
    const email = String((req.body || {}).email || '').trim();
    db.prepare(`UPDATE staff_users SET email=? WHERE id=?`).run(email, session.id);
    res.json({ ok: true });
  });

  // Mail configuration status and a test send (Full permissions).
  app.get('/api/mail/status', view, (_req, res) => res.json({ configured: mailerConfigured() }));

  app.post('/api/mail/test', full, async (req, res) => {
    if (!mailerConfigured()) return res.status(400).json({ error: 'Email is not configured. Set SMTP_HOST, SMTP_USER and SMTP_PASS in the Node app environment.' });
    const session = readSession(db, req);
    const own = session?.kind === 'staff' ? staffEmailByName(db, session.name) : null;
    const to = String((req.body || {}).to || own || '').trim();
    if (!to) return res.status(400).json({ error: 'No address to send to — add your email in “My email sign-off” first.' });
    try {
      await sendMail({ to, subject: 'BrandU trade marks — test email', html: '<p>This is a test email from the trade marks system. Email is configured correctly.</p>' });
      res.json({ ok: true, to });
    } catch (e) {
      res.status(502).json({ error: `Send failed: ${(e as Error).message}` });
    }
  });

  // Manually trigger the daily digest (also runnable via RUN_TASK=daily-digest).
  app.post('/api/tasks/daily-digest', full, async (_req, res) => {
    try {
      const r = await runDailyDigest(db);
      res.json(r);
    } catch (e) {
      res.status(502).json({ error: (e as Error).message });
    }
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
    ensureAdminContact(m);
    saveMark(db, m);
    ensureOwnerCompany(db, m);
    const s = readSession(db, req);
    recordHistory(db, m.id, s?.kind === 'staff' ? s.name : '', 'Case created');
    res.status(201).json(m);
  });

  app.put('/api/marks/:id', edit, (req, res) => {
    const previous = getMark(db, req.params.id);
    if (!previous) return res.status(404).json({ error: 'Not found' });
    const incoming = { ...clone(req.body), id: req.params.id } as Mark;
    const result = processMarkWrite(db, incoming, previous);
    const s = readSession(db, req);
    recordHistory(db, req.params.id, s?.kind === 'staff' ? s.name : '', diffMarkSummary(previous, result));
    res.json(result);
  });

  app.get('/api/marks/:id/history', view, (req, res) => {
    res.json(db.prepare('SELECT at, user_name, summary FROM mark_history WHERE mark_id=? ORDER BY id DESC LIMIT 200').all(req.params.id));
  });

  app.delete('/api/marks/:id', edit, (req, res) => {
    deleteMark(db, req.params.id);
    res.json({ ok: true });
  });

  // On-demand database backup: stream a fresh, consistent snapshot of the whole
  // database to the browser as a download. VACUUM INTO gives a fully committed
  // copy while the app keeps running; the temp file is deleted once sent.
  app.get('/api/backup/download', full, (_req, res) => {
    const tmp = path.join(os.tmpdir(), `brandu-backup-${Date.now()}.sqlite`);
    try {
      snapshotDatabase(db, tmp);
    } catch (e) {
      return res.status(500).json({ error: e instanceof Error ? e.message : 'Backup failed.' });
    }
    const filename = `brandu-backup-${new Date().toISOString().slice(0, 10)}.sqlite`;
    res.download(tmp, filename, (err) => {
      fs.rm(tmp, { force: true }, () => undefined);
      if (err && !res.headersSent) res.status(500).end();
    });
  });

  // Reva-format export: every case written back into the legacy 205-column CSV
  // layout, so it can be handed to a developer to re-upload into Reva. This is
  // the portable, vendor-neutral backup (the .sqlite backup above restores THIS
  // app; this CSV round-trips to the old system).
  app.get('/api/backup/reva-csv', full, (_req, res) => {
    const csv = toRevaCsv(listMarks(db));
    const filename = `brandu-reva-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  });

  // Pin every current renewal deadline exactly as it stands now, so the date
  // engine can never silently recompute or shift it. This freezes the live
  // values as the source of truth WITHOUT recomputing anything first (running the
  // engine could itself move a non-pinned date), so whatever is on screen today
  // is exactly what gets locked. Reminders still recompute off the pinned date.
  // One transaction, O(n) — safe on large portfolios.
  app.post('/api/marks/pin-all-dates', full, (_req, res) => {
    const all = listMarks(db);
    let pinned = 0; // newly locked this run
    let alreadyPinned = 0; // renewal deadlines already locked (e.g. from import)
    let linkedIr = 0; // Madrid designations — renewal inherited from the IR
    let noRenewal = 0; // cases with no active renewal deadline yet (e.g. pending)
    const changed: Mark[] = [];
    for (const m of all) {
      const ren = (m.dates || []).find((d) => /^renewal deadline$/i.test(d.name) && d.date);
      if (!ren) { noRenewal++; continue; }
      if (ren.linkedToIR) { linkedIr++; continue; }
      if (ren.pinned) { alreadyPinned++; continue; }
      ren.pinned = true;
      pinned++;
      changed.push(m);
    }
    const tx = db.transaction(() => { for (const m of changed) saveMark(db, m); });
    tx();
    res.json({
      pinned,
      alreadyPinned,
      lockedTotal: pinned + alreadyPinned,
      linkedIr,
      noRenewal,
      casesTotal: all.length,
    });
  });

  // Add any missing renewal reminders to cases that already have a renewal
  // deadline. This ONLY inserts the reminder rows the jurisdiction's rulebook
  // defines (computed by counting back from the existing renewal date) — it
  // never touches, recomputes or moves the renewal deadline itself or any other
  // existing date, so it cannot corrupt source-of-truth dates. Reminders a user
  // deliberately deleted (suppressedRules) are not re-added.
  app.post('/api/marks/add-renewal-reminders', full, (_req, res) => {
    const book = loadRules(db);
    let remindersAdded = 0;
    const changed: Mark[] = [];
    for (const m of listMarks(db)) {
      const ren = (m.dates || []).find((d) => /^renewal deadline$/i.test(d.name) && d.date);
      if (!ren) continue;
      const list = isDesign(m.type) ? designRulesFor(m.jurisdiction) : rulesFor(book, m.jurisdiction);
      const reminderRules = list.filter((r) => r.trigger === 'Renewal Deadline' && /reminder/i.test(r.name));
      const have = new Set((m.dates || []).map((d) => d.name));
      const suppressed = new Set(m.suppressedRules || []);
      let ch = false;
      for (const r of reminderRules) {
        if (have.has(r.name) || suppressed.has(r.name)) continue;
        m.dates.push({
          name: r.name,
          date: shift(ren.date, r.v, r.u),
          done: false,
          auBase: 'Renewal Deadline',
          auOff: r.v,
          auUnit: r.u,
          auRem: Math.trunc(Number(r.rem)) || 0,
          auAlert: r.alerts,
        });
        remindersAdded++;
        ch = true;
      }
      if (ch) {
        m.dates.sort((a, b) => ((a.date || '9999') < (b.date || '9999') ? -1 : 1));
        changed.push(m);
      }
    }
    const tx = db.transaction(() => { for (const m of changed) saveMark(db, m); });
    tx();
    res.json({ remindersAdded, casesChanged: changed.length });
  });

  // Import Headstart details onto their cases (matched by number, then name +
  // jurisdiction). Headstart isn't on the public register, so it comes from the
  // legacy export. Adds the Headstart filing and preliminary-assessment dates;
  // the engine then builds the Headstart workflow. If the case has since been
  // filed as a full application, the whole Headstart phase is marked done so it
  // stays as history rather than raising stale alerts.
  app.post('/api/marks/import-headstart', full, (req, res) => {
    const rows: Record<string, string>[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'No rows to import.' });
    const rules = loadRules(db);
    const cuMonths = getFirmSettings(db).caseUpdateMonths;
    const index = indexCases(listMarks(db));
    let imported = 0;
    const unmatched: { trademark: string; jurisdiction: string }[] = [];
    const changed = new Set<Mark>();
    for (const row of rows) {
      const haf = parseImportDate(row.HeadstartApplicationFiled || '');
      const hpa = parseImportDate(row.HeadstartPrelimAssessmentReceived || '');
      const hfp = parseImportDate(row.HeadstartFeePaid || '');
      if (!haf && !hpa) continue;
      const mark = matchCase(row, index);
      if (!mark) { unmatched.push({ trademark: row.Trademark || '', jurisdiction: row.Jurisdiction || '' }); continue; }
      mark.dates = mark.dates || [];
      const setDate = (name: string, date: string) => {
        if (!date) return;
        const ex = mark.dates.find((d) => d.name === name);
        if (ex) { if (!ex.pinned) ex.date = date; } else mark.dates.push({ name, date, done: true });
      };
      setDate('Headstart - Application Filed', haf);
      setDate('Headstart - Preliminary Assessment Received', hpa);
      ensureRuleRows(mark, rules, undefined, cuMonths);
      // Fee paid: close off the "has the fee been paid?" chase.
      if (hfp) {
        const paid = mark.dates.find((d) => d.name === 'Headstart - Has the Part 2 Fee been Paid');
        if (paid) paid.done = true;
      }
      // If the mark has since been filed as a full application, the Headstart is
      // complete — tick every Headstart row so it's kept as history, not alerts.
      if (mark.dates.some((d) => d.name === 'Application Filed' && d.date)) {
        for (const d of mark.dates) if (/^headstart -/i.test(d.name) && !d.done) d.done = true;
      }
      mark.dates.sort((a, b) => ((a.date || '9999') < (b.date || '9999') ? -1 : 1));
      imported++;
      changed.add(mark);
    }
    const tx = db.transaction(() => { for (const m of changed) saveMark(db, m); });
    tx();
    res.json({ imported, unmatched: unmatched.length, unmatchedList: unmatched.slice(0, 100), casesChanged: changed.size, total: rows.length });
  });

  // Sync pending Australian cases against the official IP Australia register.
  // Batched (offset/limit) so it never times out on shared hosting: for each
  // pending AU case it fetches the live record and reconciles the STATUS and the
  // examination/anchor dates (application filed, first report / OA issued,
  // publication, registration). It never touches a pinned/locked date (renewals
  // are safe), never adds renewal rows (the engine derives those), and on a
  // now-registered case brings only filing + registration across. Deadlines are
  // then recomputed from the corrected anchors. Returns a per-case change log.
  app.post('/api/marks/sync-au-pending', full, async (req, res) => {
    if (!ipAuConfigured()) return res.status(400).json({ error: 'IP Australia lookup is not configured on this server.' });
    const offset = Math.max(0, Math.trunc(Number((req.body || {}).offset)) || 0);
    const limit = Math.min(20, Math.max(1, Math.trunc(Number((req.body || {}).limit)) || 10));
    const rules = loadRules(db);
    const cuMonths = getFirmSettings(db).caseUpdateMonths;
    const terminal = (s?: string) => !!s && /lapse|dead|withdraw|abandon|refus|remov|ceas|not renewed|expired|closed|finalis|finaliz|transfer/i.test(s);
    const candidates = listMarks(db)
      .filter((m) => ['Australia', 'Australia TTMF'].includes(m.jurisdiction) && !/register/i.test(m.status) && !terminal(m.status))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const batch = candidates.slice(offset, offset + limit);
    const changesLog: { id: string; name: string; number: string; changes: string[] }[] = [];
    const errors: { name: string; error: string }[] = [];
    for (const m0 of batch) {
      const number = (m0.application || m0.registration || '').trim();
      if (!number) continue;
      try {
        const fetched = await lookupTradeMark(number);
        const fresh = getMark(db, m0.id);
        if (!fresh) continue;
        const changes: string[] = [];
        if (fetched.status && fetched.status !== fresh.status) {
          changes.push(`Status: ${fresh.status || '(none)'} → ${fetched.status}`);
          fresh.status = fetched.status;
        }
        const fdates = fetched.dates || [];
        const isReg = /register/i.test(fetched.status || '') || fdates.some((d) => d.name === 'Registration Date' && d.date);
        const keepWhenReg = new Set(['Application Filed', 'Registration Date']);
        fresh.dates = fresh.dates || [];
        for (const f of fdates) {
          if (!f.date || /renewal/i.test(f.name)) continue;
          if (isReg && !keepWhenReg.has(f.name)) continue;
          const ex = fresh.dates.find((d) => d.name === f.name);
          if (!ex) { fresh.dates.push({ name: f.name, date: f.date, done: true }); changes.push(`+ ${f.name}: ${f.date}`); }
          else if (!ex.pinned && ex.date !== f.date) { changes.push(`${f.name}: ${ex.date || '(none)'} → ${f.date}`); ex.date = f.date; ex.done = true; }
        }
        if (changes.length) {
          ensureRuleRows(fresh, rules, undefined, cuMonths);
          ensureAdminContact(fresh);
          fresh.dates.sort((a, b) => ((a.date || '9999') < (b.date || '9999') ? -1 : 1));
          saveMark(db, fresh);
          changesLog.push({ id: fresh.id, name: fresh.name || number, number, changes });
        }
      } catch (e) {
        errors.push({ name: m0.name || number, error: (e as Error).message });
      }
    }
    res.json({ processed: batch.length, changed: changesLog.length, changesLog, errors, offset: offset + batch.length, total: candidates.length });
  });

  // Tidy registered cases: on any case that has a Registration Date, tick off
  // (mark done) every still-outstanding date dated on/before registration — the
  // pre-registration prosecution deadlines (office actions, acceptance,
  // publication, opposition windows) that are moot once the mark is registered.
  // Renewal-cluster rows are never touched. Nothing is deleted and no date value
  // changes: rows just move to "done" so they drop out of Alerts but stay as
  // ticked history.
  app.post('/api/marks/tidy-registered', full, (_req, res) => {
    let datesCleared = 0;
    const changed: Mark[] = [];
    for (const m of listMarks(db)) {
      const reg = (m.dates || []).find((d) => d.name === 'Registration Date' && d.date)?.date;
      if (!reg) continue;
      let ch = false;
      for (const d of m.dates || []) {
        if (!d.done && d.date && d.date <= reg && !/renewal|grace/i.test(d.name) && d.name !== 'Registration Date') {
          d.done = true;
          datesCleared++;
          ch = true;
        }
      }
      if (ch) changed.push(m);
    }
    const tx = db.transaction(() => { for (const m of changed) saveMark(db, m); });
    tx();
    res.json({ datesCleared, casesChanged: changed.length });
  });

  // Record the firm Admin contact on every existing case that doesn't have it.
  // New/edited cases get it automatically on save; this backfills the rest.
  app.post('/api/marks/add-admin-contact', full, (_req, res) => {
    const all = listMarks(db);
    const changed: Mark[] = [];
    for (const m of all) if (ensureAdminContact(m)) changed.push(m);
    const tx = db.transaction(() => { for (const m of changed) saveMark(db, m); });
    tx();
    res.json({ added: changed.length, casesTotal: all.length });
  });

  // Backfill each case's owner ADDRESS and CONTACTS from the matching contact
  // (company) record. The full-mirror import carries only the owner's NAME, so
  // the address and contacts live in the separately-imported Contacts records —
  // this links them onto every case by owner name. Only fills blanks (never
  // overwrites a detail already on the case); contacts from the owner record are
  // appended if the case has none of its own (the firm Admin contact aside).
  app.post('/api/marks/backfill-owner-details', full, (_req, res) => {
    const companies = listCompanies(db);
    const exact = new Map<string, typeof companies[number]>();
    const loose = new Map<string, typeof companies[number]>();
    const nExact = (s?: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const nLoose = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    for (const co of companies) {
      const e = nExact(co.name); if (e && !exact.has(e)) exact.set(e, co);
      const l = nLoose(co.name); if (l && !loose.has(l)) loose.set(l, co);
    }
    const all = listMarks(db);
    const changed: Mark[] = [];
    let addressFilled = 0;
    let contactsFilled = 0;
    let noMatch = 0;
    for (const m of all) {
      if (!m.owner) continue;
      const co = exact.get(nExact(m.owner)) || loose.get(nLoose(m.owner));
      if (!co) { noMatch++; continue; }
      let touched = false;
      // Fill address blanks only.
      type StrKey = 'address1' | 'address2' | 'city' | 'state' | 'zip' | 'country' | 'phone';
      const setIf = (key: StrKey, val?: string) => {
        if (val && !m[key]) { m[key] = val; touched = true; }
      };
      const before = touched;
      setIf('address1', co.address);
      setIf('address2', co.address2);
      setIf('city', co.city);
      setIf('state', co.state);
      setIf('zip', co.zip);
      setIf('country', co.country);
      setIf('phone', co.phone);
      if (!m.ownerType && (co.type === 'Individual' || co.type === 'Company')) { m.ownerType = co.type; touched = true; }
      if (touched && !before) addressFilled++;
      // Append owner contacts if the case has none of its own (Admin aside).
      const ownContacts = (m.contacts || []).filter((c) => (c.email || '').toLowerCase() !== ADMIN_CONTACT.email);
      const coContacts = (co.contacts || []).filter((c) => c.name || c.first || c.last || c.email);
      if (ownContacts.length === 0 && coContacts.length) {
        const mapped = coContacts.map((c) => ({
          name: c.name || [c.first, c.last].filter(Boolean).join(' '),
          company: co.name,
          position: c.position || c.title || '',
          phone: c.phone || '',
          email: c.email || '',
        }));
        m.contacts = [...(m.contacts || []), ...mapped];
        contactsFilled++;
        touched = true;
      }
      if (touched) { ensureAdminContact(m); changed.push(m); }
    }
    const tx = db.transaction(() => { for (const m of changed) saveMark(db, m); });
    tx();
    res.json({ casesChanged: changed.length, addressFilled, contactsFilled, noMatch, casesTotal: all.length });
  });

  // Import legacy "Trademark Action" diary entries from the firm's alert export.
  // Each row is matched to a case by application/registration number (then by
  // name + jurisdiction). Standard jurisdiction/reminder date names are skipped
  // (the engine already generates those); only free-text actions are added, as
  // an alerting, not-done action keeping its original date. Duplicates (an action
  // with the same text already on the case) are skipped. Nothing else is touched.
  app.post('/api/marks/import-actions', full, (req, res) => {
    const rows: Record<string, string>[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'No rows to import.' });
    const index = indexCases(listMarks(db));
    let imported = 0;
    let skipped = 0;
    const unmatched: { trademark: string; jurisdiction: string; dateName: string }[] = [];
    const changed = new Set<Mark>();
    for (const row of rows) {
      const dn = String(row.DateName || '').trim();
      if (!dn) continue;
      if (isStandardDateName(dn)) { skipped++; continue; }
      const mark = matchCase(row, index);
      if (!mark) { unmatched.push({ trademark: row.Trademark || '', jurisdiction: row.Jurisdiction || '', dateName: dn }); continue; }
      if ((mark.actions || []).some((a) => normName(a.text) === normName(dn))) { skipped++; continue; }
      mark.actions = mark.actions || [];
      mark.actions.push(toAction(dn, parseImportDate(String(row.Date || ''))));
      imported++;
      changed.add(mark);
    }
    const tx = db.transaction(() => { for (const m of changed) saveMark(db, m); });
    tx();
    res.json({ imported, skipped, unmatched: unmatched.length, unmatchedList: unmatched.slice(0, 200), casesChanged: changed.size, total: rows.length });
  });

  // Re-run the deadline engine over every case, so rulebook changes (new
  // reminders, jurisdiction dates) backfill onto existing cases. Madrid families
  // are recomputed with the full set so designation renewals re-link correctly.
  app.post('/api/marks/recompute-all', full, (_req, res) => {
    // Load the whole portfolio ONCE and recompute in memory against that shared
    // array, then persist in a single transaction. (Calling processMarkWrite per
    // case re-reads every mark each time — O(n²) — which times out on large
    // portfolios.) The engine takes the shared array so Madrid designation
    // renewals still re-link to their IR.
    const rules = loadRules(db);
    const all = listMarks(db);
    const cuMonths = getFirmSettings(db).caseUpdateMonths;
    let recomputed = 0;
    const failed: { id: string; name: string; error: string }[] = [];
    for (const m of all) {
      try {
        ensureRuleRows(m, rules, all, cuMonths);
        m.dates.sort((a, b) => ((a.date || '9999') < (b.date || '9999') ? -1 : 1));
        recomputed++;
      } catch (e) {
        failed.push({ id: m.id, name: m.name || '(untitled)', error: e instanceof Error ? e.message : String(e) });
      }
    }
    // Keep the Madrid family in sync (IR number + logo/audio down to designations).
    for (const ir of all.filter((x) => x.jurisdiction === 'Madrid Protocol (WIPO)')) {
      for (const x of all) {
        if (x.irId === ir.id) {
          x.irNumber = ir.irNumber || '';
          if (ir.image && !x.image) x.image = ir.image;
          if (ir.audioUrl && !x.audioUrl) x.audioUrl = ir.audioUrl;
        }
      }
    }
    const tx = db.transaction(() => { for (const m of all) saveMark(db, m); });
    tx();
    res.json({ recomputed, failed });
  });

  // Bulk import cases from parsed CSV rows. Each row becomes a case, run through
  // the deadline engine so renewals/reminders compute from the imported dates.
  app.post('/api/marks/import', full, (req, res) => {
    const rows: Record<string, string>[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'No rows to import.' });
    // Build every case in memory and run the engine per row WITHOUT re-reading the
    // portfolio each time (that made a large import O(n²) and time out). Imported
    // cases are standalone (no Madrid family links until linked in-app), so the
    // engine doesn't need the full set here. Persist in one transaction.
    const rules = loadRules(db);
    const cuMonths = getFirmSettings(db).caseUpdateMonths;
    const errors: { line: number; error: string }[] = [];
    const built: Mark[] = [];
    rows.forEach((row, i) => {
      try {
        const m = blankMark(csvRowToMark(row));
        ensureRuleRows(m, rules, undefined, cuMonths);
        m.dates.sort((a, b) => ((a.date || '9999') < (b.date || '9999') ? -1 : 1));
        built.push(m);
      } catch (e) {
        errors.push({ line: i + 2, error: (e as Error).message }); // +2: header row + 1-indexed
      }
    });
    const tx = db.transaction(() => {
      for (const m of built) {
        saveMark(db, m);
        recordHistory(db, m.id, 'Import', 'Case created (CSV import)');
      }
    });
    tx();
    res.json({ imported: built.length, errors, total: rows.length });
  });

  // Full-mirror import: bring the legacy's dates across VERBATIM. Every date
  // column becomes a pinned date row (named exactly as in the legacy export), so
  // the case mirrors the legacy database date-for-date. The deadline engine is
  // deliberately NOT run here — nothing is recomputed — so no date can diverge
  // from the source. O(n): build in memory, persist in one transaction.
  app.post('/api/marks/import-full', full, (req, res) => {
    const rows: Record<string, string>[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'No rows to import.' });
    const errors: { line: number; error: string }[] = [];
    const built: Mark[] = [];
    let totalDates = 0;
    rows.forEach((row, i) => {
      try {
        const m = blankMark(fullRowToMark(row));
        ensureAdminContact(m);
        m.dates.sort((a, b) => ((a.date || '9999') < (b.date || '9999') ? -1 : 1));
        totalDates += m.dates.length;
        built.push(m);
      } catch (e) {
        errors.push({ line: i + 2, error: (e as Error).message });
      }
    });
    const tx = db.transaction(() => {
      for (const m of built) {
        saveMark(db, m);
        recordHistory(db, m.id, 'Import', 'Case imported (full mirror — dates locked)');
      }
    });
    tx();
    res.json({ imported: built.length, dates: totalDates, errors, total: rows.length });
  });

  // Bulk-delete selected cases. Restricted to the principal (Natalie) — a
  // deliberately high bar for a destructive, multi-case action. Enforced here on
  // the server, not just hidden in the UI.
  app.post('/api/marks/bulk-delete', edit, (req, res) => {
    const s = readSession(db, req);
    if (!(s?.kind === 'staff' && /^natalie$/i.test(s.name || ''))) {
      return res.status(403).json({ error: 'Only Natalie can bulk-delete cases.' });
    }
    const ids: string[] = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
    if (!ids.length) return res.status(400).json({ error: 'No cases selected.' });
    let deleted = 0;
    const tx = db.transaction(() => {
      for (const id of ids) {
        if (getMark(db, id)) { deleteMark(db, id); db.prepare('DELETE FROM mark_history WHERE mark_id=?').run(id); deleted++; }
      }
    });
    tx();
    res.json({ deleted });
  });

  // Delete EVERY case (and, implicitly, their Madrid links). Full permissions,
  // guarded by an explicit confirm token so it can't fire by accident.
  app.delete('/api/marks', full, (req, res) => {
    if (String(req.query.confirm) !== 'DELETE-ALL') return res.status(400).json({ error: 'Missing confirmation.' });
    const before = listMarks(db).length;
    db.prepare('DELETE FROM marks').run();
    db.prepare('DELETE FROM mark_history').run();
    res.json({ deleted: before });
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
        audioUrl: basic.audioUrl,
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
          // A designation is the same mark — carry the logo/graphic (and any
          // sound-mark audio) down from the basic case.
          image: basic.image || null,
          audioUrl: basic.audioUrl,
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

  // ---- bulk logo tools ------------------------------------------------------
  const normOwner = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const normName = (s?: string) => (s || '').toLowerCase().replace(/\b(logo|device|stylised|stylized|word|series)\b/g, '').replace(/[^a-z0-9]/g, '');
  const isGraphic = (t?: string) => /logo|combined|stylis|device|figurative/i.test(t || '');
  const isLive = (s?: string) => /^(registered|pending|accepted)/i.test(s || '');
  const saveLogo = (buffer: Buffer, contentType: string) => {
    const ext = contentType.includes('png') ? '.png' : contentType.includes('gif') ? '.gif' : contentType.includes('svg') ? '.svg' : '.jpg';
    const name = `${randomBytes(8).toString('hex')}${ext}`;
    fs.writeFileSync(path.join(uploadsDir, name), buffer);
    return `/files/${name}`;
  };

  // Fetch logos for Australian graphic cases from the IP Australia register, in
  // batches (the client loops with the returned offset) so it never times out.
  app.post('/api/marks/logos/fetch-au', full, async (req, res) => {
    if (!ipAuConfigured()) return res.status(400).json({ error: 'IP Australia lookup is not configured on this server.' });
    const offset = Math.max(0, Math.trunc(Number((req.body || {}).offset)) || 0);
    const limit = Math.min(30, Math.max(1, Math.trunc(Number((req.body || {}).limit)) || 12));
    const overwrite = !!(req.body || {}).overwrite;
    const candidates = listMarks(db)
      .filter((m) => ['Australia', 'Australia TTMF'].includes(m.jurisdiction) && isGraphic(m.type) && isLive(m.status))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const batch = candidates.slice(offset, offset + limit);
    let updated = 0;
    let withImageUrl = 0, noImageOnRegister = 0, downloadFailed = 0, noNumber = 0;
    let notFound = 0, rateLimited = 0, authErr = 0, otherErr = 0, alreadyHave = 0;
    const errors: { name: string; error: string }[] = [];
    for (const m of batch) {
      if (m.image && !overwrite) { alreadyHave++; continue; }
      // AU register lookups key on the numeric trade-mark number; take the first
      // number in the application/registration field (the mirror export sometimes
      // holds free text like "IR No.1234567 / 5952431").
      const raw = m.application || m.registration || '';
      const num = (raw.match(/\d{5,}/) || [raw.trim()])[0];
      if (!num) { noNumber++; continue; }
      try {
        // Look up WITHOUT saving first, so we can tell whether the register even
        // has an image, then download and store it explicitly — surfacing any
        // failure instead of swallowing it (the old code hid image-download
        // errors, which showed up as a silent "0 added").
        const fields = await lookupTradeMark(num);
        if (!fields.image) { noImageOnRegister++; continue; }
        withImageUrl++;
        let imgRes: Awaited<ReturnType<typeof fetch>>;
        try {
          imgRes = await fetch(fields.image, { headers: { Accept: 'image/*' } });
        } catch (e) {
          downloadFailed++; errors.push({ name: m.name || num, error: `image download error: ${(e as Error).message}` }); continue;
        }
        if (!imgRes.ok) { downloadFailed++; errors.push({ name: m.name || num, error: `image download HTTP ${imgRes.status}` }); continue; }
        const ct = imgRes.headers.get('content-type') || 'image/jpeg';
        const url = saveLogo(Buffer.from(await imgRes.arrayBuffer()), ct);
        const fresh = getMark(db, m.id);
        if (fresh && (overwrite || !fresh.image)) { fresh.image = url; saveMark(db, fresh); updated++; }
      } catch (e) {
        // Bucket the failure so a "0 added" run can explain itself: not-found vs
        // rate-limited vs auth vs other (server config / API change).
        const status = e instanceof IpAuError ? e.status : 0;
        const msg = (e as Error).message || '';
        if (status === 404) notFound++;
        else if (status === 429 || /\b429\b/.test(msg)) rateLimited++;
        else if (status === 401 || status === 403) authErr++;
        else { otherErr++; if (errors.length < 20) errors.push({ name: m.name || num, error: msg }); }
      }
    }
    res.json({ processed: batch.length, updated, withImageUrl, noImageOnRegister, downloadFailed, noNumber, notFound, rateLimited, authErr, otherErr, alreadyHave, offset: offset + batch.length, total: candidates.length, errors });
  });

  // Copy each case's logo onto related cases that lack one — matched by owner +
  // normalised mark name, so a Madrid IR / designation / other-jurisdiction
  // filing inherits the Australian basic's logo. Fill-empty only; never overwrites.
  app.post('/api/marks/logos/propagate', full, (_req, res) => {
    const all = listMarks(db);
    const src = new Map<string, string>();
    for (const m of all) {
      if (!m.image) continue;
      const key = `${normOwner(m.owner)}|${normName(m.name)}`;
      if (['Australia', 'Australia TTMF'].includes(m.jurisdiction) || !src.has(key)) src.set(key, m.image);
    }
    const changed: Mark[] = [];
    for (const m of all) {
      if (m.image) continue;
      const img = src.get(`${normOwner(m.owner)}|${normName(m.name)}`);
      if (img) { m.image = img; changed.push(m); }
    }
    const tx = db.transaction(() => { for (const m of changed) saveMark(db, m); });
    tx();
    res.json({ updated: changed.length });
  });

  // Attach already-uploaded logo files to cases, matching each file's name (minus
  // extension) against a case's application no. / registration no. / our ref.
  // A ref that identifies a family attaches to every case in it. Fill-empty
  // unless overwrite is set.
  app.post('/api/marks/logos/attach', full, (req, res) => {
    const files: { name: string; url: string }[] = Array.isArray(req.body?.files) ? req.body.files : [];
    const overwrite = !!(req.body || {}).overwrite;
    if (!files.length) return res.status(400).json({ error: 'No files provided.' });
    const key = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const idx = new Map<string, Mark[]>();
    const add = (k: string, m: Mark) => { if (!k) return; const a = idx.get(k) || []; a.push(m); idx.set(k, a); };
    for (const m of listMarks(db)) { add(key(m.application), m); add(key(m.registration), m); add(key(m.matter), m); }
    const changed = new Set<Mark>();
    const unmatched: string[] = [];
    let filesMatched = 0;
    for (const f of files) {
      const k = key((f.name || '').replace(/\.[^.]+$/, ''));
      const matches = idx.get(k) || [];
      if (!matches.length) { unmatched.push(f.name); continue; }
      filesMatched++;
      for (const m of matches) { if (!m.image || overwrite) { m.image = f.url; changed.add(m); } }
    }
    const tx = db.transaction(() => { for (const m of changed) saveMark(db, m); });
    tx();
    res.json({ filesMatched, marksUpdated: changed.size, unmatched, totalFiles: files.length });
  });

  // Link Madrid families across the portfolio. The international registration
  // number is embedded in the legacy application/registration fields (e.g.
  // "IR No.1683883/Reg No. 7410669"); parse it, group every case that shares it,
  // and set a common madridId + irNumber, pointing each designation at the
  // Madrid Protocol (WIPO) case. Fields are set directly (no engine run) so the
  // imported/pinned dates are preserved.
  const IR_RE = /\bIR\s*No\.?\s*0*(\d{4,})/i;
  const extractIr = (m: Mark): string => {
    for (const s of [m.irNumber, m.application, m.registration]) {
      const mm = IR_RE.exec(s || '');
      if (mm) return mm[1];
    }
    return '';
  };
  // Strip the "IR No.<n>" prefix (and a following Reg/App-No label) to leave just
  // the national number(s), e.g. "IR No.1683883/Reg No. 2554746(29)" → "2554746(29)".
  const tidyNational = (s: string): string => {
    if (!s || !/\bIR\s*No/i.test(s)) return s;
    let out = s.replace(/\bIR\s*No\.?\s*0*\d+/gi, ' '); // drop the IR token wherever it sits
    out = out.replace(/\b(?:Reg(?:istration)?\s*No\.?|App(?:lication)?\s*No\.?|Serial\s*No\.?|SN\.?)/gi, ' '); // drop labels
    out = out.replace(/\s*\/\s*/g, ' / ').replace(/(?:\/\s*){2,}/g, '/ ').replace(/\s{2,}/g, ' ');
    return out.replace(/^[\s/,;·:.-]+|[\s/,;·:.-]+$/g, '').trim();
  };
  const nOwner = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const nName = (s?: string) => (s || '').toLowerCase().replace(/\b(logo|device|stylised|stylized|word|series|and logo)\b/g, '').replace(/[^a-z0-9]/g, '');

  app.post('/api/marks/link-madrid', full, (_req, res) => {
    const all = listMarks(db);
    const changed = new Set<Mark>();
    const groups = new Map<string, Mark[]>();
    // Pass 1: set irNumber, tidy the number fields, and group by IR number.
    for (const m of all) {
      const ir = extractIr(m);
      if (!ir) continue;
      if ((m.irNumber || '') !== ir) { m.irNumber = ir; changed.add(m); }
      const app = tidyNational(m.application);
      const reg = tidyNational(m.registration);
      if (app !== m.application) { m.application = app; changed.add(m); }
      if (reg !== m.registration) { m.registration = reg; changed.add(m); }
      const a = groups.get(ir) || []; a.push(m); groups.set(ir, a);
    }
    // Index of potential AU/NZ basic cases (no IR number of their own).
    const basics = new Map<string, Mark>();
    for (const m of all) {
      if (extractIr(m)) continue;
      if (!['Australia', 'Australia TTMF', 'New Zealand'].includes(m.jurisdiction)) continue;
      const k = `${nOwner(m.owner)}|${nName(m.name)}`;
      if (k !== '|' && !basics.has(k)) basics.set(k, m);
    }
    let families = 0;
    let auLinked = 0;
    for (const [ir, members] of groups) {
      // Never hijack a family created in-app via the Madrid feature (madridId
      // "fam-…" / has a basicId) — only manage imported/standalone cases.
      const managed = members.filter((x) => !(x.madridId || '').startsWith('fam-') && !x.basicId);
      if (managed.length < 2) continue;
      families++;
      const famId = `mfam-${ir}`;
      const irCase = managed.find((x) => x.jurisdiction === 'Madrid Protocol (WIPO)');
      for (const x of managed) {
        if (x.madridId !== famId) { x.madridId = famId; changed.add(x); }
        // Keep each case INDEPENDENT: relate for navigation, but never turn it
        // into a locked designation (which would inherit/hide its renewal and
        // override the imported source-of-truth date). Clear any prior irId /
        // inherited-renewal lock left by an earlier run.
        if (x.irId) { x.irId = undefined; changed.add(x); }
        for (const d of x.dates || []) { if (d.linkedToIR) { d.linkedToIR = false; delete d.auBase; changed.add(x); } }
      }
      // Relate the originating AU/NZ basic too (navigation only, no irId).
      const anchor = irCase || managed[0];
      const basic = basics.get(`${nOwner(anchor.owner)}|${nName(anchor.name)}`);
      if (basic && basic.madridId !== famId && !basic.irId) {
        basic.madridId = famId;
        changed.add(basic);
        auLinked++;
      }
    }
    const tx = db.transaction(() => { for (const m of changed) saveMark(db, m); });
    tx();
    res.json({ families, linked: changed.size, auBasicsLinked: auLinked });
  });

  // Verify the live database against the authoritative import CSV. Read-only:
  // matches each CSV row to a case (jurisdiction + mark name + owner + filing
  // date) and reports any where the key dates differ from the source of truth.
  app.post('/api/marks/verify-import', full, (req, res) => {
    const rows: Record<string, string>[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'No rows to verify.' });
    const nName = (s?: string) => (s || '').toLowerCase().replace(/\b(logo|device|stylised|stylized|word|series|and logo)\b/g, '').replace(/[^a-z0-9]/g, '');
    const nOwner = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const nJur = (s?: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    const dateOf = (m: Mark, n: string) => (m.dates || []).find((d) => d.name === n)?.date || '';
    // First value present among several possible column spellings (full-mirror
    // uses the legacy date-column names; a plain import CSV uses short aliases).
    const pick = (r: Record<string, string>, ...keys: string[]) => {
      for (const k of keys) if (r[k] != null && String(r[k]).trim() !== '') return String(r[k]).trim();
      return '';
    };
    // Match a file row to a case by a UNIQUE identifying number, else by a UNIQUE
    // jurisdiction + mark name + owner. Everything is scoped by jurisdiction (a
    // Madrid family shares one IR number across every country), and we extract
    // every 5+ digit number from the application/registration fields — the firm's
    // export often stuffs several numbers into one field (e.g. "IR No.1739217/Reg
    // No.7424123"), and the local serial/registration number is what tells same-
    // country, same-name twins apart. We only accept a match when it is unique,
    // so an ambiguous twin is reported as "not matched" rather than paired with
    // its sibling (which would invent a false date difference).
    const digitToks = (s?: string): string[] => (s || '').match(/\d{5,}/g) || [];
    const tokIndex = new Map<string, Set<Mark>>();
    const compIndex = new Map<string, Mark[]>();
    for (const m of listMarks(db)) {
      const j = nJur(m.jurisdiction);
      for (const src of [m.application, m.registration]) {
        for (const t of digitToks(src)) {
          const k = `${j}|${t}`;
          let set = tokIndex.get(k);
          if (!set) { set = new Set(); tokIndex.set(k, set); }
          set.add(m);
        }
      }
      const ck = `${j}|${nName(m.name)}|${nOwner(m.owner)}`;
      const arr = compIndex.get(ck);
      if (arr) arr.push(m); else compIndex.set(ck, [m]);
    }
    const find = (r: Record<string, string>): Mark | undefined => {
      const j = nJur(pick(r, 'Jurisdiction'));
      for (const src of [pick(r, 'ApplicationNo', 'ApplicationNumber', 'Application'), pick(r, 'RegistrationNo', 'RegistrationNumber', 'Registration')]) {
        for (const t of digitToks(src)) {
          const set = tokIndex.get(`${j}|${t}`);
          if (set && set.size === 1) return set.values().next().value;
        }
      }
      const g = compIndex.get(`${j}|${nName(pick(r, 'MarkName', 'Name'))}|${nOwner(pick(r, 'OwnerName', 'Owner'))}`);
      return g && g.length === 1 ? g[0] : undefined;
    };
    // Compare the key deadlines. Each entry lists the legacy column name first,
    // then the short alias, then the matching date row on the case.
    const fields: { cols: string[]; row: string }[] = [
      { cols: ['Application Filed', 'FiledDate'], row: 'Application Filed' },
      { cols: ['Registration Date', 'RegistrationDate'], row: 'Registration Date' },
      { cols: ['Renewal Deadline', 'RenewalDate'], row: 'Renewal Deadline' },
    ];
    let matched = 0;
    let unmatched = 0;
    const mismatches: { id: string; name: string; jur: string; field: string; source: string; current: string }[] = [];
    for (const r of rows) {
      const m = find(r);
      if (!m) { unmatched++; continue; }
      matched++;
      for (const f of fields) {
        const source = parseImportDate(pick(r, ...f.cols));
        const current = dateOf(m, f.row);
        if (source && source !== current) {
          mismatches.push({ id: m.id, name: m.name || '(untitled)', jur: m.jurisdiction, field: f.row, source, current: current || '(none)' });
        }
      }
    }
    res.json({ checked: rows.length, matched, unmatched, mismatches: mismatches.slice(0, 500), mismatchCount: mismatches.length });
  });

  // Tidy up historical alerts: mark every not-done deadline / reminder / flagged
  // action (and opposition date) dated before `before` (YYYY-MM-DD) as done, so
  // it drops out of the Alerts list. Rows stay on the case as ticked history;
  // deleting them wouldn't stick because the engine recomputes rule rows.
  app.post('/api/marks/clear-old-alerts', full, (req, res) => {
    const before = String((req.body || {}).before || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(before)) return res.status(400).json({ error: 'Provide a cut-off date as YYYY-MM-DD.' });
    const marks = listMarks(db);
    let markDates = 0;
    let actions = 0;
    const changedMarks = new Set<Mark>();
    for (const m of marks) {
      let ch = false;
      for (const d of m.dates || []) {
        if (d.date && !d.done && d.date < before) { d.done = true; markDates++; ch = true; }
      }
      for (const a of m.actions || []) {
        const when = a.alertDate || a.date;
        if (a.alert && !a.done && when && when < before) { a.done = true; actions++; ch = true; }
      }
      if (ch) changedMarks.add(m);
    }
    const opps = listOppositions(db);
    let oppDates = 0;
    const changedOpps = new Set<Opposition>();
    for (const o of opps) {
      let ch = false;
      for (const d of o.dates || []) {
        if (d.date && !d.done && d.date < before) { d.done = true; oppDates++; ch = true; }
      }
      if (ch) changedOpps.add(o);
    }
    const tx = db.transaction(() => {
      for (const m of changedMarks) saveMark(db, m);
      for (const o of changedOpps) saveOpposition(db, o);
    });
    tx();
    res.json({ before, markDates, actions, oppDates });
  });

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
    const sched = oppSchedule(o.jurisdiction, o.kind);
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

  // Bulk import contacts/companies. Flat rows (one per contact) are grouped into
  // companies by name; an existing company of the same name gains the new
  // contacts rather than being duplicated.
  app.post('/api/companies/import', full, (req, res) => {
    const rows: Record<string, string>[] = Array.isArray(req.body?.rows) ? req.body.rows : [];
    if (!rows.length) return res.status(400).json({ error: 'No rows to import.' });
    const { companies, skipped } = groupCompanies(rows);
    const existing = new Map(listCompanies(db).map((c) => [(c.name || '').toLowerCase().replace(/[^a-z0-9]/g, ''), c]));
    let created = 0;
    let merged = 0;
    let contacts = 0;
    const tx = db.transaction(() => {
      for (const g of companies) {
        const key = (g.name || '').toLowerCase().replace(/[^a-z0-9]/g, '');
        const prior = existing.get(key);
        if (prior) {
          // Fill any company-level fields the existing (e.g. seed-derived) record
          // is missing — never overwrite data that's already there.
          const pri = prior as unknown as Record<string, unknown>;
          const gg = g as unknown as Record<string, unknown>;
          for (const f of ['contactType', 'address', 'address2', 'city', 'state', 'zip', 'country', 'phone', 'email', 'notes']) {
            if (gg[f] && !pri[f]) pri[f] = gg[f];
          }
          const have = new Set((prior.contacts || []).map((c) => (c.email || c.name || '').toLowerCase()));
          for (const c of g.contacts || []) {
            const id = (c.email || c.name || '').toLowerCase();
            if (id && !have.has(id)) { prior.contacts = [...(prior.contacts || []), c]; have.add(id); contacts++; }
          }
          saveCompany(db, prior);
          merged++;
        } else {
          const c: Company = {
            id: newId('c'), type: 'Company', name: '', address: '', address2: '', city: '', state: '', zip: '',
            country: '', phone: '', email: '', notes: '', contacts: [], ...g,
          } as Company;
          saveCompany(db, c);
          existing.set(key, c);
          created++;
          contacts += (c.contacts || []).length;
        }
      }
    });
    tx();
    res.json({ created, merged, contacts, skipped, total: rows.length });
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

  // Copy a set of date rules from one source (the master list, the baseline, or
  // any jurisdiction) across to one or more target jurisdictions in a single
  // transaction. `mode` 'merge' adds only dates the target doesn't already have
  // (matched by name); 'replace' overwrites the target's list. Optional `names`
  // limits the copy to a chosen subset of the source's dates. Copied rules are
  // marked custom so they survive future rulebook upgrades.
  app.post('/api/rules/copy', full, (req, res) => {
    const source = String(req.body?.source || '');
    const targets: string[] = Array.isArray(req.body?.targets) ? req.body.targets.map(String) : [];
    const mode = req.body?.mode === 'replace' ? 'replace' : 'merge';
    const names: string[] | null = Array.isArray(req.body?.names) ? req.body.names.map(String) : null;
    const rules = loadRules(db);
    let sourceList: Rule[] = rules[source] || [];
    if (names) sourceList = sourceList.filter((r) => names.includes(r.name));
    if (!sourceList.length) return res.status(400).json({ error: 'The source has no dates to copy.' });
    const clone = (): Rule[] => (JSON.parse(JSON.stringify(sourceList)) as Rule[]).map((r) => ({ ...r, custom: true }));
    const changed: RuleBook = {};
    for (const t of targets) {
      // Never copy onto the source itself or onto the reserved catalogue keys.
      if (!t || t === source || t === '_master' || t === '_default') continue;
      const existing = rules[t] || [];
      if (mode === 'replace') {
        changed[t] = clone();
      } else {
        const have = new Set(existing.map((r) => r.name));
        changed[t] = existing.concat(clone().filter((r) => !have.has(r.name)));
      }
    }
    const copied = Object.keys(changed).length;
    if (!copied) return res.status(400).json({ error: 'No valid target jurisdictions.' });
    saveRules(db, changed);
    res.json({ copied, targets: Object.keys(changed), rules: { ...rules, ...changed } });
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
    res.json(db.prepare(`SELECT id, name, level, signature, email, title FROM staff_users ORDER BY name`).all());
  });

  // Lightweight staff directory for populating "responsible attorney" / assignee
  // dropdowns — readable by any signed-in staff member (not just admins).
  app.get('/api/staff-names', view, (_req, res) => {
    res.json(db.prepare(`SELECT name, title FROM staff_users WHERE level <> 'No Access' ORDER BY name`).all());
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
    const { signature, email, title } = req.body || {};
    if (name) db.prepare(`UPDATE staff_users SET name=? WHERE id=?`).run(String(name), req.params.id);
    if (level) db.prepare(`UPDATE staff_users SET level=? WHERE id=?`).run(String(level), req.params.id);
    if (password) db.prepare(`UPDATE staff_users SET password_hash=? WHERE id=?`).run(hashPassword(String(password)), req.params.id);
    if (signature !== undefined) db.prepare(`UPDATE staff_users SET signature=? WHERE id=?`).run(String(signature || ''), req.params.id);
    if (email !== undefined) db.prepare(`UPDATE staff_users SET email=? WHERE id=?`).run(String(email || '').trim(), req.params.id);
    if (title !== undefined) db.prepare(`UPDATE staff_users SET title=? WHERE id=?`).run(String(title || '').trim(), req.params.id);
    res.json(db.prepare(`SELECT id, name, level, signature, email, title FROM staff_users WHERE id=?`).get(req.params.id));
  });

  app.delete('/api/users/:id', full, (req, res) => {
    db.prepare(`DELETE FROM staff_users WHERE id=?`).run(req.params.id);
    res.json({ ok: true });
  });

  // ---- client extranet access -----------------------------------------------

  app.get('/api/client-access', full, (_req, res) => {
    res.json(db.prepare(`SELECT id, company, user_id AS userId, active, created_at AS createdAt FROM client_access ORDER BY created_at DESC`).all());
  });
  // Distinct case-owner names (with case counts) — these are what a client portal
  // matches on, so granting access to one of these guarantees the client sees
  // their marks.
  app.get('/api/mark-owners', full, (_req, res) => {
    const counts = new Map<string, number>();
    for (const m of listMarks(db)) {
      const o = (m.owner || '').trim();
      if (o) counts.set(o, (counts.get(o) || 0) + 1);
    }
    res.json([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name, count]) => ({ name, count })));
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
    // Accept a chosen password, or generate one when none is supplied.
    const custom = String(req.body?.password || '').trim();
    if (custom && custom.length < 6) return res.status(400).json({ error: 'Password must be at least 6 characters.' });
    const password = custom || generatePassword();
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

  // Match the client's company to case owners case- and spacing-insensitively
  // (but not so loosely that two different companies collide — client data must
  // stay scoped to that one company).
  const normCo = (s?: string) => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();
  app.get('/api/portal/marks', requireClient(db), (req, res) => {
    const company = normCo((req.session as { company: string }).company);
    res.json(listMarks(db).filter((m) => normCo(m.owner) === company));
  });

  app.get('/api/portal/oppositions', requireClient(db), (req, res) => {
    const company = normCo((req.session as { company: string }).company);
    res.json(listOppositions(db).filter((o) => normCo(o.client) === company));
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
