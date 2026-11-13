// A report's row title leads with what differs (lib/feedback/report-title).
// On 2026-11-12 thirty rows read "While I was using this page a request fai…".
import assert from "node:assert/strict";
import { reportTitle } from "../../src/lib/feedback/report-title";

assert.equal(
  reportTitle(
    "While I was using this page a request failed: GET /api/beacon-settings → no response. Fix it so this works.",
  ),
  "A request failed: /api/beacon-settings → no response",
);
assert.equal(
  reportTitle(
    "While I was using this page it hit an error: Cannot read properties of undefined. Fix it so this works.",
  ),
  "An error: Cannot read properties of undefined",
);
assert.equal(
  reportTitle("Make these changes on this page, together:\n1. Bigger title\n2. Less grey"),
  "2 changes: Bigger title · Less grey",
);
assert.equal(
  reportTitle("While I was using this page a request failed: GET /api/very-long-path…"),
  "/api/very-long-path…",
);
// The reporter's own words are left as they are.
assert.equal(
  reportTitle("The header  is too tall\n--- technical details\nx"),
  "The header is too tall",
);
console.log("✓ feedback-report-title");
