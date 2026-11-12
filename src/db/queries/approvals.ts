import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { orchestrationRuns, pendingCommands } from "@/db/schema";
import { emitRunEvent } from "./run-events";
import { publishFastLaneEvent } from "@/lib/bridge-publish";
import { RUN_BLOCKED } from "@/lib/run-progress";
import { isShellTab } from "@/lib/shell-session";
import {
  approvalChoices,
  approvalHeadline,
  approvalId,
  approvalKeys,
  approvalKind,
  parseApprovalId,
  type ApprovalDecision,
  type PendingApproval,
} from "@/lib/approvals";
import type { BuilderChannel } from "@/lib/event-stream-types";

type BlockedRun = {
  id: string;
  projectKey: string;
  adapter: string;
  payload: Record<string, unknown> | null;
};

/** Where the run's agent lives: the tab and builder its command named. */
async function runSession(
  run: BlockedRun,
): Promise<{ tab: string; channel: BuilderChannel | null }> {
  const [cmd] = await db
    .select({ payload: pendingCommands.payload })
    .from(pendingCommands)
    .where(sql`${pendingCommands.payload}->>'runId' = ${run.id}`)
    .orderBy(desc(pendingCommands.createdAt))
    .limit(1);
  const p = (cmd?.payload ?? {}) as { tab?: unknown; channel?: unknown };
  const tab =
    (typeof run.payload?.sessionTab === "string" && run.payload.sessionTab) ||
    (typeof p.tab === "string" && p.tab) ||
    run.projectKey;
  const channel = p.channel === "cloud" || p.channel === "local" ? p.channel : null;
  return { tab, channel };
}

function toPending(run: BlockedRun, tab: string, now: number): PendingApproval {
  const question = String(run.payload?.blockedQuestion ?? "").trim() || "permission to run a tool";
  const since = typeof run.payload?.blockedAt === "string" ? run.payload.blockedAt : null;
  const kind = approvalKind(question);
  return {
    id: approvalId(run.id, question),
    runId: run.id,
    tab,
    project: run.projectKey,
    question,
    kind,
    choices: approvalChoices(kind),
    since,
    headline: approvalHeadline(question, since, now),
  };
}

async function blockedRuns(userId: string, runId?: string): Promise<BlockedRun[]> {
  return db
    .select({
      id: orchestrationRuns.id,
      projectKey: orchestrationRuns.projectKey,
      adapter: orchestrationRuns.adapter,
      payload: orchestrationRuns.payload,
    })
    .from(orchestrationRuns)
    .where(
      and(
        eq(orchestrationRuns.userId, userId),
        isNull(orchestrationRuns.finishedAt),
        sql`${orchestrationRuns.payload}->>'blocked' = ${RUN_BLOCKED.PERMISSION}`,
        runId ? eq(orchestrationRuns.id, runId) : undefined,
      ),
    ) as Promise<BlockedRun[]>;
}

/**
 * The permission prompts this account's agents are waiting on, newest
 * question last; with `tab`, that session's only. Owner-scoped: every row is
 * the caller's own run.
 */
export async function listPendingApprovals(
  userId: string,
  tab?: string | null,
  now = Date.now(),
): Promise<PendingApproval[]> {
  const runs = await blockedRuns(userId);
  const out: PendingApproval[] = [];
  for (const run of runs) {
    const session = await runSession(run);
    if (tab && session.tab.toLowerCase() !== tab.trim().toLowerCase()) continue;
    out.push(toPending(run, session.tab, now));
  }
  return out.sort((a, b) => (a.since ?? "").localeCompare(b.since ?? ""));
}

export type ApprovalAnswerResult =
  | { ok: true; approval: PendingApproval; decision: ApprovalDecision }
  | { ok: false; status: 404 | 409 | 422; error: string };

/**
 * Answer one prompt: the keys go to the agent's terminal through the bridge's
 * keystroke lane (the same one a person's terminal types through), the run
 * stops reading as blocked, and the answer is recorded on the run.
 *
 * Refused, with nothing typed, when the prompt is not this account's, is
 * gone, has changed (the id names the question), or this agent has no known
 * key for that answer.
 */
export async function answerApproval(input: {
  userId: string;
  approvalId: string;
  decision: ApprovalDecision;
  tab?: string | null;
  answeredBy: { userId: string; via: "session" | "token" | "mcp" };
}): Promise<ApprovalAnswerResult> {
  const parsed = parseApprovalId(input.approvalId);
  if (!parsed) return { ok: false, status: 404, error: "No such approval." };
  const [run] = await blockedRuns(input.userId, parsed.runId);
  if (!run) {
    return { ok: false, status: 404, error: "Nothing is waiting for this approval any more." };
  }
  const session = await runSession(run);
  if (input.tab && session.tab.toLowerCase() !== input.tab.trim().toLowerCase()) {
    return { ok: false, status: 404, error: "No such approval in this session." };
  }
  if (isShellTab(session.tab)) {
    return { ok: false, status: 404, error: "No such approval." };
  }
  const approval = toPending(run, session.tab, Date.now());
  if (approval.id !== input.approvalId) {
    return {
      ok: false,
      status: 409,
      error: "The agent is asking something else now. List the approvals again and answer that.",
    };
  }
  const keys = approvalKeys(input.decision, run.adapter, approval.kind);
  if (!keys) {
    return {
      ok: false,
      status: 422,
      error: `"${input.decision}" cannot be answered for this prompt from Loki. Answer it in the session's terminal.`,
    };
  }

  // Cleared first, by the same condition it was read with: of two answers
  // racing, one wins and the other finds nothing waiting.
  const at = new Date().toISOString();
  const answer = {
    decision: input.decision,
    by: input.answeredBy.userId,
    via: input.answeredBy.via,
    at,
    question: approval.question,
  };
  const cleared = await db
    .update(orchestrationRuns)
    .set({
      payload: sql`jsonb_set(jsonb_set(jsonb_set(jsonb_set(COALESCE(payload, '{}'),
        '{blocked}', 'null'::jsonb), '{blockedQuestion}', 'null'::jsonb),
        '{blockedAt}', 'null'::jsonb), '{lastApproval}', ${JSON.stringify(answer)}::jsonb)`,
    })
    .where(
      and(
        eq(orchestrationRuns.id, run.id),
        eq(orchestrationRuns.userId, input.userId),
        isNull(orchestrationRuns.finishedAt),
        sql`${orchestrationRuns.payload}->>'blocked' = ${RUN_BLOCKED.PERMISSION}`,
        sql`${orchestrationRuns.payload}->>'blockedQuestion' = ${run.payload?.blockedQuestion ?? ""}`,
      ),
    )
    .returning({ id: orchestrationRuns.id });
  if (cleared.length === 0) {
    return { ok: false, status: 409, error: "Someone answered it a moment ago." };
  }

  await publishFastLaneEvent({
    kind: "rawkey",
    u: input.userId,
    tab: session.tab,
    b: keys,
    ...(session.channel ? { ch: session.channel } : {}),
  });
  void emitRunEvent(run.id, input.userId, "approval", answer);
  return { ok: true, approval, decision: input.decision };
}
