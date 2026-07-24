import { useCallback, useEffect, useState } from 'react';
import { fmtDate, type AlertRow } from '@brandu/shared';
import { api } from '../api';

const KIND_STYLE: Record<AlertRow['kind'], { bg: string; fg: string }> = {
  Action: { bg: '#eef0f3', fg: '#3d444c' },
  Deadline: { bg: '#fbeceb', fg: '#d34b44' },
  'Client reminder': { bg: '#fdf3e4', fg: '#a06414' },
  Opposition: { bg: '#eae7f6', fg: '#5a3ea8' },
};

export function Alerts({ openMark, openOpposition, canEdit }: {
  openMark: (id: string) => void;
  openOpposition: (id: string) => void;
  canEdit: boolean;
}) {
  const [days, setDays] = useState(30);
  const [rows, setRows] = useState<AlertRow[] | null>(null);
  const [busy, setBusy] = useState('');

  const reload = useCallback(() => api.alerts(days).then(setRows), [days]);
  useEffect(() => {
    reload();
  }, [reload]);

  /** Actioning an alert marks the underlying date / action done, which clears it. */
  const action = async (a: AlertRow) => {
    setBusy(`${a.refId}|${a.date}|${a.text}`);
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

  return (
    <>
      <div className="filters">
        <div className="section-label" style={{ marginBottom: 0 }}>Upcoming deadlines, reminders &amp; flagged actions</div>
        <select value={days} onChange={(e) => setDays(parseInt(e.target.value, 10))} style={{ marginLeft: 'auto' }}>
          {[14, 30, 60, 90, 180, 365].map((d) => <option key={d} value={d}>Next {d} days</option>)}
        </select>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="list">
          <thead>
            <tr><th>Date</th><th>Kind</th><th>Matter</th><th>Jurisdiction</th><th>What</th><th style={{ width: 110 }} /></tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={6} className="hint" style={{ padding: 18 }}>Nothing due in the selected window.</td></tr>
            )}
            {rows.map((a, i) => {
              const ks = KIND_STYLE[a.kind];
              const key = `${a.refId}|${a.date}|${a.text}`;
              return (
                <tr key={i}>
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
                  <td>
                    {canEdit && (
                      <button className="btn secondary small" disabled={busy === key} onClick={() => action(a)}>
                        {busy === key ? '…' : 'Mark done'}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}
