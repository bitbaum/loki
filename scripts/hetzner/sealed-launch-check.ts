/**
 * On the box, as the runner unit (its env, its executor): launch each agent
 * through the REAL launch path (provisionAgentWorkspace → SandboxExecutor →
 * podman/runsc), wait for its composer, paste a prompt the way the runner
 * does, and assert the prompt was accepted. Exit 1 on any failure.
 *   tsx scripts/hetzner/sealed-launch-check.ts gemini grok cursor
 * Verdicts and a masked screen tail only (public Action logs).
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { executor } from "@/lib/agent-execution";
import { provisionAgentWorkspace } from "@/lib/agent-execution/launch";
import type { AgentOption } from "@/lib/agent-registry";
import { promptAcceptedEvidence } from "@/lib/prompt-evidence";

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
const COMPOSER: Partial<Record<string, RegExp>> = {
  gemini: /type your message|tips for getting started/i,
};
const PROMPT = "Reply with the single word PONG and nothing else. Do not run any tools.";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function check(spec: string): Promise<boolean> {
  // "agent" or "agent@tab": @tab launches in that tab's own container name
  // (fc-ws-<hash of runner:tab>) — the name a dead container can hold.
  const [agent, tabArg] = spec.split("@") as [AgentOption, string | undefined];
  const dir = path.join(os.homedir(), ".sealed-test", `launch-${agent}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# sealed launch check\n");
  const tab = tabArg || `sealed-check-${agent}`;
  const id = `runner:${tab}`;
  let raw = "";
  let exited: number | null | undefined;
  const handle = await provisionAgentWorkspace("runner", {
    projectKey: tab,
    dir,
    agent,
    workspaceId: id,
  });
  const unsub = executor.subscribe(handle.id, 0, (e) => {
    if (e.kind === "output" && e.data) raw += e.data;
    if (e.kind === "exit") exited = e.exitCode ?? null;
  });
  const t0 = Date.now();
  const marker = COMPOSER[agent];
  while (Date.now() - t0 < 45_000 && exited === undefined) {
    const text = raw.replace(ANSI, "");
    if (
      marker ? marker.test(text) : text.replace(/\s+/g, "").length > 40 && Date.now() - t0 > 12_000
    )
      break;
    await sleep(500);
  }
  await sleep(2000);
  const before = raw.length;
  if (exited === undefined) {
    executor.write(handle.id, `\x1b[200~${PROMPT}\x1b[201~`);
    await sleep(250);
    executor.write(handle.id, "\r");
    await sleep(550);
    executor.write(handle.id, "\r");
  }
  let ok = false;
  const t1 = Date.now();
  while (Date.now() - t1 < 60_000 && exited === undefined && !ok) {
    ok = promptAcceptedEvidence(raw.slice(before), agent, PROMPT);
    await sleep(500);
  }
  unsub();
  await executor.terminate(handle.id).catch(() => {});
  const tail = raw
    .replace(ANSI, "")
    .split(/\r?\n|\r/)
    .map((l) => l.replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 1)
    .slice(-8)
    .map((l) => "    | " + l.replace(/[A-Za-z0-9_-]{28,}/g, "<masked>").slice(0, 160));
  console.log(
    `${ok ? "✓" : "✗"} ${spec}: ${ok ? "prompt accepted" : exited !== undefined ? `exited (${exited}) before accepting` : "prompt not accepted"} in ${((Date.now() - t0) / 1000).toFixed(0)}s`,
  );
  if (!ok) console.log(tail.join("\n"));
  return ok;
}

async function main() {
  const agents = (
    process.argv.slice(2).length ? process.argv.slice(2) : ["gemini", "grok", "cursor"]
  ) as AgentOption[];
  console.log(
    `executor=${process.env.LOKI_EXECUTOR ?? "local"} runtime=${process.env.LOKI_SANDBOX_OCI_RUNTIME ?? "-"}`,
  );
  let failed = 0;
  for (const a of agents) if (!(await check(a))) failed += 1;
  process.exit(failed ? 1 : 0);
}
void main();
