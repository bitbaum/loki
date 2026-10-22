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
import { needsProject, promptBodyParts, promptPlainText } from "../../src/lib/prompt-vars";
import { promptWorker, sendResultLine } from "../../src/lib/prompt-run";
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
  const form = read("src/components/prompts/PromptForm.tsx");
  assert.match(form, /disabled=\{saving \|\| !!missingSentence\}/);
  assert.match(form, /\{missingSentence && /);
});

check("project pickers show the name a person uses, not the folder key", () => {
  for (const f of [
    "src/components/prompts/PromptProjectField.tsx",
    "src/components/prompts/PromptForm.tsx",
  ]) {
    const src = read(f);
    assert.ok(!/<option[^>]*>\s*\{p\.name\}/.test(src), `${f} lists project keys`);
  }
  assert.match(read("src/app/(app)/prompts/page.tsx"), /title: projectTitle\(p\)/);
});

check("disabled actions in the sheets say why above them", () => {
  const run = read("src/components/prompts/RunModal.tsx");
  assert.match(run, /Pick a project to run it there\./);
  assert.match(run, /\{footReason && !sent && /);
  const schedule = read("src/components/prompts/ScheduleModal.tsx");
  assert.match(schedule, /Pick a project first\./);
  assert.match(schedule, /\{blocked && </);
  assert.ok(!/cron line|cron job|schedule as cron/i.test(schedule), "the sheet never says cron");
  assert.ok(
    !/cron job/i.test(read("src/components/prompts/UserPromptsSection.tsx")),
    "the row menu never says cron",
  );
});

check("a blank never reaches the screen as {{braces}}", () => {
  const body = "Scan {{project_name}} on {{branch|main}} for {{ticket_id}}.";
  const parts = promptBodyParts(body, {});
  assert.ok(!parts.some((p) => "text" in p && p.text.includes("{{")), "braces leaked");
  assert.deepEqual(
    parts.filter((p) => "blank" in p).map((p) => ("blank" in p ? p.blank : "")),
    ["project", "ticket id"],
  );
  assert.equal(
    promptPlainText(body, { project_name: "substrata" }),
    "Scan substrata on main for [ticket id].",
  );
  for (const t of PROMPT_TEMPLATES)
    assert.ok(!promptPlainText(t.template).includes("{{"), `${t.id} leaks a raw blank`);
});

check("ONE Run: project work goes to the agent, personal prompts to Loki", () => {
  assert.equal(promptWorker({ category: "security" }), "agent");
  assert.equal(promptWorker({ category: "personal" }), "loki");
  const run = read("src/components/prompts/RunModal.tsx");
  assert.equal((run.match(/className="ui-btn-primary/g) ?? []).length, 1, "one filled button");
});

check("a send ends in one plain sentence, never the queue's own words", () => {
  const failed = sendResultLine({ status: "failed", project: "Substrata" });
  assert.equal(failed.failed, true);
  assert.equal(failed.text, "It could not start in Substrata. Try again.");
  const waiting = sendResultLine({ status: null, waitingForBuilder: true, project: "Substrata" });
  assert.match(waiting.text, /as soon as a builder is online/);
  for (const status of [
    null,
    "queued",
    "working",
    "delivered",
    "completed",
    "partial",
    "stopped",
    "unconfirmed",
    "failed",
  ] as const) {
    const { text } = sendResultLine({ status, project: "Substrata" });
    assert.ok(!/dispatch|runner|tab\b/i.test(text), `"${text}" uses an internal word`);
  }
  assert.match(read("src/components/prompts/RunModal.tsx"), /Watch it work/);
});

check("Send to terminal starts a repo-only project through the inject core", () => {
  // 2026-10-21: "no running agent for 'substrata' on this runner" — a project
  // with a repository but no folder got a bare inject, which only reaches an
  // agent that already exists. Such a project now takes the same
  // start-or-queue path /api/inject does.
  const route = read("src/app/api/control/tab-inject/route.ts");
  const branch = route.indexOf("if (project && !project.dirPath)");
  assert.ok(branch > 0, "no branch for a project without a folder");
  assert.ok(
    route.indexOf("injectPrompt(", branch) > branch,
    "the repo-only branch must hand off to injectPrompt",
  );
  assert.ok(
    branch < route.indexOf("enqueueInjectCommand(userId"),
    "the hand-off must come before the bare inject",
  );
  assert.match(route, /from "@\/lib\/inject-core"/);
});

check("Run with Loki streams the answer as the chat draws it", () => {
  const run = read("src/components/prompts/RunModal.tsx");
  assert.match(run, /useSessionAsk\(/, "the streaming chat thread, not a one-shot POST");
  assert.match(run, /<ChatThread/);
  assert.match(run, /onStop=\{ask\.stop\}/);
  assert.ok(!run.includes('postJson("/api/loki"'), "the silent one-shot is back");
});

if (failures > 0) {
  console.log(`\n${failures} failure(s)`);
  process.exit(1);
}
console.log("\nall passed");
