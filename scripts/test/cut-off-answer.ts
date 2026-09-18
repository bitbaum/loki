/**
 * Does Loki notice when a vendor severed the answer?
 *
 * Until this landed, nothing in the repo read `finish_reason` — a grep for it
 * across src/ and home/ returned zero. The field rides the same frames already
 * parsed for `usage`, and was dropped, so a severed reply was stored and
 * rendered exactly like a finished one.
 *
 * Observed in prod on 2026-09-18: a chat answer that ended mid-word at
 * "running on `research-", unclosed backtick and all, stored at 243 chars with
 * no marker anywhere. One in 183 stored replies — rare, which is precisely why
 * it needs a machine to notice rather than a reader.
 *
 * Run: npx tsx scripts/test/cut-off-answer.ts
 */
import { cutOffReason, readStreamedBody } from "@/lib/agent/llm";

let failures = 0;
function fail(name: string, err: unknown) {
  failures++;
  console.log(`  ✗ ${name}`);
  console.log(`    ${err instanceof Error ? err.message : String(err)}`);
}
function check(name: string, fn: () => void) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail(name, err);
  }
}
async function acheck(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`  ✓ ${name}`);
  } catch (err) {
    fail(name, err);
  }
}
function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** An SSE body of the shape every vendor in the chain emits. */
function sseBody(frames: object[]): Response {
  const text = frames.map((f) => `data: ${JSON.stringify(f)}\n\n`).join("") + "data: [DONE]\n\n";
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(text));
      controller.close();
    },
  });
  return new Response(stream);
}
const SINK = { delta: () => {}, reset: () => {} };

async function main() {
  console.log("cut-off-answer:");

  check("a finished answer is not reported as a problem", () => {
    assert(cutOffReason("stop") === null, "stop is whole");
    assert(cutOffReason("end_turn") === null, "end_turn is whole");
  });

  check("stopping to call a tool is not being cut off", () => {
    // The loop's normal path. Reporting this would fire on almost every turn.
    assert(cutOffReason("tool_calls") === null, "tool_calls is whole");
    assert(cutOffReason("function_call") === null, "function_call is whole");
  });

  check("silence is a third state, not an accusation", () => {
    // A vendor that omits the field has told us NOTHING. Warning here would cry
    // wolf on every provider that stays quiet, and a warning that always fires
    // is one nobody reads.
    assert(cutOffReason(null) === null, "null is unknown");
    assert(cutOffReason(undefined) === null, "undefined is unknown");
    assert(cutOffReason("") === null, "empty is unknown");
  });

  check("running out of budget is reported", () => {
    assert(cutOffReason("length") === "ran out of output budget", "length");
    assert(cutOffReason("max_tokens") === "ran out of output budget", "max_tokens");
    // Gemini SCREAMS its reasons; the chain's free vendor must not slip through.
    assert(cutOffReason("MAX_TOKENS") === "ran out of output budget", "MAX_TOKENS");
  });

  check("a provider filter is reported as a filter, not as truncation", () => {
    // Different cause, different remedy: more budget will not help here.
    assert(/filter/.test(cutOffReason("content_filter") ?? ""), "content_filter");
    assert(/filter/.test(cutOffReason("RECITATION") ?? ""), "gemini RECITATION");
  });

  check("an unrecognised reason is surfaced verbatim, never swallowed", () => {
    // THE RULE THAT KEEPS THIS HONEST. Vendors add stop reasons. A new one
    // meaning "cut off" must not read as "fine" merely because this switch
    // predates it — the default has to be suspicion, and it has to name the
    // string so the next person can classify it.
    const r = cutOffReason("model_fell_over");
    assert(r !== null, "unknown reason must not pass as whole");
    assert(r!.includes("model_fell_over"), `must name the reason, got: ${r}`);
  });

  await acheck("the stop reason survives the frame that carries no delta", async () => {
    // THE ORDERING BUG, pinned. Vendors send the stop reason on a FINAL frame
    // whose delta is empty or absent. Reading it after the `if (!delta) return`
    // guard drops it on the floor, and the answer then looks complete forever.
    const raw = await readStreamedBody(
      sseBody([
        { choices: [{ delta: { content: "the agent is running on `research-" } }] },
        { choices: [{ finish_reason: "length" }] },
        { usage: { total_tokens: 61 } },
      ]),
      SINK,
    );
    assert(raw.text.includes("research-"), "prose accumulated");
    assert(raw.finishReason === "length", `expected length, got ${String(raw.finishReason)}`);
    assert(cutOffReason(raw.finishReason) !== null, "and it reads as cut off");
  });

  await acheck("a clean stream reports whole, so this cannot fire every turn", async () => {
    const raw = await readStreamedBody(
      sseBody([
        { choices: [{ delta: { content: "all done." } }] },
        { choices: [{ finish_reason: "stop" }] },
      ]),
      SINK,
    );
    assert(raw.finishReason === "stop", "stop captured");
    assert(cutOffReason(raw.finishReason) === null, "and reads as whole");
  });

  await acheck("a vendor that never sends one leaves it unknown", async () => {
    const raw = await readStreamedBody(
      sseBody([{ choices: [{ delta: { content: "hi" } }] }]),
      SINK,
    );
    assert(raw.finishReason === null, "absent stays null");
  });

  console.log(failures === 0 ? "\nall passed" : `\n${failures} failed`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
