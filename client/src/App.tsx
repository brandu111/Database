import { useCallback, useEffect, useState } from 'react';
import { api, type Me } from './api';
import { GlobalSearch } from './GlobalSearch';
import { Login } from './views/Login';
import { Dashboard } from './views/Dashboard';
import { Trademarks } from './views/Trademarks';
import { Oppositions } from './views/Oppositions';
import { Contacts } from './views/Contacts';
import { Alerts } from './views/Alerts';
import { Reports } from './views/Reports';
import { Preferences } from './views/Preferences';
import { Portal } from './views/Portal';

// Bumped on each deploy so it's easy to confirm the browser is running the
// newest build (shown small under the sign-out button).
const BUILD = 'build 2026-08-05-7';

export type View = 'dashboard' | 'trademarks' | 'designs' | 'oppositions' | 'contacts' | 'alerts' | 'reports' | 'preferences';

export interface Nav {
  view: View;
  markId: string | null;
  oppositionId: string | null;
  companyId: string | null;
}

const TABS: { key: View; label: string }[] = [
  { key: 'dashboard', label: 'Dashboard' },
  { key: 'trademarks', label: 'Trade Marks' },
  { key: 'designs', label: 'Registered Designs' },
  { key: 'oppositions', label: 'Oppositions' },
  { key: 'contacts', label: 'Contacts' },
  { key: 'alerts', label: 'Alerts' },
  { key: 'reports', label: 'Reports' },
  { key: 'preferences', label: 'Preferences' },
];

export function App() {
  const [me, setMe] = useState<Me | null | 'loading'>('loading');
  const [nav, setNav] = useState<Nav>({ view: 'dashboard', markId: null, oppositionId: null, companyId: null });

  useEffect(() => {
    api.me().then(setMe, () => setMe(null));
  }, []);

  const go = useCallback((patch: Partial<Nav>) => setNav((n) => ({ ...n, ...patch })), []);
  const openMark = useCallback((id: string) => setNav((n) => ({ ...n, view: 'trademarks', markId: id })), []);
  const openOpposition = useCallback((id: string) => setNav((n) => ({ ...n, view: 'oppositions', oppositionId: id })), []);
  const openCompany = useCallback((id: string) => setNav((n) => ({ ...n, view: 'contacts', companyId: id })), []);

  if (me === 'loading') return null;
  if (!me) return <Login onSignedIn={setMe} />;
  if (me.kind === 'client') return <Portal company={me.company} onSignOut={() => api.logout().then(() => setMe(null))} />;

  const canEdit = me.level === 'Full Permissions' || me.level === 'Edit Only';
  const isFull = me.level === 'Full Permissions';

  return (
    <div className="app-shell">
      <nav className="sidebar">
        <div className="brand">
          brand<em>U</em>
          <span className="brand-sub">Trade Mark Database</span>
        </div>
        <div className="nav-links">
          {TABS.map((t) => (
            <button key={t.key} className={`navlink${nav.view === t.key ? ' active' : ''}`} onClick={() => go({ view: t.key, markId: null, oppositionId: null, companyId: null })}>
              {t.label}
            </button>
          ))}
        </div>
        <div className="whoami">
          <span>{me.name}</span>
          <span className="who-level">{me.level}</span>
          <button className="btn secondary small" onClick={() => api.logout().then(() => setMe(null))}>
            Sign out
          </button>
          <span style={{ fontSize: 10, opacity: 0.6, marginTop: 6 }}>{BUILD}</span>
        </div>
      </nav>
      <div className="content">
        <div className="topstrip">
          <GlobalSearch onOpenMark={openMark} onOpenCompany={openCompany} />
        </div>
        <div className="main">
          {nav.view === 'dashboard' && <Dashboard openMark={openMark} openOpposition={openOpposition} go={(view) => go({ view })} canEdit={canEdit} />}
          {nav.view === 'trademarks' && <Trademarks nav={nav} go={go} canEdit={canEdit} />}
          {nav.view === 'designs' && <Trademarks key="designs" nav={nav} go={go} canEdit={canEdit} designsOnly />}
          {nav.view === 'oppositions' && <Oppositions nav={nav} go={go} canEdit={canEdit} />}
          {nav.view === 'contacts' && <Contacts nav={nav} go={go} canEdit={canEdit} openMark={openMark} />}
          {nav.view === 'alerts' && <Alerts openMark={openMark} openOpposition={openOpposition} canEdit={canEdit} />}
          {nav.view === 'reports' && <Reports />}
          {nav.view === 'preferences' && <Preferences isFull={isFull} />}
        </div>
      </div>
    </div>
  );
}
