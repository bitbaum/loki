# Connection-based runner presence

**Status:** rolling out (additive → cutover)
**Replaces:** the 5-minute `runtime-state` heartbeat + 8-minute offline threshold.

## Why

The web UI's "Fleet Runner online/offline" used to be inferred from the freshness
of a periodic `POST /api/control/runtime-state` heartbeat (every
`RUNNER_HEARTBEAT_MS` = 5 min; offline if older than ~8 min). Consequences:

- A healthy runner looked **offline for up to 8 minutes** after any restart.
- Presence was a *guess* derived from a timer, not a fact.

That is the legacy daemon-polling pattern. Presence should be a property of the
**live connection**, the way modern realtime systems do it.

## The model

The runner already holds a persistent SSE connection to the **bridge**
(`bridge/src/server.ts`, Hetzner). That connection *is* the presence signal:

```
runner connects to bridge (?client=runner)
   → bridge: runner_presence.connection_count++, connected=true   (instant)
runner's socket closes (quit / crash / network)
   → bridge: connection_count--, connected = count>0              (instant, <1s)
web /control reads runner_presence.connected                      (no timer)
```

- **Online = an open runner→bridge connection.** Not a heartbeat age.
- The browser also connects to the bridge, so the runner tags itself
  `?client=runner`; only runner connections move presence.
- Reconnect-safe via a connection **count** (multiple machines / brief overlaps).
- **Bridge boot resets all counts to 0** — a fresh bridge holds no connections,
  so any stale `connected=true` from a crash is cleared on the next deploy.

State (tab list, which agents are running) is pushed **on change only**
(`pushNow()` from the runner's watcher), never on a clock.

## Components

| Layer | Change |
|-------|--------|
| DB | new `runner_presence` table (`user_id` PK, `connection_count`, `connected`, `connected_at`, `last_change_at`) |
| Bridge | parse `?client`; on runner connect/disconnect, upsert `runner_presence`; reset counts to 0 on boot |
| Runner | `bridge-subscriber.ts` adds `?client=runner`; event-driven `pushNow` added. The heartbeat timer was NOT removed — `desktop/src/main/pusher.ts:369` still runs it, deliberately (see below) |
| Web | online = `runner_presence.connected` **AND** heartbeat-fresh. Shipped as OR, then deliberately inverted — see "Cutover: abandoned" |

## Rollout (no breakage)

1. **Migration** — add `runner_presence` (box DB). Inert until written.
2. **Bridge** — deploy presence accounting. Still no consumer; safe.
3. **Web** — online reads `connected OR heartbeat-fresh`. Both paths valid.
4. **Desktop** — rebuild + install runner with `?client=runner`. Now presence is live.
5. **Verify** — restart runner, confirm /control flips online in <2s.
6. ~~**Cutover** — drop the heartbeat `setInterval` in the runner and the
   heartbeat branch in the web online check. Presence is purely connection-based.~~

   **ABANDONED — do not do this.** Connection state alone is not evidence a
   builder can execute. A connection lost to a DB blip, or a half-open socket
   the bridge never sees close, pins `connected = true` until the bridge
   process restarts — so Control asserted "this computer online" for a laptop
   that had been shut for days.

   The shipped rule is the opposite of step 6: **AND, not OR**. Both the SSE
   connection and a fresh heartbeat must agree before a builder counts as
   online, because a runner posting snapshots while its SSE channel is down
   cannot receive dispatches either. `applyHeartbeatExpiry()` in
   `src/lib/builder-presence.ts` is the SSOT and carries the reasoning.

   Following step 6 as written would delete the expiry and reintroduce that
   bug. It is struck through rather than deleted so the decision stays legible:
   the plan was sound, reality disagreed, and the code won.

## Infra requirement: do NOT compress the bridge SSE (Caddy)

Disconnect detection depends on the proxy noticing the client socket died and
closing the upstream so the bridge's `req.on("close")` fires. **HTTP compression
buffers the SSE stream**, so the proxy never attempts the write that would reveal
the dead client — a crashed runner then shows "online" indefinitely.

The bridge's Caddy block (`bridge.orangecat.ch`, hand-managed in
`/etc/caddy/Caddyfile` on the box) must therefore NOT have `encode`:

```caddy
bridge.orangecat.ch {
  # No `encode` — compression buffers SSE and breaks client-disconnect detection.
  reverse_proxy 127.0.0.1:4001 {
    flush_interval -1   # flush each frame immediately
  }
}
```

Verified 2026-06-15: with `encode` present, disconnect took >5 min (never fired);
removed, disconnect flips presence in <3s while connect stays ~instant. The same
applies to any other SSE endpoint (e.g. the web `/control` stream on
`loki.orangecat.ch`) if its disconnect cleanup ever needs to be prompt.

## Verified behaviour (2026-06-15)

| Transition | Latency | (old heartbeat) |
|------------|---------|-----------------|
| runner launch → online | ~10s (runner boot) | up to instant-but-then-stale |
| runner quit/crash → offline | <3s | ~480s |
