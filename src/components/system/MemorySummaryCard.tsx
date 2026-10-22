import { Brain, Database, Link2 } from "lucide-react";
import { SystemBlock, SystemBlockHeader } from "./SystemBlock";
import { getEntityStats } from "@/db/queries/memory";
import { requirePageUserId } from "@/lib/session";
import { isPrivateZoneLocked } from "@/lib/private-zone";
import { formatCount } from "@/lib/format";
import Link from "next/link";
import { NAV } from "@/config/navigation";

export async function MemorySummaryCard() {
  const userId = await requirePageUserId();
  // Memory lives in the private zone — when locked, hide the card from
  // /system rather than leak entity / relation counts.
  if (await isPrivateZoneLocked(userId)) {
    return null;
  }
  // Match the defensive shape of sibling RecentFailuresCard
  // (`getRecentDebugLogs(10).catch(() => [])`). Without this, any
  // DB-side error in getEntityStats propagated past Suspense into
  // the route boundary and took the whole /system page down — the
  // most likely cause of the "Something went wrong" black-box screen
  // ee6df43 caught. Render a degraded card explaining what's missing
  // instead of breaking the route. console.error keeps the postmortem
  // signal even when the host's logs are unreliable.
  let stats: Awaited<ReturnType<typeof getEntityStats>> | null = null;
  try {
    stats = await getEntityStats(userId);
  } catch (err) {
    console.error("[MemorySummaryCard] getEntityStats failed:", err);
  }

  if (!stats) {
    return (
      <SystemBlock>
        <SystemBlockHeader icon={Brain} title="Memory" />
        <p className="text-sm text-text-tertiary">
          Couldn&apos;t load knowledge-graph stats. The rest of System is unaffected; this section
          will refresh on the next page load.
        </p>
      </SystemBlock>
    );
  }

  return (
    <SystemBlock>
      <SystemBlockHeader
        icon={Brain}
        title="Memory"
        right={
          <Link href={NAV.memory.href} className="ui-link-muted">
            View details →
          </Link>
        }
      />
      <div className="grid grid-cols-3 gap-3">
        <div>
          <div className="flex items-center gap-1.5 ui-micro-label mb-1">
            <Database className="h-3 w-3" /> Entities
          </div>
          <div className="text-2xl font-bold">{formatCount(stats.totalEntities)}</div>
          <div className="text-xs text-text-tertiary mt-0.5">{stats.entityTypes.length} types</div>
        </div>
        <div>
          <div className="flex items-center gap-1.5 ui-micro-label mb-1">
            <Link2 className="h-3 w-3" /> Relations
          </div>
          <div className="text-2xl font-bold">{formatCount(stats.totalRelations)}</div>
        </div>
        <div className="space-y-1.5 pt-0.5">
          {stats.entityTypes.slice(0, 4).map((row) => (
            <div key={row.type} className="flex items-center justify-between gap-2">
              <span className="text-micro text-text-tertiary capitalize">{row.type}</span>
              <span className="text-micro text-text-tertiary font-mono">
                {formatCount(row.count)}
              </span>
            </div>
          ))}
        </div>
      </div>
    </SystemBlock>
  );
}
