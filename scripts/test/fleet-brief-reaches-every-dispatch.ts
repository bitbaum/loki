/**
 * Every place Loki assembles a build/change prompt for an agent carries the
 * fleet brief (src/lib/fleet-brief).
 *
 * The brief only works if no dispatch path skips it — the audit that led to it
 * found the project profile reaching agents on every path and the studio's
 * rules on none. Loki has several assemblers (cloud inject, local inject, the
 * orchestration route's queue / tab / codex paths, the hosted Hermes runner),
 * and a new one is usually written by copying an old one's context lines. This
 * gate DISCOVERS assemblers by what they call — the project context, the task
 * renderer, the Hermes runner — and fails when one does not also reference the
 * brief. A file that legitimately builds no agent prompt is listed below WITH
 * its reason, so the exemption is a decision someone made, not an accident.
 *
 * Run: npx tsx scripts/test/fleet-brief-reaches-every-dispatch.ts
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = process.cwd();

/** Calls that mark a file as assembling (part of) an agent's dispatch prompt. */
const ASSEMBLER_CALLS = [/\bgetProjectContext\(/, /\brenderTaskForAdapter\(/, /\brunHermesTask\(/];
/** Any of these counts as carrying the brief. */
const BRIEF_REFERENCES = [/\bfleetBriefForProject\(/, /\bfleetBriefForRepo\(/];

const EXEMPT: Record<string, string> = {
  "src/db/queries/project-context.ts": "defines getProjectContext",
  "src/lib/orchestration/renderers.ts": "defines renderTaskForAdapter",
  "src/lib/hosted-runner/run-hermes.ts":
    "defines runHermesTask; its caller (scripts/hosted-runner.ts) passes the brief in",
  "src/app/api/loki/route.ts": "Loki chat context, not a build prompt",
  "src/lib/loki/chat-context.ts": "Loki chat context, not a build prompt",
  "src/lib/rag/reindex-project-profile.ts": "indexes the project profile for retrieval",
  "scripts/reindex-knowledge.ts": "indexes the project profile for retrieval",
  "home/render.ts": "self-test-only adapter (scripts/test-home.sh); no production caller",
  "src/lib/orchestration/runners/openclaw.ts":
    "OpenClaw gateway assistant (local runtime only); runs no repo build — wire the brief in when it does",
};

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name === ".next" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mts)$/.test(name)) out.push(full);
  }
  return out;
}

const files = ["src", "scripts", "home"]
  .flatMap((dir) => walk(join(root, dir)))
  .map((file) => relative(root, file))
  .filter((file) => !file.startsWith("scripts/test/") && !file.includes(".test."));

const assemblers: string[] = [];
const offenders: string[] = [];
for (const file of files) {
  // Code only: a comment naming a call is not a call.
  const src = readFileSync(join(root, file), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1");
  if (!ASSEMBLER_CALLS.some((re) => re.test(src))) continue;
  if (file in EXEMPT) continue;
  assemblers.push(file);
  if (!BRIEF_REFERENCES.some((re) => re.test(src))) offenders.push(file);
}

for (const file of Object.keys(EXEMPT)) {
  try {
    statSync(join(root, file));
  } catch {
    offenders.push(`${file}: exempt but missing — drop it from EXEMPT`);
  }
}

// A floor, because "every assembler carries it" over zero assemblers is not a pass.
for (const expected of [
  "src/lib/inject-prompt.ts",
  "src/lib/inject-core.ts",
  "src/app/api/orchestration/run/route.ts",
  "scripts/hosted-runner.ts",
]) {
  assert.ok(assemblers.includes(expected), `${expected} was not discovered as an assembler`);
}

assert.deepEqual(
  offenders,
  [],
  "these assemble an agent's prompt without the fleet brief (lib/fleet-brief):\n" +
    offenders.join("\n"),
);
console.log(
  `fleet-brief-reaches-every-dispatch: ok (${assemblers.length} assemblers carry the brief, ${Object.keys(EXEMPT).length} exempt with a reason)`,
);
