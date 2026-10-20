import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getProjectsByOrangeCatEntity } from "@/db/queries/orangecat-links";
import { createOrchestrationEventOnce } from "@/db/queries/orchestration-events";
import { logDebug } from "@/db/queries/debug-logs";
import { readSignedOrangeCatBody } from "@/lib/integrations/orangecat-webhook";
import { markStudioFeePaid } from "@/db/queries/studio-requests";
import { notifyStudioActivity } from "@/lib/studio/notify";
import { mailStudioUpdate } from "@/lib/studio/link-mail";

/**
 * OrangeCat event webhook — economic signals flowing back into the fleet.
 *
 * First event: payment.settled on a linked OC project → a "funding" event in
 * the project's activity timeline. Money that actually settled is the one
 * ground-truth signal agents can't game; surfacing it beside dispatches and
 * run outcomes is the capability layer seeing its anchor. Same HMAC secret
 * and fail-closed/idempotent semantics as /api/orangecat/entitlement.
 */
const Body = z.object({
  type: z.literal("payment.settled"),
  entityType: z.string().trim().max(40),
  entityId: z.string().uuid(),
  title: z.string().trim().max(300).optional(),
  amountBtc: z
    .string()
    .trim()
    .regex(/^\d+(\.\d{1,8})?$/)
    .max(32),
  externalId: z.string().trim().min(1).max(200),
});

export async function POST(req: NextRequest) {
  const dataOrResp = await readSignedOrangeCatBody(req, Body, "events webhook not configured");
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const ev = dataOrResp;

  try {
    // A partner's fee is a service in the partner's name; its settlement is
    // the one way a studio brief becomes paid (lib/studio/fee-listing.ts).
    const paid =
      ev.entityType === "service" ? await markStudioFeePaid(ev.entityId, ev.externalId) : null;
    if (paid) {
      void notifyStudioActivity(paid.row, "fee_paid", paid.body);
      mailStudioUpdate({ to: paid.row.contact, kind: "website", note: paid.body });
      mailStudioUpdate({ to: paid.partner?.contact, kind: "partner", note: paid.body });
    }
    const linkedProjects = await getProjectsByOrangeCatEntity(ev.entityType, ev.entityId);
    if (linkedProjects.length === 0) {
      // Settled payment on an OC entity no FC project links to — fine, most OC
      // commerce has nothing to do with the fleet. 200 so OC never retries.
      return NextResponse.json({
        ok: true,
        recorded: Boolean(paid),
        reason: paid ? "fee-paid" : "no-linked-project",
      });
    }

    const amount = `${ev.amountBtc} BTC`;
    const results = await Promise.all(
      linkedProjects.map(async ({ project }) => {
        const created = await createOrchestrationEventOnce(
          {
            userId: project.userId,
            projectId: project.entityProjectId,
            projectKey: project.name,
            eventType: "funding",
            source: "orangecat",
            detail: `Funding settled on OrangeCat: ${amount}${ev.title ? ` — ${ev.title}` : ""}`,
            happenedAt: new Date(),
          },
          `oc-payment-${ev.externalId}-${project.id}`,
        );
        if (created) {
          await logDebug({
            source: "orangecat/events",
            level: "info",
            message: `funding event recorded for ${project.name}`,
            meta: { externalId: ev.externalId, entityId: ev.entityId, amount },
          }).catch(() => {});
        }
        return created;
      }),
    );
    const recorded = results.filter(Boolean).length;
    return NextResponse.json({
      ok: true,
      recorded: recorded > 0,
      recordedCount: recorded,
      dedupedCount: results.length - recorded,
    });
  } catch (err) {
    console.error("[orangecat/events] failed:", (err as Error).message);
    return NextResponse.json({ error: "event processing failed" }, { status: 500 });
  }
}
