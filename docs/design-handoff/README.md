# Handoff: BrandU Legal — Trade Mark Management Database

## Overview
A trade mark portfolio & docketing system for BrandU Legal (an Australian IP law firm), built to replace their legacy "Reva" system. It manages trade mark cases across jurisdictions, computes statutory deadlines automatically from a status-driven date engine, tracks opposition proceedings, stores companies/individuals/partnerships and their contacts, generates client emails from templates, produces configurable reports, and surfaces upcoming deadlines through an alerts system. A planned second phase adds live integration with public IP-office registers and a client extranet.

This is a **functionality-heavy application**, not a marketing site — the value is in the data model, the deadline-calculation engine, and the workflow. Treat the README's *Data Model*, *Date Engine*, and *Behavior* sections as the primary spec; visual styling is secondary and intentionally plain/utilitarian.

## About the Design Files
The files in this bundle are **design references created in HTML** — a working prototype demonstrating intended data model, behavior, and look. They are **not production code to copy directly**. The prototype is a single self-contained HTML "Design Component" that persists to `localStorage`; it has no server, no auth, and no real integrations.

The task is to **recreate this design in a real, production codebase**: a proper client/server web application with a database, authenticated multi-user access, file storage, an email-sending service, and (phase 2) register-sync jobs. Use whatever stack the team standardises on. If none exists yet, a reasonable default is: **React + TypeScript** front end, **Node/TypeScript or Python** API, **PostgreSQL** database, object storage (S3-compatible) for documents/logos, and a transactional email provider. The prototype's logic (especially the date engine) is written in plain JavaScript and should be ported to server-side, unit-tested code — deadline calculation is liability-critical and must not live only in the browser.

## Fidelity
**Low-to-medium fidelity for visuals; high fidelity for behavior and data.**
- **Visual**: The layout, information architecture, and component inventory are accurate and should be followed, but apply the team's own design system for polish. The prototype uses one brand accent (`#d34b44`), a neutral paper background, and the "Instrument Sans" font. Don't treat pixel spacing as sacred.
- **Behavioral / data**: High fidelity. The status→date cascade, per-jurisdiction rule offsets, Madrid designation linkage, opposition schedules, alerts aggregation, and report configuration are all deliberate and should be reproduced faithfully. Statutory periods have been reviewed with the client and cited to specific regulations where noted in the code — preserve them exactly and keep the citations.

## Primary Entities (Data Model)

All data currently lives in one JSON object persisted at `localStorage['brandu-tm-db-v1']`. In production this becomes relational tables. Top-level collections: `marks`, `oppositions`, `companies`, `rules` (keyed by jurisdiction), `oppDatesMaster`, `staffUsers`, `clientAccess`, `firmSettings`, plus email-template libraries loaded from JSON.

### Mark (trade mark case) — `marks[]`
The central entity. Key fields:
- `id`, `name` (mark name — auto-populated from the word text for word marks)
- `markType`: one of Word, Logo, Combined, 3D Shape, Series, Sound, Scent, Movement, Colour. Type drives which input fields show:
  - **Word** → word text field
  - **Logo** → graphic/image upload, no word field
  - **Combined** → logo/image upload (word element removed per client instruction)
  - **Sound** → audio upload + description
  - **Scent / Movement / Colour / 3D** → description field(s)
  - **Series** → multiple word/representation entries
- `jurisdiction`: free-text combobox backed by a full country list (all IP offices first, then every country). Drives which rule set applies.
- `status`: workflow stage (see *Status Engine*).
- `application`, `registration` (numbers), `classes`, `goods` (goods/services text), `disclaimers`, `comments`.
- `owner` + `ownerType` (Company / Individual). Owner details are **pulled from the Companies/Contacts record**, not entered on the mark — selecting an owner copies address/phone and their contacts onto the case. Address fields (`address1`, `address2`, `city`, `state`, `zip`, `country`, `phone`) are country-schema aware (labels change: e.g. State/Postcode vs Province/ZIP).
- `matter` (BrandU Legal file no., optional), `associateRef` (Associates file ref, optional), `clientDocket` (client reference).
- `dates[]`: the computed + manual deadline rows (see *Date Engine*). Each row: `{name, date (ISO yyyy-mm-dd), done, reminder, note, auBase, auOff, auUnit, auRem, auGen, emailFor, linkedToIR}`.
- `contacts[]`: contacts associated with this case (name, company, position, phone, email).
- `docs[]`: documents (description, link, uploaded PDF file name/data).
- `actions[]`: free-form trade mark actions/notes, each with an optional alert flag that feeds the Alerts tab.
- Madrid linkage: `basicId` (points to the basic AU/NZ application an IR was created from), `madridId`, `irId` (a designation's parent International Registration), `treaty.desigs[]` (designations spawned from an IR).

### Opposition — `oppositions[]`
- `id`, `name`, `client` (client company), `opponent` (opposition company), `proceeding` (proceeding no.), `jurisdiction`, `status`.
- `clientIsPlaintiff` (true = Plaintiff/opposing, false = Defendant/defending) — drives a role badge.
- `notes`.
- `clientMarks[]`, `oppMarks[]`: each `{name, application, registration}`.
- `dates[]`: `{date, name, note, done, email, suspend}`. Populated on demand via **Get Dates From Template** from `oppDatesMaster`, or per-jurisdiction opposition schedules (see *Opposition Schedules*).
- `contacts[]`: `{name, company, position, phone, email}`.

### Company / Owner record — `companies[]`
Despite the name, this is the **Contacts** tab (renamed in UI). Each record has:
- `type`: Company | Individual | Partnership.
  - **Company** → company name.
  - **Individual** → first + surname (composed into display name).
  - **Partnership** → partnership name + `partners[]` (any number, each `{name, email}`).
- Address block: `address`, `address2`, `city`, `state`, `zip`, `country`, `phone`, `email`, `notes`.
- `contacts[]`: individual people at this company — `{salutation, first, middle, last, title, greeting, position, allTrademarks, allPatents, address1, address2, city, state, zip, country, phone, email}`. **Note the removed fields vs the legacy Reva form**: no suffix, cell, pager, fax, and no "Save to Outlook". The contact popup can be populated via *New Contact*, *Import From Company* (dedupes contacts already on this owner's other matters/oppositions), or *Import From Outlook* (integration point).
- A company detail view lists the trade marks it owns (click to open the case).

### Rules — `rules{}` (keyed by jurisdiction)
The statutory date rulebook. `rules._default` is the baseline; each jurisdiction key (Australia, New Zealand, USA, United Kingdom, European Union (EUTM), Madrid Protocol (WIPO), Canada, China, Japan, Singapore, Philippines, Mexico) holds an array of rule objects:
`{name, trigger, v (offset value), u (unit: days/months/years), alerts (bool), template (email template key), rem (monthly reminder count), custom (bool — user-added, preserved across migrations)}`.
A `rulesVersion` integer (currently **7**) gates a migration that overwrites built-in rules with corrected defaults on load while preserving `custom:true` rules. **If you change any built-in rule, bump the version and migrate.**

### Opposition date master — `oppDatesMaster[]`
Template list of opposition milestones: `{name, alerts, email, days}`. Used by *Get Dates From Template*.

### Staff users — `staffUsers[]`
`{id, name, level}` where level ∈ Full Permissions | Edit Only | View and Print Only | No Access. In production each staff user authenticates with their own password; level gates view/edit.

### Client access (extranet) — `clientAccess[]`
`{company, userId, password, revealed, active}`. Firm invites a client company; a unique login ID + generated password grant read access to that company's own matters. Regenerate/revoke supported. **In production, store password *hashes*, deliver credentials over a secure channel, and never keep plaintext passwords.**

### Firm settings — `firmSettings{}`
`{lawFirmName, firmContactEmail, documentsFolder, logo (data URL)}`. General firm info only — no per-person "primary contact" (each user carries their own identity). The uploaded **logo is used on report headers**. Date format is fixed system-wide to **DD MMM YYYY** (e.g. `01 Jan 2009`).

## Navigation / Views
Top-level tabs: **Trade Marks** (list + case detail), **Oppositions** (list + detail), **Contacts** (companies/individuals/partnerships + detail), **Alerts** (aggregated deadlines), **Reports**, **Preferences** (Date Rules + Settings & Users).

### Trade Marks — list
Filterable (jurisdiction/status/company) searchable table. Columns include mark name, **trade mark type**, jurisdiction, status, owner, key dates. Row click opens the case.

### Trade Marks — case detail
One main **Trade mark** tab (the former "Mark & registration" + "More Information" merged): mark-type-specific inputs, jurisdiction combobox, goods/services, owner (pulled from Contacts), file references. Separate **Disclaimers** and **Comments** cards. **Documents** section below the main section. A **Dates** panel showing all computed + manual deadlines with per-row done checkbox, editable date, email trigger, and note. A **Contacts** section (pre-populates from the owner's record; if none, prompts the user to add one). A **Madrid Protocol Filing** area. From an AU or NZ case, a **"File a Madrid case"** button spawns a linked IR + designations.

### Oppositions — detail
Details (client/opponent/proceeding/jurisdiction/status/plaintiff-defendant/notes), Client trade marks + Opposition trade marks tables, a Dates table with *Get Dates From Template*, and a Contacts table.

### Alerts
Aggregates **every** upcoming date across all cases and oppositions — deadlines, reminders, non-use dates, renewals, and flagged trade mark actions — into one actionable list. Actioning (marking done) clears the alert.

### Reports
Single configurable, sortable table. **Export to Word** and **Export to Excel** only (both via an HTML-table blob that Office opens natively; the Word/Excel header embeds the firm logo + name + today's date in DD MMM YYYY). Column chooser (Company, Trade mark, Jurisdiction, Application no., Registration no., Status, Classes, Goods/services, Client file ref.) plus *Add date column* for any date type. Click headers to sort (▲/▼). Per-row ✕ removes a record from the report; *Restore removed* brings them back. Filters: company/jurisdiction/status.

### Preferences → Date Rules
Per-jurisdiction editable rule tables (see *Date Engine*). Baseline `_default` copyable into a jurisdiction to customise.

### Preferences → Settings & Users
- **General**: law firm name, firm contact email, documents folder, logo upload (used on reports). Date format note (DD MMM YYYY, system-wide).
- **Staff users**: add/edit/delete with permission levels.
- **Client access (extranet)**: invite a company → unique login + generated password (show/hide, regenerate, revoke).

## Status Engine
Case statuses in order: `Pending` → `Pending - Awaiting Examination` → `Pending - Under Examination` → `Accepted - Awaiting Advertisement` → `Accepted` → `Registered`. Setting a status runs `applyStage()`, which seeds the relevant input/trigger dates (e.g. moving to Registered triggers registration date + the renewal chain). See the prototype's `stageConfig()` / `applyStage()`.

## Date Engine (critical — port server-side, unit-test)
Each mark carries `dates[]`. A rule fires when its **trigger** date is present:
- `defaultRules()` defines rules per jurisdiction. Each rule computes `date = shift(triggerDate, v, u)`.
- `renewalChain(regTrigger, years)` builds: Renewal Deadline (`+years`), reminders at **−6 months, −3 months, −1 month (Final), and −1 week**, and a **6-month grace period** after the deadline.
- `ensureRuleRows(m, d)` activates rules whose trigger date is filled. Post-registration rules (renewal, non-use, declarations of use, dependency, statement of use, grace) are **gated behind a present Registration Date**; other rules fire as soon as their own trigger date exists. It runs on manual date entry and on *Add date*, not only on status change — so entering dates by hand correctly cascades. **Example the client verified:** entering the Registration Date on an AU case creates Renewal Deadline = Application Filed + 10 years (plus the reminder chain).
- `linkDesignationRenewal(m, d)`: a Madrid **designation** (`irId` set) does **not** compute its own renewal — it copies the parent International Registration's Renewal Deadline (and reminders/grace) and marks the row `linkedToIR`. Changing the IR's renewal re-propagates to all designations.
- `fmtDate(iso)` → `DD MMM YYYY`. Dates are **stored ISO** (`yyyy-mm-dd`) and always **rendered** DD MMM YYYY. Never store the display string.

### Verified statutory periods (preserve exactly; keep citations)
**Renewal anchors**: AU/NZ = 10 years **from filing**; US = 10 years **from registration** (+ §8 declaration at 5–6yr, §9/§8&9 at 9–10yr); Madrid = 10 years from IR date (dependency/central-attack window 5 years); Philippines Declaration of Actual Use at 3rd anniversary of filing and within 1 year of renewal.
**Convention priority**: 6 months from the **earliest priority date**.
**AU examination**: **Acceptance Deadline = 15 months from the date of the first report** (this single rule replaces a separate "OA response due"). A 6-month extension (no statutory declaration) exists but is **not shown by default** — the user adds it when needed. **US office action**: response due **6 months from the issue date** of the office action.
**Opposition period (AU)**: runs from the **advertisement/publication date** (2 months).
**Non-use vulnerability** (per jurisdiction, from registration unless noted): AU 3y, NZ 3y, US 3y, Canada 3y, China 3y, Japan 3y; **UK 5y, EU 5y, Singapore 5y**.

## Opposition Schedules
Per-jurisdiction opposition timelines were researched for AU, US, UK, EU, NZ, Turkey, Japan. Notable verified AU detail:
- **Notice of Intention to Defend**: **2 months** from the day the applicant is given the Statement of Grounds & Particulars (reg 5.13). For an IRDA holder, 2 months from the day the Registrar notifies the International Bureau that a complete notice of opposition was filed (reg 17A.34H). *(The Office also notifies the IRDA holder directly to minimise delay.)*
- **Evidence in Support**: opponent, **3 months from the day the opponent is given a copy of the NID**.
- **Evidence in Answer**: applicant, **3 months from being given the complete Evidence in Support** (or notice none was filed).
- **Evidence in Reply**: opponent, **2 months from being given the Evidence in Answer**.
- **US**: base **30-day** opposition window; extensions (+30, then +60/+90; max 180 days) are **added manually**, not auto-generated.
- **UK**: TM8 counterstatement 2 months; **cooling-off** path represented (extends to ~9 months from notification if entered).
- **EU**: default 2-month cooling-off (extensions opt-in); opponent substantiation 2 months after cooling-off.

Keep these notes/citations attached to the relevant rule rows in the UI.

## Email System
Two template libraries ship as JSON (`au-email-templates.json`, `intl-email-templates.json`) — a searchable template library preserving the client's original merge-field syntax (e.g. `{{client}}`, `{{mark}}`, `{{jurisdiction}}`). A **"Send client email"** action opens the user's chosen mail app (Outlook desktop / Outlook web / Gmail) with the template pre-filled. Certain date rows carry an email trigger (the ✉ affordance) tied to a template key on the rule. In production, wire these to a real send/queue and record sent correspondence against the matter.

## Phase 2 — Live IP-office integration (see `Backend & Portal.dc.html`)
A "no-API, public-database" strategy: scheduled scraping/open-data ingestion of ~30 official public registers (IP Australia, IPONZ, USPTO, UKIPO, EUIPO, WIPO Madrid Monitor + Global Brand Database, TMview, and many national offices), each syncing **Weekly + on-demand**, to auto-verify status/dates and flag discrepancies against the docket (reducing human error). Plus a client extranet. `Backend & Portal.dc.html` contains the architecture, schema sketch, REST endpoint list, role/permission matrix, and sync-source table. Respect each source's terms of use and rate limits; prefer official bulk/open-data feeds over HTML scraping where available.

## Design Tokens
- **Accent / brand**: `#d34b44` (hover/darker `#b23b35`; dark accent text `#a83a33`; light accent bg `#fbeceb`; light accent border `#f0d3d0`).
- **Text**: primary/heading `#16233b`; body `#2b3542`; muted labels `#59616c`; placeholder `#8a8f98`.
- **Surfaces**: page `#fbfbfa`; card `#fff`; warm hover row `#faf3f2`; subtle panel `#faf9f7`; borders `#e7e6e2` / `#eeede9` / `#f1f0ee`.
- **Semantic**: danger/delete `#c2372e`; success `#1e7a3d` (badge bg `#eaf5ee`); defending badge bg `#fdeeed`.
- **Font**: "Instrument Sans" (Google Fonts). Radii ~7–10px on cards/inputs. Uppercase 10.5–11px section labels with `letter-spacing:0.05em`.
- **Date display format**: `DD MMM YYYY` everywhere.

## Assets
- BrandU logo: user-uploaded via Settings (stored as data URL; shown on report headers). No logo is bundled — the firm provides it.
- Font: Instrument Sans via Google Fonts CDN.
- No icon library — a few inline unicode glyphs (✕, ⟳, ✉, ⬆, ←, ▲/▼). Replace with the codebase's icon set.
- Reference documents from the client live in `uploads/` (not all included here).

## Screenshots
`screenshots/` contains reference captures of the main views (data was emptied for testing, so lists show empty states — they document layout, not content):
- `01-trademarks-list.png` — Trade Marks list (filters, columns incl. Type, sortable headers)
- `02-oppositions-list.png` — Oppositions list
- `03-contacts-list.png` — Contacts (companies/individuals/partnerships)
- `04-alerts.png` — Alerts (aggregated deadlines)
- `05-reports.png` — Reports (column chooser, Word/Excel export, sortable table)
- `06-preferences-date-rules.png` — Date Rules editor (per-jurisdiction rule tables)
- `07-preferences-settings-users.png` — Settings & Users (general, logo, staff users, client extranet)

## Files in this bundle
- `Brandu IP.dc.html` — the working prototype (all UI + the full date engine + logic). Primary reference.
- `Backend & Portal.dc.html` — phase-2 backend & register-sync architecture spec, schema, endpoints, permissions, sync-source list.
- `Date Rule Test Cases.dc.html` — acceptance harness: input scenarios and expected computed dates. **Use these as the pass/fail gate when porting the date engine.**
- `TM Database Directions.dc.html` — narrative directions / notes accumulated during design.
- `au-email-templates.json`, `intl-email-templates.json` — email template libraries (merge-field syntax preserved).
- `opposition-data.json` — seed opposition data (real contacts) from the client's spreadsheet.
- `reva-data.json` — seed/sample data structure.
- `support.js` — the Design-Component runtime the prototype loads (framework plumbing, **not** application code — do not port; provided only so the prototype opens).

## How to run the prototype
Open `Brandu IP.dc.html` in a browser. It persists to `localStorage['brandu-tm-db-v1']`. To reset, clear that key. The case/company data was intentionally emptied for clean workflow testing; date rules, opposition master list, staff users, email templates, and settings remain seeded.

## Implementation notes / cautions
1. **Port the date engine to tested server code.** It's the core liability surface. Drive it from `Date Rule Test Cases.dc.html`.
2. **Store dates as ISO, render as DD MMM YYYY.** One formatting function, used everywhere.
3. **Keep the `rulesVersion` migration pattern** — built-in rules evolve; user `custom` rules must survive upgrades.
4. **Real auth & secrets**: hash client-extranet passwords; per-user staff login; enforce permission levels server-side, not just in the UI.
5. **Documents & logo → object storage**, not data URLs / localStorage.
6. **Madrid linkage is relational** — model designations as rows referencing their IR (`irId`) with the renewal date derived/propagated, not duplicated by hand.
7. **Verify statutory periods before go-live.** They've been client-reviewed and cited, but the firm is the authority; make them configurable (they already are, via the rules tables).
8. Replace Word/Excel HTML-blob export with proper `.docx`/`.xlsx` generation if fidelity matters.
