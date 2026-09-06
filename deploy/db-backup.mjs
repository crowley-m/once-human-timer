// Writes a consistent copy of a SQLite DB (WAL-safe) via VACUUM INTO.
//   node deploy/db-backup.mjs <source.sqlite> <dest.sqlite>
import { DatabaseSync } from 'node:sqlite';

const [src, out] = process.argv.slice(2);
if (!src || !out) {
  console.error('usage: node db-backup.mjs <source.sqlite> <dest.sqlite>');
  process.exit(2);
}
const literal = "'" + out.replace(/'/g, "''") + "'";
const db = new DatabaseSync(src, { readOnly: true });
db.exec('VACUUM INTO ' + literal);
db.close();
