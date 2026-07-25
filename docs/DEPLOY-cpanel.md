# Deploying to VentraIP cPanel ("Setup Node.js App")

This guide hosts the trade mark database on VentraIP shared hosting using
cPanel's **Setup Node.js App** (Phusion Passenger). Your existing WordPress site
stays where it is; the app runs on its own subdomain, e.g.
`portal.brandulegal.com.au`.

> **Before you start — a note on client data.** This system holds real client
> portfolios and a client-login extranet. Serve it only over HTTPS (step 7),
> keep the initial passwords secret and change them immediately (step 6), and
> back up the `data/` folder (step 8). Never place the app inside `public_html`
> where files could be served directly.

Shared hosting can't reliably run the TypeScript/Vite build, so you build a
**pre-made bundle on your own computer** and upload it. The bundle uses the
SQLite engine **built into Node itself**, so there are **no dependencies to
install and nothing to compile** on the server — it just needs Node 22.13+ or
24 (24 is ideal).

---

## 1. Build the deploy bundle (on your computer)

Requires Node 22.13+ locally (once — only to produce the bundle).

```bash
git clone https://github.com/brandu111/Database.git
cd Database
git checkout claude/new-session-19luoq
npm install
npm run build:deploy
```

This creates a `deploy/` folder:

```
deploy/
  app.cjs         ← the whole server in one file (the Passenger startup file)
  public/         ← the built web app
  seed/           ← initial data (existing marks, oppositions, templates)
  package.json    ← runtime manifest (no dependencies)
  README.md
```

Zip the **contents** of `deploy/` (not the folder itself) ready to upload:

```bash
cd deploy && zip -r ../brandu-deploy.zip . && cd ..
```

## 2. Create the subdomain (cPanel)

1. Log into cPanel (via your VentraIP VIPControl account → **cPanel**).
2. **Domains → Create a New Domain** (or **Subdomains**).
3. Domain: `portal.brandulegal.com.au`.
4. Uncheck "share document root" if offered, and set the document root to
   something like `brandu-tm` (this becomes `/home/<youruser>/brandu-tm`).
   Note this path — it's the **application root** in step 4.

If VentraIP manages your DNS, the subdomain resolves automatically. If your DNS
is elsewhere, add an `A` record for `portal` pointing to the server's IP (shown
in cPanel's sidebar under "Shared IP Address").

## 3. Upload the bundle

1. cPanel → **File Manager** → open the application-root folder from step 2
   (`brandu-tm`).
2. **Upload** `brandu-deploy.zip`, then **Extract** it there.
3. You should now see `app.cjs`, `public/`, `seed/`, and `package.json` directly
   inside `brandu-tm`. Delete the zip afterwards.

## 4. Create the Node.js application

cPanel → **Setup Node.js App** → **Create Application**:

| Field | Value |
| --- | --- |
| Node.js version | **24.x** (the "recommended" one); 22.13+ also works — *not* 20 or 18 |
| Application mode | **Production** |
| Application root | `brandu-tm` (from step 2) |
| Application URL | `portal.brandulegal.com.au` |
| Application startup file | `app.cjs` |

Then add **Environment variables** (in the same screen):

| Name | Value |
| --- | --- |
| `SESSION_SECRET` | a long random string (e.g. 40+ random characters) |
| `NODE_ENV` | `production` |
| `SEED_ON_START` | `1` — **first boot only**, you'll remove it in step 5 |

Optional: set `SEED_STAFF_PASSWORD` to choose the initial staff password
instead of the default `brandu-change-me`.

Click **Create**.

## 5. Start it

1. On the app's card, click **Run NPM Install**. Because the app has **no
   dependencies** (it uses Node's built-in SQLite), this finishes instantly and
   installs nothing — that is expected and correct, not an error.
2. Click **Restart**. The first boot **seeds the database** from `seed/`
   (this can take a few seconds — it's importing several thousand records).
3. Open `https://portal.brandulegal.com.au` — you should see the sign-in page.
4. **Remove the `SEED_ON_START` variable** (or set it to `0`) and **Restart**
   again, so future restarts never attempt to re-seed. (Re-seeding is already
   refused once data exists, but removing the flag keeps boots clean.)

> Prefer a terminal? Instead of `SEED_ON_START`, open the app's **"Enter to the
> application virtual environment"** command shown in cPanel, then run
> `SEED_ON_START=1 node app.cjs` once, stop it, and start the app normally.

## 6. Sign in and secure the accounts

Seeded staff logins (initial password `brandu-change-me`, or your
`SEED_STAFF_PASSWORD`): `Natalie`, `Kerrie`, `BeaPark`, `AlexMJ`, `Admin`
(Full Permissions) and `Fiona` (View and Print Only).

**Immediately** go to **Preferences → Settings & Users** and set a new password
for every user. Delete any accounts you don't need.

## 7. Turn on HTTPS

cPanel → **SSL/TLS Status** → tick `portal.brandulegal.com.au` → **Run AutoSSL**.
VentraIP issues a free Let's Encrypt certificate. Once active, the app's session
cookies are served securely (the app sets `secure` cookies when
`NODE_ENV=production`). Force HTTPS via cPanel → **Domains → Force HTTPS Redirect**.

## 8. Back up your data

Everything the firm enters lives in two folders inside the application root:

- `data/brandu.sqlite` — the database (all cases, oppositions, contacts, rules)
- `uploads/` — uploaded documents, logos and audio

Back these up regularly: cPanel → **Backup** (or **File Manager** → download
`data/`), or schedule VentraIP account backups. To restore, stop the app, drop
the files back in place, and restart.

## 9. Updating the app later

When there's a new version:

1. On your computer: `git pull`, then `npm run build:deploy` again.
2. Upload the new `app.cjs` and the `public/` folder, replacing the old ones.
   **Do not touch `data/` or `uploads/`** — that's your live data.
3. If `package.json` changed, click **Run NPM Install** again.
4. **Restart** the app in Setup Node.js App.

Database schema changes and rule updates migrate automatically on start
(`rulesVersion` migration preserves any rules you've customised).

---

### Troubleshooting

- **502 / "We're sorry" page** → check the app's **stderr log** (path shown in
  Setup Node.js App, or `~/logs`). Usually a missing env var or a failed NPM
  install.
- **Sign-in works but the page is blank** → the `public/` folder didn't upload
  correctly; re-upload it into the application root.
- **"Database already contains N marks — refusing to re-seed"** in the log →
  harmless; it means seeding was attempted on an already-populated database.
  Remove `SEED_ON_START` and restart.
- **App won't start, log mentions `sqlite` / `getBuiltinModule`** → the Node
  version is too old. Built-in SQLite needs **Node 22.13+ or 24**; switch the
  app's Node.js version to **24.x** and restart. (Node 20/18 won't work.)
- **`ExperimentalWarning: SQLite is an experimental feature`** in the log →
  harmless and expected; it's just a notice, not an error.

If you'd rather not run on shared hosting, `docs/DEPLOY-docker.md` covers a small
VPS / managed host (Render, Railway, Fly.io) using the included `Dockerfile` —
better suited to always-on availability for a system the firm depends on.
