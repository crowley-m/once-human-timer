// Browser port of bot/src/parse.js — used by the "paste log" box.
// Also understands Discord's copy format: an author/timestamp header line
// ("Name — Yesterday at 10:20") sets the anchor for the lines under it.
import { ALIASES, OPEN_WORDS, QUALIFIER_TYPE, LEARNED } from './zoneAliases.js';

const CLAN_TZ = 'Asia/Manila';
const VIEWER_TZ =
  (typeof Intl !== 'undefined' && Intl.DateTimeFormat().resolvedOptions().timeZone) || 'UTC';
const ACCEPT = 0.72;
const TIE_GAP = 0.08;

function tzOffset(tz, atMs = Date.now()) {
  const d = new Date(atMs);
  const local = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  const mins = Math.round((local - utc) / 60000);
  const s = mins >= 0 ? '+' : '-';
  const a = Math.abs(mins);
  return `${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
function instant(y, mo, d, H, M, tz) {
  return new Date(
    `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` +
    `T${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}:00${tzOffset(tz)}`
  ).getTime();
}
function fieldsIn(tz, atMs) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date(atMs)).reduce((a, x) => ((a[x.type] = x.value), a), {});
  return { y: +p.year, mo: +p.month, d: +p.day, H: +p.hour % 24, M: +p.minute };
}
function resolveNear(anchorMs, hh, mm, ampm) {
  const f = fieldsIn(CLAN_TZ, anchorMs);
  const anchor = instant(f.y, f.mo, f.d, f.H, f.M, CLAN_TZ);
  const bases = ampm === 'am' ? [hh % 12] : ampm === 'pm' ? [(hh % 12) + 12] : [hh % 12, (hh % 12) + 12];
  let best = null;
  for (const H of bases)
    for (const off of [-1, 0, 1]) {
      const t = instant(f.y, f.mo, f.d + off, H, mm, CLAN_TZ);
      const dist = Math.abs(t - anchor);
      if (!best || dist < best.dist) best = { t, dist };
    }
  return best.t;
}

function bigrams(s) {
  const m = new Map();
  for (let i = 0; i < s.length - 1; i++) {
    const g = s.slice(i, i + 2);
    m.set(g, (m.get(g) || 0) + 1);
  }
  return m;
}
function dice(a, b) {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const A = bigrams(a);
  const B = bigrams(b);
  let inter = 0;
  let total = 0;
  for (const [g, n] of A) {
    total += n;
    if (B.has(g)) inter += Math.min(n, B.get(g));
  }
  for (const n of B.values()) total += n;
  return (2 * inter) / total;
}
function commonPrefix(a, b) {
  let i = 0;
  while (i < a.length && i < b.length && a[i] === b[i]) i++;
  return i;
}
function sim(w, p) {
  if (w === p) return 1;
  if (w.includes(p) || p.includes(w)) return 0.93;
  const cp = commonPrefix(w, p);
  const prefix = cp >= 4 ? 0.6 + 0.05 * Math.min(cp - 4, 6) : 0;
  const d1 = dice(w, p);
  const d2 = w.length > p.length + 1 ? dice(w.slice(0, p.length + 1), p) : d1;
  return Math.max(prefix, d1, d2);
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9:.\s]/g, ' ').replace(/\s+/g, ' ').trim();
const TIME_RE = /(?:^|[^\d])(\d{1,2})\s*[:.\s]\s*(\d{2})\s*(am|pm)?\b/i;
// Discord copy headers look like "Name [tag],  — Yesterday at 10:20" — an em/en
// dash (not a plain hyphen, which is usually "ZONE - TIME").
const HEADER_RE = /(?:^|\s)[—–]\s+(?:(yesterday|today)\s+)?(?:at\s+)?(\d{1,2}):(\d{2})\s*$/i;
const QWORDS = new Set(Object.keys(QUALIFIER_TYPE).concat(['room', 'the']));

function buildIndex(roster) {
  return roster.map((zone) => ({
    zone,
    phrases: [...new Set((ALIASES[zone.name] || [norm(zone.name).split(' ')[0]]).map(norm))],
  }));
}
function windows(words, max = 2) {
  const out = [];
  for (let n = 1; n <= max; n++)
    for (let i = 0; i + n <= words.length; i++) out.push(words.slice(i, i + n).join(' '));
  return out;
}
function matchLine(line, index) {
  const words = line.split(' ').filter(Boolean);
  const wins = windows(words).filter((w) => !w.split(' ').every((t) => QWORDS.has(t)));
  for (const w of wins) {
    if (LEARNED[w]) {
      const hit = index.find((x) => x.zone.name === LEARNED[w]);
      if (hit) return [{ zone: hit.zone, score: 1, hits: 1 }];
    }
  }
  const scored = [];
  for (const { zone, phrases } of index) {
    let best = 0;
    let hits = 0;
    for (const p of phrases) {
      let pBest = 0;
      for (const w of wins) {
        if (Math.abs(w.length - p.length) > Math.max(5, p.length)) continue;
        pBest = Math.max(pBest, sim(w, p));
      }
      if (pBest > best) best = pBest;
      if (pBest >= 0.82) hits++;
    }
    if (best >= 0.5) scored.push({ zone, score: best, hits });
  }
  scored.sort((a, b) => b.score - a.score || b.hits - a.hits);
  return scored;
}

function headerAnchor(match, nowMs) {
  const rel = (match[1] || '').toLowerCase();
  const hh = +match[2];
  const mm = +match[3];
  const f = fieldsIn(VIEWER_TZ, nowMs);
  let d = f.d;
  if (rel === 'yesterday') d -= 1;
  let t = instant(f.y, f.mo, d, hh, mm, VIEWER_TZ);
  if (!rel && t > nowMs + 60_000) t -= 86_400_000; // "— 23:40" with no word, must be earlier
  return t;
}

/**
 * @returns array of { zone, resetAt(ISO), line, score } | { ambiguous, line, reason }
 */
export function parseLog(text, roster, fallbackAnchorMs = Date.now()) {
  const index = buildIndex(roster);
  const out = [];
  let anchor = fallbackAnchorMs;

  for (const rawLine of String(text).split('\n')) {
    const trimmed = rawLine.trim();
    if (!trimmed) continue;

    const line = norm(trimmed);
    if (line.length < 3) continue;

    const hdr = trimmed.match(HEADER_RE);
    if (hdr) {
      const before = norm(trimmed.replace(HEADER_RE, ''));
      // real header: nothing timer-ish and no zone name before the dash
      const looksLikeSighting =
        TIME_RE.test(before) || matchLine(before, index).some((s) => s.score >= ACCEPT);
      if (!looksLikeSighting) {
        anchor = headerAnchor(hdr, fallbackAnchorMs);
        continue;
      }
    }

    const isOpen = OPEN_WORDS.some((w) => line.includes(w));
    const tm = line.match(TIME_RE);
    if (!tm && !isOpen) continue;

    const scored = matchLine(line, index);
    if (!scored.length || scored[0].score < ACCEPT) {
      if (scored.length) out.push({ ambiguous: true, line: trimmed, reason: 'no confident zone match' });
      continue;
    }

    const qTypes = new Set(line.split(' ').map((t) => QUALIFIER_TYPE[t]).filter(Boolean));
    const band = scored.filter((s) => scored[0].score - s.score < 0.15);
    const distinct = new Set(band.map((s) => s.zone.id));

    let chosen;
    if (distinct.size === 1) chosen = [band[0]];
    else if (qTypes.size) {
      const byQ = band.filter((s) => qTypes.has(s.zone.type));
      if (byQ.length === 1) chosen = [byQ[0]];
      else if (byQ.length > 1 && qTypes.size > 1) chosen = byQ;
      else if (byQ.length >= 1) chosen = [byQ[0]];
      else chosen = null;
    } else if (scored[0].score - scored[1].score >= TIE_GAP || scored[0].hits > scored[1].hits) {
      chosen = [scored[0]];
    } else chosen = null;

    if (!chosen) {
      out.push({
        ambiguous: true,
        line: trimmed,
        reason: `could be ${band.slice(0, 3).map((s) => s.zone.name).join(' or ')}`,
      });
      continue;
    }

    for (const c of chosen) {
      const intervalMs = (c.zone.interval_minutes ?? 60) * 60000;
      let resetAt;
      if (tm) {
        const hh = +tm[1];
        const mm = +tm[2];
        if (hh > 23 || mm > 59) continue;
        resetAt = resolveNear(anchor, hh, mm, tm[3] ? tm[3].toLowerCase() : null) - intervalMs;
      } else {
        resetAt = Date.now() - intervalMs;
      }
      out.push({
        zone: c.zone,
        resetAt: new Date(Math.min(resetAt, Date.now())).toISOString(),
        line: trimmed,
        score: Math.round(c.score * 100) / 100,
      });
    }
  }
  return out;
}
