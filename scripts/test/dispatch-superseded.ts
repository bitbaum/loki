// A queued dispatch whose work is already over is never delivered — not after
// a restart, not when the queue ahead of it clears (Substrata 1fabd3b6,
// 2026-10-22: redid the /chat fix c7d57dc0 had shipped as #190).
import assert from "node:assert/strict";
import { dispatchSupersededReason } from "../../src/lib/dispatch-superseded";

assert.equal(dispatchSupersededReason({ runFinished: false, feedbackStatus: "dispatched" }), null);
assert.equal(dispatchSupersededReason({ runFinished: false, feedbackStatus: null }), null);
assert.match(
  dispatchSupersededReason({ runFinished: true, feedbackStatus: null }) ?? "",
  /already closed/,
);
assert.match(
  dispatchSupersededReason({ runFinished: false, feedbackStatus: "resolved" }) ?? "",
  /already done/,
);
assert.match(
  dispatchSupersededReason({ runFinished: false, feedbackStatus: "archived" }) ?? "",
  /filed away/,
);
console.log("dispatch-superseded: ok");
