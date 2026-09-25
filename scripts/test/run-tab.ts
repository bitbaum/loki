/**
 * Regression net for derived run-tabs (src/lib/run-tab.ts) — the identity
 * primitive of same-project parallel dispatch (phase 2 of worktree-per-agent).
 *
 * Everything in the dispatch loop is tab-keyed; parallel runs work by minting
 * a unique alias per extra run. These checks lock the alias algebra both the
 * server (dispatch route, ingestion, close-sweep) and the desktop runner
 * (force-isolation guard) depend on staying in agreement.
 *
 * Run: npx tsx scripts/test/run-tab.ts
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  deriveRunTab,
  baseProjectKey,
  isDerivedRunTab,
  runLaneOfTab,
  RUN_TAB_SEPARATOR,
} from "@/lib/run-tab";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

check("derive → base round-trips to the project key", () => {
  const tab = deriveRunTab("kivvi", "0b9c1d2e-3f45-6789-abcd-ef0123456789");
  assert(baseProjectKey(tab) === "kivvi", `round-trip broke: ${tab}`);
});

check("alias embeds a compact runId suffix (dashes stripped, 8 chars)", () => {
  const tab = deriveRunTab("kivvi", "0b9c1d2e-3f45-6789-abcd-ef0123456789");
  assert(tab === `kivvi${RUN_TAB_SEPARATOR}0b9c1d2e`, `unexpected alias: ${tab}`);
});

check("two runs of one project get distinct aliases (no coordination needed)", () => {
  const a = deriveRunTab("kivvi", "aaaaaaaa-1111-2222-3333-444444444444");
  const b = deriveRunTab("kivvi", "bbbbbbbb-1111-2222-3333-444444444444");
  assert(a !== b, "aliases collided");
  assert(baseProjectKey(a) === baseProjectKey(b), "aliases lost their base");
});

check("isDerivedRunTab: true for aliases, false for plain tabs", () => {
  assert(isDerivedRunTab(deriveRunTab("revampit", "abc123")), "alias not detected");
  assert(!isDerivedRunTab("revampit"), "plain tab misdetected");
  assert(!isDerivedRunTab("revamp-it"), "hyphenated plain tab misdetected");
  assert(!isDerivedRunTab("Tab With Spaces"), "spaced plain tab misdetected");
});

check("base of a plain tab is itself (safe to apply everywhere)", () => {
  assert(baseProjectKey("orangecat") === "orangecat", "identity broken");
  assert(baseProjectKey("Tab With Spaces") === "Tab With Spaces", "identity broken for spaces");
});

check("base takes the FIRST separator (suffix content can never smuggle a fake base)", () => {
  const weird = `proj${RUN_TAB_SEPARATOR}abc${RUN_TAB_SEPARATOR}def`;
  assert(baseProjectKey(weird) === "proj", "multi-separator base wrong");
});

check("short/odd runIds still produce a usable alias", () => {
  const t1 = deriveRunTab("p", "ab");
  assert(t1 === `p${RUN_TAB_SEPARATOR}ab` && isDerivedRunTab(t1), "short runId broke alias");
  const t2 = deriveRunTab("p", "---");
  assert(
    t2 === `p${RUN_TAB_SEPARATOR}run` && baseProjectKey(t2) === "p",
    "dash-only runId broke alias",
  );
});

check("alias is filesystem-safe for the session file convention (<tab>.md)", () => {
  const tab = deriveRunTab("kivvi", "0b9c1d2e-3f45");
  assert(!/[/\\\0]/.test(tab), "alias contains path-hostile characters");
});

check("a lane tab names its project AND its run, so a lookup can find both", () => {
  // 2026-09-25: the Terminal rail looked up "skif~d0a14b69" as a project key,
  // found nothing, and said "No run… yet" beside an agent nine minutes in.
  const runId = "d0a14b69-1234-4abc-9def-001122334455";
  const lane = runLaneOfTab(deriveRunTab("Skif", runId));
  assert(lane?.project === "Skif", `lane lost its project: ${JSON.stringify(lane)}`);
  assert(
    runId.replace(/-/g, "").startsWith(lane?.runPrefix ?? "✗"),
    `lane prefix does not match its run: ${JSON.stringify(lane)}`,
  );
  assert(runLaneOfTab("Skif") === null, "a plain tab is not a lane");
});

check("a malformed suffix never becomes a wildcard in a query", () => {
  for (const bad of ["p~", "p~%", "p~_x", "p~run", "p~' OR 1=1", "p~abc"]) {
    assert(runLaneOfTab(bad) === null, `"${bad}" was accepted as a run prefix`);
  }
});

check("the terminal resolves a lane tab to its project, not to nothing", () => {
  const route = readFileSync(
    join(__dirname, "../../src/app/api/terminal/context/route.ts"),
    "utf8",
  );
  assert(
    /byName\.get\(baseProjectKey\(tab\)/.test(route),
    "terminal context must match tabs by baseProjectKey — the raw alias matched no project",
  );
});

console.log(`\n${passed}/${passed} passed`);
