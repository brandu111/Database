/** Shared domain types for the BrandU trade mark database. */

export type DateUnit = 'days' | 'months' | 'years';

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
  /** Row was auto-generated (reminders) — safe to delete/recompute. */
  auGen?: boolean;
  /** Row is a manual input date seeded by a status stage. */
  auInput?: boolean;
  auAlert?: boolean;
  /** For reminder rows: the deadline they remind about (email template lookup). */
  emailFor?: string;
  /** Madrid designation: renewal copied from the parent IR, not computed. */
  linkedToIR?: boolean;
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
  goods: string;
  comments: string;
  disclaimers: string;
  dates: MarkDate[];
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

export interface Company {
  id: string;
  type: 'Company' | 'Individual' | 'Partnership';
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
}
