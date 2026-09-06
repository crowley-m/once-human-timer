# Discord → timer sync

Reads your clan's reset-log channel and writes to the same API the website uses,
so the board updates automatically.

## Is a "bot" avoidable?

Reading Discord messages **always** needs a bot token + the app added to your
server — that's a 2-minute one-time setup, not "hosting a bot". What you can
skip is running an always-on process: `src/poll.js` does one pass and exits, so
you run it on a schedule instead.

| Mode | File | Needs a running process? | Good when |
|---|---|---|---|
| Real-time bot | `src/index.js` | yes, 24/7 | you have a VPS; want instant ✅ reactions |
| Scheduled poll | `src/poll.js` | no — cron/Actions | simplest; ~5 min lag is fine |
| No Discord at all | website `edit zones` → *(paste box, if built)* | no | you don't want any token |

## One-time Discord setup (all modes)

1. https://discord.com/developers/applications → **New Application**.
2. **Bot** tab → **Reset Token** → copy it → that's `DISCORD_TOKEN`.
3. Same tab → enable **Message Content Intent**.
4. **OAuth2 → URL Generator**: scope `bot`, permissions *View Channels*,
   *Read Message History*, *Add Reactions*. Open the URL, add it to your server.
5. In Discord: Settings → Advanced → **Developer Mode** on. Right-click the
   reset-log channel → **Copy Channel ID** → that's `WATCH_CHANNEL_ID`.

```bash
cd bot
npm install
cp .env.example .env      # fill in DISCORD_TOKEN, WATCH_CHANNEL_ID, API_URL
```

Check the parser first, no writes:

```bash
DRY_RUN=1 node src/poll.js
```

## Run it

**Scheduled poll (recommended).** Every run scans the last ~12 min and is safe to
repeat — re-processing a message just recomputes the same time.

Windows, same machine as the API. Two ways:

- **No admin** (recommended) — from the repo root, `install-autostart.ps1` picks up
  the poll automatically once `bot\.env` has a `DISCORD_TOKEN`. It runs
  `run-poll-loop.cmd` (poll → wait 5 min → repeat) hidden at every logon.
- **Task Scheduler** (tidier, needs an elevated PowerShell) —
  `powershell -ExecutionPolicy Bypass -File register-task.ps1` from `bot\`, then
  `unregister-task.ps1` to remove. Use one or the other, not both.

Either way each run appends to `bot\poll.log`:

```powershell
Get-Content bot\poll.log -Tail 30
```

Linux/cron equivalent, or GitHub Actions
([`.github/workflows/discord-poll.yml`](../.github/workflows/discord-poll.yml), needs
the API on a public URL):

```
*/5 * * * *  cd /path/to/bot && /usr/bin/node src/poll.js >> poll.log 2>&1
```

**Real-time bot:**
```bash
npm start          # keep alive with pm2 / systemd / a screen session
```

## How a message becomes a timer

`FURNACE RED 6:00` posted ~04:00 Manila →
matches **Furnace Lair** (red, 2h) → `6:00` is read as *next expected up* →
stored last-reset = `06:00 − 2h = 04:00 Manila` → board shows `up in ~2h`.

- Times are read as **clan-tz 12-hour** (`CLAN_TZ`, default `Asia/Manila`),
  AM/PM inferred from when the message was sent.
- `open` / `up now` → treated as available right now.

## Misspellings

Nobody types the real names. The matcher is **fuzzy** (Sørensen–Dice + prefix), so
`sunbry`, `greywatr`, `forsakn elite`, `railwey`, `hearast`, `blackfel oil` all
resolve on their own. Qualifier words (`elite` / `red` / `blue` / `card`) only pick
between same-place siblings — e.g. `furnace` alone → ❓, `furnace elite` → the Pornis
elite, `furnace red` → the card room.

- **Genuinely unclear** (`furnace 3:53`, garbage like `HEARTASDSACZX`) → the bot
  reacts ❓ and skips it. It never guesses.
- **Teach it a spelling once** — add to [`src/learned.json`](src/learned.json):
  `{ "snbry": "Sunbury Middle School" }` (key = what they type, lowercase).
- **See what it matched** — every bot-logged reset shows its source line under the
  zone on the website (`discord: "railwey junction 4:22"`), and lands in `poll.log`.
  Wrong match → hit `edit` on that row. The gateway bot also replies `logged: <zones>`
  in the channel.
- Broaden coverage in [`src/aliases.js`](src/aliases.js); tune strictness with
  `MATCH_THRESHOLD` in `.env`.

Offline test against real + misspelled log lines: `npm run test-parse`.
