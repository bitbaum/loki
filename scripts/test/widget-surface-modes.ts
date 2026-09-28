import assert from "node:assert/strict";
import {
  defaultWidgetSurfaceMode,
  initialWidgetSurfaceMode,
  parseWidgetSurfaceModes,
  WIDGET_SURFACE_MODE_META,
} from "../../widget/surface-modes";

assert.equal(defaultWidgetSurfaceMode(), "report");
// No attribute: request a change, or ask Loki first. Explicit lists are kept as written.
assert.deepEqual(parseWidgetSurfaceModes(null), ["report", "ask"]);
assert.deepEqual(parseWidgetSurfaceModes("report"), ["report"]);
assert.deepEqual(parseWidgetSurfaceModes("ask,report"), ["ask", "report"]);
assert.deepEqual(parseWidgetSurfaceModes("report,chat,watch"), ["report", "chat", "watch"]);
// The embed's order is kept: the first listed mode is the one the panel opens in.
assert.deepEqual(parseWidgetSurfaceModes("chat, report, chat, nonsense"), ["chat", "report"]);
assert.deepEqual(parseWidgetSurfaceModes("nonsense"), ["report", "ask"]);
assert.equal(initialWidgetSurfaceMode(["chat", "report"]), "chat");
assert.equal(initialWidgetSurfaceMode(["report", "chat"]), "report");
// An unshipped mode listed first is skipped rather than opening a dead tab.
assert.equal(initialWidgetSurfaceMode(["watch", "chat"]), "chat");
assert.equal(WIDGET_SURFACE_MODE_META.report.shipped, true);
assert.equal(WIDGET_SURFACE_MODE_META.chat.shipped, true);
assert.equal(WIDGET_SURFACE_MODE_META.ask.shipped, true);
assert.equal(WIDGET_SURFACE_MODE_META.watch.shipped, false);
console.log("widget-surface-modes: ok");
