import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { HTTP_TIMEOUT_LONG_MS, RATE_LIMIT_WINDOW_SHORT_MS } from "@/lib/constants/time";
import { FEEDBACK_SOURCE } from "@/lib/constants/statuses";
import {
  bumpDuplicateFeedback,
  getFeedbackForTour,
  insertSiteFeedback,
} from "@/db/queries/site-feedback";
import { getOrchestrationRunById } from "@/db/queries/orchestration-runs";
import { callTextDetailed } from "@/lib/groq";
import { stripReasoning } from "@/lib/agent/llm";
import { checkAiBudget, recordAiSpend } from "@/lib/ai-budget/gate";
import { verifyTourToken } from "@/lib/feedback/tour-token";
import {
  buildTourBeats,
  fallbackTourSteps,
  parseTourSteps,
  tourOutro,
  tourPrompt,
  tourSystemPrompt,
  type TourInput,
} from "@/lib/feedback/tour-plan";
import { feedbackContentHash } from "@/lib/feedback/content-hash";
import type { FixShipping } from "@/lib/feedback/fix-shipping";
import { appUrl } from "@/lib/email";
import { PALETTE } from "@/lib/palette";
import { TOUR_OUTLINE_MAX } from "../../../../../widget/tour";

/**
 * "Watch the fix" (widget/tour.ts): the walkthrough script for one shipped
 * feedback item, planned against an outline the owner's own browser read from
 * the live page — and, when a step could not be shown, the report of it.
 *
 * Public + CORS like the rest of the widget API, but it answers only to a
 * signed tour token (lib/feedback/tour-token.ts), which Loki mints for the
 * signed-in owner. Planning is charged to the project owner's AI budget and
 * falls back to a word-overlap script when no model is available — the
 * walkthrough never depends on a vendor being up.
 */

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
} as const;

const TourBody = z.object({
  t: z.string().min(10).max(300),
  path: z.string().max(500).optional(),
  outline: z
    .array(
      z.object({
        i: z.number().int().min(0).max(TOUR_OUTLINE_MAX),
        tag: z.string().max(20),
        text: z.string().max(200),
        id: z.string().max(60).optional(),
      }),
    )
    .max(TOUR_OUTLINE_MAX)
    .optional(),
  problem: z
    .object({
      step: z.number().int().min(0).max(20),
      say: z.string().max(300),
      reason: z.string().max(120),
      path: z.string().max(500).optional(),
    })
    .optional(),
});

function corsJson(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: CORS_HEADERS });
}

export function OPTIONS(req: NextRequest) {
  const requested = req.headers.get("access-control-request-headers");
  return new NextResponse(null, {
    status: 204,
    headers: {
      ...CORS_HEADERS,
      ...(requested ? { "Access-Control-Allow-Headers": requested } : {}),
    },
  });
}

const firstSentence = (s: string | null | undefined) => {
  const text = (s ?? "").replace(/\s+/g, " ").trim();
  if (!text) return null;
  const m = text.match(/^.{20,300}?[.!?](\s|$)/);
  return (m ? m[0] : text.slice(0, 300)).trim();
};

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  if (!checkRateLimit(`widget-tour:ip:${ip}`, 20, RATE_LIMIT_WINDOW_SHORT_MS)) {
    return corsJson({ error: "Too many walkthroughs at once — try again in a few minutes" }, 429);
  }
  const parsed = TourBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return corsJson({ error: "Invalid walkthrough request" }, 400);
  const data = parsed.data;

  const ticket = verifyTourToken(data.t);
  if (!ticket) return corsJson({ error: "This walkthrough link has expired" }, 403);
  const { feedbackId, audience } = ticket;
  const row = await getFeedbackForTour(feedbackId);
  if (!row) return corsJson({ error: "Feedback not found" }, 404);
  const f = row.feedback;

  const run = f.dispatchedRunId ? await getOrchestrationRunById(f.userId, f.dispatchedRunId) : null;
  const fix = (run?.payload as { fix?: FixShipping } | null)?.fix ?? null;
  const didLine = firstSentence((run?.summary as { done?: string } | null)?.done);

  if (data.problem) {
    // The walkthrough could not show part of the fix — the first live check
    // that it is really there failed. File it where every other finding
    // lands, so it reaches the owner and can be implemented like any report.
    if (!checkRateLimit(`widget-tour:problem:${feedbackId}`, 5, RATE_LIMIT_WINDOW_SHORT_MS)) {
      return corsJson({ ok: true });
    }
    const page = data.problem.path ?? f.page ?? null;
    const suggestion = [
      `The walkthrough of a shipped fix could not show this step: “${data.problem.say}” (${data.problem.reason}).`,
      `The fix was for: “${f.suggestion.slice(0, 400)}”.`,
      "Check the change is really live on this page, and fix it if not.",
    ].join(" ");
    const contentHash = feedbackContentHash(suggestion, page);
    const bumped = await bumpDuplicateFeedback(f.projectId, contentHash);
    if (!bumped) {
      await insertSiteFeedback({
        projectId: f.projectId,
        userId: f.userId,
        tokenId: f.tokenId,
        suggestion,
        page,
        url: f.url,
        pageTitle: f.pageTitle,
        scope: "page",
        source: FEEDBACK_SOURCE.AI_REVIEW,
        contentHash,
      });
    }
    return corsJson({ ok: true });
  }

  const outline = data.outline ?? [];
  const input: TourInput = {
    suggestion: f.suggestion,
    didLine,
    prTitle: fix?.pr?.title ?? null,
    selectors: (f.selectedElements ?? []).map((el) => el.selector).filter(Boolean),
    outline,
    note: fix?.pr?.note ?? null,
    audience,
  };

  let steps = [] as ReturnType<typeof fallbackTourSteps>;
  // The reporter's own picked element is the most reliable anchor; a model is
  // only needed to find the change when nobody pointed at it.
  if (input.selectors.length === 0 && outline.length > 0) {
    const budget = await checkAiBudget(f.userId).catch(() => ({ allowed: false }));
    if (budget.allowed) {
      try {
        const answered = await callTextDetailed(tourPrompt(input), {
          feature: "widget-tour",
          systemPrompt: tourSystemPrompt(audience),
          maxTokens: 1400,
          temperature: 0.2,
          timeoutMs: HTTP_TIMEOUT_LONG_MS,
        });
        void recordAiSpend(f.userId, answered.tokens);
        steps = parseTourSteps(stripReasoning(answered.text), outline.length);
      } catch (e) {
        console.warn("[widget-tour] model unavailable:", e instanceof Error ? e.message : e);
      }
    }
  }
  if (steps.length === 0) steps = fallbackTourSteps(input);

  const asked = f.suggestion.replace(/\s+/g, " ").trim();
  // The reporter's own first screenshot is the closest thing to "before".
  const before =
    (f.screenshots ?? []).find((src) => /^data:image\/(png|jpeg|webp);base64,/.test(src)) ?? null;
  const forReporter = audience === "reporter";
  return corsJson({
    ok: true,
    theme: PALETTE.widget,
    title: forReporter ? "Your fix" : "Watch the fix",
    intro: `You asked: “${asked.length > 140 ? `${asked.slice(0, 139)}…` : asked}” — let me show you what changed.`,
    steps,
    beats: buildTourBeats({ audience, asked, note: fix?.pr?.note ?? null, didLine, steps, before }),
    outro: tourOutro(audience, didLine),
    // The reporter's way back is their own list, never the owner's inbox; and
    // the pull request is the maintainer's business (reporter-view.ts).
    lokiHref: forReporter
      ? `${appUrl()}/my-feedback`
      : `${appUrl()}/feedback?project=${encodeURIComponent(f.projectId)}`,
    lokiLabel: forReporter ? "Back to my feedback" : null,
    prUrl: forReporter ? null : (fix?.pr?.url ?? null),
  });
}
