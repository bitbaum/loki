import { CreditCard } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { getUpcomingSubscriptions } from "@/db/queries/today";
import { requirePageUserId } from "@/lib/session";
import { format, startOfDay } from "date-fns";
import { formatMoney } from "@/lib/format";
import { PrivateZoneDataGate } from "@/components/shared/PrivateZoneDataGate";

async function SubscriptionsCardInner() {
  const userId = await requirePageUserId();
  const items = await getUpcomingSubscriptions(userId);
  if (items.length === 0) return null;

  const today = startOfDay(new Date());

  return (
    <Card>
      <CardHeader icon={CreditCard} title="Upcoming Bills" />
      <div className="space-y-2.5">
        {items.map((item) => {
          // `nextCharge` is already rolled past a stale stored date, so a
          // subscription that renewed is never shown as overdue (it used to be,
          // on every row). Only a charge due before today reads that way.
          const overdue = startOfDay(item.nextCharge) < today;
          return (
            <div key={item.id} className="flex items-center justify-between">
              <div>
                <div className={`text-sm md:text-base ${overdue ? "text-status-negative" : ""}`}>
                  {item.name}
                </div>
                <div
                  className={`text-xs md:text-sm ${overdue ? "text-status-negative/70" : "text-text-tertiary"}`}
                >
                  {item.vendor}
                  {` · ${format(item.nextCharge, "d MMM")}`}
                  {overdue && " · overdue"}
                </div>
              </div>
              <div
                className={`text-sm md:text-base font-mono ${overdue ? "text-status-negative" : "text-text-secondary"}`}
              >
                {formatMoney(item.amount, item.currency)}
              </div>
            </div>
          );
        })}
      </div>
    </Card>
  );
}

export async function SubscriptionsCard() {
  return (
    <PrivateZoneDataGate label="upcoming bills">
      <SubscriptionsCardInner />
    </PrivateZoneDataGate>
  );
}
