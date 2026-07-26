import type { OppDateMaster, OppSchedule, Rule, RuleBook } from './types.js';

/**
 * The statutory date rulebook. Statutory periods below were reviewed with the
 * client and cited to specific regulations where noted — preserve them exactly
 * and keep the citations (see also oppSchedule()).
 *
 * If any built-in rule changes, bump RULES_VERSION and let migrateRules()
 * refresh stored rulebooks (user rules flagged `custom: true` survive).
 */
export const RULES_VERSION = 10;

const T_REN =
  'Dear {{client}},\n\nRe: Trade mark {{mark}} ({{jurisdiction}})\n\nThis is a reminder that the renewal deadline for the above trade mark is {{deadline}}. Please confirm whether you would like us to attend to the renewal, and we will provide a cost estimate.\n\nKind regards\nBrandU Legal';
const T_OA =
  'Dear {{client}},\n\nRe: Trade mark {{mark}} ({{jurisdiction}})\n\nAn examination report has issued for the above application. A response is due by {{deadline}}. We will review the report and revert with our recommendations.\n\nKind regards\nBrandU Legal';

const r = (
  name: string,
  trigger: string,
  v: number,
  u: Rule['u'],
  alerts: boolean,
  template = '',
  rem = 0
): Rule => ({ name, trigger, v, u, alerts, template, rem });

/**
 * Standard renewal chain: deadline at +years from the anchor trigger, client
 * reminders at −6 months / −2 months (Final) / −1 week, and the 6-month grace
 * period after the deadline.
 */
// The engine adds a "— 1 Week Reminder" to every alerting deadline automatically,
// so the chains below only carry the longer-lead client reminders.
const renewalChain = (regTrigger: string, years: number): Rule[] => [
  r('Renewal Deadline', regTrigger, years, 'years', true, T_REN),
  r('Renewal Reminder', 'Renewal Deadline', -6, 'months', true, T_REN),
  r('Renewal Reminder - Final', 'Renewal Deadline', -2, 'months', true, T_REN),
  r('6 Month Renewal Grace Period', 'Renewal Deadline', 6, 'months', false),
];

/**
 * Built-in rules, version RULES_VERSION.
 *
 * Verified renewal anchors: AU/NZ/UK/EU/Singapore renew 10 years from FILING;
 * USA / Madrid / Canada / China / Japan renew 10 years from REGISTRATION.
 * Convention priority: 6 months from the earliest priority date.
 * AU examination: Acceptance Deadline = 15 months from date of first report.
 * US office action: response due 6 months from issue.
 * AU opposition period: 2 months from advertisement/publication.
 * Non-use vulnerability: AU/NZ/US/CA/CN/JP 3 years; UK/EU/SG 5 years.
 */
export function defaultRules(): RuleBook {
  return {
    _default: [
      r('Convention Priority Deadline', 'Application Filed', 6, 'months', true, '', 3),
      r('OA Response Due', 'OA Issued', 2, 'months', true, T_OA),
      r('OA Response - Instructions Reminder', 'OA Response Due', -1, 'months', true, T_OA),
      r('Opposition response due', 'Opposition filed', 2, 'months', true),
      ...renewalChain('Registration Date', 10),
    ],
    Australia: [
      r('Convention Priority Deadline', 'Application Filed', 6, 'months', true, '', 3),
      // Single acceptance deadline replaces a separate "OA response due":
      // 15 months from the date of the first report. A 6-month extension (no
      // statutory declaration) exists but is added manually when needed.
      r('Acceptance Deadline', 'OA Issued', 15, 'months', true, T_OA),
      // Chase the client for instructions well before the acceptance deadline
      // (plus the automatic 1-week reminder the engine adds).
      r('Acceptance Deadline - Instructions Reminder', 'Acceptance Deadline', -3, 'months', true, T_OA),
      r('Acceptance Deadline - Final Reminder', 'Acceptance Deadline', -1, 'months', true, T_OA),
      r('Opposition period expires', 'Publication Date', 2, 'months', true),
      r('Non-use vulnerability date', 'Registration Date', 3, 'years', true),
      r('Renewal Deadline', 'Application Filed', 10, 'years', true, T_REN),
      r('Renewal Reminder', 'Renewal Deadline', -6, 'months', true, T_REN),
      r('Renewal Reminder - Second', 'Renewal Deadline', -3, 'months', true, T_REN),
      r('Renewal Reminder - Final', 'Renewal Deadline', -1, 'months', true, T_REN),
      r('6 Month Renewal Grace Period', 'Renewal Deadline', 6, 'months', false),
    ],
    'New Zealand': [
      r('Convention Priority Deadline', 'Application Filed', 6, 'months', true, '', 3),
      r('Compliance Deadline', 'OA Issued', 12, 'months', true, T_OA),
      r('Opposition period expires', 'Publication Date', 3, 'months', true),
      r('Non-use vulnerability date', 'Registration Date', 3, 'years', true),
      ...renewalChain('Application Filed', 10),
    ],
    USA: [
      r('Convention Priority Deadline', 'Application Filed', 6, 'months', true, '', 3),
      r('OA Response Due', 'OA Issued', 6, 'months', true, T_OA),
      r('OA Response - Instructions Reminder', 'OA Response Due', -2, 'months', true, T_OA),
      r('Statement of Use Due', 'Notice of Allowance', 6, 'months', true),
      r('Opposition period expires', 'Publication Date', 30, 'days', true),
      r('Non-use vulnerability date', 'Registration Date', 3, 'years', true),
      // §8 Declaration of Use — 5th–6th year window; grace to 6.5 years.
      // First client reminder one year out, then six months, then the automatic
      // 1-week reminder the engine adds.
      r('§8 Declaration of Use (5th–6th year)', 'Registration Date', 6, 'years', true, T_REN),
      r('§8 Declaration - 1 Year Reminder', '§8 Declaration of Use (5th–6th year)', -12, 'months', true, T_REN),
      r('§8 Declaration - 6 Month Reminder', '§8 Declaration of Use (5th–6th year)', -6, 'months', true, T_REN),
      r('6 Month §8 Grace Period', '§8 Declaration of Use (5th–6th year)', 6, 'months', false),
      // §8 & §9 combined Declaration + Renewal — 9th–10th year, then every 10 years.
      // This is the US renewal; the standard renewal chain provides the ongoing
      // 10-year cycle and its reminders, and we add the one-year lead reminder.
      r('§8 & §9 Declaration + Renewal (9th–10th year)', 'Renewal Deadline', 0, 'days', true, T_REN),
      r('Renewal Reminder - 1 Year', 'Renewal Deadline', -12, 'months', true, T_REN),
      ...renewalChain('Registration Date', 10),
    ],
    'United Kingdom': [
      r('Convention Priority Deadline', 'Application Filed', 6, 'months', true, '', 3),
      r('OA Response Due', 'OA Issued', 2, 'months', true, T_OA),
      r('Opposition period expires', 'Publication Date', 2, 'months', true),
      r('Non-use vulnerability date', 'Registration Date', 5, 'years', true),
      ...renewalChain('Application Filed', 10),
    ],
    'European Union (EUTM)': [
      r('Convention Priority Deadline', 'Application Filed', 6, 'months', true, '', 3),
      r('OA Response Due', 'OA Issued', 2, 'months', true, T_OA),
      r('Opposition period expires', 'Publication Date', 3, 'months', true),
      r('Non-use vulnerability date', 'Registration Date', 5, 'years', true),
      ...renewalChain('Application Filed', 10),
    ],
    'Madrid Protocol (WIPO)': [
      // The IR renews 10 years from the international registration (filing)
      // date, and the dependency / central-attack window runs 5 years from the
      // same date — both anchored on the IR's Application Filed, not a later
      // registration date. Designations inherit the IR renewal date.
      r('Dependency Period Ends', 'Application Filed', 5, 'years', true),
      r('Irregularities notice response due', 'Irregularities Notice Issued', 3, 'months', true),
      // NB: country-specific obligations (e.g. the Philippines Declaration of
      // Actual Use) belong on the individual designation case, whose jurisdiction
      // is that country — not on the Madrid IR itself.
      ...renewalChain('Application Filed', 10),
    ],
    Canada: [
      r('OA Response Due', 'OA Issued', 6, 'months', true, T_OA),
      r('Opposition period expires', 'Publication Date', 2, 'months', true),
      r('Non-use vulnerability date', 'Registration Date', 3, 'years', true),
      ...renewalChain('Registration Date', 10),
    ],
    China: [
      r('Review of Refusal Deadline', 'OA Issued', 15, 'days', true, T_OA),
      r('Opposition period expires', 'Publication Date', 3, 'months', true),
      r('Non-use vulnerability date', 'Registration Date', 3, 'years', true),
      ...renewalChain('Registration Date', 10),
    ],
    Japan: [
      r('OA Response Due', 'OA Issued', 3, 'months', true, T_OA),
      r('Opposition period expires', 'Publication Date', 2, 'months', true),
      r('Non-use vulnerability date', 'Registration Date', 3, 'years', true),
      ...renewalChain('Registration Date', 10),
    ],
    Singapore: [
      r('OA Response Due', 'OA Issued', 4, 'months', true, T_OA),
      r('Opposition period expires', 'Publication Date', 2, 'months', true),
      r('Non-use vulnerability date', 'Registration Date', 5, 'years', true),
      ...renewalChain('Application Filed', 10),
    ],
    Philippines: [
      // Declaration of Actual Use: 3rd anniversary of the filing / designation
      // date. (The DAU within 1 year of each renewal can be added later.)
      r('Philippines DAU deadline (3 years from filing)', 'Application Filed', 3, 'years', true, '', 3),
      ...renewalChain('Registration Date', 10),
    ],
    Mexico: [
      // Declaration of Use (Declaración de Uso). A registrant must declare actual
      // and effective use within the 3 months FOLLOWING the 3rd anniversary of the
      // Mexican registration. The window opens at +3 years and the deadline falls
      // at +3 years +3 months; a further 3-month grace (with surcharge) follows.
      //
      // Anchor = the Mexican registration / grant-of-protection date. For a Madrid
      // designation of Mexico this is the DESIGNATION's own Registration Date (the
      // date IMPI grants protection), NOT the international registration date — so
      // the 3-year declaration is standalone to the Mexican case, national or IR.
      r('Mexico Declaration of Use window opens (3rd anniversary)', 'Registration Date', 3, 'years', false),
      r('Mexico Declaration of Use deadline', 'Mexico Declaration of Use window opens (3rd anniversary)', 3, 'months', true, '', 2),
      r('Mexico DoU grace period (with surcharge)', 'Mexico Declaration of Use deadline', 3, 'months', false),
      // A declaration of use must also accompany each renewal. For a Madrid
      // designation the renewal date is inherited from the parent IR, so this
      // (anchored on Renewal Deadline) correctly follows the Madrid case.
      r('Mexico Declaration of Use (with renewal)', 'Renewal Deadline', 0, 'days', true, '', 2),
      ...renewalChain('Registration Date', 10),
    ],
  };
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
export function oppSchedule(jurisdiction: string): OppSchedule | null {
  const jur = (jurisdiction || '').toLowerCase();
  if (jur.includes('australia'))
    return {
      anchor: 'Acceptance advertised',
      role: 'Pre-grant · from advertisement of acceptance',
      steps: [
        { name: 'Notice of Intention to Oppose due', off: 2, unit: 'm', from: 'anchor', note: '2 months from advertisement (non-extendable)' },
        { name: 'Statement of Grounds & Particulars due', off: 1, unit: 'm', from: 'Notice of Intention to Oppose due', note: '1 month after NIO' },
        { name: 'Notice of Intention to Defend due', off: 2, unit: 'm', from: 'Statement of Grounds & Particulars due', note: 'Applicant · 2 months from being given the SGP (reg 5.13; IRDA holder: 2 months from Registrar notifying the International Bureau, reg 17A.34H)' },
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
  // ---- Additional major jurisdictions (first-pass defaults — please verify the
  // statutory periods for the specific matter; each generated row is editable).
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
        { name: 'Opposition due', off: 1, unit: 'm', from: 'anchor', note: '1 month from publication' },
        { name: 'Applicant response due', off: 1, unit: 'm', from: 'Opposition due', note: 'Applicant · 1 month' },
      ],
    };
  if (jur.includes('korea'))
    return {
      anchor: 'Published for opposition',
      role: 'KIPO · post-publication, pre-registration',
      steps: [
        { name: 'Opposition due', off: 2, unit: 'm', from: 'anchor', note: '2 months from publication (non-extendable)' },
        { name: 'Statement of grounds / evidence due', off: 30, unit: 'd', from: 'Opposition due', note: 'Grounds may be supplemented within 30 days' },
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
  return null;
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
