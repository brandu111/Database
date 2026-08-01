import type { OppDateMaster, OppSchedule, Rule, RuleBook } from './types.js';

/**
 * The statutory date rulebook. Statutory periods below were reviewed with the
 * client and cited to specific regulations where noted — preserve them exactly
 * and keep the citations (see also oppSchedule()).
 *
 * If any built-in rule changes, bump RULES_VERSION and let migrateRules()
 * refresh stored rulebooks (user rules flagged `custom: true` survive).
 */
export const RULES_VERSION = 13;

const T_REN =
  'Dear {{client}},\n\nRe: Trade mark {{mark}} ({{jurisdiction}})\n\nThis is a reminder that the renewal deadline for the above trade mark is {{deadline}}. Please confirm whether you would like us to attend to the renewal, and we will provide a cost estimate.\n\nKind regards\nBrandU Legal';
const T_OA =
  'Dear {{client}},\n\nRe: Trade mark {{mark}} ({{jurisdiction}})\n\nAn examination report has issued for the above application. A response is due by {{deadline}}. We will review the report and revert with our recommendations.\n\nKind regards\nBrandU Legal';
const T_DES =
  'Dear {{client}},\n\nRe: Registered design {{mark}} ({{jurisdiction}})\n\nThis is a reminder that the above registered design is due for renewal by {{deadline}}. Please confirm whether you would like us to attend to the renewal, and we will provide a cost estimate.\n\nKind regards\nBrandU Legal';

/** True when a case is a registered design rather than a trade mark. */
export function isDesign(type: string | undefined): boolean {
  return /design/i.test(type || '');
}

/**
 * Registered-design date rules (separate from the trade-mark rulebook). Designs
 * renew on a 5-year cycle up to a jurisdiction-specific maximum term, after
 * which they expire and cannot be renewed:
 *   Australia 5 + 5 (max 10y) · New Zealand 5/5/5 (max 15y) ·
 *   UK / EU registered designs 5-yearly to 25y · USA design patents 15y, no renewal.
 * The renewal row is named "Renewal Deadline" so it pins on import and appears
 * in the renewals dashboard just like a trade mark; the engine caps the
 * roll-forward at "Design Maximum Term Ends".
 */
export function designRulesFor(jurisdiction: string): Rule[] {
  const j = (jurisdiction || '').toLowerCase();
  // Legacy reminder lead: AU registered designs 6 months before; NZ 12 months.
  const renew = (maxYears: number, remBefore: number): Rule[] => [
    r('Renewal Deadline', 'Application Filed', 5, 'years', true, T_DES),
    r('Renewal Reminder', 'Renewal Deadline', -remBefore, 'months', true, T_DES),
    r('Design Maximum Term Ends', 'Application Filed', maxYears, 'years', true),
  ];
  if (j.includes('australia')) return renew(10, 6);
  if (j.includes('new zealand')) return renew(15, 12);
  if (j.includes('united kingdom') || j === 'uk' || j.includes('european union') || j.includes('eutm')) return renew(25, 6);
  if (j.includes('usa') || j.includes('united states')) {
    // US design patents: single 15-year term from grant, no renewal.
    return [r('Design Term Ends (no renewal)', 'Registration Date', 15, 'years', true)];
  }
  // Generic registered design — 5-year renewable; verify the local maximum term.
  return [
    r('Renewal Deadline', 'Application Filed', 5, 'years', true, T_DES),
    r('Renewal Reminder', 'Renewal Deadline', -6, 'months', true, T_DES),
  ];
}

const r = (
  name: string,
  trigger: string,
  v: number,
  u: Rule['u'],
  alerts: boolean,
  template = '',
  rem = 0,
  adj = 0
): Rule => (adj ? { name, trigger, v, u, alerts, template, rem, adj } : { name, trigger, v, u, alerts, template, rem });

/**
 * Renewal chain mirroring the legacy (Reva) rulebook: a Renewal Deadline at
 * +term from the anchor trigger (with the optional legacy ±day adjustment), plus
 * a single client Renewal Reminder ahead of it. Legacy used a 6-month reminder
 * lead everywhere except Australia and Mexico (12 months). A handful of
 * jurisdictions also carry a Final reminder and/or the 6-month grace period —
 * passed through `opts`.
 *
 * The engine adds a "— 1 Week Reminder" to every alerting deadline automatically,
 * so the chain only carries the longer-lead client reminder(s).
 */
const renewal = (
  anchor: string,
  term: number,
  opts: { unit?: 'years' | 'months'; remBefore?: number; adj?: number; final?: number; grace?: boolean } = {}
): Rule[] => {
  const unit = opts.unit || 'years';
  const remBefore = opts.remBefore ?? 6;
  const out: Rule[] = [
    r('Renewal Deadline', anchor, term, unit, true, T_REN, 0, opts.adj || 0),
    r('Renewal Reminder', 'Renewal Deadline', -remBefore, 'months', true, T_REN),
  ];
  if (opts.final) out.push(r('Renewal Reminder - Final', 'Renewal Deadline', -opts.final, 'months', true, T_REN));
  if (opts.grace) out.push(r('6 Month Renewal Grace Period', 'Renewal Deadline', 6, 'months', false));
  return out;
};

/** Non-use vulnerability date — jurisdiction-specific 3- or 5-year period from registration. */
const nonUse = (years: number): Rule => r('Non-use vulnerability date', 'Registration Date', years, 'years', true);

/**
 * Convention priority chain (Australia / New Zealand only — the engine gates it
 * to those jurisdictions). Deadline 6 months from filing; client reminders 30
 * days then 7 days before, mirroring the legacy AU/NZ rows.
 */
const convention = (anchor = 'Application Filed'): Rule[] => [
  r('Convention Priority Deadline', anchor, 6, 'months', true),
  r('Reminder for Convention Priority', 'Convention Priority Deadline', -30, 'days', true),
  r('Final Reminder for Convention Priority', 'Convention Priority Deadline', -7, 'days', true),
];

/**
 * Built-in rules, version RULES_VERSION — a faithful mirror of the legacy (Reva)
 * "Trademark Dates" logic, transcribed jurisdiction-by-jurisdiction from the
 * client's exported date-rule screens. Each array below contains ONLY the legacy
 * "Is Relative" (computed) rows: a date name, its trigger, the interval, and the
 * ±day adjustment where legacy carried one.
 *
 * Deliberate global conventions layered over the raw legacy rows:
 *  • Every Renewal Deadline gets a Renewal Reminder (6 months before; 12 for
 *    Australia and Mexico, per legacy) so a renewal reminder is never missed —
 *    legacy carried this on almost every jurisdiction; a few had it as a manual
 *    field, which we automate. Delete it per-case if not wanted.
 *  • The universal "OA Issued?" check-in prompt (5 months after Application Filed,
 *    legacy "Case update" / "OA received?") is added by the engine on every case,
 *    so it is not repeated per jurisdiction here.
 *  • "Opposition period expires" is intentionally NOT generated (an unopposed
 *    matter just proceeds to registration).
 *  • Historical dates are imported pinned/verbatim, so these rules drive forward
 *    computation and renewal roll-over only — the imported values are authoritative.
 *
 * Renewal anchors follow legacy exactly: filing vs registration varies by country
 * (see each entry). ±1-day renewals (China, France, Hong Kong, Thailand, Myanmar)
 * carry the legacy Adjustment via the rule's `adj` field.
 */
export function defaultRules(): RuleBook {
  const rb: RuleBook = {
    // Fallback for any jurisdiction without an explicit legacy entry below.
    _default: [
      r('OA Response Due', 'OA Issued', 2, 'months', true, T_OA),
      r('OA Response - Instructions Reminder', 'OA Response Due', -1, 'months', true, T_OA),
      ...renewal('Registration Date', 10, { grace: true }),
    ],

    // ---------- Australia (national, Headstart, deferment, revocation) --------
    Australia: [
      ...convention(),
      r('OA Maintenance Reminder', 'OA Issued', 6, 'months', true, T_OA),
      r('OA Response Due', 'OA Issued', 15, 'months', true, T_OA),
      r('OA Response - Instructions Reminder', 'OA Response Due', -3, 'months', true, T_OA),
      r('OA Response - Final Reminder', 'OA Response Due', -1, 'months', true, T_OA),
      // Renewal: 10 years from filing, reminder 12 months out (legacy AU lead),
      // a final reminder 1 month out, and the 6-month grace period.
      ...renewal('Application Filed', 10, { remBefore: 12, final: 1, grace: true }),
      // Deferment of acceptance (cited marks / prior use) and revocation.
      r('Deferment deadline - cited marks', 'Deferment request lodged', 6, 'months', true),
      r('Deferment - Reminder (cited mark)', 'Deferment request lodged', 1, 'months', true),
      r('Deferment for prior use deadline', 'Deferment request lodged (use)', 6, 'months', true),
      r('Deferment - Reminder (use)', 'Deferment request lodged (use)', 3, 'months', true),
      r('Revocation - deadline to respond', 'Revocation of Acceptance', 1, 'months', true),
      r('Renewal Fees Paid? Renew', 'Renewal Instructions Received', 1, 'months', true),
      // --- Headstart (AU pre-filing assessment) — business-day workflow -------
      // Enter "Headstart - Application Filed" to start the chain. Entering the
      // preliminary assessment date auto-ticks the chase and sets the Part 2 fee
      // deadline 5 business days out; a chase lands 2 business days before that.
      // Ticking the fee-paid reminder reveals the standard Application Filed date.
      r('Headstart - Preliminary Assessment Received?', 'Headstart - Application Filed', 4, 'days', true),
      r('Headstart - Part 2 Fee Due', 'Headstart - Preliminary Assessment Received', 5, 'business days', true),
      r('Headstart - Has the Part 2 Fee been Paid', 'Headstart - Part 2 Fee Due', -2, 'business days', true),
    ],
    // Trans-Tasman (TTMF) — anchored on "TTMF Application filed".
    'Australia TTMF': [
      r('OA Response Due', 'OA Issued', 15, 'months', true, T_OA),
      r('Convention Priority Deadline', 'TTMF Application filed', 6, 'months', true),
      r('Reminder for Convention Priority', 'TTMF Application filed', 3, 'months', true),
      r('OA Issued?', 'TTMF Application filed', 6, 'months', true),
      ...renewal('TTMF Application filed', 10),
    ],
    'New Zealand': [
      ...convention(),
      r('OA Maintenance Reminder', 'OA Issued', 6, 'months', true, T_OA),
      r('OA Response Due', 'OA Issued', 12, 'months', true, T_OA),
      r('Notice of Renewal Received', 'Instruction to Renew Received', 1, 'months', false),
      ...renewal('Application Filed', 10),
      // Legacy NZ Final = 5 months after the (−6mo) Renewal Reminder ⇒ ~1 month out.
      r('Renewal Reminder - Final', 'Renewal Reminder', 5, 'months', true, T_REN),
    ],
    USA: [
      r('OA Response Due', 'OA Issued', 3, 'months', true, T_OA),
      r('OA Maintenance Reminder', 'OA Response Due', -1, 'months', true, T_OA),
      r('Extension to Statement of Use', 'Notice of Allowance', 6, 'months', true),
      r('Deadline to Appeal the Rejection Notice', 'Rejection Notice Issued', 6, 'months', true),
      // Renewal: 10 years from registration + 6-month grace.
      ...renewal('Registration Date', 10, { grace: true }),
      // §8 Declaration of Use — 5th/6th year (6 years from registration), reminder 1 year out, 6-month grace.
      r('US - Deadline for Dec of Use 5th Anniversary', 'Registration Date', 6, 'years', true, T_REN),
      r('US - Reminder for Declaration of use 5/6 Ann', 'US - Deadline for Dec of Use 5th Anniversary', -12, 'months', true, T_REN),
      r('US - DOU Grace Period Deadline', 'US - Deadline for Dec of Use 5th Anniversary', 6, 'months', false),
      // §8 & §9 — 9th/10th year (10 years from registration), reminder 1 year out.
      r('US - Deadline for Dec of Use 10th Anniversary', 'Registration Date', 10, 'years', true, T_REN),
      r('US - Reminder for Dec of use 9/10 yrs', 'US - Deadline for Dec of Use 10th Anniversary', -12, 'months', true, T_REN),
    ],
    'United Kingdom': [
      nonUse(5),
      r('Renewal Fees Paid? Renew', 'Renewal Instructions Received', 1, 'months', true),
      ...renewal('Application Filed', 10),
    ],
    // Legacy EU renews from the REGISTRATION date (not filing).
    'European Union (EUTM)': [...renewal('Registration Date', 10)],
    'Madrid Protocol (WIPO)': [
      // The IR renews 10 years from the international registration (filing) date;
      // the dependency / central-attack window runs 5 years from the same date.
      // Designations inherit the IR renewal date (see linkDesignationRenewal).
      r('Dependency Period Ends', 'Application Filed', 5, 'years', true),
      r('Irregularities notice response due', 'Irregularities Notice Issued', 3, 'months', true),
      // Country-specific designation obligations (e.g. the Philippines DAU) live on
      // the individual designation case, not on the Madrid IR itself.
      ...renewal('Application Filed', 10),
    ],
    Canada: [
      r('OA Response Due', 'OA Issued', 6, 'months', true, T_OA),
      r('Reminder for Payment of Registration Fee', 'Registration Fee Due', -1, 'months', true),
      r('OA Maintenance Reminder', 'Declaration of Use due', -60, 'days', true),
      ...renewal('Registration Date', 10),
    ],
    // Renewal 10 years from registration, less one day (legacy Adjustment).
    China: [
      r('OA Maintenance Reminder', 'OA Issued', 6, 'months', true, T_OA),
      ...renewal('Registration Date', 10, { adj: -1 }),
    ],
    Japan: [nonUse(3), ...renewal('Registration Date', 10)],
    Singapore: [...renewal('Application Filed', 10)],

    // ---------- Rest of the legacy jurisdiction set --------------------------
    Argentina: [
      ...renewal('Registration Date', 10),
      r('Affidavit of use/non-use 5th anniversary', 'Renewal Deadline', -5, 'years', true),
    ],
    Brazil: [nonUse(5), ...renewal('Registration Date', 10)],
    Cambodia: [
      r('OA Maintenance Reminder', 'Registration Date', 4, 'years', true, T_OA),
      r('Maintenance Date - Affidavit of use/non-use due', 'Registration Date', 5, 'years', true),
      ...renewal('Application Filed', 10),
    ],
    Chile: [...renewal('Registration Date', 10)],
    Colombia: [nonUse(3), ...renewal('Registration Date', 126, { unit: 'months' })],
    // First term 7 years from filing, then 14-year renewal terms.
    Cyprus: [
      ...renewal('Application Filed', 7),
      r('Renewal deadline (after initial term)', 'Renewal Deadline', 14, 'years', true, T_REN),
    ],
    France: [...renewal('Application Filed', 10, { adj: -1 })],
    'Hong Kong': [nonUse(3), ...renewal('Application Filed', 10, { adj: -1 })],
    India: [
      r('OA Maintenance Reminder', 'Application Filed', 12, 'months', true, T_OA),
      r('OA Response Due', 'OA Issued', 1, 'months', true, T_OA),
      nonUse(5),
      ...renewal('Application Filed', 10),
    ],
    Indonesia: [
      r('OA Maintenance Reminder', 'Application Filed', 12, 'months', true, T_OA),
      r('OA Response Due', 'OA Issued', 15, 'days', true, T_OA),
      nonUse(5),
      ...renewal('Application Filed', 10),
    ],
    Lebanon: [
      r('Deadline to rejoin cassation action', 'Cassation filed', 2, 'months', true),
      ...renewal('Registration Date', 10),
    ],
    Macau: [...renewal('Registration Date', 7)],
    Malaysia: [
      r('Declaration of Ownership due', 'Application Filed', 1, 'years', true),
      ...renewal('Application Filed', 10),
    ],
    Mexico: [
      nonUse(3),
      ...renewal('Registration Date', 10, { remBefore: 12 }),
      // Declaration of Use, 3 months after the 3rd anniversary (= 39 months), reminder 1 year out.
      r('Mexico - 3 year DOU', 'Registration Date', 39, 'months', true),
      r('Mexico - 3 year DOU reminder', 'Mexico - 3 year DOU', -12, 'months', true),
      // Declaration of Use on the 10-year renewal, reminder 1 year out.
      r('Mexico - DOU on 10 year renewal', 'Registration Date', 10, 'years', true),
      r('Mexico - DOU on 10 year renewal reminder', 'Mexico - DOU on 10 year renewal', -12, 'months', true),
    ],
    // Myanmar: 3-year renewal cycle anchored on the Declaration of Ownership.
    Myanmar: [
      r('Renewal Deadline', 'Declaration of Ownership Registered', 3, 'years', true, T_REN),
      r('Renewal Reminder', 'Renewal Deadline', -6, 'months', true, T_REN),
      r('Renewal of Declaration of Ownership', 'Declaration of Ownership Registered', 3, 'years', true, '', 0, -1),
    ],
    Pakistan: [
      r('5 year use deadline', 'Application Filed', 5, 'years', true),
      ...renewal('Application Filed', 10),
    ],
    Peru: [nonUse(3), ...renewal('Registration Date', 10)],
    Philippines: [
      // Declaration of Actual Use schedule (from filing, then from registration).
      r('Philippines - DAU 3rd ann deadline', 'Application Filed', 3, 'years', true),
      r('Philippines - DAU reminder 3rd ann', 'Philippines - DAU 3rd ann deadline', -12, 'months', true),
      r('Philippines - DAU 5/6th ann deadline', 'Registration Date', 6, 'years', true),
      r('Philippines - DAU reminder 5/6th ann', 'Philippines - DAU 5/6th ann deadline', -12, 'months', true),
      ...renewal('Registration Date', 10),
      r('Philippines - Next Renewal Deadline', 'Renewal Deadline', 10, 'years', false),
      r('Philippines - Renewal Reminder', 'Philippines - Next Renewal Deadline', -12, 'months', true),
    ],
    Russia: [...renewal('Application Filed', 10)],
    // Renewal deadline is set manually (Hijri calendar); only the reminder computes.
    'Saudi Arabia': [
      r('Renewal Reminder', 'Renewal Deadline', -6, 'months', true, T_REN),
      r('Appeal deadline', 'Application refused', 30, 'days', true),
    ],
    'South Africa': [
      r('OA Response Due', 'OA Issued', 3, 'months', true, T_OA),
      ...renewal('Application Filed', 10),
    ],
    'South Korea': [nonUse(3), ...renewal('Registration Date', 10)],
    'Sri Lanka': [
      r('OA response lodged', 'OA Issued', 30, 'days', true, T_OA),
      ...renewal('Application Filed', 10),
    ],
    Taiwan: [
      r('OA Response Due', 'OA Issued', 30, 'days', true, T_OA),
      ...renewal('Registration Date', 10),
    ],
    Thailand: [...renewal('Application Filed', 10, { adj: -1 })],
    'Timor-Leste': [
      r('Renewal of Cautionary Notice Advertisement Due', 'Date Cautionary Notice Advertised', 2, 'years', true),
      r('Reminder re renewal of cautionary notice', 'Renewal of Cautionary Notice Advertisement Due', -6, 'months', true),
    ],
    UAE: [...renewal('Application Filed', 10)],
    Ukraine: [nonUse(5), ...renewal('Application Filed', 10)],
  };
  // Legacy jurisdiction names that differ from the app's canonical labels share
  // the same rules (imported cases may carry either spelling).
  rb['Republic of Korea'] = rb['South Korea'];
  rb['Union of Myanmar'] = rb['Myanmar'];
  rb['United Arab Emirates'] = rb['UAE'];
  rb['East Timor'] = rb['Timor-Leste'];
  return rb;
}

/**
 * Refresh a stored rulebook to the current built-in rules, preserving rules
 * the user added (`custom: true`). Returns the new rulesVersion.
 */
export function migrateRules(stored: RuleBook, storedVersion: number | undefined): { rules: RuleBook; rulesVersion: number } {
  if (storedVersion === RULES_VERSION) return { rules: stored, rulesVersion: RULES_VERSION };
  const fresh = defaultRules();
  const out: RuleBook = { ...stored };
  for (const jur of Object.keys(fresh)) {
    const custom = (stored[jur] || []).filter((x) => x.custom);
    out[jur] = fresh[jur].concat(custom);
  }
  return { rules: out, rulesVersion: RULES_VERSION };
}

/** Default opposition milestone master list (used by "Get Dates From Template"). */
export function defaultOppDatesMaster(): OppDateMaster[] {
  const od = (name: string, alerts: boolean, email: boolean, days = 0): OppDateMaster => ({ name, alerts, email, days });
  return [
    od('Status Check', true, true, 14),
    od('Notice of Opposition due', true, false, 15),
    od('Opposition filed', false, false, 0),
    od('Notice of Intention to Oppose', true, true, 15),
    od('Statement of Grounds and Particulars', true, true, 15),
    od('Notice of Intention to Defend', true, true, 15),
    od('Evidence in Support due', true, true, 30),
    od('Evidence in Answer due', true, true, 30),
    od('Evidence in Reply due', true, true, 30),
    od('Further Evidence filed', false, false, 0),
    od('Hearing date', false, false, 0),
    od('Appeal filed', false, false, 0),
    od('Appeal Deadline', true, false, 30),
    od('Opposition finalised', false, false, 0),
    od('Opposition withdrawn', false, false, 0),
    od('Opposition won', false, false, 0),
    od('Judicial Action due', true, false, 30),
    od('Judicial Action filed', true, false, 0),
  ];
}

/**
 * Per-jurisdiction opposition timelines. Verified against the IP offices
 * (2025-26); keep the notes/citations attached to the generated rows.
 */
export function oppSchedule(jurisdiction: string, kind = ''): OppSchedule | null {
  const jur = (jurisdiction || '').toLowerCase();
  // Australian non-use removal (s92): opposing the removal. Same offsets as a
  // standard opposition, but reversed party roles and its own anchor. The
  // registered owner opposes; the removal applicant defends.
  if (jur.includes('australia') && /non.?use|removal|s92|92/i.test(kind))
    return {
      anchor: 'Non-use removal application advertised',
      role: 'Non-use removal (s92) · opposing removal · from advertisement',
      steps: [
        { name: 'Notice of Intention to Oppose (removal) due', off: 2, unit: 'm', from: 'anchor', note: 'Registered owner · 2 months from advertisement of the removal application (reg 9.4, non-extendable)' },
        { name: 'Statement of Grounds & Particulars due', off: 1, unit: 'm', from: 'Notice of Intention to Oppose (removal) due', note: '1 month after the notice of intention to oppose' },
        { name: 'Notice of Intention to Defend (removal) due', off: 1, unit: 'm', from: 'Statement of Grounds & Particulars due', note: 'Removal applicant · 1 month from being given the SGP' },
        { name: 'Evidence in Support due', off: 3, unit: 'm', from: 'Notice of Intention to Defend (removal) due', note: 'Registered owner (onus to show use) · 3 months from the NID' },
        { name: 'Evidence in Answer due', off: 3, unit: 'm', from: 'Evidence in Support due', note: 'Removal applicant · 3 months' },
        { name: 'Evidence in Reply due', off: 2, unit: 'm', from: 'Evidence in Answer due', note: 'Registered owner · 2 months' },
      ],
    };
  if (jur.includes('australia'))
    return {
      anchor: 'Acceptance advertised',
      role: 'Pre-grant · from advertisement of acceptance',
      steps: [
        { name: 'Notice of Intention to Oppose due', off: 2, unit: 'm', from: 'anchor', note: '2 months from advertisement (non-extendable)' },
        { name: 'Statement of Grounds & Particulars due', off: 1, unit: 'm', from: 'Notice of Intention to Oppose due', note: '1 month after NIO' },
        { name: 'Notice of Intention to Defend due', off: 1, unit: 'm', from: 'Statement of Grounds & Particulars due', note: 'Applicant · 1 month from being given the SGP (reg 5.13). Madrid/IRDA holder: 2 months (reg 17A.34H)' },
        { name: 'Evidence in Support due', off: 3, unit: 'm', from: 'Notice of Intention to Defend due', note: 'Opponent · 3 months from the day the opponent is given a copy of the NID' },
        { name: 'Evidence in Answer due', off: 3, unit: 'm', from: 'Evidence in Support due', note: 'Applicant · 3 months from being given the complete Evidence in Support (or notice that none was filed)' },
        { name: 'Evidence in Reply due', off: 2, unit: 'm', from: 'Evidence in Answer due', note: 'Opponent · 2 months from being given the Evidence in Answer' },
      ],
    };
  if (jur.includes('new zealand'))
    return {
      anchor: 'Advertised in IPONZ Journal',
      role: 'Pre-grant · from advertisement',
      steps: [
        { name: 'Notice of Opposition due', off: 3, unit: 'm', from: 'anchor', note: '3 months from advertisement' },
        { name: 'Counterstatement due', off: 2, unit: 'm', from: 'Notice of Opposition due', note: 'Applicant · 2 months after NoO' },
        { name: 'Evidence in Support due', off: 2, unit: 'm', from: 'Counterstatement due', note: 'Opponent · 2 months after counterstatement' },
        { name: 'Evidence in Answer due', off: 2, unit: 'm', from: 'Evidence in Support due', note: 'Applicant · 2 months after Evidence in Support' },
        { name: 'Evidence in Reply due', off: 1, unit: 'm', from: 'Evidence in Answer due', note: 'Opponent · 1 month after Evidence in Answer' },
      ],
    };
  if (jur.includes('usa') || jur.includes('united states'))
    return {
      anchor: 'Published for opposition',
      role: 'Post-publication · TTAB',
      steps: [
        { name: 'Notice of Opposition due', off: 30, unit: 'd', from: 'anchor', note: '30 days from publication. Extensions (+30, then +60/+90; max 180 days) are added manually as needed' },
        { name: 'Answer due', off: 60, unit: 'd', from: 'Notice of Opposition due', note: 'Applicant · 60 days from institution order (TTAB rule, from 4 Sep 2025)' },
      ],
    };
  if (jur.includes('united kingdom') || jur === 'uk')
    return {
      anchor: 'Published for opposition',
      role: 'From publication',
      steps: [
        { name: 'Notice of Opposition (TM7) due', off: 2, unit: 'm', from: 'anchor', note: '2 months from publication (extend to 3 months via TM7A Notice of Threatened Opposition)' },
        { name: 'Counterstatement (TM8) due', off: 2, unit: 'm', from: 'Notice of Opposition (TM7) due', note: 'Applicant · 2 months from notification' },
        { name: 'Cooling-off period ends (if entered)', off: 9, unit: 'm', from: 'Notice of Opposition (TM7) due', note: 'Optional · joint cooling-off (TM9) extends the TM8 deadline to 9 months from notification; extendable further by agreement' },
        { name: 'Opponent evidence due', off: 2, unit: 'm', from: 'Counterstatement (TM8) due', note: 'Opponent · 2 months' },
        { name: 'Applicant evidence due', off: 2, unit: 'm', from: 'Opponent evidence due', note: 'Applicant · 2 months' },
        { name: 'Evidence in reply due', off: 2, unit: 'm', from: 'Applicant evidence due', note: 'Opponent · 2 months' },
      ],
    };
  if (jur.includes('european union') || jur.includes('eutm') || jur.includes('eu'))
    return {
      anchor: 'Published for opposition',
      role: 'EUIPO · from publication',
      steps: [
        { name: 'Notice of Opposition due', off: 3, unit: 'm', from: 'anchor', note: '3 months from publication (non-extendable)' },
        { name: 'Cooling-off ends', off: 2, unit: 'm', from: 'Notice of Opposition due', note: '2 months from notification (extendable +22 months by joint request)' },
        { name: 'Opponent substantiation / evidence due', off: 2, unit: 'm', from: 'Cooling-off ends', note: 'Opponent · 2 months after cooling-off' },
        { name: 'Applicant response due', off: 2, unit: 'm', from: 'Opponent substantiation / evidence due', note: 'Applicant · 2 months' },
      ],
    };
  if (jur.includes('turkey') || jur.includes('türk'))
    return {
      anchor: 'Published in Official Bulletin',
      role: 'TÜRKPATENT · from publication',
      steps: [
        { name: 'Opposition due', off: 2, unit: 'm', from: 'anchor', note: '2 months from publication (non-extendable)' },
        { name: 'Applicant response due', off: 1, unit: 'm', from: 'Opposition due', note: 'Applicant · 1 month from notification' },
        { name: 'Evidence of use due (if requested)', off: 2, unit: 'm', from: 'Opposition due', note: 'Opponent · 2 months from notification, where proof of use is requested' },
      ],
    };
  if (jur.includes('japan'))
    return {
      anchor: 'Registration published in Gazette',
      role: 'JPO · post-registration (ex parte)',
      steps: [
        { name: 'Opposition due', off: 2, unit: 'm', from: 'anchor', note: '2 months from publication of registration (non-extendable)' },
        { name: 'Statement of grounds due', off: 30, unit: 'd', from: 'Opposition due', note: 'Grounds within 30 days of opposition (foreign opponents: +60 days on request)' },
      ],
    };
  // ---- Additional major jurisdictions. Initial opposition periods and the main
  // subsequent steps were checked against the IP offices in 2026 (CIPO, CNIPA,
  // IPOS, DPMA, India TMR, IMPI, KIPO, INPI). Extensions and case-managed evidence
  // deadlines vary — each generated row remains editable per matter.
  if (jur.includes('canada'))
    return {
      anchor: 'Advertised in Trademarks Journal',
      role: 'CIPO · from advertisement',
      steps: [
        { name: 'Statement of Opposition due', off: 2, unit: 'm', from: 'anchor', note: '2 months from advertisement (extendable, cooling-off available)' },
        { name: 'Counter Statement due', off: 2, unit: 'm', from: 'Statement of Opposition due', note: 'Applicant · 2 months from being served' },
        { name: 'Opponent’s evidence due', off: 4, unit: 'm', from: 'Counter Statement due', note: 'Opponent · 4 months' },
        { name: 'Applicant’s evidence due', off: 4, unit: 'm', from: 'Opponent’s evidence due', note: 'Applicant · 4 months' },
        { name: 'Reply evidence due', off: 1, unit: 'm', from: 'Applicant’s evidence due', note: 'Opponent · 1 month' },
      ],
    };
  if (jur.includes('china'))
    return {
      anchor: 'Preliminary approval published',
      role: 'CNIPA · post-publication, pre-registration',
      steps: [
        { name: 'Opposition due', off: 3, unit: 'm', from: 'anchor', note: '3 months from publication (non-extendable)' },
        { name: 'Applicant response / evidence due', off: 30, unit: 'd', from: 'Opposition due', note: 'Applicant · 30 days from notification (evidence supplement +3 months)' },
      ],
    };
  if (jur.includes('singapore'))
    return {
      anchor: 'Published for opposition',
      role: 'IPOS · from publication',
      steps: [
        { name: 'Notice of Opposition due', off: 2, unit: 'm', from: 'anchor', note: '2 months from publication (extendable)' },
        { name: 'Counter-Statement due', off: 2, unit: 'm', from: 'Notice of Opposition due', note: 'Applicant · 2 months' },
        { name: 'Opponent’s evidence due', off: 2, unit: 'm', from: 'Counter-Statement due', note: 'Opponent · 2 months' },
        { name: 'Applicant’s evidence due', off: 3, unit: 'm', from: 'Opponent’s evidence due', note: 'Applicant · 3 months' },
        { name: 'Reply evidence due', off: 3, unit: 'm', from: 'Applicant’s evidence due', note: 'Opponent · 3 months' },
      ],
    };
  if (jur.includes('germany') || jur === 'de')
    return {
      anchor: 'Registration published',
      role: 'DPMA · post-registration',
      steps: [
        { name: 'Opposition due', off: 3, unit: 'm', from: 'anchor', note: '3 months from publication of registration (non-extendable)' },
      ],
    };
  if (jur.includes('india'))
    return {
      anchor: 'Advertised in Trade Marks Journal',
      role: 'India TMR · from advertisement',
      steps: [
        { name: 'Notice of Opposition due', off: 4, unit: 'm', from: 'anchor', note: '4 months from advertisement (non-extendable)' },
        { name: 'Counter-Statement due', off: 2, unit: 'm', from: 'Notice of Opposition due', note: 'Applicant · 2 months from being served (non-extendable)' },
        { name: 'Opponent’s evidence (Rule 45) due', off: 2, unit: 'm', from: 'Counter-Statement due', note: 'Opponent · 2 months' },
        { name: 'Applicant’s evidence (Rule 46) due', off: 2, unit: 'm', from: 'Opponent’s evidence (Rule 45) due', note: 'Applicant · 2 months' },
        { name: 'Reply evidence (Rule 47) due', off: 1, unit: 'm', from: 'Applicant’s evidence (Rule 46) due', note: 'Opponent · 1 month' },
      ],
    };
  if (jur.includes('mexico'))
    return {
      anchor: 'Published in Official Gazette',
      role: 'IMPI · from publication',
      steps: [
        { name: 'Opposition due', off: 1, unit: 'm', from: 'anchor', note: '1 month from publication (non-extendable)' },
        { name: 'Applicant response due', off: 2, unit: 'm', from: 'Opposition due', note: 'Applicant · 2 months, automatically extendable by a further 2 months' },
      ],
    };
  if (jur.includes('korea'))
    return {
      anchor: 'Published for opposition',
      role: 'KIPO · post-publication, pre-registration',
      steps: [
        { name: 'Opposition due', off: 30, unit: 'd', from: 'anchor', note: '30 days from publication — reduced from 2 months, effective 22 July 2025 (non-extendable)' },
        { name: 'Statement of grounds / evidence due', off: 30, unit: 'd', from: 'Opposition due', note: 'Opponent may supplement the grounds within a further 30 days' },
      ],
    };
  if (jur.includes('brazil'))
    return {
      anchor: 'Published in RPI',
      role: 'INPI · from publication',
      steps: [
        { name: 'Opposition due', off: 60, unit: 'd', from: 'anchor', note: '60 days from publication' },
        { name: 'Applicant response due', off: 60, unit: 'd', from: 'Opposition due', note: 'Applicant · 60 days from notice of opposition' },
      ],
    };
  // Generic fallback so "Get dates from template" produces a usable, anchor-based
  // timeline for every jurisdiction. Periods are indicative only — opposition
  // windows vary widely (30 days to 4 months; pre- vs post-grant) — so verify the
  // local statutory periods and adjust each row.
  return {
    anchor: 'Publication / advertisement date',
    role: 'Generic timeline — no jurisdiction-specific schedule; verify local statutory periods',
    verified: false,
    steps: [
      { name: 'Opposition / Notice of Opposition due', off: 3, unit: 'm', from: 'anchor', note: 'Indicative — many offices allow 1–4 months from publication. Confirm locally.' },
      { name: 'Applicant response / Counter-statement due', off: 2, unit: 'm', from: 'Opposition / Notice of Opposition due', note: 'Indicative — confirm locally.' },
      { name: 'Opponent’s evidence due', off: 2, unit: 'm', from: 'Applicant response / Counter-statement due', note: 'Indicative — confirm locally.' },
      { name: 'Applicant’s evidence due', off: 2, unit: 'm', from: 'Opponent’s evidence due', note: 'Indicative — confirm locally.' },
      { name: 'Reply evidence due', off: 1, unit: 'm', from: 'Applicant’s evidence due', note: 'Indicative — confirm locally.' },
    ],
  };
}

/** IP offices first, then every country — backs the jurisdiction combobox. */
export function jurList(): string[] {
  return ['Australia', 'New Zealand', 'USA', 'United Kingdom', 'European Union (EUTM)', 'Madrid Protocol (WIPO)', 'Canada', 'China', 'Japan', 'Singapore', 'Afghanistan', 'Albania', 'Algeria', 'Argentina', 'Armenia', 'Austria', 'Azerbaijan', 'Bahrain', 'Bangladesh', 'Belarus', 'Belgium', 'Benelux', 'Bhutan', 'Bolivia', 'Bosnia & Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Cambodia', 'Chile', 'Colombia', 'Costa Rica', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic', 'Denmark', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Estonia', 'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Guatemala', 'Honduras', 'Hong Kong', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Jamaica', 'Jordan', 'Kazakhstan', 'Kenya', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Macau', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Malta', 'Mauritius', 'Mexico', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar', 'Namibia', 'Nepal', 'Netherlands', 'Nicaragua', 'Nigeria', 'North Macedonia', 'Norway', 'OAPI (African Union)', 'Oman', 'Pakistan', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda', 'Samoa', 'San Marino', 'Saudi Arabia', 'Serbia', 'Seychelles', 'Sierra Leone', 'Slovakia', 'Slovenia', 'South Africa', 'South Korea', 'Spain', 'Sri Lanka', 'Sudan', 'Sweden', 'Switzerland', 'Syria', 'Taiwan', 'Tajikistan', 'Tanzania', 'Thailand', 'Tonga', 'Trinidad & Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'UAE', 'Uganda', 'Ukraine', 'Uruguay', 'Uzbekistan', 'Vanuatu', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe'];
}

export function allJurisdictions(): string[] {
  const all = jurList().slice();
  const extra = ['Andorra', 'Angola', 'Antigua & Barbuda', 'Bahamas', 'Barbados', 'Belize', 'Burkina Faso', 'Burundi', 'Cameroon', 'Cape Verde', 'Central African Republic', 'Chad', 'Comoros', 'Congo (Brazzaville)', 'Congo (DRC)', 'Cook Islands', 'Ivory Coast', 'Djibouti', 'Dominica', 'Equatorial Guinea', 'Eritrea', 'Gabon', 'Gambia', 'Grenada', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Kiribati', 'Kosovo', 'Lesotho', 'Liberia', 'Libya', 'Mali', 'Marshall Islands', 'Mauritania', 'Micronesia', 'Nauru', 'Niger', 'North Korea', 'Palau', 'Palestine', 'Saint Kitts & Nevis', 'Saint Lucia', 'Saint Vincent & the Grenadines', 'Sao Tome & Principe', 'Senegal', 'Solomon Islands', 'Somalia', 'South Sudan', 'Suriname', 'Timor-Leste', 'Togo', 'Tuvalu', 'Vatican City'];
  return all.concat(extra.filter((c) => !all.includes(c)));
}

export function madridMembers(): string[] {
  return ['Afghanistan', 'Albania', 'Algeria', 'Antigua and Barbuda', 'Armenia', 'Australia', 'Austria', 'Azerbaijan', 'Bahrain', 'Belarus', 'Belgium', 'Belize', 'Bhutan', 'Bosnia & Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Cambodia', 'Canada', 'Chile', 'China', 'Colombia', 'Croatia', 'Cuba', 'Cyprus', 'Czech Republic', 'Denmark', 'Egypt', 'Estonia', 'European Union (EUTM)', 'Finland', 'France', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Hungary', 'Iceland', 'India', 'Indonesia', 'Iran', 'Ireland', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Kazakhstan', 'Kenya', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lesotho', 'Liberia', 'Liechtenstein', 'Lithuania', 'Luxembourg', 'Madagascar', 'Malawi', 'Malaysia', 'Mexico', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Namibia', 'Netherlands', 'New Zealand', 'North Korea', 'North Macedonia', 'Norway', 'Oman', 'Pakistan', 'Philippines', 'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda', 'Samoa', 'San Marino', 'Sao Tome and Principe', 'Serbia', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'South Korea', 'Spain', 'Sudan', 'Sweden', 'Switzerland', 'Syria', 'Tajikistan', 'Thailand', 'Trinidad and Tobago', 'Tunisia', 'Turkey', 'Turkmenistan', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'USA', 'Uzbekistan', 'Vietnam', 'Zambia', 'Zimbabwe'];
}

/** Country-aware address field labels. */
export function addrSchema(country: string): { city: string; state: string; zip: string } {
  const schemas: Record<string, { city: string; state: string; zip: string }> = {
    Australia: { city: 'Suburb', state: 'State', zip: 'Postcode' },
    'New Zealand': { city: 'Suburb', state: 'City', zip: 'Postcode' },
    USA: { city: 'City', state: 'State', zip: 'ZIP code' },
    'United Kingdom': { city: 'Town / City', state: 'County', zip: 'Postcode' },
    Canada: { city: 'City', state: 'Province', zip: 'Postal code' },
    Singapore: { city: 'City', state: '', zip: 'Postal code' },
    China: { city: 'City', state: 'Province', zip: 'Postcode' },
    Japan: { city: 'City / Ward', state: 'Prefecture', zip: 'Postal code' },
    Philippines: { city: 'City / Municipality', state: 'Province', zip: 'ZIP code' },
    Mexico: { city: 'City', state: 'State', zip: 'Postal code' },
    India: { city: 'City', state: 'State', zip: 'PIN code' },
    'European Union (EUTM)': { city: 'City', state: 'Region', zip: 'Postal code' },
  };
  return schemas[country] || { city: 'City', state: 'State / Region', zip: 'Postal / ZIP code' };
}
