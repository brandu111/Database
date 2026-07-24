// Assembles a self-contained deploy bundle for cPanel Passenger / Docker / any
// plain Node host. Run via `npm run build:deploy` from the repo root, which
// first compiles @brandu/shared, the client, and the server so the inputs
// below exist.
//
// Output (repo-root ./deploy):
//   app.cjs        single-file CommonJS server (shared engine inlined;
//                  only better-sqlite3 stays external — the one native module)
//   public/        built React client, served by the API
//   seed/          seed JSON bundle (Reva export, oppositions, templates)
//   package.json   runtime manifest: `npm install` fetches better-sqlite3 only
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

// Keep the better-sqlite3 version in lockstep with the server's own dependency.
const serverPkg = JSON.parse(fs.readFileSync(path.join(serverDir, 'package.json'), 'utf8'));
const betterSqliteVersion = serverPkg.dependencies['better-sqlite3'];

fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out, { recursive: true });

await build({
  entryPoints: [entry],
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  outfile: path.join(out, 'app.cjs'),
  // Native module: cannot be bundled — installed on the host from a prebuilt binary.
  external: ['better-sqlite3'],
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
      dependencies: { 'better-sqlite3': betterSqliteVersion },
      engines: { node: '>=18' },
    },
    null,
    2
  ) + '\n'
);

fs.writeFileSync(path.join(out, '.gitignore'), 'node_modules/\ndata/\nuploads/\n*.sqlite*\n');

fs.writeFileSync(
  path.join(out, 'README.md'),
  `# BrandU trade mark database — deploy bundle

Self-contained runtime. Upload this whole folder to your host, then:

    npm install --omit=dev     # fetches better-sqlite3 only
    SEED_ON_START=1 node app.cjs   # first run only — seeds the database
    node app.cjs                   # subsequent runs

Passenger (cPanel "Setup Node.js App"): set the application startup file to
\`app.cjs\`. Set environment variables in the same panel:

    SESSION_SECRET   a long random string (required in production)
    SEED_ON_START    1 for the very first boot only, then remove it
    NODE_ENV         production

The server listens on the port Passenger provides (or \$PORT, default 3000) and
serves the front end from ./public. Data lives in ./data/brandu.sqlite and
uploads in ./uploads — back these up. See docs/DEPLOY-cpanel.md in the repo for
the full walkthrough.
`
);

const files = fs.readdirSync(out).sort().join(', ');
const bundleKb = (fs.statSync(path.join(out, 'app.cjs')).size / 1024).toFixed(0);
console.log(`\nDeploy bundle written to ${out}`);
console.log(`  app.cjs ${bundleKb} KB · contents: ${files}`);
