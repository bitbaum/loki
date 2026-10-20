/**
 * /prompts as the owner found it on an Android phone, 2026-10-20 — pinned so
 * none of it comes back:
 *
 *   • "Next Best Step" saved four times, word for word, and the create path
 *     happy to save a fifth. Saving the same name + words now answers with the
 *     prompt already saved; the extra rows go only by an explicit tap.
 *   • The Run dialog of a saved copy showed "{{project_name}}" with no field
 *     to fill it: a copy is saved as global, and only scope asked for a project.
 *   • Project pickers listed raw keys ("…-refresh-68e1f4947961…").
 *   • Category chips in amber — and "Control" beside "Fleet Control", two
 *     names for one category.
 *
 * Run: npx tsx scripts/test/prompts-page.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { needsProject } from "../../src/lib/prompt-vars";
import {
  CATEGORY_META,
  CATEGORY_TO_GROUP,
  GROUP_META,
  PROMPT_TEMPLATES,
} from "../../src/config/prompt-library";
import { savedPromptAsTemplate } from "../../src/lib/prompt-search";

const ROOT = join(new URL(".", import.meta.url).pathname, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

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

console.log("prompts-page:");

check("a saved copy that names {{project_name}} asks for a project", () => {
  const nextBest = PROMPT_TEMPLATES.find((t) => t.id === "next-best-step")!;
  const copy = savedPromptAsTemplate({
    id: "x",
    name: nextBest.name,
    description: nextBest.description,
    body: nextBest.template,
    scope: "global", // how a copy of a default is saved
    tags: [],
    runCount: 0,
  });
  assert.equal(copy.scope, "global");
  assert.equal(needsProject(copy), true);
});

check("a prompt with no project in it does not ask for one", () => {
  assert.equal(needsProject({ scope: "global", template: "Summarise {{topic|today}}" }), false);
  assert.equal(needsProject({ scope: "project", template: "No variables" }), true);
});

check("one fleet category, one name", () => {
  assert.ok(!("control" in CATEGORY_META), "a second id for the fleet prompts is back");
  assert.ok(!PROMPT_TEMPLATES.some((t) => (t.category as string) === "control"));
  assert.equal(CATEGORY_META.fleet.label, GROUP_META.fleet.label);
  const labels = Object.values(CATEGORY_META).map((m) => m.label.toLowerCase());
  assert.equal(new Set(labels).size, labels.length, "two categories share a label");
  for (const c of Object.keys(CATEGORY_META))
    assert.ok(c in CATEGORY_TO_GROUP, `${c} has no group`);
});

check("category chips carry no colour", () => {
  for (const meta of Object.values(CATEGORY_META)) {
    assert.deepEqual(Object.keys(meta), ["label"], "a category gained a colour again");
  }
  assert.ok(!/\.ui-cat-/.test(read("src/app/globals.css")), "ui-cat-* colours are back");
});

check("saving the same prompt twice returns the first, not a copy", () => {
  const route = read("src/app/api/prompts/route.ts");
  const find = route.indexOf("findIdenticalPrompt(userId");
  const create = route.indexOf("createPrompt(userId");
  assert.ok(find > 0 && create > find, "POST must look for the identical prompt before inserting");
  assert.match(route, /existing: true/);
});

check("extra copies go only by the explicit route, and only the caller's own", () => {
  const q = read("src/db/queries/prompts.ts");
  const fn = q.slice(q.indexOf("export async function removeIdenticalCopies"));
  assert.match(fn.slice(0, 1600), /eq\(prompts\.userId, userId\)/);
  assert.match(fn.slice(0, 1600), /isActive: false/, "removal must be the soft delete");
  const section = read("src/components/prompts/UserPromptsSection.tsx");
  assert.match(section, /Remove \{extraCopies\} extra/, "the button must state the count");
});

check("Create cannot save an empty prompt, and says what is missing", () => {
  const section = read("src/components/prompts/UserPromptsSection.tsx");
  assert.match(section, /disabled=\{saving \|\| !!missingSentence\}/);
  assert.match(section, /\{missingSentence && \(/);
});

check("project pickers show the name a person uses, not the folder key", () => {
  for (const f of [
    "src/components/prompts/PromptProjectField.tsx",
    "src/components/prompts/UserPromptsSection.tsx",
  ]) {
    const src = read(f);
    assert.ok(!/<option[^>]*>\s*\{p\.name\}/.test(src), `${f} lists project keys`);
  }
  assert.match(read("src/app/(app)/prompts/page.tsx"), /title: projectTitle\(p\)/);
});

check("disabled actions in the dialogs say why beside them", () => {
  const run = read("src/components/prompts/RunModal.tsx");
  assert.match(run, /Pick a project to send it to that project's session\./);
  assert.match(run, /Loki answers here, in this window\./);
  const schedule = read("src/components/prompts/ScheduleModal.tsx");
  assert.match(schedule, /Pick a project first\./);
  assert.match(schedule, /className="ui-btn-primary min-h-11 shrink-0"/);
  assert.match(schedule, /\{blocked && </);
});

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall passed");
