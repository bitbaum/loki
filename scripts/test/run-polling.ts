import assert from "node:assert/strict";
import { singleFlight } from "../../src/lib/single-flight";
async function main() {
  let calls = 0;
  let finish: (n: number) => void = () => {};
  const load = singleFlight(() => {
    calls++;
    return new Promise<number>((r) => {
      finish = r;
    });
  });
  const first = load();
  const again = load();
  assert.equal(first, again);
  await Promise.resolve();
  assert.equal(calls, 1);
  finish(42);
  assert.equal(await first, 42);
  const next = load();
  await Promise.resolve();
  assert.equal(calls, 2);
  finish(43);
  assert.equal(await next, 43);
  let attempts = 0;
  const retry = singleFlight(async () => {
    if (!attempts++) throw Error("offline");
    return "recovered";
  });
  await assert.rejects(retry(), /offline/);
  assert.equal(await retry(), "recovered");
  console.log("✓ slow refreshes share one request, settle normally and recover after failure");
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
