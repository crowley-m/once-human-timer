// Uses Node's built-in SQLite (node:sqlite). Stable & unflagged from Node 22.5+.
// API mirrors better-sqlite3: db.prepare(sql).get/all/run(...params), synchronous.
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DB_PATH = process.env.DB_PATH || join(__dirname, '..', 'data.sqlite');

const firstRun = !existsSync(DB_PATH);

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');

db.exec(`
  CREATE TABLE IF NOT EXISTS zones (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    name             TEXT NOT NULL,
    type             TEXT NOT NULL CHECK (type IN ('red_card', 'elite', 'blue')),
    interval_minutes INTEGER,               -- nullable: blue zones have no reset interval
    last_reset_at    TEXT,                  -- ISO timestamp, null = never logged
    last_reset_by    TEXT,
    last_reset_note  TEXT,                  -- e.g. the raw Discord line a bot matched
    created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS users (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    username      TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    role          TEXT NOT NULL DEFAULT 'member',   -- member | admin
    display_name  TEXT,
    role_tag      TEXT,                             -- free text, e.g. "raid lead"
    tz            TEXT,                             -- IANA zone override, null = auto
    prefs         TEXT,                             -- JSON blob of personal settings
    created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id         TEXT PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS resets (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    zone_id    INTEGER NOT NULL REFERENCES zones(id) ON DELETE CASCADE,
    user_id    INTEGER REFERENCES users(id) ON DELETE SET NULL,
    by_name    TEXT,
    reset_at   TEXT NOT NULL,
    source     TEXT,                               -- web | discord | paste
    note       TEXT,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_resets_created ON resets(created_at DESC);
  CREATE INDEX IF NOT EXISTS idx_resets_user ON resets(user_id);

  CREATE TABLE IF NOT EXISTS board (
    id           INTEGER PRIMARY KEY CHECK (id = 1),
    name         TEXT NOT NULL DEFAULT 'Rift Timers',
    registration TEXT NOT NULL DEFAULT 'open',      -- open | invite
    invite_code  TEXT
  );
  INSERT OR IGNORE INTO board (id, name) VALUES (1, 'Rift Timers');

  CREATE TABLE IF NOT EXISTS meta (
    k TEXT PRIMARY KEY,
    v TEXT
  );

  CREATE TABLE IF NOT EXISTS push_subs (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id    INTEGER REFERENCES users(id) ON DELETE CASCADE,
    endpoint   TEXT NOT NULL UNIQUE,
    p256dh     TEXT NOT NULL,
    auth       TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  );
  CREATE INDEX IF NOT EXISTS idx_push_user ON push_subs(user_id);
`);

// migrate older databases
const addCol = (table, col) => {
  try {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${col}`);
  } catch {
    /* column already exists */
  }
};
['last_reset_note TEXT', 'claimed_by TEXT', 'claimed_at TEXT', 'note TEXT'].forEach((c) => addCol('zones', c));
['display_name TEXT', 'role_tag TEXT', 'tz TEXT', 'prefs TEXT'].forEach((c) => addCol('users', c));

export { firstRun, DB_PATH };
