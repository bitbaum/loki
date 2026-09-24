/**
 * "Needs you" means one thing, and the front door knows all of it.
 *
 * Measured on production 2026-09-22, same login, minutes apart:
 *
 *   /control hero    "1 project needs you — loki"
 *   /today verdict   "7 things need you", and the project it names is evig
 *   /projects chip   "Site issues 1" — evig
 *
 * /projects and /today agreed (one owner, #857). Control overlapped with
 * NEITHER: it counted projects whose agent session or last run was unhealthy,
 * the other two counted raised flags. Same three words, three populations.
 *
 * So the front door said seven things needed the operator and Control, one
 * click away, named a project that was in none of the seven. Trust /today and
 * you miss a blocked agent; trust /control and you miss an authentication
 * bypass.
 *
 * THE RULES:
 *
 *   1. ONE DEFINITION. lib/project-attention.ts is the only place the
 *      attention scoring lives. It takes two health strings and nothing else,
 *      so a client component with live SSE state and a server component with
 *      two DB reads can both ask it.
 *   2. THE FRONT DOOR ASKS IT. /today folds agent attention into its verdict,
 *      so a blocked agent cannot be invisible on the page whose whole job is
 *      to say whether you are free.
 *   3. NO ROW LINKS TO A 404. /projects/[id] resolves by ENTITY id; a catalog
 *      row without one is named, not linked. Dropping it would make the
 *      verdict quietly incomplete again.
 *
 * Run: npx tsx scripts/test/one-meaning-of-needs-you.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { projectAttentionVerdict, projectNeedsOperator } from "../../src/lib/project-attention";

const ROOT = process.cwd();
const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

const OWNER = "src/lib/project-attention.ts";
const presenter = strip(
  readFileSync(join(ROOT, "src/components/control/control-presenter.ts"), "utf8"),
);
const page = strip(readFileSync(join(ROOT, "src/app/(app)/today/page.tsx"), "utf8"));
const verdict = strip(readFileSync(join(ROOT, "src/components/today/NeedsYouVerdict.tsx"), "utf8"));
const hero = strip(
  readFileSync(join(ROOT, "src/components/control/ControlFleetStatus.tsx"), "utf8"),
);

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

/**
 * Asserting a symbol with `includes` is a gate that lies: renaming
 * `projectAttentionVerdict` to `projectAttentionVerdictXX` leaves the original
 * a SUBSTRING, so the check stays green through the exact mutation it exists
 * to catch. (Found by mutating this file's own subject — the first version of
 * this gate had it.)
 */
function usesSymbol(src: string, name: string): boolean {
  return new RegExp(`\\b${name}\\b`).test(src);
}

/**
 * Stronger than usesSymbol: the symbol must actually be CALLED, not merely
 * imported. An unused import satisfies "is this name present?" while the
 * behaviour it names is gone — which is how the first two versions of this
 * gate stayed green through a mutation that deleted the call.
 */
function callsSymbol(src: string, name: string): boolean {
  const withoutImports = src.replace(/^\s*import\s[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "");
  return new RegExp(`\\b${name}\\s*\\(`).test(withoutImports);
}

console.log("one-meaning-of-needs-you:");

check("RULE 1: Control reads the shared rule instead of scoring its own", () => {
  assert(
    callsSymbol(presenter, "projectAttentionVerdict"),
    `control-presenter does not read ${OWNER}`,
  );
  // The scoring itself must be GONE from the presenter, not merely duplicated
  // next to an import that is never used.
  assert(
    !/reasons\.push\(\s*["']needs attention["']\s*\)/.test(presenter),
    "control-presenter still scores attention itself — that is the second definition",
  );
  assert(!/score\s*\+=\s*4/.test(presenter), "control-presenter still carries the scoring weights");
});

check("RULE 2: THE BUG — the front door folds agent attention in", () => {
  assert(
    callsSymbol(page, "projectAttentionVerdict"),
    "/today does not ask about agent attention, so a blocked agent is invisible on the front door",
  );
  assert(callsSymbol(page, "getProjectStatesByUserId"), "/today reads no session health");
  assert(
    callsSymbol(page, "getLatestRunsByProjectPaths"),
    "/today reads no run health — it would count fewer projects than Control",
  );
});

check("and both halves reach the verdict as one list", () => {
  assert(
    /\[\s*\.\.\.flagged\s*,\s*\.\.\.blocked/.test(page),
    "flagged and blocked are not merged — the verdict shows only one kind",
  );
});

check("a project that is BOTH flagged and blocked is listed once", () => {
  assert(
    /flaggedHrefs|flaggedIds/.test(page),
    "no dedupe between the two sources — a project in both would be counted twice",
  );
});

check("RULE 3: a row with no destination is named, never linked to a 404", () => {
  assert(/href:\s*string\s*\|\s*null/.test(verdict), "the verdict row cannot express 'no link'");
  assert(
    /p\.href\s*\?/.test(verdict),
    "the verdict links unconditionally — a project with no entity row gets a 404",
  );
  assert(
    /entityProjectId\s*\?/.test(page),
    "/today assumes every catalog project has an entity id",
  );
  assert(
    !/\/projects\/\$\{p\.id\}/.test(verdict),
    "the verdict still builds its own URL from an id it was told is a key only",
  );
});

check("the rule itself: session health drives it", () => {
  assert(
    projectNeedsOperator({ sessionHealth: "critical", runHealth: null }),
    "a critical session does not need the operator",
  );
  assert(
    projectNeedsOperator({ sessionHealth: "needs attention", runHealth: null }),
    "a session needing attention does not need the operator",
  );
  assert(
    !projectNeedsOperator({ sessionHealth: "ok", runHealth: null }),
    "a healthy project was counted",
  );
  assert(
    !projectNeedsOperator({ sessionHealth: null, runHealth: null }),
    "a project with NO health data was counted — absence is not a problem report",
  );
});

check("run health drives it too, and cannot double-count one trouble", () => {
  assert(
    projectNeedsOperator({ sessionHealth: null, runHealth: "critical" }),
    "a critical last run does not need the operator",
  );
  // The `score <` guards: a project that is critical in BOTH places is one
  // problem, not two. This is the behaviour Control shipped; preserve it.
  const both = projectAttentionVerdict({ sessionHealth: "critical", runHealth: "critical" });
  const sessionOnly = projectAttentionVerdict({ sessionHealth: "critical", runHealth: null });
  assert(
    both.score === sessionOnly.score,
    `one trouble seen twice scored higher (${both.score} vs ${sessionOnly.score})`,
  );
});

check("Control's hero names its SCOPE rather than claiming the whole phrase", () => {
  // The hero counts ONLY agent attention. While it said the unqualified
  // "1 project needs you", it contradicted /today's verdict, which also counts
  // raised flags: Control named loki, the front door named evig, same words.
  assert(
    /project's agent needs|projects' agents need/.test(hero),
    "the Control hero does not say WHOSE need it is counting",
  );
  assert(
    !/"project needs"\s*:\s*"projects need"/.test(hero),
    "the Control hero claims the unqualified phrase again while counting only agent attention",
  );
});

check("the reasons are the words Control already used", () => {
  // Two pages naming the same trouble differently is the same defect one
  // level down.
  assert(
    projectAttentionVerdict({ sessionHealth: "critical", runHealth: null }).reason === "critical",
    "the session-critical reason changed wording",
  );
  assert(
    projectAttentionVerdict({ sessionHealth: null, runHealth: "critical" }).reason ===
      "last run: critical",
    "the run-critical reason changed wording",
  );
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
