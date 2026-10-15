import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInspection, reviewRequestAllowed } from "../inspection-worker";
import { reviewUrl, ReviewStart, ReviewWorkerEvent } from "../../src/lib/inspection/contract";

async function main() {
  const origin = "https://review.orangecat.ch";
  assert.equal(reviewUrl("/about#team", origin), `${origin}/about`);
  for (const path of [
    "https://other.ch",
    "javascript:alert(1)",
    "/delete/1",
    "/logout",
    "/checkout?buy=1",
  ])
    assert.equal(reviewUrl(path, origin), null);
  assert.equal(ReviewStart.safeParse({ mode: "all" }).success, false);
  assert.equal(
    ReviewWorkerEvent.safeParse({ kind: "frame", frame: { image: "file:///etc/passwd" } }).success,
    false,
  );
  const request = (url: string, method = "GET", navigation = true) => ({
    url: () => url,
    method: () => method,
    isNavigationRequest: () => navigation,
  });
  assert.equal(await reviewRequestAllowed(request("http://127.0.0.1"), "http://127.0.0.1"), false);
  assert.equal(await reviewRequestAllowed(request(origin, "POST"), origin), false);
  assert.equal(await reviewRequestAllowed(request(`${origin}:8080`), origin), false);
  assert.equal(await reviewRequestAllowed(request("https://elsewhere.ch"), origin), false);
  const events: Array<Record<string, unknown>> = [];
  let status = "running";
  let pausedChecks = 0;
  let pausedAtFrames = 0;
  let frames = 0;
  let base = "";
  const server = createServer(async (req, res) => {
    if (req.url === "/worker") {
      assert.equal(req.headers.authorization, "Bearer test-review-ticket");
      assert.match(String(req.headers["x-review-worker"]), /^[a-f0-9-]{36}$/);
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const event = JSON.parse(raw);
      events.push(event);
      if (event.kind === "frame") {
        frames++;
        assert.match(event.frame.image, /^data:image\/jpeg;base64,/);
        if (frames === 1) {
          status = "paused";
          pausedAtFrames = frames;
        }
      }
      if (event.kind === "checkpoint" && status === "paused") {
        assert.equal(frames, pausedAtFrames, "No browser frames while paused");
        if (++pausedChecks === 3) status = "running";
      }
      res.setHeader("Content-Type", "application/json");
      res.end(
        JSON.stringify({
          status,
          accepted: true,
          mode: "functional",
          url: base,
          paths: [],
          limits: { pages: 3, scrolls: 2, findings: 8, lifetimeMs: 60000 },
        }),
      );
      return;
    }
    res.setHeader("Content-Type", "text/html");
    res.end(
      `<!doctype html><html><body style="font:18px system-ui;min-height:1200px"><h1>${req.url === "/about" ? "About" : "Home"}</h1><a href="/about">About us</a><a href="/logout">Sign out</a><a href="https://other.ch/">Other site</a><p style="margin-top:800px">Page bottom</p></body></html>`,
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  assert(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}/`;
  const dir = await mkdtemp(join(tmpdir(), "loki-review-test-"));
  const config = join(dir, "config.json");
  try {
    await writeFile(
      config,
      JSON.stringify({ endpoint: `${base}worker`, token: "test-review-ticket" }),
    );
    // Only this in-process fixture allows loopback; the downloadable CLI always uses the real guard.
    await runInspection(
      config,
      async (request) =>
        request.method() === "GET" && new URL(request.url()).origin === new URL(base).origin,
    );
    assert.equal(pausedChecks, 3);
    const pages = events.filter((e) => e.kind === "page") as Array<{
      kind: string;
      url: string;
      width: number;
      result: string;
    }>;
    assert.deepEqual(new Set(pages.map((p) => p.url)), new Set([base, `${base}about`]));
    assert.deepEqual(new Set(pages.map((p) => p.width)), new Set([390, 1440]));
    assert(pages.every((p) => p.result === "visited"));
    assert(events.some((e) => e.kind === "finished"));
    assert(
      events.some(
        (e) =>
          e.kind === "frame" &&
          String((e.frame as { action: string }).action).startsWith("Following"),
      ),
      "A real link is followed visibly",
    );
    assert(JSON.parse(await readFile(config, "utf8")).workerId);
    // Stop is enforced before opening a browser or taking the next frame.
    status = "stopped";
    const before = frames;
    await runInspection(config).catch((error) => assert.equal(error.message, "Review ended"));
    assert.equal(frames, before);
    console.log(
      "Inspection worker: real browsing, phone/desktop coverage, pause/resume, stop and network guards passed",
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
