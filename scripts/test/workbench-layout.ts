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
assert.deepEqual(parseLayout(serializeLayout({ open: ["loki", "session"] })), {
  open: ["session", "loki"],
});

// Garbage, the wrong shape, unknown ids: the default, or what is known.
assert.deepEqual(parseLayout("not json"), DEFAULT_WORKBENCH_LAYOUT);
assert.deepEqual(parseLayout("null"), DEFAULT_WORKBENCH_LAYOUT);
assert.deepEqual(parseLayout('{"open":"loki"}'), DEFAULT_WORKBENCH_LAYOUT);
assert.deepEqual(parseLayout('{"open":["site","loki","loki",3]}'), { open: ["loki"] });
// Every pane closed is a choice, not an error.
assert.deepEqual(parseLayout('{"open":[]}'), { open: [] });

// Open and close keep the order and never duplicate.
const closed = setPaneOpen(DEFAULT_WORKBENCH_LAYOUT, "session", false);
assert.deepEqual(closed.open, ["loki"]);
assert.equal(isPaneOpen(closed, "session"), false);
assert.deepEqual(setPaneOpen(closed, "session", true).open, ["session", "loki"]);
assert.deepEqual(setPaneOpen(DEFAULT_WORKBENCH_LAYOUT, "loki", true).open, ["session", "loki"]);

// ?pane= names a pane or nothing.
assert.equal(paneFromParam("loki"), "loki");
assert.equal(paneFromParam("site"), null);
assert.equal(paneFromParam(null), null);

// Keys and links are per project.
assert.equal(workbenchLayoutKey("p1"), "loki:workbench:p1");
assert.equal(workbenchHref("p1"), "/projects/p1/workbench");
assert.equal(workbenchHref("p1", "loki"), "/projects/p1/workbench?pane=loki");
assert.equal(workbenchWindowName("p1", "site"), "loki-workbench-p1-site");

// A remembered placement, or the safe one.
assert.equal(parsePlacement("other-screen"), "other-screen");
assert.equal(parsePlacement("beside"), "beside");
assert.equal(parsePlacement("moon"), "beside");

// On screen: all open panes with room for columns; one of them without.
assert.deepEqual(panesOnScreen({ open: ["session", "loki"] }, true, null), ["session", "loki"]);
assert.deepEqual(panesOnScreen({ open: ["session", "loki"] }, false, null), ["session"]);
assert.deepEqual(panesOnScreen({ open: ["session", "loki"] }, false, "loki"), ["loki"]);
// A focus on a closed pane falls back to the first open one.
assert.deepEqual(panesOnScreen({ open: ["session"] }, false, "loki"), ["session"]);
assert.deepEqual(panesOnScreen({ open: [] }, false, "loki"), []);

console.log("workbench-layout: ok");
