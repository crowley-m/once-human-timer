# Deploying to a VPS (Ubuntu)

> **Live production setup for this project** (`147.189.172.101`, a shared v2ray box):
> isolated Node 22 in `/opt/node22`, app in `/opt/rift-timer` run by systemd unit
> `oh-timer` on port **3010**, nginx (already on :80) reverse-proxying
> `147.189.172.101.sslip.io` → HTTPS on **:8443** with a Let's Encrypt cert.
> The nginx site config (with the SSE block the live-updates stream needs) is at
> the bottom of this file under **"nginx config (production)"**. Update flow is
> under **"Updating later"**.

One Node process serves the API **and** the built React app. You only add a
reverse proxy for HTTPS.

Requirements on the box:

- Ubuntu 22.04 / 24.04
- **Node 22.5+** — the server uses the built-in `node:sqlite` module, which does
  not exist in Node 20. Node 22 or 24 only.
- A domain name with an `A` record pointing at the VPS IP (for HTTPS).

---

## 1. One-time server setup (as root)

```bash
# dedicated service user, app lives in its home
adduser --system --group --home /opt/rift-timer oh

apt update
apt install -y curl sqlite3 rsync

# Node 22 from NodeSource
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
apt install -y nodejs
node -v            # must print v22.x or v24.x

# Caddy (reverse proxy + auto HTTPS)
apt install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt update && apt install -y caddy
```

---

## 2. Get the code onto the box

You are not using git yet, so upload the folder directly.

### From your Windows machine (PowerShell, in the project root)

```powershell
# make a clean tarball — no node_modules, no local database, no build output
tar --exclude=node_modules --exclude=".git" `
    --exclude="server/data.sqlite*" --exclude="client/dist" `
    --exclude="server/server.log" `
    -czf rift-timer.tgz .

scp rift-timer.tgz root@YOUR_VPS_IP:/tmp/
```

### On the VPS (as root)

```bash
mkdir -p /opt/rift-timer
tar -xzf /tmp/rift-timer.tgz -C /opt/rift-timer
chown -R oh:oh /opt/rift-timer
```

(For future updates, either repeat this, or set up a private git repo — see
**Updating** at the bottom.)

---

## 3. Config

```bash
sudo -u oh cp /opt/rift-timer/server/.env.example /opt/rift-timer/server/.env
sudo -u oh nano /opt/rift-timer/server/.env
```

```ini
PORT=3001
SECURE_COOKIES=1          # REQUIRED — you are behind HTTPS via Caddy
API_KEY=                  # leave blank for now; set a long random string when you add the Discord bot
DISCORD_WEBHOOK_URL=      # optional — mirror resets/claims into a channel
```

Skip the `bot/.env` entirely for now — you are deploying without the Discord bot.

---

## 4. Build + seed (as the `oh` user)

```bash
sudo -u oh bash -c '
  set -e
  cd /opt/rift-timer/server && npm ci --omit=dev && npm run seed
  cd /opt/rift-timer/client && npm ci && npm run build
'
```

`npm run seed` creates `server/data.sqlite` with all the zones. Run it **once**.
Re-running is harmless (it inserts only missing zones) but never wipes data.

---

## 5. Run it as a service

```bash
cp /opt/rift-timer/deploy/oh-timer.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now oh-timer

systemctl status oh-timer --no-pager      # should be "active (running)"
curl -s localhost:3001/api/board          # should return JSON
```

Logs: `journalctl -u oh-timer -f`

> Ignore `oh-poll.service` / `oh-poll.timer` for now — those are only for the
> Discord poll. Add them later when you set up the bot.

---

## 6. HTTPS with Caddy

```bash
nano /opt/rift-timer/deploy/Caddyfile      # replace timers.example.com with your domain
cp /opt/rift-timer/deploy/Caddyfile /etc/caddy/Caddyfile
mkdir -p /var/log/caddy && chown caddy:caddy /var/log/caddy
systemctl reload caddy
```

Make sure ports 80 and 443 are open (UFW: `ufw allow 80,443/tcp`). Caddy
fetches and renews the TLS cert automatically. Visit `https://your-domain` —
you should see the login screen.

**The first account you register becomes the admin.** Register yours immediately.

---

## 7. Nightly backups

```bash
sudo -u oh crontab -e
# add:
15 4 * * *  /opt/rift-timer/deploy/backup.sh
```

Keeps 14 nightly gzipped SQLite snapshots in `/opt/rift-timer/backups/`.

---

## Updating later

**Manual (no git):** rebuild the tarball on Windows, `scp` it up, then:

```bash
tar -xzf /tmp/rift-timer.tgz -C /opt/rift-timer         # overwrites source, keeps data.sqlite
chown -R oh:oh /opt/rift-timer
sudo -u oh bash -c 'cd /opt/rift-timer/server && npm ci --omit=dev && cd ../client && npm ci && npm run build'
systemctl restart oh-timer
```

**With git (recommended once you have a private repo):** push from Windows,
then on the VPS `cd /opt/rift-timer && sudo -u oh deploy/deploy.sh`.

---

## Troubleshooting

| Symptom | Check |
|---|---|
| `oh-timer` won't start, `SyntaxError` / `node:sqlite` | Node is < 22.5 — `node -v`, reinstall Node 22 |
| Login works then immediately logged out | `SECURE_COOKIES=1` missing, or you're on `http://` not `https://` |
| 502 from Caddy | `systemctl status oh-timer`; is it listening on 3001? |
| Cert won't issue | DNS `A` record not pointing at the box yet, or port 80 blocked |
| Forgot admin password | `sqlite3 /opt/rift-timer/server/data.sqlite "DELETE FROM users WHERE username='you';"` then re-register (first user is admin only if the table is empty — otherwise promote via `UPDATE users SET role='admin' WHERE username='you';`) |

---

## nginx config (production)

`/etc/nginx/sites-available/rift-timer` — the `location /api/stream` block is
**required** for live updates (Server-Sent Events); without it nginx buffers the
stream and clients never see pushes.

```nginx
server {
    listen 80;
    server_name 147.189.172.101.sslip.io;
    location /.well-known/acme-challenge/ { root /var/www/acme; }
    location / { return 301 https://$host:8443$request_uri; }
}

server {
    listen 8443 ssl http2;
    server_name 147.189.172.101.sslip.io;

    ssl_certificate     /etc/letsencrypt/live/147.189.172.101.sslip.io/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/147.189.172.101.sslip.io/privkey.pem;

    # SSE live-updates stream — no buffering, long-lived
    location = /api/stream {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header Connection '';
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 3600s;
        chunked_transfer_encoding off;
    }

    location / {
        proxy_pass http://127.0.0.1:3010;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_cache_bypass $http_upgrade;
    }
}
```

After editing: `nginx -t && systemctl reload nginx`.
Test the stream: `curl -N https://147.189.172.101.sslip.io:8443/api/stream` — you
should see `retry: 3000` immediately and `: ping` lines every 25s.

## Updating later

On Windows, in the project root:

```powershell
tar --exclude=node_modules --exclude=.git --exclude="server/.env" --exclude="server/data.sqlite*" --exclude="client/dist" --exclude="*.log" --exclude="*.tgz" -czf "$HOME\Desktop\rift-timer.tgz" .
scp "$HOME\Desktop\rift-timer.tgz" root@147.189.172.101:/tmp/
```

> **`server/.env` MUST be excluded** — otherwise a local dev `.env` overwrites the
> VPS one (wrong `PORT`, missing `SECURE_COOKIES`) and you get a 502.

On the VPS:

```bash
tar -xzf /tmp/rift-timer.tgz -C /opt/rift-timer
chown -R oh:oh /opt/rift-timer
sudo -u oh env PATH="/opt/node22/bin:$PATH" bash -c '
  cd /opt/rift-timer/server && npm ci --omit=dev &&
  cd /opt/rift-timer/client && npm ci && npm run build
'
systemctl restart oh-timer
```

`data.sqlite` and `server/.env` are never in the tarball, so accounts, logged
resets, the board config, and the VAPID push keypair all survive every update.

- **Zone roster reset** (once, or whenever the seed list changes): `sudo -u oh env PATH="/opt/node22/bin:$PATH" bash -c 'cd /opt/rift-timer/server && npm run reseed'` — wipes zones + their reset history and re-seeds the correct list.
- **Web-push**: no config needed. The server auto-generates a VAPID keypair on first
  boot and stores it in the `meta` table. `web-push` is a normal npm dependency
  (pure JS) pulled in by `npm ci`.

## Nightly DB backup

`deploy/backup.sh` writes a gzipped `VACUUM INTO` snapshot to `/opt/rift-timer/backups/`
(WAL-safe, keeps the last 14). Install the timer once:

```bash
cp /opt/rift-timer/deploy/oh-backup.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now oh-backup.timer
systemctl start oh-backup.service        # run one now
ls -la /opt/rift-timer/backups/
```

Restore: `gunzip -c backups/data-YYYYMMDD-HHMMSS.sqlite.gz > server/data.sqlite`
(stop `oh-timer` first, remove `data.sqlite-wal`/`-shm`, then start it).

## "Server down" alert

`deploy/healthcheck.sh` pings `localhost:3010/api/board` and posts to Discord on a
down→up transition (no repeat spam). It reuses `DISCORD_WEBHOOK_URL` from
`server/.env`, or set `DISCORD_ALERT_WEBHOOK_URL=` there for a separate channel.

```bash
cp /opt/rift-timer/deploy/oh-health.{service,timer} /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now oh-health.timer
```
