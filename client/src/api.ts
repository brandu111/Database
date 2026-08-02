import type { AlertRow, Company, FirmSettings, Mark, OppDateMaster, Opposition, Rule, RuleBook, EmailTemplate } from '@brandu/shared';

async function req<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    credentials: 'same-origin',
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = ((await res.json()) as { error?: string }).error || msg;
    } catch {
      /* keep status */
    }
    throw new ApiError(res.status, msg);
  }
  return res.json() as Promise<T>;
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export type Me = { kind: 'staff'; id?: string; name: string; level: string; signature?: string; email?: string } | { kind: 'client'; company: string };

export const api = {
  me: () => req<Me>('GET', '/api/auth/me'),
  login: (username: string, password: string) => req<{ name: string; level: string }>('POST', '/api/auth/login', { username, password }),
  clientLogin: (userId: string, password: string) => req<{ company: string }>('POST', '/api/auth/client-login', { userId, password }),
  logout: () => req<{ ok: true }>('POST', '/api/auth/logout'),
  saveMySignature: (signature: string) => req<{ ok: true }>('PUT', '/api/auth/me/signature', { signature }),
  saveMyEmail: (email: string) => req<{ ok: true }>('PUT', '/api/auth/me/email', { email }),
  mailStatus: () => req<{ configured: boolean }>('GET', '/api/mail/status'),
  sendTestMail: (to?: string) => req<{ ok: true; to: string }>('POST', '/api/mail/test', to ? { to } : {}),
  runDailyDigest: () => req<{ sent: number; recipients: string[] }>('POST', '/api/tasks/daily-digest'),

  marks: () => req<Mark[]>('GET', '/api/marks'),
  mark: (id: string) => req<Mark>('GET', `/api/marks/${id}`),
  createMark: (partial: Partial<Mark>) => req<Mark>('POST', '/api/marks', partial),
  saveMark: (m: Mark) => req<Mark>('PUT', `/api/marks/${m.id}`, m),
  deleteMark: (id: string) => req<{ ok: true }>('DELETE', `/api/marks/${id}`),
  importMarks: (rows: Record<string, string>[]) => req<{ imported: number; total: number; errors: { line: number; error: string }[] }>('POST', '/api/marks/import', { rows }),
  importFull: (rows: Record<string, string>[]) => req<{ imported: number; dates: number; total: number; errors: { line: number; error: string }[] }>('POST', '/api/marks/import-full', { rows }),
  importCompanies: (rows: Record<string, string>[]) => req<{ created: number; merged: number; contacts: number; skipped: number; total: number }>('POST', '/api/companies/import', { rows }),
  deleteAllMarks: () => req<{ deleted: number }>('DELETE', '/api/marks?confirm=DELETE-ALL'),
  fileMadrid: (id: string, opts: { countries?: string[]; filingDate?: string; subsequent?: boolean } = {}) =>
    req<{ ir: Mark; created: Mark[] }>('POST', `/api/marks/${id}/madrid`, opts),
  ipAuConfigured: () => req<{ configured: boolean }>('GET', '/api/lookup/ip-australia'),
  lookupIpAustralia: (number: string) => req<Partial<Mark>>('GET', `/api/lookup/ip-australia/${encodeURIComponent(number.trim())}`),
  logCorrespondence: (id: string, entry: { to: string; subject: string; body: string }) => req<{ ok: true }>('POST', `/api/marks/${id}/correspondence`, entry),
  markHistory: (id: string) => req<{ at: string; user_name: string; summary: string }[]>('GET', `/api/marks/${id}/history`),
  recomputeAll: () => req<{ recomputed: number; failed: { id: string; name: string; error: string }[] }>('POST', '/api/marks/recompute-all', {}),
  pinAllDates: () => req<{ pinned: number; alreadyPinned: number; lockedTotal: number; linkedIr: number; noRenewal: number; casesTotal: number }>('POST', '/api/marks/pin-all-dates', {}),
  addRenewalReminders: () => req<{ remindersAdded: number; casesChanged: number }>('POST', '/api/marks/add-renewal-reminders', {}),
  tidyRegistered: () => req<{ datesCleared: number; casesChanged: number }>('POST', '/api/marks/tidy-registered', {}),
  addAdminContact: () => req<{ added: number; casesTotal: number }>('POST', '/api/marks/add-admin-contact', {}),
  backfillOwnerDetails: () => req<{ casesChanged: number; addressFilled: number; contactsFilled: number; noMatch: number; casesTotal: number }>('POST', '/api/marks/backfill-owner-details', {}),
  importHeadstart: (rows: Record<string, string>[]) => req<{ imported: number; unmatched: number; unmatchedList: { trademark: string; jurisdiction: string }[]; casesChanged: number; total: number }>('POST', '/api/marks/import-headstart', { rows }),
  syncAuPending: (offset: number, limit = 10) => req<{ processed: number; changed: number; changesLog: { id: string; name: string; number: string; changes: string[] }[]; errors: { name: string; error: string }[]; offset: number; total: number }>('POST', '/api/marks/sync-au-pending', { offset, limit }),
  importActions: (rows: Record<string, string>[]) => req<{ imported: number; skipped: number; unmatched: number; unmatchedList: { trademark: string; jurisdiction: string; dateName: string }[]; casesChanged: number; total: number }>('POST', '/api/marks/import-actions', { rows }),
  fetchAuLogos: (offset: number, limit = 12) => req<{ processed: number; updated: number; withImageUrl: number; noImageOnRegister: number; downloadFailed: number; noNumber: number; notFound: number; rateLimited: number; authErr: number; otherErr: number; offset: number; total: number; errors: { name: string; error: string }[] }>('POST', '/api/marks/logos/fetch-au', { offset, limit }),
  propagateLogos: () => req<{ updated: number }>('POST', '/api/marks/logos/propagate', {}),
  attachLogos: (files: { name: string; url: string }[], overwrite: boolean) => req<{ filesMatched: number; marksUpdated: number; unmatched: string[]; totalFiles: number }>('POST', '/api/marks/logos/attach', { files, overwrite }),
  clearOldAlerts: (before: string) => req<{ before: string; markDates: number; actions: number; oppDates: number }>('POST', '/api/marks/clear-old-alerts', { before }),
  bulkDeleteMarks: (ids: string[]) => req<{ deleted: number }>('POST', '/api/marks/bulk-delete', { ids }),
  linkMadrid: () => req<{ families: number; linked: number; auBasicsLinked: number }>('POST', '/api/marks/link-madrid', {}),
  verifyImport: (rows: Record<string, string>[]) => req<{ checked: number; matched: number; unmatched: number; mismatchCount: number; mismatches: { id: string; name: string; jur: string; field: string; source: string; current: string }[] }>('POST', '/api/marks/verify-import', { rows }),

  oppositions: () => req<Opposition[]>('GET', '/api/oppositions'),
  createOpposition: (partial: Partial<Opposition>) => req<Opposition>('POST', '/api/oppositions', partial),
  saveOpposition: (o: Opposition) => req<Opposition>('PUT', `/api/oppositions/${o.id}`, o),
  deleteOpposition: (id: string) => req<{ ok: true }>('DELETE', `/api/oppositions/${id}`),
  oppDatesFromTemplate: (id: string, anchorDate?: string) => req<Opposition>('POST', `/api/oppositions/${id}/dates-from-template`, anchorDate ? { anchorDate } : {}),

  companies: () => req<Company[]>('GET', '/api/companies'),
  createCompany: (partial: Partial<Company>) => req<Company>('POST', '/api/companies', partial),
  saveCompany: (c: Company) => req<Company>('PUT', `/api/companies/${c.id}`, c),
  deleteCompany: (id: string) => req<{ ok: true }>('DELETE', `/api/companies/${id}`),

  alerts: (days: number) => req<AlertRow[]>('GET', `/api/alerts?days=${days}`),

  rules: () => req<{ rulesVersion: number; rules: RuleBook }>('GET', '/api/rules'),
  saveRules: (jurisdiction: string, rules: Rule[]) => req<{ ok: true }>('PUT', `/api/rules/${encodeURIComponent(jurisdiction)}`, { rules }),
  copyRules: (source: string, targets: string[], mode: 'merge' | 'replace', names?: string[]) =>
    req<{ copied: number; targets: string[]; rules: RuleBook }>('POST', '/api/rules/copy', { source, targets, mode, names }),
  oppDatesMaster: () => req<OppDateMaster[]>('GET', '/api/opp-dates-master'),
  saveOppDatesMaster: (v: OppDateMaster[]) => req<{ ok: true }>('PUT', '/api/opp-dates-master', v),

  templates: () => req<EmailTemplate[]>('GET', '/api/templates'),
  createTemplate: (t: Partial<EmailTemplate>) => req<EmailTemplate>('POST', '/api/templates', t),
  saveTemplate: (t: EmailTemplate) => req<EmailTemplate>('PUT', `/api/templates/${t.id}`, t),
  deleteTemplate: (id: string) => req<{ ok: true }>('DELETE', `/api/templates/${id}`),
  importTemplates: (templates: unknown) => req<{ imported: number }>('POST', '/api/templates/import', templates),

  settings: () => req<FirmSettings>('GET', '/api/settings'),
  saveSettings: (s: FirmSettings) => req<FirmSettings>('PUT', '/api/settings', s),

  staffNames: () => req<{ name: string; title?: string }[]>('GET', '/api/staff-names'),
  users: () => req<{ id: string; name: string; level: string; signature?: string; email?: string; title?: string }[]>('GET', '/api/users'),
  createUser: (u: { name: string; level: string; password: string }) => req<{ id: string }>('POST', '/api/users', u),
  updateUser: (id: string, u: { name?: string; level?: string; password?: string; signature?: string; email?: string; title?: string }) => req<{ id: string }>('PUT', `/api/users/${id}`, u),
  deleteUser: (id: string) => req<{ ok: true }>('DELETE', `/api/users/${id}`),

  clientAccess: () => req<{ id: string; company: string; userId: string; active: number; createdAt: string }[]>('GET', '/api/client-access'),
  grantAccess: (company: string) => req<{ id: string; company: string; userId: string; password: string }>('POST', '/api/client-access', { company }),
  regenerateAccess: (id: string) => req<{ password: string }>('POST', `/api/client-access/${id}/regenerate`),
  setAccessActive: (id: string, active: boolean) => req<{ ok: true }>('PUT', `/api/client-access/${id}`, { active }),
  deleteAccess: (id: string) => req<{ ok: true }>('DELETE', `/api/client-access/${id}`),

  portalMarks: () => req<Mark[]>('GET', '/api/portal/marks'),
  portalOppositions: () => req<Opposition[]>('GET', '/api/portal/oppositions'),
};

export async function uploadFile(file: File): Promise<{ url: string; fileName: string }> {
  const fd = new FormData();
  fd.append('file', file);
  const res = await fetch('/api/files', { method: 'POST', body: fd, credentials: 'same-origin' });
  if (!res.ok) throw new ApiError(res.status, 'Upload failed');
  return res.json();
}
