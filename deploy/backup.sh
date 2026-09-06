#!/usr/bin/env bash
# Nightly SQLite backup. Writes a consistent gzipped snapshot and keeps the last 14.
#   manual:   bash deploy/backup.sh
#   schedule: deploy/systemd/oh-backup.{service,timer}  (see deploy/README)
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/rift-timer}"
NODE_BIN="${NODE_BIN:-/opt/node22/bin}"
SRC="${DB_PATH:-$APP_DIR/server/data.sqlite}"
DEST="${BACKUP_DIR:-$APP_DIR/backups}"
KEEP="${BACKUP_KEEP:-14}"

mkdir -p "$DEST"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DEST/data-$STAMP.sqlite"

# VACUUM INTO makes a clean copy even while the server is writing (WAL-safe).
"$NODE_BIN/node" "$(dirname "$0")/db-backup.mjs" "$SRC" "$OUT"
gzip -f "$OUT"
echo "backup -> $OUT.gz ($(du -h "$OUT.gz" | cut -f1))"

# prune old snapshots
ls -1t "$DEST"/data-*.sqlite.gz 2>/dev/null | tail -n +"$((KEEP + 1))" | xargs -r rm -f
