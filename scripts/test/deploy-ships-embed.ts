/**
 * A fix to the embeddings server must reach the box on the next deploy.
 *
 * On 2026-11-06 the 03:30 reindex drove loki-embed to 2GB and swapped six other
 * apps' crons into Postgres timeouts. The fix (#1594: serialized inference +
 * MemoryHigh/MemoryMax) merged within the hour — and changed nothing on the
 * box, because server.py and the unit were written only by
 * install-fleet-rag.sh, which needs a laptop's ssh key. The unit lived as a
 * heredoc inside that installer, so the deploy had nothing it could ship.
 *
 * This suite guards both halves: the unit is a file, and the deploy syncs it.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..", "..");
const read = (p: string) => readFileSync(join(root, p), "utf8");
const deploy = read("scripts/deploy-hetzner.sh");
const installer = read("scripts/hetzner/install-fleet-rag.sh");
const UNIT = "scripts/hetzner/loki-embed.service";
let passed = 0;

function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

check("the loki-embed unit is a file in the repo, memory-bounded", () => {
  assert(existsSync(join(root, UNIT)), `${UNIT} is missing`);
  const unit = read(UNIT);
  assert(/^MemoryMax=/m.test(unit), `${UNIT} lost its MemoryMax bound`);
});

check("the installer copies the unit file instead of inlining one", () => {
  assert(installer.includes(UNIT), "install-fleet-rag.sh does not install " + UNIT);
  assert(
    !/cat > \/etc\/systemd\/system\/loki-embed\.service/.test(installer),
    "install-fleet-rag.sh writes loki-embed.service from a heredoc again — the deploy cannot ship that",
  );
});

check("every deploy syncs the embed server and its unit", () => {
  assert(
    deploy.includes("scripts/embed-server.py"),
    "deploy-hetzner.sh does not sync embed-server.py",
  );
  assert(deploy.includes(UNIT), `deploy-hetzner.sh does not sync ${UNIT}`);
  assert(
    /systemctl restart loki-embed/.test(deploy),
    "deploy-hetzner.sh never restarts loki-embed",
  );
});

console.log(`deploy-ships-embed: ${passed} passed`);
