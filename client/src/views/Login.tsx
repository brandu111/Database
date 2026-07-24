import { useState, type FormEvent } from 'react';
import { api, type Me } from '../api';

export function Login({ onSignedIn }: { onSignedIn: (me: Me) => void }) {
  const [mode, setMode] = useState<'staff' | 'client'>('staff');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      if (mode === 'staff') {
        const r = await api.login(username, password);
        onSignedIn({ kind: 'staff', name: r.name, level: r.level });
      } else {
        const r = await api.clientLogin(username, password);
        onSignedIn({ kind: 'client', company: r.company });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login-wrap">
      <form className="login-card" onSubmit={submit}>
        <div className="brand" style={{ padding: 0, marginBottom: 4, fontSize: 20 }}>
          brand<em style={{ color: 'var(--accent)', fontStyle: 'normal' }}>U</em> Legal
        </div>
        <div className="hint" style={{ marginBottom: 18 }}>
          Trade mark portfolio &amp; docketing
        </div>
        <div className="row" style={{ marginBottom: 14 }}>
          <button type="button" className={`chip${mode === 'staff' ? ' on' : ''}`} onClick={() => setMode('staff')}>
            Staff
          </button>
          <button type="button" className={`chip${mode === 'client' ? ' on' : ''}`} onClick={() => setMode('client')}>
            Client access
          </button>
        </div>
        <div className="field">
          <label>{mode === 'staff' ? 'User name' : 'Login ID'}</label>
          <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
        </div>
        {error && <div className="err" style={{ marginBottom: 10 }}>{error}</div>}
        <button className="btn" style={{ width: '100%', padding: '9px 0' }} disabled={busy}>
          Sign in
        </button>
      </form>
    </div>
  );
}
