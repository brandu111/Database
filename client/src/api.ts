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

export type Me = { kind: 'staff'; name: string; level: string } | { kind: 'client'; company: string };

export const api = {
  me: () => req<Me>('GET', '/api/auth/me'),
  login: (username: string, password: string) => req<{ name: string; level: string }>('POST', '/api/auth/login', { username, password }),
  clientLogin: (userId: string, password: string) => req<{ company: string }>('POST', '/api/auth/client-login', { userId, password }),
  logout: () => req<{ ok: true }>('POST', '/api/auth/logout'),

  marks: () => req<Mark[]>('GET', '/api/marks'),
  mark: (id: string) => req<Mark>('GET', `/api/marks/${id}`),
  createMark: (partial: Partial<Mark>) => req<Mark>('POST', '/api/marks', partial),
  saveMark: (m: Mark) => req<Mark>('PUT', `/api/marks/${m.id}`, m),
  deleteMark: (id: string) => req<{ ok: true }>('DELETE', `/api/marks/${id}`),
  fileMadrid: (id: string, country?: string) => req<{ ir: Mark; created: Mark[] }>('POST', `/api/marks/${id}/madrid`, country ? { country } : {}),
  ipAuConfigured: () => req<{ configured: boolean }>('GET', '/api/lookup/ip-australia'),
  lookupIpAustralia: (number: string) => req<Partial<Mark>>('GET', `/api/lookup/ip-australia/${encodeURIComponent(number.trim())}`),
  logCorrespondence: (id: string, entry: { to: string; subject: string; body: string }) => req<{ ok: true }>('POST', `/api/marks/${id}/correspondence`, entry),

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
  oppDatesMaster: () => req<OppDateMaster[]>('GET', '/api/opp-dates-master'),
  saveOppDatesMaster: (v: OppDateMaster[]) => req<{ ok: true }>('PUT', '/api/opp-dates-master', v),

  templates: () => req<EmailTemplate[]>('GET', '/api/templates'),

  settings: () => req<FirmSettings>('GET', '/api/settings'),
  saveSettings: (s: FirmSettings) => req<FirmSettings>('PUT', '/api/settings', s),

  users: () => req<{ id: string; name: string; level: string }[]>('GET', '/api/users'),
  createUser: (u: { name: string; level: string; password: string }) => req<{ id: string }>('POST', '/api/users', u),
  updateUser: (id: string, u: { name?: string; level?: string; password?: string }) => req<{ id: string }>('PUT', `/api/users/${id}`, u),
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
