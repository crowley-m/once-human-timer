#!/usr/bin/env bash
# Pings the API; posts to Discord when it goes down and again when it recovers.
# Only alerts on a state change (no repeat spam). Run every 1-2 min via
# deploy/systemd/oh-health.{service,timer}.
set -uo pipefail

URL="${HEALTH_URL:-http://localhost:3010/api/board}"
STATE="${HEALTH_STATE:-/run/oh-health.down}"
ENV_FILE="${ENV_FILE:-/opt/rift-timer/server/.env}"
HOST="$(hostname)"

# alert webhook: ALERT_WEBHOOK env wins, else reuse a webhook from .env
HOOK="${ALERT_WEBHOOK:-}"
if [ -z "$HOOK" ] && [ -r "$ENV_FILE" ]; then
  HOOK="$(grep -m1 '^DISCORD_ALERT_WEBHOOK_URL=' "$ENV_FILE" | cut -d= -f2-)"
  [ -z "$HOOK" ] && HOOK="$(grep -m1 '^DISCORD_WEBHOOK_URL=' "$ENV_FILE" | cut -d= -f2-)"
fi

# $1 = plain message (no double quotes, please)
post() {
  [ -n "$HOOK" ] || return 0
  curl -fsS --max-time 10 -X POST "$HOOK" \
    -H 'content-type: application/json' \
    -d "{\"content\":\"$1\",\"allowed_mentions\":{\"parse\":[]}}" \
    >/dev/null 2>&1 || true
}

if curl -fsS --max-time 10 "$URL" >/dev/null 2>&1; then
  if [ -f "$STATE" ]; then
    rm -f "$STATE"
    post "✅ rift timer is back up ($HOST)"
  fi
  exit 0
fi

# unreachable
if [ ! -f "$STATE" ]; then
  : > "$STATE"
  post "🔴 rift timer is DOWN — $HOST cannot reach the API"
fi
exit 1
