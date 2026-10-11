// One Loki chat moving between projects draws "Now on X" at each switch,
// above the question that asked. Run: npx tsx scripts/test/project-switches.ts
import assert from "node:assert/strict";
import { projectSwitches, turnProject } from "@/lib/loki/project-switches";

const you = { role: "user", meta: null };
const on = (p: string | null, keys?: string[]) => ({
  role: "assistant",
  meta: p ? { projectKey: p } : keys ? { projectKeys: keys } : {},
});

assert.equal(turnProject({ projectKey: "loki" }), "loki");
assert.equal(turnProject({ projectKeys: ["a"] }), "a");
assert.equal(turnProject({ projectKeys: ["a", "b"] }), null, "a fan-out is no one project");
assert.equal(turnProject(null), null);

assert.deepEqual([...projectSwitches([you, on("loki"), you, on("loki")])], [], "no switch");
assert.deepEqual(
  [...projectSwitches([you, on("loki"), you, on("orangecat"), you, on(null), you, on("loki")])],
  [
    [2, "orangecat"],
    [6, "loki"],
  ],
  "each switch, above the asking message; a project-less answer changes nothing",
);
assert.deepEqual(
  [...projectSwitches([you, on("Loki"), you, on("loki")])],
  [],
  "case is not a switch",
);
assert.deepEqual([...projectSwitches([on("a"), on("b")])], [[1, "b"]], "no question before it");

console.log("project-switches: ok");
