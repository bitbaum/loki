/**
 * Headless Loki box-runner.
 *
 * The desktop Fleet Runner's core — poller (drains pending_commands), pusher
 * (runtime-state heartbeat), bridge subscriber (fast-path wake + presence), and
 * owned PTYs (LocalPtyExecutor) — running as a systemd service on the always-on
 * box, with NO Electron, window, or tray. This is the piece that deletes the
 * "laptop must be on" dependency: dispatches execute server-side in
 * Loki-owned PTYs, presence stays online via the bridge SSE connection,
 * and it survives web-app deploys because it is its own service.
 *
 * It reuses the EXACT desktop modules (desktop/src/main/{poller,pusher,...}) —
 * that core is already Electron-free (pusher's lone app.getVersion() was lifted
 * to LOKI_RUNNER_VERSION). Same control-plane contract as the desktop:
 * HTTP + a ck_ runner token, no direct DB. Run via tsx from
 * /opt/loki/runner. See docs/architecture/box-owned-pty-executor.md.
 */
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import {
  startPoller,
  stopPoller,
  onPollerStatus,
  formatTrayTooltip,
} from "../desktop/src/main/poller";
import { pushNow, startPusher, stopPusher } from "../desktop/src/main/pusher";
import { loadToken } from "../desktop/src/main/token-store";
import { APP_URL } from "@/config/brand";
import { startWatcher } from "../home/watcher";

/**
 * Version comes from the deployed code itself (desktop/package.json — the
 * modules this runner actually executes), never from a hand-maintained env.
 * The systemd unit pinned LOKI_RUNNER_VERSION=box-0.8.9 and nobody
 * bumped it across three releases, so Settings showed a version the box was
 * not running. Env stays as fallback only for the odd manual invocation.
 */
function boxRunnerVersion(): string {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "desktop", "package.json");
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { version?: string };
    if (pkg.version) return `box-${pkg.version}`;
  } catch {
    /* fall through to env */
  }
  return process.env.LOKI_RUNNER_VERSION ?? "box";
}

const VERSION = boxRunnerVersion();
// The pusher reports whatever this env holds (lazily) — publish the derived
// version so the heartbeat and Settings agree with the log line below.
process.env.LOKI_RUNNER_VERSION = VERSION;
// Bridge presence must register as cloud. The systemd unit sets this too, but
// deploy syncs code without rewriting the unit — if the env is missing, a
// default of "local" in bridge-subscriber made /terminal say the cloud builder
// was offline while this process was the one shipping the work.
if (!process.env.LOKI_RUNNER_PRESENCE_CHANNEL?.trim()) {
  process.env.LOKI_RUNNER_PRESENCE_CHANNEL = "cloud";
}
const WEB = (process.env.LOKI_WEB_URL || "").trim() || APP_URL;

function log(msg: string): void {
  // journald captures stdout; keep a stable prefix for `journalctl -u`.
  console.log(`[box-runner] ${msg}`);
}

function main(): void {
  const token = loadToken();
  if (!token) {
    console.error(
      "[box-runner] no runner token at ~/.config/loki/fleet-runner-token — cannot authenticate. Exiting.",
    );
    process.exit(1);
  }
  log(`v${VERSION} → ${WEB} (token ${token.slice(0, 9)}…)`);

  // The desktop refreshes a tray tooltip from every poller status event
  // (~every 2s). Headless, that verbatim stream wrote "connected · last poll
  // 0s ago" to journald 40k times a day. Log only when the STATE changes
  // (ignoring the volatile "last poll Ns ago" segment), plus a 15-minute
  // liveness heartbeat so a quiet journal still proves the runner is alive.
  let lastStatusLine = "";
  let lastHeartbeatMs = 0;
  onPollerStatus((s) => {
    const line = formatTrayTooltip(s);
    const stable = line.replace(/ · last poll \d+s ago/, "");
    const now = Date.now();
    if (stable !== lastStatusLine || now - lastHeartbeatMs > 15 * 60 * 1000) {
      lastStatusLine = stable;
      lastHeartbeatMs = now;
      log(line);
    }
  });

  // Unlike the desktop, the box has no static projects.conf: its projects are
  // cloned on demand. Watch every Loki-owned handoff and push immediately
  // so a completed run never waits for the five-minute liveness heartbeat.
  const watcher = startWatcher({
    acceptUnregistered: true,
    onIdle: () => {
      void pushNow();
    },
  });

  // Poller starts the bridge subscriber (presence + fast-path wake) itself; the
  // pusher publishes runtime state and the watcher pushes completion handoffs.
  startPoller();
  startPusher();
  log("poller + pusher started; presence via bridge SSE");

  let shuttingDown = false;
  const shutdown = (sig: string): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    log(`${sig} → draining`);
    try {
      stopPoller();
    } catch {
      /* best-effort */
    }
    try {
      stopPusher();
    } catch {
      /* best-effort */
    }
    try {
      watcher.close();
    } catch {
      /* best-effort */
    }
    // Let in-flight stop work settle, then exit so systemd sees a clean stop.
    setTimeout(() => process.exit(0), 300);
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Nothing else holds the event loop open (poller/pusher run on timers), so
  // keep the process alive explicitly until a signal arrives.
  setInterval(() => {
    /* keep-alive */
  }, 1 << 30);
}

main();
