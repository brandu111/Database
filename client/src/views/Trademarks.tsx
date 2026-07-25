import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  addrSchema,
  allJurisdictions,
  fmtDate,
  madridMembers,
  rulesFor,
  statusOptions,
  todayISO,
  type Company,
  type EmailTemplate,
  type Mark,
  type RuleBook,
} from '@brandu/shared';
import type { Nav } from '../App';
import { api, uploadFile } from '../api';
import { Card, Field, SortArrow, StatusBadge, confirmDelete } from '../ui';

const MARK_TYPES = ['Word', 'Logo', 'Combined', '3D Shape', 'Series', 'Sound', 'Scent', 'Movement', 'Colour'];

interface Props {
  nav: Nav;
  go: (patch: Partial<Nav>) => void;
  canEdit: boolean;
}

export function Trademarks({ nav, go, canEdit }: Props) {
  const [marks, setMarks] = useState<Mark[] | null>(null);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [rules, setRules] = useState<RuleBook>({});
  const [error, setError] = useState('');

  const reload = useCallback(() => {
    api.marks().then(setMarks, (e) => setError(String(e.message || e)));
  }, []);

  useEffect(() => {
    reload();
    api.companies().then(setCompanies, () => undefined);
    api.templates().then(setTemplates, () => undefined);
    api.rules().then((r) => setRules(r.rules), () => undefined);
  }, [reload]);

  if (error) return <div className="err">{error}</div>;
  if (!marks) return <div className="hint">Loading…</div>;

  if (nav.markId) {
    const sel = marks.find((m) => m.id === nav.markId);
    if (!sel) {
      go({ markId: null });
      return null;
    }
    return (
      <MarkDetail
        key={sel.id}
        initial={sel}
        allMarks={marks}
        companies={companies}
        templates={templates}
        rules={rules}
        canEdit={canEdit}
        onBack={() => {
          reload();
          go({ markId: null });
        }}
        onOpen={(id) => go({ markId: id })}
        onChanged={(m) => setMarks((cur) => (cur ? cur.map((x) => (x.id === m.id ? m : x)) : cur))}
        onDeleted={() => {
          reload();
          go({ markId: null });
        }}
        onCreated={() => reload()}
      />
    );
  }

  return <MarkList marks={marks} canEdit={canEdit} onOpen={(id) => go({ markId: id })} onCreated={(m) => { setMarks((cur) => (cur ? [m, ...cur] : [m])); go({ markId: m.id }); }} />;
}

// ---------------------------------------------------------------------------- list

function MarkList({ marks, canEdit, onOpen, onCreated }: { marks: Mark[]; canEdit: boolean; onOpen: (id: string) => void; onCreated: (m: Mark) => void }) {
  const [query, setQuery] = useState('');
  const [fJur, setFJur] = useState('All jurisdictions');
  const [fStatus, setFStatus] = useState('All statuses');
  const [fCompany, setFCompany] = useState('All companies');
  const [sortKey, setSortKey] = useState('name');
  const [sortDir, setSortDir] = useState(1);
  const [limit, setLimit] = useState(150);

  const jurs = useMemo(() => [...new Set(marks.map((m) => m.jurisdiction).filter(Boolean))].sort(), [marks]);
  const statuses = useMemo(() => [...new Set(marks.map((m) => m.status).filter(Boolean))].sort(), [marks]);
  const owners = useMemo(() => [...new Set(marks.map((m) => m.owner).filter(Boolean))].sort(), [marks]);

  const dateOf = (m: Mark, n: string) => (m.dates || []).find((d) => d.name === n)?.date || '';

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = marks.filter(
      (m) =>
        (fJur === 'All jurisdictions' || m.jurisdiction === fJur) &&
        (fStatus === 'All statuses' || m.status === fStatus) &&
        (fCompany === 'All companies' || m.owner === fCompany) &&
        (!q ||
          [m.name, m.owner, m.application, m.registration, m.matter, m.clientDocket]
            .join(' ')
            .toLowerCase()
            .includes(q))
    );
    const val = (m: Mark): string => {
      switch (sortKey) {
        case 'type': return m.type || '';
        case 'jurisdiction': return m.jurisdiction || '';
        case 'status': return m.status || '';
        case 'owner': return m.owner || '';
        case 'filed': return dateOf(m, 'Application Filed');
        case 'renewal': return dateOf(m, 'Renewal Deadline');
        default: return m.name || '';
      }
    };
    rows.sort((a, b) => val(a).localeCompare(val(b), undefined, { numeric: true }) * sortDir);
    return rows;
  }, [marks, query, fJur, fStatus, fCompany, sortKey, sortDir]);

  const sortBy = (k: string) => {
    if (k === sortKey) setSortDir(-sortDir);
    else {
      setSortKey(k);
      setSortDir(1);
    }
  };

  const TH = ({ k, children }: { k: string; children: React.ReactNode }) => (
    <th onClick={() => sortBy(k)}>
      {children}
      <SortArrow active={sortKey === k} dir={sortDir} />
    </th>
  );

  return (
    <>
      <div className="filters">
        <input type="text" placeholder="Search mark, owner, number…" value={query} onChange={(e) => setQuery(e.target.value)} />
        <select value={fJur} onChange={(e) => setFJur(e.target.value)}>
          <option>All jurisdictions</option>
          {jurs.map((j) => <option key={j}>{j}</option>)}
        </select>
        <select value={fStatus} onChange={(e) => setFStatus(e.target.value)}>
          <option>All statuses</option>
          {statuses.map((s) => <option key={s}>{s}</option>)}
        </select>
        <select value={fCompany} onChange={(e) => setFCompany(e.target.value)}>
          <option>All companies</option>
          {owners.map((o) => <option key={o}>{o}</option>)}
        </select>
        <span className="hint">{filtered.length} of {marks.length}</span>
        {canEdit && (
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => api.createMark({}).then(onCreated)}>
            + New trade mark
          </button>
        )}
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="list">
          <thead>
            <tr>
              <TH k="name">Trade mark</TH>
              <TH k="type">Type</TH>
              <TH k="jurisdiction">Jurisdiction</TH>
              <th>Application no.</th>
              <th>Registration no.</th>
              <TH k="status">Status</TH>
              <TH k="owner">Owner</TH>
              <TH k="filed">Filed</TH>
              <TH k="renewal">Renewal</TH>
            </tr>
          </thead>
          <tbody>
            {filtered.slice(0, limit).map((m) => (
              <tr key={m.id} className="click" onClick={() => onOpen(m.id)}>
                <td style={{ fontWeight: 600, color: 'var(--heading)' }}>{m.name || '(untitled)'}</td>
                <td>{m.type || '—'}</td>
                <td>{m.jurisdiction}</td>
                <td className="mono">{m.application || '—'}</td>
                <td className="mono">{m.registration || '—'}</td>
                <td><StatusBadge status={m.status} /></td>
                <td>{m.owner || '—'}</td>
                <td className="mono">{fmtDate(dateOf(m, 'Application Filed')) || '—'}</td>
                <td className="mono">{fmtDate(dateOf(m, 'Renewal Deadline')) || '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > limit && (
          <div style={{ padding: 12, textAlign: 'center' }}>
            <button className="btn secondary small" onClick={() => setLimit(limit + 300)}>
              Show more ({filtered.length - limit} remaining)
            </button>
          </div>
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------- detail

interface DetailProps {
  initial: Mark;
  allMarks: Mark[];
  companies: Company[];
  templates: EmailTemplate[];
  rules: RuleBook;
  canEdit: boolean;
  onBack: () => void;
  onOpen: (id: string) => void;
  onChanged: (m: Mark) => void;
  onDeleted: () => void;
  onCreated: () => void;
}

function MarkDetail({ initial, allMarks, companies, templates, rules, canEdit, onBack, onOpen, onChanged, onDeleted, onCreated }: DetailProps) {
  const [m, setM] = useState<Mark>(initial);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'dirty' | 'error'>('saved');
  const [addDateName, setAddDateName] = useState('');
  const [addDateDate, setAddDateDate] = useState('');
  const [mpCountry, setMpCountry] = useState('');
  const timer = useRef<number | null>(null);
  const latest = useRef(m);
  latest.current = m;

  const doSave = useCallback(async () => {
    if (!canEdit) return;
    setSaveState('saving');
    try {
      const resp = await api.saveMark(latest.current);
      // Only the dates panel is engine-computed server-side — merge it back
      // without clobbering fields the user may have kept typing into.
      setM((cur) => ({ ...cur, dates: resp.dates, madridId: resp.madridId }));
      onChanged({ ...latest.current, dates: resp.dates });
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  }, [canEdit, onChanged]);

  const update = useCallback(
    (patch: Partial<Mark>, flush = false) => {
      if (!canEdit) return;
      setM((cur) => ({ ...cur, ...patch }));
      setSaveState('dirty');
      if (timer.current) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(doSave, flush ? 30 : 900);
    },
    [canEdit, doSave]
  );

  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupMsg, setLookupMsg] = useState('');

  /** Populate the case from the IP Australia register by its application/registration number. */
  const lookupIpAustralia = async () => {
    const number = (m.application || m.registration || '').trim();
    if (!number) {
      setLookupMsg('Enter an application or registration number first.');
      return;
    }
    const hasContent = m.name || m.classes || m.goods || m.owner;
    if (hasContent && !window.confirm('Fetch details from IP Australia and overwrite this case’s mark name, classes, goods/services, owner and key dates?')) return;
    setLookupBusy(true);
    setLookupMsg('');
    try {
      const fields = await api.lookupIpAustralia(number);
      // Merge fetched dates with any manual rows the user already added.
      const fetched = fields.dates || [];
      const keep = (m.dates || []).filter((d) => !fetched.some((f) => f.name === d.name));
      update({ ...fields, dates: [...fetched, ...keep] }, true);
      setLookupMsg(`Loaded from IP Australia (${number}).`);
    } catch (e) {
      setLookupMsg(e instanceof Error ? e.message : 'Lookup failed.');
    } finally {
      setLookupBusy(false);
    }
  };

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const jurNames = useMemo(() => {
    const list = rulesFor(rules, m.jurisdiction);
    return [...new Set(['Application Filed', 'OA Issued', 'Publication Date', 'Registration Date', 'Notice of Allowance', 'Opposition filed', ...list.map((r) => r.name), ...list.map((r) => r.trigger)])].filter(Boolean);
  }, [rules, m.jurisdiction]);

  const schema = addrSchema(m.country || '');
  const ownerCompany = companies.find((c) => (c.name || '') === (m.owner || ''));

  // Reminder rows: show only the next not-done reminder per deadline group.
  const visibleDates = useMemo(() => {
    const groups = new Map<string, number[]>();
    m.dates.forEach((d, i) => {
      if (d.reminder) {
        const k = d.emailFor || d.name;
        if (!groups.has(k)) groups.set(k, []);
        groups.get(k)!.push(i);
      }
    });
    const show = new Set<number>();
    for (const idxs of groups.values()) {
      const next = idxs
        .slice()
        .sort((a, b) => ((m.dates[a].date || '') < (m.dates[b].date || '') ? -1 : 1))
        .find((i) => !m.dates[i].done);
      if (next !== undefined) show.add(next);
    }
    return m.dates.map((d, i) => ({ d, i })).filter(({ d, i }) => !d.reminder || show.has(i));
  }, [m.dates]);

  const fillMerge = (s: string): string => {
    const client = (m.contacts || []).find((c) => (c.position || '').toLowerCase() === 'client');
    const first = (client?.name || m.owner || '').split(' ')[0];
    const filed = (m.dates || []).find((x) => x.name === 'Application Filed')?.date || '';
    return String(s || '')
      .split('[TrademarkName]').join(m.name || '')
      .split('[CompanyName]').join(m.owner || '')
      .split('[FirstName]').join(first)
      .split('[Jurisdiction]').join(m.jurisdiction || '')
      .split('[ApplicationNumber]').join(m.application || '')
      .split('[RegistrationNumber]').join(m.registration || '')
      .split('[RegistrationClasses]').join(m.classes || '')
      .split('[GoodsServices]').join(m.goods || '')
      .split('[ApplicationFiled]').join(fmtDate(filed));
  };

  const emailForDate = (name: string, emailFor: string | undefined, date: string) => {
    const dfName = emailFor || name;
    const tpl =
      templates.find((t) => t.dateField === dfName && t.jurisdiction === m.jurisdiction) ||
      templates.find((t) => t.dateField === dfName);
    const rule = rulesFor(rules, m.jurisdiction).find((r) => (r.name === name || (emailFor && r.name === emailFor)) && r.template);
    if (!tpl && !rule) return null;
    return () => {
      const client = (m.contacts || []).find((c) => (c.position || '').toLowerCase() === 'client');
      const to = client?.email || '';
      let subject: string;
      let body: string;
      if (tpl) {
        subject = fillMerge(tpl.subject);
        body = fillMerge(tpl.body);
      } else {
        const rep = (s: string, k: string, v: string) => s.split(`{{${k}}}`).join(v || '');
        let t = rule!.template;
        t = rep(t, 'mark', m.name);
        t = rep(t, 'client', client?.name || m.owner || 'client');
        t = rep(t, 'jurisdiction', m.jurisdiction);
        t = rep(t, 'deadline', fmtDate(date));
        subject = `Re: ${m.name} - ${name}`;
        body = t;
      }
      window.open(`mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`);
      api.logCorrespondence(m.id, { to, subject, body }).catch(() => undefined);
    };
  };

  const importOwnerContacts = () => {
    if (!ownerCompany?.contacts?.length) return;
    const have = new Set((m.contacts || []).map((c) => `${c.name}|${c.email}`));
    const add = ownerCompany.contacts
      .map((c) => ({
        name: c.name || [c.first, c.last].filter(Boolean).join(' '),
        company: ownerCompany.name,
        position: c.position || c.title || '',
        phone: c.phone || '',
        email: c.email || '',
      }))
      .filter((c) => !have.has(`${c.name}|${c.email}`));
    update({ contacts: [...(m.contacts || []), ...add] }, true);
  };

  const selectOwner = (name: string) => {
    const co = companies.find((c) => c.name === name);
    const patch: Partial<Mark> = { owner: name };
    if (co) {
      patch.address1 = co.address;
      patch.address2 = co.address2;
      patch.city = co.city;
      patch.state = co.state;
      patch.zip = co.zip;
      patch.country = co.country || m.country;
      patch.phone = co.phone;
      patch.ownerType = co.type === 'Individual' ? 'Individual' : 'Company';
      if (co.contacts?.length && !(m.contacts || []).length) {
        patch.contacts = co.contacts.map((c) => ({
          name: c.name || [c.first, c.last].filter(Boolean).join(' '),
          company: co.name,
          position: c.position || c.title || '',
          phone: c.phone || '',
          email: c.email || '',
        }));
      }
    }
    update(patch, true);
  };

  const isIR = m.jurisdiction === 'Madrid Protocol (WIPO)';
  const isDesignation = !!m.irId;
  const mpEligible = !m.basicId && !isDesignation && !isIR && ['Australia', 'New Zealand'].includes(m.jurisdiction);
  const family = m.madridId ? allMarks.filter((x) => x.madridId === m.madridId && x.id !== m.id) : [];
  const irCase = isIR ? m : family.find((x) => x.jurisdiction === 'Madrid Protocol (WIPO)');
  const designations = irCase ? allMarks.filter((x) => x.irId === irCase.id) : [];
  const desigJurs = new Set(designations.map((x) => x.jurisdiction));
  const mpChoices = madridMembers().filter((c) => c !== m.jurisdiction && !desigJurs.has(c) && (!mpCountry || c.toLowerCase().includes(mpCountry.toLowerCase())));

  const ro = !canEdit;
  const now = Date.now();

  return (
    <>
      <button className="back" onClick={onBack}>← All trade marks</button>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{m.name || '(untitled trade mark)'}</h2>
        <div className="row">
          <span className="save-state">
            {saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : saveState === 'dirty' ? 'Editing…' : 'Save failed — retrying on next change'}
          </span>
          <select value={m.status} onChange={(e) => update({ status: e.target.value }, true)} disabled={ro} style={{ width: 'auto' }}>
            {[...new Set([...statusOptions(), m.status])].filter(Boolean).map((s) => <option key={s}>{s}</option>)}
          </select>
          <StatusBadge status={m.status} />
          {canEdit && (
            <button className="btn danger-link" onClick={() => { if (confirmDelete(`trade mark "${m.name}"`)) api.deleteMark(m.id).then(onDeleted); }}>
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="detail-cols">
        <div>
          <Card label="Trade mark">
            <div className="grid2">
              <Field label="Trade mark type">
                <select value={m.type} onChange={(e) => update({ type: e.target.value }, true)} disabled={ro}>
                  {[...new Set([...MARK_TYPES, m.type])].filter(Boolean).map((t) => <option key={t}>{t}</option>)}
                </select>
              </Field>
              <Field label="Jurisdiction">
                <select value={m.jurisdiction} onChange={(e) => update({ jurisdiction: e.target.value }, true)} disabled={ro}>
                  {[...new Set([m.jurisdiction, ...allJurisdictions()])].filter(Boolean).map((j) => (
                    <option key={j} value={j}>{j}</option>
                  ))}
                </select>
              </Field>
            </div>
            <TypeFields m={m} update={update} ro={ro} />
            <div className="grid3">
              <Field label="Application no."><input type="text" value={m.application} onChange={(e) => update({ application: e.target.value })} disabled={ro} /></Field>
              <Field label="Registration no."><input type="text" value={m.registration} onChange={(e) => update({ registration: e.target.value })} disabled={ro} /></Field>
              <Field label="Classes"><input type="text" value={m.classes} onChange={(e) => update({ classes: e.target.value })} disabled={ro} /></Field>
            </div>
            <Field label="International registration no. (Madrid Protocol)">
              <input type="text" value={m.irNumber || ''} onChange={(e) => update({ irNumber: e.target.value })} disabled={ro}
                placeholder="If this case is a designation under an overseas Madrid registration, e.g. IR No. 1234567" />
            </Field>
            {canEdit && m.jurisdiction === 'Australia' && (
              <div className="row" style={{ marginTop: -2, marginBottom: 8 }}>
                <button className="btn secondary small" disabled={lookupBusy} onClick={lookupIpAustralia} title="Fetch details from the IP Australia register using the application or registration number">
                  {lookupBusy ? 'Looking up…' : '🔍 Look up from IP Australia'}
                </button>
                <a href="https://search.ipaustralia.gov.au/trademarks/search/quick" target="_blank" rel="noreferrer" style={{ color: 'var(--accent-text)', fontSize: 12 }}>
                  Open register ↗
                </a>
                {lookupMsg && <span className="hint" style={{ color: lookupMsg.startsWith('Loaded') ? 'var(--success)' : 'var(--danger)' }}>{lookupMsg}</span>}
              </div>
            )}
            <Field label="Goods / services">
              <textarea value={m.goods} onChange={(e) => update({ goods: e.target.value })} disabled={ro} />
            </Field>
            <div className="grid3">
              <Field label="BrandU Legal file no."><input type="text" value={m.matter} onChange={(e) => update({ matter: e.target.value })} disabled={ro} /></Field>
              <Field label="Associates file ref."><input type="text" value={m.associateRef || ''} onChange={(e) => update({ associateRef: e.target.value })} disabled={ro} /></Field>
              <Field label="Client ref."><input type="text" value={m.clientDocket} onChange={(e) => update({ clientDocket: e.target.value })} disabled={ro} /></Field>
            </div>
          </Card>

          <Card
            label="Owner"
            right={
              ownerCompany ? (
                <button className="btn secondary small" onClick={() => go_company(ownerCompany.id)}>Open contact record</button>
              ) : undefined
            }
          >
            <div className="hint" style={{ marginBottom: 8 }}>
              Owner details are pulled from the Contacts records — select an owner to copy their address and contacts onto this case.
            </div>
            <div className="grid2">
              <Field label="Owner">
                <input type="text" list="owner-list" value={m.owner} onChange={(e) => selectOwner(e.target.value)} disabled={ro} />
                <datalist id="owner-list">
                  {companies.map((c) => <option key={c.id} value={c.name} />)}
                </datalist>
              </Field>
              <Field label="Owner type">
                <select value={m.ownerType || 'Company'} onChange={(e) => update({ ownerType: e.target.value as Mark['ownerType'] }, true)} disabled={ro}>
                  <option>Company</option>
                  <option>Individual</option>
                </select>
              </Field>
            </div>
            <div className="grid2">
              <Field label="ACN / ARBN"><input type="text" value={m.ownerAcn || ''} onChange={(e) => update({ ownerAcn: e.target.value })} disabled={ro} /></Field>
              <Field label="ABN"><input type="text" value={m.ownerAbn || ''} onChange={(e) => update({ ownerAbn: e.target.value })} disabled={ro} /></Field>
            </div>
            <div className="grid2">
              <Field label="Address"><input type="text" value={m.address1 || ''} onChange={(e) => update({ address1: e.target.value })} disabled={ro} /></Field>
              <Field label="Address 2"><input type="text" value={m.address2 || ''} onChange={(e) => update({ address2: e.target.value })} disabled={ro} /></Field>
            </div>
            <div className="grid3">
              <Field label={schema.city}><input type="text" value={m.city} onChange={(e) => update({ city: e.target.value })} disabled={ro} /></Field>
              {schema.state && <Field label={schema.state}><input type="text" value={m.state} onChange={(e) => update({ state: e.target.value })} disabled={ro} /></Field>}
              <Field label={schema.zip}><input type="text" value={m.zip} onChange={(e) => update({ zip: e.target.value })} disabled={ro} /></Field>
            </div>
            <div className="grid2">
              <Field label="Country">
                <input type="text" list="country-list" value={m.country} onChange={(e) => update({ country: e.target.value })} disabled={ro} />
                <datalist id="country-list">
                  {allJurisdictions().filter((j) => !/Madrid Protocol|WIPO/.test(j)).map((j) => <option key={j} value={j} />)}
                </datalist>
              </Field>
              <Field label="Phone"><input type="text" value={m.phone} onChange={(e) => update({ phone: e.target.value })} disabled={ro} /></Field>
            </div>
          </Card>

          <Card label="Disclaimers">
            <textarea value={m.disclaimers} onChange={(e) => update({ disclaimers: e.target.value })} disabled={ro} />
          </Card>
          <Card label="Comments">
            <textarea value={m.comments} onChange={(e) => update({ comments: e.target.value })} disabled={ro} />
          </Card>

          <Card label="Documents" right={canEdit ? <button className="btn small" onClick={() => update({ docs: [...(m.docs || []), { desc: '', link: '' }] }, true)}>+ Add document</button> : undefined}>
            {(m.docs || []).length === 0 && <div className="hint">No documents.</div>}
            {(m.docs || []).map((d, i) => (
              <div key={i} className="row" style={{ marginBottom: 6 }}>
                <input type="text" placeholder="Description" style={{ flex: 2 }} value={d.desc} disabled={ro}
                  onChange={(e) => update({ docs: m.docs.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x)) })} />
                <input type="text" placeholder="Link" style={{ flex: 2 }} value={d.link} disabled={ro}
                  onChange={(e) => update({ docs: m.docs.map((x, j) => (j === i ? { ...x, link: e.target.value } : x)) })} />
                {d.fileUrl ? (
                  <a href={d.fileUrl} target="_blank" rel="noreferrer" style={{ color: 'var(--accent-text)', fontSize: 12.5 }}>{d.fileName || 'file'}</a>
                ) : (
                  canEdit && (
                    <label className="btn secondary small" style={{ cursor: 'pointer' }}>
                      ⬆ Upload
                      <input type="file" style={{ display: 'none' }} onChange={async (e) => {
                        const f = e.target.files?.[0];
                        if (!f) return;
                        const up = await uploadFile(f);
                        update({ docs: m.docs.map((x, j) => (j === i ? { ...x, fileUrl: up.url, fileName: up.fileName, desc: x.desc || up.fileName } : x)) }, true);
                      }} />
                    </label>
                  )
                )}
                {canEdit && <button className="btn danger-link" onClick={() => update({ docs: m.docs.filter((_, j) => j !== i) }, true)}>✕</button>}
              </div>
            ))}
          </Card>
        </div>

        <div>
          <Card label="Dates">
            <table className="list">
              <thead>
                <tr><th style={{ width: 30 }}>✓</th><th>Date name</th><th style={{ width: 140 }}>Date</th><th>Note</th><th style={{ width: 60 }}></th></tr>
              </thead>
              <tbody>
                {visibleDates.map(({ d, i }) => {
                  const days = d.date ? (new Date(d.date + 'T00:00:00').getTime() - now) / 86400000 : NaN;
                  const urgent = !d.done && days >= -1 && days <= 30;
                  const email = emailForDate(d.name, d.emailFor, d.date);
                  return (
                    <tr key={`${d.name}-${i}`}>
                      <td><input type="checkbox" checked={!!d.done} disabled={ro} onChange={() => update({ dates: m.dates.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) }, true)} /></td>
                      <td className={d.done ? 'done' : ''} style={{ color: urgent ? 'var(--danger)' : undefined, fontWeight: d.reminder ? 400 : 500 }}>
                        {d.name}
                        {d.linkedToIR && <span className="hint" title="Linked to IR renewal date"> ⟳ IR</span>}
                      </td>
                      <td>
                        <input type="date" value={d.date || ''} disabled={ro || !!d.linkedToIR}
                          onChange={(e) => update({ dates: m.dates.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) }, true)} />
                      </td>
                      <td>
                        <input type="text" value={d.note || ''} placeholder="" disabled={ro}
                          onChange={(e) => update({ dates: m.dates.map((x, j) => (j === i ? { ...x, note: e.target.value } : x)) })} />
                      </td>
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {email && <button className="btn danger-link" title="Send client email" onClick={email}>✉</button>}
                        {canEdit && <button className="btn danger-link" onClick={() => update({ dates: m.dates.filter((_, j) => j !== i) }, true)}>✕</button>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {canEdit && (
              <div className="row" style={{ marginTop: 10 }}>
                <input type="text" list="date-names" placeholder="Add date…" style={{ flex: 2 }} value={addDateName} onChange={(e) => setAddDateName(e.target.value)} />
                <datalist id="date-names">{jurNames.map((n) => <option key={n} value={n} />)}</datalist>
                <input type="date" style={{ width: 150 }} value={addDateDate} onChange={(e) => setAddDateDate(e.target.value)} />
                <button className="btn small" disabled={!addDateName} onClick={() => {
                  update({ dates: [...m.dates, { name: addDateName, date: addDateDate || todayISO(), done: false }] }, true);
                  setAddDateName('');
                  setAddDateDate('');
                }}>
                  Add date
                </button>
              </div>
            )}
          </Card>

          <Card label="Contacts" right={canEdit ? (
            <div className="row">
              {ownerCompany?.contacts?.length ? <button className="btn secondary small" onClick={importOwnerContacts}>Import from owner</button> : null}
              <button className="btn small" onClick={() => update({ contacts: [...(m.contacts || []), { name: '', company: m.owner, position: '', phone: '', email: '' }] }, true)}>+ Add</button>
            </div>
          ) : undefined}>
            {(m.contacts || []).length === 0 && (
              <div className="hint">No contacts on this case{ownerCompany?.contacts?.length ? ' — import them from the owner record.' : '. Add one, or set an owner with contacts.'}</div>
            )}
            {(m.contacts || []).length > 0 && (
              <table className="list">
                <thead><tr><th>Name</th><th>Company</th><th>Position</th><th>Phone</th><th>Email</th><th /></tr></thead>
                <tbody>
                  {m.contacts.map((c, i) => (
                    <tr key={i}>
                      {(['name', 'company', 'position', 'phone', 'email'] as const).map((k) => (
                        <td key={k}>
                          <input type="text" value={c[k] || ''} disabled={ro}
                            onChange={(e) => update({ contacts: m.contacts.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)) })} />
                        </td>
                      ))}
                      <td>{canEdit && <button className="btn danger-link" onClick={() => update({ contacts: m.contacts.filter((_, j) => j !== i) }, true)}>✕</button>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </Card>

          <Card label="Trade mark actions" right={canEdit ? <button className="btn small" onClick={() => update({ actions: [...(m.actions || []), { date: todayISO(), text: '', done: false }] }, true)}>+ Add action</button> : undefined}>
            {(m.actions || []).length === 0 && <div className="hint">No actions.</div>}
            {(m.actions || []).map((a, i) => (
              <div key={i} className="row" style={{ marginBottom: 6 }}>
                <input type="checkbox" checked={!!a.done} disabled={ro} onChange={() => update({ actions: m.actions.map((x, j) => (j === i ? { ...x, done: !x.done } : x)) }, true)} />
                <input type="date" style={{ width: 140 }} value={a.date} disabled={ro} onChange={(e) => update({ actions: m.actions.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })} />
                <input type="text" style={{ flex: 1 }} className={a.done ? 'done' : ''} value={a.text} disabled={ro} onChange={(e) => update({ actions: m.actions.map((x, j) => (j === i ? { ...x, text: e.target.value } : x)) })} />
                <button className="btn danger-link" title={a.alert ? 'Alert on — shows in Alerts tab' : 'Alert off'} disabled={ro}
                  style={{ color: a.alert ? 'var(--accent)' : '#c8c7c2' }}
                  onClick={() => update({ actions: m.actions.map((x, j) => (j === i ? { ...x, alert: !x.alert, alertDate: x.alertDate || x.date || todayISO() } : x)) }, true)}>
                  🔔
                </button>
                {canEdit && <button className="btn danger-link" onClick={() => update({ actions: m.actions.filter((_, j) => j !== i) }, true)}>✕</button>}
              </div>
            ))}
          </Card>

          <Card label="Madrid Protocol filing">
            {isDesignation && irCase && (
              <div className="hint">
                Designation under <button className="back" style={{ margin: 0 }} onClick={() => onOpen(irCase.id)}>{irCase.application || 'the International Registration'}</button>.
                The renewal date is linked to the IR and updates automatically.
              </div>
            )}
            {family.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                {family.map((f) => (
                  <div key={f.id} className="row" style={{ justifyContent: 'space-between', border: '1px solid var(--border)', borderRadius: 7, padding: '6px 10px', marginBottom: 6, cursor: 'pointer' }} onClick={() => onOpen(f.id)}>
                    <span>{f.irId ? `Designation — ${f.jurisdiction}` : f.basicId ? 'International Registration (Madrid Protocol)' : `Basic case — ${f.jurisdiction}`}</span>
                    <span className="hint">{f.application || f.registration || 'no number'} · {f.status}</span>
                  </div>
                ))}
              </div>
            )}
            {mpEligible && canEdit && !irCase && (
              <button className="btn" onClick={() => api.fileMadrid(m.id).then(() => { onCreated(); })}>File a Madrid case</button>
            )}
            {(isIR || (mpEligible && irCase)) && canEdit && (
              <div style={{ marginTop: 8 }}>
                <div className="section-label">Add designation</div>
                <div className="row">
                  <input type="text" placeholder="Search Madrid member…" style={{ maxWidth: 240 }} value={mpCountry} onChange={(e) => setMpCountry(e.target.value)} />
                </div>
                {mpCountry && (
                  <div className="row" style={{ marginTop: 6 }}>
                    {mpChoices.slice(0, 8).map((c) => (
                      <button key={c} className="chip" onClick={() => {
                        const basicId = isIR ? (m.basicId || m.id) : m.id;
                        api.fileMadrid(basicId, c).then(() => { setMpCountry(''); onCreated(); });
                      }}>
                        + {c}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {designations.length > 0 && (
              <table className="list" style={{ marginTop: 8 }}>
                <thead><tr><th>Designation</th><th>Filed</th><th>Application</th><th>Status</th></tr></thead>
                <tbody>
                  {designations.map((d) => (
                    <tr key={d.id} className="click" onClick={() => onOpen(d.id)}>
                      <td>{d.jurisdiction}</td>
                      <td className="mono">{fmtDate((d.dates || []).find((x) => x.name === 'Application Filed')?.date || '') || '—'}</td>
                      <td className="mono">{d.application || '—'}</td>
                      <td><StatusBadge status={d.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {!mpEligible && !isIR && !isDesignation && !family.length && (
              <div className="hint">Madrid filings are made from an Australian or New Zealand basic case.</div>
            )}
          </Card>
        </div>
      </div>
    </>
  );

  function go_company(_id: string) {
    // Cross-tab navigation to the company record is handled by the Contacts tab.
    window.alert('Open the Contacts tab to view this owner record.');
  }
}

function TypeFields({ m, update, ro }: { m: Mark; update: (p: Partial<Mark>, flush?: boolean) => void; ro: boolean }) {
  switch (m.type) {
    case 'Word':
      return (
        <Field label="Word text">
          <input type="text" value={m.wordText ?? m.name} disabled={ro}
            onChange={(e) => update({ wordText: e.target.value, name: e.target.value })} />
        </Field>
      );
    case 'Logo':
    case 'Combined':
      return (
        <Field label={m.type === 'Logo' ? 'Graphic / image' : 'Logo / image'}>
          {m.image ? (
            <div className="row">
              <img src={m.image} alt="mark" style={{ maxHeight: 70, maxWidth: 180, objectFit: 'contain', border: '1px solid var(--border)', borderRadius: 7 }} />
              {!ro && <button className="btn danger-link" onClick={() => update({ image: null }, true)}>Remove</button>}
            </div>
          ) : ro ? (
            <div className="hint">No image.</div>
          ) : (
            <label className="btn secondary small" style={{ cursor: 'pointer', display: 'inline-block' }}>
              ⬆ Upload image
              <input type="file" accept="image/*" style={{ display: 'none' }} onChange={async (e) => {
                const f = e.target.files?.[0];
                if (!f) return;
                const up = await uploadFile(f);
                update({ image: up.url }, true);
              }} />
            </label>
          )}
        </Field>
      );
    case 'Sound':
      return (
        <>
          <Field label="Audio file">
            {m.audioUrl ? (
              <div className="row">
                <audio controls src={m.audioUrl} style={{ height: 32 }} />
                {!ro && <button className="btn danger-link" onClick={() => update({ audioUrl: '' }, true)}>Remove</button>}
              </div>
            ) : ro ? (
              <div className="hint">No audio.</div>
            ) : (
              <label className="btn secondary small" style={{ cursor: 'pointer', display: 'inline-block' }}>
                ⬆ Upload audio
                <input type="file" accept="audio/*" style={{ display: 'none' }} onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const up = await uploadFile(f);
                  update({ audioUrl: up.url }, true);
                }} />
              </label>
            )}
          </Field>
          <Field label="Description">
            <textarea value={m.soundDescription || ''} disabled={ro} onChange={(e) => update({ soundDescription: e.target.value })} />
          </Field>
        </>
      );
    case 'Series':
      return (
        <Field label="Series entries">
          {(m.seriesEntries || []).map((s, i) => (
            <div key={i} className="row" style={{ marginBottom: 6 }}>
              <input type="text" value={s.text} disabled={ro}
                onChange={(e) => update({ seriesEntries: (m.seriesEntries || []).map((x, j) => (j === i ? { text: e.target.value } : x)) })} />
              {!ro && <button className="btn danger-link" onClick={() => update({ seriesEntries: (m.seriesEntries || []).filter((_, j) => j !== i) }, true)}>✕</button>}
            </div>
          ))}
          {!ro && <button className="btn secondary small" onClick={() => update({ seriesEntries: [...(m.seriesEntries || []), { text: '' }] }, true)}>+ Add entry</button>}
        </Field>
      );
    case 'Scent':
    case 'Movement':
    case 'Colour':
    case '3D Shape':
      return (
        <Field label="Description">
          <textarea value={m.description || ''} disabled={ro} onChange={(e) => update({ description: e.target.value })} />
        </Field>
      );
    default:
      return null;
  }
}
