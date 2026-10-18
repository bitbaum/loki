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

// A Builder on someone else's project who owns nothing (walk as Manu,
// 2026-10-18): the chat said the desktop app was "the one way". Their shared
// project builds on its owner's computers, and the line says so first.
const member =
  builderStatusLine({ cloudBuilderAllowed: false, presence: none }, [
    { name: "petvity", askUrl: "https://loki.orangecat.ch/projects/x#ask" },
  ]) ?? "";
check("a shared project can be built: yes, first", member.startsWith("for the projects shared"));
check("…with where to ask", member.includes("petvity: https://loki.orangecat.ch/projects/x#ask"));
check("…and nothing to install for it", /nothing to install/.test(member));
check(
  "a connected account is not lectured about shared projects",
  builderStatusLine(
    { cloudBuilderAllowed: true, presence: { cloud: true, local: false, any: true } },
    [{ name: "petvity", askUrl: "u" }],
  ).startsWith("yes — Loki's own computers"),
);
check(`no "runner" or "builder" in the member line`, !/runner|builder/i.test(member));

console.log(`\nbuilder-status-line: ${passed} passed`);
