// Home shows the cause of a failed start, not how the runner delivered it.
import assert from "node:assert/strict";
import { runnerErrorForPerson } from "../../src/lib/runner-error-words";

assert.equal(
  runnerErrorForPerson(
    "launched claude (pty) + injected, but Loki could not verify generation. claude's container failed to start: it exited before printing anything. Nothing ran; Loki moves the run to the next AI provider. Check the builder (sealed-builds containers / journal).",
  ),
  "Claude's container failed to start: it exited before printing anything. Nothing ran; Loki moves the run to the next AI provider.",
);
assert.equal(
  runnerErrorForPerson("injected to running gemini (pty), but Loki could not verify generation."),
  "The agent opened but never answered.",
);
// Anything else is left as it is.
assert.equal(
  runnerErrorForPerson("Grok is not installed on the cloud builder."),
  "Grok is not installed on the cloud builder.",
);
console.log("✓ runner-error-words");
