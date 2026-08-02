import { useEffect, useMemo, useRef, useState } from 'react';
import { COMPANY_IMPORT_COLUMNS, COMPANY_IMPORT_EXAMPLE_ROW, fmtDate, IMPORT_COLUMN_NOTES, IMPORT_COLUMNS, IMPORT_EXAMPLE_ROW, jurList, MERGE_FIELDS, mergeTemplate, mergeTemplateHtml, stripInlineFormat, type EmailTemplate, type FirmSettings, type Mark, type Rule, type RuleBook } from '@brandu/shared';
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
  const bodyRef = useRef<HTMLTextAreaElement>(null);

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
  // Wrap the current selection in the Body with a formatting marker
  // (** for bold, __ for underline). Restores the selection after the edit.
  const wrapBody = (marker: string) => {
    const ta = bodyRef.current;
    if (!ta || !sel) return;
    const start = ta.selectionStart, end = ta.selectionEnd;
    const val = sel.body || '';
    const chosen = val.slice(start, end) || 'text';
    patch({ body: val.slice(0, start) + marker + chosen + marker + val.slice(end) });
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(start + marker.length, start + marker.length + chosen.length);
    });
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
              <Field label="Body">
                {isFull && (
                  <div className="row" style={{ gap: 6, marginBottom: 4 }}>
                    <button type="button" className="btn secondary small" style={{ fontWeight: 700 }} title="Bold the selected text" onClick={() => wrapBody('**')}>B</button>
                    <button type="button" className="btn secondary small" style={{ textDecoration: 'underline' }} title="Underline the selected text" onClick={() => wrapBody('__')}>U</button>
                    <span className="hint">Select text, then click B or U. It shows formatted in the email (preview below).</span>
                  </div>
                )}
                <textarea ref={bodyRef} rows={12} value={sel.body} disabled={!isFull} onChange={(e) => patch({ body: e.target.value })} />
              </Field>
              {isFull && (
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <button className="btn danger-link" onClick={() => { if (confirmDelete('this template')) api.deleteTemplate(sel.id).then(() => { setSelId(null); reload(); }); }}>Delete template</button>
                  <button className="btn" onClick={save}>Save template</button>
                </div>
              )}
              <div style={{ marginTop: 14 }}>
                <div className="section-label">Preview (sample data)</div>
                <div style={{ background: '#fff', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px' }}>
                  <div style={{ fontWeight: 600, marginBottom: 6, color: '#16233b' }}>{stripInlineFormat(mergeTemplate(sel.subject, sampleMark)) || '(no subject)'}</div>
                  <div style={{ fontSize: 13, color: '#16233b', lineHeight: 1.5 }} dangerouslySetInnerHTML={{ __html: mergeTemplateHtml(sel.body, sampleMark) || '(no body)' }} />
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
  const [prefKey, setPrefKey] = useState('_master');
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState(-1);
  const [saveState, setSaveState] = useState('');
  const [copyOpen, setCopyOpen] = useState(false);

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
  const label = prefKey === '_master' ? 'Master date list' : prefKey === '_default' ? 'Baseline rules' : `${prefKey} rules`;

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
        <div className={`jur-item${prefKey === '_master' ? ' on' : ''}`} onClick={() => { setPrefKey('_master'); setExpanded(-1); }}>
          <span>★ Master date list</span>
          <span className="hint">{(rules._master || []).length}</span>
        </div>
        <div className={`jur-item${prefKey === '_default' ? ' on' : ''}`} onClick={() => { setPrefKey('_default'); setExpanded(-1); }}>
          <span>Baseline (all jurisdictions)</span>
          <span className="hint">{(rules._default || []).length}</span>
        </div>
        {jurs.map((j) => {
          const n = (rules[j] || []).length;
          return (
            <div key={j} className={`jur-item${prefKey === j ? ' on' : ''}`} onClick={() => { setPrefKey(j); setExpanded(-1); }}>
              <span>{j}</span>
              <span className="hint" style={{ color: n ? undefined : 'var(--danger)' }}>{n || 'none'}</span>
            </div>
          );
        })}
      </div>

      <div>
        <Card
          label={label}
          right={
            <div className="row">
              <span className="hint">rules v{rulesVersion ?? '…'} · offsets from trigger date · date format {fmtDate('2009-01-01')}</span>
              {isFull && cur.length > 0 && (
                <button className="btn secondary small" onClick={() => setCopyOpen(true)}>Copy to jurisdictions…</button>
              )}
              {isFull && prefKey !== '_default' && prefKey !== '_master' && cur.length === 0 && (
                <button className="btn secondary small" onClick={() => persist(prefKey, JSON.parse(JSON.stringify(rules._master?.length ? rules._master : rules._default || [])))}>
                  Copy master list
                </button>
              )}
              {isFull && (
                <button className="btn small" onClick={() => persist(prefKey, [...cur, { name: 'New date', trigger: 'Application Filed', v: 1, u: 'months', alerts: true, template: '', custom: true }])}>
                  + Add date
                </button>
              )}
              <span className="save-state">{saveState}</span>
            </div>
          }
        >
          {prefKey === '_master' && (
            <div className="hint" style={{ marginBottom: 8 }}>
              Your central catalogue of dates. It is <strong>not</strong> applied to any case on its own — build it here, then use <strong>Copy to jurisdictions…</strong> to push these dates onto jurisdictions that have none (e.g. countries with no official source-of-truth timeline).
            </div>
          )}
          {cur.length === 0 && prefKey !== '_master' && <div className="hint">No dates for this jurisdiction — the baseline applies. Use “Copy master list” or the master list’s “Copy to jurisdictions…” to give it a set of dates.</div>}
          {cur.length === 0 && prefKey === '_master' && <div className="hint">The master list is empty. Add dates with “+ Add date”.</div>}
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
                    onDelete={() => { if (confirmDelete(`date "${r.name}"`)) persist(prefKey, cur.filter((_, j) => j !== i)); }} />
                ))}
              </tbody>
            </table>
          )}
        </Card>
        <div className="hint">
          Built-in rules are statutory periods reviewed with the client; changing them here is firm policy. Dates you add are marked custom and survive rulebook upgrades.
        </div>
      </div>

      {copyOpen && (
        <CopyDatesModal
          source={prefKey}
          sourceLabel={label}
          dates={cur}
          rules={rules}
          onClose={() => setCopyOpen(false)}
          onDone={(updated) => { setRules(updated); setCopyOpen(false); }}
        />
      )}
    </div>
  );
}

function CopyDatesModal({ source, sourceLabel, dates, rules, onClose, onDone }: {
  source: string;
  sourceLabel: string;
  dates: Rule[];
  rules: RuleBook;
  onClose: () => void;
  onDone: (updated: RuleBook) => void;
}) {
  const all = useMemo(() => jurList().filter((j) => j !== source), [source]);
  const [search, setSearch] = useState('');
  const [targets, setTargets] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const shown = useMemo(() => {
    const s = search.trim().toLowerCase();
    return all.filter((j) => !s || j.toLowerCase().includes(s));
  }, [all, search]);
  const emptyOnes = useMemo(() => all.filter((j) => !(rules[j] || []).length), [all, rules]);

  const toggle = (j: string) => setTargets((cur) => {
    const n = new Set(cur);
    if (n.has(j)) n.delete(j); else n.add(j);
    return n;
  });

  const run = async () => {
    if (!targets.size) { setErr('Pick at least one jurisdiction.'); return; }
    setBusy(true);
    setErr('');
    try {
      const r = await api.copyRules(source, Array.from(targets), mode);
      onDone(r.rules);
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Copy failed.');
      setBusy(false);
    }
  };

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(22,35,59,0.4)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', zIndex: 50, padding: '40px 16px', overflowY: 'auto' }} onClick={() => !busy && onClose()}>
      <div className="card" style={{ maxWidth: 640, width: '100%', margin: 0 }} onClick={(e) => e.stopPropagation()}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 4 }}>
          <div className="section-label" style={{ marginBottom: 0 }}>Copy dates to jurisdictions</div>
          <button className="btn danger-link" onClick={() => !busy && onClose()}>✕</button>
        </div>
        <div className="hint" style={{ marginBottom: 10 }}>
          Copies the <strong>{dates.length}</strong> date{dates.length === 1 ? '' : 's'} from <strong>{sourceLabel}</strong> onto the jurisdictions you tick below. Existing cases update the next time they’re saved or when you run “Recompute all”.
        </div>
        <div className="row" style={{ gap: 12, marginBottom: 8 }}>
          <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="radio" checked={mode === 'merge'} onChange={() => setMode('merge')} />
            <span className="hint">Add missing dates only (keep what’s there)</span>
          </label>
          <label className="row" style={{ gap: 6, cursor: 'pointer' }}>
            <input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} />
            <span className="hint">Replace the target’s dates</span>
          </label>
        </div>
        <div className="row" style={{ gap: 8, marginBottom: 6 }}>
          <input type="text" placeholder="Find jurisdiction…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ flex: 1 }} />
          <button className="btn secondary small" title="Select every jurisdiction that has no dates yet" onClick={() => setTargets(new Set(emptyOnes))}>Select empty ({emptyOnes.length})</button>
          <button className="btn secondary small" onClick={() => setTargets(new Set(shown))}>Select shown</button>
          <button className="btn secondary small" onClick={() => setTargets(new Set())}>Clear</button>
        </div>
        <div style={{ maxHeight: 300, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 8 }}>
          <div className="grid2" style={{ gap: '2px 14px' }}>
            {shown.map((j) => {
              const n = (rules[j] || []).length;
              return (
                <label key={j} className="row" style={{ gap: 6, cursor: 'pointer' }}>
                  <input type="checkbox" checked={targets.has(j)} onChange={() => toggle(j)} />
                  <span>{j}</span>
                  <span className="hint" style={{ color: n ? undefined : 'var(--danger)' }}>{n ? `${n}` : 'none'}</span>
                </label>
              );
            })}
          </div>
        </div>
        {err && <div className="err" style={{ marginTop: 8 }}>{err}</div>}
        <div className="row" style={{ justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
          <button className="btn secondary small" onClick={() => !busy && onClose()}>Cancel</button>
          <button className="btn small" disabled={busy || !targets.size} onClick={run}>
            {busy ? 'Copying…' : `Copy to ${targets.size} jurisdiction${targets.size === 1 ? '' : 's'}`}
          </button>
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
            <option value="business days">business days</option>
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
          <div className="grid2">
            <Field label="Documents folder"><input type="text" value={fs.documentsFolder} disabled={ro} onChange={(e) => saveSettings({ ...fs, documentsFolder: e.target.value })} /></Field>
            <Field label="“OA Issued?” prompt — months after filing">
              <input type="number" min={1} max={60} value={fs.caseUpdateMonths ?? 3} disabled={ro}
                onChange={(e) => saveSettings({ ...fs, caseUpdateMonths: Math.max(1, Math.min(60, parseInt(e.target.value, 10) || 3)) })} />
              <div className="hint" style={{ marginTop: 2 }}>The automatic “OA Issued?” prompt falls this many months after each application is filed. Changes apply to new filings; run “Recompute all” to update existing cases.</div>
            </Field>
          </div>
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
  const [prog, setProg] = useState('');
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
  const [pinBusy, setPinBusy] = useState(false);
  const [hsBusy, setHsBusy] = useState(false);
  const [hsMsg, setHsMsg] = useState('');
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMsg, setSyncMsg] = useState('');
  const [syncLog, setSyncLog] = useState<{ name: string; number: string; changes: string[] }[]>([]);
  const [actionsBusy, setActionsBusy] = useState(false);
  const [actionsResult, setActionsResult] = useState<{ imported: number; skipped: number; unmatched: number; unmatchedList: { trademark: string; jurisdiction: string; dateName: string }[]; casesChanged: number } | null>(null);

  const importActionsFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setActionsBusy(true);
    setActionsResult(null);
    try {
      setActionsResult(await api.importActions(parseCsv(await f.text())));
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setActionsBusy(false);
    }
  };
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [verifyResult, setVerifyResult] = useState<{ checked: number; matched: number; unmatched: number; mismatchCount: number; mismatches: { name: string; jur: string; field: string; source: string; current: string }[] } | null>(null);

  const verifyAgainstFile = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setVerifyBusy(true);
    setVerifyResult(null);
    setProg('');
    try {
      const all = parseCsv(await f.text());
      // Same as the full import: batch so the big mirror file clears the proxy.
      const CHUNK = 100;
      let checked = 0, matched = 0, unmatched = 0, mismatchCount = 0;
      const mismatches: { name: string; jur: string; field: string; source: string; current: string }[] = [];
      for (let i = 0; i < all.length; i += CHUNK) {
        const r = await api.verifyImport(all.slice(i, i + CHUNK));
        checked += r.checked; matched += r.matched; unmatched += r.unmatched; mismatchCount += r.mismatchCount;
        r.mismatches.forEach((m) => mismatches.push(m));
        setProg(`Verifying… ${Math.min(i + CHUNK, all.length)} of ${all.length} cases`);
      }
      setVerifyResult({ checked, matched, unmatched, mismatchCount, mismatches });
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Verify failed.');
    } finally {
      setVerifyBusy(false);
      setProg('');
    }
  };

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
    let offset = 0, total = 0, updated = 0, withUrl = 0, noImg = 0, dlFail = 0, noNum = 0;
    let notFound = 0, rateLimited = 0, authErr = 0, otherErr = 0, already = 0;
    let firstOther = '';
    try {
      do {
        const r = await api.fetchAuLogos(offset, 12, logoOverwrite);
        offset = r.offset; total = r.total;
        updated += r.updated; withUrl += r.withImageUrl; noImg += r.noImageOnRegister; dlFail += r.downloadFailed; noNum += r.noNumber;
        notFound += r.notFound; rateLimited += r.rateLimited; authErr += r.authErr; otherErr += r.otherErr; already += r.alreadyHave;
        if (!firstOther && r.errors.length) firstOther = `${r.errors[0].name}: ${r.errors[0].error}`;
        setLogoMsg(`Fetching Australian logos… ${Math.min(offset, total)} of ${total} checked, ${updated} added.`);
      } while (offset < total);
      let msg = `Done — ${updated} logo${updated === 1 ? '' : 's'} added of ${total} Australian logo case${total === 1 ? '' : 's'}.`;
      if (updated) msg += ' Now click "Copy logos to related cases" to fill Madrid and overseas filings.';
      const diag: string[] = [];
      if (already) diag.push(`${already} already had a logo`);
      if (withUrl) diag.push(`${withUrl} had an image on the register`);
      if (dlFail) diag.push(`${dlFail} image download(s) failed`);
      if (noImg) diag.push(`${noImg} had no image on the register`);
      if (notFound) diag.push(`${notFound} not found on the register`);
      if (rateLimited) diag.push(`${rateLimited} rate-limited by IP Australia`);
      if (authErr) diag.push(`${authErr} auth errors`);
      if (otherErr) diag.push(`${otherErr} could not reach IP Australia`);
      if (noNum) diag.push(`${noNum} had no usable number`);
      if (diag.length) msg += `\n(${diag.join('; ')}.)`;
      if (otherErr && firstOther) msg += `\nDetail: ${firstOther}`;
      setLogoMsg(msg);
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

  const doImportFull = async () => {
    if (!rows?.length) return;
    setBusy(true);
    setProg('');
    try {
      // The full mirror can be thousands of cases with 200+ columns each — far
      // too large for one request (the cPanel proxy rejects it with a 413). Send
      // it in small batches; the endpoint is additive, so each batch just adds
      // its cases. Batch size stays well under typical proxy body limits.
      const CHUNK = 100;
      let imported = 0, dates = 0, total = 0;
      const errors: { line: number; error: string }[] = [];
      for (let i = 0; i < rows.length; i += CHUNK) {
        const batch = rows.slice(i, i + CHUNK);
        const r = await api.importFull(batch);
        imported += r.imported; dates += r.dates; total += r.total;
        r.errors.forEach((e) => errors.push({ line: e.line + i, error: e.error }));
        setProg(`Importing… ${Math.min(i + CHUNK, rows.length)} of ${rows.length} cases`);
      }
      setResult({ imported, total, errors });
      window.alert(`Imported ${imported} of ${total} cases with ${dates} dates — all locked to mirror the legacy database (nothing recomputed).${errors.length ? `\n\n${errors.length} row(s) had errors.` : ''}`);
    } catch (e) {
      window.alert(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setBusy(false);
      setProg('');
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
                  <div className="row">
                    <button className="btn" disabled={busy} onClick={doImport}>{busy ? (prog || 'Importing…') : `Import ${rows.length} case${rows.length === 1 ? '' : 's'}`}</button>
                    <button className="btn secondary" disabled={busy} title="Bring every date across exactly as in the legacy export, locked. Use this for the legacy mirror file." onClick={doImportFull}>{busy ? (prog || 'Importing…') : 'Import as full mirror (dates locked)'}</button>
                  </div>
                  <div className="hint" style={{ marginTop: 6 }}>Use <strong>full mirror</strong> for the all-dates legacy file — it stores every date exactly as the legacy holds it and never recomputes. Use the normal import for the standard template (renewals/reminders auto-calculated).</div>
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

        <Card label="Import Headstart details">
          <div className="hint" style={{ marginBottom: 8 }}>
            Adds the Headstart filing and preliminary-assessment dates onto their cases (matched by application / registration number). The engine builds the Headstart workflow from there; where the mark has already been filed as a full application, the Headstart is recorded as completed history rather than raising alerts.
          </div>
          <label className="btn secondary small" style={{ cursor: hsBusy ? 'default' : 'pointer', display: 'inline-block' }}>
            {hsBusy ? 'Importing…' : '⬆ Choose Headstart CSV'}
            <input type="file" accept=".csv,text/csv" disabled={hsBusy} style={{ display: 'none' }}
              onChange={async (e) => {
                const f = e.target.files?.[0]; e.currentTarget.value = '';
                if (!f) return;
                setHsBusy(true); setHsMsg('');
                try {
                  const r = await api.importHeadstart(parseCsv(await f.text()));
                  setHsMsg(`Imported Headstart details onto ${r.imported} case${r.imported === 1 ? '' : 's'}${r.unmatched ? ` · ${r.unmatched} unmatched` : ''}.`);
                } catch (err) {
                  setHsMsg(err instanceof Error ? err.message : 'Import failed.');
                } finally { setHsBusy(false); }
              }} />
          </label>
          {hsMsg && <div className="hint" style={{ marginTop: 8 }}>{hsMsg}</div>}
        </Card>

        <Card label="Sync pending AU cases from IP Australia">
          <div className="hint" style={{ marginBottom: 8 }}>
            Checks every <strong>pending Australian</strong> case against the official IP Australia register and reconciles its <strong>status</strong> and <strong>examination dates</strong> (filing, first report / OA issued, publication, registration), then recomputes deadlines from the corrected dates. It never changes a <strong>locked renewal date</strong>. <strong>Download a backup first.</strong> Runs in batches; leave the page open until it finishes.
          </div>
          <button className="btn secondary small" disabled={syncBusy} onClick={async () => {
            if (!window.confirm('Sync pending Australian cases against the IP Australia register? Status and examination dates will be updated from the official record. Locked renewal dates are not touched. Make sure you have a backup.')) return;
            setSyncBusy(true);
            setSyncMsg('');
            setSyncLog([]);
            try {
              let offset = 0, total = 0, changed = 0;
              const log: { name: string; number: string; changes: string[] }[] = [];
              const errs: { name: string; error: string }[] = [];
              do {
                const r = await api.syncAuPending(offset);
                offset = r.offset; total = r.total; changed += r.changed;
                log.push(...r.changesLog); errs.push(...r.errors);
                setSyncMsg(`Syncing… ${Math.min(offset, total)} of ${total} pending AU cases checked · ${changed} updated${errs.length ? ` · ${errs.length} errors` : ''}.`);
                setSyncLog([...log]);
              } while (offset < total);
              setSyncMsg(`Done — checked ${total} pending AU cases, updated ${changed}${errs.length ? `, ${errs.length} could not be looked up` : ''}.`);
            } catch (e) {
              setSyncMsg(e instanceof Error ? e.message : 'Sync failed.');
            } finally {
              setSyncBusy(false);
            }
          }}>{syncBusy ? 'Syncing…' : 'Sync pending AU cases'}</button>
          {syncMsg && <div className="hint" style={{ marginTop: 8 }}>{syncMsg}</div>}
          {syncLog.length > 0 && (
            <table className="list nozebra" style={{ marginTop: 8 }}>
              <thead><tr><th>Case</th><th>Number</th><th>Changes</th></tr></thead>
              <tbody>
                {syncLog.slice(0, 200).map((c, i) => (
                  <tr key={i}><td>{c.name}</td><td className="mono">{c.number}</td><td>{c.changes.join('; ')}</td></tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>

        <Card label="Add Admin to every case's contacts">
          <div className="hint" style={{ marginBottom: 8 }}>
            Records <strong>Admin (admin@brandulegal.com.au)</strong> in the Case contacts of every case that doesn’t already have it. New and edited cases get it automatically; this backfills existing ones.
          </div>
          <button className="btn secondary small" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await api.addAdminContact();
              window.alert(`Added Admin to ${r.added} case${r.added === 1 ? '' : 's'} (of ${r.casesTotal}). The rest already had it.`);
            } catch (e) {
              window.alert(e instanceof Error ? e.message : 'Failed.');
            } finally {
              setBusy(false);
            }
          }}>{busy ? 'Working…' : 'Add Admin to all cases'}</button>
        </Card>

        <Card label="Fill owner address & contacts from the Contacts records">
          <div className="hint" style={{ marginBottom: 8 }}>
            The case import brings across only the owner’s <strong>name</strong>. This links each case to its matching <strong>Contacts (company) record</strong> by owner name and fills in the owner’s <strong>address</strong> and <strong>case contacts</strong>. It only fills blanks — nothing already on a case is overwritten. Import your contacts first, then run this.
          </div>
          <button className="btn secondary small" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await api.backfillOwnerDetails();
              window.alert(`Updated ${r.casesChanged} of ${r.casesTotal} case${r.casesTotal === 1 ? '' : 's'}: ${r.addressFilled} had an address added, ${r.contactsFilled} had contacts added.${r.noMatch ? `\n\n${r.noMatch} case${r.noMatch === 1 ? '' : 's'} had an owner with no matching contact record — check the owner name matches a contact.` : ''}`);
            } catch (e) {
              window.alert(e instanceof Error ? e.message : 'Failed.');
            } finally {
              setBusy(false);
            }
          }}>{busy ? 'Working…' : 'Fill owner address & contacts'}</button>
        </Card>

        <Card label="Import trade mark actions (from legacy alerts)">
          <div className="hint" style={{ marginBottom: 8 }}>
            Upload the CSV of legacy action items. Each row is matched to a case by application / registration number (then by name + jurisdiction) and added as an alerting <strong>Trade mark action</strong>, keeping its original date. Standard jurisdiction/reminder dates are skipped (the engine already generates those), and any action already on a case isn’t duplicated. Existing dates are never changed.
          </div>
          <label className="btn secondary small" style={{ cursor: actionsBusy ? 'default' : 'pointer', display: 'inline-block' }}>
            {actionsBusy ? 'Importing…' : '⬆ Choose actions CSV'}
            <input type="file" accept=".csv,text/csv" disabled={actionsBusy} style={{ display: 'none' }}
              onChange={(e) => { importActionsFile(e.target.files); e.currentTarget.value = ''; }} />
          </label>
          {actionsResult && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 700, color: 'var(--success)' }}>
                Imported {actionsResult.imported} action{actionsResult.imported === 1 ? '' : 's'} across {actionsResult.casesChanged} case{actionsResult.casesChanged === 1 ? '' : 's'} · {actionsResult.skipped} skipped · {actionsResult.unmatched} unmatched.
              </div>
              {actionsResult.unmatched > 0 && (
                <>
                  <div className="hint" style={{ marginTop: 8, marginBottom: 4 }}>Couldn’t be matched to a case (review these):</div>
                  <table className="list">
                    <thead><tr><th>Trade mark</th><th>Jurisdiction</th><th>Action</th></tr></thead>
                    <tbody>
                      {actionsResult.unmatchedList.slice(0, 100).map((u, i) => (
                        <tr key={i}><td>{u.trademark}</td><td>{u.jurisdiction}</td><td>{u.dateName}</td></tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}
            </div>
          )}
        </Card>

        <Card label="Add missing renewal reminders">
          <div className="hint" style={{ marginBottom: 8 }}>
            Some cases have a renewal deadline but no reminder rows. This adds the reminders your rulebook defines (counted back from the <strong>existing</strong> renewal date) to every case that’s missing them. It never changes, moves or recomputes the renewal date itself or any other date — it only inserts the missing reminders — so it’s safe on locked dates. Reminders you deleted by hand are not brought back.
          </div>
          <button className="btn secondary small" disabled={busy} onClick={async () => {
            setBusy(true);
            try {
              const r = await api.addRenewalReminders();
              window.alert(`Added ${r.remindersAdded} renewal reminder${r.remindersAdded === 1 ? '' : 's'} across ${r.casesChanged} case${r.casesChanged === 1 ? '' : 's'}. No existing dates were changed.`);
            } catch (e) {
              window.alert(e instanceof Error ? e.message : 'Failed.');
            } finally {
              setBusy(false);
            }
          }}>{busy ? 'Working…' : 'Add missing renewal reminders'}</button>
        </Card>

        <Card label="Tidy registered cases">
          <div className="hint" style={{ marginBottom: 8 }}>
            On every case that has a <strong>Registration Date</strong>, this ticks off the still-outstanding deadlines dated on or before registration — the pre-registration items (office actions, acceptance, publication, opposition windows) that no longer apply once the mark is registered. They drop out of Alerts but stay on the case as ticked history. Renewal dates and reminders are never touched, and nothing is deleted.
          </div>
          <button className="btn secondary small" disabled={busy} onClick={async () => {
            if (!window.confirm('Tick off all outstanding pre-registration deadlines on registered cases? Renewal dates are not affected, and nothing is deleted.')) return;
            setBusy(true);
            try {
              const r = await api.tidyRegistered();
              window.alert(`Cleared ${r.datesCleared} redundant pre-registration deadline${r.datesCleared === 1 ? '' : 's'} across ${r.casesChanged} registered case${r.casesChanged === 1 ? '' : 's'}.`);
            } catch (e) {
              window.alert(e instanceof Error ? e.message : 'Failed.');
            } finally {
              setBusy(false);
            }
          }}>{busy ? 'Working…' : 'Tidy registered cases'}</button>
        </Card>

        <Card label="Download a backup">
          <div className="hint" style={{ marginBottom: 8 }}>
            Downloads a complete, up-to-the-second copy of the whole database as a single <code>.sqlite</code> file. Safe to run any time — it snapshots without interrupting the app. Keep a copy off the server for peace of mind; to restore, place the file back as <code>data/brandu.sqlite</code>. (A daily automatic backup can also run on the server — ask about the cron job.)
          </div>
          <a className="btn secondary small" href="/api/backup/download" style={{ display: 'inline-block', textDecoration: 'none' }}>⬇ Download backup now</a>
          <div className="hint" style={{ margin: '14px 0 8px' }}>
            <strong>Reva-format export.</strong> Downloads every case as a CSV in the exact legacy (Reva) column layout. This is the portable copy — the <code>.sqlite</code> file above restores <em>this</em> system, whereas this CSV can be handed to a developer to re-upload into Reva if you ever need to move back.
          </div>
          <a className="btn secondary small" href="/api/backup/reva-csv" style={{ display: 'inline-block', textDecoration: 'none' }}>⬇ Download Reva-format CSV</a>
        </Card>

        <Card label="Lock renewal dates (source of truth)">
          <div className="hint" style={{ marginBottom: 8 }}>
            Pins every renewal deadline currently in the database <strong>exactly as it stands now</strong>, so the date engine can never silently recompute or shift it — not on a lookup, not on “Recompute all”, not on a save. It does <strong>not</strong> recompute first, so today’s values are frozen as-is. You can still change any date by hand on the case, and reminders keep counting back from the locked date. Run this once, after you’ve confirmed the data is correct.
          </div>
          <button className="btn secondary small" disabled={pinBusy} onClick={async () => {
            if (!window.confirm('Lock every current renewal deadline as the source of truth? The system will no longer recompute them; you can still edit any date manually on the case.')) return;
            setPinBusy(true);
            try {
              const r = await api.pinAllDates();
              window.alert(
                `Renewal dates now locked: ${r.lockedTotal} total (${r.pinned} newly locked this run, ${r.alreadyPinned} were already locked on import).\n\n` +
                `Of ${r.casesTotal} cases: ${r.lockedTotal} have a locked renewal date, ${r.noRenewal} have no renewal date yet (e.g. pending / unregistered), and ${r.linkedIr} are Madrid designations that inherit their renewal from the international registration.`
              );
            } catch (e) {
              window.alert(e instanceof Error ? e.message : 'Lock failed.');
            } finally {
              setPinBusy(false);
            }
          }}>{pinBusy ? 'Working…' : '🔒 Lock all renewal dates'}</button>
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
              <span className="hint">Overwrite existing logos — replaces logos already on cases (applies to both "Fetch Australian logos" and file import). Tick this to re-fetch and replace broken/blank logos once outbound access is enabled.</span>
            </label>
            <label className="btn secondary small" style={{ cursor: logoBusy ? 'default' : 'pointer', display: 'inline-block' }}>
              ⬆ Choose logo files
              <input type="file" accept="image/*" multiple disabled={logoBusy} style={{ display: 'none' }}
                onChange={(e) => { importLogoFiles(e.target.files); e.currentTarget.value = ''; }} />
            </label>
          </div>
          {logoMsg && <div className="hint" style={{ marginTop: 8 }}>{logoMsg}</div>}
        </Card>

        <Card label="Verify against source-of-truth file">
          <div className="hint" style={{ marginBottom: 8 }}>
            Read-only check. Upload your authoritative cases CSV and this compares each case's <strong>renewal, registration and filing dates</strong> in the live database against the file, listing anything that differs. Nothing is changed. A clean result (0 differences) confirms the database matches your source of truth.
          </div>
          <label className="btn secondary small" style={{ cursor: verifyBusy ? 'default' : 'pointer', display: 'inline-block' }}>
            {verifyBusy ? (prog || 'Checking…') : '⬆ Choose CSV to verify against'}
            <input type="file" accept=".csv,text/csv" disabled={verifyBusy} style={{ display: 'none' }}
              onChange={(e) => { verifyAgainstFile(e.target.files); e.currentTarget.value = ''; }} />
          </label>
          {verifyResult && (
            <div style={{ marginTop: 10 }}>
              <div style={{ fontWeight: 700, color: verifyResult.mismatchCount ? 'var(--danger)' : 'var(--success)' }}>
                {verifyResult.matched} of {verifyResult.checked} cases matched · {verifyResult.mismatchCount} date difference{verifyResult.mismatchCount === 1 ? '' : 's'}{verifyResult.unmatched ? ` · ${verifyResult.unmatched} file rows not matched` : ''}.
              </div>
              {verifyResult.mismatchCount > 0 && (
                <table className="list" style={{ marginTop: 8 }}>
                  <thead><tr><th>Mark</th><th>Jurisdiction</th><th>Date</th><th>Source of truth</th><th>In database</th></tr></thead>
                  <tbody>
                    {verifyResult.mismatches.slice(0, 100).map((mm, i) => (
                      <tr key={i}><td>{mm.name}</td><td>{mm.jur}</td><td>{mm.field}</td><td className="mono">{mm.source}</td><td className="mono" style={{ color: 'var(--danger)' }}>{mm.current}</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {verifyResult.mismatchCount > 100 && <div className="hint" style={{ marginTop: 6 }}>…and {verifyResult.mismatchCount - 100} more.</div>}
            </div>
          )}
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
