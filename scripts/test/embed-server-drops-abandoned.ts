/**
 * Work nobody is waiting for must not block the embed server.
 *
 * On 2026-11-07 the 03:30 reindex failed after 15 minutes of "[embeddings]
 * failed: The operation was aborted due to timeout". scripts/embed-server.py
 * runs one inference at a time (#1594). The client gives up on a page after
 * 30s, but the server kept computing the abandoned page under its lock, so the
 * next page queued behind dead work and timed out too. After the first slow
 * page, every page failed.
 *
 * This suite runs the real server.py against a stub fastembed whose inference
 * is slow, abandons a long request, and checks that the next caller is served
 * promptly. It also checks that the client pages at the server's batch size.
 */
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type AddressInfo } from "node:net";
import { createServer as createHttpServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EMBED_BATCH, embedTexts } from "../../src/lib/rag/embeddings";

const root = join(__dirname, "..", "..");
let passed = 0;

function assert(cond: boolean, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

const STUB = `
import os, time

class _Vec(list):
    def tolist(self):
        return list(self)

class TextEmbedding:
    def __init__(self, model_name=None):
        pass

    def embed(self, texts, batch_size=256):
        texts = list(texts)
        per_input = float(os.environ.get("STUB_SECONDS_PER_INPUT", "0"))
        for i in range(0, len(texts), batch_size):
            chunk = texts[i:i + batch_size]
            time.sleep(per_input * len(chunk))
            print(f"[stub] batch of {len(chunk)}", flush=True)
            for _ in chunk:
                yield _Vec([0.0, 0.0, 0.0])
`;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once("error", reject);
    s.listen(0, "127.0.0.1", () => {
      const { port } = s.address() as AddressInfo;
      s.close(() => resolve(port));
    });
  });
}

async function waitHealthy(base: string, child: ChildProcess, log: () => string) {
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) throw new Error(`server.py exited early:\n${log()}`);
    try {
      const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(500) });
      if (res.ok) return;
    } catch {
      /* not listening yet */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`server.py never became healthy:\n${log()}`);
}

function post(base: string, inputs: string[], signal?: AbortSignal) {
  return fetch(`${base}/v1/embeddings`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input: inputs }),
    signal,
  });
}

async function main() {
  console.log("embed server drops abandoned work");

  if (spawnSync("python3", ["--version"]).status !== 0) {
    console.log("  - skipped: python3 is not installed");
    return;
  }

  const dir = mkdtempSync(join(tmpdir(), "embed-stub-"));
  mkdirSync(join(dir, "fastembed"));
  writeFileSync(join(dir, "fastembed", "__init__.py"), STUB);
  const port = await freePort();
  const base = `http://127.0.0.1:${port}`;
  let out = "";
  const child = spawn("python3", [join(root, "scripts", "embed-server.py")], {
    env: {
      ...process.env,
      PYTHONPATH: dir,
      EMBED_PORT: String(port),
      EMBED_BATCH_SIZE: "4",
      STUB_SECONDS_PER_INPUT: "0.05", // 0.2s per batch of 4
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout!.on("data", (d) => (out += d));
  child.stderr!.on("data", (d) => (out += d));

  try {
    await waitHealthy(base, child, () => out);

    await check("a request still waited for is answered in full", async () => {
      const res = await post(base, ["a", "b", "c", "d", "e", "f"]);
      assert(res.ok, `HTTP ${res.status}`);
      const json = (await res.json()) as { data: { index: number }[] };
      assert(json.data.length === 6, `expected 6 vectors, got ${json.data.length}`);
    });

    await check(
      "an abandoned request stops, and the next caller is not stuck behind it",
      async () => {
        // 40 inputs = 10 batches = 2s of inference. Hang up after 0.3s.
        const long = Array.from({ length: 40 }, (_, i) => `doc ${i}`);
        const abandoned = await post(base, long, AbortSignal.timeout(300)).then(
          () => "answered",
          () => "aborted",
        );
        assert(abandoned === "aborted", "the long request was expected to be abandoned");

        const started = Date.now();
        const res = await post(base, ["next"]);
        const waited = Date.now() - started;
        assert(res.ok, `HTTP ${res.status}`);
        // At most one in-flight batch of the abandoned request (0.2s) plus its
        // own (0.05s). Before the fix it waited out all ten batches (~1.7s more).
        assert(waited < 1000, `the next caller waited ${waited}ms behind abandoned work`);
        assert(/caller hung up, dropped \d+\/40/.test(out), `server did not log the drop:\n${out}`);
      },
    );
  } finally {
    child.kill("SIGKILL");
    rmSync(dir, { recursive: true, force: true });
  }

  await check("the client pages at the server's batch size", async () => {
    assert(EMBED_BATCH === 16, `EMBED_BATCH is ${EMBED_BATCH}, the server batches 16`);
    const sizes: number[] = [];
    const server = createHttpServer((req, res) => {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const input = (JSON.parse(body) as { input: string[] }).input;
        sizes.push(input.length);
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify({ data: input.map((_, index) => ({ index, embedding: [index] })) }));
      });
    });
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const prev = process.env.EMBEDDINGS_BASE_URL;
    process.env.EMBEDDINGS_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const vectors = await embedTexts(Array.from({ length: 40 }, (_, i) => `t${i}`));
      assert(
        vectors.every((v) => v !== null),
        "every input should embed",
      );
      assert(sizes.join(",") === "16,16,8", `pages were ${sizes.join(",")}`);
    } finally {
      if (prev === undefined) delete process.env.EMBEDDINGS_BASE_URL;
      else process.env.EMBEDDINGS_BASE_URL = prev;
      server.close();
    }
  });

  console.log(`\n${passed} passed`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
