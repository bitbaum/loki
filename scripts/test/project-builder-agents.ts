/**
 * Each Control card offers the agents installed on the builder that runs that
 * project (components/control/control-panel-card-props → onProjectBuilder).
 *
 * The panel-wide list read the computer's report first, so a cloud project
 * was offered Codex because the laptop had it, and the dispatch then started a
 * session for a program the cloud builder does not have.
 *
 * Run: npx tsx scripts/test/project-builder-agents.ts
 */
import assert from "node:assert/strict";
import { onProjectBuilder } from "@/components/control/control-panel-card-props";

const panel = [
  { id: "claude", label: "Claude", available: true },
  { id: "codex", label: "Codex", available: true },
  { id: "grok", label: "Grok", available: false },
];

const cloud = onProjectBuilder(panel, {
  builderChannel: "cloud",
  builderAgents: ["claude", "grok"],
});
assert.equal(cloud.find((a) => a.id === "claude")?.available, true);
assert.equal(
  cloud.find((a) => a.id === "codex")?.available,
  false,
  "laptop-only Codex is not offered to a cloud project",
);
assert.match(
  cloud.find((a) => a.id === "codex")?.availabilityReason ?? "",
  /not installed on the cloud runner/,
);
assert.equal(cloud.find((a) => a.id === "codex")?.unavailableNote, "not on the cloud runner");
assert.equal(
  cloud.find((a) => a.id === "grok")?.available,
  true,
  "installed on the runner that runs it, whatever the laptop says",
);

const local = onProjectBuilder(panel, { builderChannel: "local", builderAgents: ["codex"] });
assert.match(local.find((a) => a.id === "claude")?.availabilityReason ?? "", /your computer/);

assert.deepEqual(
  onProjectBuilder(panel, { builderChannel: "cloud", builderAgents: null }),
  panel,
  "a runner that never reported leaves the rows as they were (unknown, not none)",
);
assert.deepEqual(onProjectBuilder(panel, {}), panel, "an older API response changes nothing");

console.log("✓ project-builder-agents: 9 checks passed");
