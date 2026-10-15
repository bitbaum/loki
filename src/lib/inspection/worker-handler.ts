import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { siteReviews, type SiteReview } from "@/db/schema/site-reviews";
import { addReviewEvent, updateSiteReview } from "@/db/queries/site-reviews";
import { REVIEW_LIMITS, ReviewFinding, type ReviewWorkerEvent, reviewUrl } from "./contract";
import { analyzeImages } from "@/lib/vision";
import { checkAiBudget, recordAiSpend } from "@/lib/ai-budget/gate";
import { parseModelJson } from "@/lib/ai/model-json";
import { REVIEW_VISION_SYSTEM } from "./prompt";
import { z } from "zod";

const Critique = z.object({
  comment: z.string().max(1500),
  findings: z
    .array(
      z.object({
        title: z.string().max(160),
        detail: z.string().max(2000),
        evidence: z.string().max(2000),
      }),
    )
    .max(2),
});
/** Checkpoints are the execution boundary: a worker cannot publish after pause/stop. */
export async function handleReviewWorker(
  row: SiteReview,
  event: z.infer<typeof ReviewWorkerEvent>,
) {
  if (event.kind === "checkpoint") {
    const [claimed] = await db
      .update(siteReviews)
      .set({
        workerId: event.workerId,
        heartbeatAt: new Date(),
        workerState:
          row.status === "paused" ? "paused" : row.status === "queued" ? "running" : row.status,
        status: row.status === "queued" ? "running" : row.status,
      })
      .where(
        and(
          eq(siteReviews.id, row.id),
          sql`(${siteReviews.workerId} IS NULL OR ${siteReviews.workerId} = ${event.workerId})`,
          eq(siteReviews.status, row.status),
        ),
      )
      .returning();
    return claimed ?? null;
  }
  if (row.status !== "running") return null;
  if (event.kind === "frame") {
    if (!reviewUrl(event.frame.url, row.url))
      throw new Error("The browser left this review's site.");
    // Conditional write: a simultaneous Pause always wins over a late frame.
    const [saved] = await db
      .update(siteReviews)
      .set({ frame: event.frame, heartbeatAt: new Date() })
      .where(and(eq(siteReviews.id, row.id), eq(siteReviews.status, "running")))
      .returning();
    if (!saved) return null;
    await addReviewEvent(row, { kind: "observation", text: event.text });
    if (event.analyze && (row.mode === "visual" || row.mode === "full")) {
      if (!(await checkAiBudget(row.userId)).allowed) {
        await addReviewEvent(row, {
          kind: "observation",
          text: "Visual commentary is unavailable because the AI budget is exhausted. Browser checks continue; visual quality remains unverified.",
        });
        return saved;
      }
      try {
        const result = await analyzeImages({
          prompt: `Review this viewport of ${event.frame.url}, width ${event.frame.width}, scroll ${event.frame.scrollY}.`,
          images: [{ mimeType: "image/jpeg", dataBase64: event.frame.image.split(",")[1]! }],
          systemPrompt: REVIEW_VISION_SYSTEM,
          maxTokens: 700,
          timeoutMs: 25000,
        });
        void recordAiSpend(row.userId, 1500);
        const critique = Critique.parse(parseModelJson(result.text));
        await addReviewEvent(row, { kind: "assistant", text: critique.comment });
        for (const finding of critique.findings) {
          if (row.eventCount >= REVIEW_LIMITS.events - 5) break;
          await addReviewEvent(row, {
            kind: "finding",
            text: finding.title,
            finding: ReviewFinding.parse({
              ...finding,
              category: "visual",
              location: `${event.frame.url} · ${event.frame.width}px · scroll ${event.frame.scrollY}`,
            }),
            image: event.frame.image,
          });
        }
      } catch {
        await addReviewEvent(row, {
          kind: "observation",
          text: "Loki could not analyze this screenshot. It is shown for your review; no visual verdict was recorded.",
        });
      }
    }
    return saved;
  }
  if (event.kind === "page") {
    if (!reviewUrl(event.url, row.url)) throw new Error("Page is outside this review.");
    const coverage = row.coverage.filter((p) => !(p.url === event.url && p.width === event.width));
    if (coverage.length >= REVIEW_LIMITS.pages * 2) throw new Error("Page limit reached.");
    return updateSiteReview(row, {
      coverage: [
        ...coverage,
        { url: event.url, width: event.width, result: event.result, detail: event.detail },
      ],
    });
  }
  if (event.kind === "finding") {
    await addReviewEvent(row, {
      kind: "finding",
      text: event.finding.title,
      finding: event.finding,
      image:
        event.finding.category !== "code" && row.frame?.url === event.finding.location
          ? row.frame.image
          : null,
    });
  } else if (event.kind === "finished" || event.kind === "failed") {
    const [ended] = await db
      .update(siteReviews)
      .set({ status: event.kind, workerState: event.kind })
      .where(and(eq(siteReviews.id, row.id), eq(siteReviews.status, "running")))
      .returning();
    if (!ended) return null;
    await addReviewEvent(row, { kind: "observation", text: event.text });
    return ended;
  } else {
    await addReviewEvent(row, { kind: "observation", text: event.text });
  }
  return row;
}
