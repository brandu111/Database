import { useEffect, useMemo, useRef, useState } from 'react';
import { COMPANY_IMPORT_COLUMNS, COMPANY_IMPORT_EXAMPLE_ROW, fmtDate, IMPORT_COLUMN_NOTES, IMPORT_COLUMNS, IMPORT_EXAMPLE_ROW, jurList, MERGE_FIELDS, mergeTemplate, type EmailTemplate, type FirmSettings, type Mark, type Rule, type RuleBook } from '@brandu/shared';
import { api, uploadFile, type Me } from '../api';
import { parseCsv, toCsv } from '../csv';
import { SignatureEditor } from '../SignatureEditor';
import { Card, Field, confirmDelete } from '../ui';

export function Preferences({ isFull }: { isFull: boolean }) {
  const [tab, setTab] = useState<'rules' | 'templates' | 'settings' | 'data'>('rules');
  return (
    <>
      <div className="row" style={{ marginBottom: 14 }}>
        <button className={`chip${tab === 'rules' ? ' on' : ''}`} onClick={() => setTab('rules')}>Date Rules</button>
        <button className={`chip${tab === 'templates' ? ' on' : ''}`} onClick={() => setTab('templates')}>Email Templates</button>
        <button className={`chip${tab === 'settings' ? ' on' : ''}`} onClick={() => setTab('settings')}>Settings &amp; Users</button>
        {isFull && <button className={`chip${tab === 'data' ? ' on' : ''}`} onClick={() => setTab('data')}>Import / Data</button>}
      </div>
      {tab === 'rules' && <DateRules isFull={isFull} />}
      {tab === 'templates' && <EmailTemplates isFull={isFull} />}
      {tab === 'settings' && <SettingsUsers isFull={isFull} />}
      {tab === 'data' && isFull && <DataImport />}
    </>
  );
}

// ---------------------------------------------------------------------------- email templates

function EmailTemplates({ isFull }: { isFull: boolean }) {
  const [templates, setTemplates] = useState<EmailTemplate[] | null>(null);
  const [selId, setSelId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [fJur, setFJur] = useState('All');
  const [saveState, setSaveState] = useState('');
  const [showFields, setShowFields] = useState(false);

  const reload = () => api.templates().then((t) => setTemplates(t.sort((a, b) => (a.jurisdiction + a.stage).localeCompare(b.jurisdiction + b.stage))));
  useEffect(() => {
    reload();
  }, []);

  const jurs = useMemo(() => [...new Set((templates || []).map((t) => t.jurisdiction).filter(Boolean))].sort(), [templates]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (templates || []).filter(
      (t) =>
        (fJur === 'All' || t.jurisdiction === fJur) &&
        (!q || [t.ref, t.category, t.stage, t.subject, t.dateField].join(' ').toLowerCase().includes(q))
    );
  }, [templates, search, fJur]);

  const sel = (templates || []).find((t) => t.id === selId) || null;

  const patch = (p: Partial<EmailTemplate>) => {
    if (!sel) return;
    setTemplates((cur) => (cur ? cur.map((t) => (t.id === sel.id ? { ...t, ...p } : t)) : cur));
  };
  const save = async () => {
    if (!sel) return;
    setSaveState('Saving…');
    try {
      await api.saveTemplate(sel);
      setSaveState('Saved');
    } catch {
      setSaveState('Save failed — Full Permissions required');
    }
  };
  const addNew = async () => {
    const t = await api.createTemplate({ ref: '', jurisdiction: 'Australia', category: 'General', stage: 'New template', dateField: '', subject: '', body: '' });
    await reload();
    setSelId(t.id);
  };
  const importJson = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text());
      const r = await api.importTemplates(parsed);
      await reload();
      setSaveState(`Imported ${r.imported} template(s)`);
    } catch (e) {
      setSaveState(e instanceof Error ? `Import failed: ${e.message}` : 'Import failed');
    }
  };

  if (!templates) return <div className="hint">Loading…</div>;

  const sampleMark: Partial<Mark> = {
    name: 'EXAMPLE MARK',
    owner: 'Example Co Pty Ltd',
    jurisdiction: 'Australia',
    application: '2650000',
    registration: '2650000',
    classes: '9, 42',
    goods: 'Downloadable software; legal services',
    status: 'Registered',
    matter: '1234',
    ownerAcn: '600 123 456',
    ownerAbn: '12 600 123 456',
    dates: [
      { name: 'Application Filed', date: '2025-01-15', done: true },
      { name: 'Renewal Deadline', date: '2035-01-15', done: false },
      { name: 'OA Response Due', date: '2026-09-01', done: false },
    ],
    contacts: [{ name: 'Jane Client', company: '', position: 'Client', phone: '', email: '' }],
  };

  return (
    <div className="pref-layout">
      <div className="card" style={{ padding: 10 }}>
        <input type="text" placeholder="Search templates…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ marginBottom: 8 }} />
        <select value={fJur} onChange={(e) => setFJur(e.target.value)} style={{ marginBottom: 8 }}>
          <option value="All">All jurisdictions</option>
          {jurs.map((j) => <option key={j}>{j}</option>)}
        </select>
        <div className="hint" style={{ marginBottom: 6 }}>{filtered.length} of {templates.length}</div>
        <div style={{ maxHeight: 460, overflowY: 'auto' }}>
          {filtered.map((t) => (
            <div key={t.id} className={`jur-item${selId === t.id ? ' on' : ''}`} style={{ display: 'block' }} onClick={() => setSelId(t.id)}>
              <div style={{ fontWeight: selId === t.id ? 600 : 500 }}>{t.stage || t.subject || '(untitled)'}</div>
              <div className="hint">{[t.jurisdiction, t.category, t.ref && `Ref ${t.ref}`].filter(Boolean).join(' · ')}</div>
            </div>
          ))}
        </div>
      </div>

      <div>
        <Card
          label={sel ? 'Edit template' : 'Email templates'}
          right={
            isFull && (
              <div className="row">
                <button className="btn secondary small" onClick={() => setShowFields((v) => !v)}>{showFields ? 'Hide' : 'Merge'} fields</button>
                <label className="btn secondary small" style={{ cursor: 'pointer' }}>
                  Import JSON
                  <input type="file" accept="application/json,.json" style={{ display: 'none' }} onChange={(e) => { const f = e.target.files?.[0]; if (f) importJson(f); }} />
                </label>
                <button className="btn small" onClick={addNew}>+ New template</button>
                <span className="save-state">{saveState}</span>
              </div>
            )
          }
        >
          {showFields && (
            <div style={{ background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 12 }}>
              <div className="hint" style={{ marginBottom: 6 }}>Use these in the subject or body — either <code>[FieldName]</code> or <code>{'{{FieldName}}'}</code>. You can also use the name of <em>any</em> deadline on the case as a field (e.g. <code>[Renewal Deadline]</code>, <code>[OA Response Due]</code>) and it will merge that date. Tokens the system doesn't recognise (e.g. <code>[FEES]</code>) are left in place for you to complete. When a case has a logo/device graphic, the mark shows as the <em>image</em> in the email instead of the words.</div>
              <div className="grid3">
                {MERGE_FIELDS.map((g) => (
                  <div key={g.group}>
                    <div className="section-label" style={{ marginBottom: 4 }}>{g.group}</div>
                    {g.fields.map((f) => (
                      <div key={f.key} style={{ fontSize: 12, marginBottom: 2 }}><code>[{f.key}]</code> <span className="hint">{f.desc}</span></div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          )}

          {!sel && <div className="hint">Select a template on the left to edit it, add a new one, or import your templates from a JSON file. There are {templates.length} templates.</div>}

          {sel && (
            <>
              <div className="grid3">
                <Field label="Jurisdiction">
                  <input type="text" list="tpl-jur" value={sel.jurisdiction} disabled={!isFull} onChange={(e) => patch({ jurisdiction: e.target.value })} />
                  <datalist id="tpl-jur">{jurList().map((j) => <option key={j} value={j} />)}</datalist>
                </Field>
                <Field label="Category"><input type="text" value={sel.category} disabled={!isFull} onChange={(e) => patch({ category: e.target.value })} /></Field>
                <Field label="Reference"><input type="text" value={sel.ref} disabled={!isFull} onChange={(e) => patch({ ref: e.target.value })} /></Field>
              </div>
              <div className="grid2">
                <Field label="Name / stage"><input type="text" value={sel.stage} disabled={!isFull} onChange={(e) => patch({ stage: e.target.value })} /></Field>
                <Field label="Attach to date (optional)">
                  <input type="text" value={sel.dateField} disabled={!isFull} onChange={(e) => patch({ dateField: e.target.value })} placeholder="e.g. Renewal Deadline" />
                </Field>
              </div>
              <Field label="Subject"><input type="text" value={sel.subject} disabled={!isFull} onChange={(e) => patch({ subject: e.target.value })} /></Field>
              <Field label="Body"><textarea rows={12} value={sel.body} disabled={!isFull} onChange={(e) => patch({ body: e.target.value })} /></Field>
              {isFull && (
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <button className="btn danger-link" onClick={() => { if (confirmDelete('this template')) api.deleteTemplate(sel.id).then(() => { setSelId(null); reload(); }); }}>Delete template</button>
                  <button className="btn" onClick={save}>Save template</button>
                </div>
              )}
              <div style={{ marginTop: 14 }}>
                <div className="section-label">Preview (sample data)</div>
                <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6 }}>{mergeTemplate(sel.subject, sampleMark) || '(no subject)'}</div>
                  <div style={{ whiteSpace: 'pre-wrap', fontSize: 13 }}>{mergeTemplate(sel.body, sampleMark) || '(no body)'}</div>
                </div>
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
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
  const [users, setUsers] = useState<{ id: string; name: string; level: string; email?: string; title?: string }[]>([]);
  const [access, setAccess] = useState<{ id: string; company: string; userId: string; active: number; createdAt: string }[]>([]);
  const [companies, setCompanies] = useState<string[]>([]);
  const [grantCompany, setGrantCompany] = useState('');
  const [freshCreds, setFreshCreds] = useState<Record<string, string>>({});
  const [newUser, setNewUser] = useState({ name: '', level: 'Edit Only', password: '' });
  const [saveState, setSaveState] = useState('');
  const [me, setMe] = useState<Me | null>(null);
  const [mySig, setMySig] = useState('');
  const [sigState, setSigState] = useState('');
  const [myEmail, setMyEmail] = useState('');
  const [emailState, setEmailState] = useState('');
  const [mailConfigured, setMailConfigured] = useState(false);
  const [testState, setTestState] = useState('');
  const sigTimer = useRef<number | null>(null);
  const emailTimer = useRef<number | null>(null);

  useEffect(() => {
    api.settings().then(setFs);
    api.me().then((m) => { setMe(m); if (m.kind === 'staff') { setMySig(m.signature || ''); setMyEmail(m.email || ''); } }, () => undefined);
    api.mailStatus().then((s) => setMailConfigured(s.configured), () => undefined);
    api.companies().then((cs) => setCompanies(cs.map((c) => c.name).filter(Boolean).sort()), () => undefined);
    if (isFull) {
      api.users().then(setUsers, () => undefined);
      api.clientAccess().then(setAccess, () => undefined);
    }
  }, [isFull]);

  const onMyEmail = (email: string) => {
    setMyEmail(email);
    setEmailState('Saving…');
    if (emailTimer.current) window.clearTimeout(emailTimer.current);
    emailTimer.current = window.setTimeout(() => {
      api.saveMyEmail(email).then(() => setEmailState('Saved'), () => setEmailState('Save failed'));
    }, 700);
  };

  const sendTest = () => {
    setTestState('Sending…');
    api.sendTestMail().then((r) => setTestState(`Sent to ${r.to}`), (e) => setTestState(e instanceof Error ? e.message : 'Failed'));
  };

  // Save the current user's signature, debounced so typing doesn't hammer the API.
  const onMySig = (html: string) => {
    setMySig(html);
    setSigState('Saving…');
    if (sigTimer.current) window.clearTimeout(sigTimer.current);
    sigTimer.current = window.setTimeout(() => {
      api.saveMySignature(html).then(() => setSigState('Saved'), () => setSigState('Save failed'));
    }, 700);
  };

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
          <Field label="Default firm sign-off (fallback for staff without their own)">
            <textarea rows={4} value={fs.emailSignature || ''} disabled={ro} onChange={(e) => saveSettings({ ...fs, emailSignature: e.target.value })}
              placeholder={'Kind regards,\n\nBrandU Legal\nTrade Mark Attorneys'} />
          </Field>
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

        {me?.kind === 'staff' && (
          <Card label="My email sign-off" right={<span className="save-state">{sigState}</span>}>
            <Field label="My email address (for alert notifications)">
              <input type="email" value={myEmail} onChange={(e) => onMyEmail(e.target.value)} placeholder="you@brandu.legal" />
              <div className="hint" style={{ marginTop: 2 }}>
                {emailState || 'Where “action required” alerts and your daily digest are sent.'}
                {' · '}
                {mailConfigured ? (
                  <>Email is set up. <button className="btn secondary small" style={{ marginLeft: 4 }} onClick={sendTest}>Send test</button> {testState}</>
                ) : (
                  <span style={{ color: 'var(--danger)' }}>Automatic emails are off until the mail server is configured (see the deploy notes).</span>
                )}
              </div>
            </Field>
            <div className="hint" style={{ marginBottom: 8 }}>
              Your personal sign-off, used by the <code>[Signature]</code> field when you send an email from a case. It sends as formatted HTML, so a logo or formatting comes across. This is yours alone — each staff member sets their own.
            </div>
            <SignatureEditor value={mySig} onChange={onMySig} />
          </Card>
        )}

        {isFull && (
          <Card label="Staff users" right={mailConfigured ? <button className="btn secondary small" onClick={() => api.runDailyDigest().then((r) => window.alert(`Digest sent to ${r.sent} user(s).`), (e) => window.alert(e instanceof Error ? e.message : 'Failed'))}>Send digest now</button> : undefined}>
            <table className="list">
              <thead><tr><th>Name</th><th>Title</th><th>Email</th><th>Permission level</th><th>Password</th><th /></tr></thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>{u.name}</td>
                    <td>
                      <input type="text" defaultValue={u.title || ''} placeholder="e.g. Principal" style={{ minWidth: 130 }}
                        onBlur={(e) => { if (e.target.value !== (u.title || '')) api.updateUser(u.id, { title: e.target.value }).then(() => api.users().then(setUsers)); }} />
                    </td>
                    <td>
                      <input type="email" defaultValue={u.email || ''} placeholder="—" style={{ minWidth: 160 }}
                        onBlur={(e) => { if (e.target.value !== (u.email || '')) api.updateUser(u.id, { email: e.target.value }).then(() => api.users().then(setUsers)); }} />
                    </td>
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

// ---------------------------------------------------------------------------- import / data

function DataImport() {
  const [rows, setRows] = useState<Record<string, string>[] | null>(null);
  const [fileName, setFileName] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ imported: number; total: number; errors: { line: number; error: string }[] } | null>(null);
  const [delText, setDelText] = useState('');
  const [delMsg, setDelMsg] = useState('');
  const [crows, setCrows] = useState<Record<string, string>[] | null>(null);
  const [cfileName, setCfileName] = useState('');
  const [cbusy, setCbusy] = useState(false);
  const [cresult, setCresult] = useState<{ created: number; merged: number; contacts: number; skipped: number; total: number } | null>(null);
  const [logoBusy, setLogoBusy] = useState(false);
  const [logoMsg, setLogoMsg] = useState('');
  const [logoOverwrite, setLogoOverwrite] = useState(false);
  const [alertCutoff, setAlertCutoff] = useState('2026-06-01');
  const [alertMsg, setAlertMsg] = useState('');
  const [alertBusy, setAlertBusy] = useState(false);

  const clearOldAlerts = async () => {
    if (!window.confirm(`Mark every outstanding deadline, reminder and flagged action dated before ${alertCutoff} as done? They'll be cleared from Alerts but kept on each case as history.`)) return;
    setAlertBusy(true);
    try {
      const r = await api.clearOldAlerts(alertCutoff);
      setAlertMsg(`Cleared ${r.markDates + r.actions + r.oppDates} item(s) before ${r.before} (${r.markDates} case dates, ${r.actions} actions, ${r.oppDates} opposition dates).`);
    } catch (e) {
      setAlertMsg(e instanceof Error ? e.message : 'Failed.');
    } finally {
      setAlertBusy(false);
    }
  };

  const importLogoFiles = async (files: FileList | null) => {
    if (!files || !files.length) return;
    setLogoBusy(true);
    try {
      // Pre-match filenames against case app/reg/our-ref so we only upload files
      // that will attach (same normalisation as the server).
      const key = (s: string) => (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
      const marks = await api.marks();
      const known = new Set<string>();
      marks.forEach((m) => { [m.application, m.registration, m.matter].forEach((v) => { if (v) known.add(key(v)); }); });
      const list: { name: string; url: string }[] = [];
      const skippedNames: string[] = [];
      let i = 0;
      for (const f of Array.from(files)) {
        i++;
        const base = f.name.replace(/\.[^.]+$/, '');
        if (!known.has(key(base))) { skippedNames.push(f.name); continue; }
        setLogoMsg(`Uploading logo files… ${i} of ${files.length}`);
        const up = await uploadFile(f);
        list.push({ name: f.name, url: up.url });
      }
      if (!list.length) { setLogoMsg(`None of the ${files.length} files matched a case by application no. / registration no. / our ref. Check the filenames.`); return; }
      const r = await api.attachLogos(list, logoOverwrite);
      const extra = skippedNames.length ? ` ${skippedNames.length} file(s) didn’t match any case.` : '';
      setLogoMsg(`Attached logos to ${r.marksUpdated} case${r.marksUpdated === 1 ? '' : 's'} from ${r.filesMatched} file(s).${extra}`);
    } catch (e) {
      setLogoMsg(e instanceof Error ? e.message : 'Logo file import failed.');
    } finally {
      setLogoBusy(false);
    }
  };

  const fetchAuLogos = async () => {
    setLogoBusy(true);
    let offset = 0, total = 0, updated = 0;
    try {
      do {
        const r = await api.fetchAuLogos(offset);
        offset = r.offset; total = r.total; updated += r.updated;
        setLogoMsg(`Fetching Australian logos… ${Math.min(offset, total)} of ${total} checked, ${updated} logos added.`);
      } while (offset < total);
      setLogoMsg(`Done — ${updated} Australian logo${updated === 1 ? '' : 's'} added from the register. Now click "Copy logos to related cases" to fill Madrid and overseas filings.`);
    } catch (e) {
      setLogoMsg(e instanceof Error ? e.message : 'Logo fetch failed.');
    } finally {
      setLogoBusy(false);
    }
  };

  const propagateLogos = async () => {
    setLogoBusy(true);
    try {
      const r = await api.propagateLogos();
      setLogoMsg(`Copied logos onto ${r.updated} related case${r.updated === 1 ? '' : 's'} (Madrid + overseas filings that share an owner and mark name with a case that has a logo).`);
    } catch (e) {
      setLogoMsg(e instanceof Error ? e.message : 'Copy failed.');
    } finally {
      setLogoBusy(false);
    }
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setResult(null);
    setFileName(f.name);
    try {
      const text = await f.text();
      setRows(parseCsv(text));
    } catch {
      setRows([]);
    }
  };

  const doImport = async () => {
    if (!rows?.length) return;
    setBusy(true);
    try {
      setResult(await api.importMarks(rows));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
    }
  };

  const downloadTemplate = () => {
    const csv = toCsv(IMPORT_COLUMNS, [IMPORT_EXAMPLE_ROW]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'brandu-cases-template.csv';
    a.click();
  };

  const downloadCompanyTemplate = () => {
    const csv = toCsv(COMPANY_IMPORT_COLUMNS, [COMPANY_IMPORT_EXAMPLE_ROW]);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
    a.download = 'brandu-contacts-template.csv';
    a.click();
  };

  const onCompanyFile = async (f: File | undefined) => {
    if (!f) return;
    setCresult(null);
    setCfileName(f.name);
    try { setCrows(parseCsv(await f.text())); } catch { setCrows([]); }
  };

  const doCompanyImport = async () => {
    if (!crows?.length) return;
    setCbusy(true);
    try { setCresult(await api.importCompanies(crows)); }
    catch (e) { window.alert(e instanceof Error ? e.message : 'Import failed.'); }
    finally { setCbusy(false); }
  };

  const deleteAll = async () => {
    if (delText !== 'DELETE') return;
    if (!window.confirm('This permanently deletes EVERY case in the portal. This cannot be undone. Continue?')) return;
    setBusy(true);
    setDelMsg('');
    try {
      const r = await api.deleteAllMarks();
      setDelMsg(`Deleted ${r.deleted} case(s). You can now import your data.`);
      setDelText('');
    } catch (e) {
      setDelMsg(e instanceof Error ? e.message : 'Delete failed.');
    } finally {
      setBusy(false);
    }
  };

  const preview = (rows || []).slice(0, 5);

  return (
    <div className="detail-cols">
      <div>
        <Card label="Import contacts / companies from CSV">
          <div className="hint" style={{ marginBottom: 10 }}>
            One row per contact; rows sharing a <code>CompanyName</code> are merged into a single company with multiple contacts. Best done <strong>before</strong> importing cases, so each case’s owner links to its contact record. Re-importing is safe — an existing company gains any new contacts rather than being duplicated.
          </div>
          <div className="row" style={{ marginBottom: 10 }}>
            <button className="btn secondary" onClick={downloadCompanyTemplate}>⬇ Download contacts template</button>
            <label className="btn" style={{ cursor: 'pointer' }}>
              ⬆ Choose CSV file
              <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => { onCompanyFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
            </label>
          </div>
          {crows && (
            <>
              <div className="hint" style={{ marginBottom: 6 }}><strong>{cfileName}</strong> — {crows.length} contact row{crows.length === 1 ? '' : 's'} found.</div>
              {crows.length > 0
                ? <button className="btn" disabled={cbusy} onClick={doCompanyImport}>{cbusy ? 'Importing…' : `Import ${crows.length} contact row${crows.length === 1 ? '' : 's'}`}</button>
                : <div className="hint" style={{ color: 'var(--danger)' }}>No rows found — check the file has a header row.</div>}
            </>
          )}
          {cresult && (
            <div style={{ marginTop: 12, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
              <strong>{cresult.created} companies created, {cresult.merged} updated, {cresult.contacts} contacts added.</strong>
              {cresult.skipped > 0 && <div className="hint" style={{ marginTop: 4 }}>{cresult.skipped} row(s) skipped (no company name).</div>}
            </div>
          )}
        </Card>

        <Card label="Import cases from CSV">
          <div className="hint" style={{ marginBottom: 10 }}>
            One row per case. Download the template, fill it in (or map your export to the same column names), then upload it here. Dates can be <code>dd/mm/yyyy</code>. Renewal dates and reminders are calculated automatically from the filing/registration dates — you only need <code>RenewalDate</code> if a case renews on a non-standard date.
          </div>
          <div className="row" style={{ marginBottom: 10 }}>
            <button className="btn secondary" onClick={downloadTemplate}>⬇ Download CSV template</button>
            <label className="btn" style={{ cursor: 'pointer' }}>
              ⬆ Choose CSV file
              <input type="file" accept=".csv,text/csv" style={{ display: 'none' }} onChange={(e) => { onFile(e.target.files?.[0]); e.currentTarget.value = ''; }} />
            </label>
          </div>

          {rows && (
            <>
              <div className="hint" style={{ marginBottom: 6 }}>
                <strong>{fileName}</strong> — {rows.length} case{rows.length === 1 ? '' : 's'} found.
              </div>
              {rows.length > 0 && (
                <>
                  <table className="list" style={{ marginBottom: 10 }}>
                    <thead><tr><th>Mark</th><th>Jurisdiction</th><th>Status</th><th>App / Reg</th></tr></thead>
                    <tbody>
                      {preview.map((r, i) => (
                        <tr key={i}>
                          <td>{r.MarkName || r.markname || r.Mark || <span className="hint">— (missing name)</span>}</td>
                          <td>{r.Jurisdiction || r.jurisdiction || '—'}</td>
                          <td>{r.Status || r.status || '—'}</td>
                          <td>{r.ApplicationNo || r.RegistrationNo || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {rows.length > preview.length && <div className="hint" style={{ marginBottom: 8 }}>…and {rows.length - preview.length} more.</div>}
                  <button className="btn" disabled={busy} onClick={doImport}>{busy ? 'Importing…' : `Import ${rows.length} case${rows.length === 1 ? '' : 's'}`}</button>
                </>
              )}
              {rows.length === 0 && <div className="hint" style={{ color: 'var(--danger)' }}>No rows found — check the file has a header row and at least one case.</div>}
            </>
          )}

          {result && (
            <div style={{ marginTop: 12, background: 'var(--panel)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
              <div><strong>Imported {result.imported} of {result.total}.</strong></div>
              {result.errors.length > 0 && (
                <div style={{ marginTop: 6 }}>
                  <div className="hint" style={{ color: 'var(--danger)' }}>{result.errors.length} row(s) skipped:</div>
                  <ul style={{ margin: '4px 0 0 18px' }}>
                    {result.errors.slice(0, 20).map((e, i) => <li key={i} className="hint">Row {e.line}: {e.error}</li>)}
                  </ul>
                </div>
              )}
              {result.imported > 0 && <div className="hint" style={{ marginTop: 6 }}>Open the Trade Marks tab to see them. Renewal deadlines and reminders have been calculated.</div>}
            </div>
          )}
        </Card>

        <Card label="Recompute all deadlines">
          <div className="hint" style={{ marginBottom: 8 }}>
            Re-runs the deadline engine over every existing case so new rules — the automatic 1-week reminders, the Mexico declaration-of-use dates, the USA maintenance reminders, and so on — backfill onto cases that were entered earlier. Safe to run any time; only auto-generated rows are recomputed and Madrid families re-link correctly.
          </div>
          <button className="btn secondary small" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await api.recomputeAll();
              const msg = `Recomputed ${r.recomputed} case${r.recomputed === 1 ? '' : 's'}.`;
              window.alert(r.failed?.length ? `${msg}\n\n${r.failed.length} could not be recomputed:\n${r.failed.slice(0, 10).map((f) => `• ${f.name}: ${f.error}`).join('\n')}` : msg);
            } catch (e) {
              window.alert(e instanceof Error ? e.message : 'Recompute failed.');
            } finally {
              setBusy(false);
            }
          }}>{busy ? 'Working…' : 'Recompute all cases'}</button>
        </Card>

        <Card label="Logos — fetch &amp; copy">
          <div className="hint" style={{ marginBottom: 8 }}>
            Imported cases have no logos (the data export contained none). Word marks don’t need one. For logo / combined / stylised marks:
            <ol style={{ margin: '6px 0 0 18px' }}>
              <li><strong>Fetch Australian logos</strong> — pulls the graphic from the IP Australia register for every Australian logo case.</li>
              <li><strong>Copy logos to related cases</strong> — copies each logo onto Madrid and overseas filings of the same mark (matched by owner + mark name). Fill-empty only; never overwrites.</li>
            </ol>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn secondary small" disabled={logoBusy} onClick={fetchAuLogos}>{logoBusy ? 'Working…' : '1. Fetch Australian logos'}</button>
            <button className="btn secondary small" disabled={logoBusy} onClick={propagateLogos}>2. Copy logos to related cases</button>
          </div>
          <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10 }}>
            <div className="hint" style={{ marginBottom: 6 }}>
              <strong>3. Import logo files</strong> — for anything the steps above can’t fill (e.g. overseas marks with no Australian equivalent). Name each image file by the case’s <strong>application no.</strong>, <strong>registration no.</strong>, or <strong>our ref</strong> (e.g. <code>2345678.png</code> or <code>TM-1001.jpg</code>), then select them all here. A ref shared by a family attaches to every case in it.
            </div>
            <label className="row" style={{ gap: 6, marginBottom: 6, cursor: 'pointer' }}>
              <input type="checkbox" checked={logoOverwrite} onChange={(e) => setLogoOverwrite(e.target.checked)} />
              <span className="hint">Overwrite existing logos (otherwise only fills cases that have none)</span>
            </label>
            <label className="btn secondary small" style={{ cursor: logoBusy ? 'default' : 'pointer', display: 'inline-block' }}>
              ⬆ Choose logo files
              <input type="file" accept="image/*" multiple disabled={logoBusy} style={{ display: 'none' }}
                onChange={(e) => { importLogoFiles(e.target.files); e.currentTarget.value = ''; }} />
            </label>
          </div>
          {logoMsg && <div className="hint" style={{ marginTop: 8 }}>{logoMsg}</div>}
        </Card>

        <Card label="Link Madrid families">
          <div className="hint" style={{ marginBottom: 8 }}>
            Groups imported cases into their Madrid families using the international registration number embedded in the application / registration fields (e.g. <code>IR No.1683883</code>), so the International Registration, its designations <strong>and the originating AU/NZ basic case</strong> show as related. Also moves the IR number into its own field and tidies the application/registration numbers (leaving the national number). Preserves the imported dates. Safe to run again.
          </div>
          <button className="btn secondary small" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await api.linkMadrid();
              window.alert(`Linked ${r.linked} case(s) into ${r.families} Madrid famil${r.families === 1 ? 'y' : 'ies'} (incl. ${r.auBasicsLinked} AU/NZ basic case(s)). IR numbers moved to their own field and the number fields tidied.`);
            } catch (e) {
              window.alert(e instanceof Error ? e.message : 'Linking failed.');
            } finally {
              setBusy(false);
            }
          }}>{busy ? 'Working…' : 'Link Madrid families'}</button>
        </Card>

        <Card label="Tidy up old alerts">
          <div className="hint" style={{ marginBottom: 8 }}>
            Marks every outstanding deadline, reminder and flagged action dated <strong>before</strong> the date below as done, so historical items stop cluttering the Alerts list and the overdue count. They stay on each case as ticked history. Future deadlines are untouched.
          </div>
          <div className="row" style={{ gap: 8, alignItems: 'center' }}>
            <span className="hint">Clear items before</span>
            <input type="date" value={alertCutoff} onChange={(e) => setAlertCutoff(e.target.value)} style={{ width: 150 }} />
            <button className="btn secondary small" disabled={alertBusy || !alertCutoff} onClick={clearOldAlerts}>{alertBusy ? 'Working…' : 'Clear old alerts'}</button>
          </div>
          {alertMsg && <div className="hint" style={{ marginTop: 8 }}>{alertMsg}</div>}
        </Card>

        <Card label="⚠ Danger zone — delete all cases">
          <div className="hint" style={{ marginBottom: 8 }}>
            Removes <strong>every</strong> case from the portal so you can start fresh before importing. This cannot be undone — take a backup of <code>data/brandu.sqlite</code> on the server first. Oppositions, contacts and templates are not affected.
          </div>
          <div className="row">
            <input type="text" placeholder="Type DELETE to confirm" value={delText} onChange={(e) => setDelText(e.target.value)} style={{ maxWidth: 220 }} />
            <button className="btn danger-link" disabled={busy || delText !== 'DELETE'} onClick={deleteAll} style={{ border: '1px solid var(--danger)', borderRadius: 8, padding: '6px 12px' }}>
              Delete all cases
            </button>
          </div>
          {delMsg && <div className="hint" style={{ marginTop: 8 }}>{delMsg}</div>}
        </Card>
      </div>

      <div>
        <Card label="Column reference">
          <div className="hint" style={{ marginBottom: 8 }}>Column headers are matched loosely (case and spacing don’t matter). Only <strong>MarkName</strong> is required.</div>
          <table className="list">
            <thead><tr><th>Column</th><th>Meaning</th></tr></thead>
            <tbody>
              {IMPORT_COLUMNS.map((c) => (
                <tr key={c}><td style={{ whiteSpace: 'nowrap', fontWeight: 600 }}>{c}</td><td className="hint">{IMPORT_COLUMN_NOTES[c] || ''}</td></tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>
    </div>
  );
}
