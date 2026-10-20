/**
 * A person's own key builds only when they say so, and only through the
 * variable the agent CLI reads. Run: npx tsx scripts/test/build-engines.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { BUILD_ENGINES, buildEngineFor } from "../../src/config/build-engines";
import { VENDOR_IDS } from "../../src/config/model-vendors";
import { ENGINE_KEY_NAMES } from "../../src/lib/agent-execution/agent-env";
import { renderEnvFile } from "../../src/lib/tenant-engines-env";

const read = (p: string) => readFileSync(p, "utf8");

// Every build engine is a real vendor, and its variable passes the allowlist.
for (const e of BUILD_ENGINES) {
  assert.ok((VENDOR_IDS as readonly string[]).includes(e.vendor), `${e.vendor} is a vendor`);
  assert.ok(
    (ENGINE_KEY_NAMES as readonly string[]).includes(e.env),
    `${e.env} reaches an agent (agent-env.ts)`,
  );
}
assert.equal(buildEngineFor("anthropic")?.env, "ANTHROPIC_API_KEY");
assert.equal(buildEngineFor("openrouter"), null, "a router key powers chat only");
assert.equal(buildEngineFor("custom"), null);

// Off by default; a key never leaves through a route.
assert.match(
  read("src/db/schema/user-model-keys.ts"),
  /forBuilding: boolean\("for_building"\)\.notNull\(\)\.default\(false\)/,
);
const route = read("src/app/api/settings/model/route.ts");
assert.match(route, /z\.object\(\{ vendor: Vendor, forBuilding: z\.boolean\(\) \}\)/, "one switch");
assert.doesNotMatch(route, /listBuildEngineKeys/, "no route opens the keys");
const queries = read("src/db/queries/user-model-keys.ts");
assert.match(
  queries,
  /if \(!buildEngineFor\(vendor\)\) return null;/,
  "a chat-only vendor cannot be marked",
);
assert.match(queries, /const engine = row\.forBuilding \? buildEngineFor\(row\.vendor\) : null;/);

// The unit env file: the CLI's variable, quoted, nothing else.
assert.equal(renderEnvFile([]), "", "no keys, an empty file");
assert.equal(
  renderEnvFile([
    { env: "OPENAI_API_KEY", value: "sk-o" },
    { env: "ANTHROPIC_API_KEY", value: 'a"b\\c' },
  ]),
  'ANTHROPIC_API_KEY="a\\"b\\\\c"\nOPENAI_API_KEY="sk-o"\n',
);
// The box writes it as root and drain-restarts only the units that changed.
const reconcile = read("scripts/hetzner/reconcile-tenants.sh");
assert.match(reconcile, /write-tenant-engines\.ts/);
assert.match(reconcile, /drain-and-restart-runner\.sh" "loki-box-runner@\$\{short\}"/);
assert.match(
  read("scripts/hetzner/loki-box-runner@.service"),
  /^EnvironmentFile=-\/etc\/loki\/runners\/%i\.env$/m,
);

console.log("✓ build engines: your key, your switch, the CLI's own variable");
