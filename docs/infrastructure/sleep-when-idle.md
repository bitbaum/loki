# Sleep when idle

A site that is not live yet — a demo, a prospect, an unverified build — does
not keep a process running all day. systemd listens on its port, the first
visitor starts it (a second or two), and it stops again after 15 minutes with
no traffic. A live site is always on, so a real client's visitor never waits.

## Why

Every site on the box used to run around the clock with up to 1 GB of memory.
The box has 16 GB, which put its ceiling at roughly 50 sites however rarely
they were visited. Most early sites are visited rarely; sleeping lets the same
box hold hundreds, which is what a free tier for every builder needs.

## Which sites

Decided by the register (`scripts/hetzner/apps.conf`), not by a list:

- **Sleeps:** status `prospect`, `demo`, `validating` or `unverified`
  (`SLEEP_WHEN_IDLE_STATUSES` in `_box-env.sh`).
- **Always on:** `live` (clients and our products), `handed-over`, anything
  internal-only, and the handcrafted services on ports 4001–4004.

Changing a row's status to `live` and syncing it switches the site back to
always on and removes its wake units.

## How

For a sleeping site `<name>` on port `P`:

| Unit | Does |
| ---- | ---- |
| `<name>-wake.socket` | listens on `127.0.0.1:P` (where Caddy and the deploy health check already connect) |
| `<name>-wake.service` | `systemd-socket-proxyd --exit-idle-time=15min` to the app on `P + 20000`; requires the app, so the first connection boots it |
| `<name>-app.service` | the usual unit, plus `BindsTo=` the proxy (it stops when the proxy exits idle) and a readiness wait so the proxy never dials a closed port; not enabled at boot — the socket is |

Nothing outside the box changes: the Caddy vhost is the same, and a deploy's
`systemctl restart <name>-app` brings the proxy up with it, so the deploy's
health probe works unchanged.

Monitoring: the box watchdog checks a sleeping site's socket instead of
requesting it (a request every 5 minutes would keep it awake). The GitHub
uptime sweep, which runs every 15 minutes, probes a sleeping site's health
route on its first run of hours 00, 06, 12 and 18 UTC only, so a broken site is
still caught within hours — botsmann's unnoticed 503 is why that probe exists —
while the site sleeps the rest of the time. The daily certificate check covers
it as before; a TLS handshake reaches Caddy, not the app.

Generators and the rule: `scripts/hetzner/lib.sh` (sleep when idle section).
Applied by `sync-infra.sh`. Tested by `scripts/hetzner/test-sleep-when-idle.sh`.

## Applying it to sites already on the box

Actions → **Sync sites** → run with the register names, space-separated. It
re-applies `sync-infra.sh` to those sites and then requests each one, so a
sleeping site is woken once and must answer.
