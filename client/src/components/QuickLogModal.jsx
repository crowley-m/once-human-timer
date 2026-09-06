import { useMemo, useState } from 'react';
import { Check, Clock3 } from 'lucide-react';
import Modal from './Modal.jsx';
import { dualClock, elapsedMinutesSince, formatDuration } from '../time.js';

const TYPE_LABEL = { red_card: 'Red', elite: 'Elite', blue: 'Blue' };
const ORDER = ['red_card', 'elite', 'blue'];

export default function QuickLogModal({ zones, viewerTz, now, onLogNow, onLogTime, onClose }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();

  const groups = useMemo(
    () =>
      ORDER.map((type) => ({
        type,
        zones: zones
          .filter((z) => z.type === type)
          .filter((z) => !needle || z.name.toLowerCase().includes(needle))
          .sort((a, b) => a.name.localeCompare(b.name)),
      })).filter((g) => g.zones.length),
    [zones, needle]
  );

  const statusOf = (z) => {
    if (z.interval_minutes == null || !z.last_reset_at) return 'not logged';
    const rem = z.interval_minutes - elapsedMinutesSince(z.last_reset_at, now);
    if (rem <= 0) return `overdue ${formatDuration(-rem)}`;
    const nu = dualClock(
      new Date(Date.parse(z.last_reset_at) + z.interval_minutes * 60000).toISOString(),
      viewerTz,
      now
    );
    return `up ${nu.primary.time}`;
  };

  return (
    <Modal title="Log a reset" onClose={onClose}>
      <div className="qlog">
        <input
          className="qlog__search"
          autoFocus
          placeholder="find a zone…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <p className="form__hint">
          Pick a zone, then <b>done</b> if it reset this moment, or <b>set time</b> for a time your
          clan called out.
        </p>
        <div className="qlog__list">
          {groups.length === 0 && <p className="panel__empty">no match</p>}
          {groups.map((g) => (
            <div key={g.type}>
              <div className={`qlog__gh qlog__gh--${g.type}`}>{TYPE_LABEL[g.type]}</div>
              {g.zones.map((z) => (
                <div className="qlog__z" key={z.id}>
                  <div className="qlog__zi">
                    <span className="t">{z.name}</span>
                    <span className="qlog__st">{statusOf(z)}</span>
                  </div>
                  <button className="btn btn--sm btn--primary" onClick={() => onLogNow(z)}>
                    <Check size={13} /> done
                  </button>
                  <button className="btn btn--sm" onClick={() => onLogTime(z)}>
                    <Clock3 size={13} /> set time
                  </button>
                </div>
              ))}
            </div>
          ))}
        </div>
      </div>
    </Modal>
  );
}
