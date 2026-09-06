import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import Modal from './Modal.jsx';
import Avatar from './Avatar.jsx';
import { dualClock, formatAgo } from '../time.js';

const SOURCE_LABEL = { web: null, discord: 'via Discord', paste: 'via paste' };

export default function ActivityModal({ items, me, viewerTz, now, isAdmin, onJump, onClear, onClose }) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const run = async (alsoTimers) => {
    setBusy(true);
    try {
      await onClear(alsoTimers);
      setConfirming(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title="Recent activity" onClose={onClose}>
      <div className="act">
        {(!items || items.length === 0) && (
          <p className="panel__empty">nothing logged yet — reset a zone and it shows here.</p>
        )}
        <ul className="act__list">
          {items?.map((it, i) => {
            const when = dualClock(it.reset_at, viewerTz, now);
            const mine = it.by_name && it.by_name === me;
            const src = SOURCE_LABEL[it.source];
            return (
              <li key={`${it.created_at}-${i}`} className="act__row">
                <Avatar name={it.by_name || '?'} size={22} />
                <div className="act__body">
                  <div className="act__line">
                    <b>{mine ? 'You' : it.by_name || 'someone'}</b> logged{' '}
                    <button className="act__zone" onClick={() => onJump?.(it.zone_id)}>
                      {it.zone}
                    </button>
                  </div>
                  <div className="act__meta">
                    up {when.primary.day ? `${when.primary.day}, ` : ''}
                    {when.primary.time} {when.label}
                    {when.manila ? ` · ${when.manila.time} Manila` : ''}
                    {src ? ` · ${src}` : ''}
                  </div>
                </div>
                <span className="act__ago">{formatAgo(now - Date.parse(it.created_at))}</span>
              </li>
            );
          })}
        </ul>

        {isAdmin && onClear && (
          <div className="act__admin">
            {confirming ? (
              <>
                <span>Wipe the whole log?</span>
                <button className="btn btn--sm btn--danger" disabled={busy} onClick={() => run(false)}>
                  Clear history
                </button>
                <button className="btn btn--sm btn--danger" disabled={busy} onClick={() => run(true)}>
                  Clear + reset timers
                </button>
                <button className="btn btn--sm btn--ghost" disabled={busy} onClick={() => setConfirming(false)}>
                  keep it
                </button>
              </>
            ) : (
              <button className="btn btn--sm btn--ghost" onClick={() => setConfirming(true)}>
                <Trash2 size={13} /> Clear log…
              </button>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
