/**
 * The workbench's layout — which panes a window shows — survives storage and
 * ignores what it does not know.
 *
 * Run: npx tsx scripts/test/workbench-layout.ts
 */
import assert from "node:assert/strict";
import {
  DEFAULT_WORKBENCH_LAYOUT,
  isPaneOpen,
  paneFromParam,
  panesOnScreen,
  parseLayout,
  parsePlacement,
  serializeLayout,
  setPaneOpen,
  workbenchLayoutKey,
} from "../../src/lib/workbench/layout";
import { WORKBENCH_PANE_IDS, workbenchHref, workbenchWindowName } from "../../src/config/workbench";

// Default: every pane, in the registry's order.
assert.deepEqual(DEFAULT_WORKBENCH_LAYOUT.open, [...WORKBENCH_PANE_IDS]);

// Round trip.
assert.deepEqual(parseLayout(serializeLayout({ open: ["watch", "session"] })), {
  open: ["session", "watch"],
});

// Garbage, the wrong shape, unknown ids: the default, or what is known.
assert.deepEqual(parseLayout("not json"), DEFAULT_WORKBENCH_LAYOUT);
assert.deepEqual(parseLayout("null"), DEFAULT_WORKBENCH_LAYOUT);
assert.deepEqual(parseLayout('{"open":"watch"}'), DEFAULT_WORKBENCH_LAYOUT);
assert.deepEqual(parseLayout('{"open":["site","watch","watch",3]}'), { open: ["watch"] });
// Every pane closed is a choice, not an error.
assert.deepEqual(parseLayout('{"open":[]}'), { open: [] });

// Open and close keep the order and never duplicate.
const closed = setPaneOpen(DEFAULT_WORKBENCH_LAYOUT, "session", false);
assert.deepEqual(closed.open, ["watch"]);
assert.equal(isPaneOpen(closed, "session"), false);
assert.deepEqual(setPaneOpen(closed, "session", true).open, ["session", "watch"]);
assert.deepEqual(setPaneOpen(DEFAULT_WORKBENCH_LAYOUT, "watch", true).open, ["session", "watch"]);

// ?pane= names a pane or nothing.
assert.equal(paneFromParam("watch"), "watch");
assert.equal(paneFromParam("site"), null);
assert.equal(paneFromParam(null), null);

// Keys and links are per project.
assert.equal(workbenchLayoutKey("p1"), "loki:workbench:p1");
assert.equal(workbenchHref("p1"), "/projects/p1/workbench");
assert.equal(workbenchHref("p1", "watch"), "/projects/p1/workbench?pane=watch");
assert.equal(workbenchWindowName("p1", "site"), "loki-workbench-p1-site");

// A remembered placement, or the safe one.
assert.equal(parsePlacement("other-screen"), "other-screen");
assert.equal(parsePlacement("beside"), "beside");
assert.equal(parsePlacement("moon"), "beside");

// On screen: all open panes with room for columns; one of them without.
assert.deepEqual(panesOnScreen({ open: ["session", "watch"] }, true, null), ["session", "watch"]);
assert.deepEqual(panesOnScreen({ open: ["session", "watch"] }, false, null), ["session"]);
assert.deepEqual(panesOnScreen({ open: ["session", "watch"] }, false, "watch"), ["watch"]);
// A focus on a closed pane falls back to the first open one.
assert.deepEqual(panesOnScreen({ open: ["session"] }, false, "watch"), ["session"]);
assert.deepEqual(panesOnScreen({ open: [] }, false, "watch"), []);

console.log("workbench-layout: ok");
