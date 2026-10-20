import { getUserByOrangeCatActorId } from "@/db/queries/users";
import { setStudioFeeListing } from "@/db/queries/studio-requests";
import { listFeeService } from "@/lib/integrations/orangecat-fee-service";
import { feeServicePayload } from "@/lib/studio/fee";
import type { StudioRequest } from "@/db/schema/studio-requests";

export type FeeListingResult = {
  listed: boolean;
  url: string | null;
  reason?: "no-fee" | "not_linked" | "relink" | "oc_error";
};

/**
 * List the fee a partner stated with a delivery, in the partner's own name,
 * after the delivery is saved — never inside its transaction, where a slow
 * OrangeCat would hold the row lock. Idempotent on the brief: a retry lists
 * nothing twice. The result goes back to the partner's portal so a missing
 * OrangeCat link is said to the one person who can fix it.
 */
export async function listAssignmentFee(
  assignment: StudioRequest,
  partner: StudioRequest,
): Promise<FeeListingResult> {
  if (assignment.feeAmount === null || !assignment.feeCurrency)
    return { listed: false, url: null, reason: "no-fee" };
  if (assignment.feeServiceId) return { listed: true, url: assignment.feeUrl };
  const builder = partner.orangecatActorId
    ? await getUserByOrangeCatActorId(partner.orangecatActorId)
    : null;
  if (!builder) return { listed: false, url: null, reason: "not_linked" };
  const result = await listFeeService(
    builder.id,
    feeServicePayload({
      fee: { amount: assignment.feeAmount, currency: assignment.feeCurrency },
      partnerName: partner.proposedProfile?.name ?? "Partner",
      website: assignment.website,
      changes: assignment.changes,
    }),
    `loki_studio_fee_${assignment.id}`,
  );
  if (!result.ok) return { listed: false, url: null, reason: result.reason };
  await setStudioFeeListing(assignment.userId, assignment.id, result.serviceId, result.url);
  return { listed: true, url: result.url };
}
