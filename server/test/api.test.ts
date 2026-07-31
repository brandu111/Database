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
  db.prepare(`INSERT INTO staff_users(id,name,level,password_hash) VALUES(?,?,?,?)`).run(newId('u'), 'Natalie', 'Full Permissions', hashPassword('pw'));
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

  it('carries a logo basic case image down to the IR and its designations', async () => {
    const basic = (await admin.post('/api/marks').send({ name: 'LOGO MARK', jurisdiction: 'Australia', type: 'Logo' }).expect(201)).body;
    basic.image = 'https://files.example/logo.png';
    await admin.put(`/api/marks/${basic.id}`).send(basic).expect(200);
    const r = await admin.post(`/api/marks/${basic.id}/madrid`).send({ countries: ['Japan'], filingDate: '2015-05-05' }).expect(200);
    expect(r.body.ir.image).toBe('https://files.example/logo.png');
    const desig = (await admin.get('/api/marks')).body.find((m: { irId?: string; jurisdiction: string }) => m.irId === r.body.ir.id && m.jurisdiction === 'Japan');
    expect(desig.image).toBe('https://files.example/logo.png');
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

  it('bulk-imports contacts, grouping rows into companies with contacts', async () => {
    const rows = [
      { CompanyName: 'Acme Pty Ltd', City: 'Sydney', Country: 'Australia', ContactName: 'Smith, Jane', ContactTitle: 'Director', ContactEmail: 'jane@acme.test' },
      { CompanyName: 'Acme Pty Ltd', ContactFirstName: 'Bob', ContactLastName: 'Jones', ContactEmail: 'bob@acme.test' },
      { CompanyName: 'Beta LLC', Country: 'USA', ContactName: 'Pat Lee', ContactEmail: 'pat@beta.test' },
      { CompanyName: '' }, // skipped — no company
    ];
    const r = (await admin.post('/api/companies/import').send({ rows }).expect(200)).body;
    expect(r.created).toBe(2);
    expect(r.contacts).toBe(3);
    expect(r.skipped).toBe(1);
    const companies = (await admin.get('/api/companies')).body as { name: string; city: string; contacts: { name: string; email: string }[] }[];
    const acme = companies.find((c) => c.name === 'Acme Pty Ltd')!;
    expect(acme.city).toBe('Sydney');
    expect(acme.contacts).toHaveLength(2);
    expect(acme.contacts[0].name).toBe('Jane Smith'); // "Last, First" tidied
    // Non-full users may not import.
    await viewer.post('/api/companies/import').send({ rows }).expect(403);
  });

  it('propagates a logo to related cases by owner + mark name (fill-empty only)', async () => {
    const au = (await admin.post('/api/marks').send({ name: 'LOGOTEST Logo', jurisdiction: 'Australia', type: 'Logo', owner: 'LogoTest Holdings Pty Ltd' }).expect(201)).body;
    au.image = '/files/logotest-logo.png';
    await admin.put(`/api/marks/${au.id}`).send(au).expect(200);
    // Overseas filing of the same mark, no image yet.
    const nz = (await admin.post('/api/marks').send({ name: 'LOGOTEST logo', jurisdiction: 'New Zealand', type: 'Logo', owner: 'LogoTest Holdings Pty Ltd' }).expect(201)).body;
    // Unrelated mark keeps its (absent) image.
    const other = (await admin.post('/api/marks').send({ name: 'ZEDMARK', jurisdiction: 'New Zealand', type: 'Word', owner: 'Zed Holdings Pty Ltd' }).expect(201)).body;
    const r = (await admin.post('/api/marks/logos/propagate').expect(200)).body;
    expect(r.updated).toBeGreaterThanOrEqual(1);
    const marks = (await admin.get('/api/marks')).body as { id: string; image: string | null }[];
    expect(marks.find((m) => m.id === nz.id)!.image).toBe('/files/logotest-logo.png');
    expect(marks.find((m) => m.id === other.id)!.image).toBeFalsy();
    await viewer.post('/api/marks/logos/propagate').expect(403);
  });

  it('attaches uploaded logo files to cases by application no. / our ref', async () => {
    const m = (await admin.post('/api/marks').send({ name: 'FILELOGO', jurisdiction: 'USA', type: 'Logo', application: '98765432' }).expect(201)).body;
    const r = (await admin.post('/api/marks/logos/attach').send({
      files: [{ name: '98765432.png', url: '/files/x.png' }, { name: 'unknown-9999.png', url: '/files/y.png' }],
      overwrite: false,
    }).expect(200)).body;
    expect(r.marksUpdated).toBe(1);
    expect(r.unmatched).toEqual(['unknown-9999.png']);
    const got = (await admin.get(`/api/marks/${m.id}`)).body;
    expect(got.image).toBe('/files/x.png');
    await viewer.post('/api/marks/logos/attach').send({ files: [] }).expect(403);
  });

  it('suppresses non-use vulnerability and expired convention-priority alerts', async () => {
    const m = (await admin.post('/api/marks').send({ name: 'ALERTFILTER', jurisdiction: 'Australia' }).expect(201)).body;
    const soon = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10); // ~60 days out (within window)
    m.dates = [
      { name: 'Non-use vulnerability date', date: soon, done: false },
      { name: 'Convention Priority Deadline', date: '2020-01-01', done: false }, // expired
      { name: 'Convention Priority Deadline', date: soon, done: false }, // still open — kept
    ];
    await admin.put(`/api/marks/${m.id}`).send(m).expect(200);
    const alerts = (await admin.get('/api/alerts?days=365')).body as { text: string; date: string }[];
    expect(alerts.some((a) => /vulnerab/i.test(a.text))).toBe(false); // non-use never
    expect(alerts.some((a) => /priority/i.test(a.text) && a.date === '2020-01-01')).toBe(false); // expired priority gone
    expect(alerts.some((a) => /priority/i.test(a.text) && a.date === soon)).toBe(true); // open priority kept
  });

  it('auto-creates a contact for a new case owner not already listed', async () => {
    const before = (await admin.get('/api/companies')).body as { name: string }[];
    expect(before.some((c) => c.name === 'Brand New Owner Pty Ltd')).toBe(false);
    const m = (await admin.post('/api/marks').send({ name: 'AUTOOWN', jurisdiction: 'Australia' }).expect(201)).body;
    m.owner = 'Brand New Owner Pty Ltd';
    m.city = 'Sydney';
    await admin.put(`/api/marks/${m.id}`).send(m).expect(200);
    const after = (await admin.get('/api/companies')).body as { name: string; contactType?: string; city?: string }[];
    const created = after.find((c) => c.name === 'Brand New Owner Pty Ltd');
    expect(created).toBeTruthy();
    expect(created!.contactType).toBe('Owner');
    expect(created!.city).toBe('Sydney');
    // Saving another case for the same owner does not duplicate the contact.
    const m2 = (await admin.post('/api/marks').send({ name: 'AUTOOWN2', jurisdiction: 'Australia', owner: 'Brand New Owner Pty Ltd' }).expect(201)).body;
    expect(m2).toBeTruthy();
    const finalCount = ((await admin.get('/api/companies')).body as { name: string }[]).filter((c) => c.name === 'Brand New Owner Pty Ltd').length;
    expect(finalCount).toBe(1);
  });

  it('links Madrid families (IR + designations + AU basic), tidies numbers', async () => {
    const ir = (await admin.post('/api/marks').send({ name: 'HAELEN STAMP', jurisdiction: 'Madrid Protocol (WIPO)', registration: 'IR No.1683883', owner: 'Haelen Pty Ltd' }).expect(201)).body;
    const uk = (await admin.post('/api/marks').send({ name: 'HAELEN STAMP', jurisdiction: 'United Kingdom', registration: 'IR No.1683883', owner: 'Haelen Pty Ltd' }).expect(201)).body;
    const mx = (await admin.post('/api/marks').send({ name: 'HAELEN STAMP', jurisdiction: 'Mexico', registration: 'IR No.1683883/Reg No. 2554746(29) / 2554747(40)', owner: 'Haelen Pty Ltd' }).expect(201)).body;
    const au = (await admin.post('/api/marks').send({ name: 'HAELEN STAMP', jurisdiction: 'Australia', application: '2100100', registration: '2100100', owner: 'Haelen Pty Ltd' }).expect(201)).body;
    const r = (await admin.post('/api/marks/link-madrid').expect(200)).body;
    expect(r.families).toBeGreaterThanOrEqual(1);
    expect(r.auBasicsLinked).toBeGreaterThanOrEqual(1);
    const marks = (await admin.get('/api/marks')).body as { id: string; madridId?: string; irId?: string; irNumber?: string; registration: string }[];
    const gIr = marks.find((m) => m.id === ir.id)!;
    const gUk = marks.find((m) => m.id === uk.id)!;
    const gMx = marks.find((m) => m.id === mx.id)!;
    const gAu = marks.find((m) => m.id === au.id)!;
    expect(gUk.madridId).toBe(gIr.madridId);
    expect(gUk.irId).toBeFalsy(); // related for navigation, but NOT a locked designation
    expect(gAu.madridId).toBe(gIr.madridId); // AU basic joined the family
    expect(gMx.irNumber).toBe('1683883');
    expect(gMx.registration).toBe('2554746(29) / 2554747(40)'); // IR prefix stripped, national kept
    expect(gIr.registration).toBe(''); // IR-only row: national number cleared
    await viewer.post('/api/marks/link-madrid').expect(403);
  });

  it('bulk-delete is restricted to Natalie', async () => {
    const a = (await admin.post('/api/marks').send({ name: 'DEL A', jurisdiction: 'Australia' }).expect(201)).body;
    const b = (await admin.post('/api/marks').send({ name: 'DEL B', jurisdiction: 'Australia' }).expect(201)).body;
    // Admin (not Natalie) is refused even with full permissions.
    await admin.post('/api/marks/bulk-delete').send({ ids: [a.id] }).expect(403);
    // Natalie can.
    const natalie = request.agent(app);
    await natalie.post('/api/auth/login').send({ username: 'Natalie', password: 'pw' }).expect(200);
    const r = (await natalie.post('/api/marks/bulk-delete').send({ ids: [a.id, b.id] }).expect(200)).body;
    expect(r.deleted).toBe(2);
    await admin.get(`/api/marks/${a.id}`).expect(404);
  });

  it('clears alerts before a cut-off by marking past items done', async () => {
    const m = (await admin.post('/api/marks').send({ name: 'OLDALERTS', jurisdiction: 'Australia' }).expect(201)).body;
    m.dates = [
      { name: 'Old Deadline', date: '2020-01-01', done: false },
      { name: 'Future Deadline', date: '2030-01-01', done: false },
    ];
    await admin.put(`/api/marks/${m.id}`).send(m).expect(200);
    const r = (await admin.post('/api/marks/clear-old-alerts').send({ before: '2026-06-01' }).expect(200)).body;
    expect(r.markDates).toBeGreaterThanOrEqual(1);
    const got = (await admin.get(`/api/marks/${m.id}`)).body;
    const byName = Object.fromEntries(got.dates.map((d: { name: string; done: boolean }) => [d.name, d.done]));
    expect(byName['Old Deadline']).toBe(true);   // past → marked done
    expect(byName['Future Deadline']).toBe(false); // future → untouched
    await admin.post('/api/marks/clear-old-alerts').send({ before: 'nope' }).expect(400);
    await viewer.post('/api/marks/clear-old-alerts').send({ before: '2026-06-01' }).expect(403);
  });

  it('recomputes all cases without nesting transactions (no 500)', async () => {
    await admin.post('/api/marks').send({ name: 'RECOMPUTE A', jurisdiction: 'Australia' }).expect(201);
    const b = (await admin.post('/api/marks').send({ name: 'RECOMPUTE B', jurisdiction: 'USA' }).expect(201)).body;
    b.dates = [{ name: 'Registration Date', date: '2020-01-10', done: true }];
    await admin.put(`/api/marks/${b.id}`).send(b).expect(200);
    const r = (await admin.post('/api/marks/recompute-all').expect(200)).body;
    expect(r.recomputed).toBeGreaterThanOrEqual(2);
    expect(r.failed).toHaveLength(0);
    // Non-full users may not run it.
    await viewer.post('/api/marks/recompute-all').expect(403);
  });

  it('locks all renewal dates so recompute can never shift them', async () => {
    const m = (await admin.post('/api/marks').send({ name: 'PINME', jurisdiction: 'Australia', owner: 'Pin Holdings Pty Ltd' }).expect(201)).body;
    m.dates = [
      { name: 'Application Filed', date: '2015-01-01', done: true },
      { name: 'Registration Date', date: '2016-01-01', done: true },
    ];
    // Saving computes the renewal from filing + 10y = 2025-01-01 (still un-pinned).
    const saved = (await admin.put(`/api/marks/${m.id}`).send(m).expect(200)).body;
    const before = saved.dates.find((d: { name: string }) => d.name === 'Renewal Deadline');
    expect(before.date).toBe('2025-01-01');
    expect(before.pinned).toBeFalsy();

    // Lock every current renewal date as the source of truth.
    const r = (await admin.post('/api/marks/pin-all-dates').expect(200)).body;
    expect(r.pinned).toBeGreaterThanOrEqual(1);
    const after = (await admin.get(`/api/marks/${m.id}`)).body;
    const ren = after.dates.find((d: { name: string }) => d.name === 'Renewal Deadline');
    expect(ren.pinned).toBe(true);
    expect(ren.date).toBe('2025-01-01'); // frozen exactly as it stood — pin does not recompute

    // Now move the filing date and recompute-all: an un-pinned renewal would jump to
    // 2020-01-01, but the pin must hold it at 2025-01-01.
    after.dates.find((d: { name: string }) => d.name === 'Application Filed').date = '2010-01-01';
    await admin.put(`/api/marks/${after.id}`).send(after).expect(200);
    await admin.post('/api/marks/recompute-all').expect(200);
    const after2 = (await admin.get(`/api/marks/${m.id}`)).body;
    expect(after2.dates.find((d: { name: string }) => d.name === 'Renewal Deadline').date).toBe('2025-01-01');

    await viewer.post('/api/marks/pin-all-dates').expect(403);
  });

  it('streams an on-demand database backup to full users only', async () => {
    await admin.post('/api/marks').send({ name: 'BACKUP DL', jurisdiction: 'Australia' }).expect(201);
    const res = await admin.get('/api/backup/download').expect(200);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename=.*brandu-backup-\d{4}-\d{2}-\d{2}\.sqlite/);
    // The payload is a real SQLite file (magic header "SQLite format 3\0").
    const body: Buffer = res.body instanceof Buffer ? res.body : Buffer.from(res.text || '');
    expect(body.slice(0, 16).toString('utf8')).toBe('SQLite format 3 ');
    await viewer.get('/api/backup/download').expect(403);
  });

  it('imports legacy free-text actions, matching by number and skipping standard dates', async () => {
    const a = (await admin.post('/api/marks').send({ name: 'ACTIONMATCH', jurisdiction: 'Australia', application: '2655445', owner: 'Act Pty Ltd' }).expect(201)).body;
    const b = (await admin.post('/api/marks').send({ name: 'IRMATCH', jurisdiction: 'Canada', registration: 'IR No. 1744851', owner: 'Act Pty Ltd' }).expect(201)).body;
    const rows = [
      // free-text action, matched by application number
      { Trademark: 'DOCKIT', Jurisdiction: 'Australia', Application: '2655445', Registration: '', DateName: 'has app no. 2440395 lapsed?', Date: '2026-07-20' },
      // free-text action, matched by IR number embedded in "IR No. 1744851"
      { Trademark: 'Vision INVEST Logo', Jurisdiction: 'Canada', Application: 'IR No. 1744851', Registration: '', DateName: 'AMJ - Accepted/Registered? update the case', Date: '2026-07-13' },
      // standard jurisdiction date → skipped, not imported
      { Trademark: 'DOCKIT', Jurisdiction: 'Australia', Application: '2655445', Registration: '', DateName: 'Renewal Reminder', Date: '2026-07-20' },
      // no matching case → unmatched
      { Trademark: 'NOBODY', Jurisdiction: 'Australia', Application: '9999999', Registration: '', DateName: 'chase the client', Date: '2026-07-20' },
    ];
    const r = (await admin.post('/api/marks/import-actions').send({ rows }).expect(200)).body;
    expect(r.imported).toBe(2);
    expect(r.unmatched).toBe(1);
    expect(r.skipped).toBeGreaterThanOrEqual(1); // the Renewal Reminder standard date

    const ga = (await admin.get(`/api/marks/${a.id}`)).body;
    const act = ga.actions.find((x: { text: string }) => /2440395 lapsed/.test(x.text));
    expect(act).toBeTruthy();
    expect(act.alert).toBe(true);
    expect(act.done).toBe(false);
    expect(act.date).toBe('2026-07-20');
    const gb = (await admin.get(`/api/marks/${b.id}`)).body;
    expect(gb.actions.some((x: { text: string }) => /AMJ - Accepted/.test(x.text))).toBe(true);

    // Re-running doesn't duplicate.
    const again = (await admin.post('/api/marks/import-actions').send({ rows }).expect(200)).body;
    expect(again.imported).toBe(0);

    await viewer.post('/api/marks/import-actions').send({ rows }).expect(403);
  });

  it('adds missing renewal reminders without changing the locked renewal date', async () => {
    const m = (await admin.post('/api/marks').send({ name: 'REMINDME', jurisdiction: 'Australia', owner: 'Remind Pty Ltd' }).expect(201)).body;
    // A case with a locked renewal date but NO registration date — so the engine's
    // registration gate means it never generated renewal reminders on save.
    m.dates = [
      { name: 'Application Filed', date: '2014-05-01', done: true },
      { name: 'Renewal Deadline', date: '2024-05-01', done: false, pinned: true },
    ];
    await admin.put(`/api/marks/${m.id}`).send(m).expect(200);
    // Confirm the "missing reminders" precondition actually holds after the save.
    const pre = (await admin.get(`/api/marks/${m.id}`)).body;
    expect(pre.dates.some((d: { name: string }) => /renewal reminder/i.test(d.name))).toBe(false);

    const r = (await admin.post('/api/marks/add-renewal-reminders').expect(200)).body;
    expect(r.remindersAdded).toBeGreaterThanOrEqual(1);
    const after = (await admin.get(`/api/marks/${m.id}`)).body;
    // Reminders now exist and are dated before the renewal deadline.
    const reminders = after.dates.filter((d: { name: string }) => /renewal reminder/i.test(d.name));
    expect(reminders.length).toBeGreaterThanOrEqual(1);
    expect(reminders.every((d: { date: string }) => d.date < '2024-05-01')).toBe(true);
    // The locked renewal date is untouched.
    expect(after.dates.find((d: { name: string }) => d.name === 'Renewal Deadline').date).toBe('2024-05-01');

    await viewer.post('/api/marks/add-renewal-reminders').expect(403);
  });

  it('tidies registered cases by ticking off pre-registration deadlines only', async () => {
    const m = (await admin.post('/api/marks').send({ name: 'TIDYME', jurisdiction: 'Australia', owner: 'Tidy Pty Ltd' }).expect(201)).body;
    m.dates = [
      { name: 'Application Filed', date: '2018-01-01', done: true },
      { name: 'OA Response Due', date: '2018-09-01', done: false },       // pre-reg, outstanding → cleared
      { name: 'Acceptance Deadline', date: '2019-01-01', done: false },   // pre-reg, outstanding → cleared
      { name: 'Registration Date', date: '2019-06-01', done: true },
      { name: 'Renewal Deadline', date: '2028-01-01', done: false, pinned: true }, // after reg → untouched
    ];
    await admin.put(`/api/marks/${m.id}`).send(m).expect(200);

    const r = (await admin.post('/api/marks/tidy-registered').expect(200)).body;
    expect(r.datesCleared).toBeGreaterThanOrEqual(2);
    const after = (await admin.get(`/api/marks/${m.id}`)).body;
    const byName = Object.fromEntries(after.dates.map((d: { name: string; done: boolean; date: string }) => [d.name, d]));
    expect(byName['OA Response Due'].done).toBe(true);
    expect(byName['Acceptance Deadline'].done).toBe(true);
    // Renewal deadline: not cleared, date unchanged.
    expect(byName['Renewal Deadline'].done).toBe(false);
    expect(byName['Renewal Deadline'].date).toBe('2028-01-01');

    await viewer.post('/api/marks/tidy-registered').expect(403);
  });

  it('verifies the database against the source-of-truth CSV (read-only)', async () => {
    // A case whose source-of-truth dates we will check.
    const m = (await admin.post('/api/marks').send({ name: 'VERIFYME', jurisdiction: 'Australia', owner: 'Verify Holdings Pty Ltd' }).expect(201)).body;
    m.dates = [
      { name: 'Application Filed', date: '2018-03-15', done: true },
      { name: 'Registration Date', date: '2019-01-10', done: true },
      { name: 'Renewal Deadline', date: '2028-03-15', done: false, pinned: true },
    ];
    await admin.put(`/api/marks/${m.id}`).send(m).expect(200);

    const rows = [
      // Matches by jurisdiction+name+owner+filed; all dates agree → no mismatch.
      { Jurisdiction: 'Australia', MarkName: 'VERIFYME', OwnerName: 'Verify Holdings Pty Ltd', FiledDate: '15/03/2018', RegistrationDate: '10/01/2019', RenewalDate: '15/03/2028' },
      // Same case but a DIFFERENT renewal date → one mismatch reported.
      { Jurisdiction: 'Australia', MarkName: 'VERIFYME', OwnerName: 'Verify Holdings Pty Ltd', FiledDate: '15/03/2018', RenewalDate: '15/03/2029' },
      // A row that matches nothing in the DB → counted as unmatched, not a mismatch.
      { Jurisdiction: 'Australia', MarkName: 'NOSUCHMARK', OwnerName: 'Nobody Pty Ltd', FiledDate: '01/01/2020', RenewalDate: '01/01/2030' },
    ];
    const r = (await admin.post('/api/marks/verify-import').send({ rows }).expect(200)).body;
    expect(r.checked).toBe(3);
    expect(r.matched).toBe(2);
    expect(r.unmatched).toBe(1);
    expect(r.mismatchCount).toBe(1);
    expect(r.mismatches[0].field).toBe('Renewal Deadline');
    expect(r.mismatches[0].source).toBe('2029-03-15');
    expect(r.mismatches[0].current).toBe('2028-03-15');
    // Verification must not mutate anything.
    const after = (await admin.get(`/api/marks/${m.id}`)).body;
    expect(after.dates.find((d: { name: string }) => d.name === 'Renewal Deadline').date).toBe('2028-03-15');
    // Empty payload rejected; viewers are allowed to run a read-only check? No — gated to full.
    await admin.post('/api/marks/verify-import').send({ rows: [] }).expect(400);
    await viewer.post('/api/marks/verify-import').send({ rows }).expect(403);
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

describe('date rules — master list & copy across jurisdictions', () => {
  it('seeds a master date list that is not applied to cases by the engine', async () => {
    const { rules } = (await admin.get('/api/rules').expect(200)).body;
    expect(Array.isArray(rules._master)).toBe(true);
    expect(rules._master.length).toBeGreaterThan(0);
    // A case in a jurisdiction with no own rules falls back to the baseline, NOT the master.
    const m = (await admin.post('/api/marks').send({ name: 'MASTERCHK', jurisdiction: 'Iceland' }).expect(201)).body;
    m.dates = [{ name: 'Registration Date', date: '2020-01-01', done: true }];
    const saved = (await admin.put(`/api/marks/${m.id}`).send(m).expect(200)).body;
    // Baseline gives it a Renewal Deadline; the master list existing does not double it up.
    expect(saved.dates.filter((d: { name: string }) => d.name === 'Renewal Deadline').length).toBe(1);
  });

  it('copies dates from the master list onto chosen empty jurisdictions', async () => {
    // A jurisdiction with no rules of its own.
    const before = (await admin.get('/api/rules').expect(200)).body.rules;
    expect((before['Fiji'] || []).length).toBe(0);
    const r = (await admin.post('/api/rules/copy').send({ source: '_master', targets: ['Fiji', 'Tonga'], mode: 'replace' }).expect(200)).body;
    expect(r.copied).toBe(2);
    expect(r.rules.Fiji.length).toBeGreaterThan(0);
    // Copied rules are marked custom so they survive rulebook upgrades.
    expect(r.rules.Fiji.every((x: { custom?: boolean }) => x.custom)).toBe(true);
    // Persisted.
    const after = (await admin.get('/api/rules').expect(200)).body.rules;
    expect(after.Fiji.length).toBe(after._master.length);

    // Merge mode only adds names the target doesn't already have.
    const fijiLen = after.Fiji.length;
    const merged = (await admin.post('/api/rules/copy').send({ source: '_master', targets: ['Fiji'], mode: 'merge' }).expect(200)).body;
    expect(merged.rules.Fiji.length).toBe(fijiLen); // nothing new to add

    // Guardrails.
    await admin.post('/api/rules/copy').send({ source: '_master', targets: [], mode: 'merge' }).expect(400);
    await viewer.post('/api/rules/copy').send({ source: '_master', targets: ['Fiji'], mode: 'merge' }).expect(403);
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
