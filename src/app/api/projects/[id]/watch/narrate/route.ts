import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { and, desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { promptHistory } from "@/db/schema/prompt-history";
import { getSessionUserId } from "@/lib/session";
import { jsonError, jsonOk, readIdParam } from "@/lib/api/route-helpers";
import { getProjectCore } from "@/db/queries/projects";
import { getProjectOrchestrationRuns } from "@/db/queries/orchestration-runs";
import { callTextDetailed } from "@/lib/groq";
import { checkAiBudget, recordAiSpend } from "@/lib/ai-budget/gate";
import { checkRateLimit } from "@/lib/rate-limit";
import { HTTP_TIMEOUT_LONG_MS, RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import {
  NARRATE_MAX_LINE_CHARS,
  NARRATE_MAX_LINES,
  NARRATION_SYSTEM,
  narrationPrompt,
} from "@/lib/watch-narration";
import { parseNarration } from "@/lib/watch-narration-parse";

/**
 * One plain-language headline for what the agent is doing now, read from the
 * screen the Watch page already peeked. See lib/watch-narration.
 *
 * Degrades, never errors at the person: out of budget, rate-limited or a model
 * that answered nothing readable all return `narration: null`, and the page
 * keeps showing the activity line it already had.
 */
const Body = z.object({
  screen: z.array(z.string().max(NARRATE_MAX_LINE_CHARS * 2)).max(NARRATE_MAX_LINES * 2),
  previous: z.string().max(200).nullable().optional(),
});

/** ~One every 30s for two hours of watching, per person. */
const NARRATIONS_PER_HOUR = 240;

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getSessionUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const idOrResp = await readIdParam(params);
  if (idOrResp instanceof NextResponse) return idOrResp;
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Invalid screen", 400);

  const project = await getProjectCore(userId, idOrResp);
  if (!project) return jsonError("Not found", 404);

  const quiet = jsonOk({ narration: null });
  if (!checkRateLimit(`watch-narrate:${userId}`, NARRATIONS_PER_HOUR, RATE_LIMIT_WINDOW_LONG_MS))
    return quiet;
  if (!(await checkAiBudget(userId)).allowed) return quiet;

  const run = (await getProjectOrchestrationRuns(userId, idOrResp, 1))[0] ?? null;
  const asked = run
    ? await db
        .select({ custom: promptHistory.customPrompt, resolved: promptHistory.resolvedPrompt })
        .from(promptHistory)
        .where(and(eq(promptHistory.userId, userId), eq(promptHistory.runId, run.id)))
        .orderBy(desc(promptHistory.dispatchedAt))
        .limit(1)
        .then((rows) => rows[0]?.custom ?? rows[0]?.resolved ?? null)
    : null;

  try {
    const answered = await callTextDetailed(
      narrationPrompt({
        project: project.name,
        asked,
        previous: parsed.data.previous ?? null,
        screen: parsed.data.screen,
      }),
      {
        feature: "watch-narrate",
        systemPrompt: NARRATION_SYSTEM,
        maxTokens: 300,
        temperature: 0.2,
        timeoutMs: HTTP_TIMEOUT_LONG_MS,
      },
    );
    void recordAiSpend(userId, answered.tokens);
    return jsonOk(
      { narration: parseNarration(answered.text) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    console.error("[watch-narrate]", e instanceof Error ? e.message : e);
    return quiet;
  }
}
