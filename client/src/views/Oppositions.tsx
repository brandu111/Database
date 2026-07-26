import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fmtDate, jurList, oppSchedule, todayISO, type Opposition } from '@brandu/shared';
import type { Nav } from '../App';
import { api } from '../api';
import { Card, Field, StatusBadge, confirmDelete } from '../ui';

const OPP_STATUSES = [
  'Opposition filed',
  'Notice of Intention to Oppose filed',
  'Evidence stage',
  'Hearing',
  'Suspended',
  'Opposition withdrawn',
  'Opposition finalised',
  'Opposition won',
  'Matter settled',
];

interface Props {
  nav: Nav;
  go: (patch: Partial<Nav>) => void;
  canEdit: boolean;
}

export function Oppositions({ nav, go, canEdit }: Props) {
  const [opps, setOpps] = useState<Opposition[] | null>(null);
  const reload = useCallback(() => api.oppositions().then(setOpps), []);
  useEffect(() => {
    reload();
  }, [reload]);

  if (!opps) return <div className="hint">Loading…</div>;

  if (nav.oppositionId) {
    const sel = opps.find((o) => o.id === nav.oppositionId);
    if (!sel) {
      go({ oppositionId: null });
      return null;
    }
    return (
      <OppositionDetail
        key={sel.id}
        initial={sel}
        canEdit={canEdit}
        onBack={() => {
          reload();
          go({ oppositionId: null });
        }}
        onChanged={(o) => setOpps((cur) => (cur ? cur.map((x) => (x.id === o.id ? o : x)) : cur))}
        onDeleted={() => {
          reload();
          go({ oppositionId: null });
        }}
      />
    );
  }

  return <OppositionList opps={opps} canEdit={canEdit} onOpen={(id) => go({ oppositionId: id })} onCreated={(o) => { setOpps((cur) => (cur ? [o, ...cur] : [o])); go({ oppositionId: o.id }); }} />;
}

function OppositionList({ opps, canEdit, onOpen, onCreated }: { opps: Opposition[]; canEdit: boolean; onOpen: (id: string) => void; onCreated: (o: Opposition) => void }) {
  const [query, setQuery] = useState('');
  const [fStatus, setFStatus] = useState('All statuses');
  const statuses = useMemo(() => [...new Set(opps.map((o) => o.status).filter(Boolean))].sort(), [opps]);
  const q = query.trim().toLowerCase();
  const filtered = opps.filter(
    (o) =>
      (fStatus === 'All statuses' || o.status === fStatus) &&
      (!q || [o.name, o.client, o.opponent, o.proceeding].join(' ').toLowerCase().includes(q))
  );

  return (
    <>
      <div className="filters">
        <input type="text" placeholder="Search oppositions…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option>All statuses</option>
          {statuses.map((s) => <option key={s}>{s}</option>)}
        </select>
        <span className="hint">{filtered.length} of {opps.length}</span>
        {canEdit && (
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => api.createOpposition({}).then(onCreated)}>
            + New opposition
          </button>
        )}
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="list">
          <thead>
            <tr><th>Opposition</th><th>Client</th><th>Role</th><th>Opponent</th><th>Jurisdiction</th><th>Status</th><th>Next date</th></tr>
          </thead>
          <tbody>
            {filtered.map((o) => {
              const next = (o.dates || [])
                .filter((d) => !d.done && d.date && !d.suspend)
                .sort((a, b) => (a.date < b.date ? -1 : 1))[0];
              return (
                <tr key={o.id} className="click" onClick={() => onOpen(o.id)}>
                  <td style={{ fontWeight: 600, color: 'var(--heading)', maxWidth: 380 }}>{o.name}</td>
                  <td>{o.client || '—'}</td>
                  <td>
                    <span className="badge" style={o.clientIsPlaintiff ? { background: 'var(--success-bg)', color: 'var(--success)' } : { background: 'var(--defend-bg)', color: 'var(--danger)' }}>
                      {o.clientIsPlaintiff ? 'Plaintiff' : 'Defendant'}
                    </span>
                  </td>
                  <td>{o.opponent || '—'}</td>
                  <td>{o.jurisdiction}</td>
                  <td><StatusBadge status={o.status} /></td>
                  <td className="mono">{next ? `${fmtDate(next.date)} · ${next.name}` : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

function OppositionDetail({ initial, canEdit, onBack, onChanged, onDeleted }: {
  initial: Opposition;
  canEdit: boolean;
  onBack: () => void;
  onChanged: (o: Opposition) => void;
  onDeleted: () => void;
}) {
  const [o, setO] = useState(initial);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const [anchorDate, setAnchorDate] = useState('');
  const timer = useRef<number | null>(null);
  const latest = useRef(o);
  latest.current = o;

  const doSave = useCallback(async () => {
    setSaveState('saving');
    try {
      const resp = await api.saveOpposition(latest.current);
      onChanged(resp);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, [onChanged]);

  const update = useCallback(
    (patch: Partial<Opposition>, flush = false) => {
      if (!canEdit) return;
      setO((cur) => ({ ...cur, ...patch }));
      setSaveState('dirty');
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(doSave, flush ? 30 : 900);
    },
    [canEdit, doSave]
  );

  const sched = oppSchedule(o.jurisdiction);
  const ro = !canEdit;

  const getFromTemplate = async () => {
    const resp = await api.oppDatesFromTemplate(o.id, sched && anchorDate ? anchorDate : undefined);
    setO(resp);
    onChanged(resp);
  };

  const markRefTable = (key: 'clientMarks' | 'oppMarks', label: string) => (
    <Card label={label} right={canEdit ? <button className="btn small" onClick={() => update({ [key]: [...o[key], { name: '', application: '', registration: '' }] } as Partial<Opposition>, true)}>+ Add</button> : undefined}>
      {o[key].length === 0 && <div className="hint">None recorded.</div>}
      {o[key].length > 0 && (
        <table className="list">
          <thead><tr><th>Trade mark</th><th>Application no.</th><th>Registration no.</th><th /></tr></thead>
          <tbody>
            {o[key].map((t, i) => (
              <tr key={i}>
                {(['name', 'application', 'registration'] as const).map((k) => (
                  <td key={k}>
                    <input type="text" value={t[k]} disabled={ro}
                      onChange={(e) => update({ [key]: o[key].map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) } as Partial<Opposition>)} />
                  </td>
                ))}
                <td>{canEdit && <button className="btn danger-link" onClick={() => update({ [key]: o[key].filter((_, j) => j !== i) } as Partial<Opposition>, true)}>✕</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </Card>
  );

  return (
    <>
      <button className="back" onClick={onBack}>← All oppositions</button>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0, maxWidth: 800 }}>{o.name}</h2>
        <div className="row">
          <span className="save-state">{saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Editing…' : 'Save failed'}</span>
          {canEdit && (
            <button className="btn danger-link" onClick={() => { if (confirmDelete(`opposition "${o.name}"`)) api.deleteOpposition(o.id).then(onDeleted); }}>Delete</button>
          )}
        </div>
      </div>

      <div className="detail-cols">
        <div>
          <Card label="Details">
            <Field label="Opposition name"><input type="text" value={o.name} disabled={ro} onChange={(e) => update({ name: e.target.value })} /></Field>
            <div className="grid2">
              <Field label="Client (client company)"><input type="text" value={o.client} disabled={ro} onChange={(e) => update({ client: e.target.value })} /></Field>
              <Field label="Opposition company"><input type="text" value={o.opponent} disabled={ro} onChange={(e) => update({ opponent: e.target.value })} /></Field>
            </div>
            <div className="grid3">
              <Field label="Proceeding no."><input type="text" value={o.proceeding} disabled={ro} onChange={(e) => update({ proceeding: e.target.value })} /></Field>
              <Field label="Jurisdiction">
                <input type="text" list="opp-jur" value={o.jurisdiction} disabled={ro} onChange={(e) => update({ jurisdiction: e.target.value })} />
                <datalist id="opp-jur">{jurList().map((j) => <option key={j} value={j} />)}</datalist>
              </Field>
              <Field label="Status">
                <select value={o.status} disabled={ro} onChange={(e) => update({ status: e.target.value }, true)}>
                  {[...new Set([...OPP_STATUSES, o.status])].filter(Boolean).map((s) => <option key={s}>{s}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Our client is">
              <div className="row">
                <button className={`chip${o.clientIsPlaintiff ? ' on' : ''}`} disabled={ro} onClick={() => update({ clientIsPlaintiff: true }, true)}>Plaintiff — opposing</button>
                <button className={`chip${!o.clientIsPlaintiff ? ' on' : ''}`} disabled={ro} onClick={() => update({ clientIsPlaintiff: false }, true)}>Defendant — defending</button>
              </div>
            </Field>
            <Field label="Notes"><textarea value={o.notes} disabled={ro} onChange={(e) => update({ notes: e.target.value })} /></Field>
          </Card>
          {markRefTable('clientMarks', 'Client trade marks')}
          {markRefTable('oppMarks', 'Opposition trade marks')}
        </div>

        <div>
          <Card
            label="Dates"
            right={canEdit ? (
              <div className="row">
                {sched && <input type="date" title={`Anchor: ${sched.anchor}`} value={anchorDate} onChange={(e) => setAnchorDate(e.target.value)} style={{ width: 150 }} />}
                <button className="btn small" onClick={getFromTemplate}>Get dates from template</button>
              </div>
            ) : undefined}
          >
            {sched && <div className="hint" style={{ marginBottom: 8 }}>{o.jurisdiction} schedule · {sched.role}. Set the anchor date ({sched.anchor}) and generate the timeline; without it the master list is inserted.</div>}
            {(o.dates || []).length === 0 && <div className="hint">No dates yet.</div>}
            {(o.dates || []).length > 0 && (
              <table className="list">
                <thead><tr><th style={{ width: 28 }}>✓</th><th style={{ width: 140 }}>Date</th><th>Name</th><th>Note</th><th style={{ width: 80 }}>Suspend</th><th /></tr></thead>
                <tbody>
                  {o.dates.map((d, i) => (
                    <tr key={i} style={{ opacity: d.suspend ? 0.55 : 1 }}>
                      <td><input type="checkbox" checked={!!d.done} disabled={ro} onChange={() => update({ dates: o.dates.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) }, true)} /></td>
                      <td><input type="date" value={d.date || ''} disabled={ro} onChange={(e) => update({ dates: o.dates.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) }, true)} /></td>
                      <td className={d.done ? 'done' : ''} title={d.note}>{d.name}</td>
                      <td><input type="text" value={d.note || ''} disabled={ro} onChange={(e) => update({ dates: o.dates.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })} /></td>
                      <td style={{ textAlign: 'center' }}>
                        <input type="checkbox" checked={!!d.suspend} disabled={ro} title="Suspend (hidden from alerts)"
                          onChange={() => update({ dates: o.dates.map((x, j) => (j === i ? { ...x, suspend: !x.suspend } : x)) }, true)} />
                      </td>
                      <td>{canEdit && <button className="btn danger-link" onClick={() => update({ dates: o.dates.filter((_, j) => j !== i) }, true)}>✕</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {canEdit && (
              <button className="btn secondary small" style={{ marginTop: 8 }}
                onClick={() => update({ dates: [...(o.dates || []), { date: todayISO(), name: 'New date', note: '', done: false, email: false, suspend: false }] }, true)}>
                + Add date
              </button>
            )}
          </Card>

          <Card label="Contacts" right={canEdit ? <button className="btn small" onClick={() => update({ contacts: [...(o.contacts || []), { name: '', company: '', position: '', phone: '', email: '' }] }, true)}>+ Add</button> : undefined}>
            {(o.contacts || []).length === 0 && <div className="hint">No contacts.</div>}
            {(o.contacts || []).length > 0 && (
              <table className="list">
                <thead><tr><th>Name</th><th>Role</th><th>Phone</th><th>Email</th><th /></tr></thead>
                <tbody>
                  {o.contacts.map((c, i) => (
                    <tr key={i}>
                      <td><input type="text" value={c.name || ''} disabled={ro} onChange={(e) => update({ contacts: o.contacts.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)) })} /></td>
                      <td>
                        <input type="text" list="opp-contact-roles" value={c.position || c.role || ''} disabled={ro} placeholder="Role"
                          onChange={(e) => update({ contacts: o.contacts.map((x, j) => (j === i ? { ...x, position: e.target.value } : x)) })} />
                      </td>
                      <td><input type="text" value={c.phone || ''} disabled={ro} onChange={(e) => update({ contacts: o.contacts.map((x, j) => (j === i ? { ...x, phone: e.target.value } : x)) })} /></td>
                      <td><input type="text" value={c.email || ''} disabled={ro} onChange={(e) => update({ contacts: o.contacts.map((x, j) => (j === i ? { ...x, email: e.target.value } : x)) })} /></td>
                      <td>{canEdit && <button className="btn danger-link" onClick={() => update({ contacts: o.contacts.filter((_, j) => j !== i) }, true)}>✕</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <datalist id="opp-contact-roles">
              {['Client', 'Opponent', 'Applicant', 'Associate / Foreign agent', 'Instructing firm', 'Counsel', 'Firm Admin', 'Other'].map((rn) => <option key={rn} value={rn} />)}
            </datalist>
          </Card>
        </div>
      </div>
    </>
  );
}
