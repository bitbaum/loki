import { ArrowDownLeft, ArrowUpRight, Brain, Search } from "lucide-react";
import { PageLayout } from "@/components/ui/page-layout";
import { Section } from "@/components/ui/section-heading";
import { List, ListRow } from "@/components/ui/list-row";
import { EmptyState } from "@/components/ui/empty-state";
import { getEntityStats, getRecentEntities, getRecentInteractions } from "@/db/queries/memory";
import { getKnowledgeIndexStats } from "@/db/queries/knowledge-index-stats";
import { requirePageUserId } from "@/lib/session";
import { compactRelativeDate } from "@/lib/dates";
import { INTERACTION_DIRECTION } from "@/lib/constants/statuses";
import { memoryKind } from "@/config/memory";
import { PullToRefresh } from "@/components/shared/PullToRefresh";
import { AutoRefresh } from "@/components/shared/AutoRefresh";
import { REFRESH_CADENCE } from "@/config/refresh";
import { MemoryEntityList, ForgetAllMemory } from "@/components/memory/MemoryControls";

export const metadata = { title: "Memory" };

/** "3 things remembered, 2 connections" — the counts as a sentence, not tiles. */
function countsSentence(things: number, connections: number): string {
  const t = `${things.toLocaleString()} ${things === 1 ? "thing" : "things"} remembered`;
  if (connections === 0) return `${t}, no connections between them yet.`;
  return `${t}, ${connections.toLocaleString()} ${connections === 1 ? "connection" : "connections"} between them.`;
}

/**
 * Memory — what Loki knows. Rebuilt to the design reset
 * (docs/development/design-reset-2026-10.md) as one of its two worked
 * examples: no cards, no stat tiles, no badges; a sentence for the counts,
 * then sections of rows (ListRow) under sentence-case headings, and the one
 * destructive action as the page's last row.
 */
export default async function MemoryPage() {
  const userId = await requirePageUserId();
  const [stats, rag, recent, activity] = await Promise.all([
    getEntityStats(userId),
    getKnowledgeIndexStats(userId),
    getRecentEntities(userId, 12),
    getRecentInteractions(userId, 10),
  ]);

  const empty = stats.totalEntities === 0;

  // Whether a dispatch to one project is told what you wrote about the others.
  // What a person needs is that one fact, said plainly — not the index's
  // internals (chunks, source types).
  const context = !rag.enabled
    ? { title: "Off", secondary: "Each project's agents see only that project" }
    : rag.totalChunks === 0
      ? { title: "On, nothing gathered yet", secondary: "Edit a project's profile to start" }
      : {
          title: "On",
          secondary: rag.lastUpdatedAt
            ? `What you wrote about other projects is shared · updated ${compactRelativeDate(rag.lastUpdatedAt)}`
            : "What you wrote about other projects is shared",
        };

  return (
    <PullToRefresh>
      <PageLayout title="Memory" maxWidth="max-w-2xl">
        {empty ? (
          <EmptyState icon={Brain} title="Loki remembers people, projects and ideas as you work" />
        ) : (
          <>
            <p className="text-sm text-text-secondary">
              {countsSentence(stats.totalEntities, stats.totalRelations)}
            </p>

            <Section title="Recently added">
              <MemoryEntityList
                entities={recent.map((e) => ({
                  id: e.id,
                  name: e.name,
                  type: e.type,
                  description: e.description,
                  createdAt: e.createdAt,
                }))}
              />
            </Section>

            <Section title="Recent activity">
              {activity.length === 0 ? (
                <EmptyState>Nothing logged yet</EmptyState>
              ) : (
                <List aria-label="Recent activity">
                  {activity.map((ix) => {
                    const inbound = ix.direction === INTERACTION_DIRECTION.INBOUND;
                    return (
                      <ListRow
                        key={ix.id}
                        icon={inbound ? ArrowDownLeft : ArrowUpRight}
                        title={ix.entityName}
                        secondary={ix.summary ? `${ix.channel} · ${ix.summary}` : ix.channel}
                        trailing={compactRelativeDate(ix.occurredAt)}
                      />
                    );
                  })}
                </List>
              )}
            </Section>

            <Section title="By kind">
              <List aria-label="By kind">
                {stats.entityTypes.map((row) => {
                  const kind = memoryKind(row.type);
                  return (
                    <ListRow
                      key={row.type}
                      icon={kind.icon}
                      title={kind.plural}
                      trailing={Number(row.count).toLocaleString()}
                    />
                  );
                })}
              </List>
            </Section>
          </>
        )}

        <Section title="Context from your other projects">
          <List aria-label="Context from your other projects">
            <ListRow icon={Search} title={context.title} secondary={context.secondary} />
          </List>
        </Section>

        {!empty && (
          <Section title="Your data">
            <ForgetAllMemory />
          </Section>
        )}
        <AutoRefresh intervalMs={REFRESH_CADENCE.memory} />
      </PageLayout>
    </PullToRefresh>
  );
}
