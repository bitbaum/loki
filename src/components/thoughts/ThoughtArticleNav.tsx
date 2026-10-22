import { List, ListRow } from "@/components/ui/list-row";
import { Section } from "@/components/ui/section-heading";
import type { ThoughtMeta } from "@/lib/thoughts-content";

/** Where to read next, as rows under a heading — newer, older, then related. */
export function ThoughtArticleNav({
  previous,
  next,
  related,
}: {
  previous: (ThoughtMeta & { body: string }) | null;
  next: (ThoughtMeta & { body: string }) | null;
  related: Array<ThoughtMeta & { body: string }>;
}) {
  const rows = [
    ...(next ? [{ article: next, label: "Newer" }] : []),
    ...(previous ? [{ article: previous, label: "Older" }] : []),
    ...related
      .filter((r) => r.slug !== next?.slug && r.slug !== previous?.slug)
      .map((article) => ({ article, label: "Related" })),
  ];
  if (rows.length === 0) return null;
  return (
    <Section title="Read next">
      <List aria-label="Read next">
        {rows.map(({ article, label }) => (
          <ListRow
            key={article.slug}
            href={`/thoughts/${article.slug}`}
            title={article.title}
            secondary={article.summary}
            trailing={label}
          />
        ))}
      </List>
    </Section>
  );
}
