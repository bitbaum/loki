// The instant preview on /change, end to end in a real browser: Loki opens a
// "live site" (a local page), photographs it, reads its outline, applies the
// edits a plan returns, and photographs the same spot with and without them.
//
// What it pins:
//   - the page's own Content-Security-Policy cannot stop the page script
//     (it is evaluated by Loki's browser, never injected as a <script>);
//   - the plan sees the page's real outline, and the edit lands on the page;
//   - the visitor gets "now" first, then a before and an after that differ;
//   - a plan with nothing to draw says so instead of a picture of nothing;
//   - a site that cannot be opened is "no-picture", never a hang;
//   - the prompt on /change carries no "was just changed for" line.
//
// Needs Chromium; skips with a reason off CI, fails under CI.
// Run: npx tsx scripts/test/instant-preview-browser.ts
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { browserStatus } from "@/lib/feedback/page-picture";
import { renderInstantPreview, type InstantEvent } from "@/lib/instant-preview/render";
import { previewPrompt } from "@/lib/widget-preview/plan";

async function main() {
  process.env.RUNTIME_AVAILABLE = "true"; // the "live site" is on localhost

  const prompt = previewPrompt({ ask: "bigger title", fixedFor: null, outline: [], path: "/" });
  assert.ok(!prompt.includes("was just changed for"), "no fix context on /change");

  const status = await browserStatus();
  if (!status.ok) {
    if (process.env.CI) throw new Error("instant-preview-browser: no Chromium under CI");
    console.log("instant-preview-browser: skipped — no Chromium here (CI has it)");
    return;
  }
  if (!existsSync("public/instant-page.js"))
    execFileSync("npx", [
      "esbuild",
      "widget/instant-page.ts",
      "--bundle",
      "--minify",
      "--format=iife",
      "--outfile=public/instant-page.js",
      "--log-level=warning",
    ]);

  const PAGE = `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1">
  <style>body{font:16px sans-serif;margin:0} header{padding:24px;background:#eee} h1{font-size:20px;margin:0}</style>
  </head><body><header><h1 id="title">Old headline</h1></header>
  <main><p>${"Bread every morning. ".repeat(40)}</p><button type="button">Order now</button></main></body></html>`;

  const server = createServer((_, res) => {
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      // The strictest a real site gets: no script of any origin, inline or not.
      "content-security-policy": "script-src 'none'",
    });
    res.end(PAGE);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;

  try {
    const events: InstantEvent[] = [];
    let seen: string[] = [];
    await renderInstantPreview(
      url,
      async (outline) => {
        seen = outline.map((o) => o.text);
        const title = outline.find((o) => o.id === "title");
        assert.ok(title, "the outline names the headline");
        return {
          summary: "A bigger, darker headline.",
          ops: [
            { op: "text", target: title.i, text: "Fresh bread, every morning" },
            { op: "style", target: title.i, css: { "font-size": "40px", color: "#ffffff" } },
            { op: "css", css: "header { background: #111 }" },
          ],
        };
      },
      (e) => events.push(e),
    );
    assert.ok(seen.includes("Old headline"), "the plan read the live page");
    assert.equal(events[0]?.type, "now", "their site comes first");
    const after = events.find((e) => e.type === "after");
    assert.ok(
      after && after.type === "after",
      `an after picture (got ${events.map((e) => e.type)})`,
    );
    assert.notEqual(after.before, after.after, "before and after differ");
    assert.equal(after.summary, "A bigger, darker headline.");

    const nothing: InstantEvent[] = [];
    await renderInstantPreview(
      url,
      async () => ({ summary: "That needs a real build.", ops: [] }),
      (e) => nothing.push(e),
    );
    assert.deepEqual(
      nothing.map((e) => e.type),
      ["now", "no-change"],
      "nothing to draw is said, not pictured",
    );

    const closed: InstantEvent[] = [];
    await renderInstantPreview(
      "http://127.0.0.1:9/",
      async () => ({ summary: null, ops: [] }),
      (e) => closed.push(e),
    );
    assert.equal(closed.at(-1)?.type, "no-picture", "an unreachable site is no-picture");

    console.log("instant-preview-browser: all checks passed");
  } finally {
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
