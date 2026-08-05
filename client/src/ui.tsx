import { useEffect, useRef, useState, type ReactNode } from 'react';

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO yyyy-mm-dd → dd/mm/yyyy for display/typing (Australian format). */
export function isoToDMY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

/**
 * Parse a typed date into ISO yyyy-mm-dd. Accepts dd/mm/yyyy, dd-mm-yyyy,
 * dd.mm.yyyy, ddmmyyyy, 2-digit years, and a raw ISO string. Returns '' for an
 * empty field (clears the date) and null when it can't be parsed (leave as-is).
 */
export function dmyToIso(text: string): string | null {
  const t = (text || '').trim();
  if (!t) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const m = /^(\d{1,2})[/\-. ](\d{1,2})[/\-. ](\d{2}|\d{4})$/.exec(t) || /^(\d{2})(\d{2})(\d{4}|\d{2})$/.exec(t);
  if (!m) return null;
  const d = parseInt(m[1], 10);
  const mo = parseInt(m[2], 10);
  let y = parseInt(m[3], 10);
  if (m[3].length === 2) y += y >= 70 ? 1900 : 2000;
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  const check = new Date(`${iso}T00:00:00`);
  if (check.getUTCMonth() + 1 !== mo || check.getUTCDate() !== d) return null; // e.g. 31/02
  return iso;
}

/**
 * A date field you can type into (dd/mm/yyyy) without fighting the browser date
 * picker, with a small calendar button as a fallback. Stores ISO yyyy-mm-dd.
 */
export function DateInput({ value, onChange, disabled, style }: { value: string; onChange: (iso: string) => void; disabled?: boolean; style?: React.CSSProperties }) {
  const [text, setText] = useState(isoToDMY(value));
  // Mirror the field text in a ref so `commit` always reads the very latest
  // keystroke, even if it fires before React has re-rendered (clicking away
  // right after the last digit used to commit a truncated, invalid date that
  // then reverted to the old value).
  const textRef = useRef(text);
  const setBoth = (v: string) => { textRef.current = v; setText(v); };
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { setBoth(isoToDMY(value)); }, [value]);
  // Commit from the raw value passed in (read straight off the input element),
  // so it can never lag the last keystroke.
  const commit = (raw: string) => {
    const iso = dmyToIso(raw);
    if (iso === null) setBoth(isoToDMY(value)); // unparseable → revert
    else if (iso !== value) onChange(iso);
  };
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', ...style }}>
      <input
        type="text"
        inputMode="numeric"
        placeholder="dd/mm/yyyy"
        value={text}
        disabled={disabled}
        onChange={(e) => setBoth(e.target.value)}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
        style={{ width: '100%', paddingRight: 26 }}
      />
      {!disabled && (
        <>
          <button
            type="button"
            title="Pick from calendar"
            onClick={() => { try { picker.current?.showPicker?.(); } catch { /* browser without showPicker */ } }}
            style={{ position: 'absolute', right: 4, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 14, lineHeight: 1, padding: 0 }}
          >
            📅
          </button>
          <input
            ref={picker}
            type="date"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            style={{ position: 'absolute', width: 1, height: 1, opacity: 0, right: 4, pointerEvents: 'none' }}
            tabIndex={-1}
          />
        </>
      )}
    </span>
  );
}

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
