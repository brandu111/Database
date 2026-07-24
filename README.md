# BrandU Legal — Trade Mark Management Database

A trade mark portfolio & docketing system for BrandU Legal, built to replace the legacy
"Reva" system. It manages trade mark cases across jurisdictions, computes statutory
deadlines automatically from a status-driven date engine, tracks opposition proceedings,
stores companies/individuals/partnerships and their contacts, generates client emails from
templates, produces configurable reports, and surfaces upcoming deadlines through an
alerts system.

This is the production rebuild of the design prototype in
[`docs/design-handoff/`](docs/design-handoff/README.md) — a real client/server application
with a database, authenticated multi-user access, server-side deadline calculation, file
storage and a client extranet.

## Repository layout

| Path | What it is |
| --- | --- |
| `packages/shared` | **The date engine** — statutory rulebook (v7), status→date cascade, Madrid renewal linkage, opposition schedules, date arithmetic. Pure TypeScript, no I/O, fully unit-tested. |
| `server` | Node/TypeScript (Express) API. SQLite storage, staff auth with permission levels, client-extranet auth (hashed passwords), file uploads, seed scripts. The date engine runs **only** here on writes — never in the browser. |
| `client` | React + TypeScript (Vite) front end: Trade Marks, Oppositions, Contacts, Alerts, Reports, Preferences, plus the read-only client portal. |
| `server/seed` | Data bundle from the handoff: Reva case export, opposition spreadsheet, AU + international email template libraries. |
| `docs/design-handoff` | The original design prototype, acceptance harness, phase-2 backend/portal spec and narrative directions. |

## Getting started

Requires Node 20+.

```bash
npm install
npm run build -w @brandu/shared     # build the shared engine once
npm run seed                        # create server/data/brandu.sqlite from the seed bundle
npm run dev                         # API on :4000, Vite dev server on :5173
```

Open http://localhost:5173. Seeded staff users: `Kerrie`, `BeaPark`, `Natalie`, `AlexMJ`,
`Admin` (Full Permissions) and `Fiona` (View and Print Only). The initial password for all
of them is `brandu-change-me` (override with `SEED_STAFF_PASSWORD` when seeding) —
**change these after first sign-in** via Preferences → Settings & Users.

Production build: `npm run build`, then `npm start` — the API serves the built client from
`client/dist` on one port.

### Tests

```bash
npm test
```

- `packages/shared/test` — the **acceptance suite** ported from
  `docs/design-handoff/Date Rule Test Cases.dc.html` (month-end rollover, leap years,
  business-day roll-forward) plus engine behavior tests: the client-verified AU example
  (Registration Date entered ⇒ Renewal Deadline = Application Filed + 10 years and the full
  reminder chain), stage transitions, Madrid designation renewal propagation, and the
  `rulesVersion` migration.
- `server/test` — end-to-end API tests: auth, permission enforcement, the server-side
  engine on writes, Madrid filing, opposition schedules with citations, alerts, and the
  client extranet.

## How the date engine works

Dates are **stored ISO** (`yyyy-mm-dd`) and always **rendered `DD MMM YYYY`** via one
formatting function. Calendar arithmetic clamps to month end (31 Aug + 6 months →
29 Feb in a leap year) and clamps 29 Feb + N years in non-leap years, per the acceptance
harness. `rollForwardToBusinessDay()` rolls weekend/holiday deadlines forward given a
jurisdiction's holiday calendar.

Every mark write goes through the server pipeline: if the status changed, `applyStage()`
seeds the stage's input dates and activates its rules; then `ensureRuleRows()` activates
any rule whose trigger date is present (post-registration rules — renewal chain, non-use,
declarations of use, dependency, grace — are gated behind a present Registration Date),
recomputes all derived rows and reminders, and propagates a Madrid IR's renewal to all of
its designations (`linkedToIR` rows are copied, never computed).

The rulebook lives in the database, editable per jurisdiction in Preferences → Date Rules.
Built-in rules carry citations (kept in `packages/shared/src/rules.ts` and on the
opposition schedule rows). **If you change a built-in rule in code, bump `RULES_VERSION`**
— stored rulebooks are migrated on server start, preserving rules users added
(`custom: true`).

Verified statutory anchors (client-reviewed; the firm remains the authority — confirm
before go-live):

- Renewals: AU/NZ/UK/EU/Singapore 10 years **from filing**; US/Madrid/Canada/China/Japan
  10 years **from registration**. US §8 declaration at the 5th–6th year, §8&9 at 9–10 years.
- Convention priority: 6 months from the earliest priority date.
- AU examination: Acceptance Deadline = **15 months from the first report** (extension
  added manually). US office action response: 6 months from issue.
- AU opposition period: 2 months from advertisement. Full AU opposition timeline per
  regs 5.13 / 17A.34H is generated by "Get Dates From Template" on an opposition.
- Non-use vulnerability: AU/NZ/US/CA/CN/JP 3 years; UK/EU/SG 5 years.

## Security notes

- Staff sign in with per-user passwords (bcrypt-hashed); permission levels
  (Full / Edit / View & Print / No Access) are enforced **server-side** on every route.
- Client-extranet passwords are generated, stored **hashed**, and shown exactly once at
  grant/regenerate time. Portal sessions are read-only and scoped to the company's own
  matters.
- Uploaded documents are only served to authenticated sessions.
- Set `SESSION_SECRET` in production (otherwise a per-database secret is generated), and
  run behind HTTPS so session cookies are `secure`.

## Upgrade paths (deliberate v1 simplifications)

- **Database**: SQLite (zero-ops, WAL) with JSON document columns + indexed filter
  columns. The same shape maps directly onto PostgreSQL `jsonb` — swap `server/src/db.ts`
  for a `pg` implementation; queries are intentionally simple. Cross-matter date reporting
  at larger scale would justify promoting `dates[]` into a relational `mark_dates` table.
- **Files**: stored on local disk under `server/uploads`. Move to S3-compatible object
  storage by replacing the two handlers in `server/src/app.ts` (`/api/files`, `/files`).
- **Email**: "Send client email" opens the user's mail app pre-filled and records the
  correspondence against the matter. Wire a transactional provider into
  `/api/marks/:id/correspondence` to send/queue server-side.
- **Exports**: Reports export Word/Excel via an HTML-table blob (Office opens it natively,
  with the firm logo + name + date header). Replace with real `.docx`/`.xlsx` generation
  if fidelity matters.

## Phase 2 — live IP-office integration

`docs/design-handoff/Backend & Portal.dc.html` contains the researched architecture for
register sync: scheduled ingestion of ~30 official public registers (IP Australia, IPONZ,
USPTO, UKIPO, EUIPO, WIPO Madrid Monitor, TMview, …), each syncing weekly + on-demand, to
auto-verify statuses/dates against the docket and flag discrepancies, plus the client
extranet (a first read-only version of which ships in this build). Respect each source's
terms of use and rate limits; prefer official bulk/open-data feeds over HTML scraping.
