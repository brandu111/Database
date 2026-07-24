import type { ReactNode } from 'react';

/** Status badge colors, ported from the prototype. */
export function badgeColors(status: string): [string, string] {
  const t = (status || '').toLowerCase();
  if (t.startsWith('registered')) return ['#e8f4ec', '#1d7a3f'];
  if (t.startsWith('accepted') || t.startsWith('headstart')) return ['#fbeceb', '#d34b44'];
  if (t.startsWith('refused') || t.startsWith('rejected') || t.startsWith('removed') || t.startsWith('opposed') || t.startsWith('cancelled'))
    return ['#fdeceb', '#c2372e'];
  if (t.startsWith('allow to lapse') || t.startsWith('watching') || t.startsWith('suspended') || t.startsWith('deferred') || t.startsWith('appeal'))
    return ['#fdf3e4', '#a06414'];
  if (t.startsWith('lapsed') || t.startsWith('withdrawn') || t.startsWith('no further') || t.startsWith('file transferred') || t.startsWith('matter settled'))
    return ['#f4f1ea', '#59616c'];
  return ['#eef0f3', '#2b3542'];
}

export function StatusBadge({ status }: { status: string }) {
  const [bg, fg] = badgeColors(status);
  return (
    <span className="badge" style={{ background: bg, color: fg }}>
      {status || '—'}
    </span>
  );
}

export function Card({ label, children, right }: { label?: string; children: ReactNode; right?: ReactNode }) {
  return (
    <div className="card">
      {(label || right) && (
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          {label ? <div className="section-label" style={{ marginBottom: 0 }}>{label}</div> : <span />}
          {right}
        </div>
      )}
      {children}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="field">
      <label>{label}</label>
      {children}
    </div>
  );
}

export function SortArrow({ active, dir }: { active: boolean; dir: number }) {
  if (!active) return null;
  return <span> {dir > 0 ? '▲' : '▼'}</span>;
}

export function confirmDelete(what: string): boolean {
  return window.confirm(`Delete ${what}? This cannot be undone.`);
}
