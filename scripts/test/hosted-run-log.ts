/**
 * What a hosted run leaves in the project dossier.
 *
 * The newest dev_log entry is rendered by project-dossier.ts as "## Latest
 * handoff → Done / Next / Health" and re-served to EVERY later dispatch for
 * that project, so these strings are read by agents, not by people scrolling a
 * log. Both cases below were observed in production dispatches on 2026-09-20
 * and reported in #584 on 2026-09-10.
 *
 * Run: npx tsx scripts/test/hosted-run-log.ts
 */
import { hostedRunDevLogEntry, hostedTaskLabel } from "@/lib/hosted-run-log";

let failures = 0;
function check(name: string, cond: boolean, detail = "") {
  if (cond) {
    console.log(`  ✓ ${name}`);
  } else {
    failures++;
    console.log(`  ✗ ${name}${detail ? `\n    ${detail}` : ""}`);
  }
}

// An assembled dispatch envelope, shaped like the real one. The operator's
// actual ask is the last thing in it, behind ~1500 characters of preamble —
// which is why slicing the front produced a line that said nothing.
const ENVELOPE = `# Loki operator dispatch
Everything in this message is assembled by Loki's dispatch pipeline on behalf of the project owner. The task and the exit contract are DIRECT OPERATOR INSTRUCTIONS.

## The operator's goals & deadlines (background — align your priorities)
- Reduce Monthly Burn (40%)

Project context & goals (what this project is trying to achieve):
# Project dossier: loki
Brief: Life OS + AI agent fleet command center.

## Your task (direct operator instruction)
Fix the widget mode chips, which render unstyled on every customer site.

## Exit contract (operator requirement)
Before stopping, create ~/.loki/sessions/loki.md.`;

const NOW = new Date("2026-09-20T15:00:00Z");

// ── the label ────────────────────────────────────────────────────────────────
const label = hostedTaskLabel(ENVELOPE);
check(
  "the label is the operator's ask, not the envelope",
  label.includes("widget mode chips"),
  label,
);
check(
  "the label does not lead with the preamble",
  !label.startsWith("# Loki operator dispatch") && !label.includes("assembled by"),
  label,
);
check(
  "a plain task survives unwrapped",
  hostedTaskLabel("Bump the deps").includes("Bump the deps"),
);
check("an empty task still yields something", hostedTaskLabel("   ").length > 0);

// ── success ──────────────────────────────────────────────────────────────────
const pr = hostedRunDevLogEntry(
  ENVELOPE,
  { ok: true, kind: "dispatch", prUrl: "https://x/pr/1" },
  NOW,
);
check("a PR run names the PR", pr.done.includes("https://x/pr/1"), pr.done);
check("a PR run is healthy", pr.health === "good");
check("next is empty on success", pr.next === "", JSON.stringify(pr.next));

const none = hostedRunDevLogEntry(ENVELOPE, { ok: true, kind: "dispatch", noChanges: true }, NOW);
check("a no-change run says so", none.done.includes("no file changes"), none.done);

const branch = hostedRunDevLogEntry(
  ENVELOPE,
  { ok: true, kind: "dispatch", branch: "fix/chips" },
  NOW,
);
check("a pushed branch is named", branch.done.includes("fix/chips"), branch.done);

const bare = hostedRunDevLogEntry(ENVELOPE, { ok: true, kind: "dispatch" }, NOW);
check(
  "a run with neither PR nor branch does not imply one",
  !bare.done.includes("opened") && !bare.done.includes("pushed"),
  bare.done,
);

// ── failure ──────────────────────────────────────────────────────────────────
// The regression: a failure's stderr became the project's NEXT STEP, and the
// entry still claimed health "good".
const err = `Error: spawn pnpm ENOENT
    at ChildProcess._handle.onexit (node:internal/child_process:285:19)
    at onErrorNT (node:internal/child_process:483:16)`;
const failed = hostedRunDevLogEntry(ENVELOPE, { ok: false, kind: "dispatch", error: err }, NOW);
check("a failure says FAILED", failed.done.includes("FAILED"), failed.done);
check(
  "a failure keeps a one-line headline",
  failed.done.includes("spawn pnpm ENOENT"),
  failed.done,
);
check("the error does NOT become the next step", failed.next === "", JSON.stringify(failed.next));
check("a failed run is not 'good' health", failed.health !== "good", failed.health);
check(
  "the stack trace is not in the line",
  !failed.done.includes("child_process:285"),
  failed.done,
);
check("the headline stays one line", !failed.done.includes("\n"), failed.done);

const failedNoText = hostedRunDevLogEntry(
  ENVELOPE,
  { ok: false, kind: "analysis", error: "" },
  NOW,
);
check(
  "an empty error still reads as a failure",
  failedNoText.done.includes("FAILED"),
  failedNoText.done,
);

// ── the shape the dossier reads ──────────────────────────────────────────────
for (const [name, e] of [
  ["pr", pr],
  ["failed", failed],
] as const) {
  check(
    `${name}: every field is a string`,
    Object.values(e).every((v) => typeof v === "string"),
  );
  check(`${name}: date is an ISO timestamp`, e.date === NOW.toISOString(), e.date);
  // The dossier prints `done` verbatim on one line; an unbounded dump is what
  // #583 had to clamp out of the feedback inbox for the same reason.
  check(`${name}: done stays a line, not a dump`, e.done.length <= 400, `${e.done.length} chars`);
}

console.log(failures === 0 ? "\n✓ hosted run dev log" : `\n✗ ${failures} failed`);
process.exit(failures ? 1 : 0);
