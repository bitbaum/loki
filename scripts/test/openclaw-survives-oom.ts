/**
 * One OOM kill must not take the OpenClaw gateway down for good.
 *
 * 2026-11-05 07:10 UTC: the box ran out of RAM and the kernel OOM-killed
 * openclaw-gateway and the openclaw user's dbus. systemd's default
 * OOMPolicy=stop then stopped user@1001.service, the user manager that is the
 * only thing restarting the gateway, so WhatsApp and the Telegram chat stayed
 * down for more than a day.
 *
 * This suite guards the fix: the drop-in sets OOMPolicy=continue, and every
 * deploy installs it without restarting anything.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
let passed = 0;

function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const DROPIN = "scripts/hetzner/openclaw-user-manager-oom.conf";

check("the drop-in sets OOMPolicy=continue in [Service]", () => {
  const conf = read(DROPIN);
  const service = conf.slice(conf.indexOf("[Service]"));
  assert(conf.includes("[Service]"), `${DROPIN} must have a [Service] section`);
  assert(/^OOMPolicy=continue$/m.test(service), `${DROPIN} must set OOMPolicy=continue`);
});

check("every deploy installs it for the openclaw user's manager, without a restart", () => {
  const deploy = read("scripts/deploy-hetzner.sh");
  const start = deploy.indexOf("openclaw-user-manager-oom.conf");
  assert(start > 0, "deploy-hetzner.sh must ship openclaw-user-manager-oom.conf");
  const block = deploy.slice(start, deploy.indexOf("\nesac", start));
  assert(
    /user@\\\$uid\.service\.d/.test(block),
    "the drop-in must land in user@<openclaw uid>.service.d",
  );
  assert(
    /systemctl daemon-reload/.test(block),
    "the deploy must daemon-reload after writing the drop-in",
  );
  assert(
    !/systemctl (re)?start|systemctl restart/.test(block),
    "the deploy must not (re)start the user manager",
  );
  assert(/the deploy continues/.test(block), "a failed install must warn, never fail the deploy");
});

console.log(`\n${passed} passed`);
