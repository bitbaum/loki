/**
 * The committed shell vocabulary matches src/lib/control-states.ts.
 *
 * The deploy's prebuild regenerates scripts/control-states.generated.sh; if
 * the committed copy is stale the checkout goes dirty and the release receipt
 * refuses it. #1482 changed one description and merged green, then failed
 * three deploys in a row. This makes CI say so instead.
 */
import { execFileSync } from "node:child_process";
import path from "node:path";

const root = path.resolve(__dirname, "../..");
execFileSync("npx", ["tsx", "scripts/generate-bash-state-vocab.ts", "--check"], {
  cwd: root,
  stdio: "inherit",
});
console.log("✓ control-states vocabulary is current");
