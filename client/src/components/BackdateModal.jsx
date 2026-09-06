import { useState } from 'react';
import Modal from './Modal.jsx';
import { LOCAL_TZ, MANILA_TZ, clockIn, tzShort, toLocalInputValue } from '../time.js';

export default function BackdateModal({ zone, onClose, onSubmit }) {
  const [when, setWhen] = useState(toLocalInputValue(new Date()));
  const [by, setBy] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const parsed = new Date(when);
  const manilaEcho = Number.isNaN(parsed.getTime())
    ? null
    : clockIn(parsed.toISOString(), MANILA_TZ, Date.now());
  const sameZone = tzShort(LOCAL_TZ) === tzShort(MANILA_TZ);

  async function submit(e) {
    e.preventDefault();
    const date = new Date(when);
    if (Number.isNaN(date.getTime())) {
      setErr('Pick a valid date and time.');
      return;
    }
    if (date.getTime() > Date.now() + 60_000) {
      setErr('That time is in the future.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await onSubmit({ reset_at: date.toISOString(), by: by.trim() || undefined });
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  return (
    <Modal title={`${zone.name} — reset time`} onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <p className="form__hint">
          For a time someone called out earlier. (If it just reset, use <b>just now</b> instead.)
        </p>

        <label className="field">
          <span>When did it reset?  ·  your time ({tzShort(LOCAL_TZ)})</span>
          <input
            type="datetime-local"
            value={when}
            max={toLocalInputValue(new Date())}
            onChange={(e) => setWhen(e.target.value)}
            required
          />
        </label>
        {manilaEcho && !sameZone && (
          <p className="form__hint">
            = {manilaEcho.day ? `${manilaEcho.day}, ` : ''}{manilaEcho.time} in Manila
          </p>
        )}

        <label className="field">
          <span>Your name (optional)</span>
          <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="who saw it" />
        </label>

        {err && <p className="form__err">{err}</p>}

        <div className="form__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            {busy ? 'Logging…' : 'Log reset'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
