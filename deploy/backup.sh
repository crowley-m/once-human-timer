#!/usr/bin/env bash
# Nightly SQLite backup. Add to crontab (as user oh):
#   15 4 * * *  /opt/rift-timer/deploy/backup.sh
set -euo pipefail

DB=/opt/rift-timer/server/data.sqlite
DIR=/opt/rift-timer/backups
KEEP=14

mkdir -p "$DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
# online, consistent copy
sqlite3 "$DB" ".backup '$DIR/data-$STAMP.sqlite'"
gzip -f "$DIR/data-$STAMP.sqlite"

# prune
ls -1t "$DIR"/data-*.sqlite.gz | tail -n +$((KEEP + 1)) | xargs -r rm --
echo "backed up -> $DIR/data-$STAMP.sqlite.gz"
