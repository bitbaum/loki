/**
 * What Cmd-K offers, and in what order.
 *
 * WHY THIS EXISTS
 *
 * The palette's entry list and its filter were two useMemos inside a 442-line
 * component, so nothing could check them. They encode decisions that read as
 * arbitrary and get "tidied" away:
 *
 *   - Projects rank ABOVE navigation, because the most-common Cmd-K intent in a
 *     fleet product is "jump to project X".
 *   - Recents lead the no-query list, in recency order, and are not repeated
 *     further down.
 *   - Any free text offers a "Run: …" row FIRST — the composer is the point of
 *     typing, not a fallback.
 *   - While a resolved command waits for a project, the list IS the project
 *     picker and nothing else.
 *   - A project with no local path is still navigable, but cannot be switched
 *     to another agent (there is no checkout to relaunch in).
 *   - One slip in a project or page name still finds it, FIRST ("lkoi" →
 *     Loki). The filter was `label.includes(q)`, so a single wrong letter
 *     emptied the list of the one thing the operator was reaching for. The
 *     typo suite below is generated from the names (every neighbouring key,
 *     dropped, doubled and swapped letter), not imagined.
 *
 * Run: npx tsx scripts/test/palette-entries.ts
 */
import { evaluate, typoCases, words } from "@bitbaum/searchkit";
import { NAV_ITEMS } from "@/config/navigation";
import {
  buildPaletteEntries,
  filterPaletteEntries,
  SWITCHABLE_AGENT_IDS,
  type PaletteEntry,
} from "@/components/shell/palette-entries";

let passed = 0;
async function checkAsync(label: string, fn: () => Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
function check(label: string, fn: () => void) {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

const PROJECTS = [
  { id: "p1", name: "Loki", dirPath: "/home/g/dev/loki" },
  { id: "p2", name: "OrangeCat", dirPath: null },
  { id: "p3", name: "Retired", dirPath: "/tmp/x", isActive: false },
];

const entries = buildPaletteEntries({ agentPrompts: [], projects: PROJECTS });
const kinds = (list: PaletteEntry[]) => list.map((e) => e.kind);

check("inactive projects are not offered at all", () => {
  assert(
    !entries.some((e) => e.label.includes("Retired")),
    "a deactivated project is not a destination",
  );
});

check("projects rank above navigation", () => {
  const firstProject = kinds(entries).indexOf("project");
  const firstNav = kinds(entries).indexOf("nav");
  assert(firstProject === 0, "the list opens with projects");
  assert(firstProject < firstNav, "and they outrank Go-to rows");
});

check("only a project with a local path can be switched to another agent", () => {
  const switches = entries.filter((e) => e.kind === "switch-agent");
  assert(
    switches.length === SWITCHABLE_AGENT_IDS.length,
    "one row per agent, for the one project with a checkout",
  );
  assert(
    switches.every((e) => e.label.includes("Loki")),
    "OrangeCat has no dirPath, so it offers no relaunch",
  );
});

check("a pathless project still says so rather than lying about a path", () => {
  const oc = entries.find((e) => e.kind === "project" && e.label === "OrangeCat");
  assert(oc?.sub === "Project · no local path", "the row admits there is no checkout");
});

check("recents lead the empty-query list, in order, and are not repeated", () => {
  const navKey = entries.find((e) => e.kind === "nav")!.key;
  const projectKey = entries.find((e) => e.kind === "project")!.key;
  const list = filterPaletteEntries({
    entries,
    query: "",
    recent: [navKey, projectKey],
    pending: false,
    projectNames: [],
  });
  assert(list[0].key === navKey, "the most recent pick is first");
  assert(list[1].key === projectKey, "then the next");
  assert(list.filter((e) => e.key === navKey).length === 1, "and neither appears twice");
});

check("free text offers Run first, above the matches", () => {
  const list = filterPaletteEntries({
    entries,
    query: "loki",
    recent: [],
    pending: false,
    projectNames: [],
  });
  assert(list[0].kind === "run-command", "typing is a command before it is a search");
  assert(list[0].label === "Run: loki", "and it quotes what was typed");
  assert(
    list.slice(1).some((e) => e.label === "Loki"),
    "the matching project is still reachable below it",
  );
});

check("a pending command turns the list into a project picker", () => {
  const list = filterPaletteEntries({
    entries,
    query: "",
    recent: [],
    pending: true,
    projectNames: ["Loki", "OrangeCat"],
  });
  assert(
    list.every((e) => e.kind === "pick-project"),
    "nothing else is offered while a command waits for its project",
  );
  assert(list.length === 2, "every candidate project is listed");

  const filteredPick = filterPaletteEntries({
    entries,
    query: "orange",
    recent: [],
    pending: true,
    projectNames: ["Loki", "OrangeCat"],
  });
  assert(filteredPick.length === 1, "and typing filters the picker, not the whole palette");
  assert(filteredPick[0].kind === "pick-project" && filteredPick[0].label === "OrangeCat", "match");
});

check("results stay bounded", () => {
  const many = Array.from({ length: 200 }, (_, i) => `Project ${i}`);
  const list = filterPaletteEntries({
    entries,
    query: "",
    recent: [],
    pending: true,
    projectNames: many,
  });
  assert(list.length <= 60, "the picker cannot render 200 rows into a dropdown");
});

check("the matched part of a label is handed to the row for marking", () => {
  const list = filterPaletteEntries({
    entries,
    query: "orangec",
    recent: [],
    pending: false,
    projectNames: [],
  });
  const oc = list.find((e) => e.kind === "project" && e.label === "OrangeCat");
  assert(!!oc?.labelMatches?.length, "a matched row carries its label ranges");
  assert(list[0].labelMatches === undefined, "the Run row marks nothing — it quotes the query");
});

check("a typo in the project picker still finds the project", () => {
  const list = filterPaletteEntries({
    entries,
    query: "ornagecat",
    recent: [],
    pending: true,
    projectNames: ["Loki", "OrangeCat"],
  });
  assert(list[0]?.label === "OrangeCat", `picker found ${list[0]?.label ?? "nothing"}`);
});

// A realistic fleet: the names an operator actually types into Cmd-K.
const FLEET = [
  "Loki",
  "OrangeCat",
  "Solon",
  "Heidi",
  "Substrata",
  "evig",
  "Kivvi",
  "Cato",
  "accountkit",
  "chatkit",
  "whenkit",
  "Revamp Shop",
].map((name, i) => ({ id: `f${i}`, name, dirPath: `/home/g/dev/${name.toLowerCase()}` }));
const fleetEntries = buildPaletteEntries({ agentPrompts: [], projects: FLEET });
const keysFor = (query: string) =>
  filterPaletteEntries({
    entries: fleetEntries,
    query,
    recent: [],
    pending: false,
    projectNames: [],
  })
    .filter((e) => e.kind !== "run-command")
    .map((e) => e.key);

/**
 * `floor` is 1 unless a miss is a genuine ambiguity, listed where the suite is
 * called — never lowered to make a regression pass.
 */
async function typoSuite(
  label: string,
  names: { id: string; name: string }[],
  { floor = 1, fold }: { floor?: number; fold?: (s: string) => string[] } = {},
) {
  await checkAsync(label, async () => {
    const cases = typoCases(names, { fold });
    const report = await evaluate(cases, keysFor);
    console.log(
      `      ${report.cases} one-slip queries · success@1 ${report.successAt1.toFixed(3)} · ` +
        `success@3 ${report.successAt3.toFixed(3)} · no results ${report.zeroResults.toFixed(3)}`,
    );
    for (const m of report.misses) {
      console.log(`      miss: ${m.query} → ${m.got.slice(0, 2).join(", ") || "nothing"}`);
    }
    assert(cases.length > 100, "the suite is generated, not a handful of hand-picked typos");
    assert(report.zeroResults === 0, "no one-slip query comes back empty");
    assert(
      report.successAt1 >= floor,
      `success@1 ${report.successAt1} under ${floor}; misses: ${report.misses
        .slice(0, 8)
        .map((m) => `${m.query} → ${m.got.slice(0, 3).join(", ") || "nothing"}`)
        .join("; ")}`,
    );
  });
}

check("hand-picked slips land on the project first", () => {
  for (const [typed, name] of [
    ["lkoi", "Loki"],
    ["ornagecat", "OrangeCat"],
    ["orange cat", "OrangeCat"],
    ["subtsrata", "Substrata"],
    ["heid", "Heidi"],
  ] as const) {
    const first = filterPaletteEntries({
      entries: fleetEntries,
      query: typed,
      recent: [],
      pending: false,
      projectNames: [],
    })[1];
    assert(first?.kind === "project" && first.label === name, `${typed} → ${first?.label}`);
  }
});

async function main() {
  // Six of 566 are not first, and each is a real collision rather than a
  // failure to forgive: "dato"/"acto" are one slip from Cato AND from another
  // word on the list (a "data" template, "account"), and "catto",
  // "accountkitt", "chatkitt", "whenkitt" spell the joined words of a
  // "Switch <project> to <agent>" row exactly ("cat to" → "catto").
  await typoSuite(
    "one slip in a project name still puts that project first",
    FLEET.map((p) => ({ id: `project:${p.id}`, name: p.name })),
    { floor: 0.985 },
  );
  await typoSuite(
    "one slip in a page name still puts that page first",
    NAV_ITEMS.filter((n) => n.active && !FLEET.some((p) => p.name === n.label)).map((n) => ({
      id: `nav:${n.id}`,
      name: n.label,
    })),
    // Split "No-screen" the way the search does; by default the generator
    // treats it as one word and misspells the "n" of "no", which nobody types.
    // Three of ~1340 land second, each because a slip spells two adjacent
    // words of another page's description exactly ("projecta" → "project
    // a…" under Fleet, "fleett" → "fleet t…" under Feedback, "oney" under
    // Suggestions); the page is still in the top three for every one.
    { fold: words, floor: 0.997 },
  );
  console.log(`\n${passed}/${passed} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
