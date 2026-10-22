import { formatBtc } from "@/lib/format";
import { CircleDollarSign } from "lucide-react";
import { SystemBlock, SystemBlockHeader } from "./SystemBlock";
import { EmptyState } from "@/components/ui/empty-state";
import { getRevenueSummary } from "@/db/queries/revenue";
import { PRICING_PLANS } from "@/config/plans";
import type { Plan } from "@/db/schema/users";

/**
 * Platform revenue at a glance — the operator's first MRR number, and the
 * anchor node for every business loop that follows (a loop is only honest when
 * it touches settled money). Founder-only: rendered by /system just when the
 * viewer is the default user, so tenants never see platform-wide figures.
 *
 * Renders the truthful zero-state rather than placeholder metrics — until a
 * pass actually settles, "no paid subscribers yet" is the correct display.
 */
const PLAN_NAME = Object.fromEntries(PRICING_PLANS.map((p) => [p.key, p.name])) as Record<
  Plan,
  string
>;

function money(currency: string, amount: number): string {
  return `${currency} ${amount.toLocaleString("en-CH")}`;
}

export async function RevenueCard() {
  const rev = await getRevenueSummary().catch(() => null);
  if (!rev) return null;

  const hasRevenue = rev.mrr > 0 || rev.btcGrantCount > 0;

  return (
    <SystemBlock>
      <SystemBlockHeader
        icon={CircleDollarSign}
        title="Revenue"
        right={
          <span className="text-xs text-text-tertiary">
            {rev.activePaid} paid · {rev.freeUsers} free
            {rev.granted > 0 ? ` · ${rev.granted} granted` : ""}
          </span>
        }
      />

      {rev.reserved.length > 0 && (
        <p className="mb-3 text-sm text-text-secondary">
          <span className="font-medium text-text-primary">Reserved, waiting for payments:</span>{" "}
          {rev.reserved.map((r) => `${PLAN_NAME[r.plan] ?? r.plan} ×${r.count}`).join(", ")} —{" "}
          {money(
            rev.currency,
            rev.reserved.reduce((sum, r) => sum + r.monthly, 0),
          )}
          /mo if they all pay.
        </p>
      )}

      {!hasRevenue ? (
        <EmptyState>
          No paid subscribers yet. Monthly recurring revenue and Bitcoin pass grants land here the
          moment the first pass settles — the pricing page and the OrangeCat rail are live and
          waiting.
        </EmptyState>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="text-2xl font-medium text-text-primary md:text-3xl">
              {money(rev.currency, rev.mrr)}
            </span>
            <span className="text-sm text-text-secondary">
              monthly recurring · {rev.activePaid} paying
            </span>
          </div>

          {rev.byPlan.length > 0 && (
            <ul className="divide-y divide-border-subtle">
              {rev.byPlan.map((row) => (
                <li key={row.plan} className="flex items-center justify-between py-1.5 text-sm">
                  <span className="text-text-secondary">
                    {PLAN_NAME[row.plan] ?? row.plan}
                    <span className="ml-2 text-text-tertiary">×{row.count}</span>
                  </span>
                  <span className="font-medium text-text-primary">
                    {money(rev.currency, row.monthly)}/mo
                  </span>
                </li>
              ))}
            </ul>
          )}

          {rev.btcGrantCount > 0 && (
            <div className="border-t border-border-subtle pt-3 text-sm text-text-secondary">
              <span className="font-medium text-text-primary">{rev.btcGrantCount}</span> Bitcoin
              pass{rev.btcGrantCount === 1 ? "" : "es"} settled
              {rev.btcGrantTotal > 0 && (
                <>
                  {" "}
                  ·{" "}
                  <span className="font-medium text-text-primary">
                    ₿{formatBtc(rev.btcGrantTotal)}
                  </span>{" "}
                  total
                </>
              )}
            </div>
          )}
        </div>
      )}
    </SystemBlock>
  );
}
