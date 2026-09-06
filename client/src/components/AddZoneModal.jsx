import { useState } from 'react';
import Modal from './Modal.jsx';

const TYPES = [
  { value: 'red_card', label: 'Red Card Room', defaultInterval: 120 },
  { value: 'elite', label: 'Elite Enemy', defaultInterval: 60 },
  { value: 'blue', label: 'Blue Card Room', defaultInterval: 60 },
];

export default function AddZoneModal({ onClose, onCreate }) {
  const [name, setName] = useState('');
  const [type, setType] = useState('red_card');
  const [interval, setInterval] = useState('120');
  const [noInterval, setNoInterval] = useState(false); // blue rooms may opt out of staleness
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);

  const isBlue = type === 'blue';

  function pickType(value) {
    setType(value);
    setNoInterval(false);
    setInterval(String(TYPES.find((x) => x.value === value).defaultInterval));
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await onCreate({
        name: name.trim(),
        type,
        interval_minutes: isBlue && noInterval ? null : Number(interval),
      });
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Add a tracked zone" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Forsaken Monolith"
            required
          />
        </label>

        <label className="field">
          <span>Type</span>
          <select value={type} onChange={(e) => pickType(e.target.value)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </label>

        {!(isBlue && noInterval) && (
          <label className="field">
            <span>Reset interval (minutes)</span>
            <input
              type="number"
              min="1"
              value={interval}
              onChange={(e) => setInterval(e.target.value)}
              required
            />
          </label>
        )}

        {isBlue && (
          <label className="field field--row">
            <input
              type="checkbox"
              checked={noInterval}
              onChange={(e) => setNoInterval(e.target.checked)}
            />
            <span>No interval — track elapsed only, never flag stale</span>
          </label>
        )}

        {err && <p className="form__err">{err}</p>}

        <div className="form__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Cancel</button>
          <button type="submit" className="btn btn--primary" disabled={busy || !name.trim()}>
            {busy ? 'Adding…' : 'Add zone'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
