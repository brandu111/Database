import { useEffect, useRef, useState, type ReactNode } from 'react';
import { fmtDate, parseDateInput } from '@brandu/shared';

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

/**
 * A date field that can be edited by typing — no date picker required. Shows the
 * date as `DD MMM YYYY`; while focused it lets you type any common format
 * (25/07/2026, 25 Jul 2026, 2026-07-25, …). Commits on blur or Enter, reverting
 * to the last good value if the text can't be understood. A native calendar
 * picker is still available via the 📅 button for those who prefer it.
 */
export function DateInput({
  value,
  onChange,
  disabled,
  style,
}: {
  value: string;
  onChange: (iso: string) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}) {
  const [text, setText] = useState(value ? fmtDate(value) : '');
  const [focused, setFocused] = useState(false);
  const pickerRef = useRef<HTMLInputElement>(null);

  // Keep the shown text in step with the stored value while not being edited.
  useEffect(() => {
    if (!focused) setText(value ? fmtDate(value) : '');
  }, [value, focused]);

  const commit = () => {
    const t = text.trim();
    if (!t) {
      if (value) onChange('');
      setText('');
      return;
    }
    const iso = parseDateInput(t);
    if (iso) {
      if (iso !== value) onChange(iso);
      setText(fmtDate(iso));
    } else {
      // Unparseable — revert to the stored value.
      setText(value ? fmtDate(value) : '');
    }
  };

  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', ...style }}>
      <input
        type="text"
        inputMode="numeric"
        placeholder="DD/MM/YYYY"
        value={text}
        disabled={disabled}
        style={{ width: '100%', paddingRight: 26 }}
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { commit(); setFocused(false); }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { commit(); (e.target as HTMLInputElement).blur(); }
          if (e.key === 'Escape') { setText(value ? fmtDate(value) : ''); (e.target as HTMLInputElement).blur(); }
        }}
      />
      {!disabled && (
        <>
          <button
            type="button"
            title="Pick from a calendar"
            onClick={() => {
              const el = pickerRef.current as (HTMLInputElement & { showPicker?: () => void }) | null;
              if (!el) return;
              if (typeof el.showPicker === 'function') el.showPicker();
              else el.focus();
            }}
            style={{ position: 'absolute', right: 2, border: 'none', background: 'transparent', cursor: 'pointer', fontSize: 13, padding: 2, lineHeight: 1 }}
          >
            📅
          </button>
          {/* Hidden native picker — feeds the field when used, but typing never needs it. */}
          <input
            ref={pickerRef}
            type="date"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            tabIndex={-1}
            aria-hidden
            style={{ position: 'absolute', right: 0, width: 1, height: 1, opacity: 0, pointerEvents: 'none' }}
          />
        </>
      )}
    </span>
  );
}
