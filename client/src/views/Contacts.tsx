import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { allJurisdictions, CONTACT_TYPES, fmtDate, type Company, type CompanyContact, type Mark } from '@brandu/shared';
import type { Nav } from '../App';
import { api } from '../api';
import { Card, Field, StatusBadge, confirmDelete } from '../ui';

const POSITIONS = ['Partner', 'Responsible Attorney', 'Administrator', 'Associate', 'Client'];

interface Props {
  nav: Nav;
  go: (patch: Partial<Nav>) => void;
  canEdit: boolean;
  openMark: (id: string) => void;
}

export function Contacts({ nav, go, canEdit, openMark }: Props) {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const reload = useCallback(() => api.companies().then(setCompanies), []);
  useEffect(() => {
    reload();
    api.marks().then(setMarks, () => undefined);
  }, [reload]);

  if (!companies) return <div className="hint">Loading…</div>;

  if (nav.companyId) {
    const sel = companies.find((c) => c.id === nav.companyId);
    if (!sel) {
      go({ companyId: null });
      return null;
    }
    return (
      <CompanyDetail
        key={sel.id}
        initial={sel}
        marks={marks}
        canEdit={canEdit}
        openMark={openMark}
        onBack={() => {
          reload();
          go({ companyId: null });
        }}
        onChanged={(c) => setCompanies((cur) => (cur ? cur.map((x) => (x.id === c.id ? c : x)) : cur))}
        onDeleted={() => {
          reload();
          go({ companyId: null });
        }}
      />
    );
  }

  return <CompanyList companies={companies} canEdit={canEdit} onOpen={(id) => go({ companyId: id })} onCreated={(c) => { setCompanies((cur) => (cur ? [c, ...cur] : [c])); go({ companyId: c.id }); }} />;
}

function displayName(c: Company): string {
  if (c.type === 'Individual' && (c.first || c.last)) return [c.first, c.last].filter(Boolean).join(' ');
  return c.name;
}

function CompanyList({ companies, canEdit, onOpen, onCreated }: { companies: Company[]; canEdit: boolean; onOpen: (id: string) => void; onCreated: (c: Company) => void }) {
  const [query, setQuery] = useState('');
  const [fType, setFType] = useState('All types');
  const q = query.trim().toLowerCase();
  const filtered = companies.filter(
    (c) =>
      (fType === 'All types' || c.type === fType) &&
      (!q || [displayName(c), c.email, c.country, ...(c.contacts || []).map((x) => x.name || '')].join(' ').toLowerCase().includes(q))
  );

  return (
    <>
      <div className="filters">
        <input type="text" placeholder="Search contacts…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={fType} onChange={(e) => setFType(e.target.value)}>
          <option>All types</option>
          <option>Company</option>
          <option>Individual</option>
          <option>Partnership</option>
        </select>
        <span className="hint">{filtered.length} of {companies.length}</span>
        {canEdit && (
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => api.createCompany({}).then(onCreated)}>
            + New record
          </button>
        )}
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="list">
          <thead><tr><th>Name</th><th>Type</th><th>Country</th><th>Phone</th><th>Email</th><th>People</th></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id} className="click" onClick={() => onOpen(c.id)}>
                <td style={{ fontWeight: 600, color: 'var(--heading)' }}>{displayName(c) || '(unnamed)'}</td>
                <td>{c.type}</td>
                <td>{c.country || '—'}</td>
                <td>{c.phone || '—'}</td>
                <td>{c.email || '—'}</td>
                <td className="mono">{(c.contacts || []).length || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

function CompanyDetail({ initial, marks, canEdit, openMark, onBack, onChanged, onDeleted }: {
  initial: Company;
  marks: Mark[];
  canEdit: boolean;
  openMark: (id: string) => void;
  onBack: () => void;
  onChanged: (c: Company) => void;
  onDeleted: () => void;
}) {
  const [c, setC] = useState(initial);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const timer = useRef<number | null>(null);
  const latest = useRef(c);
  latest.current = c;

  const doSave = useCallback(async () => {
    setSaveState('saving');
    try {
      const resp = await api.saveCompany(latest.current);
      onChanged(resp);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, [onChanged]);

  const update = useCallback(
    (patch: Partial<Company>, flush = false) => {
      if (!canEdit) return;
      setC((cur) => {
        const next = { ...cur, ...patch };
        if (next.type === 'Individual') next.name = [next.first, next.last].filter(Boolean).join(' ') || next.name;
        return next;
      });
      setSaveState('dirty');
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(doSave, flush ? 30 : 900);
    },
    [canEdit, doSave]
  );

  const owned = useMemo(() => marks.filter((m) => (m.owner || '') === (c.name || '') && c.name), [marks, c.name]);
  const ro = !canEdit;
  const setContact = (i: number, patch: Partial<CompanyContact>, flush = false) =>
    update({ contacts: (c.contacts || []).map((x, j) => (j === i ? { ...x, ...patch } : x)) }, flush);

  return (
    <>
      <button className="back" onClick={onBack}>← All contacts</button>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{displayName(c) || '(unnamed record)'}</h2>
        <div className="row">
          <span className="save-state">{saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Editing…' : 'Save failed'}</span>
          {canEdit && <button className="btn danger-link" onClick={() => { if (confirmDelete(`record "${displayName(c)}"`)) api.deleteCompany(c.id).then(onDeleted); }}>Delete</button>}
        </div>
      </div>

      <div className="detail-cols">
        <div>
          <Card label="Record">
            <div className="grid2">
              <Field label="Structure">
                <select value={c.type} disabled={ro} onChange={(e) => update({ type: e.target.value as Company['type'] }, true)}>
                  <option>Company</option>
                  <option>Individual</option>
                  <option>Partnership</option>
                </select>
              </Field>
              <Field label="Contact type">
                <select value={c.contactType || ''} disabled={ro} onChange={(e) => update({ contactType: e.target.value }, true)}>
                  <option value="">— Not set —</option>
                  {CONTACT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </Field>
            </div>
            {c.type === 'Individual' ? (
              <div className="grid2">
                <Field label="First name"><input type="text" value={c.first || ''} disabled={ro} onChange={(e) => update({ first: e.target.value })} /></Field>
                <Field label="Surname"><input type="text" value={c.last || ''} disabled={ro} onChange={(e) => update({ last: e.target.value })} /></Field>
              </div>
            ) : (
              <Field label={c.type === 'Partnership' ? 'Partnership name' : 'Company name'}>
                <input type="text" value={c.name} disabled={ro} onChange={(e) => update({ name: e.target.value })} />
              </Field>
            )}
            {c.type === 'Partnership' && (
              <Field label="Partners">
                {(c.partners || []).map((p, i) => (
                  <div key={i} className="row" style={{ marginBottom: 6 }}>
                    <input type="text" placeholder="Partner name" value={p.name} disabled={ro}
                      onChange={(e) => update({ partners: (c.partners || []).map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} />
                    <input type="text" placeholder="Email" value={p.email} disabled={ro}
                      onChange={(e) => update({ partners: (c.partners || []).map((x, j) => (j === i ? { ...x, email: e.target.value } : x)) })} />
                    {canEdit && <button className="btn danger-link" onClick={() => update({ partners: (c.partners || []).filter((_, j) => j !== i) }, true)}>✕</button>}
                  </div>
                ))}
                {canEdit && <button className="btn secondary small" onClick={() => update({ partners: [...(c.partners || []), { name: '', email: '' }] }, true)}>+ Add partner</button>}
              </Field>
            )}
            <div className="grid2">
              <Field label="Address"><input type="text" value={c.address} disabled={ro} onChange={(e) => update({ address: e.target.value })} /></Field>
              <Field label="Address 2"><input type="text" value={c.address2} disabled={ro} onChange={(e) => update({ address2: e.target.value })} /></Field>
            </div>
            <div className="grid3">
              <Field label="City"><input type="text" value={c.city} disabled={ro} onChange={(e) => update({ city: e.target.value })} /></Field>
              <Field label="State"><input type="text" value={c.state} disabled={ro} onChange={(e) => update({ state: e.target.value })} /></Field>
              <Field label="Postcode / ZIP"><input type="text" value={c.zip} disabled={ro} onChange={(e) => update({ zip: e.target.value })} /></Field>
            </div>
            <div className="grid3">
              <Field label="Country">
                <input type="text" list="co-country" value={c.country} disabled={ro} onChange={(e) => update({ country: e.target.value })} />
                <datalist id="co-country">{allJurisdictions().filter((j) => !/Madrid|WIPO/.test(j)).map((j) => <option key={j} value={j} />)}</datalist>
              </Field>
              <Field label="Phone"><input type="text" value={c.phone} disabled={ro} onChange={(e) => update({ phone: e.target.value })} /></Field>
              <Field label="Email"><input type="text" value={c.email} disabled={ro} onChange={(e) => update({ email: e.target.value })} /></Field>
            </div>
            <Field label="Notes"><textarea value={c.notes} disabled={ro} onChange={(e) => update({ notes: e.target.value })} /></Field>
          </Card>

          <Card label={`Trade marks owned (${owned.length})`}>
            {owned.length === 0 && <div className="hint">No trade marks owned by this record.</div>}
            {owned.length > 0 && (
              <table className="list">
                <thead><tr><th>Trade mark</th><th>Jurisdiction</th><th>Status</th><th>Filed</th></tr></thead>
                <tbody>
                  {owned.map((m) => (
                    <tr key={m.id} className="click" onClick={() => openMark(m.id)}>
                      <td style={{ fontWeight: 600, color: 'var(--heading)' }}>{m.name}</td>
                      <td>{m.jurisdiction}</td>
                      <td><StatusBadge status={m.status} /></td>
                      <td className="mono">{fmtDate((m.dates || []).find((d) => d.name === 'Application Filed')?.date || '') || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>
        </div>

        <div>
          <Card label="People at this record" right={canEdit ? (
            <button className="btn small" onClick={() => update({ contacts: [...(c.contacts || []), { salutation: '', first: '', last: '', position: '', email: '', phone: '' }] }, true)}>
              + New contact
            </button>
          ) : undefined}>
            {(c.contacts || []).length === 0 && <div className="hint">No people recorded.</div>}
            {(c.contacts || []).map((p, i) => (
              <div key={i} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', marginBottom: 10 }}>
                <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
                  <strong>{p.name || [p.first, p.last].filter(Boolean).join(' ') || 'New contact'}</strong>
                  {canEdit && <button className="btn danger-link" onClick={() => update({ contacts: (c.contacts || []).filter((_, j) => j !== i) }, true)}>✕</button>}
                </div>
                <div className="grid3">
                  <Field label="Salutation"><input type="text" value={p.salutation || ''} disabled={ro} onChange={(e) => setContact(i, { salutation: e.target.value })} /></Field>
                  <Field label="First"><input type="text" value={p.first || ''} disabled={ro} onChange={(e) => setContact(i, { first: e.target.value, name: [e.target.value, p.middle, p.last].filter(Boolean).join(' ') })} /></Field>
                  <Field label="Last"><input type="text" value={p.last || ''} disabled={ro} onChange={(e) => setContact(i, { last: e.target.value, name: [p.first, p.middle, e.target.value].filter(Boolean).join(' ') })} /></Field>
                </div>
                <div className="grid3">
                  <Field label="Position">
                    <input type="text" list="positions" value={p.position || ''} disabled={ro} onChange={(e) => setContact(i, { position: e.target.value })} />
                    <datalist id="positions">{POSITIONS.map((x) => <option key={x} value={x} />)}</datalist>
                  </Field>
                  <Field label="Phone"><input type="text" value={p.phone || ''} disabled={ro} onChange={(e) => setContact(i, { phone: e.target.value })} /></Field>
                  <Field label="Email"><input type="text" value={p.email || ''} disabled={ro} onChange={(e) => setContact(i, { email: e.target.value })} /></Field>
                </div>
                <div className="row">
                  <label className="hint"><input type="checkbox" checked={!!p.allTrademarks} disabled={ro} onChange={() => setContact(i, { allTrademarks: !p.allTrademarks }, true)} /> Copy on all trade marks</label>
                </div>
              </div>
            ))}
          </Card>
        </div>
      </div>
    </>
  );
}
