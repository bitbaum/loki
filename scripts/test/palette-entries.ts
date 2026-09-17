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
 *
 * Run: npx tsx scripts/test/palette-entries.ts
 */
import {
  buildPaletteEntries,
  filterPaletteEntries,
  SWITCHABLE_AGENT_IDS,
  type PaletteEntry,
} from "@/components/shell/palette-entries";

let passed = 0;
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

console.log(`\n${passed}/${passed} passed`);
