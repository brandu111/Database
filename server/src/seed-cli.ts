import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb } from './db.js';
import { seed } from './seed.js';

/** CLI wrapper for `npm run seed` (development / VPS). */
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seedDir = process.env.SEED_DIR || path.resolve(__dirname, '../../server/seed');
const dbFile = process.env.DB_FILE || path.resolve(__dirname, '../../server/data/brandu.sqlite');

const db = openDb(dbFile);
const out = seed(db, { seedDir });
console.log(`Seeded ${dbFile}:`, out);
console.log('Staff users created with the initial password — change it after first sign-in.');
