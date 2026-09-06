# Once Human Raid Zone Timer — Web App Build Spec

## 1. What this is

A shared web dashboard for a Once Human clan/hive to track reset timers for raid zone points of interest:

- **Red card rooms** — reset every 2 hours
- **Elite enemies** — reset every 1 hour

Any clan can trigger a reset (opening the room / killing the elite), not just our team, so the tool does **not** predict the next spawn. It only tracks **elapsed time since the last confirmed reset**, logged manually by whoever saw it happen. If a reset hasn't been confirmed in a while, the tool flags the timer as stale instead of pretending to know the truth.

This is phase 1 (web only). A Discord bot will be added later, reading and writing to the same backend — so the backend must not assume a browser is the only client.

## 2. Tech stack

- **Frontend:** React (Vite), plain CSS (no Tailwind compiler available — hand-written CSS with custom properties)
- **Backend:** Node.js + Express
- **Database:** SQLite (via `better-sqlite3` or `sqlite3`) — no need for anything heavier at this scale
- **Hosting target:** a single small VPS or a free-tier platform (Railway/Render) — backend and frontend can be deployed separately or served from one Express instance

## 3. Data model

Single table, `zones`:

| Column | Type | Notes |
|---|---|---|
| `id` | integer, primary key | |
| `name` | text | e.g. "Red Card — Iron Wreckage" |
| `type` | text | `"red_card"` or `"elite"` |
| `interval_minutes` | integer | 120 for red card, 60 for elite (stored per-row so it's not hardcoded logic) |
| `last_reset_at` | ISO timestamp, nullable | null = never logged yet |
| `last_reset_by` | text, nullable | free-text name of whoever logged it (no auth system needed for a clan tool) |
| `created_at` | ISO timestamp | |

No user accounts. No login. Anyone with the link can view and log resets — this is a clan tool, not a public product.

## 4. Backend API

Base path: `/api`

- `GET /api/zones` — returns all zones with computed fields added server-side or client-side:
  - `elapsed_minutes` = now − `last_reset_at`
  - `is_stale` = `elapsed_minutes > interval_minutes` (i.e. it's gone past its typical interval with no confirmation — display this as a warning, not a countdown)
- `POST /api/zones` — create a new zone (`name`, `type`, `interval_minutes`)
- `POST /api/zones/:id/reset` — body: `{ "reset_at": <ISO timestamp, optional — defaults to now>, "by": <string, optional> }`. This is the core action: logs a fresh reset, either "just now" or backdated if someone is logging something they saw earlier.
- `DELETE /api/zones/:id` — remove a zone (for typos or zones no longer relevant)
- `PATCH /api/zones/:id` — edit a zone's name/type/interval

Keep responses as plain JSON. No auth middleware needed for v1.

## 5. Frontend behavior

- On load, fetch `/api/zones` and poll every ~15–30 seconds (or just recompute elapsed time client-side every second using a `setInterval`, and re-fetch from the server every 30s to catch resets logged by others).
- Each zone renders as a card showing:
  - Name and type (red card / elite)
  - Elapsed time since last reset, live-ticking (e.g. `1h 42m ago`)
  - A "Reset now" button
  - A "Log a different time" option (opens a small time picker for backdating)
  - A visual "stale / unconfirmed" state once elapsed time exceeds the zone's interval — this should look distinctly different from the normal state (not just a color tweak; add a label like "no confirmed reset in over Xh — check in person")
- An "Add zone" form/modal for creating new tracked points.
- Group or filter by type (red card vs elite) since they're visually and functionally distinct.
- No countdown to a "next spawn" anywhere in the UI — only elapsed time and staleness. This is intentional; do not add predictive spawn timers.

## 6. Visual design — glassmorphism, Once Human–inspired

Once Human's world is a surreal post-apocalyptic setting corrupted by an extraterrestrial substance called Stardust — dark, industrial environments cut through with unnatural bioluminescent glows. Lean into that rather than a generic gamer-UI look.

**Color palette:**
- Background base: `#0B0E11` (near-black, slightly cool) — apply a very subtle radial gradient or faint noise texture, not flat black
- Glass panel fill: `rgba(20, 27, 31, 0.55)` with `backdrop-filter: blur(18px)` and a hairline border `rgba(255,255,255,0.08)`
- Primary accent (Stardust teal): `#35D6C4` — used for "recently reset / healthy" states, active buttons, focus rings
- Secondary accent (corruption violet): `#8B6FE8` — used sparingly, e.g. for the elite-enemy type tag, to visually separate the two zone types without relying on teal for everything
- Warning (stale/unconfirmed): `#E8935C` (warm amber, not red — this is "needs checking," not "error")
- Text: `#E7E9EA` primary, `#9AA3A8` secondary/muted

**Typography:**
- Headers/labels: a technical, slightly angular sans — "Chakra Petch" or "Rajdhani" (both free on Google Fonts) — gives a HUD/survival-tech feel without tipping into cliché cyberpunk neon
- Body/numbers: "Inter" for actual readability of timers and buttons — don't set live-updating numbers in a stylized display font, they need to stay legible as they change

**Layout:**
- Dark full-bleed background, content in a centered max-width container (~960–1100px)
- Zone cards in a responsive grid (auto-fill, min card width ~260px), collapsing to a single column on mobile
- Each card is a glass panel: blurred, softly bordered, with a thin colored top edge (teal or violet) indicating zone type rather than a big colored icon
- Keep chrome minimal — no sidebar, no nav bar beyond a simple header with the hive/team name and an "Add zone" button
- Avoid the generic AI-tell aesthetic: no all-caps eyebrow labels, no gradient-washed cards with identical rounded corners and a soft grey shadow on every element — vary emphasis intentionally (the "stale" state should look meaningfully different from a healthy card, not just a tinted badge)

**Motion:**
- A subtle pulse/glow animation only on cards that just got reset (a few seconds of feedback), and a slow, low-opacity ambient animation on the page background (like drifting particles or a faint moving gradient) to suggest the Stardust atmosphere — kept subtle enough not to distract from reading timers
- Respect `prefers-reduced-motion`

## 7. Explicit non-goals for this phase

- No login/auth system
- No push notifications (that's Discord bot territory, phase 2)
- No spawn prediction — elapsed time and a staleness flag only
- No mobile app — responsive web is enough

## 8. Suggested build order

1. Backend: Express server, SQLite schema, all endpoints in section 4, test with curl/Postman
2. Frontend: static zone list rendering from the API (no styling yet)
3. Frontend: reset button + backdate picker wired to the API
4. Apply the visual design system (glass panels, colors, fonts, background)
5. Add staleness detection and its distinct visual state
6. Polish: live-ticking timers, add/edit/delete zone flows, mobile responsiveness
