// Assembles a self-contained deploy bundle for cPanel Passenger / Docker / any
// plain Node host. Run via `npm run build:deploy` from the repo root, which
// first compiles @brandu/shared, the client, and the server so the inputs
// below exist.
//
// The server uses Node's built-in `node:sqlite`, so the bundle has NO native
// module and NO runtime dependencies — nothing to compile or install on the
// host (requires Node 22.13+/24).
//
// Output (repo-root ./deploy):
//   app.cjs        single-file CommonJS server (everything inlined)
//   public/        built React client, served by the API
//   seed/          seed JSON bundle (Reva export, oppositions, templates)
//   package.json   runtime manifest (empty dependency list)
//   .gitignore     keeps data/ and uploads/ out of version control
//   README.md      quick reference
import { build } from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const serverDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const root = path.resolve(serverDir, '..');
const out = path.join(root, 'deploy');

const entry = path.join(serverDir, 'dist', 'deploy-entry.js');
const clientDist = path.join(root, 'client', 'dist');
if (!fs.existsSync(entry)) throw new Error(`Missing ${entry} — run "npm run build" first.`);
if (!fs.existsSync(clientDist)) throw new Error(`Missing ${clientDist} — run "npm run build -w @brandu/client" first.`);

const serverPkg = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8'));

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  outfile: path.join(out, 'app.cjs'),
  // node: builtins (including node:sqlite) are externalised automatically.
  legalComments: 'none',
  logLevel: 'info',
});

fs.cpSync(clientDist, path.join(out, 'public'), { recursive: true });
fs.cpSync(path.join(serverDir, 'seed'), path.join(out, 'seed'), { recursive: true });

fs.writeFileSync(
  path.join(out, 'package.json'),
  JSON.stringify(
    {
      name: 'brandu-tm-deploy',
      private: true,
      version: serverPkg.version,
      description: 'BrandU trade mark database — deploy bundle',
      main: 'app.cjs',
      scripts: { start: 'node app.cjs', seed: 'SEED_ON_START=1 node app.cjs' },
      dependencies: {},
      engines: { node: '>=22.13' },
    },
    null,
    2
  ) + '\n'
);

fs.writeFileSync(path.join(out, '.gitignore'), 'node_modules/\ndata/\nuploads/\n*.sqlite*\n');

fs.writeFileSync(
  path.join(out, 'README.md'),
  `# BrandU trade mark database — deploy bundle

Self-contained runtime using Node's built-in SQLite — no dependencies to
install and nothing to compile. Requires Node 22.13+ or 24. Upload this whole
folder to your host, then:

    SEED_ON_START=1 node app.cjs   # first run only — seeds the database
    node app.cjs                   # subsequent runs

Passenger (cPanel "Setup Node.js App"): set the application startup file to
\`app.cjs\` and pick Node 24 (or 22.13+). "Run NPM Install" installs nothing
(the dependency list is empty) — that is expected. Set environment variables in
the same panel:

    SESSION_SECRET   a long random string (required in production)
    SEED_ON_START    1 for the very first boot only, then remove it
    NODE_ENV         production   (set automatically by "Production" mode)

The server listens on the port Passenger provides (or \$PORT, default 3000) and
serves the front end from ./public. Data lives in ./data/brandu.sqlite and
uploads in ./uploads — back these up. See docs/DEPLOY-cpanel.md in the repo for
the full walkthrough.

## Staff alert emails (optional)

To let the system email staff ("action required" notices and the daily digest),
add your cPanel/VentraIP mailbox details as environment variables in the Node
app panel — nothing leaves your hosting:

    SMTP_HOST    mail server host, e.g. mail.brandu.legal
    SMTP_PORT    465 (SSL) or 587 (STARTTLS); default 587
    SMTP_USER    a full mailbox address, e.g. alerts@brandu.legal
    SMTP_PASS    that mailbox's password
    SMTP_FROM    From address (defaults to SMTP_USER)
    PORTAL_URL   https://portal.brandu.legal   (link shown in the emails)
    DIGEST_FALLBACK  staff names that receive unattributed deadlines in the
                     digest (comma-separated; default: alexMJ,admin)

Each staff member sets their own address under Preferences → Settings → "My
email sign-off". Use "Send test" there to confirm it works.

Daily digest: schedule a cPanel cron job to run once a day (8:00 AM AET is
0 22 * * * in UTC). Command:

    source ~/nodevenv/brandu-tm/24/bin/activate && cd ~/brandu-tm && RUN_TASK=daily-digest node app.cjs

This sends each staff member one email listing all of their deadlines due that
day (and any overdue), then exits — it does not start the web server.
`
);

const files = fs.readdirSync(out).sort().join(', ');
const bundleKb = (fs.statSync(path.join(out, 'app.cjs')).size / 1024).toFixed(0);
console.log(`\nDeploy bundle written to ${out}`);
console.log(`  app.cjs ${bundleKb} KB · contents: ${files}`);
