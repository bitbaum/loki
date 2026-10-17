import { NextRequest, NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { jsonError, jsonOk, readIdParam } from "@/lib/api/route-helpers";
import { getFeedbackWithProject, setFeedbackRead } from "@/db/queries/site-feedback";
import { callTextDetailed } from "@/lib/groq";
import { checkAiBudget, recordAiSpend } from "@/lib/ai-budget/gate";
import { checkRateLimit } from "@/lib/rate-limit";
import { HTTP_TIMEOUT_LONG_MS, RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import { READ_SYSTEM, readReportPrompt } from "@/lib/feedback/read-report";
import { parseFeedbackRead } from "@/lib/feedback/read-report-parse";

/**
 * POST /api/feedback/[id]/read — Loki reads the report for the owner: what
 * the person means, the impact, the size, the risk, and the ask it would
 * give the agent (lib/feedback/read-report). Stored on the row, so it is
 * computed once; `force` reads again. Owner or editor only; the owner's AI
 * budget; never from a timer. NOTE: /api/feedback is excluded from the auth
 * middleware (the public ingest lives there), so the session check below is
 * the ONLY gate on this handler — do not remove it.
 */
const READS_PER_HOUR = 120;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const force = req.nextUrl.searchParams.get("force") === "1";

  const row = await getFeedbackWithProject(userId, idOrResp);
  if (!row) return jsonError("Feedback not found", 404);
  if (!row.canEdit) return jsonError("Only project owners and editors can read feedback", 403);
  if (row.feedback.read && !force) return jsonOk({ read: row.feedback.read });

  if (!checkRateLimit(`feedback-read:${userId}`, READS_PER_HOUR, RATE_LIMIT_WINDOW_LONG_MS))
    return jsonError("Too many reads — try again in a bit", 429);
  const budget = await checkAiBudget(row.ownerUserId);
  if (!budget.allowed) return jsonOk({ read: null, reason: "budget" });

  const f = row.feedback;
  const pointedAt = (f.selectedElements ?? [])
    .map((el) => (el.elementText ? `${el.elementType} “${el.elementText}”` : el.elementType))
    .filter((s): s is string => Boolean(s));
  try {
    const answered = await callTextDetailed(
      readReportPrompt({
        project: row.projectName,
        page: f.url ?? f.page ?? null,
        report: f.suggestion,
        pointedAt,
        context: f.captureContext ? JSON.stringify(f.captureContext) : null,
      }),
      {
        feature: "feedback-read",
        systemPrompt: READ_SYSTEM,
        maxTokens: 500,
        temperature: 0.2,
        timeoutMs: HTTP_TIMEOUT_LONG_MS,
      },
    );
    void recordAiSpend(row.ownerUserId, answered.tokens);
    const read = parseFeedbackRead(answered.text);
    if (read) await setFeedbackRead(row.ownerUserId, f.id, read);
    return jsonOk({ read }, { headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    console.error("[feedback-read]", e instanceof Error ? e.message : e);
    return jsonOk({ read: null, reason: "model" });
  }
}
