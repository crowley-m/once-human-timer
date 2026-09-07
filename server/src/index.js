import express from 'express';
import cors from 'cors';
import cookieParser from 'cookie-parser';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

// load ../.env if present (Node >= 20.12 has process.loadEnvFile)
try {
  process.loadEnvFile(new URL('../.env', import.meta.url));
} catch {
  /* no .env / older node — rely on real env vars */
}

const { db } = await import('./db.js');
const auth = await import('./auth.js');
const webpush = (await import('web-push')).default;

const __dirname = dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 3001;

// ---------------------------------------------------------------------------
// Web-push (PWA notifications). VAPID keypair is generated once and stored.
// ---------------------------------------------------------------------------
const metaGet = db.prepare('SELECT v FROM meta WHERE k = ?');
const metaSet = db.prepare('INSERT INTO meta (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v');
let vapid = {
  publicKey: process.env.VAPID_PUBLIC || metaGet.get('vapid_pub')?.v,
  privateKey: process.env.VAPID_PRIVATE || metaGet.get('vapid_priv')?.v,
};
if (!vapid.publicKey || !vapid.privateKey) {
  vapid = webpush.generateVAPIDKeys();
  metaSet.run('vapid_pub', vapid.publicKey);
  metaSet.run('vapid_priv', vapid.privateKey);
}
webpush.setVapidDetails(process.env.VAPID_SUBJECT || 'mailto:admin@rift.local', vapid.publicKey, vapid.privateKey);

const app = express();
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ verify: (req, _res, buf) => { req.rawBody = buf; } }));
app.use(cookieParser());
app.use(auth.attachUser);

// The Discord bot / poll authenticate with a shared secret instead of a session.
const API_KEY = process.env.API_KEY || null;
app.use((req, _res, next) => {
  req.apiKeyOk = !!API_KEY && req.get('x-api-key') === API_KEY;
  next();
});
const requireAuth = auth.requireAuth;
const requireAdmin = auth.requireAdmin;
const actorName = (req, fallback) =>
  req.user ? req.user.username : req.apiKeyOk && fallback ? String(fallback).slice(0, 60) : null;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const nowIso = () => new Date().toISOString();
const CLAIM_MINUTES = 25; // a "on it" claim expires after this

/** Attach computed fields the frontend needs. Blue zones (no interval) never go stale. */
function decorate(zone) {
  let elapsed_minutes = null;
  let is_stale = false;

  if (zone.last_reset_at) {
    const ms = Date.now() - new Date(zone.last_reset_at).getTime();
    elapsed_minutes = Math.max(0, Math.round(ms / 60000));
    if (zone.interval_minutes != null) {
      is_stale = elapsed_minutes > zone.interval_minutes;
    }
  }

  // drop expired claims
  let claimed_by = zone.claimed_by;
  let claimed_at = zone.claimed_at;
  if (claimed_at && Date.now() - new Date(claimed_at).getTime() > CLAIM_MINUTES * 60000) {
    claimed_by = null;
    claimed_at = null;
  }

  return { ...zone, claimed_by, claimed_at, elapsed_minutes, is_stale, observed_minutes: observedInterval(zone.id) };
}

/** Median gap between the last few logged resets, when it looks like a real cycle. */
const recentResetTimes = db.prepare(
  'SELECT reset_at FROM resets WHERE zone_id = ? ORDER BY reset_at DESC LIMIT 8'
);
function observedInterval(zoneId) {
  const rows = recentResetTimes.all(zoneId).map((r) => new Date(r.reset_at).getTime());
  if (rows.length < 3) return null;
  const gaps = [];
  for (let i = 0; i < rows.length - 1; i++) {
    const g = Math.round((rows[i] - rows[i + 1]) / 60000);
    if (g > 5 && g < 24 * 60) gaps.push(g);
  }
  if (gaps.length < 2) return null;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)];
}

// ---------------------------------------------------------------------------
// Discord — webhook posts + bot-token posts with "Got it" buttons + interactions
// ---------------------------------------------------------------------------
const WEBHOOK = process.env.DISCORD_WEBHOOK_URL || null;
const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN || null;
const CHANNEL_ID = process.env.DISCORD_CHANNEL_ID || null;
const PUBLIC_KEY = process.env.DISCORD_PUBLIC_KEY || null;
const APP_ID = process.env.DISCORD_APP_ID || null; // needed to register the /up slash command
const GUILD_ID = process.env.DISCORD_GUILD_ID || null; // register /up to one server (instant) vs global (~1h)
const CLAN_TZ = process.env.DISCORD_CLAN_TZ || process.env.CLAN_TZ || 'Asia/Manila';

// Runtime-tunable settings — env vars are the defaults, the admin ops panel
// overrides them (stored as one JSON blob in `meta.runtime_config`).
const CFG_DEFAULTS = {
  announceTypes: (process.env.DISCORD_ANNOUNCE_TYPES || 'red_card,elite')
    .split(',').map((s) => s.trim()).filter(Boolean),
  leadMinutes: Number.isFinite(+process.env.DISCORD_LEAD_MINUTES) ? +process.env.DISCORD_LEAD_MINUTES : 5,
  expireFactor: Number.isFinite(+process.env.STALE_EXPIRE_FACTOR) ? +process.env.STALE_EXPIRE_FACTOR : 4,
  mirrorActions: /^(1|true)$/i.test(process.env.DISCORD_MIRROR_ACTIONS || ''),
  remindersEnabled: true, // the "up now" / heads-up Discord posts
  pollEnabled: true, // the chat-reading poll (bot checks this and exits if false)
  confirmLogs: true, // the poll's "✅ logged from chat" reply
};
function getConfig() {
  let saved = {};
  try {
    saved = JSON.parse(metaGet.get('runtime_config')?.v || '{}');
  } catch {
    /* ignore */
  }
  return { ...CFG_DEFAULTS, ...saved };
}
function setConfig(patch) {
  const next = { ...getConfig(), ...patch };
  metaSet.run('runtime_config', JSON.stringify(next));
  return next;
}

function toDiscord(text, { ping = false, kind = 'reminder' } = {}) {
  if (!WEBHOOK) return;
  if (kind === 'action' && !getConfig().mirrorActions) return; // reset/claim mirrors are opt-in
  fetch(WEBHOOK, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: text,
      allowed_mentions: ping ? { parse: ['everyone'] } : { parse: [] },
    }),
  }).catch(() => {});
}

async function discordApi(method, path, body) {
  if (!BOT_TOKEN) return null;
  try {
    const r = await fetch('https://discord.com/api/v10' + path, {
      method,
      headers: { Authorization: `Bot ${BOT_TOKEN}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!r.ok) {
      console.error('discord', method, path, '->', r.status, (await r.text().catch(() => '')).slice(0, 200));
      return null;
    }
    return r.json().catch(() => ({}));
  } catch (e) {
    console.error('discord request failed:', e.message);
    return null;
  }
}

/** Send a channel message via bot token if configured, else the webhook. */
function sendChannel(content, { ping = false, components } = {}) {
  if (BOT_TOKEN && CHANNEL_ID) {
    discordApi('POST', `/channels/${CHANNEL_ID}/messages`, {
      content,
      allowed_mentions: ping ? { parse: ['everyone'] } : { parse: [] },
      ...(components ? { components } : {}),
    });
  } else {
    toDiscord(content, { ping });
  }
}

/** "heads up" a few minutes before a zone is due. No buttons (you can't collect it yet). */
function announceSoon(zoneList) {
  const names = zoneList.map((z) => `**${z.name}**`).join(', ');
  sendChannel(`⏳ up in ~${getConfig().leadMinutes} min — ${names}`, { ping: false });
}

/** The "up now" reminder. With a bot token: a row per zone — "Got it" logs the
 *  collect, "Skip" just blanks that zone's timer (nobody's going for it). */
function announceUp(zoneList) {
  const names = zoneList.map((z) => `**${z.name}**`).join(', ');
  const content = `@here 🔔 up now — ${names}`;

  let components;
  if (BOT_TOKEN && CHANNEL_ID) {
    components = zoneList.slice(0, 5).map((z) => {
      const tag = `${z.id}:${Date.parse(z.last_reset_at)}`;
      return {
        type: 1,
        components: [
          { type: 2, style: 3, label: `Got ${z.name}`.slice(0, 80), custom_id: `collect:${tag}` },
          { type: 2, style: 2, label: 'Skip', custom_id: `skip:${tag}` },
        ],
      };
    });
  }
  sendChannel(content, { ping: true, components });
}

// --- clan-timezone wall-clock helpers (for the /up slash command) -----------
function clanOffset(date = new Date()) {
  const local = new Date(date.toLocaleString('en-US', { timeZone: CLAN_TZ }));
  const utc = new Date(date.toLocaleString('en-US', { timeZone: 'UTC' }));
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
  return { y: +p.year, mo: +p.month, d: +p.day };
}
function clanDate(y, mo, d, H, M, off) {
  return new Date(
    `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T` +
    `${String(H).padStart(2, '0')}:${String(M).padStart(2, '0')}:00${off}`
  ).getTime();
}
/** "3:50pm" | "15:50" | "now" | "" -> ms of the nearest such wall-clock moment in CLAN_TZ. */
function parseClanTime(str) {
  const s = (str || '').trim().toLowerCase();
  if (!s || s === 'now') return Date.now();
  const m = s.match(/^(\d{1,2})[:.\s]?(\d{2})?\s*(am|pm)?$/);
  if (!m) return null;
  const hh = +m[1];
  const mm = m[2] ? +m[2] : 0;
  const ap = m[3];
  if (hh > 23 || mm > 59) return null;
  const now = new Date();
  const off = clanOffset(now);
  const f = clanFields(now);
  const cands = new Set(
    ap === 'am' ? [hh % 12] : ap === 'pm' ? [(hh % 12) + 12] : [hh]
  );
  if (!ap && hh >= 1 && hh <= 12) { cands.add(hh % 12); cands.add((hh % 12) + 12); }
  let best = null;
  for (const H of cands) {
    if (H > 23) continue;
    for (const dOff of [-1, 0, 1]) {
      const t = clanDate(f.y, f.mo, f.d + dOff, H, mm, off);
      const dist = Math.abs(t - now.getTime());
      if (best == null || dist < best.dist) best = { t, dist };
    }
  }
  return best ? best.t : null;
}

// --- taught aliases (teach-on-unclear) --------------------------------------
function getLearned() {
  try {
    return JSON.parse(metaGet.get('learned_aliases')?.v || '{}');
  } catch {
    return {};
  }
}
function learnAlias(phrase, zoneName) {
  const key = String(phrase || '').toLowerCase().trim();
  if (key.length < 3) return;
  const l = getLearned();
  l[key] = zoneName;
  metaSet.run('learned_aliases', JSON.stringify(l));
}

/** Register the /up slash command (idempotent — safe to call every boot).
 *  With DISCORD_GUILD_ID set it registers to that server (instant); otherwise
 *  it registers globally (can take up to an hour to show up in Discord). */
async function registerCommands() {
  if (!BOT_TOKEN || !APP_ID) return;
  const choices = getAll.all().slice(0, 25).map((z) => ({
    name: z.name.slice(0, 100),
    value: String(z.id),
  }));
  const cmd = {
    name: 'up',
    description: 'Log a rift reset — when a zone was cleared',
    options: [
      { type: 3, name: 'zone', description: 'Which zone', required: true, choices },
      {
        type: 3,
        name: 'time',
        description: 'When it was cleared: 3:50pm, 15:50, or "now" (default: now)',
        required: false,
      },
    ],
  };
  const path = GUILD_ID
    ? `/applications/${APP_ID}/guilds/${GUILD_ID}/commands`
    : `/applications/${APP_ID}/commands`;
  const ok = await discordApi('PUT', path, [cmd]);
  if (ok) console.log(`discord: /up command registered (${GUILD_ID ? `guild ${GUILD_ID}` : 'global — may take ~1h'})`);
}

function verifyDiscordSig(req) {
  if (!PUBLIC_KEY) return false;
  const sig = req.get('X-Signature-Ed25519');
  const ts = req.get('X-Signature-Timestamp');
  if (!sig || !ts || !req.rawBody) return false;
  try {
    const spki = Buffer.concat([
      Buffer.from('302a300506032b6570032100', 'hex'),
      Buffer.from(PUBLIC_KEY, 'hex'),
    ]);
    const key = crypto.createPublicKey({ key: spki, format: 'der', type: 'spki' });
    return crypto.verify(null, Buffer.concat([Buffer.from(ts), req.rawBody]), key, Buffer.from(sig, 'hex'));
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Live updates (Server-Sent Events)
// ---------------------------------------------------------------------------
const sseClients = new Set();
function broadcast(event, data) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of sseClients) {
    try {
      res.write(frame);
    } catch {
      sseClients.delete(res);
    }
  }
}

app.get('/api/stream', (req, res) => {
  res.set({
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no', // tell nginx not to buffer this response
  });
  res.flushHeaders?.();
  res.write('retry: 3000\n\n');
  sseClients.add(res);

  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n');
    } catch {
      /* closed */
    }
  }, 25_000);

  req.on('close', () => {
    clearInterval(heartbeat);
    sseClients.delete(res);
  });
});

const getAll = db.prepare('SELECT * FROM zones ORDER BY type, name');
const getOne = db.prepare('SELECT * FROM zones WHERE id = ?');

const VALID_TYPES = new Set(['red_card', 'elite', 'blue']);

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------
app.get('/api/health', (_req, res) => res.json({ ok: true, time: nowIso() }));

const boardPublic = () => {
  const b = auth.getBoard();
  return { name: b.name, registration: b.registration };
};

app.get('/api/auth/me', (req, res) =>
  res.json({ user: auth.meShape(req.user), board: boardPublic() })
);
app.get('/api/board', (_req, res) => res.json(boardPublic()));

app.post('/api/auth/register', (req, res) => {
  try {
    const user = auth.createUser(req.body?.username, req.body?.password, req.body?.invite);
    const s = auth.startSession(user.id);
    auth.setSessionCookie(res, s.id, s.expires);
    res.status(201).json({ user: auth.meShape(user), board: boardPublic() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/auth/login', (req, res) => {
  try {
    const user = auth.login(req.body?.username, req.body?.password);
    const s = auth.startSession(user.id);
    auth.setSessionCookie(res, s.id, s.expires);
    res.json({ user: auth.meShape(user), board: boardPublic() });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.post('/api/auth/logout', (req, res) => {
  auth.endSession(req.cookies?.[auth.COOKIE]);
  auth.clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Profile + personal settings
// ---------------------------------------------------------------------------
app.patch('/api/me', requireAuth, (req, res) => {
  const u = req.user;
  const b = req.body ?? {};
  const patch = {};
  if (b.display_name !== undefined) {
    const dn = String(b.display_name).trim().slice(0, 40);
    if (dn.length < 2) return res.status(400).json({ error: 'display name too short' });
    patch.display_name = dn;
  }
  if (b.role_tag !== undefined) patch.role_tag = String(b.role_tag).trim().slice(0, 30) || null;
  if (b.tz !== undefined) {
    const tz = String(b.tz || '').trim() || null;
    if (tz) {
      try {
        new Intl.DateTimeFormat('en', { timeZone: tz });
      } catch {
        return res.status(400).json({ error: 'unknown timezone' });
      }
    }
    patch.tz = tz;
  }
  if (b.prefs !== undefined && b.prefs && typeof b.prefs === 'object') {
    patch.prefs = JSON.stringify(b.prefs).slice(0, 4000);
  }
  const keys = Object.keys(patch);
  if (keys.length) {
    db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(
      ...keys.map((k) => patch[k]),
      u.id
    );
  }
  res.json({ user: auth.meShape(auth.userById(u.id)) });
});

app.post('/api/me/password', requireAuth, (req, res) => {
  try {
    auth.changePassword(req.user.id, req.body?.current, req.body?.next);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.delete('/api/me', requireAuth, (req, res) => {
  try {
    auth.deleteAccount(req.user.id, req.body?.password);
    auth.clearSessionCookie(res);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ error: e.message });
  }
});

app.get('/api/users/:id', (req, res) => {
  const u = auth.userById(req.params.id);
  if (!u) return res.status(404).json({ error: 'user not found' });
  const stats = db
    .prepare('SELECT COUNT(*) AS resets FROM resets WHERE user_id = ?')
    .get(u.id);
  const claims = db.prepare('SELECT COUNT(*) AS n FROM zones WHERE claimed_by = ?').get(u.display_name || u.username);
  const recent = db
    .prepare(
      `SELECT r.reset_at, r.created_at, r.source, z.name AS zone
       FROM resets r JOIN zones z ON z.id = r.zone_id
       WHERE r.user_id = ? ORDER BY r.created_at DESC LIMIT 10`
    )
    .all(u.id);
  res.json({
    id: u.id,
    display_name: u.display_name || u.username,
    username: u.username,
    role: u.role,
    role_tag: u.role_tag || null,
    created_at: u.created_at,
    stats: { resets: stats.resets, claims_active: claims.n },
    recent,
  });
});

app.get('/api/activity', (_req, res) => {
  const rows = db
    .prepare(
      `SELECT r.reset_at, r.created_at, r.source, r.by_name, r.user_id, z.name AS zone
       FROM resets r JOIN zones z ON z.id = r.zone_id
       ORDER BY r.created_at DESC LIMIT 40`
    )
    .all();
  res.json(rows);
});

// Who's been logging resets — leaderboard over the last N days (default 7).
app.get('/api/stats/contributors', (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const rows = db
    .prepare(
      `SELECT COALESCE(NULLIF(TRIM(r.by_name), ''), 'someone') AS name,
              r.user_id,
              COUNT(*) AS count,
              SUM(CASE WHEN r.source = 'discord' THEN 1 ELSE 0 END) AS via_discord,
              MAX(r.created_at) AS last_at
       FROM resets r
       WHERE r.created_at >= ?
       GROUP BY name
       ORDER BY count DESC, last_at DESC
       LIMIT 20`
    )
    .all(since);
  res.json({ days, total: rows.reduce((n, r) => n + r.count, 0), contributors: rows });
});

// ---------------------------------------------------------------------------
// Ops panel (admin only) — tune the bot, send messages, flip switches
// ---------------------------------------------------------------------------
// The poll reads this to know whether to run and whether to confirm in chat.
app.get('/api/config', (_req, res) => {
  const c = getConfig();
  res.json({ pollEnabled: c.pollEnabled, confirmLogs: c.confirmLogs });
});

app.get('/api/admin/ops', requireAdmin, (_req, res) => {
  res.json({
    config: getConfig(),
    discord: {
      webhook: !!WEBHOOK,
      bot: !!BOT_TOKEN,
      channel: !!CHANNEL_ID,
      interactions: !!PUBLIC_KEY,
      slashCommand: !!(BOT_TOKEN && APP_ID),
      clanTz: CLAN_TZ,
      canPost: !!((BOT_TOKEN && CHANNEL_ID) || WEBHOOK),
    },
  });
});

app.patch('/api/admin/ops', requireAdmin, (req, res) => {
  const b = req.body || {};
  const patch = {};
  if (Array.isArray(b.announceTypes)) {
    patch.announceTypes = [...new Set(b.announceTypes.filter((t) => VALID_TYPES.has(t)))];
  }
  const clampNum = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(+v) || 0));
  if (b.leadMinutes !== undefined) patch.leadMinutes = clampNum(b.leadMinutes, 0, 120);
  if (b.expireFactor !== undefined) patch.expireFactor = clampNum(b.expireFactor, 0, 50);
  for (const k of ['mirrorActions', 'remindersEnabled', 'pollEnabled', 'confirmLogs']) {
    if (b[k] !== undefined) patch[k] = !!b[k];
  }
  res.json(setConfig(patch));
});

// Send a message to the Discord channel as the bot.
app.post('/api/admin/discord/say', requireAdmin, (req, res) => {
  const content = String(req.body?.content || '').trim().slice(0, 1800);
  if (!content) return res.status(400).json({ error: 'message is empty' });
  if (!((BOT_TOKEN && CHANNEL_ID) || WEBHOOK)) {
    return res.status(400).json({ error: 'no Discord channel configured' });
  }
  sendChannel(content, { ping: !!req.body?.ping });
  res.json({ ok: true });
});

// Post a board snapshot (up now + next few) to Discord.
app.post('/api/admin/discord/post-board', requireAdmin, (_req, res) => {
  if (!((BOT_TOKEN && CHANNEL_ID) || WEBHOOK)) {
    return res.status(400).json({ error: 'no Discord channel configured' });
  }
  const now = Date.now();
  const rows = getAll
    .all()
    .filter((z) => z.interval_minutes != null && z.last_reset_at)
    .map((z) => ({ z, rem: z.interval_minutes - (now - Date.parse(z.last_reset_at)) / 60000 }))
    .sort((a, b) => a.rem - b.rem);
  const up = rows.filter((r) => r.rem <= 0 && -r.rem < r.z.interval_minutes * 2);
  const soon = rows.filter((r) => r.rem > 0).slice(0, 6);
  const fmt = (m) => (m >= 60 ? `${Math.floor(m / 60)}h${String(Math.round(m % 60)).padStart(2, '0')}` : `${Math.round(m)}m`);
  const lines = [];
  if (up.length) lines.push(`**up now:** ${up.map((r) => r.z.name).join(', ')}`);
  for (const r of soon) lines.push(`• ${r.z.name} — up in ${fmt(r.rem)}`);
  sendChannel(lines.length ? `📋 board\n${lines.join('\n')}` : '📋 board — nothing logged', { ping: false });
  res.json({ ok: true });
});

// ---- clan polls (question + buttons in Discord) ----------------------------
function listPollIds() {
  try {
    return JSON.parse(metaGet.get('polls_index')?.v || '[]');
  } catch {
    return [];
  }
}
function getPoll(id) {
  try {
    return JSON.parse(metaGet.get(`poll:${id}`)?.v || 'null');
  } catch {
    return null;
  }
}
function savePoll(p) {
  metaSet.run(`poll:${p.id}`, JSON.stringify(p));
  const idx = [p.id, ...listPollIds().filter((x) => x !== p.id)].slice(0, 20);
  metaSet.run('polls_index', JSON.stringify(idx));
}
function pollTally(p) {
  const counts = p.options.map(() => 0);
  for (const i of Object.values(p.votes || {})) if (counts[i] != null) counts[i]++;
  return { counts, total: Object.keys(p.votes || {}).length };
}
function pollBreakdown(p) {
  const names = p.names || {};
  return p.options.map((_, i) =>
    Object.entries(p.votes || {})
      .filter(([, idx]) => idx === i)
      .map(([uid]) => names[uid] || 'someone')
  );
}
function pollBody(p) {
  const { counts, total } = pollTally(p);
  const lines = p.options.map((o, i) => {
    const filled = total ? Math.round((counts[i] / total) * 10) : 0;
    return `${'█'.repeat(filled)}${'░'.repeat(10 - filled)} ${counts[i]}  ${o}`;
  });
  return `📊 **${p.question}**\n${lines.join('\n')}\n_${total} vote${total === 1 ? '' : 's'} · tap to vote_`;
}
function pollComponents(p) {
  const btns = p.options.map((o, i) => ({
    type: 2,
    style: 2,
    label: o.slice(0, 80),
    custom_id: `poll:${p.id}:${i}`,
  }));
  const rows = [];
  for (let i = 0; i < btns.length; i += 5) rows.push({ type: 1, components: btns.slice(i, i + 5) });
  return rows;
}

app.get('/api/admin/polls', requireAdmin, (_req, res) => {
  const polls = listPollIds()
    .map(getPoll)
    .filter(Boolean)
    .map((p) => ({
      id: p.id,
      question: p.question,
      options: p.options,
      created_at: p.created_at,
      ...pollTally(p),
      breakdown: pollBreakdown(p),
    }));
  res.json({ polls });
});

app.post('/api/admin/discord/poll', requireAdmin, async (req, res) => {
  if (!(BOT_TOKEN && CHANNEL_ID)) {
    return res.status(400).json({ error: 'polls need a bot token + channel id (buttons)' });
  }
  const question = String(req.body?.question || '').trim().slice(0, 240);
  let options = Array.isArray(req.body?.options) && req.body.options.length ? req.body.options : ['Yes', 'No'];
  options = options.map((o) => String(o || '').trim().slice(0, 60)).filter(Boolean).slice(0, 5);
  if (!question) return res.status(400).json({ error: 'question is empty' });
  if (options.length < 2) return res.status(400).json({ error: 'need at least 2 options' });

  const p = { id: crypto.randomUUID().slice(0, 8), question, options, votes: {}, created_at: nowIso() };
  const msg = await discordApi('POST', `/channels/${CHANNEL_ID}/messages`, {
    content: pollBody(p),
    components: pollComponents(p),
    allowed_mentions: { parse: [] },
  });
  if (!msg?.id) return res.status(502).json({ error: 'Discord rejected the poll message' });
  p.message_id = msg.id;
  savePoll(p);
  res.json({ ok: true, poll: { ...p, ...pollTally(p) } });
});

// Admin: wipe the reset history (activity feed + per-zone "came up" list + observed
// cycle). ?timers=1 also blanks every zone's current timer.
app.delete('/api/activity', requireAdmin, (req, res) => {
  const alsoTimers = /^(1|true)$/i.test(String(req.query.timers || ''));
  const cleared = db.prepare('DELETE FROM resets').run().changes;
  if (alsoTimers) {
    db.prepare(
      'UPDATE zones SET last_reset_at = NULL, last_reset_by = NULL, last_reset_note = NULL, claimed_by = NULL, claimed_at = NULL'
    ).run();
    for (const z of getAll.all()) broadcast('zone', decorate(z));
  }
  broadcast('activity-cleared', { timers: alsoTimers });
  res.json({ ok: true, cleared, timers: alsoTimers });
});

// ---------------------------------------------------------------------------
// Push notifications
// ---------------------------------------------------------------------------
app.get('/api/push/vapid', (_req, res) => res.json({ key: vapid.publicKey }));

app.post('/api/push/subscribe', requireAuth, (req, res) => {
  const s = req.body?.sub;
  if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth) {
    return res.status(400).json({ error: 'bad subscription' });
  }
  db.prepare(
    `INSERT INTO push_subs (user_id, endpoint, p256dh, auth) VALUES (?, ?, ?, ?)
     ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth`
  ).run(req.user.id, s.endpoint, s.keys.p256dh, s.keys.auth);
  res.json({ ok: true });
});

app.post('/api/push/unsubscribe', requireAuth, (req, res) => {
  if (req.body?.endpoint) db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(req.body.endpoint);
  res.json({ ok: true });
});

// Every minute: (1) post a Discord reminder for zones that just came up,
// (2) web-push watched zones as they approach / cross "up".
const pushedKeys = new Set(); // `${zoneId}:${endpoint}:${last_reset_at}:${bucket}`
const announcedUp = new Map(); // zone id -> last_reset_at we already announced in Discord
const warnedSoon = new Map(); // zone id -> last_reset_at we already sent a "heads up" for

setInterval(() => {
  const nowMs = Date.now();
  const cfg = getConfig();
  const announceSet = new Set(cfg.announceTypes);

  const zonesUp = getAll
    .all()
    .filter((z) => z.interval_minutes != null && z.last_reset_at)
    .map((z) => ({ z, upAt: new Date(z.last_reset_at).getTime() + z.interval_minutes * 60000 }));

  // --- auto-expire long-dead timers -----------------------------------
  if (cfg.expireFactor > 0) {
    for (const { z, upAt } of zonesUp) {
      if (nowMs - upAt > z.interval_minutes * cfg.expireFactor * 60000) {
        db.prepare(
          'UPDATE zones SET last_reset_at = NULL, last_reset_by = NULL, last_reset_note = NULL, claimed_by = NULL, claimed_at = NULL WHERE id = ?'
        ).run(z.id);
        broadcast('zone', decorate(getOne.get(z.id)));
      }
    }
  }

  // --- (0) Discord "heads up" — zone due in ~leadMinutes ----------------
  if (cfg.remindersEnabled && cfg.leadMinutes > 0) {
    const soon = zonesUp.filter(
      ({ z, upAt }) =>
        announceSet.has(z.type) &&
        upAt - nowMs > 0 &&
        upAt - nowMs <= cfg.leadMinutes * 60000 &&
        warnedSoon.get(z.id) !== z.last_reset_at
    );
    if (soon.length) {
      for (const { z } of soon) warnedSoon.set(z.id, z.last_reset_at);
      announceSoon(soon.map(({ z }) => z));
    }
    if (warnedSoon.size > 400) warnedSoon.clear();
  }

  // --- (1) Discord "it's up" reminder ------------------------------------
  const justUp = cfg.remindersEnabled
    ? zonesUp.filter(
        ({ z, upAt }) =>
          announceSet.has(z.type) &&
          nowMs >= upAt &&
          nowMs < upAt + 3 * 60000 && // within 3 min of going up
          announcedUp.get(z.id) !== z.last_reset_at
      )
    : [];
  if (justUp.length) {
    for (const { z } of justUp) announcedUp.set(z.id, z.last_reset_at);
    announceUp(justUp.map(({ z }) => z));
  }
  if (announcedUp.size > 400) announcedUp.clear();

  // --- (2) web-push ----------------------------------------------------
  const subs = db
    .prepare('SELECT ps.endpoint, ps.p256dh, ps.auth, u.prefs FROM push_subs ps JOIN users u ON u.id = ps.user_id')
    .all();
  if (subs.length === 0) {
    if (pushedKeys.size > 2000) pushedKeys.clear();
    return;
  }

  for (const row of subs) {
    let prefs = {};
    try {
      prefs = JSON.parse(row.prefs || '{}');
    } catch {
      /* none */
    }
    const watch = prefs.watch || [];
    const zoneLeads = prefs.zoneLeads || {};
    const globalLead = Number(prefs.notifyLead) || 0;

    for (const { z, upAt } of zonesUp) {
      if (watch.length && !watch.includes(z.id)) continue; // empty watch = all
      const lead = zoneLeads[z.id] != null ? Number(zoneLeads[z.id]) : globalLead;
      const fireAt = upAt - lead * 60000;
      if (nowMs < fireAt || nowMs > upAt + 5 * 60000) continue;

      // one push per cycle: "lead" bucket before it's up, "up" bucket after
      const bucket = nowMs < upAt ? 'lead' : 'up';
      const key = `${z.id}:${row.endpoint}:${z.last_reset_at}:${bucket}`;
      if (pushedKeys.has(key)) continue;
      pushedKeys.add(key);
      if (bucket === 'up') pushedKeys.add(`${z.id}:${row.endpoint}:${z.last_reset_at}:lead`);

      const mins = Math.round((upAt - nowMs) / 60000);
      const payload = JSON.stringify({
        title: z.name,
        body: bucket === 'lead' && mins > 0 ? `up in ~${mins} min` : 'should be up now — go check',
        tag: `zone-${z.id}`,
        url: '/',
      });
      webpush
        .sendNotification({ endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } }, payload)
        .catch((e) => {
          if (e?.statusCode === 404 || e?.statusCode === 410) {
            db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(row.endpoint);
          }
        });
    }
  }
  if (pushedKeys.size > 2000) pushedKeys.clear();
}, 60000);

// ---------------------------------------------------------------------------
// Board admin
// ---------------------------------------------------------------------------
app.get('/api/board/full', requireAdmin, (_req, res) => {
  const b = auth.getBoard();
  const members = db
    .prepare('SELECT id, username, display_name, role, role_tag, created_at FROM users ORDER BY role DESC, username')
    .all();
  res.json({ ...b, members });
});

app.patch('/api/board', requireAdmin, (req, res) => {
  const b = req.body ?? {};
  const patch = {};
  if (b.name !== undefined) {
    const n = String(b.name).trim().slice(0, 50);
    if (n.length < 2) return res.status(400).json({ error: 'board name too short' });
    patch.name = n;
  }
  if (b.registration !== undefined) {
    if (!['open', 'invite'].includes(b.registration)) return res.status(400).json({ error: 'bad registration mode' });
    patch.registration = b.registration;
  }
  if (b.invite_code !== undefined) patch.invite_code = String(b.invite_code).trim().slice(0, 40) || null;
  const keys = Object.keys(patch);
  if (keys.length) {
    db.prepare(`UPDATE board SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = 1`).run(
      ...keys.map((k) => patch[k])
    );
  }
  res.json(auth.getBoard());
});

app.patch('/api/board/members/:id', requireAdmin, (req, res) => {
  const target = auth.userById(req.params.id);
  if (!target) return res.status(404).json({ error: 'user not found' });
  const role = req.body?.role;
  if (!['member', 'admin'].includes(role)) return res.status(400).json({ error: 'role must be member or admin' });
  if (target.id === req.user?.id && role !== 'admin') {
    return res.status(409).json({ error: "you can't demote yourself" });
  }
  db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, target.id);
  res.json({ id: target.id, role });
});

app.delete('/api/board/members/:id', requireAdmin, (req, res) => {
  const target = auth.userById(req.params.id);
  if (!target) return res.status(404).json({ error: 'user not found' });
  if (target.id === req.user?.id) return res.status(409).json({ error: 'use “delete account” for yourself' });
  db.prepare('DELETE FROM users WHERE id = ?').run(target.id);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Zones
// ---------------------------------------------------------------------------
app.get('/api/zones', (_req, res) => {
  res.json(getAll.all().map(decorate));
});

app.post('/api/zones', requireAdmin, (req, res) => {
  const { name, type } = req.body ?? {};
  let { interval_minutes } = req.body ?? {};

  if (!name || typeof name !== 'string' || !name.trim()) {
    return res.status(400).json({ error: 'name is required' });
  }
  if (!VALID_TYPES.has(type)) {
    return res.status(400).json({ error: `type must be one of ${[...VALID_TYPES].join(', ')}` });
  }
  if (interval_minutes == null) {
    if (type !== 'blue') {
      return res.status(400).json({ error: 'interval_minutes is required for red_card / elite' });
    }
    interval_minutes = null;
  } else if (!Number.isInteger(interval_minutes) || interval_minutes <= 0) {
    return res.status(400).json({ error: 'interval_minutes must be a positive integer' });
  }

  const info = db
    .prepare('INSERT INTO zones (name, type, interval_minutes) VALUES (?, ?, ?)')
    .run(name.trim(), type, interval_minutes);

  const out = decorate(getOne.get(info.lastInsertRowid));
  broadcast('zone', out);
  res.status(201).json(out);
});

// Discord button clicks land here (set this URL as the app's Interactions Endpoint URL).
app.post('/api/discord/interactions', (req, res) => {
  if (!verifyDiscordSig(req)) return res.status(401).send('bad request signature');
  const body = req.body || {};

  if (body.type === 1) return res.json({ type: 1 }); // PING

  const u = body.member?.user || body.user || {};
  const who = (u.global_name || u.username || 'someone').slice(0, 40);
  const eph = (content) => res.json({ type: 4, data: { content, flags: 64 } });
  const say = (content) => res.json({ type: 4, data: { content, allowed_mentions: { parse: [] } } });

  // --- /up slash command ---------------------------------------------------
  if (body.type === 2) {
    if (body.data?.name !== 'up') return eph('Unknown command.');
    const opts = Object.fromEntries((body.data.options || []).map((o) => [o.name, o.value]));
    const zone = getOne.get(Number(opts.zone));
    if (!zone) return eph('Unknown zone.');

    const at = parseClanTime(opts.time);
    if (at == null) return eph(`Couldn't read the time "${opts.time}". Try "3:50pm", "15:50", or "now".`);

    // the time given is when the zone was collected / reset
    const interval = (zone.interval_minutes ?? 60) * 60000;
    const resetAtIso = new Date(Math.min(at, Date.now())).toISOString();
    applyReset(zone, resetAtIso, {
      who,
      source: 'discord',
      note: `via /up${opts.time ? ` "${opts.time}"` : ''}`,
    });
    const upUnix = Math.round((Date.parse(resetAtIso) + interval) / 1000);
    const tail = zone.interval_minutes != null ? `next up <t:${upUnix}:R>` : 'logged';
    return say(`✅ **${zone.name}** logged by ${who} — ${tail}`);
  }

  // --- button clicks -----------------------------------------------------
  if (body.type === 3) {
    const cid = body.data?.custom_id || '';

    // "Got it" / "Skip" on an "up now" reminder
    const mc = cid.match(/^(collect|skip):(\d+):(\d+)$/);
    if (mc) {
      const action = mc[1];
      const zone = getOne.get(Number(mc[2]));
      const stamp = Number(mc[3]);
      if (!zone) return eph('That zone no longer exists.');
      if (zone.last_reset_at && Date.parse(zone.last_reset_at) !== stamp) {
        return eph(`**${zone.name}** was already handled — timer is current.`);
      }

      let note;
      if (action === 'collect') {
        const out = applyReset(zone, nowIso(), { who, source: 'discord', note: 'collected via Discord' });
        const when = out.interval_minutes != null ? `next up in ~${out.interval_minutes}m` : 'logged';
        note = `✅ **${zone.name}** — ${who} got it · ${when}`;
      } else {
        clearZoneTimer(zone.id);
        note = `⏭️ **${zone.name}** — skipped by ${who}`;
      }

      // drop this zone's whole button row from the reminder
      const tag = `:${zone.id}:${stamp}`;
      const components = (body.message?.components || []).filter(
        (row) => !(row.components || []).some((c) => (c.custom_id || '').endsWith(tag))
      );
      return res.json({
        type: 7, // UPDATE_MESSAGE
        data: { content: `${body.message?.content || ''}\n${note}`, components, allowed_mentions: { parse: [] } },
      });
    }

    // "which zone?" buttons on a teach-on-unclear prompt
    const mt = cid.match(/^teach:(\d+):(\d+):(.*)$/);
    if (mt) {
      const zone = getOne.get(Number(mt[1]));
      const stamp = Number(mt[2]);
      const phrase = decodeURIComponent(mt[3] || '');
      if (!zone) return eph('That zone no longer exists.');
      // stamp = the reset moment the poll parsed off the line (0 = none → now)
      const resetAtIso = new Date(Math.min(stamp || Date.now(), Date.now())).toISOString();
      applyReset(zone, resetAtIso, { who, source: 'discord', note: 'placed via Discord' });
      if (phrase) learnAlias(phrase, zone.name);
      return res.json({
        type: 7,
        data: {
          content: `${body.message?.content || ''}\n✅ **${zone.name}** — ${who}${phrase ? ` · learned “${phrase}”` : ''}`,
          components: [],
          allowed_mentions: { parse: [] },
        },
      });
    }
    if (cid.startsWith('teachx:')) {
      return res.json({
        type: 7,
        data: { content: `${body.message?.content || ''}\n· ignored by ${who}`, components: [], allowed_mentions: { parse: [] } },
      });
    }

    // clan poll vote
    const mv = cid.match(/^poll:([a-z0-9]+):(\d+)$/i);
    if (mv) {
      const p = getPoll(mv[1]);
      if (!p) return eph('That poll is closed.');
      const idx = Number(mv[2]);
      if (idx < 0 || idx >= p.options.length) return eph('Unknown option.');
      const uid = u.id;
      if (!uid) return eph('Could not read who you are.');
      p.votes = p.votes || {};
      p.names = p.names || {};
      p.votes[uid] = idx;
      p.names[uid] = who;
      savePoll(p);
      return res.json({
        type: 7,
        data: { content: pollBody(p), components: pollComponents(p), allowed_mentions: { parse: [] } },
      });
    }

    return eph('Unknown button.');
  }

  return res.json({ type: 4, data: { content: 'ok', flags: 64 } });
});

// The poll bot posts here when it can't confidently place a line.
app.post('/api/discord/unclear', requireAuth, (req, res) => {
  const { line, reset_at, phrase, candidates } = req.body || {};
  if (!line || !Array.isArray(candidates) || candidates.length === 0) {
    return res.status(400).json({ error: 'need line + candidates' });
  }
  if (!((BOT_TOKEN && CHANNEL_ID) || WEBHOOK)) return res.json({ ok: false, reason: 'no discord channel' });

  const stamp = reset_at ? Date.parse(reset_at) || 0 : 0;
  const ph = encodeURIComponent(String(phrase || '').toLowerCase().slice(0, 32));
  const buttons = candidates.slice(0, 4).map((c) => ({
    type: 2,
    style: 1,
    label: String(c.name).slice(0, 80),
    custom_id: `teach:${c.id}:${stamp}:${ph}`,
  }));
  buttons.push({ type: 2, style: 2, label: 'Ignore', custom_id: 'teachx:0:0:' });

  sendChannel(`🤔 couldn't place this — which zone?\n> ${String(line).slice(0, 300)}`, {
    components: [{ type: 1, components: buttons }],
  });
  res.json({ ok: true });
});

app.get('/api/learned', (_req, res) => res.json(getLearned()));

app.get('/api/zones/:id/history', (req, res) => {
  const zone = getOne.get(req.params.id);
  if (!zone) return res.status(404).json({ error: 'zone not found' });
  const rows = db
    .prepare(
      'SELECT reset_at, by_name, source, created_at FROM resets WHERE zone_id = ? ORDER BY reset_at DESC LIMIT 12'
    )
    .all(zone.id);
  res.json({ zone_id: zone.id, interval_minutes: zone.interval_minutes, resets: rows });
});

/** Apply a reset to a zone: write it, record history, broadcast. Returns the decorated zone. */
function applyReset(zone, resetAtIso, { who = null, source = 'web', note = null, userId = null } = {}) {
  db.prepare(
    'UPDATE zones SET last_reset_at = ?, last_reset_by = ?, last_reset_note = ?, claimed_by = NULL, claimed_at = NULL WHERE id = ?'
  ).run(resetAtIso, who, note, zone.id);
  db.prepare(
    'INSERT INTO resets (zone_id, user_id, by_name, reset_at, source, note) VALUES (?, ?, ?, ?, ?, ?)'
  ).run(zone.id, userId, who, resetAtIso, source, note);

  const out = decorate(getOne.get(zone.id));
  broadcast('zone', out);
  broadcast('activity', {
    zone: zone.name,
    zone_id: zone.id,
    by_name: who,
    user_id: userId,
    reset_at: resetAtIso,
    created_at: nowIso(),
    source,
  });
  return out;
}

app.post('/api/zones/:id/reset', requireAuth, (req, res) => {
  const zone = getOne.get(req.params.id);
  if (!zone) return res.status(404).json({ error: 'zone not found' });

  const { reset_at, by, note } = req.body ?? {};
  let resetAt = nowIso();

  if (reset_at != null) {
    const d = new Date(reset_at);
    if (Number.isNaN(d.getTime())) {
      return res.status(400).json({ error: 'reset_at must be a valid ISO timestamp' });
    }
    if (d.getTime() > Date.now() + 60_000) {
      return res.status(400).json({ error: 'reset_at cannot be in the future' });
    }
    resetAt = d.toISOString();
  }

  // no-op re-log (the Discord poll re-scans the same messages every run) — don't
  // write another history row or fire another activity event; just report it.
  if (
    zone.last_reset_at &&
    Math.abs(Date.parse(zone.last_reset_at) - Date.parse(resetAt)) <= 60_000
  ) {
    return res.json({ ...decorate(zone), changed: false });
  }

  const rawBy = actorName(req, by);
  const who = req.user
    ? req.user.display_name || req.user.username
    : rawBy
      ? rawBy.replace(/^discord:\s*/i, '').slice(0, 60)
      : null;
  const cleanNote = note && String(note).trim() ? String(note).trim().slice(0, 200) : null;
  const source = req.user
    ? 'web'
    : /discord/i.test(`${by || ''} ${note || ''}`)
      ? 'discord'
      : 'paste';

  const out = applyReset(zone, resetAt, { who, source, note: cleanNote, userId: req.user?.id ?? null });
  toDiscord(
    `\`${zone.name}\` reset logged${who ? ` by ${who}` : ''}` +
      (out.elapsed_minutes != null ? ` — up ${resetAtWord(out)}` : ''),
    { kind: 'action' }
  );
  res.json({ ...out, changed: true });
});

function resetAtWord(z) {
  if (z.interval_minutes == null || z.elapsed_minutes == null) return 'now';
  const remaining = z.interval_minutes - z.elapsed_minutes;
  return remaining > 0 ? `in ~${remaining}m` : `now (${-remaining}m ago)`;
}

app.post('/api/zones/:id/claim', requireAuth, (req, res) => {
  const zone = getOne.get(req.params.id);
  if (!zone) return res.status(404).json({ error: 'zone not found' });
  const by = req.user ? req.user.display_name || req.user.username : actorName(req, req.body?.by);
  if (!by) return res.status(400).json({ error: 'sign in to claim a zone' });

  db.prepare('UPDATE zones SET claimed_by = ?, claimed_at = ? WHERE id = ?').run(by, nowIso(), zone.id);
  const out = decorate(getOne.get(zone.id));
  broadcast('zone', out);
  toDiscord(`\`${zone.name}\` — ${by} is on it`, { kind: 'action' });
  res.json(out);
});

app.post('/api/zones/:id/unclaim', requireAuth, (req, res) => {
  const zone = getOne.get(req.params.id);
  if (!zone) return res.status(404).json({ error: 'zone not found' });
  db.prepare('UPDATE zones SET claimed_by = NULL, claimed_at = NULL WHERE id = ?').run(zone.id);
  const out = decorate(getOne.get(zone.id));
  broadcast('zone', out);
  res.json(out);
});

// Blank one zone's timer — back to "not logged". Keeps the zone + its history.
/** Blank a zone's timer (bad/stale time, or skipped). Returns the decorated zone. */
function clearZoneTimer(id) {
  db.prepare(
    'UPDATE zones SET last_reset_at = NULL, last_reset_by = NULL, last_reset_note = NULL, claimed_by = NULL, claimed_at = NULL WHERE id = ?'
  ).run(id);
  const out = decorate(getOne.get(id));
  broadcast('zone', out);
  return out;
}

app.post('/api/zones/:id/clear', requireAuth, (req, res) => {
  const zone = getOne.get(req.params.id);
  if (!zone) return res.status(404).json({ error: 'zone not found' });
  res.json(clearZoneTimer(zone.id));
});

app.patch('/api/zones/:id', requireAdmin, (req, res) => {
  const zone = getOne.get(req.params.id);
  if (!zone) return res.status(404).json({ error: 'zone not found' });

  const next = {
    name: zone.name,
    type: zone.type,
    interval_minutes: zone.interval_minutes,
    note: zone.note ?? null,
  };

  if (req.body?.name !== undefined) {
    if (!String(req.body.name).trim()) return res.status(400).json({ error: 'name cannot be empty' });
    next.name = String(req.body.name).trim();
  }
  if (req.body?.type !== undefined) {
    if (!VALID_TYPES.has(req.body.type)) return res.status(400).json({ error: 'invalid type' });
    next.type = req.body.type;
  }
  if (req.body?.interval_minutes !== undefined) {
    next.interval_minutes = req.body.interval_minutes;
  }
  if (req.body?.note !== undefined) {
    next.note = String(req.body.note ?? '').trim().slice(0, 280) || null;
  }

  // Keep the interval rule consistent with creation: null only allowed for blue.
  if (next.interval_minutes == null) {
    if (next.type !== 'blue') {
      return res.status(400).json({ error: 'interval_minutes is required for red_card / elite' });
    }
  } else if (!Number.isInteger(next.interval_minutes) || next.interval_minutes <= 0) {
    return res.status(400).json({ error: 'interval_minutes must be a positive integer' });
  }

  db.prepare('UPDATE zones SET name = ?, type = ?, interval_minutes = ?, note = ? WHERE id = ?').run(
    next.name,
    next.type,
    next.interval_minutes,
    next.note,
    zone.id
  );

  const out = decorate(getOne.get(zone.id));
  broadcast('zone', out);
  res.json(out);
});

app.delete('/api/zones/:id', requireAdmin, (req, res) => {
  const info = db.prepare('DELETE FROM zones WHERE id = ?').run(req.params.id);
  if (info.changes === 0) return res.status(404).json({ error: 'zone not found' });
  broadcast('zone-deleted', { id: Number(req.params.id) });
  res.status(204).end();
});

// ---------------------------------------------------------------------------
// Optionally serve the built frontend from the same Express instance.
// ---------------------------------------------------------------------------
const clientDist = join(__dirname, '..', '..', 'client', 'dist');
if (existsSync(clientDist)) {
  // hashed assets can cache forever; the shell + service worker must always revalidate
  app.use(
    express.static(clientDist, {
      setHeaders(res, filePath) {
        if (/\/assets\/.*\.(js|css|woff2?)$/.test(filePath)) {
          res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        } else if (/(index\.html|sw\.js|manifest\.webmanifest)$/.test(filePath)) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      },
    })
  );
  app.get('*', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.sendFile(join(clientDist, 'index.html'));
  });
}

app.listen(PORT, () => {
  console.log(`Once Human timer API listening on http://localhost:${PORT}`);
  registerCommands().catch((e) => console.error('command registration failed:', e.message));
});
