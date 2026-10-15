import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// The full fleet brief is useful as a reference page, but dispatching it to
// every coding task buried the requested change under a stack/package catalog.
const assemblers = [
  "src/lib/inject-prompt.ts",
  "src/lib/inject-core.ts",
  "src/app/api/orchestration/run/route.ts",
  "scripts/hosted-runner.ts",
];
for (const file of assemblers) {
  const source = readFileSync(file, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(
    source,
    /fleetBriefFor(?:Project|Repo)\(/,
    `${file} must not inject the full fleet catalog into an agent prompt`,
  );
}

console.log("dispatch-does-not-inject-fleet-catalog: ok (4 prompt assemblers)");
