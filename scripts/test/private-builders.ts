/**
 * One private builder per account (docs/architecture/private-builders.md):
 * the flag grants cloud building and nothing of the fleet's; the tenant's
 * root, user and unit instance derive from one short id, in TypeScript and
 * in the box scripts alike; the unit is sealed. Pure: reads files.
 * Run: npx tsx scripts/test/private-builders.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decideQueuedExecution,
  isBoxRootedDir,
  isCloudBuilderAllowed,
  type ExecutionAccess,
} from "../../src/lib/execution-access";
import {
  TENANT_DEV_ROOT_RE,
  tenantDevRoot,
  tenantShortId,
} from "../../src/lib/agent-execution/box-workspace-path";

const read = (p: string) => readFileSync(p, "utf8");
const uid = "3f2a9c11-6b4d-4e8a-9c1f-0a1b2c3d4e5f";

// ─── The flag is the switch, and only for building ─────────────────────────
assert.equal(isCloudBuilderAllowed({ isDefault: false, privateBuilder: false }), false);
assert.equal(isCloudBuilderAllowed({ isDefault: false, privateBuilder: true }), true);
assert.equal(isCloudBuilderAllowed({ isDefault: true, privateBuilder: false }), true);
assert.equal(isCloudBuilderAllowed(null), false);
const access = (allowed: boolean): ExecutionAccess => ({
  userId: uid,
  cloudBuilderAllowed: allowed,
  presence: { cloud: true, local: false, any: true },
});
const tenant = decideQueuedExecution(access(true), { defaultChannel: "cloud" });
assert.ok(tenant.ok && tenant.channel === "cloud", "a private builder routes to the cloud");
const ea = read("src/lib/execution-access.ts");
assert.match(ea, /return !!user\?\.isDefault;\n\}/, "the fleet predicate is the founder alone");
assert.doesNotMatch(ea, /process\.env\.LOKI_CLOUD_BUILDER_USER_IDS/, "no environment allowlist");
for (const f of [
  "src/lib/kickoff/steps.ts",
  "src/app/api/projects/[id]/domain/route.ts",
  "src/lib/workspace-access.ts",
])
  assert.match(
    read(f),
    /isFleetInfrastructureAllowed/,
    `${f}: the fleet's powers stay the fleet's`,
  );
for (const f of ["src/app/api/control/route.ts", "src/app/api/builder/presence/route.ts"])
  assert.doesNotMatch(
    read(f),
    /cloudBuilderAllowed: !isRuntimeAvailable\(\)\s*\? await isFleetInfrastructureAllowed/,
    `${f}: the UI asks about building, not the fleet`,
  );

// ─── One short id, everywhere ───────────────────────────────────────────────
assert.equal(tenantShortId(uid), "3f2a9c11");
assert.equal(tenantDevRoot(uid), "/home/lk-3f2a9c11/dev");
assert.equal(
  isBoxRootedDir("/home/lk-3f2a9c11/dev/petvity"),
  true,
  "a tenant's clone is on the box",
);
assert.equal(TENANT_DEV_ROOT_RE.test("/home/lk-3f2a9c11/devil"), false);
const newTenant = read("scripts/hetzner/new-tenant.sh");
assert.match(newTenant, /SHORT="\$\{USER_ID:0:8\}"/, "the script derives the same short id");
assert.match(newTenant, /TENANT="lk-\$\{SHORT\}"/);
assert.match(newTenant, /UNIT="loki-box-runner@\$\{SHORT\}\.service"/);
assert.match(newTenant, /--user "\$USER_ID"/, "a token minted for that user, not the owner");
assert.match(newTenant, /PATH only; no secrets here/, "a clean shell for bash -lic");

// ─── The unit is sealed ─────────────────────────────────────────────────────
const unit = read("scripts/hetzner/loki-box-runner@.service");
for (const line of [
  "User=lk-%i",
  "ProtectSystem=strict",
  "ProtectHome=tmpfs",
  "BindPaths=/home/lk-%i",
  "NoNewPrivileges=true",
  "MemoryMax=3G",
  "OOMPolicy=continue",
  "Environment=LOKI_AGENT_ENV=allowlist",
  "Environment=LOKI_BOX_DEV_ROOT=/home/lk-%i/dev",
  "EnvironmentFile=-/etc/loki/runners/%i.env",
])
  assert.match(unit, new RegExp(`^${line.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "m"), line);
assert.doesNotMatch(unit, /DATABASE_URL|GITHUB_TOKEN|\/opt\/loki\/runner\/\.env$/m, "no secrets");
assert.match(
  unit,
  /InaccessiblePaths=.*-\/opt\/loki\/app .*-\/opt\/loki\/runner\/\.env/,
  "the app and the runner env are invisible",
);

// ─── The box reconciles the flag; the deploy carries the pieces ─────────────
const reconcile = read("scripts/hetzner/reconcile-tenants.sh");
assert.match(
  reconcile,
  /private_builder = true and is_default = false/,
  "the founder stays on the legacy unit",
);
assert.match(reconcile, /new-tenant\.sh/);
const deploy = read("scripts/deploy-hetzner.sh");
for (const f of [
  "new-tenant.sh",
  "reconcile-tenants.sh",
  "loki-box-runner@.service",
  "box-agent-claude.md",
])
  assert.ok(deploy.includes(`/scripts/hetzner/${f}`), `the deploy ships ${f} to the runner dir`);
assert.match(deploy, /install-tenant-reconcile\.sh/, "the deploy installs the timer");
assert.match(deploy, /loki-box-runner@\*/, "the deploy restarts every tenant unit");
const drain = read("scripts/hetzner/drain-and-restart-runner.sh");
assert.match(drain, /UNIT="\$\{1:-loki-box-runner\}"/, "the drain takes the unit");
assert.match(
  drain,
  /systemctl show -p ControlGroup/,
  "and finds its cgroup wherever systemd put it",
);

console.log("✓ private builders: the flag, one short id, a sealed unit, reconciled on the box");
