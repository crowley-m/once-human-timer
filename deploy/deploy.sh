#!/usr/bin/env bash
# Pull the latest code, rebuild, restart. Run on the VPS after `git push`.
#   cd /opt/rift-timer && deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

echo "==> pull"
git pull --ff-only

echo "==> server deps"
( cd server && npm ci --omit=dev )

echo "==> build client"
( cd client && npm ci && npm run build )

echo "==> bot deps"
( cd bot && npm ci --omit=dev )

echo "==> restart"
sudo systemctl restart oh-timer
sudo systemctl restart oh-poll.timer

echo "==> done. status:"
systemctl --no-pager status oh-timer | head -5
