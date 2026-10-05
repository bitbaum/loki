import { Database, Clock, Zap, Search } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { Card, CardHeader, StatCard } from "@/components/ui/card";
import { StatRow } from "@/components/ui/stat-row";
import { getEntityStats, getRecentEntities, getRecentInteractions } from "@/db/queries/memory";
import { getKnowledgeIndexStats } from "@/db/queries/knowledge-index-stats";
import { requirePageUserId } from "@/lib/session";
import { compactRelativeDate } from "@/lib/dates";
import { EmptyState } from "@/components/ui/empty-state";
import { ENTITY_TYPE, INTERACTION_DIRECTION, type EntityType } from "@/lib/constants/statuses";
import { ProgressBar } from "@/components/ui/progress-bar";
import { PullToRefresh } from "@/components/shared/PullToRefresh";
import { AutoRefresh } from "@/components/shared/AutoRefresh";
import { REFRESH_CADENCE } from "@/config/refresh";
import { MemoryEntityList, ForgetAllMemory } from "@/components/memory/MemoryControls";

export const metadata = { title: "Memory" };

// Record<EntityType,…> makes TS fail the build if a new ENTITY_TYPE
// member is added without a colour here — no silent fallback.
// All entity types use the same monochrome accent badge — this app is intentionally achromatic.
const TYPE_COLOR: Record<EntityType, string> = {
  [ENTITY_TYPE.PERSON]: "bg-accent-muted text-accent-text border-accent-primary/20",
  [ENTITY_TYPE.ROBOT]: "bg-accent-muted text-accent-text border-accent-primary/20",
  [ENTITY_TYPE.PROJECT]: "bg-accent-muted text-accent-text border-accent-primary/20",
  [ENTITY_TYPE.GOAL]: "bg-accent-muted text-accent-text border-accent-primary/20",
  [ENTITY_TYPE.COMPANY]: "bg-accent-muted text-accent-text border-accent-primary/20",
  [ENTITY_TYPE.TOOL]: "bg-accent-muted text-accent-text border-accent-primary/20",
  [ENTITY_TYPE.CONCEPT]: "bg-accent-muted text-accent-text border-accent-primary/20",
  [ENTITY_TYPE.EVENT]: "bg-accent-muted text-accent-text border-accent-primary/20",
};

function TypeBadge({ type }: { type: EntityType }) {
  const cls = TYPE_COLOR[type] ?? "bg-surface-overlay text-text-tertiary border-border-subtle";
  return <span className={`ui-tag ${cls}`}>{type}</span>;
}

export default async function MemoryPage() {
  const userId = await requirePageUserId();
  const [stats, rag, recent, activity] = await Promise.all([
    getEntityStats(userId),
    getKnowledgeIndexStats(userId),
    getRecentEntities(userId, 12),
    getRecentInteractions(userId, 10),
  ]);

  return (
    <PullToRefresh>
      <PageLayout title="Memory" subtitle="What Loki knows — the knowledge graph">
        {/* "Entities 11 / Relations 0 / Types 2" is the schema's vocabulary, not
          anybody's. Each tile now says what it counts underneath, and they use
          the compact StatCard instead of three full cards with an icon header
          — which spent half a phone screen on three integers. */}
        <StatRow>
          <StatCard
            label="Things remembered"
            value={stats.totalEntities.toLocaleString()}
            sub="people, projects, tools, ideas"
          />
          <StatCard
            label="Connections"
            value={stats.totalRelations.toLocaleString()}
            sub="links between those things"
          />
          <StatCard
            label="Kinds"
            value={String(stats.entityTypes.length)}
            sub="categories in use"
          />
        </StatRow>

        <Card>
          <CardHeader icon={Search} title="Context from your other projects" />
          {/* Was titled "Fleet knowledge (RAG)", and its two off-states named an
            environment variable and a script path on the server — instructions
            for whoever deploys this, shown to whoever uses it. What a user
            needs from this card is one fact: is my other work being pulled in
            or not. Operator setup belongs in the docs. */}
          {!rag.enabled ? (
            <p className="text-sm text-text-secondary">
              Off. Agents working on one project cannot see what you have written about the others —
              each dispatch starts from that project alone.
            </p>
          ) : rag.totalChunks === 0 ? (
            <p className="text-sm text-text-secondary">
              On, but nothing is indexed yet. Edit any project profile and it starts filling in from
              there.
            </p>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                <span className="text-text-primary font-medium">
                  {rag.totalChunks.toLocaleString()} indexed chunks
                </span>
                {rag.lastUpdatedAt && (
                  <span className="text-text-tertiary">
                    last update {compactRelativeDate(rag.lastUpdatedAt)}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {rag.bySourceType.map(({ sourceType, count }) => (
                  <span
                    key={sourceType}
                    className="ui-tag bg-surface-overlay text-text-secondary border-border-subtle"
                  >
                    {sourceType.replace(/_/g, " ")} · {count}
                  </span>
                ))}
              </div>
              <p className="text-text-secondary">
                Injected into dispatches as relevant context from your other projects — task-ranked,
                never repo code.
              </p>
            </div>
          )}
        </Card>

        {/* Recent activity + recent additions side by side */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Recently added entities — with per-entity forget (data controls) */}
          <Card>
            <div className="flex items-center justify-between">
              <CardHeader icon={Zap} title="Recently added" />
              <ForgetAllMemory />
            </div>
            <MemoryEntityList
              entities={recent.map((e) => ({
                ...e,
                badgeClass:
                  TYPE_COLOR[e.type] ??
                  "bg-surface-overlay text-text-tertiary border-border-subtle",
              }))}
            />
          </Card>

          {/* Recent interactions */}
          <Card>
            <CardHeader icon={Clock} title="Recent activity" />
            {activity.length === 0 ? (
              <EmptyState>No interactions logged yet</EmptyState>
            ) : (
              <div className="space-y-2">
                {activity.map((ix) => (
                  <div key={ix.id} className="flex items-start gap-2.5">
                    <span
                      className={`text-xs mt-0.5 shrink-0 ${ix.direction === INTERACTION_DIRECTION.INBOUND ? "text-text-muted" : "text-status-positive/60"}`}
                    >
                      {ix.direction === INTERACTION_DIRECTION.INBOUND ? "←" : "→"}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        <span className="text-base truncate text-text-primary">
                          {ix.entityName}
                        </span>
                        <span className="text-xs text-text-tertiary">{ix.channel}</span>
                      </div>
                      {ix.summary && (
                        <div className="mt-1 line-clamp-2 text-sm text-text-secondary">
                          {ix.summary}
                        </div>
                      )}
                    </div>
                    <span className="shrink-0 pt-0.5 text-xs text-text-tertiary">
                      {compactRelativeDate(ix.occurredAt)}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Entity distribution */}
        <Card>
          <CardHeader icon={Database} title="What it knows, by kind" />
          <div className="space-y-3">
            {stats.entityTypes.map((row) => {
              const pct = Math.round((Number(row.count) / stats.totalEntities) * 100);
              return (
                <div key={row.type}>
                  {/* The badge and the label printed the identical word side by
                    side — "person person". One of them was decoration. */}
                  <div className="flex items-center justify-between text-sm mb-1">
                    <TypeBadge type={row.type} />
                    <span className="text-text-secondary">
                      {Number(row.count).toLocaleString()} of {stats.totalEntities.toLocaleString()}
                    </span>
                  </div>
                  <ProgressBar value={pct} minPercent={1} tone="accent" className="h-2" />
                </div>
              );
            })}
          </div>
        </Card>
        <AutoRefresh intervalMs={REFRESH_CADENCE.memory} />
      </PageLayout>
    </PullToRefresh>
  );
}
