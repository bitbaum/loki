import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getRuntimeSnapshots } from "@/db/queries/runtime-snapshots";
import { listRecentRuns } from "@/db/queries/orchestration-runs";
import { PROVIDER_SPENT_WINDOW_MS, spentProviders } from "@/lib/provider-switch";
import { PROVIDERS, type ProviderInventoryEntry } from "@/lib/agents/provider-inventory";

export const dynamic = "force-dynamic";

export type ProviderRunnerView = {
  channel: string;
  observedAt: string;
  runnerVersion: string | null;
  /** Null: this runner predates the inventory — honest unknown, not "none". */
  providers: Array<ProviderInventoryEntry & { quota: string | null }> | null;
};

/**
 * One row per provider per runner: the runner's own measured inventory (see
 * src/lib/agents/provider-inventory.ts) plus the last capacity wall Loki saw
 * for that agent in its recent runs.
 */
export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const [snapshots, runs] = await Promise.all([
    getRuntimeSnapshots(userId).catch(() => []),
    listRecentRuns(userId, { limit: 50, sinceMs: PROVIDER_SPENT_WINDOW_MS }).catch(() => []),
  ]);
  const spent = spentProviders(runs);
  const runners: ProviderRunnerView[] = snapshots.map((row) => ({
    channel: row.channel,
    observedAt: row.updatedAt.toISOString(),
    runnerVersion: row.runnerVersion ?? null,
    providers: row.providerInventory
      ? row.providerInventory.map((e) => {
          const quota = spent[e.id] ?? null;
          return {
            ...e,
            quota,
            healthy: e.healthy && !quota,
            nextAction: quota ? "out of quota — failover skips it until the reset" : e.nextAction,
          };
        })
      : null,
  }));
  return NextResponse.json({
    runners,
    known: PROVIDERS.map((p) => ({ id: p.id, label: p.label })),
  });
}
