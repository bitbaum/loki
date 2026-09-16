/** Every adapter claiming session handoffs must close runs from that handoff. */
import assert from "node:assert/strict";
import { ADAPTER_DEFINITIONS } from "@/lib/orchestration/adapters";
import { adapterFor } from "@/lib/orchestration/adapter-registry";

const handoffAdapters = Object.values(ADAPTER_DEFINITIONS).filter(
  (definition) => definition.capabilities.sessionHandoff,
);

for (const definition of handoffAdapters) {
  assert.equal(
    typeof adapterFor(definition.id)?.closeRunFromSession,
    "function",
    `${definition.label} advertises sessionHandoff but has no run-close seam`,
  );
}

assert.ok(handoffAdapters.length >= 6, "the contract test covers the current adapter fleet");
console.log(`${handoffAdapters.length} handoff adapter seams checked`);
