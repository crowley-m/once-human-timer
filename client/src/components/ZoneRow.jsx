import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Clock3, Hand, Pencil, RotateCcw, Star, StickyNote, X } from 'lucide-react';
import { dualClock, elapsedMinutesSince, formatDuration } from '../time.js';
import { api } from '../api.js';
import BackdateModal from './BackdateModal.jsx';
import EditZoneModal from './EditZoneModal.jsx';

const SOON_MIN = 15;
const NEAR_MIN = 5;
const STALE_FACTOR = 2;
const LEADS = [0, 5, 10, 15];

export default function ZoneRow({
  zone,
  now,
  me,
  isAdmin,
  timeMode = 'in',
  viewerTz,
  showSource = true,
  watched,
  onToggleWatch,
  showType = false,
  zoneLead,
  defaultLead = 0,
  onSetLead,
  fresh,
  focus,
  onFocused,
  onReset,
  onUpdate,
  onDelete,
  onClaim,
  onUnclaim,
  onClearZone,
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [backdating, setBackdating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [err, setErr] = useState(null);
  const [history, setHistory] = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    if (open && history === null) {
      api.zoneHistory(zone.id).then((h) => setHistory(h.resets || [])).catch(() => setHistory([]));
    }
  }, [open, history, zone.id]);
  useEffect(() => {
    if (fresh) setHistory(null); // refetch after a new reset
  }, [fresh]);

  useEffect(() => {
    if (focus) {
      setOpen(true);
      ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      onFocused?.();
    }
  }, [focus, onFocused]);

  const elapsed = elapsedMinutesSince(zone.last_reset_at, now);
  const hasInterval = zone.interval_minutes != null;
  const remaining = hasInterval && elapsed != null ? zone.interval_minutes - elapsed : null;
  const veryStale = remaining != null && -remaining > zone.interval_minutes * STALE_FACTOR;

  let state = 'awaiting';
  if (zone.last_reset_at) {
    if (!hasInterval) state = 'loot';
    else if (veryStale) state = 'stale';
    else if (remaining <= 0) state = 'up';
    else if (remaining <= SOON_MIN) state = 'soon';
    else state = 'cooking';
  }
  const near = remaining != null && remaining > 0 && remaining <= NEAR_MIN;

  const nextUpIso =
    hasInterval && zone.last_reset_at
      ? new Date(new Date(zone.last_reset_at).getTime() + zone.interval_minutes * 60000).toISOString()
      : null;
  const nu = nextUpIso ? dualClock(nextUpIso, viewerTz, now) : null;

  let big = 'not logged';
  if (state === 'loot') big = `${formatDuration(elapsed)} ago`;
  else if (state === 'stale') big = `not seen ${formatDuration(-remaining)}+`;
  else if (state === 'up') big = remaining > -1 ? 'up now' : `overdue ${formatDuration(-remaining)}`;
  else if (state === 'soon' || state === 'cooking') {
    if (timeMode === 'at' && nu) big = `up at ${nu.primary.time}`;
    else if (timeMode === 'both' && nu) big = `${formatDuration(remaining)} · ${nu.primary.time}`;
    else big = `up in ${formatDuration(remaining)}`;
  }

  const pct =
    hasInterval && elapsed != null ? Math.min(Math.max(elapsed / zone.interval_minutes, 0), 1) * 100 : 0;

  const timeClass = state === 'up' ? 'is-up' : near ? 'is-near' : state === 'stale' || state === 'awaiting' ? 'is-stale' : '';

  const stamp = (c) => (c ? `${c.day ? `${c.day}, ` : ''}${c.time}` : '');
  const claimedByMe = zone.claimed_by && zone.claimed_by === me;
  const claimAge = zone.claimed_at ? formatDuration(elapsedMinutesSince(zone.claimed_at, now)) : null;

  let sub = '';
  if (state === 'awaiting') sub = 'no reset logged yet';
  else if (state === 'loot') sub = `last reset ${formatDuration(elapsed)} ago`;
  else if (nu) {
    const verb = state === 'stale' || state === 'up' ? 'came up' : 'up';
    sub = `${verb} ${stamp(nu.primary)} ${nu.label}${nu.manila ? ` · ${stamp(nu.manila)} Manila` : ''}`;
  }

  const source =
    zone.last_reset_note || (zone.last_reset_by ? `logged by ${zone.last_reset_by}` : null);

  const obs = zone.observed_minutes;
  const cyclePattern =
    obs && hasInterval && Math.abs(obs - zone.interval_minutes) >= 3
      ? `clan's logs run a ~${formatDuration(obs)} cycle`
      : null;
  const effLead = zoneLead != null ? zoneLead : defaultLead;

  const rowClass = [
    'zr',
    state === 'up' ? 'is-up' : '',
    near ? 'is-near' : '',
    state === 'stale' ? 'is-stale' : '',
    zone.claimed_by ? 'is-claimed' : '',
    open ? 'is-open' : '',
    fresh ? 'is-fresh' : '',
  ]
    .filter(Boolean)
    .join(' ');

  async function run(fn) {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  }

  const toggle = () => setOpen((o) => !o);

  return (
    <>
      <div
        className={rowClass}
        ref={ref}
        style={{
          '--pct': `${pct}%`,
          ...(showType
            ? { '--dot': `var(--t-${zone.type === 'red_card' ? 'red' : zone.type})` }
            : {}),
        }}
      >
        <div
          className="zr__summary"
          role="button"
          tabIndex={0}
          aria-expanded={open}
          onClick={toggle}
          onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), toggle())}
        >
          <span className="zr__name">
            <span className="dot" aria-hidden="true" />
            {onToggleWatch && (
              <button
                className={`zr__star${watched ? ' is-on' : ''}`}
                aria-label={watched ? 'unwatch' : 'watch'}
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleWatch();
                }}
              >
                <Star size={12} fill={watched ? 'currentColor' : 'none'} />
              </button>
            )}
            <span className="t">{zone.name}</span>
            {zone.claimed_by && (
              <span className="zr__claim" title={`${zone.claimed_by} is on it`}>
                <Hand size={10} /> {claimedByMe ? 'you' : zone.claimed_by}
                {claimAge && claimAge !== 'now' ? ` · ${claimAge}` : ''}
              </span>
            )}
          </span>
          <span className="zr__right">
            <span className={`zr__time ${timeClass}`}>{big}</span>
            <button
              className="zr__expand"
              aria-label={open ? 'collapse' : 'more'}
              aria-expanded={open}
              onClick={(e) => {
                e.stopPropagation();
                setOpen((o) => !o);
              }}
            >
              <ChevronDown size={14} />
            </button>
          </span>
          {sub && <span className="zr__sub">{sub}</span>}
        </div>

        {open && (
          <div className="zr__body">
            <p className="zr__detail">
              {source && showSource ? source : sub || 'no reset logged yet'}
              {zone.claimed_by && (
                <>
                  {' '}· on it: {zone.claimed_by}
                  {claimAge && claimAge !== 'now' ? `, ${claimAge}` : ''}
                </>
              )}
              {cyclePattern && <span className="zr__pat"> · {cyclePattern}</span>}
            </p>

            {zone.note && (
              <p className="zr__note">
                <StickyNote size={12} /> {zone.note}
              </p>
            )}

            {history && history.length > 1 && hasInterval && (
              <p className="zr__hist">
                came up:{' '}
                {history.slice(0, 6).map((h, i) => {
                  const up = new Date(
                    Date.parse(h.reset_at) + zone.interval_minutes * 60000
                  ).toISOString();
                  return (
                    <span key={i}>
                      {i > 0 && ' · '}
                      {dualClock(up, viewerTz, now).primary.time}
                    </span>
                  );
                })}
              </p>
            )}

            {watched && onSetLead && hasInterval && (
              <div className="zr__lead">
                <span>alert me</span>
                {LEADS.map((v) => (
                  <button
                    key={v}
                    className={effLead === v ? 'is-on' : ''}
                    onClick={() => onSetLead(zone.id, v)}
                  >
                    {v === 0 ? 'at up' : `${v}m before`}
                  </button>
                ))}
              </div>
            )}

            {err && <p className="zr__err">{err}</p>}
            <div className="zr__actions">
              {/* once a zone is up, the main action is "I ran it → restart the clock" */}
              <button
                className={`btn btn--sm${state === 'up' ? ' btn--primary' : ''}`}
                disabled={busy}
                onClick={() => run(() => onReset(zone, {}))}
              >
                {state === 'up' ? (
                  <>
                    <Check size={14} /> mark it done
                  </>
                ) : (
                  <>
                    <RotateCcw size={14} /> it&rsquo;s up now
                  </>
                )}
              </button>
              <button
                className={`btn btn--sm${state === 'up' ? '' : ' btn--primary'}`}
                disabled={busy}
                onClick={() => setBackdating(true)}
              >
                <Clock3 size={14} /> it came up earlier&hellip;
              </button>
              {claimedByMe ? (
                <button className="btn btn--sm btn--ghost" disabled={busy} onClick={() => run(() => onUnclaim(zone))}>
                  release
                </button>
              ) : (
                <button className="btn btn--sm" disabled={busy} onClick={() => run(() => onClaim(zone))}>
                  <Hand size={14} /> {zone.claimed_by ? 'take over' : "I'm on it"}
                </button>
              )}
              {onClearZone && zone.last_reset_at && (
                <button
                  className="btn btn--sm btn--ghost"
                  disabled={busy}
                  title="blank this zone's timer — use it when a stale time is just wrong"
                  onClick={() => run(() => onClearZone(zone))}
                >
                  <X size={14} /> clear timer
                </button>
              )}
              {isAdmin && (
                <button className="btn btn--sm btn--ghost" disabled={busy} onClick={() => setEditing(true)}>
                  <Pencil size={14} /> edit
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {backdating && (
        <BackdateModal
          zone={zone}
          onClose={() => setBackdating(false)}
          onSubmit={async (payload) => {
            await onReset(zone, payload);
            setBackdating(false);
          }}
        />
      )}
      {editing && (
        <EditZoneModal
          zone={zone}
          onClose={() => setEditing(false)}
          onSubmit={async (data) => {
            await onUpdate(zone.id, data);
            setEditing(false);
          }}
          onDelete={async () => {
            await onDelete(zone.id);
            setEditing(false);
          }}
        />
      )}
    </>
  );
}
