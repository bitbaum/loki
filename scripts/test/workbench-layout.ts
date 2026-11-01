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
assert.deepEqual(parseLayout(serializeLayout({ open: ["session"] })), { open: ["session"] });

// Garbage, the wrong shape, unknown ids: the default, or what is known.
assert.deepEqual(parseLayout("not json"), DEFAULT_WORKBENCH_LAYOUT);
assert.deepEqual(parseLayout("null"), DEFAULT_WORKBENCH_LAYOUT);
assert.deepEqual(parseLayout('{"open":"watch"}'), DEFAULT_WORKBENCH_LAYOUT);
assert.deepEqual(parseLayout('{"open":["site","session","session",3]}'), { open: ["session"] });
// Every pane closed is a choice, not an error.
assert.deepEqual(parseLayout('{"open":[]}'), { open: [] });

// Open and close never duplicate.
const closed = setPaneOpen(DEFAULT_WORKBENCH_LAYOUT, "session", false);
assert.deepEqual(closed.open, []);
assert.equal(isPaneOpen(closed, "session"), false);
assert.deepEqual(setPaneOpen(closed, "session", true).open, ["session"]);
assert.deepEqual(setPaneOpen(DEFAULT_WORKBENCH_LAYOUT, "session", true).open, ["session"]);

// ?pane= names a pane or nothing.
assert.equal(paneFromParam("session"), "session");
assert.equal(paneFromParam("site"), null);
assert.equal(paneFromParam(null), null);

// Keys and links are per project.
assert.equal(workbenchLayoutKey("p1"), "loki:workbench:p1");
assert.equal(workbenchHref("p1"), "/projects/p1/workbench");
assert.equal(workbenchHref("p1", "session"), "/projects/p1/workbench?pane=session");
assert.equal(workbenchWindowName("p1", "site"), "loki-workbench-p1-site");

// A remembered placement, or the safe one.
assert.equal(parsePlacement("other-screen"), "other-screen");
assert.equal(parsePlacement("beside"), "beside");
assert.equal(parsePlacement("moon"), "beside");

console.log("workbench-layout: ok");
