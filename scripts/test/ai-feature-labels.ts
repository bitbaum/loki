import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { AI_FEATURE_LABELS, aiFeatureLabel } from "../../src/config/ai-feature-labels";

let failures = 0;
function check(name: string, cond: boolean) {
  console.log(`${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures += 1;
}

check(
  "a known slug gets its plain label",
  aiFeatureLabel("terminal-next-steps") === "Next-step suggestions in Terminal",
);
check("an unknown slug is made readable", aiFeatureLabel("chat-new-thing") === "Chat new thing");

// Every literal `feature: "…"` in src has a plain label, so a new metered
// feature cannot quietly show up in Settings as its slug.
function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}
const ids = new Set<string>();
for (const file of walk(path.join(__dirname, "../../src"))) {
  for (const m of readFileSync(file, "utf8").matchAll(/feature: "([a-z0-9-]+)"/g)) ids.add(m[1]);
}
const missing = [...ids].filter((id) => !AI_FEATURE_LABELS[id]);
check(
  `every metered feature has a label (missing: ${missing.join(", ") || "none"})`,
  missing.length === 0,
);

if (failures) {
  console.error(`${failures} failed`);
  process.exit(1);
}
