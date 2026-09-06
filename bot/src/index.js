// Always-on gateway bot. Reacts to messages in real time. If you'd rather not
// host a persistent process, use src/poll.js on a schedule instead.
import 'dotenv/config';
import { Client, GatewayIntentBits, Events } from 'discord.js';
import { parseMessage } from './parse.js';
import { loadRoster, logReset } from './api.js';

const TOKEN = process.env.DISCORD_TOKEN;
const CHANNELS = (process.env.WATCH_CHANNEL_ID || '').split(',').map((s) => s.trim()).filter(Boolean);
const DRY = /^(1|true)$/i.test(process.env.DRY_RUN || '');

if (!TOKEN) {
  console.error('Set DISCORD_TOKEN (see .env.example).');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

let roster = [];
async function refreshRoster() {
  try {
    roster = await loadRoster();
    console.log(`roster: ${roster.length} zones`);
  } catch (e) {
    console.error('roster load failed:', e.message);
  }
}

client.once(Events.ClientReady, async (c) => {
  console.log(`online as ${c.user.tag}${DRY ? ' (DRY RUN)' : ''}`);
  console.log(CHANNELS.length ? `watching channels: ${CHANNELS.join(', ')}` : 'watching every visible channel');
  await refreshRoster();
  setInterval(refreshRoster, 5 * 60_000);
});

client.on(Events.MessageCreate, async (msg) => {
  if (msg.author.bot) return;
  if (CHANNELS.length && !CHANNELS.includes(msg.channelId)) return;
  if (!roster.length) return;

  const results = parseMessage(msg.content, msg.createdAt, roster);
  if (!results.length) return;

  const done = [];
  let unclear = 0;
  for (const res of results) {
    if (res.ambiguous) {
      unclear++;
      continue;
    }
    if (DRY) {
      console.log(`[dry] ${res.zone.name} <- "${res.line}" => ${res.resetAt}`);
      done.push(res.zone.name);
      continue;
    }
    try {
      await logReset(
        res.zone.id,
        res.resetAt,
        `${msg.author.username} (discord)`,
        `discord: "${res.line}"`
      );
      console.log(`logged ${res.zone.name} reset ${res.resetAt} ("${res.line}")`);
      done.push(res.zone.name);
    } catch (e) {
      console.error(`POST failed for ${res.zone.name}:`, e.message);
    }
  }

  try {
    if (done.length) {
      await msg.react('✅');
      // say what was matched, so a wrong guess is caught in-channel
      await msg.reply({
        content: `logged: ${[...new Set(done)].join(' · ')}`,
        allowedMentions: { repliedUser: false },
      });
    }
    if (unclear) await msg.react('❓');
  } catch {
    /* missing permissions — ignore */
  }
});

client.on(Events.Error, (e) => console.error('client error:', e.message));
client.login(TOKEN);
