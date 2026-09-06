export const MANILA_TZ = 'Asia/Manila';
export const LOCAL_TZ =
  (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';

/** Short IANA label, e.g. "Asia/Tokyo" -> "Tokyo". */
export function tzShort(tz) {
  return String(tz).split('/').pop().replace(/_/g, ' ');
}

/** Live-recompute elapsed minutes client-side so the log ticks without hammering the server. */
export function elapsedMinutesSince(iso, nowMs) {
  if (!iso) return null;
  return Math.max(0, Math.floor((nowMs - new Date(iso).getTime()) / 60000));
}

/** Compact duration for the hero cell: "now", "41m", "2h 03m", "3d 4h". */
export function formatDuration(minutes) {
  if (minutes == null) return '--';
  if (minutes < 1) return 'now';
  const d = Math.floor(minutes / 1440);
  const h = Math.floor((minutes % 1440) / 60);
  const m = minutes % 60;
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${String(m).padStart(2, '0')}m`;
  return `${m}m`;
}

/** "60" -> "1h", "120" -> "2h", "90" -> "90m". */
export function formatInterval(minutes) {
  if (minutes == null) return '';
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

// 12-hour clock, e.g. "2:20 PM"
const hm = (tz, opts = {}) =>
  new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true, ...opts });
const md = (tz) => new Intl.DateTimeFormat('en-US', { timeZone: tz, month: 'short', day: 'numeric' });

/** Wall-clock for an instant in a given tz: { time:"1:06 AM", day:"5 Jan" } (day only when it differs from now's day in that tz). */
export function clockIn(iso, tz, nowMs) {
  if (!iso) return { time: '--', day: null };
  const d = new Date(iso);
  const sameDay = md(tz).format(d) === md(tz).format(new Date(nowMs));
  return { time: hm(tz).format(d), day: sameDay ? null : md(tz).format(d) };
}

/** Current wall time in a tz, "2:20 PM". */
export function nowIn(nowMs, tz) {
  return hm(tz).format(new Date(nowMs));
}

/** Current time split for a styled clock: { hm:"2:20", ap:"pm" }. */
export function nowClockParts(nowMs, tz) {
  const [time, ap] = hm(tz).format(new Date(nowMs)).split(' ');
  return { hm: time, ap: (ap || '').toLowerCase() };
}

/** True when the given tz shows the same wall-clock as Manila right now. */
export function sameAsManila(tz, nowMs = Date.now()) {
  if (!tz || tz === MANILA_TZ) return true;
  const d = new Date(nowMs);
  return hm(tz).format(d) === hm(MANILA_TZ).format(d);
}

/**
 * Wall-clock for an instant shown for the viewer's tz, with Manila as a
 * secondary reading when they differ:
 *   { primary:{time,day}, manila:{time,day}|null, label:"Colombo" }
 */
export function dualClock(iso, viewerTz, nowMs) {
  const primary = clockIn(iso, viewerTz || MANILA_TZ, nowMs);
  const dual = !sameAsManila(viewerTz, nowMs);
  return {
    primary,
    manila: dual ? clockIn(iso, MANILA_TZ, nowMs) : null,
    label: dual ? tzShort(viewerTz) : 'Manila',
  };
}

/** Manila offset relative to `tz`, in hours (may be .5): "+1", "-3.5", "0". */
export function manilaOffsetLabel(nowMs, tz) {
  const d = new Date(nowMs);
  const asLocal = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const asManila = new Date(d.toLocaleString('en-US', { timeZone: MANILA_TZ }));
  const diff = Math.round(((asManila - asLocal) / 3_600_000) * 2) / 2;
  if (diff === 0) return 'same';
  return `${diff > 0 ? '+' : ''}${diff}h`;
}

/** "12s ago" / "4m ago" / "3h ago" / "2d ago". */
export function formatAgo(ms) {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/** <input type="datetime-local"> wants local wall-clock with no timezone suffix. */
export function toLocalInputValue(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
