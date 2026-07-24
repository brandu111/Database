import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './app.js';
import { openDb } from './db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbFile = process.env.DB_FILE || path.resolve(__dirname, '../../server/data/brandu.sqlite');
const port = parseInt(process.env.PORT || '4000', 10);

const db = openDb(dbFile);
const app = createApp(db, {
  uploadsDir: process.env.UPLOADS_DIR || path.resolve(__dirname, '../../server/uploads'),
  clientDist: path.resolve(__dirname, '../../client/dist'),
});

app.listen(port, () => {
  console.log(`BrandU TM database API listening on http://localhost:${port} (db: ${dbFile})`);
});
