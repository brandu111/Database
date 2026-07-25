import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { Database } from './sqlite.js';
import {
  defaultOppDatesMaster,
  defaultRules,
  migrateRules,
  RULES_VERSION,
  type Company,
  type FirmSettings,
  type Mark,
  type OppDateMaster,
  type Opposition,
  type Rule,
  type RuleBook,
} from '@brandu/shared';

/**
 * Storage layer. Aggregate entities (marks, oppositions, companies) are stored
 * as JSON documents with indexed columns for list filtering — the same shape
 * works on PostgreSQL with jsonb columns (see README for the migration path).
 * Auth-sensitive tables (staff users, client extranet access) are fully
 * relational and store bcrypt hashes only.
 */

export type DB = Database;

export function openDb(file: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS marks (
      id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', jurisdiction TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '', owner TEXT NOT NULL DEFAULT '',
      madrid_id TEXT, ir_id TEXT, basic_id TEXT,
      updated_at TEXT NOT NULL, doc TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_marks_jur ON marks(jurisdiction);
    CREATE INDEX IF NOT EXISTS idx_marks_status ON marks(status);
    CREATE INDEX IF NOT EXISTS idx_marks_owner ON marks(owner);
    CREATE INDEX IF NOT EXISTS idx_marks_madrid ON marks(madrid_id);
    CREATE INDEX IF NOT EXISTS idx_marks_ir ON marks(ir_id);
    CREATE TABLE IF NOT EXISTS oppositions (
      id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', jurisdiction TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT '', client TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL, doc TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS companies (
      id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '', type TEXT NOT NULL DEFAULT 'Company',
      updated_at TEXT NOT NULL, doc TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS rules (jurisdiction TEXT PRIMARY KEY, doc TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS email_templates (id TEXT PRIMARY KEY, doc TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS staff_users (
      id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, level TEXT NOT NULL,
      password_hash TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS client_access (
      id TEXT PRIMARY KEY, company TEXT NOT NULL, user_id TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS singletons (key TEXT PRIMARY KEY, doc TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS correspondence (
      id INTEGER PRIMARY KEY AUTOINCREMENT, mark_id TEXT, opposition_id TEXT,
      sent_at TEXT NOT NULL, to_email TEXT NOT NULL DEFAULT '', subject TEXT NOT NULL DEFAULT '',
      body TEXT NOT NULL DEFAULT '', user_name TEXT NOT NULL DEFAULT ''
    );
  `);
  ensureRulesCurrent(db);
}

/** Apply the built-in rulebook / rulesVersion migration, keeping custom rules. */
export function ensureRulesCurrent(db: DB): void {
  const verRow = db.prepare(`SELECT value FROM meta WHERE key='rulesVersion'`).get() as { value: string } | undefined;
  const storedVersion = verRow ? parseInt(verRow.value, 10) : undefined;
  const stored: RuleBook = {};
  for (const row of db.prepare(`SELECT jurisdiction, doc FROM rules`).all() as { jurisdiction: string; doc: string }[]) {
    stored[row.jurisdiction] = JSON.parse(row.doc);
  }
  if (Object.keys(stored).length === 0) {
    saveRules(db, defaultRules());
  } else {
    const { rules } = migrateRules(stored, storedVersion);
    saveRules(db, rules);
  }
  db.prepare(`INSERT INTO meta(key,value) VALUES('rulesVersion',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`).run(String(RULES_VERSION));
}

const now = () => new Date().toISOString();

// ---- marks -----------------------------------------------------------------

export function getMark(db: DB, id: string): Mark | null {
  const row = db.prepare(`SELECT doc FROM marks WHERE id=?`).get(id) as { doc: string } | undefined;
  return row ? (JSON.parse(row.doc) as Mark) : null;
}

export function listMarks(db: DB): Mark[] {
  return (db.prepare(`SELECT doc FROM marks ORDER BY name COLLATE NOCASE`).all() as { doc: string }[]).map((r) => JSON.parse(r.doc));
}

export function saveMark(db: DB, m: Mark): void {
  db.prepare(
    `INSERT INTO marks(id,name,jurisdiction,status,owner,madrid_id,ir_id,basic_id,updated_at,doc)
     VALUES(@id,@name,@jurisdiction,@status,@owner,@madrid_id,@ir_id,@basic_id,@updated_at,@doc)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, jurisdiction=excluded.jurisdiction,
       status=excluded.status, owner=excluded.owner, madrid_id=excluded.madrid_id,
       ir_id=excluded.ir_id, basic_id=excluded.basic_id, updated_at=excluded.updated_at, doc=excluded.doc`
  ).run({
    id: m.id,
    name: m.name || '',
    jurisdiction: m.jurisdiction || '',
    status: m.status || '',
    owner: m.owner || '',
    madrid_id: m.madridId || null,
    ir_id: m.irId || null,
    basic_id: m.basicId || null,
    updated_at: now(),
    doc: JSON.stringify(m),
  });
}

export function deleteMark(db: DB, id: string): void {
  db.prepare(`DELETE FROM marks WHERE id=?`).run(id);
}

// ---- oppositions -----------------------------------------------------------

export function getOpposition(db: DB, id: string): Opposition | null {
  const row = db.prepare(`SELECT doc FROM oppositions WHERE id=?`).get(id) as { doc: string } | undefined;
  return row ? JSON.parse(row.doc) : null;
}

export function listOppositions(db: DB): Opposition[] {
  return (db.prepare(`SELECT doc FROM oppositions ORDER BY name COLLATE NOCASE`).all() as { doc: string }[]).map((r) => JSON.parse(r.doc));
}

export function saveOpposition(db: DB, o: Opposition): void {
  db.prepare(
    `INSERT INTO oppositions(id,name,jurisdiction,status,client,updated_at,doc)
     VALUES(@id,@name,@jurisdiction,@status,@client,@updated_at,@doc)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, jurisdiction=excluded.jurisdiction,
       status=excluded.status, client=excluded.client, updated_at=excluded.updated_at, doc=excluded.doc`
  ).run({
    id: o.id,
    name: o.name || '',
    jurisdiction: o.jurisdiction || '',
    status: o.status || '',
    client: o.client || '',
    updated_at: now(),
    doc: JSON.stringify(o),
  });
}

export function deleteOpposition(db: DB, id: string): void {
  db.prepare(`DELETE FROM oppositions WHERE id=?`).run(id);
}

// ---- companies -------------------------------------------------------------

export function getCompany(db: DB, id: string): Company | null {
  const row = db.prepare(`SELECT doc FROM companies WHERE id=?`).get(id) as { doc: string } | undefined;
  return row ? JSON.parse(row.doc) : null;
}

export function listCompanies(db: DB): Company[] {
  return (db.prepare(`SELECT doc FROM companies ORDER BY name COLLATE NOCASE`).all() as { doc: string }[]).map((r) => JSON.parse(r.doc));
}

export function saveCompany(db: DB, c: Company): void {
  db.prepare(
    `INSERT INTO companies(id,name,type,updated_at,doc) VALUES(@id,@name,@type,@updated_at,@doc)
     ON CONFLICT(id) DO UPDATE SET name=excluded.name, type=excluded.type, updated_at=excluded.updated_at, doc=excluded.doc`
  ).run({ id: c.id, name: c.name || '', type: c.type || 'Company', updated_at: now(), doc: JSON.stringify(c) });
}

export function deleteCompany(db: DB, id: string): void {
  db.prepare(`DELETE FROM companies WHERE id=?`).run(id);
}

// ---- rules & singletons ----------------------------------------------------

export function loadRules(db: DB): RuleBook {
  const out: RuleBook = {};
  for (const row of db.prepare(`SELECT jurisdiction, doc FROM rules`).all() as { jurisdiction: string; doc: string }[]) {
    out[row.jurisdiction] = JSON.parse(row.doc);
  }
  return out;
}

export function saveRules(db: DB, rules: RuleBook): void {
  const up = db.prepare(`INSERT INTO rules(jurisdiction,doc) VALUES(?,?) ON CONFLICT(jurisdiction) DO UPDATE SET doc=excluded.doc`);
  const tx = db.transaction(() => {
    for (const [jur, list] of Object.entries(rules)) up.run(jur, JSON.stringify(list));
  });
  tx();
}

export function saveJurisdictionRules(db: DB, jurisdiction: string, list: Rule[]): void {
  db.prepare(`INSERT INTO rules(jurisdiction,doc) VALUES(?,?) ON CONFLICT(jurisdiction) DO UPDATE SET doc=excluded.doc`).run(
    jurisdiction,
    JSON.stringify(list)
  );
}

function getSingleton<T>(db: DB, key: string, fallback: () => T): T {
  const row = db.prepare(`SELECT doc FROM singletons WHERE key=?`).get(key) as { doc: string } | undefined;
  return row ? JSON.parse(row.doc) : fallback();
}

function setSingleton(db: DB, key: string, value: unknown): void {
  db.prepare(`INSERT INTO singletons(key,doc) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET doc=excluded.doc`).run(key, JSON.stringify(value));
}

export function getOppDatesMaster(db: DB): OppDateMaster[] {
  return getSingleton(db, 'oppDatesMaster', defaultOppDatesMaster);
}

export function setOppDatesMaster(db: DB, v: OppDateMaster[]): void {
  setSingleton(db, 'oppDatesMaster', v);
}

export function getFirmSettings(db: DB): FirmSettings {
  return getSingleton(db, 'firmSettings', () => ({
    lawFirmName: 'BrandU Legal',
    firmContactEmail: '',
    documentsFolder: '',
    logo: '',
  }));
}

export function setFirmSettings(db: DB, v: FirmSettings): void {
  setSingleton(db, 'firmSettings', v);
}

export function newId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}
