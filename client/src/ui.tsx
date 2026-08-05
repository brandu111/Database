import { useEffect, useRef, useState, type ReactNode } from 'react';

const pad = (n: number) => String(n).padStart(2, '0');

/** ISO yyyy-mm-dd → dd/mm/yyyy for display/typing (Australian format). */
export function isoToDMY(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso || '');
  return m ? `${m[3]}/${m[2]}/${m[1]}` : '';
}

// Month names/abbreviations → month number, so legal-office dates like
// "3 Jan 2023", "Jan 3, 2023" or "3 January 2023" parse as readily as 3/1/2023.
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

/**
 * Parse a typed date into ISO yyyy-mm-dd. Deliberately liberal so day-to-day
 * typing just works. Accepts, with any separator (/, ., -, space or none):
 *   - dd/mm/yyyy, dd-mm-yyyy, dd.mm.yyyy, dd mm yyyy
 *   - ddmmyyyy and ddmmyy (no separators)
 *   - 2-digit years (70+ → 19xx, else 20xx)
 *   - month names: "3 Jan 2023", "Jan 3 2023", "3 January 2023", "3-Jan-23"
 *   - a raw ISO string (yyyy-mm-dd)
 * Returns '' for an empty field (clears the date) and null when it genuinely
 * can't be read (the caller keeps the user's text and shows a hint rather than
 * blanking the field).
 */
export function dmyToIso(text: string): string | null {
  // Strip zero-width, bidi and other invisible/control characters first — some
  // keyboards, extensions and paste sources sneak these in and they must never
  // stop a perfectly good date from parsing.
  const t = (text || '').replace(/[\u0000-\u001F\u00A0\u200B-\u200F\u202A-\u202E\u2060\uFEFF]/g, '').trim();
  if (!t) return '';
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(t)) {
    const [yy, mm, dd] = t.split('-').map(Number);
    return validDate(dd, mm, yy);
  }
  let d: number, mo: number, y: number, yLen: number;
  const nums = t.match(/\d+/g) || [];
  const nameMatch = t.match(/[A-Za-z]+/);
  const monthName = nameMatch ? MONTHS[nameMatch[0].toLowerCase()] : undefined;
  if (monthName && nums.length === 2) {
    // A month written as a word, e.g. "3 Jan 2023" or "Jan 3, 2023".
    const [a, b] = nums;
    if (a.length === 4 || +a > 31) { y = +a; yLen = a.length; d = +b; }
    else { d = +a; y = +b; yLen = b.length; }
    mo = monthName;
  } else if (nums.length === 3) {
    // Numeric d/m/y. A stray letter that isn't a month name is ignored — we go
    // by the three number groups, whatever punctuation or junk sits between them.
    d = +nums[0]; mo = +nums[1]; y = +nums[2]; yLen = nums[2].length;
  } else if (/^\d{8}$/.test(t)) {
    d = +t.slice(0, 2); mo = +t.slice(2, 4); y = +t.slice(4); yLen = 4;
  } else if (/^\d{6}$/.test(t)) {
    d = +t.slice(0, 2); mo = +t.slice(2, 4); y = +t.slice(4); yLen = 2;
  } else {
    return null;
  }
  if (yLen === 2) y += y >= 70 ? 1900 : 2000;
  return validDate(d, mo, y);
}

/** Render a raw string with any non-printable / non-ASCII character shown as its
 * code point («N»), so an invisible stray character is visible in the hint. */
function visibleRaw(s: string): string {
  return [...(s || '')].map((ch) => {
    const c = ch.charCodeAt(0);
    return c < 32 || c > 126 ? `«${c}»` : ch;
  }).join('');
}

/** Build an ISO date, returning null for out-of-range or non-existent dates (e.g. 31 Feb). */
function validDate(d: number, mo: number, y: number): string | null {
  if (!Number.isFinite(d) || !Number.isFinite(mo) || !Number.isFinite(y)) return null;
  if (d < 1 || d > 31 || mo < 1 || mo > 12 || y < 1000 || y > 9999) return null;
  const iso = `${y}-${pad(mo)}-${pad(d)}`;
  const check = new Date(`${iso}T00:00:00`);
  if (check.getUTCMonth() + 1 !== mo || check.getUTCDate() !== d) return null;
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
  // When the typed text can't be read as a date we KEEP it on screen and flag it,
  // rather than silently wiping the field (which looked like the date "going
  // blank" for no reason). Cleared as soon as the user edits again.
  const [badText, setBadText] = useState(false);
  const [badRaw, setBadRaw] = useState('');
  const picker = useRef<HTMLInputElement>(null);
  useEffect(() => { setBoth(isoToDMY(value)); setBadText(false); }, [value]);
  // Commit from the raw value passed in (read straight off the input element),
  // so it can never lag the last keystroke.
  const commit = (raw: string) => {
    const iso = dmyToIso(raw);
    if (iso === null) {
      // Unreadable: keep what they typed and show a hint instead of blanking.
      // Also surface the exact characters (visibly and in the console) so an
      // invisible/stray character sneaking in can be identified.
      if ((raw || '').trim()) {
        setBadText(true);
        setBadRaw(raw);
        try { console.warn('[DateInput] could not parse:', JSON.stringify(raw), 'char codes:', [...raw].map((c) => c.charCodeAt(0)).join(',')); } catch { /* noop */ }
        return;
      }
      setBoth(isoToDMY(value)); // empty text → restore the stored value
    } else {
      setBadText(false);
      setBoth(isoToDMY(iso)); // always show the canonical dd/mm/yyyy, even if unchanged
      if (iso !== value) onChange(iso);
    }
  };
  return (
    <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center', ...style }}>
      <input
        type="text"
        inputMode="text"
        placeholder="dd/mm/yyyy"
        value={text}
        disabled={disabled}
        title={badText ? "Couldn't read that date — try 3/1/2023 or 3 Jan 2023" : undefined}
        onChange={(e) => { setBadText(false); setBoth(e.target.value); }}
        onFocus={(e) => e.target.select()}
        onBlur={(e) => commit(e.currentTarget.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') commit((e.target as HTMLInputElement).value); }}
        style={{ width: '100%', paddingRight: 26, ...(badText ? { borderColor: '#c2372e', background: '#fdeceb' } : null) }}
      />
      {badText && (
        <span style={{ position: 'absolute', top: '100%', left: 0, fontSize: 11, color: '#c2372e', whiteSpace: 'nowrap', zIndex: 1 }}>
          Couldn't read “{visibleRaw(badRaw)}” — try 3/1/2023 or 3 Jan 2023
        </span>
      )}
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
