/**
 * Starting a session answers with where a person opens it.
 *
 * An agent that starts Claude Code in a Loki session (tab-inject, /api/inject,
 * MCP loki_dispatch, agent/launch) hands the owner the session to look at. The
 * Terminal's URL was built only inside the app's own cards, so a caller had to
 * guess it. Every start now returns `openUrl`, built by the same helper.
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import { sessionOpenUrl, terminalHref } from "../../src/lib/dispatch-card";
import { APP_URL } from "../../src/config/brand";

const read = (p: string) => fs.readFileSync(p, "utf8");
const run = "11111111-1111-4111-8111-111111111111";

assert.equal(
  sessionOpenUrl("loki", "cloud"),
  `${APP_URL}/terminal?source=cloud&project=loki`,
  "a cloud link names its builder, so a phone that last chose its computer still opens the cloud session",
);
assert.equal(sessionOpenUrl("loki", null, run), `${APP_URL}/terminal?project=loki&run=${run}`);
assert.equal(
  sessionOpenUrl("site", "local", run),
  `${APP_URL}/terminal?source=machine&tab=site&run=${run}`,
  "a session on the owner's computer opens on This computer",
);
assert.equal(
  sessionOpenUrl("site~1a2b3c4d", "cloud"),
  `${APP_URL}/terminal?source=cloud&project=${encodeURIComponent("site~1a2b3c4d")}`,
  "a parallel lane opens as its own tab",
);
assert.equal(
  sessionOpenUrl("site", null),
  `${APP_URL}${terminalHref("site", null)}`,
  "no builder known: the Terminal's own choice",
);
assert.ok(APP_URL.startsWith("https://"), "a link a person can open");

const inject = read("src/app/api/control/tab-inject/route.ts");
assert.equal(
  (inject.match(/openUrl: sessionOpenUrl\(/g) ?? []).length,
  3,
  "tab-inject: the live, dispatch and queued answers all carry openUrl",
);
assert.match(
  read("src/lib/inject-core.ts"),
  /openUrl: sessionOpenUrl\(queued\?\.parallelTab \?\? effectiveTab, channel, runId \?\? null\)/,
  "/api/inject and MCP loki_dispatch: the session it went to, lane included",
);
assert.equal(
  (read("src/app/api/agent/launch/route.ts").match(/openUrl: sessionOpenUrl\(/g) ?? []).length,
  2,
  "agent/launch: queued and direct",
);

console.log("session-open-url ok");
