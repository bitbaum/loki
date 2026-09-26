/**
 * A site's deploy.yml must let the shared deploy read the site's CI.
 *
 * selfhost-deploy.yml refuses a commit whose CI is red by reading that
 * commit's workflow runs with the job token. The bitbaum org's default token
 * is read-only on contents, and a PRIVATE repo's Actions runs are not public,
 * so the call was refused on every deploy, the gate read the refusal as a
 * network blip and passed: no private site was ever gated on CI (farmhouse,
 * probe-loop2, 2026-09-26). A called workflow cannot grant itself more than
 * its caller, so the grant lives in the shim — which Loki writes in two places.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deployWorkflowYaml } from "../../src/lib/site-cd";

const fromTs = deployWorkflowYaml("probe");
assert.match(
  fromTs,
  /^permissions:\n {2}contents: read\n {2}actions: read$/m,
  "Loki's shim grants actions: read",
);

const sh = readFileSync("scripts/hetzner/register-site.sh", "utf8");
const heredoc = sh.slice(sh.indexOf('cat > "$WF_TMP/deploy.yml" <<YML'), sh.indexOf("\nYML\n"));
assert.match(
  heredoc,
  /^permissions:\n {2}contents: read\n {2}actions: read$/m,
  "register-site.sh's shim grants it too",
);

// Existing sites heal on their next registration: a shim without the grant is rewritten.
const reg = readFileSync("src/lib/site-cd-register.ts", "utf8");
assert.match(
  reg,
  /const blindGate = !raw\.includes\("actions: read"\) && yaml\.includes\("actions: read"\)/,
);
assert.match(reg, /if \(legacySecrets \|\| blindGate\)/);

// And the gate says so when it cannot read CI, instead of calling it the network.
const gate = readFileSync("scripts/hetzner/ci-gate.sh", "utf8");
assert.match(gate, /this deploy is NOT gated on CI/);

console.log("deploy-shim-can-read-ci: ok");
