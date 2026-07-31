/** Shared domain types for the BrandU trade mark database. */

export type DateUnit = 'days' | 'months' | 'years' | 'business days';

export type MarkType =
  | 'Word'
  | 'Logo'
  | 'Combined'
  | '3D Shape'
  | 'Series'
  | 'Sound'
  | 'Scent'
  | 'Movement'
  | 'Colour'
  | 'Stylised';

/** A deadline / date row on a trade mark case. */
export interface MarkDate {
  name: string;
  /** ISO yyyy-mm-dd. Stored ISO, always rendered DD MMM YYYY. */
  date: string;
  done: boolean;
  /** True for auto-generated reminder rows. */
  reminder?: boolean;
  note?: string;
  /** Name of the date row this one is computed from (rule trigger). */
  auBase?: string;
  auOff?: number;
  auUnit?: DateUnit;
  /** Monthly reminder count attached to the rule. */
  auRem?: number;
  /**
   * Completed renewal cycles. A renewal deadline computes as base + (auCycle+1)
   * × offset, so ticking the current renewal off rolls it forward to the next
   * period (e.g. +10 years) with fresh reminders. 0/undefined for every other row.
   */
  auCycle?: number;
  /**
   * A manually-set date (e.g. an imported renewal) that the engine must not
   * recompute from its base. Reminders still generate from it, and a completed
   * renewal still rolls forward.
   */
  pinned?: boolean;
  /** Row was auto-generated (reminders) — safe to delete/recompute. */
  auGen?: boolean;
  /** Row is a manual input date seeded by a status stage. */
  auInput?: boolean;
  auAlert?: boolean;
  /** For reminder rows: the deadline they remind about (email template lookup). */
  emailFor?: string;
  /** Madrid designation: renewal copied from the parent IR, not computed. */
  linkedToIR?: boolean;
  /** Staff member who added this date (for alert attribution / notification). */
  createdBy?: string;
  /** Notify the owner when this date is due (staff alert email opt-in). */
  notify?: boolean;
}

export interface MarkContact {
  name: string;
  company: string;
  position: string;
  phone: string;
  email: string;
}

export interface MarkAction {
  date: string;
  text: string;
  done: boolean;
  alert?: boolean;
  alertDate?: string;
  /** Staff member who added this action (for alert attribution / notification). */
  createdBy?: string;
  /** Staff member the action is assigned to — receives its alert / digest and
   * sees it under "my cases" on the dashboard. Falls back to createdBy. */
  assignee?: string;
}

export interface MarkDoc {
  desc: string;
  link: string;
  fileName?: string;
  /** URL of the uploaded file on the server (object storage in production). */
  fileUrl?: string;
}

export interface SeriesEntry {
  text: string;
}

export interface Mark {
  id: string;
  name: string;
  jurisdiction: string;
  application: string;
  registration: string;
  status: string;
  owner: string;
  ownerType?: 'Company' | 'Individual';
  ownerFirst?: string;
  ownerMiddle?: string;
  ownerLast?: string;
  /** Owner's Australian Business Number (from the IP Australia register). */
  ownerAbn?: string;
  /** Owner's ACN / ARBN (from the IP Australia register). */
  ownerAcn?: string;
  filingBasis: string;
  type: MarkType | string;
  wordText?: string;
  seriesEntries?: SeriesEntry[];
  soundDescription?: string;
  description?: string;
  classes: string;
  regType: string;
  address1?: string;
  address2?: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
  matter: string;
  /** Associates file ref. */
  associateRef?: string;
  ourDocket: string;
  clientDocket: string;
  /** Responsible attorney / fee earner (drives "my portfolio" and workload). */
  attorney?: string;
  /** Foreign associate / agent handling the case. */
  associate?: string;
  /** Free-form tags/labels for flexible grouping and filtering. */
  tags?: string[];
  /** Estimated renewal fee (for upcoming-cost totals). */
  renewalFee?: number;
  goods: string;
  comments: string;
  disclaimers: string;
  dates: MarkDate[];
  /**
   * Names of rule-driven date rows the user has explicitly deleted. The engine
   * will not recreate a row whose name appears here, so a manual delete sticks.
   * Re-adding a date with the same name clears it from this list.
   */
  suppressedRules?: string[];
  actions: MarkAction[];
  contacts: MarkContact[];
  docs: MarkDoc[];
  /** Image URL (logo/combined marks) — object storage in production. */
  image: string | null;
  audioUrl?: string;
  /** Madrid family id shared by basic case, IR and designations. */
  madridId?: string;
  /** On an IR: the id of the basic AU/NZ application it was created from. */
  basicId?: string;
  /** On a designation: the id of its parent International Registration. */
  irId?: string;
  /** International Registration number (Madrid Protocol), when this case is a designation. */
  irNumber?: string;
  treaty?: { basis: string; date: string; desigs: unknown[] };
  madridCopy?: { classes: boolean; goods: boolean; disclaimers: boolean; contacts: boolean };
  promptEmail?: boolean;
}

export interface Rule {
  name: string;
  trigger: string;
  v: number;
  u: DateUnit;
  alerts: boolean;
  template: string;
  rem?: number;
  /** User-added — preserved across rulesVersion migrations. */
  custom?: boolean;
}

export type RuleBook = Record<string, Rule[]>;

export interface OppositionMarkRef {
  name: string;
  application: string;
  registration: string;
}

export interface OppositionDate {
  date: string;
  name: string;
  note: string;
  done: boolean;
  email: boolean;
  suspend: boolean;
}

export interface OppositionContact {
  name: string;
  company?: string;
  position?: string;
  role?: string;
  firstName?: string;
  lastName?: string;
  phone: string;
  email: string;
  alerts?: boolean;
}

export interface Opposition {
  id: string;
  name: string;
  client: string;
  opponent: string;
  proceeding: string;
  jurisdiction: string;
  /** Proceeding type — 'Opposition' (default) or 'Non-use removal'. Selects which
   * date template "Get dates from template" applies. */
  kind?: string;
  status: string;
  /** true = client is Plaintiff (opposing), false = Defendant (defending). */
  clientIsPlaintiff: boolean;
  notes: string;
  showInAlerts?: boolean;
  clientMarks: OppositionMarkRef[];
  oppMarks: OppositionMarkRef[];
  dates: OppositionDate[];
  contacts: OppositionContact[];
}

export interface CompanyContact {
  salutation?: string;
  first?: string;
  middle?: string;
  last?: string;
  name?: string;
  title?: string;
  greeting?: string;
  position?: string;
  allTrademarks?: boolean;
  allPatents?: boolean;
  address1?: string;
  address2?: string;
  city?: string;
  state?: string;
  zip?: string;
  country?: string;
  phone?: string;
  email?: string;
}

export interface Partner {
  name: string;
  email: string;
}

/** Role/category of a contact record (independent of the structural type). */
export const CONTACT_TYPES = [
  'Applicant', 'Owner', 'Client', 'Associate / Foreign agent', 'Opponent',
  'Licensee', 'Instructing firm', 'Inventor', 'Individual', 'Company', 'Other',
] as const;

export interface Company {
  id: string;
  type: 'Company' | 'Individual' | 'Partnership';
  /** Role/category (Applicant, Owner, Associate, Opponent, …). */
  contactType?: string;
  name: string;
  first?: string;
  last?: string;
  partners?: Partner[];
  address: string;
  address2: string;
  city: string;
  state: string;
  zip: string;
  country: string;
  phone: string;
  email: string;
  notes: string;
  contacts?: CompanyContact[];
}

export interface OppDateMaster {
  name: string;
  alerts: boolean;
  email: boolean;
  days: number;
}

export type StaffLevel = 'Full Permissions' | 'Edit Only' | 'View and Print Only' | 'No Access';

export interface StaffUser {
  id: string;
  name: string;
  level: StaffLevel;
}

export interface EmailTemplate {
  id: string;
  ref: string;
  jurisdiction: string;
  category: string;
  stage: string;
  dateField: string;
  subject: string;
  body: string;
}

export interface FirmSettings {
  lawFirmName: string;
  firmContactEmail: string;
  documentsFolder: string;
  /** Logo shown on report headers (data URL or uploaded file URL). */
  logo: string;
  /** Signature block appended to client emails via the [Signature] merge field. */
  emailSignature?: string;
}

export interface AlertRow {
  date: string;
  kind: 'Action' | 'Deadline' | 'Client reminder' | 'Opposition';
  refType: 'mark' | 'opposition';
  refId: string;
  mark: string;
  jur: string;
  text: string;
  overdue?: boolean;
  /** Staff member the underlying date/action is attributed to, if any. */
  owner?: string;
}

export interface OppScheduleStep {
  name: string;
  off: number;
  unit: 'd' | 'm';
  from: string; // 'anchor' or a prior step name
  note: string;
}

export interface OppSchedule {
  anchor: string;
  role: string;
  steps: OppScheduleStep[];
  /** false = generic fallback (no jurisdiction-specific schedule); verify locally. */
  verified?: boolean;
}
