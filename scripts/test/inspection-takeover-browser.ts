/**
 * Take over, in a real browser: the person has the review's browser, clicks
 * through to a page Loki had not planned, presses a button that would send a
 * form (nothing is sent), and hands back. Loki returns to the page it was on,
 * so what it says stays about the right page, then looks at the person's page
 * next. The owner, 2026-11-02: "click through … and it should be objectively
 * so" — this is the objective part.
 */
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInspection } from "../inspection-worker";
import { describeInput, ReviewInput } from "../../src/lib/inspection/contract";

async function main() {
  // The wire refuses what the worker must never be asked to do.
  for (const bad of [
    { type: "type", text: "" },
    { type: "click", x: 5000, y: 10 },
    { type: "key", key: "F12" },
    { type: "navigate", url: "https://elsewhere.ch" },
    { type: "script", code: "alert(1)" },
  ])
    assert.equal(ReviewInput.safeParse(bad).success, false, JSON.stringify(bad));
  assert.equal(describeInput({ type: "scroll", dy: 400 }), "You scrolled down");
  assert.equal(describeInput({ type: "key", key: "Enter" }), "You pressed Enter");

  const events: Array<Record<string, unknown>> = [];
  const posts: string[] = [];
  let base = "";
  // The fixture plays the server: who has the browser, and what the person does.
  let status = "running";
  let control: "you" | "loki" = "loki";
  let inputs: unknown[] = [];
  let stage = 0;
  const takeoverFrames: Array<{ url: string; action: string }> = [];
  const server = createServer(async (req, res) => {
    if (req.method === "POST" && req.url !== "/worker") posts.push(req.url ?? "");
    if (req.url === "/worker") {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const event = JSON.parse(raw);
      events.push(event);
      if (event.kind === "frame") {
        const frame = event.frame as { url: string; action: string };
        if (control === "you") takeoverFrames.push(frame);
        else if (stage === 0) {
          // Loki's first picture: the person takes over.
          stage = 1;
          status = "paused";
          control = "you";
        }
      }
      let reply = inputs;
      if (event.kind === "checkpoint" && control === "you") {
        // Script the person, one step per checkpoint once the browser is theirs.
        if (stage === 1 && takeoverFrames.length === 1) {
          stage = 2;
          reply = [{ type: "click", x: 60, y: 30 }]; // the "Team" link, top left
        } else if (stage === 2 && takeoverFrames.length === 2) {
          stage = 3;
          reply = [{ type: "click", x: 60, y: 130 }]; // a submit button on /team
        } else if (stage === 3 && takeoverFrames.length === 3) {
          stage = 4;
          status = "running";
          control = "loki";
          reply = [];
        } else reply = [];
      }
      inputs = [];
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          status,
          accepted: true,
          mode: "functional",
          url: base,
          paths: [],
          // Two pages only: "/" and whatever Loki would open next.
          limits: { pages: 2, scrolls: 1, findings: 8, lifetimeMs: 60000 },
          control,
          inputs: event.kind === "checkpoint" ? reply : [],
        }),
      );
      return;
    }
    res.setHeader("Content-Type", "text/html");
    const page = req.url?.split("?")[0] ?? "/";
    res.end(`<!doctype html><html><body style="margin:0;font:18px system-ui;min-height:900px">
      <a href="/team" style="position:absolute;left:10px;top:10px;width:200px;height:40px;display:block">Team</a>
      <h1 style="margin-top:80px">${page === "/team" ? "Team" : page === "/about" ? "About" : "Home"}</h1>
      ${page === "/team" ? `<form method="post" action="/join"><button style="position:absolute;left:10px;top:110px;width:200px;height:40px">Join</button></form>` : ""}
      <a href="/about">About</a>
    </body></html>`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/`;
  const dir = await mkdtemp(join(tmpdir(), "loki-takeover-test-"));
  const config = join(dir, "config.json");
  try {
    await writeFile(
      config,
      JSON.stringify({ endpoint: `${base}worker`, token: "test-review-ticket" }),
    );
    // The fixture allows loopback reads only; the real guard is tested beside the worker.
    await runInspection(
      config,
      async (request) =>
        ["GET", "HEAD"].includes(request.method()) &&
        new URL(request.url()).origin === new URL(base).origin,
    );

    assert.equal(stage, 4, "the person took over, clicked twice and handed back");
    assert.deepEqual(
      takeoverFrames.map((f) => f.action),
      ["You have the browser", "You clicked", "You clicked"],
      "each input answers with a picture of what it did",
    );
    assert.equal(takeoverFrames[0]!.url, base, "the person starts where Loki was");
    assert.equal(takeoverFrames[1]!.url, `${base}team`, "their click opened the page they chose");
    assert.deepEqual(posts, [], "a button that would send a form sends nothing");

    const pages = events.filter((e) => e.kind === "page") as Array<{ url: string; width: number }>;
    assert.equal(pages[0]!.url, base, "after hand-back, Loki finished the page it was on");
    assert(
      pages.some((p) => p.url === `${base}team`),
      "the page the person opened was reviewed next",
    );
    assert(
      !pages.some((p) => p.url === `${base}about`),
      "it came before Loki's own next page, within the page limit",
    );
    console.log(
      "Inspection take over: clicks drive the real page, forms send nothing, hand-back returns and reviews the person's page next",
    );
  } finally {
    server.close();
    await rm(dir, { recursive: true, force: true });
  }
}
main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
