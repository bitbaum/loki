/**
 * A deploy must end when the APP is live — not when an unrelated system is.
 *
 * The web app and the box-runner have opposite needs. The app wants to be live
 * immediately; the runner wants to not kill an agent mid-task. Both used to
 * share one job's wall-clock, and the runner won: measured on 2026-08-15, the
 * ship step spent 480 of its 570 seconds watching a single in-flight agent,
 * then restarted anyway. The app had been live and verified for eight of those
 * minutes. It was the most expensive thing in the whole pipeline and it bought
 * nothing — the cost of patience with the semantics of impatience.
 *
 * The fix is not a shorter timeout, which would only kill agents sooner. It is
 * moving the wait to the box, where waiting is free: the deploy schedules a
 * detached drain-then-restart and returns. This suite guards that the wait
 * cannot migrate back into the deploy, because it would look like a reasonable
 * thing to do again.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const deploy = readFileSync(join(root, "scripts/deploy-hetzner.sh"), "utf8");
const drainPath = join(root, "scripts/hetzner/drain-and-restart-runner.sh");
let passed = 0;

function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

check("the deploy does not wait for agents to drain", () => {
  // The signature of the old loop: sleeping in a loop while counting agent
  // processes. Any reintroduction reads like this, whatever it is named.
  const waits = /waiting to drain|drain_box_runner_agents|drain timed out/.test(deploy);
  assert(
    !waits,
    "deploy-hetzner.sh must not block on draining agents — schedule it on the box instead",
  );
});

check("the runner restart is scheduled detached, not run inline", () => {
  assert(
    /systemd-run/.test(deploy),
    "the runner restart must be detached via systemd-run so the deploy does not wait for it",
  );
});

check("the deferred restart script exists and is shipped before it is invoked", () => {
  assert(existsSync(drainPath), "scripts/hetzner/drain-and-restart-runner.sh must exist");
  const syncIdx = deploy.indexOf("drain-and-restart-runner.sh");
  const runIdx = deploy.indexOf("systemd-run");
  assert(syncIdx !== -1, "the drain script must be rsynced to the box");
  assert(
    syncIdx < runIdx,
    "the drain script must be synced BEFORE systemd-run invokes it, or the first deploy invokes a missing file",
  );
});

check("the deferred restart cannot be killed by the restart it performs", () => {
  const drain = readFileSync(drainPath, "utf8");
  // systemd-run puts it in its OWN unit; restarting loki-box-runner kills
  // that unit's cgroup, which must not contain this script.
  assert(
    /--unit=/.test(deploy),
    "the drain must run in its own systemd unit, not inside the box-runner's cgroup",
  );
  assert(/systemctl restart/.test(drain), "the drain script is what actually restarts the runner");
});

check("the drain still has a cap, so a wedged agent cannot freeze runner code forever", () => {
  const drain = readFileSync(drainPath, "utf8");
  assert(/MAX=/.test(drain) && /cap/.test(drain), "the box-side drain must remain bounded");
});

check("one OOM-killed child does not stop the runner and every agent in it", () => {
  // 2026-09-25 10:53: the kernel OOM-killed one chrome-headless inside the
  // runner's cgroup; systemd's default OOMPolicy=stop then stopped the whole
  // unit, killing every agent session (Skif, 13 minutes into a brief).
  const install = readFileSync(join(root, "scripts/hetzner/install-box-runner.sh"), "utf8");
  const service = install.slice(install.indexOf("[Service]"), install.indexOf("[Install]"));
  assert(service.length > 0, "install-box-runner.sh must write a [Service] section");
  assert(
    /^OOMPolicy=continue$/m.test(service),
    "the box-runner unit must set OOMPolicy=continue in [Service]",
  );
});

console.log(`\n${passed} passed`);
