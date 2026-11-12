/**
 * The box-side "does Loki work" check signs in the way a runner does.
 *
 * It minted an Auth.js session cookie. Sign-in moved to AccountKit on
 * 2026-11-01, the cookie stopped being a session, and for eleven days the
 * check answered "could not mint a session on the box" and asked Loki
 * nothing; run on demand on 2026-11-12 it said the same and the job was
 * green. Pinned here: an agent token first, removed afterwards, a reason
 * when it cannot sign in, and a red exit for a caller that asked for one.
 *
 * Run: npx tsx scripts/test/loop-check-signs-in.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const check = readFileSync("scripts/hetzner/loki-e2e-check.sh", "utf8");
const mint = readFileSync("scripts/test/mint-check-token.ts", "utf8");
const loop = readFileSync("scripts/test/loki-loop-e2e.ts", "utf8");
const workflow = readFileSync(".github/workflows/loki-loop-check.yml", "utf8");

// The check asks for an agent token first and hands it to the test.
assert.match(
  check,
  /agent=\$\(env DATABASE_URL="\$DBURL" node_modules\/\.bin\/tsx scripts\/test\/mint-check-token\.ts/,
);
assert.match(check, /LOKI_AGENT_TOKEN="\$agent"/, "the test is given the agent token");
assert.match(loop, /authorization: `Bearer \$\{agentToken\}`/, "and signs in with it as a bearer");

// It is removed when the check ends, however it ends, and expires by itself.
assert.match(check, /trap '.*mint-check-token\.ts --revoke.*' EXIT/, "revoked on exit");
assert.match(mint, /DELETE FROM agent_tokens WHERE label = \$\{CHECK_TOKEN_LABEL\}/);
assert.match(mint, /expires_at/, "a token a killed check left behind is not a standing credential");
assert.doesNotMatch(mint, /console\.log\(/, "nothing is printed but the token");

// A check that could not ask says why and is not green.
assert.match(check, /could not sign in on the box\$\{reason:\+ — \$reason\}/, "the reason is said");
assert.match(
  check,
  /echo "down: \$msg"\s*\n\s*#[^\n]*\n\s*\[ "\$\{E2E_EXIT_VERDICT:-\}" = 1 \] && exit 1/,
  "a caller that asked for a verdict gets a failure",
);
assert.match(workflow, /E2E_EXIT_VERDICT=1/, "the on-demand workflow asks for the verdict");

// The workflow carries the check's files to the box: the deploy ships none
// of scripts/test, so without this there is nothing there to run.
assert.match(
  workflow,
  /scp -q scripts\/test\/loki-loop-e2e\.ts scripts\/test\/mint-check-token\.ts/,
  "the check's own files travel with it",
);

// The helper is not picked up as a unit test.
assert.match(readFileSync("scripts/test-unit.ts", "utf8"), /"mint-check-token\.ts":/);

console.log(
  "✓ loop-check-signs-in: the box-side check signs in with an agent token and fails loudly",
);
