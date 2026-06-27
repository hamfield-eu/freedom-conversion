# Freedom Units 🇺🇸 → 🌍

An installable iOS home-screen web app (PWA) that converts the "freedom units" you
run into on holiday in the USA — fl oz, mph, °F, gallons, pounds, mpg, miles, etc.
to metric, plus **currency conversion** using the free, keyless
[**Frankfurter**](https://frankfurter.dev) exchange-rate API (European Central Bank
reference rates).

- **Unit conversions** run entirely in the browser and work **offline**.
- **Currency** is fetched from Frankfurter via a tiny Node backend (no API key needed).
- **Multi-currency picker**: USD, EUR, GBP, CAD, CNY (RMB), MXN — pick either side.
- **Card markup %**: enter your card's foreign-transaction / FX markup and it's
  folded into the displayed rate (applied client-side, so it updates instantly).
- **Refresh is capped to once per hour per currency pair** server-side. Frankfurter's
  ECB rates only update once per working day, so this keeps the app a polite API
  citizen. Your selections and markup are remembered between visits (localStorage).
- **Beer price check 🍺**: pick a US beer size + price, optionally add your state's
  sales tax, and see the EUR price normalized to a Dutch *vaasje* (250 ml, default
  €3.60). State sales tax can be filled automatically with **"Use my location"**,
  which resolves your GPS position to a state **entirely offline** via bundled
  boundary polygons (no third-party geocoding); unknown/denied falls back to 0%.

## Why a backend (and not pure static / not PHP)

The Node backend isn't strictly required to *reach* Frankfurter, but it earns its
keep: it serves the PWA and proxies the rate lookups from a single origin, holds a
**shared in-memory cache** so all users share one daily lookup per currency pair, and
enforces the **once-per-hour refresh cap**. It's **Node.js + Express** (no PHP), and
the same process serves the static PWA — so Nginx Proxy Manager only needs to proxy
**one** upstream.

## Project layout

```
freedom-conversion/
├── public/            # the PWA (static; served by the Node server)
│   ├── index.html
│   ├── app.js         # all unit conversion logic + currency UI
│   ├── styles.css
│   ├── manifest.webmanifest
│   ├── sw.js          # service worker (offline app shell)
│   ├── icons/         # app icons
│   └── data/          # bundled US state polygons (offline geolocation)
├── server/
│   ├── server.js      # Express: serves PWA + GET /api/rate (cache + refresh cap)
│   ├── rates.js       # Frankfurter exchange-rate lookup
│   ├── .env.example   # optional config (no secrets needed)
│   └── package.json
├── scripts/
│   ├── gen-icons.mjs    # generate the default icons (dependency-free)
│   ├── resize-icons.mjs # derive smaller icons from icon-512.png
│   └── build-states.mjs # rebuild public/data/us-states.geojson
└── deploy/freedom-conversion.service  # systemd unit
```

## Configuration

No API key is required. Everything has sensible defaults; you only need a `.env` if
you want to change the port or cache time:

```ini
PORT=8081
RATE_CACHE_TTL=3600                              # seconds to cache a rate
FRANKFURTER_BASE_URL=https://api.frankfurter.dev/v1
```

## Run locally

```bash
cd server
npm install
npm start          # -> http://localhost:8081
```

Open `http://localhost:8081`. Unit conversions and currency both work immediately.

## Deploy on your Proxmox / Ubuntu + Nginx Proxy Manager setup

You already have an Ubuntu LXC running Nginx for your sites and a separate Nginx Proxy
Manager (NPM) container handling SSL. Run this Node app on the web container (or a
fresh small LXC) and let NPM proxy a subdomain to it.

**1. Install Node 18+ on the container** (if not present):

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

**2. Copy the app to the container** (e.g. `/opt/freedom-conversion`), then:

```bash
cd /opt/freedom-conversion/server
npm ci --omit=dev          # or: npm install --omit=dev
# optional: cp .env.example .env && nano .env
```

**3. Create a service user and install the systemd unit:**

```bash
sudo adduser --system --group freedom
sudo chown -R freedom:freedom /opt/freedom-conversion
sudo cp /opt/freedom-conversion/deploy/freedom-conversion.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now freedom-conversion
sudo systemctl status freedom-conversion        # confirm it's running on :8081
curl -s http://localhost:8081/healthz           # -> {"ok":true}
```

The Node host must have outbound HTTPS access to `api.frankfurter.dev`.

**4. Add a Proxy Host in Nginx Proxy Manager:**

- **Domain Names:** e.g. `freedom.yourdomain.com`
- **Scheme:** `http`
- **Forward Hostname / IP:** the container's IP running this app
- **Forward Port:** `8081`
- **Block Common Exploits:** on · **Websockets:** not required
- **SSL tab:** request a new Let's Encrypt certificate + **Force SSL** + HTTP/2

HTTPS is required for "Add to Home Screen" / service workers, which NPM's certificate
provides automatically.

## Install on iOS (full-screen home-screen app)

1. Open `https://freedom.yourdomain.com` in **Safari**.
2. Tap the **Share** button → **Add to Home Screen** → **Add**.
3. Launch it from the home screen — it opens **full screen** (no Safari chrome),
   respects the notch/home-indicator safe areas, and works offline for unit
   conversions.

## Icons

`public/icons/` holds the PNG app icons. To regenerate the default design run
`node scripts/gen-icons.mjs`; if you drop in your own `icon-512.png`, run
`node scripts/resize-icons.mjs` to derive the smaller sizes. Bump the `CACHE`
version in `public/sw.js` afterwards so installed apps pick up the change.

## API reference

This app calls Frankfurter's `GET /v1/latest?base={from}&symbols={to}` and reads
`rates[to]` from the response (`{ amount, base, date, rates: { … } }`). No
authentication. Docs: https://frankfurter.dev
