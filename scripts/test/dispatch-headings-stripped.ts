/**
 * Every `##` block the dispatch pipeline injects must be strippable by
 * `extractOperatorTask`, so the Activity feed shows what the operator ASKED
 * rather than the scaffolding wrapped around it.
 *
 * WHY THIS EXISTS
 *
 * ENVELOPE_BLOCK_PATTERNS in lib/activity-status.ts is a hand-kept list of the
 * headings the pipeline emits, and its own comment predicts the failure: "a
 * block that changes upstream stops matching". It did. The list carried
 *
 *     ## Background context from your other projects
 *
 * while db/queries/knowledge-embeddings.ts emits
 *
 *     ## Relevant context from your other projects (retrieved)
 *
 * Nothing failed. The block simply survived into the preview, so rows on
 * /activity read `asked: ## Relevant context from your other projects…` —
 * retrieval scaffolding presented as the operator's own question, on the one
 * page whose job is to answer "what did I ask for?". Observed on production
 * 2026-09-05 across every row of the "Needs you" list.
 *
 * A second hand-maintained list checking the first would rot the same way, so
 * this DISCOVERS the headings from the pipeline source and tests behaviour: it
 * builds a dispatch around each one and asserts the heading does not survive
 * while the task does.
 *
 * Run: npx tsx scripts/test/dispatch-headings-stripped.ts
 */
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractOperatorTask } from "../../src/lib/activity-status";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) {
    pass++;
    console.log(`  ✓ ${label}`);
  } else {
    fail++;
    console.error(`  ✗ ${label}`);
  }
}

/**
 * Files that assemble an operator dispatch. A heading emitted anywhere here
 * can reach a stored prompt and therefore the Activity feed.
 */
const PIPELINE_SOURCES = [
  "src/lib/inject-prompt.ts",
  "src/lib/inject-core.ts",
  "src/lib/orchestration/renderers.ts",
  "src/db/queries/knowledge-embeddings.ts",
  "src/lib/orchestration/escalation-ladder.ts",
  "src/lib/fleet-brief/brief.ts",
];

/**
 * Headings that must NOT be stripped.
 *
 * "Your task" is the operator's instruction itself — the one block the feed
 * exists to show. It is recovered by TASK_SECTION_RE, not subtracted.
 */
const KEEP = [/^##\s*Your task\b/i, /^##\s*Task\s*$/i];

function headingsIn(file: string): string[] {
  const src = readFileSync(join(repoRoot, file), "utf8");
  const found = new Set<string>();
  // `## …` at the start of a string or template literal, or right after a \n.
  for (const m of src.matchAll(/["'`](?:\\n)?(##[ \t][^"'`\\\n]{4,120})/g)) {
    const heading = m[1]
      // A heading built with ${…} interpolation: keep the literal prefix, which
      // is what the strip pattern anchors on anyway.
      .split("${")[0]
      .trim();
    if (heading.length > 6) found.add(heading);
  }
  return [...found];
}

const headings = PIPELINE_SOURCES.flatMap(headingsIn);
ok(headings.length >= 4, `found dispatch headings in the pipeline (got ${headings.length})`);

// The sentinel task. It is deliberately the bare "Work on the project at …"
// shape a rendered intent body starts with, because that is the case the
// subtraction path has to survive — the explicit "Your task" header would
// short-circuit the whole thing and test nothing.
const TASK = "Work on the project at /srv/example and open a PR.";

/**
 * A dispatch shaped like the real one.
 *
 * Two details are load-bearing, and getting them wrong made the first version
 * of this check fail on every heading for a reason that had nothing to do with
 * the bug:
 *
 *  - background blocks end at the next heading OR at the "Project context &
 *    goals" sentinel. Without that sentinel between the block and the task, a
 *    block correctly runs to end-of-input and takes the task with it.
 *  - the exit contract really does consume to the end, so it must come last —
 *    and a heading placed after it can never survive, by design.
 */
function dispatchAround(heading: string): string {
  const isExitContract = /^##\s*Exit contract\b/i.test(heading);
  return [
    "# Loki operator dispatch",
    "You are operating a project on behalf of the operator.",
    "",
    ...(isExitContract
      ? []
      : [heading, "some block body the operator did not write", "- [otherproject] a chunk", ""]),
    "Project context & goals",
    "example — a project that exists.",
    "Favor the next step that most advances these goals.",
    "",
    TASK,
    "",
    ...(isExitContract ? [heading, "Before stopping, create the session file."] : []),
  ].join("\n");
}

for (const heading of headings) {
  if (KEEP.some((re) => re.test(heading))) {
    ok(true, `kept (not scaffolding): ${heading.slice(0, 56)}`);
    continue;
  }
  const dispatch = dispatchAround(heading);

  const recovered = extractOperatorTask(dispatch) ?? "";
  const headingWords = heading.replace(/^##\s*/, "").slice(0, 24);

  ok(
    !recovered.includes(headingWords),
    `stripped: ${heading.slice(0, 56)}${heading.length > 56 ? "…" : ""}`,
  );
  // Subtracting a block must not take the task with it — the failure mode the
  // pattern comments call "the opposite of the point".
  ok(recovered.includes("Work on the project at"), `task survives alongside: ${headingWords}`);
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
