#!/usr/bin/env bash
# One-command deploy. Run from anywhere in the project:  bash deploy/push.sh
# Bundles the source (no node_modules / .env / db), ships it, rebuilds, restarts.
set -euo pipefail

VPS="${VPS:-root@147.189.172.101}"
APP_DIR="${APP_DIR:-/opt/rift-timer}"
NODE_BIN="${NODE_BIN:-/opt/node22/bin}"

cd "$(dirname "$0")/.."
TGZ="$(mktemp -u).tgz"

echo "==> packing"
tar --exclude=node_modules --exclude=.git --exclude="server/.env" --exclude="bot/.env" \
    --exclude="server/data.sqlite*" --exclude="client/dist" --exclude="*.log" --exclude="*.tgz" \
    -czf "$TGZ" .

echo "==> uploading to $VPS"
scp "$TGZ" "$VPS:/tmp/rift-timer.tgz"
rm -f "$TGZ"

echo "==> building + restarting on the VPS"
ssh "$VPS" "APP_DIR='$APP_DIR' NODE_BIN='$NODE_BIN' bash -s" <<'REMOTE'
set -e
tar -xzf /tmp/rift-timer.tgz -C "$APP_DIR"
chown -R oh:oh "$APP_DIR"
sudo -u oh env PATH="$NODE_BIN:$PATH" bash -c "
  cd '$APP_DIR/server' && npm ci --omit=dev &&
  cd '$APP_DIR/client' && npm ci && npm run build
"
# bot deps only if the bot is set up
[ -f "$APP_DIR/bot/.env" ] && sudo -u oh env PATH="$NODE_BIN:$PATH" bash -c "cd '$APP_DIR/bot' && npm ci --omit=dev" || true
systemctl restart oh-timer
systemctl is-enabled oh-poll.timer >/dev/null 2>&1 && systemctl restart oh-poll.timer || true
sleep 1
printf 'board: '; curl -s localhost:3010/api/board; echo
REMOTE

echo "==> done"
