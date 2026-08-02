import { Fragment, useCallback, useEffect, useState } from 'react';
import { fmtDate, todayISO, type AlertRow, type EmailTemplate, type FirmSettings, type Mark, type RuleBook } from '@brandu/shared';
import { api } from '../api';
import { buildDeadlineEmail, templateForDate, type ComposedEmail } from '../email';
import { EmailComposeModal } from '../EmailComposeModal';

const KIND_STYLE: Record<AlertRow['kind'], { bg: string; fg: string }> = {
  Action: { bg: '#eef0f3', fg: '#3d444c' },
  Deadline: { bg: '#fbeceb', fg: '#d34b44' },
  'Client reminder': { bg: '#fdf3e4', fg: '#a06414' },
  Opposition: { bg: '#eae7f6', fg: '#5a3ea8' },
};

const rowKey = (a: AlertRow) => `${a.refId}|${a.date}|${a.text}`;

export function Alerts({ openMark, openOpposition, canEdit }: {
  openMark: (id: string) => void;
  openOpposition: (id: string) => void;
  canEdit: boolean;
}) {
  const [days, setDays] = useState(30);
  const [mode, setMode] = useState<'list' | 'calendar'>('list');
  const [fUser, setFUser] = useState('All users');
  const [rows, setRows] = useState<AlertRow[] | null>(null);
  const [busy, setBusy] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [markCache, setMarkCache] = useState<Record<string, Mark>>({});
  const [email, setEmail] = useState<(ComposedEmail & { title: string; hasLogo: boolean }) | null>(null);
  const [sending, setSending] = useState('');

  // Reference data needed to compose an email straight from the alert.
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [rules, setRules] = useState<RuleBook>({});
  const [firm, setFirm] = useState<FirmSettings | null>(null);
  const [mySignature, setMySignature] = useState('');

  const reload = useCallback(() => api.alerts(days).then(setRows), [days]);
  useEffect(() => {
    reload();
  }, [reload]);
  useEffect(() => {
    api.templates().then(setTemplates, () => undefined);
    api.rules().then((r) => setRules(r.rules), () => undefined);
    api.settings().then(setFirm, () => undefined);
    api.me().then((m) => setMySignature(m.kind === 'staff' ? m.signature || '' : ''), () => undefined);
  }, []);

  const loadMark = useCallback(async (id: string): Promise<Mark> => {
    if (markCache[id]) return markCache[id];
    const m = await api.mark(id);
    setMarkCache((c) => ({ ...c, [id]: m }));
    return m;
  }, [markCache]);

  const toggle = (a: AlertRow) => {
    const key = rowKey(a);
    setExpanded((e) => (e === key ? null : key));
    if (a.refType === 'mark') loadMark(a.refId).catch(() => undefined);
  };

  // The MarkDate behind an alert, so we can find its matching email template.
  const dateBehind = (m: Mark, a: AlertRow) =>
    (m.dates || []).find((d) => d.date === a.date && (d.name || '').replace(/ — Reminder.*$/, '') === a.text);

  const sendEmail = async (a: AlertRow) => {
    const key = rowKey(a);
    setSending(key);
    try {
      const m = await loadMark(a.refId);
      const d = dateBehind(m, a);
      const built = await buildDeadlineEmail({
        mark: m,
        dateName: d?.name || a.text,
        emailFor: d?.emailFor,
        date: a.date,
        templates,
        rules,
        firm,
        mySignature,
      });
      if (!built) {
        window.alert('No email template is linked to this deadline yet. Link one in Preferences → Email Templates.');
        return;
      }
      setEmail({ ...built, title: m.name || 'this case', hasLogo: !!m.image });
      api.logCorrespondence(m.id, { to: built.to, subject: built.subject, body: built.plain }).catch(() => undefined);
    } finally {
      setSending('');
    }
  };

  // A linked template exists for this alert (so a "Send email" button is useful).
  const canEmail = (a: AlertRow): boolean => {
    if (a.refType !== 'mark') return false;
    const m = markCache[a.refId];
    if (!m) return true; // unknown until loaded — offer it and validate on click
    const d = dateBehind(m, a);
    return !!templateForDate(m, d?.name || a.text, d?.emailFor, templates, rules);
  };

  /** Actioning an alert marks the underlying date / action done, which clears it. */
  const action = async (a: AlertRow) => {
    setBusy(rowKey(a));
    try {
      if (a.refType === 'mark') {
        const m = await api.mark(a.refId);
        if (a.kind === 'Action') {
          const hit = m.actions.find((x) => x.alert && !x.done && (x.alertDate || x.date) === a.date && (x.text || 'Action alert') === a.text);
          if (hit) hit.done = true;
        } else {
          const hit = m.dates.find((x) => !x.done && x.date === a.date && (x.name || '').replace(/ — Reminder.*$/, '') === a.text);
          if (hit) hit.done = true;
        }
        await api.saveMark(m);
        setMarkCache((c) => { const n = { ...c }; delete n[a.refId]; return n; });
      } else {
        const opps = await api.oppositions();
        const o = opps.find((x) => x.id === a.refId);
        if (o) {
          const hit = o.dates.find((x) => !x.done && x.date === a.date && x.name === a.text);
          if (hit) hit.done = true;
          await api.saveOpposition(o);
        }
      }
      await reload();
    } finally {
      setBusy('');
    }
  };

  if (!rows) return <div className="hint">Loading…</div>;

  // Users an alert can be attributed to (the responsible staff member), for the
  // "by user" filter. Rows with no attributed user fall under "Unassigned".
  const users = [...new Set(rows.map((r) => r.owner).filter(Boolean) as string[])].sort();
  const hasUnassigned = rows.some((r) => !r.owner);
  const shown = rows.filter((r) =>
    fUser === 'All users' ? true : fUser === 'Unassigned' ? !r.owner : (r.owner || '') === fUser
  );

  return (
    <>
      <div className="filters">
        <div className="section-label" style={{ marginBottom: 0 }}>Upcoming deadlines, reminders &amp; flagged actions</div>
        <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
          <select value={fUser} onChange={(e) => setFUser(e.target.value)} title="Show only alerts for a given staff member">
            <option>All users</option>
            {users.map((u) => <option key={u}>{u}</option>)}
            {hasUnassigned && <option>Unassigned</option>}
          </select>
          <button className={`chip${mode === 'list' ? ' on' : ''}`} onClick={() => setMode('list')}>List</button>
          <button className={`chip${mode === 'calendar' ? ' on' : ''}`} onClick={() => setMode('calendar')}>Calendar</button>
          <select value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))}>
            {[14, 30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>Next {d} days</option>)}
          </select>
        </div>
      </div>
      {mode === 'calendar' && <AlertsCalendar rows={shown} openMark={openMark} openOpposition={openOpposition} />}
      {mode === 'list' && (
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="list">
          <thead>
            <tr><th style={{ width: 24 }} /><th>Date</th><th>Kind</th><th>Matter</th><th>Jurisdiction</th><th>What</th><th>User</th><th style={{ width: 190 }} /></tr>
          </thead>
          <tbody>
            {shown.length === 0 && (
              <tr><td colSpan={8} className="hint" style={{ padding: 18 }}>Nothing due in the selected window{fUser === 'All users' ? '' : ` for ${fUser}`}.</td></tr>
            )}
            {shown.map((a, i) => {
              const ks = KIND_STYLE[a.kind];
              const key = rowKey(a);
              const isOpen = expanded === key;
              const m = markCache[a.refId];
              const d = m ? dateBehind(m, a) : undefined;
              return (
                <Fragment key={i}>
                  <tr>
                    <td>
                      <button className="btn secondary small" title={isOpen ? 'Collapse' : 'Show details'} onClick={() => toggle(a)} style={{ padding: '2px 7px' }}>
                        {isOpen ? '▾' : '▸'}
                      </button>
                    </td>
                    <td className={`mono${a.overdue ? ' overdue' : ''}`}>{fmtDate(a.date)}{a.overdue ? ' · overdue' : ''}</td>
                    <td><span className="kind-chip" style={{ background: ks.bg, color: ks.fg }}>{a.kind}</span></td>
                    <td>
                      <button className="back" style={{ margin: 0, fontWeight: 600 }}
                        onClick={() => (a.refType === 'mark' ? openMark(a.refId) : openOpposition(a.refId))}>
                        {a.mark}
                      </button>
                    </td>
                    <td>{a.jur || '—'}</td>
                    <td>{a.text}</td>
                    <td>{a.owner || <span className="hint">—</span>}</td>
                    <td>
                      <div className="row" style={{ gap: 6, justifyContent: 'flex-end' }}>
                        {canEdit && canEmail(a) && (
                          <button className="btn secondary small" disabled={sending === key} onClick={() => sendEmail(a)}>
                            {sending === key ? '…' : <><span className="email-ico">✉</span> Email</>}
                          </button>
                        )}
                        {canEdit && (
                          <button className="btn secondary small" disabled={busy === key} onClick={() => action(a)}>
                            {busy === key ? '…' : 'Mark done'}
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                  {isOpen && (
                    <tr>
                      <td />
                      <td colSpan={7} style={{ background: 'var(--panel)' }}>
                        <div style={{ padding: '6px 2px 10px' }}>
                          {a.refType === 'opposition' ? (
                            <div className="hint">Opposition matter — open the case to work the timeline.</div>
                          ) : !m ? (
                            <div className="hint">Loading case…</div>
                          ) : (
                            <div style={{ display: 'grid', gap: 4 }}>
                              <div><strong>{a.text}</strong> — due {fmtDate(a.date)}{a.overdue ? ' (overdue)' : ''}</div>
                              <div className="hint">
                                {m.name} · {m.jurisdiction}
                                {m.application ? ` · App ${m.application}` : ''}
                                {m.registration ? ` · Reg ${m.registration}` : ''}
                                {m.status ? ` · ${m.status}` : ''}
                              </div>
                              {(d?.createdBy || d?.note) && (
                                <div className="hint">
                                  {d?.createdBy ? `Added by ${d.createdBy}. ` : ''}{d?.note || ''}
                                </div>
                              )}
                              <div className="row" style={{ marginTop: 4, gap: 6 }}>
                                <button className="btn secondary small" onClick={() => openMark(a.refId)}>Open case</button>
                                {canEdit && canEmail(a) && (
                                  <button className="btn small" disabled={sending === key} onClick={() => sendEmail(a)}>
                                    {sending === key ? 'Preparing…' : <><span className="email-ico">✉</span> Send email</>}
                                  </button>
                                )}
                                {canEdit && !canEmail(a) && <span className="hint">No email template linked to this deadline.</span>}
                              </div>
                            </div>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      )}
      {email && <EmailComposeModal email={email} title={email.title} hasLogo={email.hasLogo} onClose={() => setEmail(null)} />}
    </>
  );
}

// Month-grid calendar of deadlines. Uses whatever alert rows are loaded (widen
// the day window to see further out).
function AlertsCalendar({ rows, openMark, openOpposition }: { rows: AlertRow[]; openMark: (id: string) => void; openOpposition: (id: string) => void }) {
  const [month, setMonth] = useState(() => { const d = new Date(); return new Date(d.getFullYear(), d.getMonth(), 1); });
  const byDay = new Map<string, AlertRow[]>();
  rows.forEach((a) => { const k = a.date; if (!byDay.has(k)) byDay.set(k, []); byDay.get(k)!.push(a); });

  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const startDow = (first.getDay() + 6) % 7; // Monday-first
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(month.getFullYear(), month.getMonth(), d));
  while (cells.length % 7 !== 0) cells.push(null);
  const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const todayIso = todayISO();
  const monthName = month.toLocaleString('en-AU', { month: 'long', year: 'numeric' });

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
        <button className="btn secondary small" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() - 1, 1))}>‹ Prev</button>
        <div style={{ fontWeight: 700 }}>{monthName}</div>
        <button className="btn secondary small" onClick={() => setMonth(new Date(month.getFullYear(), month.getMonth() + 1, 1))}>Next ›</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => <div key={d} className="hint" style={{ textAlign: 'center', fontWeight: 600 }}>{d}</div>)}
        {cells.map((d, i) => (
          <div key={i} style={{ minHeight: 78, border: '1px solid var(--border)', borderRadius: 6, padding: 3, background: d && iso(d) === todayIso ? 'var(--panel)' : undefined }}>
            {d && (
              <>
                <div className="hint" style={{ fontSize: 11, textAlign: 'right' }}>{d.getDate()}</div>
                {(byDay.get(iso(d)) || []).slice(0, 4).map((a, j) => (
                  <div key={j} title={`${a.mark} — ${a.text}`} onClick={() => (a.refType === 'mark' ? openMark(a.refId) : openOpposition(a.refId))}
                    style={{ fontSize: 10, cursor: 'pointer', background: a.overdue ? '#fbeceb' : '#eef3fb', color: a.overdue ? '#d34b44' : '#2b4a7a', borderRadius: 3, padding: '1px 3px', marginBottom: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.mark}
                  </div>
                ))}
                {(byDay.get(iso(d)) || []).length > 4 && <div className="hint" style={{ fontSize: 10 }}>+{(byDay.get(iso(d)) || []).length - 4} more</div>}
              </>
            )}
          </div>
        ))}
      </div>
      <div className="hint" style={{ marginTop: 8 }}>Showing deadlines in the selected day window. Widen it (top-right) to see further ahead. Click an item to open the case.</div>
    </div>
  );
}
