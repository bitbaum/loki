/**
 * Inline tests for the chat close-notification decision
 * (lib/orchestration/notify-close.ts, pure half). The contract under test:
 * ONLY runs that opted in via payload.notifyOnClose ever produce a message —
 * a formatting regression here either spams the phone with the fleet's whole
 * churn or silently swallows chat-dispatch outcomes.
 *
 * Run: npm run test:notify-close
 */
import {
  formatRunCloseMessage,
  shouldAnnounceOnClose,
} from "@/lib/orchestration/notify-close-format";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function runTests(): void {
  let passed = 0;
  const check = (label: string, fn: () => void) => {
    fn();
    passed += 1;
    console.log(`  ✓ ${label}`);
  };

  const base = {
    projectKey: "orangecat",
    outcome: "success",
    finishedAt: new Date("2026-08-13T12:00:00Z"),
    payload: { projectKey: "orangecat", projectPath: "/x", notifyOnClose: true },
  } as Parameters<typeof formatRunCloseMessage>[0];

  check("no opt-in ⇒ null (UI dispatches stay silent)", () => {
    assert(
      formatRunCloseMessage({
        ...base,
        payload: { projectKey: "orangecat", projectPath: "/x" },
      }) === null,
      "expected null without notifyOnClose",
    );
  });

  check("opted-in but not finished ⇒ null", () => {
    assert(
      formatRunCloseMessage({ ...base, finishedAt: null }) === null,
      "expected null for open run",
    );
  });

  check("a run closed from a handoff says what the agent did", () => {
    // The local PTY path sets no resultText — the agent's words live in the
    // handoff summary. Reading only resultText sent "🟡 orangecat: run
    // partial" and nothing else to the person's phone.
    const msg = formatRunCloseMessage({
      ...base,
      outcome: "partial",
      summary: {
        done: "e2e ok — no changes",
        next: "Definition of done not yet met — include a committed change.",
        tests: "",
        todos: "",
        health: "",
      },
    } as Parameters<typeof formatRunCloseMessage>[0]);
    assert(!!msg && msg.includes("e2e ok — no changes"), `got: ${msg}`);
    assert(!!msg && msg.includes("Next: Definition of done"), `got: ${msg}`);
  });

  check("success carries ✅ + project + outcome", () => {
    const msg = formatRunCloseMessage(base);
    assert(!!msg && msg.startsWith("✅ orangecat: run success"), `got: ${msg}`);
  });

  check("failure carries ❌ and the error text", () => {
    const msg = formatRunCloseMessage({
      ...base,
      outcome: "error",
      payload: { ...base.payload!, error: "runner nack" },
    });
    assert(!!msg && msg.startsWith("❌") && msg.includes("runner nack"), `got: ${msg}`);
  });

  check("partial carries 🟡", () => {
    const msg = formatRunCloseMessage({ ...base, outcome: "partial" });
    assert(!!msg && msg.startsWith("🟡"), `got: ${msg}`);
  });

  // The reaper's verdicts must be announceable. The reaper closes runs with a
  // raw UPDATE that bypasses updateOrchestrationRun, so it calls notifyRunClosed
  // itself — if this formatter ever went success-only, a timed-out run would go
  // silent again, which is exactly how visitor-feedback fixes sat "in progress"
  // for weeks after their runs had died.
  check("reaper timeout is announced, not swallowed", () => {
    const msg = formatRunCloseMessage({
      ...base,
      outcome: "timeout",
      payload: {
        ...base.payload!,
        error: "Timed out — run exceeded maximum duration and was cleaned up",
      },
    });
    assert(!!msg && msg.startsWith("❌"), `timeout must produce a message, got: ${msg}`);
    assert(msg!.includes("Timed out"), `timeout message must carry the reason, got: ${msg}`);
  });

  check("resultText wins over error and is truncated to 600 chars", () => {
    const msg = formatRunCloseMessage({
      ...base,
      payload: { ...base.payload!, resultText: "R".repeat(1000), error: "ignored" },
    });
    const body = msg?.split("\n")[1] ?? "";
    assert(body.length === 600 && !msg?.includes("ignored"), `body len ${body.length}`);
  });

  // ── Who gets told ─────────────────────────────────────────────────────────
  //
  // This is the rule that shipped OFF. `notifyOnClose` was plumbed end to end,
  // unit-tested, and set by nothing but a test fixture — so no dispatch ever
  // announced itself, and clicking Send produced silence. The gate is now the
  // auth path: a person gets told, a machine does not.

  check("a browser session announces — a person clicked and may walk away", () => {
    assert(shouldAnnounceOnClose({ via: "session" }) === true, "session must announce");
  });

  check("a bearer token stays silent — autopilot churn must not reach the phone", () => {
    assert(shouldAnnounceOnClose({ via: "token" }) === false, "token must stay silent");
  });

  check("no actor stays silent", () => {
    assert(shouldAnnounceOnClose(null) === false, "null actor must not announce");
    assert(shouldAnnounceOnClose(undefined) === false, "undefined actor must not announce");
  });

  check("an explicit value wins in BOTH directions", () => {
    // Chat opts in deliberately even though it authenticates with a token...
    assert(shouldAnnounceOnClose({ via: "token" }, true) === true, "explicit true must win");
    // ...and a noisy UI-initiated loop can opt out.
    assert(shouldAnnounceOnClose({ via: "session" }, false) === false, "explicit false must win");
  });

  check("only an actual boolean counts as explicit", () => {
    // A stray undefined must fall through to the actor rule rather than being
    // read as "false" — that would silently restore the shipped-off behavior.
    assert(
      shouldAnnounceOnClose({ via: "session" }, undefined) === true,
      "undefined is not an opt-out",
    );
  });

  console.log(`\n${passed} passed`);
}

runTests();
