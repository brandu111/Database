import { fmtDate } from './dates.js';
import type { Mark } from './types.js';

/**
 * Email merge fields. Templates may use either square-bracket (`[FieldName]`,
 * the firm's Reva convention) or double-curly (`{{fieldName}}`) placeholders —
 * both are supported for every field, so existing templates keep working.
 */

export interface MergeContext {
  /** ISO date of the deadline this email relates to (for `[DueDate]`). */
  dueDate?: string;
  /** Firm name and signature block (from settings). */
  firmName?: string;
  /** Plain-text signature (used by the text version / `mergeTemplate`). */
  signature?: string;
  /**
   * HTML signature for `mergeTemplateHtml`. When set, `[Signature]` is inserted
   * as real HTML (not escaped) so an uploaded sign-off with formatting/images
   * renders in the email.
   */
  signatureHtml?: string;
  /** Today's date (defaults to the current date). */
  today?: string;
  /**
   * The mark's graphic for HTML emails. When set (usually a `data:` URI so it
   * survives being pasted into an email), the mark placeholders render this
   * image instead of the mark's name. Falls back to `Mark.image` when omitted.
   */
  markImage?: string;
}

/** The merge fields offered to users, grouped for the reference panel. */
export const MERGE_FIELDS: { group: string; fields: { key: string; desc: string }[] }[] = [
  {
    group: 'Trade mark',
    fields: [
      { key: 'TrademarkName', desc: 'Mark name' },
      { key: 'Jurisdiction', desc: 'Jurisdiction' },
      { key: 'ApplicationNumber', desc: 'Application number' },
      { key: 'RegistrationNumber', desc: 'Registration number' },
      { key: 'IRNumber', desc: 'International Registration number' },
      { key: 'RegistrationClasses', desc: 'Classes' },
      { key: 'GoodsServices', desc: 'Goods / services' },
      { key: 'Status', desc: 'Status' },
    ],
  },
  {
    group: 'Owner / client',
    fields: [
      { key: 'CompanyName', desc: 'Owner name' },
      { key: 'FirstName', desc: 'Client contact first name' },
      { key: 'GreetingLine', desc: 'Greeting, e.g. "Dear Jane,"' },
      { key: 'OwnerAddress', desc: 'Owner address (one line)' },
      { key: 'ACN', desc: 'Owner ACN / ARBN' },
      { key: 'ABN', desc: 'Owner ABN' },
    ],
  },
  {
    group: 'References & dates',
    fields: [
      { key: 'FileNumber', desc: 'BrandU file number' },
      { key: 'ClientRef', desc: 'Client reference' },
      { key: 'AssociateRef', desc: 'Associate reference' },
      { key: 'ApplicationFiled', desc: 'Application filing date' },
      { key: 'DueDate', desc: 'The relevant deadline date' },
      { key: 'Today', desc: "Today's date" },
    ],
  },
  {
    group: 'Firm',
    fields: [
      { key: 'FirmName', desc: 'Law firm name' },
      { key: 'Signature', desc: 'Firm email signature' },
    ],
  },
];

const pad = (n: number) => String(n).padStart(2, '0');
function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** Build the field → value map for a case. */
export function mergeFieldMap(m: Partial<Mark>, ctx: MergeContext = {}): Record<string, string> {
  const contacts = m.contacts || [];
  const client = contacts.find((c) => (c.position || '').toLowerCase() === 'client');
  const clientName = client?.name || m.owner || '';
  const first = clientName.split(' ')[0] || '';
  const filed = (m.dates || []).find((x) => x.name === 'Application Filed')?.date || '';
  const address = [m.address1, m.address2, m.city, m.state, m.zip, m.country].map((x) => (x || '').trim()).filter(Boolean).join(', ');

  const map: Record<string, string> = {
    TrademarkName: m.name || '',
    Mark: m.name || '',
    Jurisdiction: m.jurisdiction || '',
    ApplicationNumber: m.application || '',
    ApplicationNo: m.application || '',
    RegistrationNumber: m.registration || '',
    RegistrationNo: m.registration || '',
    IRNumber: m.irNumber || '',
    RegistrationClasses: m.classes || '',
    Classes: m.classes || '',
    GoodsServices: m.goods || '',
    Status: m.status || '',
    CompanyName: m.owner || '',
    OwnerName: m.owner || '',
    Owner: m.owner || '',
    Client: clientName,
    FirstName: first,
    GreetingLine: first ? `Dear ${first},` : 'Dear Sir or Madam,',
    OwnerAddress: address,
    ACN: m.ownerAcn || '',
    ABN: m.ownerAbn || '',
    FileNumber: m.matter || '',
    Matter: m.matter || '',
    OurRef: m.matter || '',
    ClientRef: m.clientDocket || '',
    ClientDocket: m.clientDocket || '',
    OurDocket: m.ourDocket || '',
    AssociateRef: m.associateRef || '',
    ApplicationFiled: fmtDate(filed),
    DueDate: fmtDate(ctx.dueDate || ''),
    Deadline: fmtDate(ctx.dueDate || ''),
    Today: fmtDate(ctx.today || todayISO()),
    FirmName: ctx.firmName || '',
    Signature: ctx.signature || '',
  };
  // Legacy lowercase keys used by the date-rule templates.
  map.mark = map.TrademarkName;
  map.client = clientName;
  map.jurisdiction = map.Jurisdiction;
  map.deadline = map.DueDate;
  return map;
}

/** Normalise a placeholder/field name for loose matching: lowercase, letters+digits only. */
function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}

/**
 * Resolve a single placeholder token (the text between the brackets) to a value.
 * Resolution order:
 *   1. Exact static field key (e.g. `TrademarkName`).
 *   2. Case/punctuation-insensitive static field key (e.g. `trademark name`).
 *   3. A date row on the case, matched by name (e.g. `[RenewalDeadline]`
 *      → the "Renewal Deadline" date, `[OA Response Due]` → "OA Response Due").
 * Returns `undefined` when nothing matches, so the caller can leave the token
 * untouched (attorney fill-ins such as `[FEES]` or `[ATTORNEY TO COMPLETE]`).
 */
function resolveToken(token: string, map: Record<string, string>, normDates: Map<string, string>): string | undefined {
  if (Object.prototype.hasOwnProperty.call(map, token)) return map[token];
  const key = norm(token);
  if (!key) return undefined;
  if (normStatic.size === 0 || normStaticFor !== map) buildNormStatic(map);
  if (normStatic.has(key)) return normStatic.get(key);
  if (normDates.has(key)) return normDates.get(key);
  return undefined;
}

// Cached case-insensitive index of the current static map.
let normStatic = new Map<string, string>();
let normStaticFor: Record<string, string> | null = null;
function buildNormStatic(map: Record<string, string>): void {
  normStatic = new Map();
  for (const [k, v] of Object.entries(map)) {
    const nk = norm(k);
    if (nk && !normStatic.has(nk)) normStatic.set(nk, v);
  }
  normStaticFor = map;
}

/** Build a normalised index of a case's date rows: name → formatted date. */
function dateIndex(m: Partial<Mark>): Map<string, string> {
  const idx = new Map<string, string>();
  for (const d of m.dates || []) {
    if (!d?.name) continue;
    const nk = norm(d.name);
    // First (earliest) row of a given name wins; skip blanks so a later
    // populated row of the same name can still fill in.
    if (!idx.has(nk) || (!idx.get(nk) && d.date)) idx.set(nk, fmtDate(d.date));
  }
  return idx;
}

/**
 * Replace `[Token]` and `{{Token}}` placeholders in `text`. Known tokens resolve
 * from `map` (static fields) or `normDates` (the case's date rows); unknown
 * tokens are left exactly as written so attorney fill-ins survive the merge.
 */
export function applyMerge(text: string, map: Record<string, string>, normDates: Map<string, string> = new Map()): string {
  const src = String(text || '');
  buildNormStatic(map);
  return src
    .replace(/\[([^\][\n]{1,60})\]/g, (whole, token: string) => {
      const v = resolveToken(token.trim(), map, normDates);
      return v === undefined ? whole : v;
    })
    .replace(/\{\{\s*([^}\n]{1,60}?)\s*\}\}/g, (whole, token: string) => {
      const v = resolveToken(token.trim(), map, normDates);
      return v === undefined ? whole : v;
    });
}

/** Merge a template body/subject against a case. */
export function mergeTemplate(text: string, m: Partial<Mark>, ctx: MergeContext = {}): string {
  return applyMerge(text, mergeFieldMap(m, ctx), dateIndex(m));
}

function escapeHtml(s: string): string {
  return s.split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;').split('"').join('&quot;');
}

/**
 * Inline text formatting for templates: **bold** and __underline__. Authors mark
 * up plain text (via the Bold/Underline buttons in the editor); this renders the
 * markers as HTML for the email. Applied only to already-escaped literal text, so
 * it can never corrupt merged values, tags or URLs.
 */
export function applyInlineFormat(html: string): string {
  return html
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/__(.+?)__/g, '<u>$1</u>');
}

/** Remove the **bold** / __underline__ markers for the plain-text version. */
export function stripInlineFormat(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, '$1').replace(/__(.+?)__/g, '$1');
}

/**
 * Placeholders that stand for "the mark itself". When the case has a graphic
 * (a logo / device / composite mark), these render the image instead of the
 * mark name — so device marks show the actual logo in the email, word marks
 * show the words. Covers both the explicit image tokens and the plain name
 * tokens the existing templates already use.
 */
const MARK_TOKENS = new Set(['trademarkname', 'mark', 'trademark', 'trademarkimage', 'markimage', 'marklogo', 'markgraphic', 'trademarklogo', 'logo']);

/**
 * Merge a template into an HTML fragment. Same field resolution as
 * {@link mergeTemplate}, but the result is HTML: literal text is escaped,
 * newlines become `<br>`, and when the case has a graphic the mark placeholders
 * render it as an inline `<img>`. Pass `ctx.markImage` (ideally a `data:` URI)
 * so the image travels when the email is copied into a mail client.
 */
export function mergeTemplateHtml(text: string, m: Partial<Mark>, ctx: MergeContext = {}): string {
  const map = mergeFieldMap(m, ctx);
  const normDates = dateIndex(m);
  const imgSrc = ctx.markImage || m.image || '';
  const name = map.TrademarkName || 'trade mark';
  const imgTag = imgSrc
    ? `<img src="${escapeHtml(imgSrc)}" alt="${escapeHtml(name)}" style="max-height:96px;max-width:320px;vertical-align:middle" />`
    : '';

  const resolveHtml = (token: string): string | undefined => {
    const key = norm(token);
    // The mark, shown as its graphic when the case has one.
    if (imgTag && MARK_TOKENS.has(key)) return imgTag;
    // The signature is HTML (an uploaded sign-off) — insert it unescaped.
    if (key === 'signature' && ctx.signatureHtml != null) return ctx.signatureHtml;
    const v = resolveToken(token, map, normDates);
    return v === undefined ? undefined : escapeHtml(v);
  };

  const src = String(text || '');
  const re = /\[([^\][\n]{1,60})\]|\{\{\s*([^}\n]{1,60}?)\s*\}\}/g;
  const lit = (s: string) => applyInlineFormat(escapeHtml(s).split('\n').join('<br>'));
  let out = '';
  let last = 0;
  let mm: RegExpExecArray | null;
  while ((mm = re.exec(src))) {
    out += lit(src.slice(last, mm.index));
    const token = (mm[1] ?? mm[2] ?? '').trim();
    const resolved = resolveHtml(token);
    out += resolved === undefined ? lit(mm[0]) : resolved;
    last = re.lastIndex;
  }
  out += lit(src.slice(last));
  return out;
}
