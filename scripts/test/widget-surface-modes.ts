import assert from "node:assert/strict";
import {
  defaultWidgetSurfaceMode,
  parseWidgetSurfaceModes,
  WIDGET_SURFACE_MODE_META,
} from "../../widget/surface-modes";

// Chat is the front door: the widget opens on a conversation with Loki.
assert.equal(defaultWidgetSurfaceMode(), "chat");
assert.deepEqual(parseWidgetSurfaceModes(null), ["report"]);
assert.deepEqual(parseWidgetSurfaceModes("report,chat,watch"), ["chat", "report", "watch"]);
assert.equal(WIDGET_SURFACE_MODE_META.report.shipped, true);
assert.equal(WIDGET_SURFACE_MODE_META.chat.shipped, true);
assert.equal(WIDGET_SURFACE_MODE_META.watch.shipped, false);
console.log("widget-surface-modes: ok");
