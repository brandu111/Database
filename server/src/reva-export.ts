import type { Mark } from '@brandu/shared';

/**
 * Export every case back into the legacy (Reva) CSV layout — the exact 205-column
 * format the firm's Reva export used, so the resulting file can be handed to a
 * developer to re-upload into Reva if the firm ever needs to move back. The 13
 * leading columns are the core case fields; every remaining column is a Reva
 * date field, filled from the matching (locked) date row on the case by name.
 * Dates are written ISO (yyyy-mm-dd), matching the source export.
 */
export const REVA_COLUMNS: string[] = [
  "MarkName", "Type", "Jurisdiction", "Status", "ApplicationNo", "RegistrationNo", "OurRef", "ClientRef",
  "FileNumber", "GoodsServices", "Comments", "Disclaimers", "OwnerName", "14 Year Renewal Deadline",
  "14 Year Renewal Reminder", "2nd OA  response due", "2nd OA  response lodged", "2nd OA issued",
  "3rd OA  issued", "3rd OA  response due", "3rd OL response lodged", "4th OA  issued",
  "4th OA response due", "4th Response Lodged", "5 year use deadline", "5th OA issued",
  "6 month grace period for renewal", "6 Month Renewal Grace Period", "7 Year Renewal Reminder", "Accepted",
  "Accepted - anticipated advertisement date", "Accepted - Early Notice of Acceptance",
  "Affidavit of use/non-use 5th anniversay", "Affidavits filed", "Allow to lapse", "Amendment filed",
  "Amendment Opposition Deadline", "Appeal deadline", "Appeal filed", "Appeal to Examiner's Report Filed",
  "Application Accepted", "Application Filed", "Application Lapsed", "Application rejected",
  "Business Name Registration Date", "Business Name Renewal Deadline", "Business Name Renewal Reminder",
  "Canada - Approved", "Cancellation Action Filed", "Case update", "Case Update - sub des",
  "Change of Name and Address Request", "Convention Priority Date", "Convention Priority Deadline",
  "Cooling off period expires", "Cooling off period requested", "Date Cautionary Notice Advertised",
  "Deadline for refusal from WIPO", "Deadline to Appeal the Rejection Notice",
  "Deadline to join the first session at the Court", "Deadline to respond to appeal",
  "Declaration of Ownership due", "Declaration of Ownership Prepared", "Declaration of Ownership Registered",
  "Declaration of Use due", "Declined to renew", "Deferment - Reminder (cited mark)",
  "Deferment - Reminder (use)", "Deferment deadline - cited marks", "Deferment for prior use deadline",
  "Deferment request lodged (citation/non-use etc)", "Deferment request lodged (use)",
  "Deferment Terminated", "Design - Application Filed", "Design - Certified Date",
  "Design - First Renewal Deadline", "Design - First Renewal Reminder", "Design - Max Reg Period Ends",
  "Design - Registration Date", "Design - Reminder Max Reg Period", "Divisional App Filed",
  "Documents to be filed", "Domain Name Registered", "Domain Name Renewal Deadline",
  "Evidence in Answer Due", "Evidence in answer filed", "Evidence in Reply Due", "Evidence in reply filed",
  "Evidence in Support Due", "Evidence in support filed", "Evidence of Use due",
  "Expedited Examination Filed", "Extention to Statement of Use", "File Transferred", "Final Reminder",
  "Final Reminder for Convention Priority", "First Use Commerce", "First Use Interstate",
  "Headstart - application filed", "Headstart - part 2 fee due", "Headstart - part 2 fee paid",
  "Headstart - prelim assessment received", "Hearing date", "Hearing Deadline", "Hearing Requested",
  "Instruction to Renew Received", "Instructions Sent to Associates",
  "International Registration Certificate Received", "Irregularities notice",
  "Irregularities notice response due", "Irregularities notice response lodged", "Lapsing advertised",
  "Maintenance Date - Affidavit of use/non-use due", "Mark suspended - case update",
  "Mexico - 10 year DOU WIPO Renewal Notice", "Mexico - 10 year DOU WIPO Renewal Notice Reminder",
  "Mexico - 3 year DOU", "Mexico - 3 year DOU reminder", "Mexico - DOU on 10 year renewal ",
  "Mexico - DOU on 10 year renewal reminder", "Non-use cancellation action filed",
  "Non-use vulnerability date", "Not Opposed", "Notice of Allowance", "Notice of intention to defend",
  "Notice of Intention To Oppose", "Notice of intention to revoke acceptance",
  "Notice of Publication issued", "Notice of Renewal Received", "Notification of Certification Received",
  "Notification of Subsequent Designation", "OA Instructions Received", "OA Issued",
  "OA Maintenance Reminder", "OA received", "OA received?", "OA Response Due", "OA response lodged",
  "Opposition filed", "Opposition response due", "Opposition response lodged",
  "Opposition to Removal expiry date", "Opposition to Removal filed", "Opposition won", "Pending/Suspended",
  "Philipines - Renewal DAU 6th anniversary deadline", "Philippines - DAU 10th ann/renewal deadline",
  "Philippines - DAU 3rd ann deadline", "Philippines - DAU 5/6th ann deadline",
  "Philippines - DAU reminder 15/16th ann", "Philippines - DAU reminder 3rd ann",
  "Philippines - DAU reminder 5/6th ann", "Philippines - Renewal - 1st anniversary deadline",
  "Philippines - Renewal DAU 1st anniversary reminder", "Philippines - Renewal DAU 6th anniversary reminder",
  "Philippines - Renewal Reminder", "POA filing deadline", "Priority Date", "Publication Date",
  "Puerto - First Use Statement Deadline", "Registration Ceased/Not renewed", "Registration Date",
  "Registration Fee Due", "Registration Renewed", "Rejected - Appeal Possible", "Rejection Notice Issued",
  "Reminder for Certificate", "Reminder for Convention Priority", "Reminder for declaration of use",
  "Reminder for Domain Name Renewal", "Reminder for Payment of Registration Fee",
  "Removal Application Advertised", "Removal Application Filed", "Renewal Deadline",
  "Renewal Deadline (Convention)", "Renewal Fees Paid? Renew", "Renewal Instructions Received",
  "Renewal Reminder", "Renewal Reminder - Final", "Renewal Reminder (Convention)",
  "Request for payment of rego fee", "Response to appeal due", "Revocation - deadline to response",
  "Revocation of Acceptance", "Search and Preliminary Advice Request Filed",
  "statement of grounds and particulars", "Statement of Use Deadline", "Subsequent designation filed",
  "TTMF - Early Acceptance", "TTMF Application filed", "TTMF Application Received", "TTMF OA Issued",
  "TTMF- Publication", "UAE - Notice of Oppoistion after 18 months",
  "US - Deadline for Dec of Use 10th Anniversary", "US - Deadline for Dec of Use 5th Anniversary",
  "US - DOU Grace Period Deadline", "US - Opposition Period Expires", "US - Publication Date",
  "US - Reminder for Dec of use 9/10 yrs", "US - Reminder for Declaration of use 5/6 Ann",
  "Watching Mark Deadline", "WIPO certificate of registration", "WIPO Second Part Fee Due",
  "Withdrawn Application",
];

/** Reva core column → value from the Mark. Everything else is a date lookup. */
const CORE: Record<string, (m: Mark) => string> = {
  MarkName: (m) => m.name || '',
  Type: (m) => m.type || '',
  Jurisdiction: (m) => m.jurisdiction || '',
  Status: (m) => m.status || '',
  ApplicationNo: (m) => m.application || '',
  RegistrationNo: (m) => m.registration || '',
  OurRef: (m) => m.matter || '',
  ClientRef: (m) => m.clientDocket || '',
  FileNumber: (m) => m.ourDocket || '',
  GoodsServices: (m) => m.goods || '',
  Comments: (m) => m.comments || '',
  Disclaimers: (m) => m.disclaimers || '',
  OwnerName: (m) => m.owner || '',
};

/** Escape a value for CSV (quote when it contains a comma, quote or newline). */
function esc(v: string): string {
  return /[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}

/** Build the full Reva-format CSV for every case. */
export function toRevaCsv(marks: Mark[]): string {
  const header = REVA_COLUMNS.map(esc).join(',');
  const lines = marks.map((m) => {
    const byName = new Map((m.dates || []).map((d) => [d.name, d.date || '']));
    return REVA_COLUMNS.map((col) => esc(CORE[col] ? CORE[col](m) : (byName.get(col) || ''))).join(',');
  });
  return [header, ...lines].join('\r\n') + '\r\n';
}
