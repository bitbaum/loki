"use client";

import { useMemo, useState } from "react";
import { ExternalLink, Search } from "lucide-react";
import { timeAgo } from "@/lib/dates";

function absolute(liveUrl: string, path: string): string {
  try {
    return new URL(path, liveUrl).toString();
  } catch {
    return liveUrl;
  }
}

/** "/docs/quickstart" → "docs · quickstart" — readable without inventing names
 *  the site never used. The raw path stays visible underneath. */
function humanize(path: string): string {
  if (path === "/") return "Home";
  return path
    .split("/")
    .filter(Boolean)
    .map((seg) => seg.replace(/[-_]/g, " "))
    .join(" · ");
}

export function SitePages({
  liveUrl,
  paths,
  checkedAt,
}: {
  liveUrl: string | null;
  paths: string[];
  checkedAt: string | null;
}) {
  const [query, setQuery] = useState("");

  // Not searchkit: these are URL paths, filtered as text ("/blog/20" must hit
  // mid-segment); word typos and stemming do not apply to a path.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return paths;
    return paths.filter((p) => p.toLowerCase().includes(q));
  }, [paths, query]);

  return (
    <section
      aria-labelledby="site-pages-title"
      className="rounded-2xl border border-border-subtle bg-surface-raised p-5"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="site-pages-title" className="text-base font-semibold text-text-primary">
          Pages
        </h2>
        {checkedAt && (
          <span className="text-xs text-text-tertiary">
            found {timeAgo(new Date(checkedAt).getTime())}
          </span>
        )}
      </div>
      <p className="mt-1 text-sm text-text-secondary">
        Read off the site&apos;s own navigation, not a list anyone maintains. Ship a page and it
        shows up on the next check; remove one and it disappears.
      </p>

      {!liveUrl ? (
        <p className="mt-4 text-sm text-text-tertiary">No site URL registered yet.</p>
      ) : paths.length === 0 ? (
        <p className="mt-4 text-sm text-text-tertiary">
          No internal links found — either the site has not been checked yet, or its homepage links
          nowhere.
        </p>
      ) : (
        <>
          {paths.length > 8 && (
            <div className="relative mt-4">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-tertiary"
                aria-hidden
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={`Filter ${paths.length} pages`}
                aria-label="Filter pages"
                className="w-full rounded-xl border border-border-default bg-surface-overlay py-2 pl-9 pr-3 text-sm text-text-primary placeholder:text-text-tertiary"
              />
            </div>
          )}
          <ul className="mt-3 grid gap-1 sm:grid-cols-2">
            {filtered.map((path) => (
              <li key={path}>
                <a
                  href={absolute(liveUrl, path)}
                  target="_blank"
                  rel="noreferrer"
                  className="group flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 hover:bg-surface-overlay"
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm text-text-primary">
                      {humanize(path)}
                    </span>
                    <span className="block truncate text-xs text-text-tertiary">{path}</span>
                  </span>
                  <ExternalLink
                    className="h-3.5 w-3.5 shrink-0 text-text-tertiary opacity-0 group-hover:opacity-100"
                    aria-hidden
                  />
                </a>
              </li>
            ))}
          </ul>
          {filtered.length === 0 && (
            <p className="mt-3 text-sm text-text-tertiary">No page matches “{query}”.</p>
          )}
        </>
      )}
    </section>
  );
}
