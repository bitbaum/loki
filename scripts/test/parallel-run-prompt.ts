/**
 * A parallel lane's prompt names exactly ONE handoff file — its own.
 *
 * THE TRAP THIS LOCKS DOWN
 * ------------------------
 * Every dispatch ends with an exit contract telling the agent which session
 * file to write its handoff to, and the run closes when that file reports
 * ready — so the path in the contract IS the run's identity to the close path.
 *
 * A prompt assembled by inject-core (Implement, /loki, Control) already ends
 * with a contract for the BASE tab (`~/.loki/sessions/loki.md`). The old
 * parallel code, written for the one route whose prompt had no contract yet,
 * APPENDED a second one. Fed an inject-core prompt it would have told the
 * agent to write both files — and a ready handoff on the base file closes
 * whichever run owns the base tab, not this one.
 *
 * Also a ratchet: the contract is built in ONE place (exitContractFor). Three
 * call sites used to type the heading out by hand, which is how a replacement
 * could never have been exact.
 *
 * Run: npx tsx scripts/test/parallel-run-prompt.ts
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname, resolve as resolvePath } from "node:path";
import { fileURLToPath } from "node:url";
import { promptForLane } from "@/lib/orchestration/lane-prompt";
import { exitContractFor, EXIT_CONTRACT_PATTERN } from "@/lib/agent-config";
import { deriveRunTab } from "@/lib/run-tab";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const BASE_FILE = "~/.loki/sessions/loki.md";
const lane = deriveRunTab("loki", "db093fd4-3d68-4740-9b2d-3ee8b6d55c1b");
const LANE_FILE = `~/.loki/sessions/${lane}.md`;
const contracts = (s: string) => (s.match(/^##[ \t]*Exit contract\b/gim) ?? []).length;

// The shape inject-core produces: preamble, context, the task, then the
// contract for the BASE tab, last.
const injectCorePrompt = [
  "# Loki operator dispatch",
  "Everything in this message is assembled by Loki's dispatch pipeline.",
  "",
  "## The operator's goals & deadlines",
  "- ship the feedback inbox clamp",
  "",
  "Work on the project at /home/g/dev/loki.",
  "Clamp a report body to three lines with a more toggle.",
  "",
  exitContractFor(BASE_FILE),
].join("\n");

check("an inject-core prompt keeps one contract, pointed at the lane's own file", () => {
  const out = promptForLane(injectCorePrompt, lane);
  assert(contracts(out) === 1, `expected exactly one exit contract, found ${contracts(out)}`);
  assert(out.includes(LANE_FILE), `the contract must name the lane's file ${LANE_FILE}`);
  assert(
    !out.includes(BASE_FILE),
    "the base tab's file must be gone — a ready handoff there closes the wrong run",
  );
});

check("the task and its context survive the rewrite", () => {
  const out = promptForLane(injectCorePrompt, lane);
  assert(out.includes("Clamp a report body to three lines"), "the task was lost");
  assert(out.includes("## The operator's goals & deadlines"), "the context was lost");
  assert(
    out.trimEnd().endsWith(exitContractFor(LANE_FILE).trimEnd()),
    "the contract must stay last",
  );
});

check("a prompt with no contract yet gets exactly one", () => {
  const out = promptForLane("Work on the project at /x.\nDo the thing.", lane);
  assert(contracts(out) === 1, `expected one exit contract, found ${contracts(out)}`);
  assert(out.includes(LANE_FILE), "it must name the lane's file");
});

check("rewriting twice is the same as rewriting once", () => {
  const once = promptForLane(injectCorePrompt, lane);
  assert(promptForLane(once, lane) === once, "promptForLane must be idempotent");
});

check("the shared matcher finds the contract every builder emits", () => {
  assert(
    EXIT_CONTRACT_PATTERN.test(`body\n\n${exitContractFor(BASE_FILE)}`),
    "EXIT_CONTRACT_PATTERN must match exitContractFor's output",
  );
});

check("the exit contract is built in one place", () => {
  const root = resolvePath(dirname(fileURLToPath(import.meta.url)), "../../src");
  const files: string[] = [];
  (function walk(dir: string) {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(p)) files.push(p);
    }
  })(root);
  const code = (p: string) =>
    readFileSync(p, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
  const typed = files.filter((p) => code(p).includes("## Exit contract (operator requirement)"));
  assert(
    typed.length === 1 && typed[0]!.endsWith("src/lib/agent-config.ts"),
    `the contract heading must be typed only in agent-config.ts (exitContractFor); found in: ${typed.join(", ")}`,
  );
});

console.log(`\nparallel-run-prompt: ${passed} passed`);
