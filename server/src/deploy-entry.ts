import path from 'node:path';
import { createApp, runDailyDigest } from './app.js';
import { backupDatabase, openDb } from './db.js';
import { seed } from './seed.js';

/**
 * Entry point for the single-file deploy bundle (cPanel Passenger, Docker, any
 * plain Node host). All paths are resolved relative to the current working
 * directory — which is the application root under Passenger — so the bundle has
 * no `import.meta`/`__dirname` assumptions and needs no build step on the host.
 *
 * Environment:
 *   PORT           listen port (Passenger sets this; default 3000)
 *   DB_FILE        SQLite path            (default ./data/brandu.sqlite)
 *   CLIENT_DIST    built front end        (default ./public)
 *   UPLOADS_DIR    uploaded files         (default ./uploads)
 *   SEED_DIR       seed JSON bundle       (default ./seed)
 *   SEED_ON_START  '1' to seed an empty DB on boot (first deploy only)
 *   SESSION_SECRET signing secret (strongly recommended in production)
 */
const cwd = process.cwd();
const dbFile = process.env.DB_FILE || path.join(cwd, 'data', 'brandu.sqlite');
const clientDist = process.env.CLIENT_DIST || path.join(cwd, 'public');
const uploadsDir = process.env.UPLOADS_DIR || path.join(cwd, 'uploads');
const seedDir = process.env.SEED_DIR || path.join(cwd, 'seed');
const port = parseInt(process.env.PORT || '3000', 10);

const db = openDb(dbFile);

// One-shot task mode (for cPanel cron): send the daily digest, then exit without
// starting the web server. Cron example (8:00 AM AET):
//   source ~/nodevenv/brandu-tm/24/bin/activate && cd ~/brandu-tm && RUN_TASK=daily-digest node app.cjs
if (process.env.RUN_TASK === 'daily-digest') {
  runDailyDigest(db)
    .then((r) => {
      console.log(`Daily digest: sent ${r.sent} email(s)${r.recipients.length ? ' to ' + r.recipients.join(', ') : ''}.`);
      process.exit(0);
    })
    .catch((e) => {
      console.error('Daily digest failed:', (e as Error).message);
      process.exit(1);
    });
} else if (process.env.RUN_TASK === 'backup') {
  // One-shot database backup (for cPanel cron). Writes a consistent daily
  // snapshot and keeps the newest BACKUP_KEEP_DAYS (default 30). Cron example
  // (2:00 AM daily):
  //   source ~/nodevenv/brandu-tm/24/bin/activate && cd ~/brandu-tm && RUN_TASK=backup node app.cjs
  try {
    const dir = process.env.BACKUP_DIR || path.join(cwd, 'backups');
    const keep = parseInt(process.env.BACKUP_KEEP_DAYS || '30', 10);
    const r = backupDatabase(db, dir, keep);
    console.log(`Backup written: ${r.file}${r.pruned ? ` (pruned ${r.pruned} old snapshot${r.pruned === 1 ? '' : 's'})` : ''}.`);
    process.exit(0);
  } catch (e) {
    console.error('Backup failed:', (e as Error).message);
    process.exit(1);
  }
} else {

if (process.env.SEED_ON_START === '1') {
  try {
    const out = seed(db, { seedDir });
    console.log('Seeded database:', out);
    console.log('Staff users created with the initial password — change it after first sign-in.');
  } catch (e) {
    console.log('Seed skipped:', (e as Error).message);
  }
}

const app = createApp(db, { uploadsDir, clientDist });
app.listen(port, () => {
  console.log(`BrandU TM database listening on port ${port} (db: ${dbFile}, client: ${clientDist})`);
});

}
