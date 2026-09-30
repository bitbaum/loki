import { z } from "zod";
import { COMMISSION } from "@/config/commission";
import type { WebsiteBriefBody } from "@/lib/website-brief";

export const StudioContract = z.object({
  version: z.literal(1),
  origin: z.literal(COMMISSION.studioOrigin),
  availability: z.object({ state: z.enum(["open", "closed"]), line: z.string().min(1).max(1000) }),
  offer: z.object({
    id: z.string().min(1).max(80),
    name: z.string().min(1).max(100),
    price: z.string().min(1).max(100),
    shape: z.string().min(1).max(200),
    what: z.string().min(1).max(1500),
  }),
  feedbackToken: z.string().startsWith("fcw_").max(100),
});
export type StudioCommissionContract = z.infer<typeof StudioContract>;

export async function getStudioCommission(): Promise<StudioCommissionContract | null> {
  try {
    const response = await fetch(COMMISSION.studioContractUrl, {
      cache: "no-store",
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return null;
    const parsed = StudioContract.safeParse(await response.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function studioSuggestion(
  input: z.infer<typeof WebsiteBriefBody>,
  contract: StudioCommissionContract,
): string {
  return [
    `Website change request — ${contract.availability.state === "closed" ? "studio waitlist" : "studio review"}`,
    `Engagement: ${contract.offer.name} (${contract.offer.price}; ${contract.offer.shape})`,
    `Website: ${input.website}`,
    "Requested changes:",
    input.changes,
  ].join("\n");
}
