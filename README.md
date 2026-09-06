# Once Human — Rift Zone Timers

Phase 1 web app for the spec in [`once-human-timer-webapp-spec.md`](once-human-timer-webapp-spec.md).
Tracks **elapsed time since the last confirmed reset** for raid zone points — it never
predicts the next spawn. Once a zone passes its typical interval with no new confirmation
it flips to a distinct **unconfirmed / stale** state instead of guessing.

```
server/   Express + SQLite API + accounts (node:sqlite, no native build)
client/   React (Vite) + hand-written CSS
bot/      Discord → timer sync (scheduled poll or always-on bot) — see bot/README.md
deploy/   VPS config: Caddy + systemd units + backup — see deploy/README.md
```

## Accounts

Username + password, no email. **The first account to register becomes the board admin**
(can add / edit / delete zones); everyone else is a member (log resets, claim zones).
The board is viewable without an account — any action prompts sign-in. Forgot a password?
An admin edits the `users` row in SQLite, or delete it and re-register.

## Zone types

| Type       | Interval | Notes                                                        |
|------------|----------|-------------------------------------------------------------|
| `red_card` | 120 min  | Settlement card rooms — GAIA, Furnace, Forsaken, Ricci      |
| `elite`    | 60 min   | Elite enemy points (Blackfell, Fort Eyrie, Alpha Institute…) |
| `blue`     | 60 min   | Blue Card Rooms (supply card). Can be set to no-interval per room. |

## Run it (dev)

Two terminals:

```bash
# 1 — API on :3001
cd server
npm install
npm run seed      # first time only — loads the zones listed above
npm run dev

# 2 — client on :5173, proxies /api to :3001
cd client
npm install
npm run dev
```

Open http://localhost:5173.

Ports are configurable if 3001/5173 are taken:

```bash
cd server && PORT=3002 npm run dev
cd client && API_URL=http://localhost:3002 CLIENT_PORT=5174 npm run dev
```

## Run it (single process)

```bash
cd client && npm install && npm run build     # emits client/dist
cd ../server && npm install && npm run seed && npm start
```

The server serves `client/dist` when it exists, so the whole app is on
http://localhost:3001 with no separate frontend process.

## API (`/api`)

| Method | Path                  | Body                                             | Purpose |
|--------|-----------------------|--------------------------------------------------|---------|
| GET    | `/zones`              | —                                                | All zones + computed `elapsed_minutes`, `is_stale` |
| POST   | `/zones`              | `{ name, type, interval_minutes? }`              | Create (interval ignored/forced null for `blue`) |
| POST   | `/zones/:id/reset`    | `{ reset_at?: ISO, by?: string }`                | Log a reset — now, or backdated |
| PATCH  | `/zones/:id`          | `{ name?, type?, interval_minutes? }`            | Edit |
| DELETE | `/zones/:id`          | —                                                | Remove |
| GET    | `/health`             | —                                                | Liveness check |

No auth — clan tool, anyone with the link can view and log. `elapsed_minutes` and
`is_stale` are computed server-side on every `GET /zones`; the client also recomputes
elapsed time locally each second and re-fetches every 30s to catch resets logged by others.

## Data

SQLite file at `server/data.sqlite` (git-ignored, WAL mode). Single `zones` table.
The later Discord bot can read/write the same DB / API — the backend assumes no browser.

## Notes / deviations from the spec

- **UI is a dark monospace status board, not the spec's glassmorphism.** The glass/teal/violet
  card look read as generic AI-dashboard; replaced with a flat ruled log table (JetBrains Mono,
  no blur/gradient/shadow, no cards). Stale rows get an amber left bar + inline sub-line;
  fresh resets flash teal. `prefers-reduced-motion` respected.
- **`blue` zone type**: Blue Card Rooms, default 2h interval (per-room `interval_minutes` may be null to disable staleness).
- **Clan logs "next expected reset" times**, not reset times. When entering from the Discord log,
  `last_reset_at` is stored as `(reported next-up time) − interval`, so the meter fills toward the
  moment it's next available. Times themselves are Manila 12-hour.
- **Roster bulk editor** (`edit zones` in the header): paste `Full name | red|elite|blue [| interval]`
  one per line, it diffs against the current zones and creates / updates / removes to match.
  Matches by exact name (renaming there drops the logged reset — use a row's `edit` for pure renames).
- **Countdown UI**: one roomy vertical block per zone — big `up in Xm` / `overdue Xm`
  (= last reset + interval − now) in mono, a fill bar toward ready, a status dot (up / soon /
  cooking), and dim action links. Names/labels in Inter, numbers in JetBrains Mono. Rows sort
  soonest-first, overdue on top. Row times are Manila only; header keeps a live dual clock
  (`Asia/Manila` UTC+8 is the shared reference).
- **`node:sqlite`** instead of `better-sqlite3` — same synchronous API, but no C++ toolchain
  needed (there's no prebuilt `better-sqlite3` for Node 24 on this machine). Requires Node ≥ 22.5.
- Fonts (Chakra Petch / Inter) load from Google Fonts via `<link>` in `client/index.html`.
