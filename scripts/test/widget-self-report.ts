// The widget reporting on ITSELF: the page's problems go to the site, Loki's
// go to Loki — and only the owner's browser speaks unasked.
// Run: npx tsx scripts/test/widget-self-report.ts
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildSelfReport,
  hostOrigin,
  selfReportNeedsOwner,
  selfReportStartsBuild,
  WIDGET_SELF_DETAIL_MAX,
  WIDGET_SELF_KINDS,
  WIDGET_SELF_NOTE_MAX,
} from "../../src/lib/widget/self-report";
import { classifyOwnRequest, panelOverflow, SELF_SLOW_MS, selfSay } from "../../widget/self-watch";
import { SELF_DETAIL_MAX, SELF_NOTE_MAX } from "../../widget/self-report";
import { receiptLinkLabel, receiptText } from "../../widget/receipt";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");

let n = 0;
const check = (fn: () => void) => {
  fn();
  n++;
};

// ---- the server's words ----
check(() => {
  const r = buildSelfReport({
    kind: "request",
    detail: "POST /api/widget/advise answered 502 after 3.1s",
    url: "https://substrata.orangecat.ch/chat?x=1#frag",
    viewport: "390×844",
  });
  assert.match(
    r.suggestion,
    /^A call from the widget to Loki failed on https:\/\/substrata\.orangecat\.ch at 390×844\./,
  );
  assert.match(r.suggestion, /answered 502/);
  assert.equal(r.noticeKey, "widget-self|request|https://substrata.orangecat.ch");
  assert.equal(r.pageTitle, "Loki widget — https://substrata.orangecat.ch");
});
check(() => {
  // The same crash on a hundred visits is one row: the key ignores detail.
  const a = buildSelfReport({ kind: "error", detail: "x is undefined", url: "https://a.ch/p" });
  const b = buildSelfReport({ kind: "error", detail: "y is undefined", url: "https://a.ch/q" });
  assert.equal(a.noticeKey, b.noticeKey);
});
check(() => {
  const r = buildSelfReport({
    kind: "note",
    note: "  The panel covers the keyboard. ",
    url: "https://a.ch",
  });
  assert.equal(
    r.suggestion,
    "About the Loki widget itself, on https://a.ch:\nThe panel covers the keyboard.",
  );
  assert.equal(r.noticeKey, null, "a person's note is never folded into another");
});
check(() => {
  assert.equal(hostOrigin("javascript:alert(1)"), null);
  assert.equal(hostOrigin("not a url"), null);
  assert.equal(hostOrigin("http://localhost:3000/x"), "http://localhost:3000");
  assert.match(buildSelfReport({ kind: "slow", url: null }).suggestion, /on an unknown site/);
});
check(() => {
  assert.equal(selfReportNeedsOwner("note"), false, "a person pressing Send is consent");
  for (const k of WIDGET_SELF_KINDS)
    if (k !== "note")
      assert.equal(selfReportNeedsOwner(k), true, `${k} speaks unasked → owner only`);
});
check(() => {
  const long = "x".repeat(WIDGET_SELF_DETAIL_MAX + 50);
  assert.ok(
    !buildSelfReport({ kind: "error", detail: long }).suggestion.includes(
      "x".repeat(WIDGET_SELF_DETAIL_MAX + 1),
    ),
  );
});

check(() => {
  // Loki improving Loki: the owner's note and a defect the widget can pin on
  // itself start a fix; a slow or failed call may be the network's bad minute.
  assert.equal(selfReportStartsBuild("note"), true);
  assert.equal(selfReportStartsBuild("error"), true);
  assert.equal(selfReportStartsBuild("overflow"), true);
  assert.equal(selfReportStartsBuild("slow"), false);
  assert.equal(selfReportStartsBuild("request"), false);
  assert.match(selfSay("error", true, true), /started fixing it in Loki itself/);
});

// ---- the widget's judgement ----
check(() => {
  assert.equal(
    classifyOwnRequest("POST", "https://loki/api/widget/advise", 429, 100),
    null,
    "a 4xx is Loki answering on purpose",
  );
  assert.equal(classifyOwnRequest("POST", "https://loki/api/widget/advise", 200, 3000), null);
  assert.deepEqual(classifyOwnRequest("POST", "https://loki/api/widget/advise", 502, 3100), {
    kind: "request",
    detail: "POST /api/widget/advise answered 502 after 3.1s",
  });
  assert.equal(
    classifyOwnRequest("POST", "https://loki/api/feedback", null, 30000)?.kind,
    "request",
  );
  assert.equal(
    classifyOwnRequest("POST", "https://loki/api/widget/advise", 200, SELF_SLOW_MS)?.kind,
    "slow",
  );
});
check(() => {
  assert.equal(
    panelOverflow({ left: 8, right: 382, scrollWidth: 374, clientWidth: 374 }, 390),
    null,
  );
  assert.match(
    panelOverflow({ left: 8, right: 382, scrollWidth: 520, clientWidth: 374 }, 390)!,
    /scrolls sideways/,
  );
  assert.match(
    panelOverflow({ left: 8, right: 420, scrollWidth: 374, clientWidth: 374 }, 390)!,
    /hangs off/,
  );
});
check(() => {
  assert.match(selfSay("overflow", true), /^About me, not this page:/);
  assert.match(selfSay("overflow", true), /nothing for you to do/);
  assert.match(selfSay("request", false), /couldn't send/);
});

check(() => {
  // The receipt says where it went and what happens next, per destination.
  const base = { kind: "sent" as const, at: 1, text: "Panel covers the keyboard" };
  assert.match(
    receiptText({ ...base, owner: false, toLoki: true, building: true }),
    /built into Loki itself/,
  );
  assert.match(
    receiptText({
      ...base,
      owner: false,
      toLoki: true,
      note: "Saved, but it could not start: no repo.",
    }),
    /could not start: no repo/,
  );
  assert.match(receiptText({ ...base, owner: false, toLoki: true }), /people who build Loki/);
  assert.match(receiptText({ ...base, owner: true, building: true }), /Your changes above/);
  assert.match(receiptText({ ...base, owner: false }), /whoever builds this site/);
  assert.equal(
    receiptLinkLabel({ ...base, owner: false, toLoki: true, building: true }),
    "Follow the build →",
  );
  assert.equal(receiptLinkLabel({ ...base, owner: false }), "Track what happens next →");
});

// ---- the two sides agree ----
check(() => {
  assert.equal(SELF_DETAIL_MAX, WIDGET_SELF_DETAIL_MAX);
  assert.equal(SELF_NOTE_MAX, WIDGET_SELF_NOTE_MAX);
  const widgetKinds = readFileSync(join(repoRoot, "widget/self-report.ts"), "utf8").match(
    /export type SelfKind = ([^;]+);/,
  )![1];
  for (const k of WIDGET_SELF_KINDS)
    assert.ok(widgetKinds.includes(`"${k}"`), `widget knows kind ${k}`);
});
check(() => {
  // Public, cross-origin, like api/feedback: the proxy must let it through
  // signed out, or every self-report from a customer site is a 401.
  const proxy = readFileSync(join(repoRoot, "src/proxy.ts"), "utf8");
  assert.ok(/\|api\/widget\/self-report\|/.test(proxy), "proxy excludes api/widget/self-report");
  // The build starts only for Loki's own owner — never because a host site's
  // owner pass checked out, which is a different person on a different project.
  const route = readFileSync(join(repoRoot, "src/app/api/widget/self-report/route.ts"), "utf8");
  assert.ok(/lokiOwner = !!holder && holder\.userId === loki\.userId/.test(route));
  assert.ok(/if \(!lokiOwner \|\| !selfReportStartsBuild\(data\.kind\)\) return \{\};/.test(route));
});
check(() => {
  // Watch hands the widget's own requests over instead of dropping them, and
  // the report call itself never feeds back into a report.
  const watch = readFileSync(join(repoRoot, "widget/watch.ts"), "utf8");
  assert.ok(/onOwnRequest\?\.\(method, href, status, ms\)/.test(watch));
  const self = readFileSync(join(repoRoot, "widget/self-watch.ts"), "utf8");
  assert.ok(self.includes('url.includes("/api/widget/self-report")'), "no report loop");
});

console.log(`✓ widget-self-report: ${n} checks passed`);
