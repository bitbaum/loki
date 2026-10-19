import { NextRequest } from "next/server";
import { z } from "zod";
import { jsonError } from "@/lib/api/route-helpers";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { HTTP_TIMEOUT_LONG_MS, RATE_LIMIT_WINDOW_LONG_MS } from "@/lib/constants/time";
import { COMMISSION } from "@/config/commission";
import { INSTANT_PREVIEW, INSTANT_PREVIEW_COPY } from "@/config/instant-preview";
import { getDefaultUser } from "@/db/queries/users";
import { checkAiBudget, recordAiSpend } from "@/lib/ai-budget/gate";
import { callTextDetailed } from "@/lib/groq";
import { stripReasoning } from "@/lib/agent/llm";
import { consultSite } from "@/lib/site-consult/consult-site";
import {
  renderInstantPreview,
  type InstantEvent,
  type InstantPlan,
} from "@/lib/instant-preview/render";
import { parsePreviewOps, previewPrompt, previewSystemPrompt } from "@/lib/widget-preview/plan";

export const maxDuration = 90;

const Body = z.object({
  website: z.string().trim().min(1).max(COMMISSION.maxWebsite),
  ask: z.string().trim().min(3).max(INSTANT_PREVIEW.askMax),
});

/**
 * The instant preview on /change (config/instant-preview): the visitor's own
 * site, photographed, then photographed again with their change drawn on it
 * in Loki's browser. Public, before any account — that is the point.
 *
 * Answers as newline-delimited JSON so the page shows their site the moment
 * Loki has it (a few seconds) and the change when the model is done, instead
 * of a spinner for the whole half minute. The address goes through the same
 * consultation (cached, SSRF-guarded) the page already ran, so this never
 * opens anything the consultation would not.
 *
 * The model is paid from the owner's AI budget, behind two rate limits.
 */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return jsonError("Say the website and what should change.", 400);
  if (
    !checkRateLimit(
      `instant-preview:${getClientIp(req)}`,
      INSTANT_PREVIEW.perVisitor,
      RATE_LIMIT_WINDOW_LONG_MS,
    )
  )
    return jsonError(INSTANT_PREVIEW_COPY.limited, 429);
  if (!checkRateLimit("instant-preview:all", INSTANT_PREVIEW.perHour, RATE_LIMIT_WINDOW_LONG_MS))
    return jsonError(INSTANT_PREVIEW_COPY.busy, 429);

  const owner = await getDefaultUser().catch(() => null);
  const budget = owner
    ? await checkAiBudget(owner.id).catch(() => ({ allowed: false }))
    : { allowed: false };
  if (!owner || !budget.allowed) return jsonError(INSTANT_PREVIEW_COPY.busy, 429);

  const consulted = await consultSite(parsed.data.website);
  if (!consulted.ok) return jsonError(consulted.reason, 422);
  const url = consulted.consultation.site.url;
  const ask = parsed.data.ask;

  const plan = async (outline: Parameters<typeof previewPrompt>[0]["outline"]) => {
    try {
      const answered = await callTextDetailed(
        previewPrompt({ ask, fixedFor: null, outline, path: new URL(url).pathname }),
        {
          feature: "instant-preview",
          systemPrompt: previewSystemPrompt(),
          maxTokens: INSTANT_PREVIEW.maxTokens,
          temperature: 0.3,
          timeoutMs: HTTP_TIMEOUT_LONG_MS,
        },
      );
      void recordAiSpend(owner.id, answered.tokens);
      return parsePreviewOps(stripReasoning(answered.text), outline.length);
    } catch (e) {
      console.warn("[instant-preview] model unavailable:", e instanceof Error ? e.message : e);
      return { summary: null, ops: [] } satisfies InstantPlan;
    }
  };

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: InstantEvent | { type: "error"; message: string }) => {
        try {
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        } catch {
          /* The visitor left; the browser finishes on its own. */
        }
      };
      try {
        await renderInstantPreview(url, plan, send);
      } catch (e) {
        console.warn("[instant-preview] failed:", e instanceof Error ? e.message : e);
        send({ type: "error", message: INSTANT_PREVIEW_COPY.failed });
      } finally {
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      }
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}
