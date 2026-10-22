/**
 * A phone must be able to see the thing the list is ordered by.
 *
 * /projects sorts by recency ("Priority" = problems first, then most recent
 * agent run; "Recent" = most recent run). Its old row put "active … ago" and
 * the open-feedback count in a right-hand column marked `sm:flex` — so on a
 * phone none of them rendered, and the page asked you to trust an order whose
 * evidence it hid on the viewport where it matters most.
 *
 * Since the design reset (2026-10-21) the row is a ListRow: its ONE trailing
 * fact is how long since an agent last worked on the project, the same clock
 * the sort reads, and a ListRow draws its trailing fact at every width. This
 * test pins that intent, not a class name: the trailing fact is the last run,
 * nothing in the row hides at a breakpoint, and the words read the same clock.
 *
 * Run: npx tsx scripts/test/mobile-shows-what-the-list-sorts-by.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { projectListLine, projectListTrailing } from "../../src/lib/project-list-line";

const ROW = join(process.cwd(), "src/components/projects/ProjectRow.tsx");
const LIST_ROW = join(process.cwd(), "src/components/ui/list-row.tsx");
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const code = strip(readFileSync(ROW, "utf8"));
const listRow = strip(readFileSync(LIST_ROW, "utf8"));
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8");

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

console.log("mobile-shows-what-the-list-sorts-by:");

check("the row's trailing fact is the last agent run — the clock the sort reads", () => {
  assert(code.includes("<ListRow"), "ProjectRow is not a ListRow");
  assert(
    /trailing=\{projectListTrailing\(lastDispatchAt/.test(code),
    "the row's trailing fact is not the last run (projectListTrailing(lastDispatchAt))",
  );
});

check("nothing in the row hides at a breakpoint", () => {
  assert(
    !/\b(?:hidden|sm:hidden|sm:flex|md:hidden|max-sm:hidden)\b/.test(code),
    "ProjectRow hides something at a breakpoint — a phone loses a fact",
  );
  const trail = css.indexOf(".ui-listrow-trail {");
  assert(trail !== -1, ".ui-listrow-trail is not defined");
  const block = css.slice(trail, css.indexOf("}", trail));
  assert(!/\bhidden\b/.test(block), `the trailing fact hides somewhere: ${block}`);
  assert(listRow.includes("ui-listrow-trail"), "ListRow no longer draws its trailing fact");
});

check("the trailing fact and the line read the same clock", () => {
  const now = Date.parse("2026-10-21T12:00:00Z");
  const ran = new Date(now - 2 * 60 * 60 * 1000).toISOString();
  assert(projectListTrailing(ran, now) === "2h", `trailing said ${projectListTrailing(ran, now)}`);
  const line = projectListLine(
    { attrs: {}, liveUrl: "https://x.orangecat.ch", siteOk: true },
    { lastRunAt: ran, nowMs: now },
  );
  assert(line.text === "Live · updated 2h ago", `line said ${line.text}`);
  assert(projectListTrailing(null, now) === null, "a project never run shows no time");
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
