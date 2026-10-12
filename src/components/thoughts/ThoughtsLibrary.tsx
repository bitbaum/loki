"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, BookOpen } from "lucide-react";
import { ScrollAffordance } from "@/components/ui/scroll-affordance";
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

  return (
    <div className="space-y-6">
      {/* Featured essay — leads the page, first thing visible */}
      {featuredVisible && (
        <Link
          href={`/thoughts/${featuredVisible.slug}`}
          className="ui-card-shell-raised block space-y-4 p-6 transition hover:bg-surface-raised md:p-8"
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="ui-kicker">Featured</span>
            <span className="ui-badge">{formatMeta(featuredVisible)}</span>
          </div>
          <h2 className="text-2xl font-medium leading-tight text-text-primary md:text-3xl">
            {featuredVisible.title}
          </h2>
          <p className="text-base leading-relaxed text-text-secondary md:text-lg">
            {featuredVisible.excerpt}
          </p>
          <div className="flex flex-wrap gap-2">
            {featuredVisible.tags.map((tag) => (
              <span key={tag} className="ui-tag ui-tag-neutral">
                {tag}
              </span>
            ))}
          </div>
        </Link>
      )}

      {/* Search + count + horizontal-scroll tag strip */}
      <div className="space-y-3">
        <div className="flex items-center gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search essays"
              className="ui-input pl-12"
            />
          </div>
          <span className="shrink-0 text-sm text-text-tertiary">
            {filtered.length} of {articles.length}
          </span>
        </div>

        {/* Single scrollable row — no wrapping. Fifth horizontal-scroll
            surface in the codebase; uses the extracted ScrollAffordance
            (0429728) for the mobile chevron + fade rather than re-inlining
            the pattern. Adds ui-scroll-fade-right that was previously
            missing here too. */}
        <ScrollAffordance childCount={visibleTags.length + 2} threshold={4}>
          <div className="flex gap-2 overflow-x-auto ui-scroll-fade-right pb-1 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
            <button
              type="button"
              onClick={() => setActiveTag("all")}
              className={`shrink-0 ${activeTag === "all" ? "ui-chip-filter-active" : "ui-chip-filter"}`}
            >
              All
            </button>
            {visibleTags.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => setActiveTag(tag)}
                className={`shrink-0 ${activeTag === tag ? "ui-chip-filter-active" : "ui-chip-filter"}`}
              >
                {tag}
              </button>
            ))}
            {hiddenTagCount > 0 && (
              <button
                type="button"
                onClick={() => setShowAllTags((v) => !v)}
                className="ui-chip-filter shrink-0"
              >
                {showAllTags ? "fewer tags" : `+${hiddenTagCount} more`}
              </button>
            )}
          </div>
        </ScrollAffordance>
      </div>

      {filtered.length === 0 ? (
        <div className="ui-empty-panel py-12 text-text-secondary">
          <BookOpen className="h-8 w-8 text-text-tertiary" />
          <div className="text-lg text-text-primary">No essays match this filter</div>
          <p className="max-w-md text-sm text-text-tertiary">
            Try a broader search or switch topics.
          </p>
        </div>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-2">
            {recent.map((article) => (
              <Link
                key={article.slug}
                href={`/thoughts/${article.slug}`}
                className="ui-card-shell-raised block space-y-2 p-5 transition hover:bg-surface-raised md:p-6"
              >
                <span className="ui-badge">{formatMeta(article)}</span>
                <h3 className="text-xl font-medium text-text-primary">{article.title}</h3>
                <p className="line-clamp-2 text-sm text-text-secondary">{article.summary}</p>
              </Link>
            ))}
          </div>

          {archive.length > 0 && (
            <div className="space-y-4 border-t border-border-subtle pt-6">
              {[...archiveByYear.entries()].map(([year, group]) => (
                <details key={year} className="ui-public-archive">
                  <summary className="ui-public-archive-summary">
                    {year} — {group.length} {group.length === 1 ? "essay" : "essays"}
                  </summary>
                  <div className="mt-3 grid gap-2 md:grid-cols-2">
                    {group.map((article) => (
                      <Link
                        key={article.slug}
                        href={`/thoughts/${article.slug}`}
                        className="ui-public-archive-item"
                      >
                        <span className="text-text-primary">{article.title}</span>
                        <span className="ui-public-archive-item-meta">{formatMeta(article)}</span>
                      </Link>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
