import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { ALIASES, OPEN_WORDS, QUALIFIER_TYPE } from './aliases.js';

const CLAN_TZ = process.env.CLAN_TZ || 'Asia/Manila';
const OFFSET = tzOffsetString(CLAN_TZ);
const ACCEPT = Number(process.env.MATCH_THRESHOLD || 0.72); // min fuzzy score to log
const TIE_GAP = 0.08;

const __dir = dirname(fileURLToPath(import.meta.url));
let LEARNED = {};
try {
  LEARNED = JSON.parse(readFileSync(join(__dir, 'learned.json'), 'utf8'));
} catch {
  /* ignore */
}

// ---------------------------------------------------------------------------
// time helpers
// ---------------------------------------------------------------------------
function tzOffsetString(tz) {
  const d = new Date();
  const local = new Date(d.toLocaleString('en-US', { timeZone: tz }));
  const utc = new Date(d.toLocaleString('en-US', { timeZone: 'UTC' }));
  const mins = Math.round((local - utc) / 60000);
  const s = mins >= 0 ? '+' : '-';
  const a = Math.abs(mins);
  return `${s}${String(Math.floor(a / 60)).padStart(2, '0')}:${String(a % 60).padStart(2, '0')}`;
}
function clanFields(date) {
  const p = new Intl.DateTimeFormat('en-CA', {
    timeZone: CLAN_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(date).reduce((a, x) => ((a[x.type] = x.value), a), {});
  return { y: +p.year, mo: +p.month, d: +p.day, H: +p.hour % 24, M: +p.minute };
}
function clanDate(y, mo, d, H, M) {
  return new Date(
    `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}` +
    `T${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}:00${OFFSET}`
  ).getTime();
}
function resolveNear(msgDate, hh, mm, ampm) {
  const f = clanFields(msgDate);
  const anchor = clanDate(f.y, f.mo, f.d, f.H, f.M);
  const bases = ampm === 'am' ? [hh % 12] : ampm === 'pm' ? [(hh % 12) + 12] : [hh % 12, (hh % 12) + 12];
  let best = null;
  for (const H of bases)
    for (const off of [-1, 0, 1]) {
      const t = clanDate(f.y, f.mo, f.d + off, H, mm);
      const dist = Math.abs(t - anchor);
      if (!best || dist < best.dist) best = { t, dist };
    }
  return best.t;
}

// ---------------------------------------------------------------------------
// fuzzy matching
// ---------------------------------------------------------------------------
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
/** Similarity of a message word/phrase `w` to a known alias `p`. */
function sim(w, p) {
  if (w === p) return 1;
  if (w.includes(p) || p.includes(w)) return 0.93;
  const cp = commonPrefix(w, p);
  const prefix = cp >= 4 ? 0.6 + 0.05 * Math.min(cp - 4, 6) : 0; // trailing-garbage typos
  const d1 = dice(w, p);
  const d2 = w.length > p.length + 1 ? dice(w.slice(0, p.length + 1), p) : d1;
  return Math.max(prefix, d1, d2);
}

const norm = (s) => s.toLowerCase().replace(/[^a-z0-9:.\s]/g, ' ').replace(/\s+/g, ' ').trim();
const TIME_RE = /(?:^|[^\d])(\d{1,2})\s*[:.\s]\s*(\d{2})\s*(am|pm)?\b/i;
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

function matchLine(line, index, learned = LEARNED) {
  const words = line.split(' ').filter(Boolean);
  const wins = windows(words).filter((w) => !(w.split(' ').every((t) => QWORDS.has(t))));

  for (const w of wins) {
    if (learned[w]) {
      const hit = index.find((x) => x.zone.name === learned[w]);
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

// ---------------------------------------------------------------------------
export function parseMessage(content, msgDate, roster, learnedOverride = null) {
  const index = buildIndex(roster);
  const learned = learnedOverride ? { ...LEARNED, ...learnedOverride } : LEARNED;
  const results = [];

  const cand = (list) => list.slice(0, 3).map((s) => ({ id: s.zone.id, name: s.zone.name }));

  for (const rawLine of String(content).split('\n')) {
    const line = norm(rawLine);
    if (line.length < 3) continue;

    const isOpen = OPEN_WORDS.some((w) => line.includes(w));
    const tm = line.match(TIME_RE);
    if (!tm && !isOpen) continue;

    // A clock time in chat = when the zone was collected / reset (the next window
    // is a full cycle after it). "open" / "up" with no time = it's available right
    // now. `resetMs` is null when there's no usable time on the line.
    let resetMs = null;
    let badTime = false;
    if (tm) {
      const h = +tm[1];
      const mn = +tm[2];
      if (h > 23 || mn > 59) badTime = true;
      else resetMs = Math.min(resolveNear(msgDate, h, mn, tm[3] ? tm[3].toLowerCase() : null), Date.now());
    }
    if (badTime) continue;
    const resetIso = resetMs != null ? new Date(resetMs).toISOString() : null;
    // likeliest zone word (so a teach click can learn the spelling)
    const phrase =
      line
        .split(' ')
        .filter((w) => w.length >= 3 && !QWORDS.has(w) && !/^\d/.test(w))
        .sort((a, b) => b.length - a.length)[0] || '';

    const scored = matchLine(line, index, learned);
    if (!scored.length || scored[0].score < ACCEPT) {
      if (scored.length)
        results.push({
          ambiguous: true,
          line: rawLine.trim(),
          reason: 'no confident zone match',
          candidates: cand(scored),
          reset_at: resetIso,
          phrase,
        });
      continue;
    }

    // qualifier types mentioned on the line
    const qTypes = new Set(
      line.split(' ').map((t) => QUALIFIER_TYPE[t]).filter(Boolean)
    );

    // candidates in the same score band as the leader
    const band = scored.filter((s) => scored[0].score - s.score < 0.15);
    const distinctZones = new Set(band.map((s) => s.zone.id));

    let chosen;
    if (distinctZones.size === 1) {
      chosen = [band[0]];
    } else if (qTypes.size) {
      // pick the candidate(s) whose type a qualifier points at
      const byQ = band.filter((s) => qTypes.has(s.zone.type));
      if (byQ.length === 1) chosen = [byQ[0]];
      else if (byQ.length > 1 && qTypes.size > 1) chosen = byQ; // "forsaken elite red" -> both
      else if (byQ.length >= 1) chosen = [byQ[0]];
      else chosen = null;
    } else if (scored[0].score - scored[1].score >= TIE_GAP || scored[0].hits > scored[1].hits) {
      chosen = [scored[0]];
    } else {
      chosen = null;
    }

    if (!chosen) {
      results.push({
        ambiguous: true,
        line: rawLine.trim(),
        reason: `could be ${band.slice(0, 3).map((s) => s.zone.name).join(' or ')}`,
        candidates: cand(band),
        reset_at: resetIso,
        phrase,
      });
      continue;
    }

    for (const c of chosen) {
      const intervalMs = (c.zone.interval_minutes ?? 60) * 60000;
      // clock time -> that's the reset; no time ("open") -> reset was a cycle ago
      const resetAt = resetMs != null ? resetMs : Date.now() - intervalMs;
      results.push({
        zone: c.zone,
        resetAt: new Date(Math.min(resetAt, Date.now())).toISOString(),
        line: rawLine.trim(),
        score: Math.round(c.score * 100) / 100,
      });
    }
  }
  return results;
}
