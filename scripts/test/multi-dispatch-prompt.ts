// One task, several projects — the pure half (src/lib/multi-dispatch-prompt.ts).
// Run: npx tsx scripts/test/multi-dispatch-prompt.ts
import { buildProjectTaskPrompt, normalizeTaskProjects } from "@/lib/multi-dispatch-prompt";

let pass = 0;
let fail = 0;
function ok(cond: boolean, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}

// normalize: trims, drops blanks, dedupes case-insensitively, keeps first spelling
const norm = normalizeTaskProjects([" OrangeCat ", "loki", "", "Loki", "orangecat", "solon"]);
ok(JSON.stringify(norm) === JSON.stringify(["OrangeCat", "loki", "solon"]), "normalize dedupes");

// one project → the task verbatim, no coordination preamble
ok(
  buildProjectTaskPrompt("  Fix the header  ", "Loki", ["Loki"]) === "Fix the header",
  "single project verbatim",
);

// several → names everyone, names THIS project, and lists only the others as siblings
const p = buildProjectTaskPrompt("Post prompts from both apps", "Loki", ["OrangeCat", "Loki"]);
ok(p.includes("sent to 2 projects at once: OrangeCat, Loki"), "preamble lists all projects");
ok(p.includes("You are working in Loki."), "preamble names this project");
ok(p.includes("OrangeCat is handling its own part"), "siblings exclude this project (singular)");
ok(p.endsWith("Post prompts from both apps"), "task follows the preamble verbatim");
ok(p.includes("state the contract you assumed"), "asks for cross-repo contracts");

const three = buildProjectTaskPrompt("x", "solon", ["OrangeCat", "Loki", "Solon"]);
ok(
  three.includes("OrangeCat, Loki are handling their own part"),
  "siblings plural, case-insensitive self match",
);

console.log(`${pass}/${pass + fail} multi-dispatch-prompt cases passed`);
if (fail > 0) process.exit(1);
