import { useEffect, useMemo, useState } from 'react';
import { fmtDate, jurList, type FirmSettings, type Rule, type RuleBook } from '@brandu/shared';
import { api } from '../api';
import { Card, Field, confirmDelete } from '../ui';

export function Preferences({ isFull }: { isFull: boolean }) {
  const [tab, setTab] = useState<'rules' | 'settings'>('rules');
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className={`chip${tab === 'rules' ? ' on' : ''}`} onClick={() => setTab('rules')}>Date Rules</button>
        <button className={`chip${tab === 'settings' ? ' on' : ''}`} onClick={() => setTab('settings')}>Settings &amp; Users</button>
      </div>
      {tab === 'rules' ? <DateRules isFull={isFull} /> : <SettingsUsers isFull={isFull} />}
    </>
  );
}

// ---------------------------------------------------------------------------- date rules

function DateRules({ isFull }: { isFull: boolean }) {
  const [rules, setRules] = useState<RuleBook>({});
  const [rulesVersion, setRulesVersion] = useState<number | null>(null);
  const [prefKey, setPrefKey] = useState('_default');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(-1);
  const [saveState, setSaveState] = useState('');

  useEffect(() => {
    api.rules().then((r) => {
      setRules(r.rules);
      setRulesVersion(r.rulesVersion);
    });
  }, []);

  const jurs = useMemo(() => {
    const s = search.trim().toLowerCase();
    return jurList().filter((j) => !s || j.toLowerCase().includes(s));
  }, [search]);

  const cur = rules[prefKey] || [];

  const persist = async (jur: string, list: Rule[]) => {
    setRules((r) => ({ ...r, [jur]: list }));
    setSaveState('Saving…');
    try {
      await api.saveRules(jur, list);
      setSaveState('Saved');
    } catch {
      setSaveState('Save failed — Full Permissions required');
    }
  };

  const setRule = (i: number, patch: Partial<Rule>) => persist(prefKey, cur.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <div className="pref-layout">
      <div className="card" style={{ padding: 10 }}>
        <input type="text" placeholder="Find jurisdiction…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
        <div className={`jur-item${prefKey === '_default' ? ' on' : ''}`} onClick={() => { setPrefKey('_default'); setExpanded(-1); }}>
          <span>Baseline (all jurisdictions)</span>
          <span className="hint">{(rules._default || []).length}</span>
        </div>
        {jurs.map((j) => (
          <div key={j} className={`jur-item${prefKey === j ? ' on' : ''}`} onClick={() => { setPrefKey(j); setExpanded(-1); }}>
            <span>{j}</span>
            <span className="hint">{(rules[j] || []).length || ''}</span>
          </div>
        ))}
      </div>

      <div>
        <Card
          label={prefKey === '_default' ? 'Baseline rules' : `${prefKey} rules`}
          right={
            <div className="row">
              <span className="hint">rules v{rulesVersion ?? '…'} · offsets from trigger date · date format {fmtDate('2009-01-01')}</span>
              {isFull && prefKey !== '_default' && cur.length === 0 && (
                <button className="btn secondary small" onClick={() => persist(prefKey, JSON.parse(JSON.stringify(rules._default || [])))}>
                  Copy baseline
                </button>
              )}
              {isFull && (
                <button className="btn small" onClick={() => persist(prefKey, [...cur, { name: 'New date', trigger: 'Application Filed', v: 1, u: 'months', alerts: true, template: '', custom: true }])}>
                  + Add rule
                </button>
              )}
              <span className="save-state">{saveState}</span>
            </div>
          }
        >
          {cur.length === 0 && <div className="hint">No rules for this jurisdiction — the baseline applies. Copy the baseline to customise.</div>}
          {cur.length > 0 && (
            <table className="list">
              <thead>
                <tr><th>Date name</th><th>Trigger</th><th style={{ width: 70 }}>Offset</th><th style={{ width: 90 }}>Unit</th><th style={{ width: 60 }}>Alerts</th><th style={{ width: 90 }}>Reminders</th><th style={{ width: 90 }} /></tr>
              </thead>
              <tbody>
                {cur.map((r, i) => (
                  <RuleRow key={i} r={r} i={i} isFull={isFull} expanded={expanded === i}
                    onToggle={() => setExpanded(expanded === i ? -1 : i)}
                    onChange={(patch) => setRule(i, patch)}
                    onDelete={() => { if (confirmDelete(`rule "${r.name}"`)) persist(prefKey, cur.filter((_, j) => j !== i)); }} />
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <div className="hint">
          Built-in rules are statutory periods reviewed with the client; changing them here is firm policy. Rules you add are marked custom and survive rulebook upgrades.
        </div>
      </div>
    </div>
  );
}

function RuleRow({ r, i, isFull, expanded, onToggle, onChange, onDelete }: {
  r: Rule;
  i: number;
  isFull: boolean;
  expanded: boolean;
  onToggle: () => void;
  onChange: (p: Partial<Rule>) => void;
  onDelete: () => void;
}) {
  const ro = !isFull;
  return (
    <>
      <tr>
        <td><input type="text" value={r.name} disabled={ro} onChange={(e) => onChange({ name: e.target.value })} />{r.custom && <span className="hint"> custom</span>}</td>
        <td><input type="text" value={r.trigger} disabled={ro} onChange={(e) => onChange({ trigger: e.target.value })} /></td>
        <td><input type="number" value={r.v} disabled={ro} onChange={(e) => onChange({ v: parseInt(e.target.value, 10) || 0 })} /></td>
        <td>
          <select value={r.u} disabled={ro} onChange={(e) => onChange({ u: e.target.value as Rule['u'] })}>
            <option value="days">days</option>
            <option value="months">months</option>
            <option value="years">years</option>
          </select>
        </td>
        <td style={{ textAlign: 'center' }}><input type="checkbox" checked={!!r.alerts} disabled={ro} onChange={() => onChange({ alerts: !r.alerts })} /></td>
        <td><input type="number" min={0} max={6} value={r.rem || 0} disabled={ro} onChange={(e) => onChange({ rem: Math.max(0, Math.min(6, parseInt(e.target.value, 10) || 0)) })} /></td>
        <td style={{ whiteSpace: 'nowrap' }}>
          <button className="btn danger-link" style={{ color: 'var(--accent-text)' }} onClick={onToggle}>{r.template ? '✎ email' : '+ email'}</button>
          {isFull && <button className="btn danger-link" onClick={onDelete}>✕</button>}
        </td>
      </tr>
      {expanded && (
        <tr key={`x${i}`}>
          <td colSpan={7} style={{ background: 'var(--panel)' }}>
            <Field label="Email template for this deadline ({{client}}, {{mark}}, {{jurisdiction}}, {{deadline}})">
              <textarea rows={6} value={r.template} disabled={ro} onChange={(e) => onChange({ template: e.target.value })} />
            </Field>
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------- settings & users

function SettingsUsers({ isFull }: { isFull: boolean }) {
  const [fs, setFs] = useState<FirmSettings | null>(null);
  const [users, setUsers] = useState<{ id: string; name: string; level: string }[]>([]);
  const [access, setAccess] = useState<{ id: string; company: string; userId: string; active: number; createdAt: string }[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [grantCompany, setGrantCompany] = useState('');
  const [freshCreds, setFreshCreds] = useState<Record<string, string>>({});
  const [newUser, setNewUser] = useState({ name: '', level: 'Edit Only', password: '' });
  const [saveState, setSaveState] = useState('');

  useEffect(() => {
    api.settings().then(setFs);
    api.companies().then((cs) => setCompanies(cs.map((c) => c.name).filter(Boolean).sort()), () => undefined);
    if (isFull) {
      api.users().then(setUsers, () => undefined);
      api.clientAccess().then(setAccess, () => undefined);
    }
  }, [isFull]);

  const saveSettings = async (next: FirmSettings) => {
    setFs(next);
    setSaveState('Saving…');
    try {
      await api.saveSettings(next);
      setSaveState('Saved');
    } catch {
      setSaveState('Save failed');
    }
  };

  if (!fs) return <div className="hint">Loading…</div>;
  const ro = !isFull;

  return (
    <div className="detail-cols">
      <div>
        <Card label="General" right={<span className="save-state">{saveState}</span>}>
          <div className="grid2">
            <Field label="Law firm name"><input type="text" value={fs.lawFirmName} disabled={ro} onChange={(e) => saveSettings({ ...fs, lawFirmName: e.target.value })} /></Field>
            <Field label="Firm contact email"><input type="text" value={fs.firmContactEmail} disabled={ro} onChange={(e) => saveSettings({ ...fs, firmContactEmail: e.target.value })} /></Field>
          </div>
          <Field label="Documents folder"><input type="text" value={fs.documentsFolder} disabled={ro} onChange={(e) => saveSettings({ ...fs, documentsFolder: e.target.value })} /></Field>
          <Field label="Logo (used on report headers)">
            {fs.logo ? (
              <div className="row">
                <img src={fs.logo} alt="logo" style={{ maxHeight: 56, maxWidth: 200, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 7, padding: 4 }} />
                {isFull && <button className="btn danger-link" onClick={() => saveSettings({ ...fs, logo: '' })}>Remove</button>}
              </div>
            ) : isFull ? (
              <label className="btn secondary small" style={{ cursor: 'pointer', display: 'inline-block' }}>
                ⬆ Upload logo
                <input type="file" accept="image/*" style={{ display: 'none' }} onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const r = new FileReader();
                  r.onload = () => saveSettings({ ...fs, logo: String(r.result) });
                  r.readAsDataURL(f);
                }} />
              </label>
            ) : (
              <div className="hint">No logo uploaded.</div>
            )}
          </Field>
          <div className="hint">Dates are shown as DD MMM YYYY (e.g. {fmtDate('2009-01-01')}) system-wide.</div>
        </Card>

        {isFull && (
          <Card label="Staff users">
            <table className="list">
              <thead><tr><th>Name</th><th>Permission level</th><th>Password</th><th /></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>
                      <select value={u.level} onChange={(e) => api.updateUser(u.id, { level: e.target.value }).then(() => api.users().then(setUsers))}>
                        <option>Full Permissions</option>
                        <option>Edit Only</option>
                        <option>View and Print Only</option>
                        <option>No Access</option>
                      </select>
                    </td>
                    <td>
                      <button className="btn secondary small" onClick={() => {
                        const pw = window.prompt(`New password for ${u.name}:`);
                        if (pw) api.updateUser(u.id, { password: pw });
                      }}>
                        Set password
                      </button>
                    </td>
                    <td><button className="btn danger-link" onClick={() => { if (confirmDelete(`user ${u.name}`)) api.deleteUser(u.id).then(() => api.users().then(setUsers)); }}>✕</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="row" style={{ marginTop: 10 }}>
              <input type="text" placeholder="Name" value={newUser.name} onChange={(e) => setNewUser({ ...newUser, name: e.target.value })} style={{ maxWidth: 160 }} />
              <select value={newUser.level} onChange={(e) => setNewUser({ ...newUser, level: e.target.value })} style={{ width: 'auto' }}>
                <option>Full Permissions</option>
                <option>Edit Only</option>
                <option>View and Print Only</option>
              </select>
              <input type="password" placeholder="Password" value={newUser.password} onChange={(e) => setNewUser({ ...newUser, password: e.target.value })} style={{ maxWidth: 160 }} />
              <button className="btn small" disabled={!newUser.name || !newUser.password}
                onClick={() => api.createUser(newUser).then(() => { setNewUser({ name: '', level: 'Edit Only', password: '' }); api.users().then(setUsers); })}>
                + Add user
              </button>
            </div>
          </Card>
        )}
      </div>

      <div>
        {isFull && (
          <Card label="Client access (extranet)">
            <div className="hint" style={{ marginBottom: 8 }}>
              Invite a client company: a unique login ID and generated password give read-only access to that company's own matters. Passwords are stored hashed and shown once — send them over a secure channel.
            </div>
            <div className="row" style={{ marginBottom: 12 }}>
              <input type="text" list="grant-cos" placeholder="Company…" value={grantCompany} onChange={(e) => setGrantCompany(e.target.value)} style={{ maxWidth: 280 }} />
              <datalist id="grant-cos">{companies.map((c) => <option key={c} value={c} />)}</datalist>
              <button className="btn small" disabled={!grantCompany} onClick={async () => {
                const g = await api.grantAccess(grantCompany);
                setFreshCreds((f) => ({ ...f, [g.id]: g.password }));
                setGrantCompany('');
                api.clientAccess().then(setAccess);
              }}>
                Grant access
              </button>
            </div>
            {access.length > 0 && (
              <table className="list">
                <thead><tr><th>Company</th><th>Login ID</th><th>Password</th><th>Status</th><th /></tr></thead>
                <tbody>
                  {access.map((a) => (
                    <tr key={a.id}>
                      <td>{a.company}</td>
                      <td className="mono">{a.userId}</td>
                      <td className="mono">
                        {freshCreds[a.id] ? freshCreds[a.id] : '••••••••'}
                        <button className="btn danger-link" title="Regenerate password" onClick={async () => {
                          const r = await api.regenerateAccess(a.id);
                          setFreshCreds((f) => ({ ...f, [a.id]: r.password }));
                        }}>⟳</button>
                      </td>
                      <td>
                        <button className={`chip${a.active ? ' on' : ''}`} onClick={() => api.setAccessActive(a.id, !a.active).then(() => api.clientAccess().then(setAccess))}>
                          {a.active ? 'Active' : 'Revoked'}
                        </button>
                      </td>
                      <td><button className="btn danger-link" onClick={() => { if (confirmDelete(`access for ${a.company}`)) api.deleteAccess(a.id).then(() => api.clientAccess().then(setAccess)); }}>✕</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        )}
        {!isFull && <Card label="Settings & users"><div className="hint">Full Permissions are required to manage users, client access and firm settings.</div></Card>}
      </div>
    </div>
  );
}
