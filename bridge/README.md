# Loki event bridge

A ~300-line Node service that takes Postgres `NOTIFY` events on the `fc:state`
channel and fans them out to subscribed browsers, desktop apps, and phones
over Server-Sent Events. The piece that lets v0.6 replace polling with push.

## What runs where

```
                                         ┌───────────────────┐
                                         │  this service     │
   Browser ─────── /sse?token=ck_* ──────┤  (bridge/)        │
                                         │                   │
   Fleet Runner ── /sse?token=ck_* ──────┤   one HTTP+SSE    │
                                         │   server, one     │
                                         │   pg LISTEN       │
                                         │                   │
                                         └────────┬──────────┘
                                                  │ LISTEN "fc:state"
                                                  ↓
                                         ┌───────────────────┐
                                         │   Postgres        │
                                         │   triggers in     │
                                         │   drizzle/0022    │
                                         └───────────────────┘
                                                  ↑
                                                  │ INSERT/UPDATE/DELETE
                                         ┌────────┴──────────┐
                                         │   Hosted API      │
                                         │   /api/control,   │
                                         │   /api/control/   │
                                         │   runtime-state,  │
                                         │   etc.            │
                                         └───────────────────┘
```

Read the architectural narrative in
[/thoughts/from-polling-to-listening-loki-v0-6](../content/thoughts/from-polling-to-listening-loki-v0-6.md)
for the why.

## Run locally

```bash
cd bridge
cp .env.example .env
# edit .env — point DATABASE_URL at the same db that has the v0.6 triggers
npm install
npm run dev      # tsx — fast iteration
# or
npm run build && npm start
```

Health: `curl http://localhost:4001/healthz` → `{ok:true, users, connections, eventLogSize}`

SSE: `curl -N "http://localhost:4001/sse?token=ck_..."` (replace with a real
ck_* token from your `agent_tokens` table). Watch as `event: change`
frames arrive whenever a row owned by that user changes.

## Auth model

Tokens are looked up in the same `agent_tokens` table the cloud API uses.
Plaintext lookup (matches the existing scheme; see `src/db/queries/agent-tokens.ts`).
The token is passed as `?token=ck_...` in the SSE URL because EventSource
does not let JavaScript set custom request headers. Mitigated by HTTPS-only
deploy + scrubbing query strings from access logs.

## Last-Event-ID replay

Clients that disconnect briefly (sleep, wifi drop, deploy) reconnect with
`Last-Event-ID: <last_id>` in their headers. The bridge replays any
buffered events with a higher id, filtered to the user's scope. Buffer
size is 1000 events — anything older requires a full re-fetch from the
cloud snapshot endpoint.

## Deploy (Oracle / Hetzner)

The bridge lives on the same box as Postgres. Both processes plus a small
backup cron fit comfortably on Oracle Always Free or a Hetzner CX22.
See `scripts/db/BOTH_PRODUCTS_ONE_HOST.md` for the host setup. Once Postgres is up:

```bash
# On the box
git clone git@github.com:bitbaum/loki.git /opt/loki
cd /opt/loki/bridge
npm ci
npm run build

# /etc/systemd/system/loki-bridge.service
sudo tee /etc/systemd/system/loki-bridge.service <<'UNIT'
[Unit]
Description=Loki event bridge (Postgres LISTEN → SSE)
After=postgresql.service network-online.target
Wants=network-online.target

[Service]
Type=simple
User=loki
WorkingDirectory=/opt/loki/bridge
EnvironmentFile=/opt/loki/bridge/.env
ExecStart=/usr/bin/node /opt/loki/bridge/dist/server.js
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT

sudo systemctl daemon-reload
sudo systemctl enable --now loki-bridge
sudo journalctl -u loki-bridge -f
```

Then reverse-proxy 443 → 4001 via Caddy with a TLS cert (this is how the
`bitbaum` box runs it today, as `loki-bridge.service` behind
`bridge.orangecat.ch`). Point the web app's `LOKI_BRIDGE_URL` env at
`https://your-host/sse` and the web client will subscribe instead of polling.

## Connection limits

Default Linux file descriptor limit (1024) caps connections per process.
Bump in the systemd unit before going to scale:

```
[Service]
LimitNOFILE=65536
```

One process easily handles ~50,000 concurrent SSE connections on the
Oracle Free shape (4 OCPU / 24 GB). Past that, run multiple bridge
processes behind a load balancer; they share state via the Postgres
LISTEN channel automatically (NOTIFY fans out to every LISTEN'er).
