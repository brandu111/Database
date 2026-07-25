import { useEffect, useMemo, useState } from 'react';
import { fmtDate, todayISO, type FirmSettings, type Mark, type RuleBook } from '@brandu/shared';
import { api } from '../api';
import { toDataUri } from '../email';
import { SortArrow } from '../ui';

interface BaseCol {
  key: string;
  label: string;
  get: (m: Mark) => string;
  bold?: boolean;
  defaultOn?: boolean;
}

const BASE_COLS: BaseCol[] = [
  { key: 'owner', label: 'Company', get: (m) => m.owner || '', defaultOn: true },
  { key: 'name', label: 'Trade mark', get: (m) => m.name || '', bold: true, defaultOn: true },
  { key: 'jurisdiction', label: 'Jurisdiction', get: (m) => m.jurisdiction || '', defaultOn: true },
  { key: 'application', label: 'Application no.', get: (m) => m.application || '', defaultOn: true },
  { key: 'registration', label: 'Registration no.', get: (m) => m.registration || '', defaultOn: true },
  { key: 'status', label: 'Status', get: (m) => m.status || '', defaultOn: true },
  { key: 'classes', label: 'Classes', get: (m) => m.classes || '' },
  { key: 'goods', label: 'Goods/services', get: (m) => m.goods || '' },
  { key: 'clientDocket', label: 'Client file ref.', get: (m) => m.clientDocket || '' },
];

const IMG_RE = /\.(png|jpe?g|gif|webp|svg|bmp)$/i;
/**
 * The logo/graphic to show for a mark in the Trade mark column: the mark's own
 * image if it has one, otherwise the first image file attached as a document.
 */
function markLogo(m: Mark): string {
  if (m.image) return m.image;
  const doc = (m.docs || []).find((d) => d.fileUrl && (IMG_RE.test(d.fileUrl) || IMG_RE.test(d.fileName || '')));
  return doc?.fileUrl || '';
}

const LS_KEY = 'brandu.reportLayout';
function loadLayout(): { colsOn?: Record<string, boolean>; dateCols?: string[]; order?: string[] } {
  try {
    return JSON.parse(localStorage.getItem(LS_KEY) || '{}');
  } catch {
    return {};
  }
}

export function Reports() {
  const [marks, setMarks] = useState<Mark[]>([]);
  const [settings, setSettings] = useState<FirmSettings | null>(null);
  const [rules, setRules] = useState<RuleBook>({});
  const saved = useMemo(loadLayout, []);
  const [colsOn, setColsOn] = useState<Record<string, boolean>>(saved.colsOn || Object.fromEntries(BASE_COLS.map((c) => [c.key, !!c.defaultOn])));
  const [dateCols, setDateCols] = useState<string[]>(saved.dateCols || []);
  const [order, setOrder] = useState<string[]>(saved.order || []);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [overKey, setOverKey] = useState<string | null>(null);
  const [rCompany, setRCompany] = useState('All companies');
  const [rJur, setRJur] = useState('All jurisdictions');
  const [rStatus, setRStatus] = useState('All statuses');
  const [sort, setSort] = useState<{ key: string; dir: number }>({ key: 'name', dir: 1 });
  const [excluded, setExcluded] = useState<string[]>([]);

  // Persist the chosen layout (which columns, and their order) between visits.
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify({ colsOn, dateCols, order }));
    } catch {
      /* storage unavailable — layout just won't persist */
    }
  }, [colsOn, dateCols, order]);

  useEffect(() => {
    api.marks().then(setMarks);
    api.settings().then(setSettings, () => setSettings(null));
    api.rules().then((r) => setRules(r.rules), () => undefined);
  }, []);

  const owners = useMemo(() => [...new Set(marks.map((m) => m.owner).filter(Boolean))].sort(), [marks]);
  const jurs = useMemo(() => [...new Set(marks.map((m) => m.jurisdiction).filter(Boolean))].sort(), [marks]);
  const statuses = useMemo(() => [...new Set(marks.map((m) => m.status).filter(Boolean))].sort(), [marks]);

  const dateVal = (m: Mark, dn: string) => (m.dates || []).find((d) => (d.name || '') === dn && d.date)?.date || '';

  const activeCols = useMemo(() => {
    const all = BASE_COLS.filter((c) => colsOn[c.key])
      .map((c) => ({ key: c.key, label: c.label, bold: !!c.bold, removable: false, val: c.get }))
      .concat(dateCols.map((dn) => ({ key: `date:${dn}`, label: dn, bold: false, removable: true, val: (m: Mark) => fmtDate(dateVal(m, dn)) })));
    // Apply the user's saved column order; columns without a saved position
    // keep their natural order at the end (stable sort).
    const pos = (k: string) => {
      const i = order.indexOf(k);
      return i === -1 ? Number.MAX_SAFE_INTEGER : i;
    };
    return all
      .map((c, i) => ({ c, i }))
      .sort((a, b) => pos(a.c.key) - pos(b.c.key) || a.i - b.i)
      .map((x) => x.c);
  }, [colsOn, dateCols, order]);

  // Move a column so it lands at the target column's position.
  const moveColumn = (fromKey: string, toKey: string) => {
    if (fromKey === toKey) return;
    const keys = activeCols.map((c) => c.key);
    const from = keys.indexOf(fromKey);
    const to = keys.indexOf(toKey);
    if (from === -1 || to === -1) return;
    keys.splice(from, 1);
    keys.splice(to, 0, fromKey);
    setOrder(keys);
  };

  const dateColOptions = useMemo(() => {
    const names = new Set<string>(['Application Filed', 'OA Issued', 'Publication Date', 'Registration Date', 'Renewal Deadline', 'Notice of Allowance']);
    Object.values(rules).flat().forEach((r) => r.name && names.add(r.name));
    return [...names].filter((n) => !dateCols.includes(n)).sort();
  }, [rules, dateCols]);

  const sorted = useMemo(() => {
    const q = rCompany.trim().toLowerCase();
    const rows = marks.filter(
      (m) =>
        (!q || q === 'all companies' || (m.owner || '').toLowerCase().includes(q)) &&
        (rJur === 'All jurisdictions' || m.jurisdiction === rJur) &&
        (rStatus === 'All statuses' || m.status === rStatus) &&
        !excluded.includes(m.id)
    );
    const col = activeCols.find((c) => c.key === sort.key) || activeCols[0];
    if (col) rows.sort((a, b) => String(col.val(a) || '').localeCompare(String(col.val(b) || ''), undefined, { numeric: true }) * sort.dir);
    return rows;
  }, [marks, rCompany, rJur, rStatus, excluded, activeCols, sort]);

  const buildTableHtml = (images: Record<string, string>) => {
    const esc = (s: unknown) => String(s ?? '').split('&').join('&amp;').split('<').join('&lt;').split('>').join('&gt;');
    const cellStyle = 'border:1px solid #999;padding:5px 8px;font-family:Calibri,Arial,sans-serif;font-size:11pt';
    const th = activeCols.map((c) => `<th style="${cellStyle};background:#eee;text-align:left">${esc(c.label)}</th>`).join('');
    const cell = (c: { key: string; val: (m: Mark) => string }, m: Mark) => {
      // Show the logo and the mark name together, so the row is always
      // identifiable and the graphic is never the only thing in the cell.
      if (c.key === 'name' && images[m.id]) {
        return `<img src="${images[m.id]}" style="max-height:44px;max-width:170px;vertical-align:middle" /> ${esc(c.val(m) || '')}`;
      }
      return esc(c.val(m) || '');
    };
    const trs = sorted.map((m) => `<tr>${activeCols.map((c) => `<td style="${cellStyle}">${cell(c, m)}</td>`).join('')}</tr>`).join('');
    const logo = settings?.logo ? `<img src="${settings.logo}" style="max-height:60px;margin-bottom:8px"><br>` : '';
    const title = `<div style="font-family:Calibri,Arial,sans-serif;font-size:16pt;font-weight:bold;margin-bottom:2px">${esc(settings?.lawFirmName || 'BrandU Legal')} — Trade Marks Report</div>`;
    const sub = `<div style="font-family:Calibri,Arial,sans-serif;font-size:10pt;color:#555;margin-bottom:10px">${esc(fmtDate(todayISO()))} · ${sorted.length} matters</div>`;
    return `${logo}${title}${sub}<table style="border-collapse:collapse"><tr>${th}</tr>${trs}</table>`;
  };

  const download = async (mime: string, ext: string) => {
    // Inline each logo mark's image as a data URI so it appears in the exported
    // Word/Excel file (the /files URL is behind login and wouldn't load there).
    const images: Record<string, string> = {};
    if (colsOn.name) {
      await Promise.all(
        sorted
          .map((m) => ({ m, logo: markLogo(m) }))
          .filter((x) => x.logo)
          .map(async ({ m, logo }) => {
            const uri = await toDataUri(logo);
            if (uri) images[m.id] = uri;
          })
      );
    }
    const html = `<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"></head><body>${buildTableHtml(images)}</body></html>`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([html], { type: mime }));
    a.download = `trade-marks-report.${ext}`;
    a.click();
  };

  return (
    <>
      <div className="card">
        <div className="section-label">Columns</div>
        <div className="row" style={{ marginBottom: 10 }}>
          {BASE_COLS.map((c) => (
            <button key={c.key} className={`chip${colsOn[c.key] ? ' on' : ''}`} onClick={() => setColsOn({ ...colsOn, [c.key]: !colsOn[c.key] })}>
              {c.label}
            </button>
          ))}
          <select value="" onChange={(e) => e.target.value && setDateCols([...dateCols, e.target.value])} style={{ width: 'auto' }}>
            <option value="">+ Add date column…</option>
            {dateColOptions.map((n) => <option key={n}>{n}</option>)}
          </select>
          {order.length > 0 && (
            <button className="btn secondary small" title="Restore the default column order" onClick={() => setOrder([])}>Reset order</button>
          )}
        </div>
        <div className="hint" style={{ marginBottom: 10 }}>Drag a column heading left or right to reorder. Click a heading to sort. Your layout is saved on this computer.</div>
        <div className="row">
          <span style={{ position: 'relative', display: 'inline-flex', alignItems: 'center' }}>
            <input type="text" list="report-companies" placeholder="🔍 Search company…" value={rCompany === 'All companies' ? '' : rCompany}
              onChange={(e) => setRCompany(e.target.value || 'All companies')} style={{ minWidth: 220 }} />
            <datalist id="report-companies">{owners.map((o) => <option key={o} value={o} />)}</datalist>
            {rCompany && rCompany !== 'All companies' && (
              <button className="btn danger-link" title="Clear" onClick={() => setRCompany('All companies')} style={{ position: 'absolute', right: 4 }}>✕</button>
            )}
          </span>
          <select value={rJur} onChange={(e) => setRJur(e.target.value)}>
            <option>All jurisdictions</option>
            {jurs.map((j) => <option key={j}>{j}</option>)}
          </select>
          <select value={rStatus} onChange={(e) => setRStatus(e.target.value)}>
            <option>All statuses</option>
            {statuses.map((s) => <option key={s}>{s}</option>)}
          </select>
          <span className="hint">{sorted.length} matters</span>
          {excluded.length > 0 && (
            <button className="btn secondary small" onClick={() => setExcluded([])}>Restore removed ({excluded.length})</button>
          )}
          <div className="row" style={{ marginLeft: 'auto' }}>
            <button className="btn secondary" onClick={() => download('application/msword', 'doc')}>Export to Word</button>
            <button className="btn" onClick={() => download('application/vnd.ms-excel', 'xls')}>Export to Excel</button>
          </div>
        </div>
      </div>

      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '16px 18px', borderBottom: '2px solid var(--accent, #d34b44)' }}>
          {settings?.logo && <img src={settings.logo} alt="logo" style={{ maxHeight: 52, maxWidth: 180, objectFit: 'contain' }} />}
          <div>
            <div style={{ fontSize: 19, fontWeight: 700, color: 'var(--heading)' }}>{settings?.lawFirmName || 'BrandU Legal'} — Trade Marks Report</div>
            <div className="hint">{fmtDate(todayISO())} · {sorted.length} matters</div>
          </div>
          <span className="hint" style={{ marginLeft: 'auto', textAlign: 'right' }}>Change the logo &amp; firm name in<br />Preferences → Settings &amp; Users</span>
        </div>
        <table className="list">
          <thead>
            <tr>
              {activeCols.map((c) => (
                <th
                  key={c.key}
                  draggable
                  onDragStart={(e) => { setDragKey(c.key); e.dataTransfer.effectAllowed = 'move'; }}
                  onDragOver={(e) => { e.preventDefault(); if (overKey !== c.key) setOverKey(c.key); }}
                  onDragLeave={() => setOverKey((k) => (k === c.key ? null : k))}
                  onDrop={(e) => { e.preventDefault(); if (dragKey) moveColumn(dragKey, c.key); setDragKey(null); setOverKey(null); }}
                  onDragEnd={() => { setDragKey(null); setOverKey(null); }}
                  onClick={() => setSort({ key: c.key, dir: sort.key === c.key ? -sort.dir : 1 })}
                  title="Click to sort · drag to reorder"
                  style={{
                    cursor: 'move',
                    opacity: dragKey === c.key ? 0.4 : 1,
                    borderLeft: overKey === c.key && dragKey && dragKey !== c.key ? '3px solid var(--accent, #2563eb)' : undefined,
                  }}
                >
                  <span style={{ opacity: 0.4, marginRight: 4, cursor: 'grab' }} aria-hidden>⠿</span>
                  {c.label}
                  <SortArrow active={sort.key === c.key} dir={sort.dir} />
                  {c.removable && (
                    <button className="btn danger-link" onClick={(e) => { e.stopPropagation(); setDateCols(dateCols.filter((x) => `date:${x}` !== c.key)); }}>✕</button>
                  )}
                </th>
              ))}
              <th style={{ width: 30 }} />
            </tr>
          </thead>
          <tbody>
            {sorted.length === 0 && <tr><td colSpan={activeCols.length + 1} className="hint" style={{ padding: 18 }}>No matters match the filters.</td></tr>}
            {sorted.slice(0, 500).map((m) => (
              <tr key={m.id}>
                {activeCols.map((c) => {
                  const logo = c.key === 'name' ? markLogo(m) : '';
                  return (
                    <td key={c.key} style={c.bold ? { fontWeight: 600, color: 'var(--heading)' } : undefined}>
                      {logo ? (
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                          <img
                            src={logo}
                            alt=""
                            style={{ maxHeight: 40, maxWidth: 120, objectFit: 'contain', verticalAlign: 'middle' }}
                            onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = 'none'; }}
                          />
                          <span>{m.name || '—'}</span>
                        </span>
                      ) : (
                        c.val(m) || '—'
                      )}
                    </td>
                  );
                })}
                <td>
                  <button className="btn danger-link" title="Remove from report" onClick={() => setExcluded([...excluded, m.id])}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {sorted.length > 500 && <div className="hint" style={{ padding: 10 }}>Showing first 500 rows on screen — exports include all {sorted.length}.</div>}
      </div>
    </>
  );
}
