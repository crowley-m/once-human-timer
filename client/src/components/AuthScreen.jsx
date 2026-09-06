import { useState } from 'react';
import { LogIn, UserPlus } from 'lucide-react';
import { api } from '../api.js';

export default function AuthScreen({ board, onAuthed, onBrowse }) {
  const [mode, setMode] = useState('register'); // register | login
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [invite, setInvite] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const needsInvite = mode === 'register' && board?.registration === 'invite';

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res =
        mode === 'register'
          ? await api.register(username.trim(), password, invite.trim())
          : await api.login(username.trim(), password);
      onAuthed(res.user, res.board);
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  return (
    <div className="auth">
      <div className="auth__box">
        <div className="auth__brand">{board?.name || 'Rift Timers'}</div>
        <p className="auth__tag">Once Human raid-zone reset tracker.</p>

        <div className="auth__tabs">
          <button
            className={mode === 'register' ? 'is-on' : ''}
            onClick={() => { setMode('register'); setErr(null); }}
          >
            <UserPlus size={15} /> Create account
          </button>
          <button
            className={mode === 'login' ? 'is-on' : ''}
            onClick={() => { setMode('login'); setErr(null); }}
          >
            <LogIn size={15} /> Log in
          </button>
        </div>

        <form className="auth__form" onSubmit={submit}>
          <label className="field">
            <span>Username</span>
            <input
              autoFocus
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="how you'll show on the board"
              autoComplete="username"
              required
            />
          </label>
          <label className="field">
            <span>Password</span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={mode === 'register' ? 'new-password' : 'current-password'}
              minLength={6}
              required
            />
          </label>

          {needsInvite && (
            <label className="field">
              <span>Invite code</span>
              <input value={invite} onChange={(e) => setInvite(e.target.value)} placeholder="from your clan" required />
            </label>
          )}

          {err && <p className="form__err">{err}</p>}

          <button type="submit" className="btn btn--primary auth__submit" disabled={busy || !username.trim()}>
            {busy ? '…' : mode === 'register' ? 'Create account' : 'Log in'}
          </button>
        </form>

        <button className="lnk auth__browse" onClick={onBrowse}>
          just browse (read-only)
        </button>

        {mode === 'register' && (
          <p className="auth__note">
            No email needed. Forgot your password later? Ask a board admin to reset it.
          </p>
        )}
      </div>
    </div>
  );
}
