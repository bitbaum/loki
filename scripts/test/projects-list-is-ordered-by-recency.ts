/**
 * The projects list must order by the number it prints.
 *
 * Every row renders "active 23d ago", and the list ignored it. The real
 * tiebreaker was `name.localeCompare`, and because 22 of 36 projects held a
 * next step, the ALPHABET decided most of the page.
 *
 * Measured on production 2026-09-22, before this changed:
 *   - 9 inversions across 21 adjacent pairs
 *   - loki, active seven minutes earlier, sat ELEVENTH — below BiasLens and
 *     HamsterCheek, both untouched for a month
 *   - the three projects whose runs had failed at 06:00 that morning sat at
 *     positions 15, 18 and 20
 *   - the page rendered as two alphabetical blocks, a–v then A–c, which is the
 *     has-a-next-step tier drawing a line through the middle of the list
 *
 * Two tiers were removed to fix it, both undocumented in the original:
 * has-a-next-step-first (backwards: a project that knows its next step needs
 * you least) and own-before-team (recency says it better).
 *
 * Run: npx tsx scripts/test/projects-list-is-ordered-by-recency.ts
 */
import { filterProjects } from "@/lib/projects-page-stats";
import { PROJECT_ATTR } from "@/config/project-attrs";
import type { ProjectGridRow } from "@/components/projects/project-grid-row";

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

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY).toISOString();

/** A project with nothing remarkable about it: old enough not to be "fresh". */
function project(
  name: string,
  attrs: Record<string, string> = {},
  over: Partial<ProjectGridRow> = {},
) {
  return {
    id: name,
    name,
    description: null,
    attrs,
    readonly: false,
    createdAt: new Date(Date.now() - 400 * DAY),
    gitUrl: null,
    dirPath: "/tmp/" + name,
    liveUrl: null,
    siteOk: null,
    ...over,
  } as unknown as ProjectGridRow;
}

const order = (rows: ProjectGridRow[], seen: Record<string, string>) =>
  filterProjects(rows, "", null, seen).map((p) => p.name);

console.log("projects-list-is-ordered-by-recency:");

check("THE BUG: the alphabet no longer outranks a month of silence", () => {
  // Exactly the shape from prod: a name early in the alphabet, untouched for a
  // month, against a name late in it, touched minutes ago.
  const rows = [project("BiasLens"), project("loki")];
  const seen = { BiasLens: ago(30), loki: ago(0.005) };
  assert(order(rows, seen)[0] === "loki", `alphabet still wins: ${order(rows, seen).join(", ")}`);
});

check("the whole prod list comes out in recency order", () => {
  const days: Record<string, number> = {
    "aoz-housing": 11,
    BiasLens: 30,
    botsmann: 8,
    datacat: 9,
    HamsterCheek: 30,
    loki: 0.005,
    "surf-your-life": 0.17,
    printcraft: 0.17,
  };
  const rows = Object.keys(days).map((n) => project(n));
  const seen = Object.fromEntries(Object.entries(days).map(([n, d]) => [n, ago(d)]));
  const got = order(rows, seen);
  const want = Object.keys(days).sort((a, b) => days[a] - days[b]);
  // Ties (surf-your-life / printcraft, both 0.17) settle by name, so compare
  // against the same rule rather than demanding a particular tie order.
  const norm = (list: string[]) => list.map((n) => `${days[n]}`).join(",");
  assert(norm(got) === norm(want), `got ${got.join(" > ")}`);
});

check("a flagged project still outranks everything, however stale", () => {
  const rows = [
    project("stale-but-broken", { [PROJECT_ATTR.BROKEN_FEATURES]: "checkout is down" }),
    project("busy"),
  ];
  const seen = { "stale-but-broken": ago(300), busy: ago(0.001) };
  assert(order(rows, seen)[0] === "stale-but-broken", "attention stopped outranking recency");
});

check("a project created moments ago still comes first", () => {
  // Documented behaviour with a date on it (2026-09-11): a fresh project is
  // the one the operator is here for. Recency must not have eaten it.
  const rows = [
    project("just-made", {}, { createdAt: new Date(Date.now() - 60_000) }),
    project("busy"),
  ];
  const seen = { busy: ago(0.001) };
  assert(order(rows, seen)[0] === "just-made", "the fresh-project tier was lost");
});

check("THE TIER THAT WAS BACKWARDS: having a next step no longer promotes you", () => {
  // A project that knows its next step needs you LEAST. This tier is what split
  // the page into two alphabetical blocks.
  const rows = [
    project("knows-what-to-do", { [PROJECT_ATTR.NEXT_STEP]: "ship the thing" }),
    project("stuck-but-recent"),
  ];
  const seen = { "knows-what-to-do": ago(20), "stuck-but-recent": ago(1) };
  assert(
    order(rows, seen)[0] === "stuck-but-recent",
    "has-a-next-step is still promoting a stale project over a recent one",
  );
});

check("a team project touched yesterday outranks your own touched last month", () => {
  const rows = [project("mine"), project("theirs", {}, { readonly: true })];
  const seen = { mine: ago(30), theirs: ago(1) };
  assert(order(rows, seen)[0] === "theirs", "own-before-team is still overriding recency");
});

check("projects that never ran sort last, not first", () => {
  // A missing timestamp must not read as epoch-0-and-therefore-oldest in one
  // place and "no runs yet" in another — but it also must not float to the top.
  const rows = [project("never-ran"), project("ran-long-ago")];
  const seen = { "ran-long-ago": ago(200) };
  assert(order(rows, seen)[0] === "ran-long-ago", "a never-run project outranked a real one");
});

check("with no recency data at all the order is stable and alphabetical", () => {
  // Callers without the map (and every existing test) must still get a
  // deterministic list rather than input order.
  const rows = [project("zebra"), project("alpha"), project("middle")];
  assert(
    filterProjects(rows, "", null)
      .map((p) => p.name)
      .join(",") === "alpha,middle,zebra",
    "order is not deterministic without recency data",
  );
});

check("search and filters still work, and still return recency order", () => {
  const rows = [project("alpha-shop"), project("beta-shop"), project("gamma")];
  const seen = { "alpha-shop": ago(30), "beta-shop": ago(1), gamma: ago(0) };
  const got = filterProjects(rows, "shop", null, seen).map((p) => p.name);
  assert(got.join(",") === "beta-shop,alpha-shop", `search order wrong: ${got.join(",")}`);
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
