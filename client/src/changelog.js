// What's-new entries, newest first. Keep it short — one line per user-visible change.
// `date` is just for display + "unseen" ordering; bump it when you add an entry.
export const CHANGELOG = [
  {
    date: '2026-09-07',
    title: 'Bot & ops page (admin)',
    items: [
      'Its own page at /#/ops — send a message as the bot, post a board snapshot',
      'Ask the clan — post a question with Yes/No (or custom) voting buttons, see the tally',
      'Log a reset for any zone at any time from one place',
      'Switch the Discord reminders and the chat poll on/off; tune types, lead, auto-clear',
    ],
  },
  {
    date: '2026-09-07',
    title: 'Times mean “when it was cleared”',
    items: [
      'A time in chat (or in /up) is now read as when the zone was collected — the next window is a full cycle after it, not from that time',
      'Fixes zones showing overdue right after someone logged a fresh clear',
      '“open” / “up” with no time still means “available right now”',
    ],
  },
  {
    date: '2026-09-06',
    title: 'Discord bot does more',
    items: [
      '/up <zone> <time> — log a reset straight from Discord',
      '“Up now” reminders got a Skip button, and the bot now replies “✅ logged from chat” when it reads a time',
      'When the bot can’t place a line it asks “which zone?” with buttons — a tap logs it and teaches the spelling',
    ],
  },
  {
    date: '2026-09-06',
    title: 'Board changes',
    items: [
      '“Up next” view — every zone in one soonest-first list (toggle top-left)',
      'Logging is now just two buttons: “just now” and “earlier…”',
      'Per-zone “clear timer”, and stale zones blank themselves after a while',
      'Top loggers panel — who’s been logging resets this week',
      'Cycle-drift note now offers admins a one-tap “set cycle to ~X”',
      'All times switched to 12-hour with AM/PM',
    ],
  },
  {
    date: '2026-09-05',
    title: 'Live + installable',
    items: [
      'Board updates in real time as the clan logs times',
      'Install it as an app; opt in to notifications when a zone goes up',
      'New dark dashboard layout',
    ],
  },
];
