// Watch mode's trail and reports: privacy by construction (labels, never
// values; paths, never query strings), one report per distinct failure, and a
// report that names what broke before what led there.
// Run: npx tsx scripts/test/widget-watch.ts
import assert from "node:assert/strict";
import {
  describeControl,
  describeRequest,
  failureSignature,
  isFailedRequest,
  isNoiseError,
  pushTrail,
  TRAIL_MAX,
  watchReport,
  type TrailEntry,
} from "../../widget/watch-trail";
import { buildSuggestion } from "../../widget/report-payload";

let n = 0;
const check = (fn: () => void) => {
  fn();
  n++;
};

check(() => {
  assert.equal(
    describeControl({ tag: "BUTTON", text: "  Save\n project " }),
    "button “Save project”",
  );
  assert.equal(describeControl({ tag: "a", label: "Open profile" }), "link “Open profile”");
  // An input is named by its placeholder — what was typed never appears.
  assert.equal(
    describeControl({ tag: "input", type: "email", placeholder: "Your email" }),
    "email field “Your email”",
  );
  assert.equal(describeControl({ tag: "div", role: "button" }), "button");
});
check(() => {
  assert.equal(
    describeRequest("post", "https://orangecat.ch/api/projects?token=secret", 500),
    "POST /api/projects → 500",
  );
  assert.equal(describeRequest("get", "/shop/x", null), "GET /shop/x → no response");
  assert.equal(isFailedRequest(500), true);
  assert.equal(isFailedRequest(null), true);
  assert.equal(isFailedRequest(404), false);
});
check(() => {
  let t: TrailEntry[] = [];
  for (let i = 0; i < TRAIL_MAX + 5; i++) t = pushTrail(t, { at: i, kind: "tap", text: `b${i}` });
  assert.equal(t.length, TRAIL_MAX);
  const before = t.length;
  t = pushTrail(t, { at: 99, kind: "tap", text: `b${TRAIL_MAX + 4}` });
  assert.equal(t.length, before, "a repeat of the last entry is one fact");
});
check(() => {
  assert.equal(isNoiseError("ResizeObserver loop limit exceeded"), true);
  assert.equal(isNoiseError("Script error."), true);
  assert.equal(isNoiseError("TypeError: cannot read properties of undefined"), false);
  assert.equal(
    failureSignature({ kind: "request", text: "GET /api/projects/123 → 500" }),
    failureSignature({ kind: "request", text: "GET /api/projects/456 → 500" }),
  );
});
check(() => {
  const trail: TrailEntry[] = [
    { at: 1000, kind: "page", text: "/projects" },
    { at: 3000, kind: "tap", text: "button “Create”" },
  ];
  const r = watchReport({ kind: "request", text: "POST /api/projects → 500" }, trail, 5000);
  assert.match(r.message, /request failed: POST \/api\/projects → 500/);
  assert.equal(r.diagnostics["step 2"], "tap button “Create” (2s ago)");
  const s = buildSuggestion(r.message, r.diagnostics, 2000);
  assert.ok(s.length <= 2000 && s.includes("failure: POST /api/projects → 500"));
});

console.log(`${n}/5 widget-watch cases passed`);
