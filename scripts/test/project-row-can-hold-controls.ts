/**
 * The project row is ONE target, and it is never a wrapping anchor.
 *
 * The row WAS a single `<Link>` wrapping everything. HTML forbids interactive
 * content inside an anchor, so nothing in the row could ever be its own
 * control. The fix was a stretched link: the NAME is the link and its
 * `::after` covers the row. That invariant now lives in ListRow, which every
 * collection uses — and since the design reset (2026-10-21) the project row
 * is a ListRow with nothing else in it: no health chip, no rail, no badges
 * (checks and counts are on the project page).
 *
 * So this pins: the row is a ListRow given an `href`; ListRow makes the title
 * the link with a stretched `::after`; and the row carries no control of its
 * own that would need to sit above that link.
 *
 * And the words: what the row says is lib/project-list-line.ts, checked here
 * by behaviour — the first true answer wins, broken before busy before
 * waiting-on-you before how it is.
 *
 * Run: npx tsx scripts/test/project-row-can-hold-controls.ts
 */
import { readFileSync } from "fs";
import { join } from "path";
import { isArchivedProject, projectListLine } from "../../src/lib/project-list-line";

const strip = (s: string) =>
  s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
const row = strip(
  readFileSync(join(process.cwd(), "src/components/projects/ProjectRow.tsx"), "utf8"),
);
const listRow = strip(readFileSync(join(process.cwd(), "src/components/ui/list-row.tsx"), "utf8"));
const css = readFileSync(join(process.cwd(), "src/app/globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

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

console.log("project-row-can-hold-controls:");

check("the row is a ListRow that opens the project", () => {
  assert(row.includes("<ListRow"), "ProjectRow does not render a ListRow");
  assert(
    /href=\{`\/projects\/\$\{project\.id\}`\}/.test(row),
    "the row does not open /projects/<id>",
  );
  assert(!/<Link\b/.test(row), "ProjectRow wraps its own <Link> again");
});

check("ListRow: the title is the link, stretched over the row", () => {
  assert(
    /<Link\s+href=\{href\}[^>]*?className="ui-listrow-hit/.test(listRow),
    "the title is not the link",
  );
  const at = css.indexOf(".ui-listrow-hit::after {");
  assert(at !== -1, ".ui-listrow-hit::after is not defined");
  const block = css.slice(at, css.indexOf("}", at));
  assert(/inset:\s*0|inset-0/.test(block), "the link's ::after does not cover the row");
  assert(
    /\.ui-listrow-menu\s*\{[^}]*relative/.test(css),
    "a row's own menu does not sit above the link",
  );
});

check("the row carries no control of its own (one target)", () => {
  for (const banned of ["HealthScoreBar", "<button", "onClick", "ui-projects-rail"])
    assert(!row.includes(banned), `ProjectRow carries ${banned}`);
});

check("the line: broken, then busy, then waiting on you, then how it is", () => {
  const base = { attrs: {} as Record<string, string>, liveUrl: null, siteOk: null };
  const down = projectListLine(
    { ...base, liveUrl: "https://a.ch", siteOk: false },
    { runNow: "building", newNotes: 3 },
  );
  assert(down.text === "Site is down" && down.tone === "negative", `down said ${down.text}`);
  const busy = projectListLine(base, { runNow: "building", newNotes: 3 });
  assert(busy.text === "Building now", `busy said ${busy.text}`);
  const waiting = projectListLine(base, { runNow: "needs_you", newNotes: 3 });
  assert(
    waiting.tone === "warning" && /^Needs you/.test(waiting.text),
    `waiting said ${waiting.text}`,
  );
  const notes = projectListLine(base, { newNotes: 3 });
  assert(
    notes.text === "Needs you: 3 notes" && notes.tone === "warning",
    `notes said ${notes.text}`,
  );
  const one = projectListLine(base, { newNotes: 1 });
  assert(one.text === "Needs you: 1 note", `one said ${one.text}`);
  const fresh = projectListLine(base, {});
  assert(fresh.text === "Not started yet" && fresh.tone === null, `fresh said ${fresh.text}`);
  const worked = projectListLine(base, { lastRunAt: "2026-10-20T12:00:00Z" });
  assert(worked.text === "Not live yet", `worked said ${worked.text}`);
  const paused = projectListLine({ ...base, attrs: { status: "paused" } }, {});
  assert(paused.text === "Paused" && paused.tone === null, `paused said ${paused.text}`);
});

check("no internal words or counts on the row", () => {
  const said = [
    projectListLine({ attrs: {}, liveUrl: null, siteOk: null }, {}).text,
    projectListLine({ attrs: {}, liveUrl: "https://a.ch", siteOk: true }, {}).text,
    projectListLine({ attrs: {}, liveUrl: null, siteOk: null }, { runNow: "stalled" }).text,
  ].join(" ");
  assert(!/checks|runner|dispatch|connected|https?:/i.test(said), `the row says: ${said}`);
});

check("archived: marked archived, or an earlier `-refresh-<hex>` copy — nothing else", () => {
  assert(isArchivedProject({ name: "x", attrs: { status: "archived" } }), "archived stage");
  assert(
    isArchivedProject({ name: "xhiva-art-refresh-300d4c1e9b8a4f6e8b1d2a7c5e9f0b13", attrs: {} }),
    "refresh copy",
  );
  assert(!isArchivedProject({ name: "xhiva", attrs: { status: "production" } }), "a live project");
  assert(!isArchivedProject({ name: "my-refresh-site", attrs: {} }), "a name with refresh in it");
});

console.log(failures === 0 ? "  all good" : `  ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
