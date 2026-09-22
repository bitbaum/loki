/**
 * The panel you open to read the problem has to show the problem.
 *
 * Two faults, both found by opening the disclosure on production and reading
 * it rather than querying it:
 *
 * 1. THE EVIDENCE WAS CUT AT 80 CHARACTERS. Every check's detail went through
 *    the same `truncate(value)`, which is right for a field preview (a repo
 *    URL, a stage) and wrong for the three signal checks, whose detail is a
 *    REPORT someone wrote. evig's security note rendered as
 *
 *        "Email verification bypass: anyone can register @revamp-it.ch
 *         domain and get Sta…"
 *
 *    — cut mid-word, in the one place you go to read it. The panel scrolls.
 *
 * 2. THE HEADING CONTRADICTED THE BODY. A failing row was titled with the
 *    check's GOAL state:
 *
 *        No security risks open
 *        Email verification bypass: anyone can register…
 *
 *    `label` is correct in the tooltip's "missing: …" list — the missing thing
 *    really is that state — and wrong as a headline above the risk itself.
 *    Failing rows now use `failLabel`; passing rows still name the goal.
 *
 * Run: npx tsx scripts/test/health-panel-shows-the-evidence.ts
 */
import { computeProjectHealth } from "@/lib/project-health";
import { HEALTH_SIGNAL_BASE } from "@/components/projects/project-detail-types";
import { PROJECT_ATTR } from "@/config/project-attrs";

let failures = 0;
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    failures++;
    console.log(`  ✗ ${name}`);
    console.log(`    ${err instanceof Error ? err.message : String(err)}`);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** The real note from evig, which is what exposed the clamp. */
const REAL_NOTE =
  "Email verification bypass: anyone can register @revamp-it.ch domain and get Staff role with admin access to 14 areas";

const health = (attrs: Record<string, string>) =>
  computeProjectHealth({ description: "x", gitUrl: null, dirPath: null, liveUrl: null, attrs });

const signalCheck = (attrs: Record<string, string>, key: string) =>
  health(attrs).checks.find((c) => c.key === key)!;

console.log("health-panel-shows-the-evidence:");

check("THE BUG: a real security note is not cut mid-sentence", () => {
  const c = signalCheck(
    { [PROJECT_ATTR.SECURITY_VULNERABILITY]: REAL_NOTE },
    "security_vulnerability",
  );
  assert(!c.pass, "the check should be failing with a note present");
  assert(
    c.detail.includes("admin access to 14 areas"),
    `the evidence is still truncated — the sentence you opened the panel for is missing: ${c.detail}`,
  );
  assert(!c.detail.includes("…"), `still ellipsised: ${c.detail}`);
});

check("a comma list of broken features survives whole", () => {
  const list =
    "Marketplace, Repairers, IT-Hilfe (API returns HTML), AGB + Datenschutzerklärung, contact form";
  const c = signalCheck({ [PROJECT_ATTR.BROKEN_FEATURES]: list }, "broken_features");
  assert(c.detail.includes("contact form"), `the tail of the list was cut: ${c.detail}`);
});

check("it is still BOUNDED — a pathological note cannot run away", () => {
  const huge = "x".repeat(5000);
  const c = signalCheck({ [PROJECT_ATTR.DEPLOYMENT_ISSUE]: huge }, "deployment_issue");
  assert(c.detail.length < 500, `unbounded: ${c.detail.length} chars would bury the actions`);
  assert(c.detail.endsWith("…"), "a clamped value must say it was clamped");
});

check("field previews stay short — only the reports grew", () => {
  // A repo URL or a stage is a field's value, not a report. Widening those
  // would bloat the panel for no reading benefit.
  const long = "https://github.com/bitbaum/" + "a".repeat(200);
  const c = health({ repo: long }).checks.find((x) => x.key === "code")!;
  assert(c.detail.length <= 81, `field preview grew too: ${c.detail.length} chars`);
});

check("THE CONTRADICTION: a failing signal names the problem", () => {
  for (const signal of HEALTH_SIGNAL_BASE) {
    const c = signalCheck({ [signal.key]: "something is wrong" }, signal.key);
    assert(!c.pass, `${signal.kind} should be failing`);
    assert(
      c.failLabel === signal.label,
      `${signal.kind} has no problem-name for the panel heading: ${c.failLabel}`,
    );
    // The heading the panel renders must not be the goal state.
    assert(
      !(c.failLabel ?? c.label).startsWith("No "),
      `a failing row is still headed with its goal state: "${c.failLabel ?? c.label}"`,
    );
  }
});

check("the goal state is still what the tooltip calls missing", () => {
  // describeProjectHealth lists `label`, and "missing: No security risks open"
  // is the correct phrasing there — the missing thing IS that state.
  for (const signal of HEALTH_SIGNAL_BASE) {
    const c = signalCheck({ [signal.key]: "x" }, signal.key);
    assert(c.label === signal.clearLabel, `${signal.kind} lost its goal-state label: ${c.label}`);
  }
});

check("checks that never fail confusingly need no failLabel", () => {
  // Only the three signals invert like this; everything else reads the same
  // either way, and a failLabel there would be noise to maintain.
  const c = health({}).checks.find((x) => x.key === "mission")!;
  assert(c.failLabel === undefined, "a non-signal check grew a failLabel");
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
