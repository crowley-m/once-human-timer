import { Minimize2 } from 'lucide-react';
import { elapsedMinutesSince, formatDuration, nowIn, MANILA_TZ, LOCAL_TZ, sameAsManila, tzShort } from '../time.js';

const TYPE_LABEL = { red_card: 'RED', elite: 'ELITE', blue: 'BLUE' };
const ORDER = ['red_card', 'elite', 'blue'];

function line(zone, now) {
  const e = elapsedMinutesSince(zone.last_reset_at, now);
  if (e == null || zone.interval_minutes == null) return { state: 'na', text: 'not logged' };
  const rem = zone.interval_minutes - e;
  if (rem > 0) return { state: rem <= 5 ? 'soon' : 'cooking', text: `up in ${formatDuration(rem)}` };
  if (-rem <= zone.interval_minutes * 2) return { state: 'up', text: `overdue ${formatDuration(-rem)}` };
  return { state: 'stale', text: `not seen ${formatDuration(-rem)}+` };
}

export default function Wallboard({ zones, now, viewerTz, onExit }) {
  const tz = viewerTz || LOCAL_TZ;
  const dual = !sameAsManila(tz, now);
  const rows = ORDER.flatMap((type) =>
    zones
      .filter((z) => z.type === type)
      .map((z) => ({ z, ...line(z, now) }))
      .sort((a, b) => {
        const rank = { up: 0, soon: 1, cooking: 2, stale: 3, na: 4 };
        if (rank[a.state] !== rank[b.state]) return rank[a.state] - rank[b.state];
        const ea = elapsedMinutesSince(a.z.last_reset_at, now) ?? -1;
        const eb = elapsedMinutesSince(b.z.last_reset_at, now) ?? -1;
        return b.z.interval_minutes - eb - (a.z.interval_minutes - ea);
      })
  );

  return (
    <div className="wall">
      <div className="wall__top">
        <span className="wall__clock">
          {nowIn(now, tz)} {dual ? tzShort(tz) : 'Manila'}
          {dual && `  ·  ${nowIn(now, MANILA_TZ)} MNL`}
        </span>
        <button className="iconbtn" aria-label="exit wallboard" onClick={onExit}>
          <Minimize2 size={18} />
        </button>
      </div>
      <div className="wall__grid">
        {rows.map(({ z, state, text }) => (
          <div className={`wall__cell wall__cell--${state} wall__cell--${z.type}`} key={z.id}>
            <div className="wall__name">
              <span className={`dot dot--${z.type}`} />
              {z.name}
              <span className="wall__type">{TYPE_LABEL[z.type]}</span>
            </div>
            <div className="wall__count">{text}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
