/**
 * A model call is bounded by silence, not by a stopwatch.
 *
 * Pins src/lib/agent/call-timeout.ts on a fake clock: a slow first token
 * that still arrives inside the first-byte limit is NOT a failure, bytes
 * that keep flowing past the old 30 s are NOT a failure, silence is, and the
 * total ceiling holds whatever flows.
 *
 * Run: npx tsx scripts/test/call-timeout.ts
 */
import assert from "node:assert/strict";
import { createCallTimeout, type TimerHost } from "@/lib/agent/call-timeout";

type Timer = { at: number; fn: () => void; id: number };
function fakeClock() {
  let now = 0;
  let seq = 0;
  let timers: Timer[] = [];
  const host: TimerHost = {
    setTimeout: (fn, ms) => {
      const t = { at: now + ms, fn, id: ++seq };
      timers.push(t);
      return t.id;
    },
    clearTimeout: (id) => {
      timers = timers.filter((t) => t.id !== id);
    },
  };
  const advance = (ms: number) => {
    const until = now + ms;
    for (;;) {
      const due = timers.filter((t) => t.at <= until).sort((a, b) => a.at - b.at)[0];
      if (!due) break;
      now = due.at;
      timers = timers.filter((t) => t.id !== due.id);
      due.fn();
    }
    now = until;
  };
  return { host, advance };
}

const LIMITS = { firstByteMs: 90_000, idleMs: 30_000, totalMs: 300_000 };
let passed = 0;
function check(name: string, fn: () => void) {
  fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

console.log("call-timeout:");

check("a first token at 60 s is not a failure under a 90 s first-byte limit", () => {
  const { host, advance } = fakeClock();
  const t = createCallTimeout(LIMITS, host);
  advance(60_000);
  assert.equal(t.signal.aborted, false);
  t.sawByte();
  advance(25_000);
  assert.equal(t.signal.aborted, false, "25 s of quiet after a byte is within idle");
  t.done();
});

check("no byte at all for 90 s aborts, and says so", () => {
  const { host, advance } = fakeClock();
  const t = createCallTimeout(LIMITS, host);
  advance(90_000);
  assert.equal(t.signal.aborted, true);
  assert.equal(t.reason(), "no answer within 90 s");
});

check("bytes every 5 s for two minutes keep the call alive past the old 30 s", () => {
  const { host, advance } = fakeClock();
  const t = createCallTimeout(LIMITS, host);
  for (let i = 0; i < 24; i++) {
    advance(5_000);
    t.sawByte();
  }
  assert.equal(t.signal.aborted, false);
  t.done();
});

check("silence mid-answer aborts after the idle limit with its own sentence", () => {
  const { host, advance } = fakeClock();
  const t = createCallTimeout(LIMITS, host);
  advance(1_000);
  t.sawByte();
  advance(30_000);
  assert.equal(t.signal.aborted, true);
  assert.equal(t.reason(), "went silent for 30 s mid-answer");
});

check("the total ceiling holds even while bytes keep flowing", () => {
  const { host, advance } = fakeClock();
  const t = createCallTimeout(LIMITS, host);
  for (let i = 0; i < 61; i++) {
    advance(5_000);
    t.sawByte();
  }
  assert.equal(t.signal.aborted, true);
  assert.equal(t.reason(), "still answering after 300 s — stopped waiting");
});

check("done() stops every timer, so a finished call never aborts late", () => {
  const { host, advance } = fakeClock();
  const t = createCallTimeout(LIMITS, host);
  t.sawByte();
  t.done();
  advance(10 * 60_000);
  assert.equal(t.signal.aborted, false);
  assert.equal(t.reason(), null);
});

console.log(`\ncall-timeout: ${passed} passed`);
