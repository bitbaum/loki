/**
 * What Loki is told about who can build — and so what it tells the operator.
 * Case from the live site (2026-10-15): a new account, with no access to the
 * cloud builder, was advised to "bring the runner online".
 */
import { builderStatusLine } from "@/lib/builder-way-forward";

let passed = 0;
function check(label: string, cond: boolean): void {
  if (!cond) throw new Error(`✗ ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}
const none = { cloud: false, local: false, any: false };

const newcomer = builderStatusLine({ cloudBuilderAllowed: false, presence: none }) ?? "";
check(
  "a new account is told Loki's computers are not available to it",
  newcomer.includes("not available"),
);
check("…and the one way to build, with the link", newcomer.includes("/download"));
check("…and never that something is merely offline", !/offline/i.test(newcomer));

const owner = builderStatusLine({ cloudBuilderAllowed: true, presence: none }) ?? "";
check(
  "an allowed account with the cloud down: offline, nothing to install",
  /offline/.test(owner) && /nothing for the operator to install/.test(owner),
);
check("…and no download pushed at it", !owner.includes("/download"));

check(
  "cloud up",
  builderStatusLine({
    cloudBuilderAllowed: true,
    presence: { cloud: true, local: false, any: true },
  }).startsWith("yes — Loki's own computers"),
);
check(
  "own computer connected, even on a private-cloud account",
  builderStatusLine({
    cloudBuilderAllowed: false,
    presence: { cloud: false, local: true, any: true },
  }).startsWith("yes — the Loki desktop app is connected"),
);
check("unknown access says nothing", builderStatusLine(null) === null);
for (const line of [newcomer, owner]) {
  check(`no "runner" or "builder" in: ${line.slice(0, 40)}…`, !/runner|builder/i.test(line));
}

console.log(`\nbuilder-status-line: ${passed} passed`);
