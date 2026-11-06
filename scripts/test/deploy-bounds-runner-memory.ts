/**
 * The box-runner's memory bound must exist, and must reach the box on deploy.
 *
 * On 2026-11-06 09:38-09:43 sixteen idle sealed-build agent tabs held 6.7GB in
 * loki-box-runner (peak 8.2GB) on a 15.6GB box with full swap. gVisor keeps
 * each sandbox in the unit's cgroup with no per-container limit, and the unit
 * had MemoryMax=infinity — so the kernel's GLOBAL OOM killer chose evig's
 * next-server, LanguageTool and user@1000.service instead of an agent.
 *
 * Same shape as deploy-ships-embed.ts: the bound is a file, the installer
 * copies it, and every deploy re-syncs it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const deploy = read("scripts/deploy-hetzner.sh");
const installer = read("scripts/hetzner/install-box-runner.sh");
const DROPIN = "scripts/hetzner/loki-box-runner-memory.conf";
let passed = 0;

function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

check("the box-runner memory drop-in is a file in the repo, bounded", () => {
  assert(existsSync(join(root, DROPIN)), `${DROPIN} is missing`);
  const conf = read(DROPIN);
  assert(/^\[Service\]$/m.test(conf), `${DROPIN} has no [Service] section`);
  assert(/^MemoryMax=\d+[KMG]$/m.test(conf), `${DROPIN} lost its MemoryMax bound`);
  assert(/^MemoryHigh=\d+[KMG]$/m.test(conf), `${DROPIN} lost its MemoryHigh throttle`);
});

check("the installer copies the drop-in", () => {
  assert(installer.includes(DROPIN), `install-box-runner.sh does not install ${DROPIN}`);
});

check("every deploy syncs the drop-in and reloads systemd without restarting the runner", () => {
  assert(deploy.includes(DROPIN), `deploy-hetzner.sh does not sync ${DROPIN}`);
  const block = deploy.slice(deploy.indexOf(DROPIN), deploy.indexOf(DROPIN) + 1200);
  assert(/systemctl daemon-reload/.test(block), "the drop-in sync never daemon-reloads");
  assert(
    !/systemctl restart loki-box-runner/.test(block),
    "the drop-in sync restarts loki-box-runner — that kills every agent session",
  );
});

console.log(`deploy-bounds-runner-memory: ${passed} passed`);
