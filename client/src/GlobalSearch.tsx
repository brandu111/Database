import { useEffect, useMemo, useRef, useState } from 'react';
import type { Company, Mark } from '@brandu/shared';
import { api } from './api';

interface Hit { type: 'mark' | 'company'; id: string; label: string; sub: string; }

/** Header search across trade marks (name, numbers, owner, refs) and companies. */
export function GlobalSearch({ onOpenMark, onOpenCompany }: { onOpenMark: (id: string) => void; onOpenCompany: (id: string) => void }) {
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [hi, setHi] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open && marks.length === 0) {
      api.marks().then(setMarks, () => undefined);
      api.companies().then(setCompanies, () => undefined);
    }
  }, [open, marks.length]);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, []);

  const results = useMemo<Hit[]>(() => {
    const s = q.trim().toLowerCase();
    if (!s) return [];
    const m = marks
      .filter((x) => [x.name, x.application, x.registration, x.owner, x.matter, x.clientDocket, x.irNumber].some((v) => (v || '').toLowerCase().includes(s)))
      .slice(0, 8)
      .map<Hit>((x) => ({ type: 'mark', id: x.id, label: x.name || '(untitled)', sub: [x.jurisdiction, x.application || x.registration, x.owner].filter(Boolean).join(' · ') }));
    const c = companies
      .filter((x) => (x.name || '').toLowerCase().includes(s))
      .slice(0, 5)
      .map<Hit>((x) => ({ type: 'company', id: x.id, label: x.name, sub: 'Contact record' }));
    return [...m, ...c];
  }, [q, marks, companies]);

  const choose = (h: Hit) => {
    setOpen(false);
    setQ('');
    if (h.type === 'mark') onOpenMark(h.id);
    else onOpenCompany(h.id);
  };

  return (
    <div ref={box} style={{ position: 'relative', margin: '0 10px' }}>
      <input
        type="text"
        value={q}
        placeholder="🔍 Search marks, owners, refs…"
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); setHi(0); }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHi((h) => Math.min(h + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setHi((h) => Math.max(h - 1, 0));
          else if (e.key === 'Enter' && results[hi]) choose(results[hi]);
          else if (e.key === 'Escape') setOpen(false);
        }}
        style={{ width: 260, padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)' }}
      />
      {open && q.trim() && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, marginTop: 4, background: '#fff', border: '1px solid var(--border)', borderRadius: 8, boxShadow: '0 6px 24px rgba(0,0,0,0.12)', zIndex: 60, maxHeight: 360, overflowY: 'auto' }}>
          {results.length === 0 && <div className="hint" style={{ padding: 10 }}>No matches.</div>}
          {results.map((h, i) => (
            <div
              key={`${h.type}-${h.id}`}
              onMouseDown={(e) => { e.preventDefault(); choose(h); }}
              onMouseEnter={() => setHi(i)}
              style={{ padding: '7px 10px', cursor: 'pointer', background: i === hi ? 'var(--panel)' : undefined, borderBottom: '1px solid var(--border)' }}
            >
              <div style={{ fontWeight: 600, color: 'var(--heading)' }}>{h.type === 'company' ? '🏢 ' : ''}{h.label}</div>
              <div className="hint" style={{ fontSize: 12 }}>{h.sub}</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
