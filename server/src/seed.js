import { db, DB_PATH } from './db.js';

// Reset intervals are stored per-row so the "stale" logic never hardcodes a type.
//   red_card -> 120 min   elite -> 60 min   blue -> 60 min
const SEED_ZONES = [
  // --- Red card rooms --------------------------------------------------
  { name: 'Gaia Research Center Ruins', type: 'red_card', interval_minutes: 120 },
  { name: 'Furnace Lair',               type: 'red_card', interval_minutes: 120 },
  { name: 'Forsaken Monolith',          type: 'red_card', interval_minutes: 120 },
  { name: 'Ricci Securement Point',     type: 'red_card', interval_minutes: 120 },

  // --- Elite enemy points --------------------------------------------
  { name: 'Blackfell Oil Fields',           type: 'elite', interval_minutes: 60 },
  { name: 'Forsaken Monolith — Elite',      type: 'elite', interval_minutes: 60 },
  { name: 'Fort Eyrie',                     type: 'elite', interval_minutes: 60 },
  { name: 'Alpha Institute',                type: 'elite', interval_minutes: 60 },
  { name: 'Furnace Lair — Elite (Pornis)',  type: 'elite', interval_minutes: 60 },
  { name: 'Railway Junction',               type: 'elite', interval_minutes: 60 },
  { name: 'Rotten Saddle',                  type: 'elite', interval_minutes: 60 },
  { name: 'Sunbury Middle School',          type: 'elite', interval_minutes: 60 },

  // --- Blue card rooms ---------------------------------------------------
  { name: 'Greywater Industrial Zone',        type: 'blue', interval_minutes: 60 },
  { name: 'Mirage Monolith Exclusion Zone',   type: 'blue', interval_minutes: 60 },
  { name: 'Blackfell Fallen Zone',            type: 'blue', interval_minutes: 60 },
  { name: 'Hearst Industries',                type: 'blue', interval_minutes: 60 },
  { name: 'Evergreen Vineyard',               type: 'blue', interval_minutes: 60 },
];

const force = process.argv.includes('--force');
const count = db.prepare('SELECT COUNT(*) AS n FROM zones').get().n;

if (count > 0 && !force) {
  console.log(`Skipping seed — zones table already has ${count} row(s). DB: ${DB_PATH}`);
  console.log('Run with --force to wipe zones (and their reset history) and re-seed the correct roster.');
  process.exit(0);
}

const insert = db.prepare('INSERT INTO zones (name, type, interval_minutes) VALUES (?, ?, ?)');

db.exec('BEGIN');
try {
  if (force && count > 0) {
    db.exec('DELETE FROM zones');
    try {
      db.exec("DELETE FROM sqlite_sequence WHERE name = 'zones'");
    } catch {
      /* no sqlite_sequence yet */
    }
    console.log('Wiped existing zones (and cascaded reset history).');
  }
  for (const z of SEED_ZONES) insert.run(z.name, z.type, z.interval_minutes);
  db.exec('COMMIT');
} catch (e) {
  db.exec('ROLLBACK');
  throw e;
}

console.log(`Seeded ${SEED_ZONES.length} zones into ${DB_PATH}`);
