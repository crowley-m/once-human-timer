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
const CONFIRM = !/^(0|false|no)$/i.test(process.env.CONFIRM_LOGS || ''); // reply in-channel with what got logged
const CLAN_TZ = process.env.CLAN_TZ || 'Asia/Manila';
const upFmt = new Intl.DateTimeFormat('en-US', { timeZone: CLAN_TZ, hour: 'numeric', minute: '2-digit', hour12: true });
const upWord = (r) =>
  r.zone.interval_minutes == null
    ? 'logged'
    : `up ${upFmt.format(new Date(Date.parse(r.resetAt) + r.zone.interval_minutes * 60000))}`;

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

async function discordPost(path, body) {
  const r = await fetch('https://discord.com/api/v10' + path, {
    method: 'POST',
    headers: { Authorization: `Bot ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Discord POST ${path} -> ${r.status} ${await r.text()}`);
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
const confirms = []; // freshly-logged resets to acknowledge in-channel

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
        const r = await logReset(
          res.zone.id,
          res.resetAt,
          `discord:${m.author.username}`,
          `discord — "${res.line}"`
        );
        console.log(`  ✓ ${res.zone.name}  reset ${res.resetAt}  ("${res.line}")`);
        logged++;
        if (r?.changed !== false) confirms.push(res); // new log, not a re-scan
      } catch (e) {
        console.error(`  x ${res.zone.name}: ${e.message}`);
      }
    }
  }
}

if (CONFIRM && confirms.length) {
  // one dedup per zone (keep the last sighting)
  const byZone = new Map(confirms.map((r) => [r.zone.id, r]));
  const lines = [...byZone.values()].map((r) => `• **${r.zone.name}** — ${upWord(r)}`);
  try {
    await discordPost(`/channels/${CHANNELS[0]}/messages`, {
      content: `✅ logged from chat\n${lines.join('\n')}`,
      allowed_mentions: { parse: [] },
    });
    console.log(`  → confirmed ${byZone.size} in Discord`);
  } catch (e) {
    console.error(`  x couldn't confirm: ${e.message}`);
  }
}

console.log(
  `\ndone — ${seen} message(s) scanned, ${logged} logged, ${ambiguous} unclear${asked ? ` (${asked} asked in Discord)` : ''}`
);
