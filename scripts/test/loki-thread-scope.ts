/**
 * A thread opened by its link keeps its project scope — it used to read
 * "No project — answers only" unless it was tapped in the list.
 *
 * Run: npx tsx scripts/test/loki-thread-scope.ts
 */
import assert from "node:assert/strict";
import { initialLokiSelection } from "../../src/lib/loki/project-selection";
import type { LokiProject } from "../../src/components/loki/types";

const projects = [{ name: "kestrel" }, { name: "ledgerpost" }] as LokiProject[];
assert.deepEqual(initialLokiSelection(projects, "Kestrel", null), ["kestrel"], "?project= wins");
assert.deepEqual(
  initialLokiSelection(projects, null, { projectKeys: ["kestrel", "gone"] }),
  ["kestrel"],
  "the open thread's projects, the ones that still exist",
);
assert.deepEqual(
  initialLokiSelection(projects, null, null),
  [],
  "a fresh /loki stays the start page",
);
console.log("✓ loki thread scope: a thread opened by link keeps its project");
