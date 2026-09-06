import { useMemo, useState } from 'react';
import Modal from './Modal.jsx';
import { api } from '../api.js';
import { parseLog } from '../parseLog.js';
import { MANILA_TZ, clockIn } from '../time.js';

export default function PasteLogModal({ zones, onClose, onDone }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [applied, setApplied] = useState(0);

  const parsed = useMemo(() => (text.trim() ? parseLog(text, zones) : []), [text, zones]);
  const ok = parsed.filter((p) => !p.ambiguous);
  const unclear = parsed.filter((p) => p.ambiguous);

  async function apply() {
    setBusy(true);
    setErr(null);
    let n = 0;
    try {
      // oldest first so repeated sightings of a zone land in order
      const ordered = [...ok].sort((a, b) => Date.parse(a.resetAt) - Date.parse(b.resetAt));
      for (const p of ordered) {
        await api.resetZone(p.zone.id, {
          reset_at: p.resetAt,
          by: 'pasted log',
          note: `pasted: "${p.line}"`,
        });
        n++;
      }
      setApplied(n);
      await onDone();
      setText('');
    } catch (e) {
      setErr(`${e.message} (applied ${n} before the error)`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Paste Discord log" onClose={onClose} wide>
      <div className="roster">
        <p className="form__hint">
          Paste lines from your reset-log channel — with or without the{' '}
          <code>Name — Yesterday at 10:20</code> header lines (those set the time anchor).
          Times are read as Manila 12-hour, as “next expected reset”. Review below, then apply.
        </p>

        <textarea
          className="roster__text"
          spellCheck={false}
          rows={12}
          placeholder={'salt [COB],  — Yesterday at 22:39\nFORSAKEN ELITE 1:00 am\nfurnace red 3:53\nsunbry elite 3:26'}
          value={text}
          onChange={(e) => setText(e.target.value)}
        />

        {parsed.length > 0 && (
          <div className="roster__plan">
            {ok.map((p, i) => {
              const nu = clockIn(
                new Date(Date.parse(p.resetAt) + (p.zone.interval_minutes ?? 60) * 60000).toISOString(),
                MANILA_TZ,
                Date.now()
              );
              return (
                <p key={`ok${i}`}>
                  <span className="roster__tag roster__tag--add">log</span>{' '}
                  {p.zone.name} — up at {nu.day ? `${nu.day} ` : ''}{nu.time} MNL
                  {p.score < 0.9 && <span className="c-dim"> · fuzzy {p.score}</span>}
                  <span className="c-dim"> · “{p.line}”</span>
                </p>
              );
            })}
            {unclear.map((p, i) => (
              <p key={`x${i}`}>
                <span className="roster__tag roster__tag--del">skip</span>{' '}
                <span className="roster__warn">{p.reason}</span>
                <span className="c-dim"> · “{p.line}”</span>
              </p>
            ))}
          </div>
        )}

        {applied > 0 && !text && <p className="form__hint">Applied {applied} reset(s). Board updated.</p>}
        {err && <p className="form__err">{err}</p>}

        <div className="form__actions">
          <button type="button" className="btn btn--ghost" onClick={onClose}>Close</button>
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy || ok.length === 0}
            onClick={apply}
          >
            {busy ? 'Applying…' : `Apply ${ok.length} reset${ok.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </div>
    </Modal>
  );
}
