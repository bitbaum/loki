/**
 * Every search box forgives one slip, and keeps the order it promises.
 *
 * WHY THIS EXISTS
 *
 * Loki's lists filtered with `text.toLowerCase().includes(q)`, so one wrong
 * letter emptied them. They now go through @bitbaum/searchkit via
 * `lib/search.ts`, in one of two ways, and this pins which is which:
 *
 *   - rankByQuery: best match first (pickers, the prompt library).
 *   - filterByQuery: the matches in the list's OWN order — where the operator
 *     chose a sort, or the order is the point (deadlines, recency, a tree).
 *     Re-ranking those would overrule a choice the operator made.
 *
 * The palette and the people search have their own suites
 * (palette-entries.ts, people-search.ts).
 *
 * Run: npx tsx scripts/test/search-surfaces.ts
 */
import { evaluate, typoCases } from "@bitbaum/searchkit";
import { PROMPT_TEMPLATES } from "@/config/prompt-library";
import { filterGoalTree } from "@/lib/goal-search";
import { filterProjects } from "@/lib/projects-page-stats";
import { PROMPT_SEARCH_SPEC } from "@/lib/prompt-search";
import { filterByQuery, rankByQuery, TEXT_SPEC } from "@/lib/search";
import type { ProjectGridRow } from "@/components/projects/project-grid-row";

let passed = 0;
function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
async function check(label: string, fn: () => void | Promise<void>) {
  await fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
}

const NAMES = ["Kivvi", "Loki", "OrangeCat", "Substrata", "Solon"];

async function main() {
  await check("a blank query changes nothing", () => {
    assert(rankByQuery(NAMES, TEXT_SPEC, " ").join() === NAMES.join(), "rank keeps the list");
    assert(filterByQuery(NAMES, TEXT_SPEC, "").join() === NAMES.join(), "filter keeps the list");
  });

  await check("rank puts the best match first; filter keeps the list's order", () => {
    const list = ["Solon Archive", "Solon"];
    assert(rankByQuery(list, TEXT_SPEC, "solon")[0] === "Solon", "the exact name leads");
    assert(filterByQuery(list, TEXT_SPEC, "solon").join() === list.join(), "order untouched");
  });

  await check("one wrong letter still finds the name", () => {
    for (const [typed, name] of [
      ["lkoi", "Loki"],
      ["kivi", "Kivvi"],
      ["orange cat", "OrangeCat"],
      ["subsrtata", "Substrata"],
    ] as const) {
      assert(rankByQuery(NAMES, TEXT_SPEC, typed)[0] === name, `${typed} → ${name}`);
    }
  });

  await check("prompt library: one slip in a prompt's name still puts it first", async () => {
    const names = PROMPT_TEMPLATES.map((t) => ({ id: t.id, name: t.name }));
    const cases = typoCases(names);
    const report = await evaluate(cases, (q) =>
      rankByQuery(PROMPT_TEMPLATES, PROMPT_SEARCH_SPEC, q).map((t) => t.id),
    );
    console.log(
      `      ${report.cases} one-slip queries over ${names.length} prompts · ` +
        `success@1 ${report.successAt1.toFixed(3)} · success@3 ${report.successAt3.toFixed(3)} · ` +
        `no results ${report.zeroResults.toFixed(3)}`,
    );
    for (const m of report.misses) console.log(`      miss: ${m.query} → ${m.got.join(", ")}`);
    // Two known misses: "next" with its n dropped is "ext" — three letters,
    // which may not carry a typo — and when no prompt has every word, the
    // LAST word is set aside, not the one that matched nothing. Any other
    // miss fails this.
    const known = new Set(["ext best step", "ext best task"]);
    const unexpected = report.misses.filter((m) => !known.has(m.query));
    assert(report.zeroResults === 0, "no one-slip query comes back empty");
    assert(unexpected.length === 0, `misses: ${unexpected.map((m) => m.query).join(", ")}`);
    assert(report.successAt1 >= 0.99, `success@1 ${report.successAt1}`);
  });

  await check("projects page: a slip still matches, and the chosen sort still orders", () => {
    const row = (name: string, description: string | null = null): ProjectGridRow => ({
      id: name,
      name,
      description,
      attrs: {},
    });
    const projects = [row("Substrata"), row("Loki"), row("Solon", "governance for Substrata")];
    const az = filterProjects(projects, "substarta", null, undefined, "az").map((p) => p.name);
    assert(az.join() === "Solon,Substrata", `az order kept over relevance: ${az.join()}`);
    assert(
      filterProjects(projects, "lkoi", null)
        .map((p) => p.name)
        .join() === "Loki",
      "lkoi",
    );
  });

  await check("goals: a slip finds a sub-goal and keeps the path to it", () => {
    const goal = (title: string, children: Goal[] = []): Goal => ({
      title,
      description: null,
      children,
    });
    type Goal = { title: string; description: string | null; children: Goal[] };
    const tree = [
      goal("Health", [goal("Run a marathon"), goal("Sleep eight hours")]),
      goal("Ship Loki"),
    ];
    const kept = filterGoalTree(tree, "marathn");
    assert(kept.length === 1 && kept[0].title === "Health", "the parent stays as the path");
    assert(
      kept[0].children.map((g) => g.title).join() === "Run a marathon",
      "only the child that matched",
    );
    assert(filterGoalTree(tree, "").length === 2, "no query, whole tree");
  });

  console.log(`\nsearch-surfaces: ${passed} passed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
