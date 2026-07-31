import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { backupDatabase, openDb } from '../src/db.js';

describe('database backup task', () => {
  it('writes a consistent snapshot and prunes to the keep limit', () => {
    const db = openDb(':memory:');
    // Put a real row in so the snapshot has content to reopen.
    db.prepare(`INSERT INTO marks(id,name,jurisdiction,status,owner,updated_at,doc) VALUES(?,?,?,?,?,?,?)`).run(
      'm_backup', 'BACKUPME', 'Australia', '', '', new Date().toISOString(), JSON.stringify({ id: 'm_backup', name: 'BACKUPME' })
    );

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brandu-backup-'));
    try {
      const r = backupDatabase(db, dir, 30);
      expect(fs.existsSync(r.file)).toBe(true);
      expect(r.file).toMatch(/brandu-\d{4}-\d{2}-\d{2}\.sqlite$/);

      // The snapshot is a real, openable SQLite database with our row in it.
      const snap = openDb(r.file);
      const got = snap.prepare(`SELECT name FROM marks WHERE id=?`).get<{ name: string }>('m_backup');
      expect(got?.name).toBe('BACKUPME');
      snap.close();

      // Pruning: seed extra dated snapshots, keep only the newest 3.
      for (const d of ['2020-01-01', '2020-01-02', '2020-01-03', '2020-01-04']) {
        fs.writeFileSync(path.join(dir, `brandu-${d}.sqlite`), 'x');
      }
      const r2 = backupDatabase(db, dir, 3);
      expect(r2.pruned).toBeGreaterThanOrEqual(1);
      const remaining = fs.readdirSync(dir).filter((f) => /^brandu-.*\.sqlite$/.test(f));
      expect(remaining.length).toBe(3);
      // The most recent (today's) snapshot is always retained.
      expect(remaining).toContain(path.basename(r2.file));
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
