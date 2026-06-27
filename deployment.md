# Deployment — Freedom Units on Proxmox

## Architecture overview

```
Internet
   │
   ▼
[Nginx Proxy Manager container]  — terminates TLS, routes by hostname
   │
   ├── static-site-1.domain.com  →  <container-ip>:80  (Nginx, unchanged)
   ├── static-site-2.domain.com  →  <container-ip>:80  (Nginx, unchanged)
   │
   └── freedom.domain.com        →  <container-ip>:8081 (Node.js, new)
```

The Node.js app runs alongside Nginx on the existing container. NPM routes the new hostname directly to port 8081 — Nginx never touches it and your existing static sites are unaffected.

---

## 1. Install Node.js ≥ 18 on the existing container

Open the container shell (Proxmox console or SSH).

```bash
apt update && apt upgrade -y
apt install -y curl

# NodeSource repo for Node 20 LTS
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs

node -v   # should print v20.x.x
```

---

## 2. Copy the app files to the container

From your Windows machine, use `scp` (or WinSCP / Filezilla).
Replace `<container-ip>` with the container's IP address.

```powershell
# Run from the project root on your Windows machine
scp -r public root@<container-ip>:/opt/freedom-conversion/
scp server/server.js server/rates.js server/package.json server/package-lock.json root@<container-ip>:/opt/freedom-conversion/server/
```

Or clone from git if the repo is hosted:

```bash
# On the container
git clone <your-repo-url> /opt/freedom-conversion
```

---

## 3. Install dependencies

```bash
cd /opt/freedom-conversion/server
npm ci --omit=dev
```

---

## 4. Create the environment file

```bash
cp /opt/freedom-conversion/server/.env.example /opt/freedom-conversion/server/.env
```

Edit `/opt/freedom-conversion/server/.env` if you want to change defaults:

```dotenv
PORT=8081
RATE_CACHE_TTL=3600
FRANKFURTER_BASE_URL=https://api.frankfurter.dev/v1
```

No API key is required — Frankfurter is free and keyless.

---

## 5. Create a systemd service

Create `/etc/systemd/system/freedom-units.service`:

```ini
[Unit]
Description=Freedom Units PWA
After=network.target

[Service]
Type=simple
User=nobody
WorkingDirectory=/opt/freedom-conversion/server
ExecStart=/usr/bin/node server.js
Restart=on-failure
RestartSec=5

# Harden
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Enable and start:

```bash
systemctl daemon-reload
systemctl enable --now freedom-units

# Verify it's running
systemctl status freedom-units
curl http://localhost:8081/healthz   # should return {"ok":true}
```

---

## 6. Open port 8081 (if UFW is active)

Check whether UFW is running:

```bash
ufw status
```

If active, allow NPM to reach the app:

```bash
ufw allow from <npm-container-ip> to any port 8081
```

If UFW is inactive, skip this — no change needed.

---

## 7. Configure Nginx Proxy Manager

In the NPM web UI (usually `http://<npm-container-ip>:81`):

1. Go to **Proxy Hosts → Add Proxy Host**.

2. **Details tab**

   | Field | Value |
   |---|---|
   | Domain Names | `freedom.yourdomain.com` |
   | Scheme | `http` |
   | Forward Hostname / IP | `<container-ip>` |
   | Forward Port | `8081` |
   | Cache Assets | Off |
   | Block Common Exploits | On |
   | Websockets Support | Off |

3. **SSL tab**

   | Field | Value |
   |---|---|
   | SSL Certificate | Request a new Let's Encrypt certificate |
   | Force SSL | On |
   | HTTP/2 Support | On |
   | HSTS Enabled | On (optional but recommended) |

4. Click **Save**. NPM requests the certificate automatically and begins proxying.

Test: open `https://freedom.yourdomain.com` in a browser. The PWA should load and `/api/rate` should return exchange rates. Your existing static sites are unaffected.

---

## Updating the app

```bash
# Re-scp the changed files, then:
systemctl restart freedom-units
```

## Logs

```bash
journalctl -u freedom-units -f
```

## Health check URL

```
https://freedom.yourdomain.com/healthz
```

Returns `{"ok":true}` when the server is up. Point an uptime monitor (e.g. Uptime Kuma) here.
