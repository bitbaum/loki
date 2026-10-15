import assert from "node:assert/strict";
import { controlNextStep } from "../../src/lib/control-next-step";
const now = Date.parse("2026-10-15T12:00:00Z");
assert.equal(
  controlNextStep(
    { next: "Obsolete production database advice", mtime: now - 150 * 86_400_000 },
    undefined,
    now / 1000,
  ),
  null,
);
assert.equal(controlNextStep({ next: "Undated", mtime: NaN }, undefined, now / 1000), null);
assert.equal(controlNextStep({ next: "Future", mtime: now + 1000 }, undefined, now / 1000), null);
assert.equal(
  controlNextStep({ next: "Current task", mtime: now - 60_000 }, undefined, now / 1000)?.text,
  "Current task",
);
assert.equal(controlNextStep(null, "Unknown", now / 1000), null);
assert.equal(
  controlNextStep(null, "Profile suggestion", now / 1000)?.label,
  "Suggested next (profile):",
);
console.log("✓ Control does not promote old, future or unknown handoffs as current instructions");
