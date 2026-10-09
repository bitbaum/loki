import { Ticket } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { listUsersWithPlans } from "@/db/queries/users";
import { PRICING_PLANS } from "@/config/plans";
import { passEndLabel } from "@/lib/plan-pass";
import { PlanGrantForm } from "./PlanGrantForm";
import type { Plan } from "@/db/schema/users";

/**
 * Every account and its pass, with the hand-grant form — the operator's side
 * of subscriptions. Founder-only (rendered by /system just when the viewer is
 * the default user): a tenant never sees other accounts.
 *
 * The Bitcoin rail grants passes on its own when a payment settles; this card
 * is for everything the rail cannot know — a trial, a pass paid some other
 * way, a goodwill month, a revoke — and for seeing at a glance who is on what
 * and when it ends. Same ledger as the rail (oc_billing_grants), so the user
 * sees a hand grant on their Billing tab exactly like a paid one.
 */
const PLAN_NAME = Object.fromEntries(PRICING_PLANS.map((p) => [p.key, p.name])) as Record<
  Plan,
  string
>;

export async function PlansCard() {
  const rows = await listUsersWithPlans().catch(() => null);
  if (!rows) return null;

  const paid = rows.filter((r) => r.plan !== "free");
  const label = (r: (typeof rows)[number]) => r.username ?? r.name ?? r.email ?? r.id.slice(0, 8);

  return (
    <Card>
      <CardHeader
        icon={Ticket}
        title="Plans"
        right={
          <span className="text-xs text-text-tertiary">
            {paid.length} on a pass · {rows.length - paid.length} free
          </span>
        }
      />
      <div className="space-y-4">
        {paid.length === 0 ? (
          <EmptyState>
            Nobody is on a pass. A Bitcoin payment on OrangeCat lands here by itself; grant one by
            hand below for anything the rail cannot know.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border-subtle">
            {paid.map((r) => {
              const ends = r.planExpiresAt;
              return (
                <li
                  key={r.id}
                  className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5 text-sm"
                >
                  <span className="font-medium text-text-primary">{label(r)}</span>
                  <span className="text-text-secondary">{PLAN_NAME[r.plan] ?? r.plan}</span>
                  <span className="ml-auto text-xs text-text-tertiary">
                    {passEndLabel(ends)}
                    {r.planStatus && r.planStatus !== "active" ? ` · ${r.planStatus}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
        <div className="border-t border-border-subtle pt-3">
          <p className="ui-micro-label mb-2">Grant by hand</p>
          <PlanGrantForm users={rows.map((r) => ({ id: r.id, label: label(r), plan: r.plan }))} />
        </div>
      </div>
    </Card>
  );
}
