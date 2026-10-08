// The terminal's tabs can be moved, pinned and grouped, and read as names.
//
// Operator ask 2026-10-08: "can I also move them around, group them" and
// "why is it showing this unhelpful ugliness" (32-hex names, a second list of
// the same sessions under the strip).
// Run: npx tsx scripts/test/terminal-tab-order.ts
import { readFileSync } from "fs";
import { join } from "path";
import {
  EMPTY_LAYOUT,
  arrangeTabs,
  moveTab,
  nudgeTab,
  parseTabLayout,
  readableTabName,
  togglePin,
} from "@/components/terminal/terminal-tab-order";

let pass = 0;
let fail = 0;
function ok(cond: unknown, label: string) {
  if (cond) pass++;
  else {
    fail++;
    console.error(`✗ ${label}`);
  }
}
const eq = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const project = (t: string) => t.split("~")[0];

// No saved layout: the runner's order.
ok(
  eq(arrangeTabs(["a", "b", "c"], EMPTY_LAYOUT, project), ["a", "b", "c"]),
  "default is runner order",
);

// Saved order wins; a session that vanished is skipped; a new one goes last.
const saved = { ...EMPTY_LAYOUT, order: ["c", "gone", "a"] };
ok(eq(arrangeTabs(["a", "b", "c"], saved, project), ["c", "a", "b"]), "saved order, new tab last");

// Pinned first, order kept inside each side.
const pinned = { ...EMPTY_LAYOUT, pinned: ["c"] };
ok(eq(arrangeTabs(["a", "b", "c"], pinned, project), ["c", "a", "b"]), "pinned goes first");

// Group by project clusters lanes of one project, in first-seen order.
const tabs = ["x~1", "y", "x~2", "z", "y~3"];
const grouped = { ...EMPTY_LAYOUT, groupByProject: true };
ok(
  eq(arrangeTabs(tabs, grouped, project), ["x~1", "x~2", "y", "y~3", "z"]),
  "group clusters by project",
);
ok(
  eq(arrangeTabs(tabs, { ...grouped, pinned: ["z"] }, project), ["z", "x~1", "x~2", "y", "y~3"]),
  "pinned still leads when grouped",
);

// Moving: forward lands after the target, backward before it.
const shown = ["a", "b", "c", "d"];
ok(
  eq(moveTab(EMPTY_LAYOUT, shown, "a", "c").order, ["b", "c", "a", "d"]),
  "move right lands after target",
);
ok(
  eq(moveTab(EMPTY_LAYOUT, shown, "d", "b").order, ["a", "d", "b", "c"]),
  "move left lands before target",
);
ok(moveTab(EMPTY_LAYOUT, shown, "a", "a") === EMPTY_LAYOUT, "dropping on itself changes nothing");
ok(moveTab(EMPTY_LAYOUT, shown, "a", "zz") === EMPTY_LAYOUT, "an unknown target changes nothing");
ok(eq(nudgeTab(EMPTY_LAYOUT, shown, "b", 1).order, ["a", "c", "b", "d"]), "nudge right");
ok(nudgeTab(EMPTY_LAYOUT, shown, "a", -1) === EMPTY_LAYOUT, "nudge past the edge changes nothing");

// Crossing the pin boundary changes the pin, so the result matches what is shown.
const withPin = { ...EMPTY_LAYOUT, pinned: ["a"] };
const crossed = moveTab(withPin, ["a", "b", "c"], "c", "a");
ok(crossed.pinned.includes("c"), "dropping among pinned tabs pins it");
const out = moveTab(withPin, ["a", "b", "c"], "a", "c");
ok(!out.pinned.includes("a"), "dropping among unpinned tabs unpins it");
ok(
  eq(
    arrangeTabs(["a", "b", "c"], crossed, project),
    crossed.order
      .filter((t) => crossed.pinned.includes(t))
      .concat(crossed.order.filter((t) => !crossed.pinned.includes(t))),
  ),
  "the arrangement after a cross-boundary drop is stable",
);

ok(eq(togglePin(EMPTY_LAYOUT, "a").pinned, ["a"]), "pin");
ok(eq(togglePin({ ...EMPTY_LAYOUT, pinned: ["a"] }, "a").pinned, []), "unpin");

// Parsing never throws and drops junk.
ok(eq(parseTabLayout("nope"), EMPTY_LAYOUT), "bad JSON is an empty layout");
ok(
  eq(parseTabLayout('{"order":["a",3],"pinned":"x","groupByProject":1}'), {
    order: ["a"],
    pinned: [],
    groupByProject: false,
  }),
  "junk fields are dropped",
);

// Names.
ok(
  readableTabName("xhiva-art-refresh-300d1519783b47d3ab1c7ddb77c5febf") === "xhiva-art-refresh",
  "32-hex suffix is dropped",
);
ok(readableTabName("farmhouse") === "farmhouse", "a plain name is unchanged");
ok(
  readableTabName("300d1519783b47d3ab1c7ddb77c5febf") === "300d1519783b47d3ab1c7ddb77c5febf",
  "a name that is only hex is kept",
);

// The miss screen no longer repeats the strip.
const miss = readFileSync(
  join(process.cwd(), "src/components/terminal/TerminalSessionMiss.tsx"),
  "utf8",
);
ok(
  !/Running on/.test(miss) && !/ui-term-miss-chip/.test(miss),
  "the miss screen does not list the sessions again",
);

if (fail) {
  console.error(`terminal-tab-order: ${fail} failed, ${pass} passed`);
  process.exit(1);
}
console.log(`terminal-tab-order: ${pass} passed`);
