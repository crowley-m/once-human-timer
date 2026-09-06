import { useState } from 'react';
import Modal from './Modal.jsx';

const TYPES = [
  { value: 'red_card', label: 'Red Card Room' },
  { value: 'elite', label: 'Elite Enemy' },
  { value: 'blue', label: 'Blue Card Room' },
];
const DEFAULT_INTERVAL = { red_card: 120, elite: 60, blue: 60 };

export default function EditZoneModal({ zone, onClose, onSubmit, onDelete }) {
  const [name, setName] = useState(zone.name);
  const [note, setNote] = useState(zone.note || '');
  const [type, setType] = useState(zone.type);
  const [noInterval, setNoInterval] = useState(zone.type === 'blue' && zone.interval_minutes == null);
  const [interval, setInterval] = useState(
    zone.interval_minutes != null ? String(zone.interval_minutes) : String(DEFAULT_INTERVAL[zone.type])
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [confirmDel, setConfirmDel] = useState(false);

  const isBlue = type === 'blue';

  async function remove() {
    setBusy(true);
    setErr(null);
    try {
      await onDelete();
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await onSubmit({
        name: name.trim(),
        note: note.trim(),
        type,
        interval_minutes: isBlue && noInterval ? null : Number(interval),
      });
    } catch (e2) {
      setErr(e2.message);
      setBusy(false);
    }
  }

  return (
    <Modal title="Edit zone" onClose={onClose}>
      <form className="form" onSubmit={submit}>
        <label className="field">
          <span>Name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} required />
        </label>

        <label className="field">
          <span>Note (shown to everyone, optional)</span>
          <textarea
            rows={2}
            maxLength={280}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. good early-wipe gun loot · watch the south door"
          />
        </label>

        <label className="field">
          <span>Type</span>
          <select
            value={type}
            onChange={(e) => {
              const v = e.target.value;
              setType(v);
              setNoInterval(false);
              if (!interval || Number(interval) <= 0) setInterval(String(DEFAULT_INTERVAL[v]));
            }}
          >
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
            {busy ? 'Saving…' : 'Save changes'}
          </button>
        </div>

        {onDelete && (
          <div className="form__danger">
            {confirmDel ? (
              <>
                <span>Delete “{zone.name}” and its history?</span>
                <button type="button" className="btn btn--sm btn--danger" disabled={busy} onClick={remove}>
                  {busy ? 'Deleting…' : 'Yes, delete'}
                </button>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirmDel(false)}>
                  keep it
                </button>
              </>
            ) : (
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirmDel(true)}>
                Delete zone…
              </button>
            )}
          </div>
        )}
      </form>
    </Modal>
  );
}
