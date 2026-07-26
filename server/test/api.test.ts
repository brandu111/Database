import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { buildDigests, createApp } from '../src/app.js';
import { newId, openDb } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

/**
 * End-to-end API tests against an in-memory database: auth, permission
 * enforcement, the server-side date engine on mark writes, Madrid filing,
 * opposition templates and alerts.
 */

let app: Express;
let db: ReturnType<typeof openDb>;
let admin: request.Agent;
let viewer: request.Agent;

beforeAll(() => {
  db = openDb(':memory:');
  db.prepare(`INSERT INTO staff_users(id,name,level,password_hash) VALUES(?,?,?,?)`).run(newId('u'), 'Admin', 'Full Permissions', hashPassword('pw'));
  db.prepare(`INSERT INTO staff_users(id,name,level,password_hash) VALUES(?,?,?,?)`).run(newId('u'), 'Fiona', 'View and Print Only', hashPassword('pw'));
  app = createApp(db, { uploadsDir: `${process.env.TMPDIR || '/tmp'}/brandu-test-uploads` });
  admin = request.agent(app);
  viewer = request.agent(app);
});

describe('auth & permissions', () => {
  it('rejects unauthenticated access', async () => {
    await request(app).get('/api/marks').expect(401);
  });

  it('rejects a bad password', async () => {
    await request(app).post('/api/auth/login').send({ username: 'Admin', password: 'wrong' }).expect(401);
  });

  it('signs in staff users', async () => {
    const r = await admin.post('/api/auth/login').send({ username: 'Admin', password: 'pw' }).expect(200);
    expect(r.body.level).toBe('Full Permissions');
    await viewer.post('/api/auth/login').send({ username: 'Fiona', password: 'pw' }).expect(200);
  });

  it('lets view-only users read but not write', async () => {
    await viewer.get('/api/marks').expect(200);
    await viewer.post('/api/marks').send({}).expect(403);
    await viewer.put('/api/settings').send({}).expect(403);
  });
});

describe('marks and the server-side date engine', () => {
  let id: string;

  it('creates a mark', async () => {
    const r = await admin.post('/api/marks').send({ name: 'ENGINE TEST', jurisdiction: 'Australia' }).expect(201);
    id = r.body.id;
    expect(r.body.status).toBe('Pending');
  });

  it('computes the AU renewal chain when the Registration Date is entered', async () => {
    const r0 = await admin.get(`/api/marks/${id}`).expect(200);
    const m = r0.body;
    m.dates = [
      { name: 'Application Filed', date: '2020-08-15', done: true },
      { name: 'Registration Date', date: '2021-02-10', done: true },
    ];
    const r = await admin.put(`/api/marks/${id}`).send(m).expect(200);
    const byName = Object.fromEntries(r.body.dates.map((d: { name: string; date: string }) => [d.name, d.date]));
    expect(byName['Renewal Deadline']).toBe('2030-08-15');
    expect(byName['Renewal Deadline — 1 Week Reminder']).toBe('2030-08-08');
    expect(byName['6 Month Renewal Grace Period']).toBe('2031-02-15');
    expect(byName['Non-use vulnerability date']).toBe('2024-02-10');
  });

  it('runs the stage engine on status change', async () => {
    const m = (await admin.get(`/api/marks/${id}`)).body;
    m.status = 'Registered';
    const r = await admin.put(`/api/marks/${id}`).send(m).expect(200);
    expect(r.body.dates.some((d: { name: string }) => d.name === 'Registration Date')).toBe(true);
  });

  it('files a Madrid IR with initial designations; renewal comes from the IR filing date', async () => {
    const r = await admin.post(`/api/marks/${id}/madrid`).send({ countries: ['Japan', 'China'], filingDate: '2014-04-04' }).expect(200);
    const ir = r.body.ir;
    expect(ir.jurisdiction).toBe('Madrid Protocol (WIPO)');
    expect(ir.basicId).toBe(id);
    // IR renews 10 years from its filing date — no separate registration needed.
    expect(ir.dates.find((d: { name: string }) => d.name === 'Renewal Deadline').date).toBe('2024-04-04');
    expect(ir.dates.find((d: { name: string }) => d.name === 'Dependency Period Ends').date).toBe('2019-04-04');

    const marks = (await admin.get('/api/marks')).body;
    const desigs = marks.filter((m: { irId?: string }) => m.irId === ir.id);
    expect(desigs.map((d: { jurisdiction: string }) => d.jurisdiction).sort()).toEqual(['China', 'Japan']);
    const japan = desigs.find((d: { jurisdiction: string }) => d.jurisdiction === 'Japan');
    // Initial designations share the IR filing date and inherit its renewal.
    expect(japan.dates.find((d: { name: string }) => d.name === 'Application Filed').date).toBe('2014-04-04');
    const ren = japan.dates.find((d: { name: string }) => d.name === 'Renewal Deadline');
    expect(ren.date).toBe('2024-04-04');
    expect(ren.linkedToIR).toBe(true);
  });

  it('adds a subsequent designation dated when filed, sharing the IR renewal', async () => {
    const r = await admin.post(`/api/marks/${id}/madrid`).send({ countries: ['Singapore'], filingDate: '2020-06-15', subsequent: true }).expect(200);
    const sg = r.body.created.find((m: { jurisdiction: string }) => m.jurisdiction === 'Singapore');
    expect(sg.dates.find((d: { name: string }) => d.name === 'Application Filed').date).toBe('2020-06-15');
    const ren = sg.dates.find((d: { name: string }) => d.name === 'Renewal Deadline');
    expect(ren.date).toBe('2024-04-04'); // still the IR renewal date
    expect(ren.linkedToIR).toBe(true);
  });

  it('copies the IR number entered on the IR case down to every designation, including subsequent ones', async () => {
    const marks = (await admin.get('/api/marks')).body;
    const ir = marks.find((m: { jurisdiction: string; basicId?: string }) => m.jurisdiction === 'Madrid Protocol (WIPO)' && m.basicId === id);
    expect(ir).toBeTruthy();
    // Enter the IR number once, on the IR case.
    ir.irNumber = '1650123';
    await admin.put(`/api/marks/${ir.id}`).send(ir).expect(200);

    const after = (await admin.get('/api/marks')).body.filter((m: { irId?: string }) => m.irId === ir.id);
    expect(after.length).toBeGreaterThan(0);
    for (const d of after) expect(d.irNumber).toBe('1650123');

    // A subsequent designation filed afterwards inherits the same IR number.
    const r = await admin.post(`/api/marks/${id}/madrid`).send({ countries: ['Vietnam'], filingDate: '2021-02-02', subsequent: true }).expect(200);
    const vn = r.body.created.find((m: { jurisdiction: string }) => m.jurisdiction === 'Vietnam');
    expect(vn.irNumber).toBe('1650123');
  });

  it('surfaces upcoming deadlines in alerts', async () => {
    const m = (await admin.get(`/api/marks/${id}`)).body;
    const soon = new Date(Date.now() + 5 * 86400000).toISOString().slice(0, 10);
    m.dates.push({ name: 'Custom due date', date: soon, done: false });
    await admin.put(`/api/marks/${id}`).send(m).expect(200);
    const alerts = (await admin.get('/api/alerts?days=30')).body;
    expect(alerts.some((a: { text: string }) => a.text === 'Custom due date')).toBe(true);
  });
});

describe('staff email & alert mailing', () => {
  it('stores the signed-in user’s own email and returns it from /me', async () => {
    await admin.put('/api/auth/me/email').send({ email: 'admin@brandu.legal' }).expect(200);
    const me = (await admin.get('/api/auth/me').expect(200)).body;
    expect(me.email).toBe('admin@brandu.legal');
  });

  it('reports mail as unconfigured and the digest as a no-op without SMTP env', async () => {
    expect((await admin.get('/api/mail/status').expect(200)).body.configured).toBe(false);
    // A test send is refused with a helpful error when SMTP isn't configured.
    await admin.post('/api/mail/test').send({}).expect(400);
    const digest = (await admin.post('/api/tasks/daily-digest').expect(200)).body;
    expect(digest).toEqual({ sent: 0, recipients: [] });
  });

  it('gates mail endpoints to Full permissions', async () => {
    await viewer.post('/api/mail/test').send({}).expect(403);
    await viewer.post('/api/tasks/daily-digest').expect(403);
  });

  it('routes attributed deadlines to the owner and unattributed ones to the fallback (alexMJ, admin)', async () => {
    // Staff who can receive mail: Bob (an owner), plus the two fallbacks.
    db.prepare(`INSERT INTO staff_users(id,name,level,password_hash,email) VALUES(?,?,?,?,?)`).run(newId('u'), 'Bob', 'Edit Only', hashPassword('pw'), 'bob@brandu.legal');
    db.prepare(`INSERT INTO staff_users(id,name,level,password_hash,email) VALUES(?,?,?,?,?)`).run(newId('u'), 'alexMJ', 'Edit Only', hashPassword('pw'), 'alex@brandu.legal');
    db.prepare(`UPDATE staff_users SET email='admin@brandu.legal' WHERE name='Admin'`).run();

    const past = '2000-01-01';
    const m = (await admin.post('/api/marks').send({ name: 'DIGEST MARK', jurisdiction: 'Australia' }).expect(201)).body;
    m.dates = [
      { name: 'Owned overdue', date: past, done: false, createdBy: 'Bob', notify: true },
      { name: 'Unowned overdue', date: past, done: false },
    ];
    await admin.put(`/api/marks/${m.id}`).send(m).expect(200);

    const buckets = buildDigests(db, '2020-01-01');
    const byName = Object.fromEntries(buckets.map((b) => [b.name.toLowerCase(), b]));
    const names = (n: string) => (byName[n]?.items || []).map((i) => i.name);

    expect(names('bob')).toContain('Owned overdue');
    expect(names('bob')).not.toContain('Unowned overdue');
    expect(names('alexmj')).toContain('Unowned overdue');
    expect(names('admin')).toContain('Unowned overdue');
    // Every collected item is due today or overdue.
    for (const b of buckets) for (const it of b.items) expect(it.date <= '2020-01-01').toBe(true);
  });
});

describe('bulk import & clear', () => {
  it('imports CSV rows as cases with the engine computing renewals, then can clear all', async () => {
    const rows = [
      { MarkName: 'IMPORT ONE', Jurisdiction: 'Australia', Status: 'Registered', ApplicationNo: '3000001', FiledDate: '15/08/2020', RegistrationDate: '10/02/2021', Classes: '9, 42' },
      { MarkName: '', Jurisdiction: 'Australia' }, // invalid — no name
    ];
    const r = (await admin.post('/api/marks/import').send({ rows }).expect(200)).body;
    expect(r.imported).toBe(1);
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0].line).toBe(3);

    const marks = (await admin.get('/api/marks')).body as { name: string; dates: { name: string; date: string }[] }[];
    const one = marks.find((m) => m.name === 'IMPORT ONE')!;
    expect(one).toBeTruthy();
    // AU renewal computed from the filing date + 10 years.
    expect(one.dates.find((d) => d.name === 'Renewal Deadline')?.date).toBe('2030-08-15');

    // Non-full users may not import or clear.
    await viewer.post('/api/marks/import').send({ rows }).expect(403);
    await viewer.delete('/api/marks?confirm=DELETE-ALL').expect(403);

    // Clearing requires the confirm token.
    await admin.delete('/api/marks').expect(400);
    const del = (await admin.delete('/api/marks?confirm=DELETE-ALL').expect(200)).body;
    expect(del.deleted).toBeGreaterThan(0);
    expect((await admin.get('/api/marks')).body).toHaveLength(0);
  });
});

describe('oppositions', () => {
  it('generates the AU opposition timeline from an anchor date, citations attached', async () => {
    const r = await admin.post('/api/oppositions').send({ name: 'Test opp', jurisdiction: 'Australia' }).expect(201);
    const o = (await admin.post(`/api/oppositions/${r.body.id}/dates-from-template`).send({ anchorDate: '2025-01-10' }).expect(200)).body;
    const byName = Object.fromEntries(o.dates.map((d: { name: string; date: string }) => [d.name, d.date]));
    expect(byName['Notice of Intention to Oppose due']).toBe('2025-03-10');
    expect(byName['Statement of Grounds & Particulars due']).toBe('2025-04-10');
    // NID = SGP + 1 month (reg 5.13), then evidence rounds 3m / 3m / 2m.
    expect(byName['Notice of Intention to Defend due']).toBe('2025-05-10');
    expect(byName['Evidence in Support due']).toBe('2025-08-10');
    expect(byName['Evidence in Answer due']).toBe('2025-11-10');
    expect(byName['Evidence in Reply due']).toBe('2026-01-10');
    const nid = o.dates.find((d: { name: string }) => d.name === 'Notice of Intention to Defend due');
    expect(nid.note).toContain('reg 5.13');
  });

  it('falls back to the master date list without an anchor', async () => {
    const r = await admin.post('/api/oppositions').send({ name: 'Master opp', jurisdiction: 'Chile' }).expect(201);
    const o = (await admin.post(`/api/oppositions/${r.body.id}/dates-from-template`).send({}).expect(200)).body;
    expect(o.dates.some((d: { name: string }) => d.name === 'Evidence in Support due')).toBe(true);
  });
});

describe('client extranet', () => {
  it('grants scoped read-only access with a hashed password', async () => {
    await admin.post('/api/marks').send({ name: 'CLIENT MARK', owner: 'Acme Pty Ltd' }).expect(201);
    const grant = (await admin.post('/api/client-access').send({ company: 'Acme Pty Ltd' }).expect(201)).body;
    expect(grant.password).toBeTruthy();
    const portal = request.agent(app);
    await portal.post('/api/auth/client-login').send({ userId: grant.userId, password: grant.password }).expect(200);
    const marks = (await portal.get('/api/portal/marks').expect(200)).body;
    expect(marks.length).toBe(1);
    expect(marks[0].name).toBe('CLIENT MARK');
    await portal.get('/api/marks').expect(401);
    // revoke
    await admin.put(`/api/client-access/${grant.id}`).send({ active: false }).expect(200);
    const portal2 = request.agent(app);
    await portal2.post('/api/auth/client-login').send({ userId: grant.userId, password: grant.password }).expect(401);
  });
});
