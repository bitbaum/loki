#!/usr/bin/env node
/**
 * The scripted agent walk (docs/foundation/LOOP-WALK.md, "Agent walk"): file
 * one report as an agent with a limited seat's token, poll its statusUrl, and
 * print each canonical state until Done, Failed or the time runs out.
 *
 * Environment (the token is read from the environment and never printed):
 *   LOKI_SEAT_TOKEN   ck_… token of the agent's own seat (not the owner's)  required
 *   LOKI_PROJECT_ID   the project the seat belongs to                       required
 *   LOKI_URL          origin of Loki, default https://loki.orangecat.ch
 *   LOKI_AGENT_NAME   label in the inbox, default "QA · quality control"
 *   LOKI_WALK_TIMEOUT_S  give up polling after this many seconds, default 600
 *
 * Never dispatches: filing starts a build only if the project's owner opted
 * in (agentBuildsUnasked, off by default). Exit 0 Done, 1 Failed, 2 Needs you
 * or timeout, 3 could not file.
 */
import { pathToFileURL } from "node:url";

const DEFAULT_ORIGIN = "https://loki.orangecat.ch";
const STATES = ["queued", "starting", "working", "needs_you", "done", "failed"];

export async function walk(
  env,
  {
    fetchImpl = fetch,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    log = console.log,
  } = {},
) {
  const token = env.LOKI_SEAT_TOKEN;
  const projectId = env.LOKI_PROJECT_ID;
  if (!token || !projectId) {
    log(
      "Set LOKI_SEAT_TOKEN and LOKI_PROJECT_ID (the token is read from the environment, never from arguments).",
    );
    return 3;
  }
  const origin = new URL(env.LOKI_URL || DEFAULT_ORIGIN).origin;
  const agentName = env.LOKI_AGENT_NAME || "QA · quality control";
  const deadline = Date.now() + Number(env.LOKI_WALK_TIMEOUT_S || 600) * 1000;
  const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

  const key = `agent-walk-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  const res = await fetchImpl(`${origin}/api/projects/${encodeURIComponent(projectId)}/feedback`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      suggestion:
        "Agent walk: a harmless test report from the scripted walk. Safe to close without a change.",
      agentName,
      idempotencyKey: key,
    }),
  });
  const filed = await res.json().catch(() => ({}));
  if (!res.ok) {
    log(`Filing failed: HTTP ${res.status} ${filed.error ?? ""}`.trim());
    return 3;
  }
  log(
    `Filed ${filed.id} as "${agentName}" (HTTP ${res.status}). building: ${filed.building === true}`,
  );
  if (filed.building)
    log(
      `The owner opted this project into agent builds: ${filed.buildNote ?? "a build was started"}`,
    );

  // The token only ever goes to the origin it was given for.
  const statusUrl = new URL(filed.statusUrl);
  if (statusUrl.origin !== origin) {
    log(`statusUrl is on ${statusUrl.origin}, not ${origin}; not sending the token there.`);
    return 3;
  }

  let last = "";
  while (Date.now() < deadline) {
    const r = await fetchImpl(statusUrl, { headers });
    const s = await r.json().catch(() => ({}));
    if (!r.ok) {
      log(`Status failed: HTTP ${r.status} ${s.error ?? ""}`.trim());
      return 3;
    }
    if (!STATES.includes(s.state)) {
      log(`Unknown state "${s.state}"`);
      return 3;
    }
    const line = [s.state, s.label, s.cause, s.reason].filter(Boolean).join(" · ");
    if (line !== last) log(line);
    last = line;
    if (s.state === "done") return 0;
    if (s.state === "failed") return 1;
    await sleep(5000);
  }
  log("Stopped polling: time ran out.");
  return 2;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  walk(process.env).then((code) => process.exit(code));
}
