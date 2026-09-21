/**
 * Control's default sort is called "Priority". It ranked nothing.
 *
 * The comparator for that mode read, in full:
 *
 *   return sourceSnapshots.indexOf(a) - sourceSnapshots.indexOf(b);
 *
 * — the order the API happened to return. So the rail opened with idle
 * projects while the three with an open workspace tab sat two thirds of the
 * way down, and the order looked arbitrary because it was. A control labelled
 * Priority that applies none is worse than an unsorted list: it tells the
 * operator the top of the list means something.
 *
 * Nothing new is invented in the fix. control-states.ts already says what each
 * state MEANS — `problem` is non-null exactly when "this needs your attention",
 * `counterCategory` is the bucket the summary chips count — so the rail now
 * reads the same fields the chips read and the two cannot disagree.
 *
 * Run: npx tsx scripts/test/priority-actually-prioritises.ts
 */
import { priorityRank } from "@/components/control/ProjectOperationsView";
import { STATE_DEFINITIONS, type ProjectStateKey } from "@/lib/control-states";

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

const keys = Object.keys(STATE_DEFINITIONS) as ProjectStateKey[];

console.log("priority-actually-prioritises:");

check("every state has a rank", () => {
  for (const k of keys) {
    const r = priorityRank(k);
    assert(Number.isFinite(r), `${k} ranked ${r}`);
  }
});

check("anything with a problem outranks everything else", () => {
  // `problem` is the SSOT's own words for "this needs your attention".
  const problems = keys.filter((k) => STATE_DEFINITIONS[k].problem);
  const clean = keys.filter((k) => !STATE_DEFINITIONS[k].problem);
  assert(problems.length > 0, "the SSOT should define at least one problem state");
  for (const p of problems) {
    for (const c of clean) {
      assert(priorityRank(p) < priorityRank(c), `${p} (problem) must outrank ${c}`);
    }
  }
});

check("awaiting input outranks working, and working outranks idle", () => {
  // The rail answers "is anything waiting on ME?" — a project that wants a
  // prompt is more urgent than one already running unattended.
  const waiting = keys.find(
    (k) => !STATE_DEFINITIONS[k].problem && STATE_DEFINITIONS[k].counterCategory === "waiting",
  );
  const working = keys.find(
    (k) => !STATE_DEFINITIONS[k].problem && STATE_DEFINITIONS[k].counterCategory === "working",
  );
  const idle = keys.find(
    (k) => !STATE_DEFINITIONS[k].problem && STATE_DEFINITIONS[k].counterCategory === "idle",
  );
  assert(!!waiting && !!working && !!idle, "expected one state of each category");
  assert(priorityRank(waiting!) < priorityRank(working!), "waiting before working");
  assert(priorityRank(working!) < priorityRank(idle!), "working before idle");
});

check("idle is last", () => {
  const idle = keys.filter(
    (k) => !STATE_DEFINITIONS[k].problem && STATE_DEFINITIONS[k].counterCategory === "idle",
  );
  const others = keys.filter((k) => !idle.includes(k));
  for (const i of idle) {
    for (const o of others) {
      assert(priorityRank(i) >= priorityRank(o), `idle ${i} must not outrank ${o}`);
    }
  }
});

check("THE BUG: ranking is not the identity of list position", () => {
  // The old comparator gave a strictly increasing rank to array order, so no
  // two states ever tied. A real ranking buckets — many idle projects share a
  // rank and fall through to recency. If every state got a distinct rank, the
  // ranking would be doing nothing again.
  const distinct = new Set(keys.map(priorityRank));
  assert(
    distinct.size < keys.length,
    "every state got its own rank — that is list order, not priority",
  );
});

console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
