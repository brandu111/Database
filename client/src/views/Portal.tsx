import { useEffect, useState } from 'react';
import { fmtDate, type Mark, type Opposition } from '@brandu/shared';
import { api } from '../api';
import { Card, StatusBadge } from '../ui';

/** Client extranet: read-only view of the signed-in company's own matters. */
export function Portal({ company, onSignOut }: { company: string; onSignOut: () => void }) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [opps, setOpps] = useState<Opposition[]>([]);
  const [sel, setSel] = useState<Mark | null>(null);

  useEffect(() => {
    api.portalMarks().then(setMarks, () => undefined);
    api.portalOppositions().then(setOpps, () => undefined);
  }, []);

  return (
    <div className="app-shell">
      <div className="topbar">
        <div className="brand">
          brand<em>U</em> <span style={{ fontWeight: 500, color: 'var(--muted)', fontSize: 13 }}>Client portal</span>
        </div>
        <div className="whoami">
          <span>{company}</span>
          <button className="btn secondary small" onClick={onSignOut}>Sign out</button>
        </div>
      </div>
      <div className="main">
        {sel ? (
          <>
            <button className="back" onClick={() => setSel(null)}>← All trade marks</button>
            <h2>{sel.name}</h2>
            <div className="detail-cols">
              <Card label="Details">
                <table className="list">
                  <tbody>
                    <tr><td className="hint">Jurisdiction</td><td>{sel.jurisdiction}</td></tr>
                    <tr><td className="hint">Application no.</td><td className="mono">{sel.application || '—'}</td></tr>
                    <tr><td className="hint">Registration no.</td><td className="mono">{sel.registration || '—'}</td></tr>
                    <tr><td className="hint">Status</td><td><StatusBadge status={sel.status} /></td></tr>
                    <tr><td className="hint">Classes</td><td>{sel.classes || '—'}</td></tr>
                    <tr><td className="hint">Goods / services</td><td>{sel.goods || '—'}</td></tr>
                  </tbody>
                </table>
              </Card>
              <Card label="Key dates">
                <table className="list">
                  <tbody>
                    {(sel.dates || []).filter((d) => d.date && !d.reminder).map((d, i) => (
                      <tr key={i}>
                        <td className={d.done ? 'done' : ''}>{d.name}</td>
                        <td className="mono">{fmtDate(d.date)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            </div>
          </>
        ) : (
          <>
            <Card label={`Your trade marks (${marks.length})`}>
              <table className="list">
                <thead><tr><th>Trade mark</th><th>Jurisdiction</th><th>Application</th><th>Registration</th><th>Status</th></tr></thead>
                <tbody>
                  {marks.map((m) => (
                    <tr key={m.id} className="click" onClick={() => setSel(m)}>
                      <td style={{ fontWeight: 600, color: 'var(--heading)' }}>{m.name}</td>
                      <td>{m.jurisdiction}</td>
                      <td className="mono">{m.application || '—'}</td>
                      <td className="mono">{m.registration || '—'}</td>
                      <td><StatusBadge status={m.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            {opps.length > 0 && (
              <Card label={`Your oppositions (${opps.length})`}>
                <table className="list">
                  <thead><tr><th>Opposition</th><th>Jurisdiction</th><th>Status</th></tr></thead>
                  <tbody>
                    {opps.map((o) => (
                      <tr key={o.id}>
                        <td>{o.name}</td>
                        <td>{o.jurisdiction}</td>
                        <td><StatusBadge status={o.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
