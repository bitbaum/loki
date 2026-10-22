"use client";

import { useState } from "react";
import { format } from "date-fns";
import { List, ListRow, RowInitial } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
import { FREQUENCY } from "@/config/subscriptions";
import { SUB_STATUS } from "@/lib/constants/statuses";
import { subscriptionDue } from "@/lib/subscription-due";
import { formatMoney } from "@/lib/format";
import { SubscriptionSheet } from "./SubscriptionSheet";

/** A subscription as the page hands it to the browser: dates as ISO strings. */
export type SubscriptionView = {
  id: string;
  name: string;
  vendor: string | null;
  amount: number | null;
  currency: string | null;
  frequency: string | null;
  status: string | null;
  nextDue: string | null;
  notes: string | null;
  paymentMethod: string | null;
};

/** How often it charges, said plainly — monthly is the default and goes unsaid. */
const FREQUENCY_WORDS: Record<string, string> = {
  [FREQUENCY.ANNUAL]: "Yearly",
  [FREQUENCY.QUARTERLY]: "Every 3 months",
  [FREQUENCY.WEEKLY]: "Weekly",
  [FREQUENCY.ONE_TIME]: "Once",
};

function line(sub: SubscriptionView): string {
  const cancelled = sub.status === SUB_STATUS.CANCELLED;
  const due = subscriptionDue(sub.nextDue ? new Date(sub.nextDue) : null, sub.frequency, {
    cancelled,
  });
  return [
    cancelled ? "Cancelled" : sub.status === SUB_STATUS.UNVERIFIED ? "No receipt yet" : null,
    sub.frequency ? FREQUENCY_WORDS[sub.frequency] : null,
    due.kind === "due" ? `Next ${format(due.date, "d MMM")}` : null,
    due.kind === "charged" ? `Charged ${format(due.date, "d MMM")}` : null,
    !cancelled && sub.vendor && sub.vendor !== sub.name ? sub.vendor : null,
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The subscriptions on /money as rows: an initial, the name, one line (how
 * often, when next, whether a receipt backs it), the amount on the right. A
 * row opens the subscription in a sheet. Cancelled ones fold away below.
 */
export function SubscriptionsList({
  subs,
  cancelled,
}: {
  subs: SubscriptionView[];
  cancelled: SubscriptionView[];
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [showCancelled, setShowCancelled] = useState(false);
  const opened = [...subs, ...cancelled].find((s) => s.id === openId) ?? null;

  const rows = (list: SubscriptionView[], dim = false) => (
    <List aria-label="Subscriptions">
      {list.map((sub) => (
        <ListRow
          key={sub.id}
          onClick={() => setOpenId(sub.id)}
          avatar={<RowInitial name={sub.name} />}
          title={sub.name}
          secondary={line(sub) || "Monthly"}
          // No receipt is worth a look, never an alarm (rule 8).
          status={sub.status === SUB_STATUS.UNVERIFIED ? "warning" : undefined}
          trailing={sub.amount != null ? formatMoney(sub.amount, sub.currency) : "No amount"}
          className={dim ? "opacity-60" : undefined}
        />
      ))}
    </List>
  );

  return (
    <>
      <Section title="Subscriptions">{rows(subs)}</Section>
      {cancelled.length > 0 && (
        <Section
          title={`Cancelled · ${cancelled.length}`}
          right={
            <button
              type="button"
              onClick={() => setShowCancelled((v) => !v)}
              className="ui-section-link"
              aria-expanded={showCancelled}
            >
              {showCancelled ? "Hide" : "Show"}
            </button>
          }
        >
          {showCancelled && rows(cancelled, true)}
        </Section>
      )}
      {opened && (
        <SubscriptionSheet
          key={opened.id}
          sub={opened}
          subtitle={[
            opened.amount != null ? formatMoney(opened.amount, opened.currency) : null,
            line(opened),
          ]
            .filter(Boolean)
            .join(" · ")}
          onClose={() => setOpenId(null)}
        />
      )}
    </>
  );
}
