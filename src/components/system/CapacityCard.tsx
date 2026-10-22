import { Gauge } from "lucide-react";
import { SystemBlock, SystemBlockHeader } from "./SystemBlock";
import { EmptyState } from "@/components/ui/empty-state";
import {
  buildsByAccountThisMonth,
  queueWaitByChannel,
  welcomeSpendUsdThisMonth,
} from "@/db/queries/build-allowance";
import { CHF_PER_USD, WELCOME_MONTHLY_CAP_CHF } from "@/config/welcome-changes";

/**
 * The numbers that decide when the next wall is hit, read instead of guessed
 * (ROADMAP "Capacity you can read"): how long work waited for a builder in
 * the last day, per channel; this month's builds, tokens and cost per
 * account; and what welcome builds cost against their cap. Founder-only.
 */
function seconds(n: number | null): string {
  if (n == null) return "—";
  if (n < 90) return `${Math.round(n)} s`;
  return `${Math.round(n / 60)} min`;
}
const chf = (usd: number) => `CHF ${(usd * CHF_PER_USD).toFixed(2)}`;
const k = (n: number) =>
  n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `${Math.round(n)}`;

export async function CapacityCard() {
  const [waits, builds, welcomeUsd] = await Promise.all([
    queueWaitByChannel().catch(() => null),
    buildsByAccountThisMonth().catch(() => null),
    welcomeSpendUsdThisMonth().catch(() => null),
  ]);
  if (!waits || !builds || welcomeUsd == null) return null;

  return (
    <SystemBlock>
      <SystemBlockHeader icon={Gauge} title="Room for more work" />
      <div className="space-y-4">
        <p className="text-sm text-text-secondary">
          Welcome builds this month: {chf(welcomeUsd)} of CHF {WELCOME_MONTHLY_CAP_CHF}.
        </p>
        <div>
          <p className="ui-micro-label mb-1">Waited for a builder, last 24 h</p>
          {waits.length === 0 ? (
            <EmptyState>No work was claimed in the last day.</EmptyState>
          ) : (
            <ul className="divide-y divide-border-subtle text-sm">
              {waits.map((w) => (
                <li key={w.channel ?? "any"} className="flex items-center gap-3 py-1.5">
                  <span className="font-medium text-text-primary">
                    {w.channel ?? "any builder"}
                  </span>
                  <span className="text-text-secondary">{w.claimed} claimed</span>
                  <span className="ml-auto text-xs text-text-tertiary">
                    median {seconds(w.medianSeconds)} · worst {seconds(w.worstSeconds)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div>
          <p className="ui-micro-label mb-1">Builds this month, per account</p>
          {builds.length === 0 ? (
            <EmptyState>No run opened this month yet.</EmptyState>
          ) : (
            <ul className="divide-y divide-border-subtle text-sm">
              {builds.map((b) => (
                <li key={b.userId} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                  <span className="font-medium text-text-primary">
                    {b.label ?? b.userId.slice(0, 8)}
                  </span>
                  <span className="text-text-secondary">
                    {b.runs} runs{b.onLoki ? ` · ${b.onLoki} on Loki's engine` : ""}
                  </span>
                  <span className="ml-auto text-xs text-text-tertiary">
                    {k(b.tokens)} tokens · {chf(b.costUsd)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </SystemBlock>
  );
}
