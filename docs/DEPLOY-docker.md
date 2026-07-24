# Deploying with Docker (VPS or managed host)

The alternative to cPanel shared hosting — recommended when you want reliable
always-on availability. Works on any small VPS (including VentraIP's VPS range)
or a managed container host (Render, Railway, Fly.io).

## Local / VPS with Docker Compose

```bash
git clone https://github.com/brandu111/Database.git
cd Database
git checkout claude/new-session-19luoq

# set a real secret first
export SESSION_SECRET="$(openssl rand -hex 32)"
# (or edit docker-compose.yml)

docker compose up -d --build
```

Open `http://<server>:3000` and sign in (see below). The database and uploads
persist in the named volumes `brandu-data` / `brandu-uploads`.

Put a reverse proxy (Caddy, nginx, or the host's load balancer) in front to add
your domain and HTTPS, e.g. `portal.brandulegal.com.au → 127.0.0.1:3000`.

## Render (one click)

The repo includes `render.yaml`. In Render: **New → Blueprint**, point it at this
repo/branch. Render builds the `Dockerfile`, generates a `SESSION_SECRET`, and
mounts a 1 GB disk at `/app/data` for the SQLite database. Add your custom
subdomain under the service's **Settings → Custom Domains**.

## First-boot seeding

The image sets `SEED_ON_START=1`, so an empty database is seeded automatically on
first run (and the seed is refused once data exists, so restarts are safe). To
choose the initial staff password, set `SEED_STAFF_PASSWORD`.

## Sign in and secure

Seeded staff logins (initial password `brandu-change-me`): `Natalie`, `Kerrie`,
`BeaPark`, `AlexMJ`, `Admin` (Full Permissions); `Fiona` (View and Print Only).
Change every password in **Preferences → Settings & Users** immediately after
first sign-in.

## Environment variables

| Name | Purpose | Default |
| --- | --- | --- |
| `SESSION_SECRET` | signs session cookies — **set this** | random per boot (sessions drop on restart if unset) |
| `PORT` | listen port | `3000` |
| `NODE_ENV` | `production` enables secure cookies | `production` in the image |
| `DB_FILE` | SQLite path | `/app/data/brandu.sqlite` |
| `UPLOADS_DIR` | uploaded files | `/app/uploads` |
| `SEED_ON_START` | seed an empty DB on boot | `1` in the image |
| `SEED_STAFF_PASSWORD` | initial staff password | `brandu-change-me` |

## Backups

Back up the `brandu-data` volume (the `.sqlite` file) and `brandu-uploads`
regularly. On managed hosts, enable disk snapshots.
