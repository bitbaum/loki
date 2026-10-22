"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { BookOpen } from "lucide-react";
import { EmptyState } from "@/components/ui/empty-state";
import { List, ListRow, ListSearch } from "@/components/ui/list-row";
import type { ThoughtMeta } from "@/lib/thoughts-content";
import { filterByQuery, type SearchSpec } from "@/lib/search";

type ThoughtArticle = ThoughtMeta & { body: string };

/** "Search essays": the title first, then what it is about. */
const ESSAY_SEARCH_SPEC: SearchSpec<ThoughtArticle> = {
  fields: [
    { name: "title", get: (a) => a.title },
    { name: "tags", get: (a) => a.tags },
    { name: "summary", get: (a) => a.summary },
    { name: "excerpt", get: (a) => a.excerpt },
  ],
};

/** "Oct 10" this year, "Oct 10, 2025" before it — the row's one trailing fact. */
function shortDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  const sameYear = d.getUTCFullYear() === new Date().getUTCFullYear();
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    timeZone: "UTC",
  });
}

function formatMeta(article: ThoughtArticle) {
  const parts = [article.publishedAt, `${article.readingTimeMin} min`].filter(Boolean);
  return parts.join(" · ");
}

export function ThoughtsLibrary({
  articles,
  tags,
}: {
  articles: ThoughtArticle[];
  tags: string[];
}) {
  const featured = articles.find((article) => article.featured) ?? articles[0] ?? null;
  const [query, setQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string>("all");
  const [showAllTags, setShowAllTags] = useState(false);

  // ~130 raw tags is a wall, not a filter. Rank by how many essays carry each
  // tag and show the top slice; "+N more" expands to everything. The active
  // tag always stays visible so expanding/collapsing never hides the filter
  // you're standing on.
  const TOP_TAGS = 12;
  const rankedTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const a of articles) for (const t of a.tags) counts.set(t, (counts.get(t) ?? 0) + 1);
    return [...tags].sort(
      (a, b) => (counts.get(b) ?? 0) - (counts.get(a) ?? 0) || a.localeCompare(b),
    );
  }, [articles, tags]);
  const visibleTags = showAllTags
    ? rankedTags
    : rankedTags
        .slice(0, TOP_TAGS)
        .concat(
          activeTag !== "all" && !rankedTags.slice(0, TOP_TAGS).includes(activeTag)
            ? [activeTag]
            : [],
        );
  const hiddenTagCount = rankedTags.length - Math.min(TOP_TAGS, rankedTags.length);

  // Matches keep the library's own order; a slip in a word still matches.
  const filtered = useMemo(
    () =>
      filterByQuery(
        activeTag === "all" ? articles : articles.filter((a) => a.tags.includes(activeTag)),
        ESSAY_SEARCH_SPEC,
        query,
      ),
    [activeTag, articles, query],
  );

  const featuredVisible =
    featured && filtered.some((a) => a.slug === featured.slug) ? featured : null;
  const rest = filtered.filter((a) => a.slug !== featuredVisible?.slug);

  // 63 full-abstract cards in one wall buries everything below the fold.
  // Lead with the most recent essays (clamped abstracts), then collapse the
  // archive into per-year <details> sections — native disclosure, no JS
  // needed to open them, and every link stays in the DOM for crawlers.
  // listThoughts() already sorts newest-first.
  const RECENT_COUNT = 10;
  const recent = rest.slice(0, RECENT_COUNT);
  const archive = rest.slice(RECENT_COUNT);
  const archiveByYear = new Map<string, ThoughtArticle[]>();
  for (const article of archive) {
    const year = article.publishedAt.slice(0, 4) || "Undated";
    const group = archiveByYear.get(year);
    if (group) group.push(article);
    else archiveByYear.set(year, [article]);
  }

  // One list, like the essay index of any reading app: the featured essay
  // leads as a plain heading and excerpt, the search is the list's first row,
  // and every other essay is one row — title, one grey line, the date on the
  // right. No cards, no tag chips on every row.
  return (
    <div className="space-y-8">
      {featuredVisible && (
        <Link href={`/thoughts/${featuredVisible.slug}`} className="ui-thoughts-lead">
          <span className="ui-thoughts-lead-meta">{formatMeta(featuredVisible)}</span>
          <span className="ui-thoughts-lead-title">{featuredVisible.title}</span>
          <span className="ui-thoughts-lead-excerpt">{featuredVisible.excerpt}</span>
        </Link>
      )}

      <div>
        <ListSearch value={query} onChange={setQuery} placeholder="Search essays" />

        {/* One line of topics that scrolls sideways on a phone and fades at
            the edge, so no word is cut. */}
        <div
          className="ui-filter-chip-row ui-scroll-fade-right pb-1"
          role="group"
          aria-label="Topics"
        >
          <button
            type="button"
            onClick={() => setActiveTag("all")}
            aria-pressed={activeTag === "all"}
            className={activeTag === "all" ? "ui-chip-filter-active" : "ui-chip-filter"}
          >
            All
          </button>
          {visibleTags.map((tag) => (
            <button
              key={tag}
              type="button"
              onClick={() => setActiveTag(tag)}
              aria-pressed={activeTag === tag}
              className={activeTag === tag ? "ui-chip-filter-active" : "ui-chip-filter"}
            >
              {tag}
            </button>
          ))}
          {hiddenTagCount > 0 && (
            <button
              type="button"
              onClick={() => setShowAllTags((v) => !v)}
              className="ui-chip-filter"
            >
              {showAllTags ? "Fewer topics" : `${hiddenTagCount} more`}
            </button>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState
          icon={BookOpen}
          title="No essays match that"
          action={
            <button
              type="button"
              className="ui-public-text-link"
              onClick={() => {
                setQuery("");
                setActiveTag("all");
              }}
            >
              Show every essay
            </button>
          }
        />
      ) : (
        <>
          {recent.length > 0 && (
            <List aria-label="Recent essays">
              {recent.map((article) => (
                <ListRow
                  key={article.slug}
                  href={`/thoughts/${article.slug}`}
                  title={article.title}
                  secondary={article.summary}
                  trailing={shortDate(article.publishedAt)}
                />
              ))}
            </List>
          )}

          {archive.length > 0 && (
            <div className="space-y-1 border-t border-border-subtle pt-4">
              {[...archiveByYear.entries()].map(([year, group]) => (
                <details key={year} className="ui-public-archive">
                  <summary className="ui-public-archive-summary">
                    {year} — {group.length} {group.length === 1 ? "essay" : "essays"}
                  </summary>
                  <List aria-label={`Essays from ${year}`} className="mt-1">
                    {group.map((article) => (
                      <ListRow
                        key={article.slug}
                        href={`/thoughts/${article.slug}`}
                        title={article.title}
                        trailing={shortDate(article.publishedAt)}
                      />
                    ))}
                  </List>
                </details>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
