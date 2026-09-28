/**
 * Unscoped surfaces (Loki chat, Control's intent panel) name WHICH builder is
 * online. A bare "Builder online" sat beside Terminal's grey Cloud builder on
 * 2026-09-28 — only the laptop was up — and read as a contradiction.
 *
 * Run: npx tsx scripts/test/executor-honesty-names-builder.ts
 */
import { deriveExecutorHonestyLabel } from "@/lib/executor-honesty";
import { EXECUTOR_COPY } from "@/config/executor-copy";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const label = (presence: { cloud: boolean; local: boolean } | null) =>
  deriveExecutorHonestyLabel({ runnerConnected: true, presence })?.label;

assert(
  label({ cloud: false, local: true }) === EXECUTOR_COPY.builder.localComputerOnline,
  "laptop only",
);
assert(label({ cloud: true, local: false }) === EXECUTOR_COPY.builder.cloudOnline, "cloud only");
assert(
  label({ cloud: true, local: true }) === EXECUTOR_COPY.honesty.builderStarting,
  "both up keeps the short label",
);
assert(
  label(null) === EXECUTOR_COPY.honesty.builderStarting,
  "unknown split keeps the generic label",
);
assert(
  deriveExecutorHonestyLabel({
    runnerConnected: true,
    scope: "cloud",
    presence: { cloud: false, local: true },
  })?.label === EXECUTOR_COPY.builder.cloudOnline,
  "an explicit scope still wins",
);
console.log("✓ executor honesty names the builder");
