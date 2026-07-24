import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { createApp } from '../src/app.js';
import { newId, openDb } from '../src/db.js';
import { hashPassword } from '../src/auth.js';

/**
 * End-to-end API tests against an in-memory database: auth, permission
 * enforcement, the server-side date engine on mark writes, Madrid filing,
 * opposition templates and alerts.
 */

let app: Express;
let admin: request.Agent;
let viewer: request.Agent;

beforeAll(() => {
  const db = openDb(':memory:');
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
    expect(byName['Renewal Reminder - 1 Week']).toBe('2030-08-08');
    expect(byName['6 Month Renewal Grace Period']).toBe('2031-02-15');
    expect(byName['Non-use vulnerability date']).toBe('2024-02-10');
  });

  it('runs the stage engine on status change', async () => {
    const m = (await admin.get(`/api/marks/${id}`)).body;
    m.status = 'Registered';
    const r = await admin.put(`/api/marks/${id}`).send(m).expect(200);
    expect(r.body.dates.some((d: { name: string }) => d.name === 'Registration Date')).toBe(true);
  });

  it('files a Madrid IR and links a designation renewal to it', async () => {
    const r = await admin.post(`/api/marks/${id}/madrid`).send({ country: 'Japan' }).expect(200);
    const ir = r.body.ir;
    expect(ir.jurisdiction).toBe('Madrid Protocol (WIPO)');
    expect(ir.basicId).toBe(id);
    // Register the IR so its renewal exists, then check propagation.
    ir.dates.push({ name: 'Registration Date', date: '2014-04-04', done: true });
    await admin.put(`/api/marks/${ir.id}`).send(ir).expect(200);
    const marks = (await admin.get('/api/marks')).body;
    const des = marks.find((m: { irId?: string }) => m.irId === ir.id);
    expect(des.jurisdiction).toBe('Japan');
    const ren = des.dates.find((d: { name: string }) => d.name === 'Renewal Deadline');
    expect(ren.date).toBe('2024-04-04');
    expect(ren.linkedToIR).toBe(true);
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

describe('oppositions', () => {
  it('generates the AU opposition timeline from an anchor date, citations attached', async () => {
    const r = await admin.post('/api/oppositions').send({ name: 'Test opp', jurisdiction: 'Australia' }).expect(201);
    const o = (await admin.post(`/api/oppositions/${r.body.id}/dates-from-template`).send({ anchorDate: '2025-01-10' }).expect(200)).body;
    const byName = Object.fromEntries(o.dates.map((d: { name: string; date: string }) => [d.name, d.date]));
    expect(byName['Notice of Intention to Oppose due']).toBe('2025-03-10');
    expect(byName['Statement of Grounds & Particulars due']).toBe('2025-04-10');
    expect(byName['Notice of Intention to Defend due']).toBe('2025-06-10');
    expect(byName['Evidence in Support due']).toBe('2025-09-10');
    expect(byName['Evidence in Answer due']).toBe('2025-12-10');
    expect(byName['Evidence in Reply due']).toBe('2026-02-10');
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
