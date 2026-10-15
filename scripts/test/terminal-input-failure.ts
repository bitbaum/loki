import assert from "node:assert/strict";
import {
  runnerTransport,
  workspaceTransport,
} from "../../src/components/terminal/terminal-transport";
import { terminalInputChunks } from "../../src/lib/terminal-input";
async function main() {
  const unicode = "a🍊漢字".repeat(2000);
  const chunks = [...terminalInputChunks(unicode)];
  assert.equal(Buffer.concat(chunks.map((c) => Buffer.from(c))).toString(), unicode);
  assert(chunks.every((c) => c.length <= 1500));
  const original = globalThis.fetch;
  const calls: { url: string; body: unknown }[] = [];
  try {
    globalThis.fetch = async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response("offline", { status: 503 });
    };
    await assert.rejects(runnerTransport("petvity", "cloud").sendKey("hello"), /503/);
    assert.deepEqual(calls[0].body, {
      kind: "key",
      tab: "petvity",
      data: "hello",
      channel: "cloud",
    });
    await assert.rejects(workspaceTransport("workspace").sendKey("hello"), /503/);
    globalThis.fetch = async () => {
      throw new Error("network down");
    };
    await assert.rejects(runnerTransport("petvity").sendKey("hello"), /network down/);
    runnerTransport("petvity").sendResize(80, 24);
    await new Promise((r) => setTimeout(r, 0));
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    await runnerTransport("petvity", "cloud").sendKey("\r");
  } finally {
    globalThis.fetch = original;
  }
  console.log("✓ terminal input exposes network/HTTP failure while resize stays best-effort");
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
