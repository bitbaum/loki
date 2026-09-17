/**
 * Loki end-to-end, against a REAL deployment, as the signed-in operator.
 *
 * "Does Loki work as intended?" has exactly three testable meanings, and this
 * file asks all three through the same HTTP API the /loki page uses — no
 * browser, no mocks, no fixtures:
 *
 *   1. KNOWS the fleet — a fleet-shaped question is answered from the studio
 *      map (the three pillars named, `fleet_map` among the retrieved sources)
 *      and the answer is an ANSWER, not the model's plan for one.
 *   2. PUBLISHES the map — /api/fleet/map is public, names the pillars as
 *      live, and bitbaum's map.json is the same map (not a stale copy).
 *   3. CLOSES THE LOOP (--dispatch) — a request typed into a thread comes
 *      back into that thread as an `outcome` turn. When the box builder has no
 *      working auth this is the check that fails, and it says so.
 *
 * Every check prints PASS/FAIL with the evidence; the exit code is the verdict.
 * A dispatch that never returns is aborted (user_abort) so a test never leaves
 * a run hanging in the operator's queue; its prompt carries the [loki-e2e]
 * marker so it is recognisable in the ledger.
 *
 *   LOKI_SESSION_TOKEN=… npx tsx scripts/test/loki-loop-e2e.ts [--dispatch]
 *   BASE=https://loki.orangecat.ch  E2E_DISPATCH_MINUTES=30  E2E_PROJECT=loki
 */
import { config } from "dotenv";
import { smokeSessionToken } from "@/lib/brand-env";
import { looksLikePlan } from "@/lib/loki/plan-as-answer";

config({ path: ".env.local", quiet: true });
config({ path: ".env.hetzner.local", quiet: true });

const BASE = (process.env.BASE ?? "https://loki.orangecat.ch").replace(/\/$/, "");
const BITBAUM_MAP = process.env.BITBAUM_MAP_URL ?? "https://bitbaum.orangecat.ch/map.json";
const PROJECT = process.env.E2E_PROJECT ?? "loki";
const DISPATCH = process.argv.includes("--dispatch");
/**
 * How long to wait for a dispatched run to come back.
 *
 * Thirty, not twenty, and measured rather than guessed: on 2026-09-15 a
 * cold-start agent on the box (fresh PTY, boot, trust prompt, then the task)
 * wrote its handoff at 13:44 for a dispatch injected at 13:23 — twenty-one
 * minutes for `git status`. The old twenty-minute window aborted it at 13:43
 * and reported a broken loop that was one minute from succeeding. A health
 * check must outlast the slowest healthy path it exercises.
 */
const DISPATCH_MINUTES = Number(process.env.E2E_DISPATCH_MINUTES ?? 30);
const MARKER = "[loki-e2e]";
/** The handoff summary the probe asks for, and the proof that it came back. */
const PROBE_SUMMARY = "e2e ok — no changes";

const token = smokeSessionToken();
if (!token) {
  console.error(
    "✗ no session: set LOKI_SESSION_TOKEN (mint one with scripts/test/print-session-token.ts)",
  );
  process.exit(2);
}
const cookieName = BASE.startsWith("https://")
  ? "__Secure-authjs.session-token"
  : "authjs.session-token";
const headers = { cookie: `${cookieName}=${token}`, "content-type": "application/json" };

type Verdict = { name: string; ok: boolean; skipped?: boolean; evidence: string };
const verdicts: Verdict[] = [];
function record(name: string, ok: boolean, evidence: string) {
  verdicts.push({ name, ok, evidence });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}\n      ${evidence}`);
}

/**
 * A third verdict, and why it exists: Loki rations the free model tier per day,
 * so "You've used your share of today's free AI budget" is a CORRECT refusal,
 * not a broken assistant. On a six-hourly timer, failing on it would page for a
 * working product until nobody read the alerts. Say SKIP, loudly, and do not
 * fail the run.
 */
function skip(name: string, why: string) {
  verdicts.push({ name, ok: true, skipped: true, evidence: why });
  console.log(`SKIP  ${name}\n      ${why}`);
}

/** Loki's own refusal when the rationed budget is spent, or a vendor 429. */
const RATIONED =
  /free ai budget|share of today|try again in \d+ ?min|rate.?limit|429|quota|out of (?:tokens|credits)/i;

type Turn = {
  role: string;
  kind?: string | null;
  content: string;
  meta?: Record<string, unknown> | null;
};

async function createConversation(title: string, projectKeys: string[]): Promise<string> {
  const res = await fetch(`${BASE}/api/conversations`, {
    method: "POST",
    headers,
    body: JSON.stringify({ title, projectKeys }),
  });
  if (!res.ok) throw new Error(`create conversation → ${res.status}`);
  const j = (await res.json()) as { conversation: { id: string } };
  return j.conversation.id;
}

/** Post one message and collect the assistant turns from the SSE stream. */
async function send(
  conversationId: string,
  text: string,
  opts: { selectedProjects: string[]; chatOnly?: boolean },
): Promise<Turn[]> {
  const res = await fetch(`${BASE}/api/conversations/${conversationId}/messages`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      text,
      selectedProjects: opts.selectedProjects,
      chatOnly: opts.chatOnly ?? false,
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) throw new Error(`send → ${res.status} ${(await res.text()).slice(0, 200)}`);
  const raw = await res.text();
  const turns: Turn[] = [];
  for (const line of raw.split("\n")) {
    if (!line.startsWith("data:")) continue;
    try {
      const ev = JSON.parse(line.slice(5).trim()) as { type?: string; message?: Turn };
      if (ev.type === "message" && ev.message?.role === "assistant") turns.push(ev.message);
    } catch {
      /* keep-alive or partial frame */
    }
  }
  return turns;
}

async function thread(conversationId: string): Promise<Turn[]> {
  const res = await fetch(`${BASE}/api/conversations/${conversationId}`, { headers });
  if (!res.ok) throw new Error(`read thread → ${res.status}`);
  return ((await res.json()) as { messages: Turn[] }).messages;
}

/**
 * The run's own state, so a lost notification cannot read as a broken loop.
 *
 * GET /api/orchestration/runs/[id] answers the DERIVED dispatch view
 * (status/label/terminal), not the raw row — reading it as {state,outcome}
 * printed "?/-" and told nobody anything (2026-09-15).
 */
const CLOSED_STATUSES = new Set(["completed", "partial", "stopped", "failed"]);

async function runState(runId: string): Promise<{ label: string; closed: boolean }> {
  try {
    const res = await fetch(`${BASE}/api/orchestration/runs/${runId}`, { headers });
    if (!res.ok) return { label: `unreadable (HTTP ${res.status})`, closed: false };
    const v = (await res.json()) as { status?: string; label?: string; terminal?: boolean };
    const status = v.status ?? "?";
    return {
      label: `${status}${v.label ? ` (${v.label})` : ""}`,
      closed: CLOSED_STATUSES.has(status) && v.terminal === true,
    };
  } catch (e) {
    return { label: `unreadable (${(e as Error).message})`, closed: false };
  }
}

async function abortRun(runId: string, why: string): Promise<void> {
  await fetch(`${BASE}/api/orchestration/runs/${runId}/finish`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      outcome: "user_abort",
      userAbort: true,
      error: `${MARKER} ${why}`.slice(0, 2000),
    }),
  }).catch(() => undefined);
}

// ── 1. knows the fleet ──────────────────────────────────────────────────────
/**
 * One retry, because this check runs on a timer and the model chain underneath
 * it is a rationed free tier: a single provider hiccup is not a regression,
 * and an alert that cries wolf gets muted. Two failures in a row is a signal.
 */
async function askPillars(): Promise<{ text: string; meta: Record<string, unknown> }> {
  const id = await createConversation(`${MARKER} pillars`, []);
  const turns = await send(
    id,
    "What are the three pillars of the studio, and which layer is each? Answer in three lines.",
    { selectedProjects: [], chatOnly: true },
  );
  const answer = turns.find((t) => t.kind === "chat") ?? turns[0];
  return { text: (answer?.content ?? "").trim(), meta: answer?.meta ?? {} };
}

async function checkKnowsTheFleet() {
  let { text, meta } = await askPillars();
  let named = ["orangecat", "loki", "solon"].filter((p) => text.toLowerCase().includes(p));
  // One retry for a transient miss — but never for a rationed refusal, which
  // would only spend the next window too.
  if ((named.length < 3 || looksLikePlan(text)) && !RATIONED.test(text)) {
    await new Promise((r) => setTimeout(r, 5_000));
    ({ text, meta } = await askPillars());
    named = ["orangecat", "loki", "solon"].filter((p) => text.toLowerCase().includes(p));
  }
  if (RATIONED.test(text)) {
    skip(
      "knows the fleet: pillars answered from the map",
      `the free AI budget is spent, so the assistant refused rather than answered — not a fleet-knowledge failure: "${text.replace(/\s+/g, " ").slice(0, 150)}"`,
    );
    return;
  }
  const lower = text.toLowerCase();
  void lower;
  const retrieved = (meta.retrieved as Array<{ source?: string }> | undefined) ?? [];
  const fromMap = retrieved.some((r) => r.source === "fleet_map");
  const plan = looksLikePlan(text);
  record(
    "knows the fleet: pillars answered from the map",
    named.length === 3 && fromMap && !plan && text.length > 0,
    `named ${named.length}/3 (${named.join(", ") || "none"}); fleet_map retrieved: ${fromMap}; plan-as-answer: ${plan}; via ${String(meta.via ?? "?")} ${String(meta.model ?? "")}\n      "${text.replace(/\s+/g, " ").slice(0, 220)}"`,
  );
}

// ── 2. publishes the map ────────────────────────────────────────────────────
async function checkPublishesTheMap() {
  const res = await fetch(`${BASE}/api/fleet/map`);
  const map = res.ok
    ? ((await res.json()) as {
        generatedAt: string;
        summary: { projects: number; live: number };
        projects: Array<{ slug: string; status: string }>;
      })
    : null;
  const pillars = ["orangecat", "loki", "solon"].map((s) =>
    map?.projects.find((p) => p.slug === s),
  );
  const pillarsLive = pillars.every((p) => p?.status === "live");
  record(
    "publishes the map: public, pillars live",
    res.ok && (map?.summary.projects ?? 0) >= 20 && pillarsLive,
    `HTTP ${res.status}; ${map?.summary.projects ?? 0} projects, ${map?.summary.live ?? 0} live; pillars ${pillars.map((p) => `${p?.slug ?? "?"}=${p?.status ?? "missing"}`).join(" ")}`,
  );

  const bb = await fetch(BITBAUM_MAP).catch(() => null);
  const published = bb?.ok
    ? ((await bb.json()) as { generatedAt: string; summary: { projects: number } })
    : null;
  const ageDays = published
    ? (Date.now() - Date.parse(published.generatedAt)) / 86_400_000
    : Infinity;
  const sameSize =
    !!map && !!published && Math.abs(map.summary.projects - published.summary.projects) <= 3;
  record(
    "bitbaum shows the same map, recently",
    !!published && ageDays < 8 && sameSize,
    `bitbaum map.json ${bb?.status ?? "unreachable"}; generated ${published ? ageDays.toFixed(1) : "?"} days ago; ${published?.summary.projects ?? "?"} vs ${map?.summary.projects ?? "?"} projects`,
  );
}

// ── 3. closes the loop ──────────────────────────────────────────────────────
async function checkClosesTheLoop() {
  const id = await createConversation(`${MARKER} loop`, [PROJECT]);
  const task =
    `${MARKER} Health probe of the dispatch loop. Do NOT change any file, do NOT commit, push or open a pull request. ` +
    `Run \`git status --short | head -3\` in the checkout, then write a handoff whose summary is exactly: "${PROBE_SUMMARY}". Finish immediately.`;
  const turns = await send(id, task, { selectedProjects: [PROJECT] });
  const dispatch = turns.find((t) => t.kind === "dispatch");
  const runId = (dispatch?.meta?.runId as string | undefined) ?? null;
  const ok = dispatch?.meta?.ok === true;
  const commandId = dispatch?.meta?.commandId as string | undefined;
  // A dispatch to a BUSY project is held: Loki journals it and enqueues no
  // command, so no builder can ever pick it up and no outcome can arrive. That
  // is correct serialisation, not a broken loop — but a check that waited 20
  // minutes and then blamed the builder taught exactly the wrong thing
  // (2026-09-15: the blocker was this check's own previous run).
  if (ok && runId && !commandId && dispatch?.meta?.mode === "queued") {
    await abortRun(runId, "held behind an open run — nothing to wait for");
    skip(
      "closes the loop: outcome came back into the thread",
      `the dispatch was HELD behind an open run on ${PROJECT} (no command enqueued), so no outcome could arrive. Close or abort the blocking run and re-run; the loop itself was not exercised.`,
    );
    return;
  }
  if (!ok || !runId) {
    record(
      "closes the loop: dispatch accepted",
      false,
      `no dispatch turn / runId (${JSON.stringify(dispatch?.meta ?? {}).slice(0, 200)})`,
    );
    return;
  }
  record(
    "closes the loop: dispatch accepted",
    true,
    `run ${runId} via ${String(dispatch?.meta?.channel ?? "?")}`,
  );

  const deadline = Date.now() + DISPATCH_MINUTES * 60_000;
  let outcome: Turn | undefined;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 20_000));
    const msgs = await thread(id).catch(() => []);
    outcome = msgs.find((m) => m.kind === "outcome");
    if (outcome) break;
  }
  if (!outcome) {
    // Name WHICH half broke. A closed run with no turn is a lost notification
    // (the work happened); an open run is a stuck builder.
    const { label: state, closed } = await runState(runId);
    if (!closed) {
      await abortRun(
        runId,
        `no outcome within ${DISPATCH_MINUTES} min — check builder auth (loki-builder-auth timer) and the box-runner`,
      );
    }
    record(
      "closes the loop: outcome came back into the thread",
      false,
      closed
        ? `run ${runId} CLOSED (${state}) but wrote no outcome turn — the work happened, the notification was lost. Suspect a process that exits before its fire-and-forget close notification (see settle-background-work.ts).`
        : `run ${runId} still ${state} after ${DISPATCH_MINUTES} min — aborted. First suspect: the box builder cannot authenticate (see /opt/monitoring/builder-auth-check.sh --report).`,
    );
    return;
  }
  const text = outcome.content.replace(/\s+/g, " ");
  /**
   * What proves the loop is the agent's OWN words coming back into the thread
   * — not a ✅.
   *
   * This probe forbids changing a file, committing, or opening a pull request,
   * and the definition-of-done judge correctly downgrades a run with no
   * committed change to 🟡 ("include a committed and pushed change"). So the
   * old `/✅/` assertion asserted the one thing the prompt ruled out: a
   * perfect run failed the check, and the box reported a broken loop while
   * every leg of it worked (2026-09-17, run 69cdbdb7 — injected 11:56:11,
   * handoff "e2e ok — no changes" 32 seconds later).
   *
   * A ❌ is still a failure, and a turn without the probe's own summary still
   * fails: that is what would catch a run closed off somebody else's handoff.
   */
  const failed = /❌/.test(text);
  const carriesHandoff = text.includes(PROBE_SUMMARY);
  record(
    "closes the loop: outcome came back into the thread",
    !failed && carriesHandoff,
    `run ${runId}: "${text.slice(0, 220)}"`,
  );
}

(async () => {
  console.log(
    `loki e2e against ${BASE} (dispatch: ${DISPATCH ? `on, ${DISPATCH_MINUTES} min` : "off"})\n`,
  );
  try {
    await checkKnowsTheFleet();
  } catch (e) {
    record("knows the fleet: pillars answered from the map", false, (e as Error).message);
  }
  try {
    await checkPublishesTheMap();
  } catch (e) {
    record("publishes the map", false, (e as Error).message);
  }
  if (DISPATCH) {
    try {
      await checkClosesTheLoop();
    } catch (e) {
      record("closes the loop", false, (e as Error).message);
    }
  }
  const failed = verdicts.filter((v) => !v.ok);
  const skipped = verdicts.filter((v) => v.skipped);
  const passed = verdicts.length - failed.length - skipped.length;
  console.log(
    `\n${passed}/${verdicts.length} passed${skipped.length ? `, ${skipped.length} skipped` : ""}${failed.length ? ` — FAILED: ${failed.map((f) => f.name).join("; ")}` : ""}`,
  );
  process.exit(failed.length ? 1 : 0);
})();
