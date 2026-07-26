import type { Mark, MarkContact, MarkDate } from '@brandu/shared';
export { IMPORT_COLUMNS } from '@brandu/shared';

/**
 * CSV → Mark mapping for bulk case import. One CSV row = one case. Column
 * headers are matched case/space/underscore-insensitively against the aliases
 * below, so the firm's export headers don't have to be exact. Anchor dates are
 * imported and the deadline engine (run on save) computes renewals/reminders;
 * an explicit RenewalDate, if given, is pinned so it is honoured verbatim.
 */

/** Canonical field → accepted header aliases (all normalised to lowercase alnum). */
const ALIASES: Record<string, string[]> = {
  name: ['markname', 'mark', 'name', 'trademark', 'trademarkname'],
  jurisdiction: ['jurisdiction', 'country'],
  type: ['type', 'marktype'],
  status: ['status'],
  application: ['applicationno', 'applicationnumber', 'appno', 'application'],
  registration: ['registrationno', 'registrationnumber', 'regno', 'registration'],
  irNumber: ['irno', 'irnumber', 'internationalregistration', 'internationalregistrationno'],
  classes: ['classes', 'class', 'niceclasses'],
  goods: ['goodsservices', 'goods', 'goodsandservices', 'specification'],
  matter: ['ourref', 'matter', 'filenumber', 'fileno', 'ourreference', 'firmref'],
  clientDocket: ['clientref', 'clientdocket', 'clientfileref', 'clientreference'],
  attorney: ['responsibleattorney', 'attorney', 'feeearner', 'responsible', 'partner', 'handler'],
  associate: ['associate', 'foreignassociate', 'agent', 'foreignagent'],
  associateRef: ['associateref', 'agentref', 'associatereference'],
  tags: ['tags', 'labels', 'tag'],
  renewalFee: ['renewalfee', 'renewalcost', 'fee'],
  owner: ['ownername', 'owner', 'applicant', 'proprietor'],
  ownerAcn: ['owneracn', 'acn', 'arbn'],
  ownerAbn: ['ownerabn', 'abn'],
  address1: ['owneraddress', 'address', 'addressline', 'address1'],
  city: ['ownercity', 'city', 'suburb'],
  state: ['ownerstate', 'state'],
  zip: ['ownerpostcode', 'postcode', 'zip', 'postalcode'],
  country: ['ownercountry'],
  contactName: ['clientcontactname', 'contactname', 'contact'],
  contactEmail: ['clientcontactemail', 'contactemail', 'email'],
  comments: ['comments', 'notes'],
  filed: ['fileddate', 'filed', 'applicationfiled', 'filingdate', 'datefiled'],
  priority: ['prioritydate', 'priority', 'conventionpriority'],
  registered: ['registrationdate', 'registered', 'dateregistered', 'registereddate'],
  publication: ['publicationdate', 'acceptancedate', 'advertised', 'advertiseddate', 'accepted'],
  oaIssued: ['oaissueddate', 'oaissued', 'examinationreport', 'firstreport'],
  renewal: ['renewaldate', 'renewal', 'nextrenewal', 'renewaldue'],
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Build a lookup from a row's actual headers to canonical fields. */
function fieldGetter(row: Record<string, string>): (field: string) => string {
  const byNorm = new Map<string, string>();
  for (const key of Object.keys(row)) byNorm.set(norm(key), key);
  return (field: string) => {
    for (const alias of ALIASES[field] || []) {
      const real = byNorm.get(alias);
      if (real != null && row[real] != null && String(row[real]).trim() !== '') return String(row[real]).trim();
    }
    return '';
  };
}

/** Parse dd/mm/yyyy, d/m/yy, yyyy-mm-dd, ddmmyyyy → ISO yyyy-mm-dd, or '' if unparseable. */
export function parseImportDate(text: string): string {
  const t = (text || '').trim();
  if (!t) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10);
  const m = /^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{2}|\d{4})$/.exec(t) || /^(\d{2})(\d{2})(\d{4})$/.exec(t);
  if (!m) return '';
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  let y = parseInt(m[3], 10);
  if (m[3].length === 2) y += y >= 70 ? 1900 : 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  const chk = new Date(`${iso}T00:00:00Z`);
  return chk.getUTCMonth() + 1 === mo && chk.getUTCDate() === d ? iso : '';
}

/** Normalise a classes string like "09 ,42 ; 9" → "9, 42". */
function cleanClasses(raw: string): string {
  const nums = raw
    .split(/[,;/]+/)
    .map((c) => c.trim().replace(/^0+(?=\d)/, ''))
    .filter((c) => /^\d{1,2}$/.test(c) && Number(c) >= 1 && Number(c) <= 45);
  return [...new Set(nums)].sort((a, b) => Number(a) - Number(b)).join(', ');
}

export interface RowError { line: number; error: string; }

/**
 * Convert one CSV row into the Mark fields to import. Returns the partial mark,
 * or throws with a human message if the row is unusable (e.g. no mark name).
 */
export function csvRowToMark(row: Record<string, string>): Partial<Mark> {
  const g = fieldGetter(row);
  const name = g('name');
  if (!name) throw new Error('missing MarkName');

  const registered = g('registered');
  const status = g('status') || (registered || g('registration') ? 'Registered' : 'Pending');

  const dates: MarkDate[] = [];
  const addDate = (label: string, iso: string, extra?: Partial<MarkDate>) => {
    if (iso) dates.push({ name: label, date: iso, done: true, ...extra });
  };
  addDate('Application Filed', parseImportDate(g('filed')), { auInput: true });
  addDate('Priority Date', parseImportDate(g('priority')));
  addDate('OA Issued', parseImportDate(g('oaIssued')), { auInput: true });
  addDate('Publication Date', parseImportDate(g('publication')), { auInput: true });
  addDate('Registration Date', parseImportDate(g('registered')), { auInput: true });
  // An explicit renewal date is pinned so the engine keeps it verbatim.
  const renewal = parseImportDate(g('renewal'));
  if (renewal) dates.push({ name: 'Renewal Deadline', date: renewal, done: false, pinned: true });

  const contacts: MarkContact[] = [];
  if (g('contactName') || g('contactEmail')) {
    contacts.push({ name: g('contactName'), company: g('owner'), position: 'Client', phone: '', email: g('contactEmail') });
  }

  const irNumber = g('irNumber');
  const out: Partial<Mark> = {
    name,
    jurisdiction: g('jurisdiction') || 'Australia',
    type: g('type') || 'Word',
    status,
    application: g('application'),
    registration: g('registration') || (registered ? g('application') : ''),
    classes: cleanClasses(g('classes')),
    goods: g('goods'),
    matter: g('matter'),
    clientDocket: g('clientDocket'),
    attorney: g('attorney'),
    associate: g('associate'),
    associateRef: g('associateRef'),
    tags: g('tags') ? g('tags').split(/[;,]+/).map((t) => t.trim()).filter(Boolean) : [],
    renewalFee: g('renewalFee') ? Number(g('renewalFee').replace(/[^0-9.]/g, '')) || undefined : undefined,
    owner: g('owner'),
    ownerAcn: g('ownerAcn'),
    ownerAbn: g('ownerAbn'),
    address1: g('address1'),
    city: g('city'),
    state: g('state'),
    zip: g('zip'),
    country: g('country') || 'Australia',
    comments: g('comments'),
    dates,
    contacts,
  };
  if (irNumber) {
    out.irNumber = irNumber;
    out.filingBasis = 'Madrid Protocol';
  }
  if (out.ownerAbn || out.ownerAcn) out.ownerType = 'Company';
  return out;
}
