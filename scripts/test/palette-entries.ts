/**
 * What Cmd-K offers, and in what order.
 *
 * WHY THIS EXISTS
 *
 * The palette's entry list and its filter were two useMemos inside a 442-line
 * component, so nothing could check them. They encode decisions that read as
 * arbitrary and get "tidied" away:
 *
 *   - With nothing typed, PAGES lead (in the sidebar's order), then projects.
 *     Forty-odd projects used to come first and pushed every page past the
 *     row limit (audit, 2026-11-12).
 *   - Once something is typed, a project still wins a tie with a page.
 *   - Recents lead the no-query list, in recency order, and are not repeated
 *     further down.
 *   - Free text offers "Ask Loki to do: …" LAST, and Enter never picks it
 *     unless the arrow keys chose it: the box is opened by a magnifier, and a
 *     search that started a build on Enter was a build nobody meant.
 *   - While a resolved command waits for a project, the list IS the project
 *     picker and nothing else.
 *   - A project row names the project the way a person does (its title, its
 *     site), never the server folder; switching agents is not offered here.
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
  enterTarget,
  filterPaletteEntries,
  PALETTE_RESULT_LIMIT,
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
  { id: "p1", name: "Loki", liveUrl: "https://loki.orangecat.ch/" },
  { id: "p2", name: "OrangeCat" },
  { id: "p3", name: "Retired", isActive: false },
  {
    id: "p4",
    name: "xhiva-art-refresh-300d1519783b47d3ab1c7ddb77c5febf",
    description: "Develop a new version of this existing website: https://www.xhiva.art/",
  },
];

const entries = buildPaletteEntries({ agentPrompts: [], projects: PROJECTS });
const kinds = (list: PaletteEntry[]) => list.map((e) => e.kind);

check("inactive projects are not offered at all", () => {
  assert(
    !entries.some((e) => e.label.includes("Retired")),
    "a deactivated project is not a destination",
  );
});

check("with nothing typed, pages come first, in the sidebar's order, then projects", () => {
  const firstProject = kinds(entries).indexOf("project");
  const lastNav = kinds(entries).lastIndexOf("nav");
  assert(kinds(entries)[0] === "nav", "the list opens with pages");
  assert(lastNav < firstProject, "every page is above the first project");
  assert(entries[0].label === "Loki", "in the sidebar's order: Loki first");
});

check("every page shows before the row limit, however many projects there are", () => {
  const many = Array.from({ length: 80 }, (_, i) => ({ id: `m${i}`, name: `project-${i}` }));
  const list = filterPaletteEntries({
    entries: buildPaletteEntries({ agentPrompts: [], projects: many }),
    query: "",
    recent: [],
    pending: false,
    projectNames: [],
  });
  for (const page of ["Activity", "Prompts", "Settings"]) {
    assert(
      list.some((e) => e.kind === "nav" && e.label === page),
      `${page} is reachable without typing`,
    );
  }
  assert(list.length <= PALETTE_RESULT_LIMIT, "and the list stays bounded");
});

check("switching a project's agent is not a search result", () => {
  assert(!entries.some((e) => /^Switch /.test(e.label)), "it lives on the project's own screen");
});

check("a project row names the project, never a server folder", () => {
  const loki = entries.find((e) => e.kind === "project" && e.label === "Loki");
  assert(loki?.sub === "Project · loki.orangecat.ch", `site shown: ${loki?.sub}`);
  const oc = entries.find((e) => e.kind === "project" && e.label === "OrangeCat");
  assert(oc?.sub === "Project", `no site, no path: ${oc?.sub}`);
  assert(
    entries.some((e) => e.kind === "project" && e.label === "Xhiva"),
    "a minted id reads as the site it was made from",
  );
  assert(!entries.some((e) => /\/home\/|no local path/.test(e.sub)), "no folder anywhere");
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

check("free text finds first; handing it to an agent is offered last", () => {
  const list = filterPaletteEntries({
    entries,
    query: "loki",
    recent: [],
    pending: false,
    projectNames: [],
  });
  assert(list[0].kind !== "run-command", "typing is a search before it is a command");
  assert(
    list.some((e) => e.label === "Loki"),
    "the matching project is found",
  );
  const last = list[list.length - 1];
  assert(last.kind === "run-command", "the ask row is last");
  assert(last.label === "Ask Loki to do: “loki”", `and says what it does: ${last.label}`);
});

check("Enter opens the best match, and never sends words to an agent by default", () => {
  const found = filterPaletteEntries({
    entries,
    query: "loki",
    recent: [],
    pending: false,
    projectNames: [],
  });
  assert(enterTarget(found, 0, false)?.kind !== "run-command", "Enter opens the top match");
  const nothing = filterPaletteEntries({
    entries,
    query: "running",
    recent: [],
    pending: false,
    projectNames: [],
  });
  const askAt = nothing.findIndex((e) => e.kind === "run-command");
  assert(enterTarget(nothing, askAt, false) === null, "Enter alone does not start a task");
  assert(
    enterTarget(nothing, askAt, true)?.kind === "run-command",
    "chosen with the arrow keys, it does",
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
  assert(
    list[list.length - 1].labelMatches === undefined,
    "the ask row marks nothing — it quotes the query",
  );
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
].map((name, i) => ({ id: `f${i}`, name }));
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
    })[0];
    assert(
      first?.kind === "project" && first.label.toLowerCase() === name.toLowerCase(),
      `${typed} → ${first?.label}`,
    );
  }
});

async function main() {
  // Two of 544 are not first, and each is a real collision rather than a
  // failure to forgive: "dato"/"acto" are one slip from Cato AND from another
  // word on the list (a "data" template, "account"). The four that spelled a
  // "Switch <project> to <agent>" row ("catto") went with those rows.
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
