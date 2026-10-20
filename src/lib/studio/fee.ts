import type { FeeCurrency, StudioFeeInput } from "@/config/studio";
import type { StudioRequest } from "@/db/schema/studio-requests";

/**
 * A partner's fee as a service in THEIR name on OrangeCat (Track 3.3 of
 * docs/master-plan-2026-10.md). Pure: what the listing says, from the brief.
 *
 * `status: "active"`: nobody is there to press Publish on a row the partner
 * never opens. `show_on_profile: false`: it is the receipt for one brief, not
 * an offer on the partner's page. `human_task` is the category the crew
 * mirror already uses for work a person does.
 */
export function feeServicePayload(input: {
  fee: StudioFeeInput;
  partnerName: string;
  website: string;
  changes: string;
}) {
  const site = input.website.replace(/^https?:\/\//, "").replace(/\/+$/, "");
  return {
    title: `${input.partnerName}: ${site || "website work"}`.slice(0, 100),
    description: [
      input.changes.trim().slice(0, 600),
      `Agreed through the studio on Loki; paid to ${input.partnerName}.`,
    ].join("\n\n"),
    category: "human_task",
    fixed_price: input.fee.amount,
    currency: input.fee.currency,
    service_location_type: "remote",
    show_on_profile: false,
    status: "active",
  } as const;
}

/** The fee as the customer, the partner and the studio read it. Null until one is stated. */
export function feeView(
  row: Pick<StudioRequest, "feeAmount" | "feeCurrency" | "feeServiceId" | "feeUrl" | "feePaidAt">,
): {
  amount: number;
  currency: FeeCurrency;
  url: string | null;
  listed: boolean;
  paidAt: string | null;
} | null {
  if (row.feeAmount === null || row.feeAmount === undefined || !row.feeCurrency) return null;
  return {
    amount: row.feeAmount,
    currency: row.feeCurrency,
    url: row.feeUrl,
    listed: Boolean(row.feeServiceId),
    paidAt: row.feePaidAt?.toISOString() ?? null,
  };
}
