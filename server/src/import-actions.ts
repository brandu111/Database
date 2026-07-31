import type { Mark, MarkAction } from '@brandu/shared';

/**
 * Legacy "Trademark Action" import. The firm's legacy alert export mixes two
 * kinds of row: standard jurisdiction/reminder dates that this app already
 * generates from the rulebook (which we must NOT re-import, or they duplicate
 * and fight the locked dates), and free-text action/diary items that never came
 * across. We keep only the free-text ones.
 *
 * The set below is the exact list of the legacy system's standard date-field
 * names (its 193 date columns). Any row whose Date Name matches one of these is
 * a standard date and is skipped; everything else is a genuine action.
 */
export const LEGACY_STANDARD_DATE_NAMES = new Set<string>([
  "14 year renewal deadline",
  "14 year renewal reminder",
  "2nd oa issued",
  "2nd oa response due",
  "2nd oa response lodged",
  "3rd oa issued",
  "3rd oa response due",
  "3rd ol response lodged",
  "4th oa issued",
  "4th oa response due",
  "4th response lodged",
  "5 year use deadline",
  "5th oa issued",
  "6 month grace period for renewal",
  "6 month renewal grace period",
  "7 year renewal reminder",
  "accepted",
  "accepted - anticipated advertisement date",
  "accepted - early notice of acceptance",
  "affidavit of use/non-use 5th anniversay",
  "affidavits filed",
  "allow to lapse",
  "amendment filed",
  "amendment opposition deadline",
  "appeal deadline",
  "appeal filed",
  "appeal to examiner's report filed",
  "application accepted",
  "application filed",
  "application lapsed",
  "application rejected",
  "business name registration date",
  "business name renewal deadline",
  "business name renewal reminder",
  "canada - approved",
  "cancellation action filed",
  "case update",
  "case update - sub des",
  "change of name and address request",
  "convention priority date",
  "convention priority deadline",
  "cooling off period expires",
  "cooling off period requested",
  "date cautionary notice advertised",
  "deadline for refusal from wipo",
  "deadline to appeal the rejection notice",
  "deadline to join the first session at the court",
  "deadline to respond to appeal",
  "declaration of ownership due",
  "declaration of ownership prepared",
  "declaration of ownership registered",
  "declaration of use due",
  "declined to renew",
  "deferment - reminder (cited mark)",
  "deferment - reminder (use)",
  "deferment deadline - cited marks",
  "deferment for prior use deadline",
  "deferment request lodged (citation/non-use etc)",
  "deferment request lodged (use)",
  "deferment terminated",
  "design - application filed",
  "design - certified date",
  "design - first renewal deadline",
  "design - first renewal reminder",
  "design - max reg period ends",
  "design - registration date",
  "design - reminder max reg period",
  "divisional app filed",
  "documents to be filed",
  "domain name registered",
  "domain name renewal deadline",
  "evidence in answer due",
  "evidence in answer filed",
  "evidence in reply due",
  "evidence in reply filed",
  "evidence in support due",
  "evidence in support filed",
  "evidence of use due",
  "expedited examination filed",
  "extention to statement of use",
  "file transferred",
  "final reminder",
  "final reminder for convention priority",
  "first use commerce",
  "first use interstate",
  "headstart - application filed",
  "headstart - part 2 fee due",
  "headstart - part 2 fee paid",
  "headstart - prelim assessment received",
  "hearing date",
  "hearing deadline",
  "hearing requested",
  "instruction to renew received",
  "instructions sent to associates",
  "international registration certificate received",
  "irregularities notice",
  "irregularities notice response due",
  "irregularities notice response lodged",
  "lapsing advertised",
  "maintenance date - affidavit of use/non-use due",
  "mark suspended - case update",
  "mexico - 10 year dou wipo renewal notice",
  "mexico - 10 year dou wipo renewal notice reminder",
  "mexico - 3 year dou",
  "mexico - 3 year dou reminder",
  "mexico - dou on 10 year renewal",
  "mexico - dou on 10 year renewal reminder",
  "non-use cancellation action filed",
  "non-use vulnerability date",
  "not opposed",
  "notice of allowance",
  "notice of intention to defend",
  "notice of intention to oppose",
  "notice of intention to revoke acceptance",
  "notice of publication issued",
  "notice of renewal received",
  "notification of certification received",
  "notification of subsequent designation",
  "oa instructions received",
  "oa issued",
  "oa maintenance reminder",
  "oa received",
  "oa received?",
  "oa response due",
  "oa response lodged",
  "opposition filed",
  "opposition period expires",
  "opposition response due",
  "opposition response lodged",
  "opposition to removal expiry date",
  "opposition to removal filed",
  "opposition won",
  "pending/suspended",
  "philipines - renewal dau 6th anniversary deadline",
  "philippines - dau 10th ann/renewal deadline",
  "philippines - dau 3rd ann deadline",
  "philippines - dau 5/6th ann deadline",
  "philippines - dau reminder 15/16th ann",
  "philippines - dau reminder 3rd ann",
  "philippines - dau reminder 5/6th ann",
  "philippines - renewal - 1st anniversary deadline",
  "philippines - renewal dau 1st anniversary reminder",
  "philippines - renewal dau 6th anniversary reminder",
  "philippines - renewal reminder",
  "poa filing deadline",
  "priority date",
  "publication date",
  "puerto - first use statement deadline",
  "registration ceased/not renewed",
  "registration date",
  "registration fee due",
  "registration renewed",
  "rejected - appeal possible",
  "rejection notice issued",
  "reminder for certificate",
  "reminder for convention priority",
  "reminder for declaration of use",
  "reminder for domain name renewal",
  "reminder for payment of registration fee",
  "removal application advertised",
  "removal application filed",
  "renewal deadline",
  "renewal deadline (convention)",
  "renewal fees paid? renew",
  "renewal instructions received",
  "renewal reminder",
  "renewal reminder (convention)",
  "renewal reminder - final",
  "request for payment of rego fee",
  "response to appeal due",
  "revocation - deadline to response",
  "revocation of acceptance",
  "search and preliminary advice request filed",
  "statement of grounds and particulars",
  "statement of use deadline",
  "subsequent designation filed",
  "ttmf - early acceptance",
  "ttmf application filed",
  "ttmf application received",
  "ttmf oa issued",
  "ttmf- publication",
  "uae - notice of oppoistion after 18 months",
  "us - deadline for dec of use 10th anniversary",
  "us - deadline for dec of use 5th anniversary",
  "us - dou grace period deadline",
  "us - opposition period expires",
  "us - publication date",
  "us - reminder for dec of use 9/10 yrs",
  "us - reminder for declaration of use 5/6 ann",
  "watching mark deadline",
  "wipo certificate of registration",
  "wipo second part fee due",
  "withdrawn application",
]);

export const normName = (s?: string): string => (s || '').toLowerCase().replace(/\s+/g, ' ').trim();

/** Is this Date Name one of the standard jurisdiction/reminder dates (skip it)? */
export function isStandardDateName(dateName: string): boolean {
  return LEGACY_STANDARD_DATE_NAMES.has(normName(dateName));
}

/** Digit runs of 4+ chars from an application/registration/IR string, e.g.
 * "IR No. 1744851" -> {"1744851"}, "6318164 / SN.88627353" -> {"6318164","88627353"}. */
export function numberTokens(...vals: (string | undefined)[]): Set<string> {
  const out = new Set<string>();
  for (const v of vals) for (const m of (v || '').matchAll(/\d{4,}/g)) out.add(m[0].replace(/^0+/, '') || m[0]);
  return out;
}

const nkey = (s?: string): string => (s || '').toLowerCase().replace(/\b(logo|device|stylised|stylized|word|series|and logo)\b/g, '').replace(/[^a-z0-9]/g, '');
const jkey = (s?: string): string => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

export interface CaseIndexEntry { mark: Mark; tokens: Set<string>; nname: string; jur: string; }

export function indexCases(marks: Mark[]): CaseIndexEntry[] {
  return marks.map((mark) => ({
    mark,
    tokens: numberTokens(mark.application, mark.registration, mark.irNumber),
    nname: nkey(mark.name),
    jur: jkey(mark.jurisdiction),
  }));
}

/** Find the case an alert row belongs to: first by shared application/registration
 * number, then (tie-broken or fallen back to) by name + jurisdiction. */
export function matchCase(
  row: { Trademark?: string; Jurisdiction?: string; Application?: string; Registration?: string },
  index: CaseIndexEntry[]
): Mark | null {
  const tokens = numberTokens(row.Application, row.Registration);
  const nname = nkey(row.Trademark);
  const jur = jkey(row.Jurisdiction);
  if (tokens.size) {
    const hits = index.filter((e) => [...tokens].some((t) => e.tokens.has(t)));
    if (hits.length === 1) return hits[0].mark;
    if (hits.length > 1) {
      const better = hits.find((e) => e.nname === nname && e.jur === jur) || hits.find((e) => e.jur === jur);
      return (better || hits[0]).mark;
    }
  }
  if (nname) {
    const byName = index.filter((e) => e.nname === nname && (!jur || e.jur === jur));
    if (byName.length) return byName[0].mark;
  }
  return null;
}

/** Build the action row to add for a matched alert. */
export function toAction(dateName: string, iso: string): MarkAction {
  return { date: iso, text: dateName, done: false, alert: true, alertDate: iso, createdBy: 'Legacy actions import' };
}
