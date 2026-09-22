/**
 * A signal you cannot raise is not a signal.
 *
 * `security_vulnerability`, `broken_features` and `deployment_issue` are the
 * loudest things in the product: a flag sorts its project to the top of
 * /projects, colours the row, and costs a health point. The complete set of
 * ways to RAISE one was: an agent writing the attr through the API.
 *
 * There was no UI. And the one surface that lets a person type an arbitrary
 * attr — "Additional context" — excludes exactly these three keys, because a
 * "dedicated UI owns them". That dedicated UI did not exist, so the exclusion
 * only meant there was nowhere at all.
 *
 * So the operator saw a red badge on evig, could not tell what put it there,
 * could not raise the same flag on a project that deserved it, and could only
 * clear it by finding a button inside a health disclosure. Read as "magic, or
 * some other non-scalable, stupid solution" — accurately.
 *
 * THE HONESTY RULE THIS PINS: nothing here detects anything, and the copy must
 * never imply it does. A flag is a note a person or an agent wrote. Dressing
 * that up as monitoring would be the same lie in better clothes.
 *
 * Run: npx tsx scripts/test/a-flag-can-be-raised-and-cleared.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { HEALTH_SIGNAL_BASE } from "@/components/projects/project-detail-types";

const FLAGS = join(process.cwd(), "src/components/projects/ProjectFlags.tsx");
const src = readFileSync(FLAGS, "utf8");
// The doc comment quotes the very words under test.
const code = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const VIEW = readFileSync(
  join(process.cwd(), "src/components/projects/ProjectWorkspaceView.tsx"),
  "utf8",
)
  .replace(/\/\*[\s\S]*?\*\//g, "")
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

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

console.log("a-flag-can-be-raised-and-cleared:");

check("THE MISSING HALF: a flag can be raised", () => {
  assert(/Raise flag/.test(code), "there is no way to raise a flag");
  assert(code.includes("setAttr"), "raising does not write the attribute");
});

check("and cleared, and edited", () => {
  assert(code.includes("removeAttr"), "there is no way to clear a flag");
  assert(/"Edit"|>Edit</.test(code), "an existing flag cannot be corrected, only deleted");
});

check("ALL THREE are offered, not only the ones already set", () => {
  // A control that appears once the thing has already happened cannot be the
  // answer to "how do I flag this?".
  assert(
    code.includes("HEALTH_SIGNAL_CONFIG.map"),
    "the panel renders a subset rather than the whole vocabulary",
  );
  assert(
    !/healthSignals\.length > 0 &&[\s\S]{0,200}ProjectFlags/.test(VIEW),
    "the flags panel is rendered conditionally on flags already existing",
  );
});

check("it is mounted where a person writes about a project", () => {
  assert(VIEW.includes("<ProjectFlags"), "the panel is not mounted anywhere");
  const at = VIEW.indexOf("<ProjectFlags");
  const around = VIEW.slice(Math.max(0, at - 800), at);
  assert(
    around.includes("ProjectContextEditor"),
    "the panel is not on the Context tab, beside the other things a person writes",
  );
});

check("THE HONESTY RULE: the copy never claims detection", () => {
  // Words that would promise a scanner. A flag is a note; saying otherwise
  // rebuilds the exact misunderstanding this panel exists to end.
  for (const word of ["scans the project for", "detected", "monitoring", "automatically finds"]) {
    assert(!code.toLowerCase().includes(word), `the copy implies detection: "${word}"`);
  }
  assert(
    /note (someone|a person|you) wrote|note someone wrote/i.test(code),
    "the copy does not say a flag is a note someone wrote",
  );
});

check("it says what a flag COSTS", () => {
  // The operator should know a flag hoists the project and takes a health
  // point before writing one, not discover it afterwards.
  assert(/sorts? to the top/i.test(code), "the copy does not say a flag reorders the page");
  assert(/health point/i.test(code), "the copy does not say a flag costs a health point");
});

check("provenance is shown, so a flag is never anonymous", () => {
  assert(code.includes("attrMeta"), "the panel ignores provenance");
  assert(/noted /.test(code), "the panel does not say when a flag was written");
  assert(/by \$\{|by /.test(code), "the panel does not say what wrote it");
});

check("an expired flag reads as expired, not as absent", () => {
  assert(code.includes("signalHasExpired"), "the panel ignores valid_until");
  assert(/expired/i.test(code), "an expired flag is indistinguishable from never having one");
});

check("every signal in the vocabulary has a name to render", () => {
  // This used to require a `cardLabel` specifically — which pinned the
  // IMPLEMENTATION (two label fields per signal) rather than the rule (a
  // signal the operator can raise must have a name). Those two fields had
  // drifted into "Broken" vs "Broken Features", and collapsing them to one
  // failed this gate even though it fixed the defect. See
  // scripts/test/one-name-per-signal.ts for the rule that replaced it.
  for (const s of HEALTH_SIGNAL_BASE) {
    assert(Boolean(s.label?.trim()), `${s.kind} has no name for the panel heading`);
  }
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
