// One-shot poller. Fetches recent messages from the watched channel(s) via the
// Discord REST API, parses them, and updates the timer board — then exits.
// Run it on a schedule (cron / GitHub Actions / a Claude Code routine); no
// always-on process. Re-processing the same message is harmless — it just
// recomputes the same reset time.
import 'dotenv/config';
import { parseMessage } from './parse.js';
import { loadRoster, logReset, getLearned, reportUnclear } from './api.js';

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNELS = (process.env.WATCH_CHANNEL_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
const WINDOW_MIN = Number(process.env.POLL_WINDOW_MINUTES || 12);
const DRY = /^(1|true)$/i.test(process.env.DRY_RUN || '');

if (!TOKEN || !CHANNELS.length) {
  console.error('Set DISCORD_TOKEN and WATCH_CHANNEL_ID (see .env.example).');
  process.exit(1);
}

const since = Date.now() - WINDOW_MIN * 60_000;

async function discord(path) {
  const r = await fetch('https://discord.com/api/v10' + path, {
    headers: { Authorization: `Bot ${TOKEN}` },
  });
  if (!r.ok) throw new Error(`Discord ${path} -> ${r.status} ${await r.text()}`);
  return r.json();
}

const roster = await loadRoster();
const learned = await getLearned();
console.log(
  `roster: ${roster.length} zones · ${Object.keys(learned).length} learned · window: last ${WINDOW_MIN} min${DRY ? ' · DRY RUN' : ''}`
);

let seen = 0;
let logged = 0;
let ambiguous = 0;
let asked = 0;
const askedLines = new Set(); // don't re-post the same "which zone?" prompt twice in a run

for (const ch of CHANNELS) {
  const messages = await discord(`/channels/${ch}/messages?limit=100`);
  // oldest first so multiple sightings of one zone apply in order
  for (const m of messages.reverse()) {
    const ts = Date.parse(m.timestamp);
    if (ts < since || m.author?.bot) continue;
    seen++;
    for (const res of parseMessage(m.content, new Date(ts), roster, learned)) {
      if (res.ambiguous) {
        ambiguous++;
        console.log(`  ? unclear: "${res.line}" (${res.reason})`);
        if (!DRY && res.candidates?.length && !askedLines.has(res.line)) {
          askedLines.add(res.line);
          try {
            await reportUnclear(res);
            asked++;
            console.log(`    → asked in Discord (${res.candidates.map((c) => c.name).join(' / ')})`);
          } catch (e) {
            console.error(`    x couldn't ask: ${e.message}`);
          }
        }
        continue;
      }
      if (DRY) {
        console.log(`  [dry] ${res.zone.name}  <- "${res.line}"  => reset ${res.resetAt}`);
        logged++;
        continue;
      }
      try {
        await logReset(
          res.zone.id,
          res.resetAt,
          `discord:${m.author.username}`,
          `discord — "${res.line}"`
        );
        console.log(`  ✓ ${res.zone.name}  reset ${res.resetAt}  ("${res.line}")`);
        logged++;
      } catch (e) {
        console.error(`  x ${res.zone.name}: ${e.message}`);
      }
    }
  }
}

console.log(
  `\ndone — ${seen} message(s) scanned, ${logged} logged, ${ambiguous} unclear${asked ? ` (${asked} asked in Discord)` : ''}`
);
