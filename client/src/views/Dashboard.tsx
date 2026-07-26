import { useEffect, useMemo, useState } from 'react';
import { fmtDate, todayISO, type AlertRow, type EmailTemplate, type FirmSettings, type Mark, type Opposition, type RuleBook } from '@brandu/shared';
import type { View } from '../App';
import { api } from '../api';
import { buildDeadlineEmail, templateForDate, type ComposedEmail } from '../email';
import { EmailComposeModal } from '../EmailComposeModal';

const INACTIVE = ['lapsed', 'withdrawn', 'allow to lapse', 'matter settled', 'removed', 'refused', 'cancelled'];
const daysUntil = (iso: string) => Math.round((new Date(iso + 'T00:00:00').getTime() - Date.now()) / 86400000);

function Tile({ label, value, tone, onClick }: { label: string; value: number | string; tone?: 'danger' | 'warn' | 'ok'; onClick?: () => void }) {
  const color = tone === 'danger' ? 'var(--danger)' : tone === 'warn' ? '#a06414' : tone === 'ok' ? '#1d7a3f' : 'var(--heading)';
  return (
    <button className="card" onClick={onClick} style={{ textAlign: 'left', cursor: onClick ? 'pointer' : 'default', border: '1px solid var(--border)', padding: '14px 16px', margin: 0 }}>
      <div style={{ fontSize: 28, fontWeight: 700, color, lineHeight: 1.1 }}>{value}</div>
      <div className="hint" style={{ marginTop: 4 }}>{label}</div>
    </button>
  );
}

function Bars({ data }: { data: { label: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <div style={{ display: 'grid', gap: 6 }}>
      {data.map((d) => (
        <div key={d.label} style={{ display: 'grid', gridTemplateColumns: '120px 1fr 36px', alignItems: 'center', gap: 8 }}>
          <div className="hint" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.label}</div>
          <div style={{ background: 'var(--panel)', borderRadius: 4, height: 16 }}>
            <div style={{ width: `${(d.value / max) * 100}%`, background: 'var(--accent, #d34b44)', height: '100%', borderRadius: 4, minWidth: d.value ? 3 : 0 }} />
          </div>
          <div style={{ textAlign: 'right', fontWeight: 600 }}>{d.value}</div>
        </div>
      ))}
    </div>
  );
}

export function Dashboard({ openMark, openOpposition, go, canEdit }: {
  openMark: (id: string) => void;
  openOpposition: (id: string) => void;
  go: (view: View) => void;
  canEdit: boolean;
}) {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [opps, setOpps] = useState<Opposition[]>([]);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [me, setMe] = useState<string>('');
  const [mineOnly, setMineOnly] = useState(false);
  const [templates, setTemplates] = useState<EmailTemplate[]>([]);
  const [rules, setRules] = useState<RuleBook>({});
  const [firm, setFirm] = useState<FirmSettings | null>(null);
  const [mySignature, setMySignature] = useState('');
  const [email, setEmail] = useState<(ComposedEmail & { title: string; hasLogo: boolean }) | null>(null);
  const [sending, setSending] = useState('');

  useEffect(() => {
    api.marks().then(setMarks, () => undefined);
    api.oppositions().then(setOpps, () => undefined);
    api.alerts(90).then(setAlerts, () => undefined);
    api.me().then((m) => { if (m.kind === 'staff') { setMe(m.name); setMySignature(m.signature || ''); } }, () => undefined);
    api.templates().then(setTemplates, () => undefined);
    api.rules().then((r) => setRules(r.rules), () => undefined);
    api.settings().then(setFirm, () => undefined);
  }, []);

  const attorneyOf = useMemo(() => new Map(marks.map((m) => [m.id, m.attorney || ''])), [marks]);
  const mine = (a: AlertRow) => !mineOnly || (a.refType === 'mark' && attorneyOf.get(a.refId) === me) || a.owner === me;

  const active = marks.filter((m) => !INACTIVE.some((s) => (m.status || '').toLowerCase().startsWith(s)));
  const registered = marks.filter((m) => (m.status || '').toLowerCase().startsWith('registered'));
  const pending = marks.filter((m) => /pending|accepted|examination/i.test(m.status || ''));

  const renewals = useMemo(() => {
    const out: { m: Mark; date: string; days: number }[] = [];
    for (const m of marks) {
      const r = (m.dates || []).find((d) => d.name === 'Renewal Deadline' && !d.done && d.date);
      if (r) out.push({ m, date: r.date, days: daysUntil(r.date) });
    }
    return out.sort((a, b) => (a.date < b.date ? -1 : 1));
  }, [marks]);
  const dueWithin = (n: number) => renewals.filter((r) => r.days <= n && r.days >= 0).length;
  const overdueCount = alerts.filter((a) => a.overdue && mine(a)).length;
  const oppsOnFoot = opps.filter((o) => !/settled|withdrawn|resolved/i.test(o.status || '')).length;

  const needsAttention = useMemo(() => alerts.filter((a) => a.overdue || daysUntil(a.date) <= 30).filter(mine).slice(0, 40), [alerts, mineOnly, me, attorneyOf]);

  const renewalsByYear = useMemo(() => {
    const now = new Date().getFullYear();
    const buckets: { label: string; value: number }[] = [];
    for (let y = now; y <= now + 5; y++) buckets.push({ label: String(y), value: renewals.filter((r) => r.date.startsWith(String(y))).length });
    return buckets;
  }, [renewals]);

  const byStatus = useMemo(() => {
    const map = new Map<string, number>();
    marks.forEach((m) => map.set(m.status || '—', (map.get(m.status || '—') || 0) + 1));
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 7);
  }, [marks]);

  const byJurisdiction = useMemo(() => {
    const map = new Map<string, number>();
    marks.forEach((m) => map.set(m.jurisdiction || '—', (map.get(m.jurisdiction || '—') || 0) + 1));
    return [...map.entries()].map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value).slice(0, 8);
  }, [marks]);

  const upcomingRenewalFees = renewals.filter((r) => r.days <= 90 && r.days >= 0).reduce((sum, r) => sum + (Number(r.m.renewalFee) || 0), 0);

  const dateBehind = (m: Mark, a: AlertRow) => (m.dates || []).find((d) => d.date === a.date && (d.name || '').replace(/ — Reminder.*$/, '') === a.text);
  const canEmail = (a: AlertRow) => {
    if (a.refType !== 'mark') return false;
    const m = marks.find((x) => x.id === a.refId);
    if (!m) return false;
    const d = dateBehind(m, a);
    return !!templateForDate(m, d?.name || a.text, d?.emailFor, templates, rules);
  };
  const sendEmail = async (a: AlertRow) => {
    setSending(`${a.refId}|${a.date}|${a.text}`);
    try {
      const m = await api.mark(a.refId);
      const d = dateBehind(m, a);
      const built = await buildDeadlineEmail({ mark: m, dateName: d?.name || a.text, emailFor: d?.emailFor, date: a.date, templates, rules, firm, mySignature });
      if (built) { setEmail({ ...built, title: m.name || 'this case', hasLogo: !!m.image }); api.logCorrespondence(m.id, { to: built.to, subject: built.subject, body: built.plain }).catch(() => undefined); }
    } finally {
      setSending('');
    }
  };

  return (
    <>
      <div className="row" style={{ marginBottom: 12, alignItems: 'center' }}>
        <div className="section-label" style={{ marginBottom: 0 }}>Dashboard</div>
        {me && (
          <label className="row" style={{ marginLeft: 'auto', gap: 6, cursor: 'pointer' }}>
            <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> <span className="hint">My cases only ({me})</span>
          </label>
        )}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Tile label="Active trade marks" value={active.length} onClick={() => go('trademarks')} />
        <Tile label="Registered" value={registered.length} tone="ok" />
        <Tile label="Pending / in prosecution" value={pending.length} />
        <Tile label="Renewals due ≤ 30 days" value={dueWithin(30)} tone={dueWithin(30) ? 'warn' : undefined} onClick={() => go('alerts')} />
        <Tile label="Renewals due ≤ 90 days" value={dueWithin(90)} tone={dueWithin(90) ? 'warn' : undefined} />
        <Tile label="Overdue items" value={overdueCount} tone={overdueCount ? 'danger' : 'ok'} onClick={() => go('alerts')} />
        <Tile label="Oppositions on foot" value={oppsOnFoot} onClick={() => go('oppositions')} />
        {upcomingRenewalFees > 0 && <Tile label="Renewal fees due ≤ 90 days" value={`$${upcomingRenewalFees.toLocaleString()}`} />}
      </div>

      <div className="detail-cols">
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
            <div className="section-label" style={{ marginBottom: 0 }}>Needs attention {mineOnly ? '(mine)' : ''}</div>
            <button className="btn secondary small" onClick={() => go('alerts')}>Open Alerts</button>
          </div>
          {needsAttention.length === 0 && <div className="hint">Nothing due in the next 30 days. 🎉</div>}
          <div style={{ display: 'grid', gap: 4 }}>
            {needsAttention.map((a, i) => (
              <div key={i} className="row" style={{ gap: 8, padding: '4px 0', borderBottom: '1px solid var(--border)' }}>
                <span className="mono" style={{ width: 92, color: a.overdue ? 'var(--danger)' : undefined, fontSize: 12 }}>{fmtDate(a.date)}</span>
                <button className="back" style={{ margin: 0, fontWeight: 600, flex: 1, textAlign: 'left' }} onClick={() => (a.refType === 'mark' ? openMark(a.refId) : openOpposition(a.refId))}>{a.mark}</button>
                <span className="hint" style={{ flex: 1 }}>{a.text}</span>
                {canEdit && canEmail(a) && <button className="btn secondary small email-btn" title="Send client email" disabled={!!sending} onClick={() => sendEmail(a)}><span className="email-ico">✉</span></button>}
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="card">
            <div className="section-label">Renewals by year</div>
            <Bars data={renewalsByYear} />
          </div>
          <div className="card">
            <div className="section-label">Portfolio by status</div>
            <Bars data={byStatus} />
          </div>
          <div className="card">
            <div className="section-label">Portfolio by jurisdiction</div>
            <Bars data={byJurisdiction} />
          </div>
        </div>
      </div>
      {email && <EmailComposeModal email={email} title={email.title} hasLogo={email.hasLogo} onClose={() => setEmail(null)} />}
    </>
  );
}
