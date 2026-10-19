/**
 * The cloud builder reopens the sessions a restart ended (desktop/src/main/
 * tab-memory.ts). Owner, 2026-10-19: five deploys in an afternoon each
 * restarted the builder, and each restart left "No live sessions" behind.
 *
 * Pinned: a session opened is written down; one closed from Loki, or whose
 * agent exits while the builder stays up, is crossed off; a late exit from an
 * agent that was replaced does not cross off its replacement; a restart
 * reopens what is written down, resuming Claude's conversation; one that
 * cannot come back is crossed off instead of retried forever.
 *
 * Run: pnpm exec tsx scripts/test/tab-memory.ts
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  enableTabMemory,
  forgetTab,
  rememberTab,
  rememberedTabs,
  restoreTabs,
} from "../../desktop/src/main/tab-memory";

let passed = 0;
function check(label: string, condition: boolean): void {
  if (!condition) throw new Error(`✗ ${label}`);
  passed++;
  console.log(`  ✓ ${label}`);
}

async function main(): Promise<void> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tab-memory-"));
  const dirA = path.join(root, "bitbaum");
  const dirB = path.join(root, "center-som");
  fs.mkdirSync(dirA);
  fs.mkdirSync(dirB);

  // Off by default: a laptop runner remembers nothing.
  rememberTab({ tab: "bitbaum", dir: dirA, agent: "claude" });
  check("off unless the box turns it on", rememberedTabs().length === 0);

  enableTabMemory(path.join(root, ".loki", "open-tabs.json"));
  const genA = rememberTab({ tab: "bitbaum", dir: dirA, agent: "claude" });
  rememberTab({ tab: "Center SOM", dir: dirB, agent: "codex" });
  check(
    "each opened session is written down",
    rememberedTabs()
      .map((t) => t.tab)
      .join() === "bitbaum,Center SOM",
  );

  // An agent switch: the old agent's exit lands after the new one opened.
  const genA2 = rememberTab({ tab: "bitbaum", dir: dirA, agent: "claude" });
  forgetTab("bitbaum", genA);
  check("a replaced agent's late exit keeps its replacement", rememberedTabs().length === 2);
  check("one row per session", rememberedTabs().filter((t) => t.tab === "bitbaum").length === 1);

  // A restart: nothing is crossed off, and everything comes back.
  const launched: string[] = [];
  const restored = await restoreTabs({
    isLive: () => false,
    launch: async (tab, dir, agent, sessionId) => {
      launched.push(`${tab}|${agent}|${sessionId ?? "-"}`);
    },
    sessionFor: async (dir) => (dir === dirA ? "c0ffee" : null),
  });
  check("both sessions reopen", restored.length === 2);
  check(
    "Claude resumes its conversation; another agent starts fresh",
    [...launched].sort().join() === "Center SOM|codex|-,bitbaum|claude|c0ffee",
  );

  // Already live (the poller beat us to it): left alone.
  launched.length = 0;
  await restoreTabs({
    isLive: () => true,
    launch: async (tab) => {
      launched.push(tab);
    },
    sessionFor: async () => null,
  });
  check("a live session is not launched twice", launched.length === 0);

  // A folder that is gone: crossed off, not retried on every restart.
  fs.rmSync(dirB, { recursive: true });
  const lines: string[] = [];
  await restoreTabs({
    isLive: () => false,
    launch: async () => {},
    sessionFor: async () => null,
    log: (l) => lines.push(l),
  });
  check(
    "a session that cannot come back is crossed off",
    !rememberedTabs().some((t) => t.tab === "Center SOM"),
  );
  check(
    "and the log says why",
    lines.some((l) => l.includes("is gone")),
  );

  // Closed on purpose (or the agent exited while the builder stayed up).
  forgetTab("bitbaum", genA2);
  check("a session that really ended is crossed off", rememberedTabs().length === 0);

  fs.rmSync(root, { recursive: true, force: true });
  console.log(`\n${passed}/${passed} tab-memory cases passed`);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
