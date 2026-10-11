/**
 * Fact adapter for what the operator DOES with the surfaces Loki built for
 * them (operator_usage_events), summarised per surface over the last
 * USAGE_WINDOW_DAYS. One fact per surface, so "how am I using Build next?"
 * and "what should I build?" both see whether the row is tapped, rotated past,
 * or offered for nothing.
 *
 * Same contract as sources.ts: a Fact carries only STORED values — here the
 * tally — and the registered surface with no rows is reported as never shown,
 * which is a finding about the surface rather than an absence of data.
 */
import { makeFact, type Fact } from "@bitbaum/ai-kit/grounding";
import { listUsageEvents } from "@/db/queries/operator-usage";
import { summarizeUsage, usageLine } from "@/lib/usage/summarize";
import { USAGE_WINDOW_DAYS } from "@/config/usage-surfaces";

export async function usageFacts(userId: string, limit: number): Promise<Fact[]> {
  const events = await listUsageEvents(userId, { sinceDays: USAGE_WINDOW_DAYS }).catch(() => []);
  const summaries = summarizeUsage(events, { days: USAGE_WINDOW_DAYS });
  return summaries.slice(0, limit).map((s) =>
    makeFact({
      kind: "document",
      subject: s.label,
      source: `operator usage events · last ${s.days} days`,
      values: {
        title: `How the operator uses ${s.label}`,
        source: `usage · ${s.surface}${s.path ? ` · ${s.path}` : ""} · ${s.verdict}`,
        excerpt: usageLine(s),
      },
    }),
  );
}
