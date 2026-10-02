import Link from "next/link";
import { Check } from "lucide-react";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { FinalCta } from "@/components/public/FinalCta";
import { ROADMAP } from "@/config/marketing-content";
import { groupRoadmap, ownRecord } from "@/lib/register/own-record";
import { longDate } from "@/lib/dates";

export const metadata = {
  title: "Roadmap",
  description: ROADMAP.lede,
};

// The record changes when ROADMAP.md merges; a five-minute page cache matches
// the map's own.
export const revalidate = 300;

export default async function RoadmapPage() {
  const record = await ownRecord();
  const groups = record ? groupRoadmap(record.entry.roadmap) : [];
  const source = record?.entry.records.source.roadmap ?? null;
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="ui-public-container-mid py-12 sm:py-24 lg:py-32">
        <div className="ui-public-eyebrow">{ROADMAP.eyebrow}</div>
        <h1 className="ui-public-page-title mt-3 sm:mt-4">{ROADMAP.title}</h1>
        <p className="ui-public-lede mt-4 max-w-2xl sm:mt-6">{ROADMAP.lede}</p>

        {/* Jump links. This page runs several screens deep on a phone, and its
            groups are exactly the question a visitor arrives with — "what
            works today vs what is a promise". Anchors answer it in one tap. */}
        {groups.length > 1 && (
          <nav className="ui-public-jumpbar" aria-label="Roadmap sections">
            {groups.map((g) => (
              <a
                key={g.status}
                href={`#${g.status.replace(/\s+/g, "-")}`}
                className="ui-public-jumpbar-link"
              >
                {g.title}
              </a>
            ))}
          </nav>
        )}
      </div>

      <div className="ui-public-container-mid space-y-12 pb-14 sm:space-y-20 sm:pb-24">
        {!record ? (
          <p className="ui-public-section-lede" role="status">
            The development record is temporarily unavailable. Please retry shortly.
          </p>
        ) : groups.length === 0 ? (
          <p className="ui-public-section-lede">No roadmap items have been recorded yet.</p>
        ) : (
          groups.map((g) => (
            <section
              key={g.status}
              id={g.status.replace(/\s+/g, "-")}
              className="border-t border-border-subtle pt-10 sm:pt-16"
            >
              <h2 className="ui-public-display-md">{g.title}</h2>
              {g.summary && <p className="ui-public-section-lede mt-3 sm:mt-4">{g.summary}</p>}
              {/* Scannable first: every item is its title and one line, and its
                  steps open on tap. Shipped folds whole — it is the record, not
                  the plan. Rendered open, the page was 12,800px on a phone and
                  read as one undifferentiated column (2026-10-01). */}
              <RoadmapItems shipped={g.status === "done"} count={g.items.length}>
                {g.items.map((item, i) => (
                  <div key={`${item.title}-${i}`} className="max-w-2xl">
                    <div className="ui-public-prose-strong text-lg">{item.title}</div>
                    {item.line && <p className="ui-public-prose-muted mt-2">{item.line}</p>}
                    {item.milestones.length === 0 && item.targetDate && (
                      <p className="ui-public-meta mt-2">target {item.targetDate}</p>
                    )}
                    {item.milestones.length > 0 && (
                      <details className="ui-roadmap-steps mt-2">
                        <summary className="ui-roadmap-steps-summary">
                          {[
                            `${item.milestones.filter((m) => m.done).length}/${item.milestones.length} steps done`,
                            item.targetDate ? `target ${item.targetDate}` : null,
                          ]
                            .filter(Boolean)
                            .join(" · ")}
                        </summary>
                        <ul className="mt-3 space-y-2">
                          {item.milestones.map((m) => (
                            <li className="flex gap-2.5" key={m.title}>
                              <span
                                className="ui-public-milestone-mark"
                                data-done={m.done ? "true" : "false"}
                                aria-hidden
                              >
                                {m.done ? <Check className="h-3 w-3" /> : null}
                              </span>
                              <span className="ui-public-prose-muted min-w-0">
                                {m.title}
                                <span className="sr-only">
                                  {m.done ? " — done" : " — not done"}
                                </span>
                              </span>
                            </li>
                          ))}
                        </ul>
                      </details>
                    )}
                  </div>
                ))}
              </RoadmapItems>
            </section>
          ))
        )}
      </div>

      <div className="ui-public-section border-t border-border-subtle">
        <div className="ui-public-container-mid">
          <div className="ui-public-eyebrow">{ROADMAP.throughlines.eyebrow}</div>
          <h2 className="ui-public-display-md mt-3 sm:mt-4">{ROADMAP.throughlines.title}</h2>
          <p className="ui-public-section-lede mt-4 sm:mt-6">{ROADMAP.throughlines.lede}</p>

          <div className="mt-10 grid gap-8 sm:mt-16 sm:gap-12 md:grid-cols-2">
            {ROADMAP.throughlines.items.map((item, i) => (
              <div key={i} className="flex flex-col gap-1.5 sm:flex-row sm:gap-6">
                <div className="ui-public-step-num sm:pt-2">{String(i + 1).padStart(2, "0")}</div>
                <div>
                  <div className="ui-public-prose-strong text-lg">{item.title}</div>
                  <p className="ui-public-body-lg mt-2 sm:mt-3">{item.body}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="ui-public-container-mid pb-14 sm:pb-24">
        <p className="ui-public-meta max-w-2xl border-t border-border-subtle pt-8 sm:pt-12">
          {ROADMAP.closer}
          {source && record && (
            <>
              {" "}
              This page renders{" "}
              <a href={source} className="ui-public-link">
                ROADMAP.md
              </a>{" "}
              from the repository, through the same fleet record every site uses
              {record
                ? `, read ${longDate(record ? new Date().toISOString().slice(0, 10) : "")}`
                : ""}
              .
            </>
          )}
        </p>
        <div className="mt-6 flex flex-wrap gap-3 sm:mt-8">
          <Link href="/thoughts" className="ui-btn-chip">
            Thoughts
          </Link>
          <Link href="/changelog" className="ui-btn-chip">
            Changelog
          </Link>
        </div>
      </div>

      <FinalCta />
    </PublicSurface>
  );
}

/** A group's items: open for the plan, folded behind one line for what shipped. */
function RoadmapItems({
  shipped,
  count,
  children,
}: {
  shipped: boolean;
  count: number;
  children: React.ReactNode;
}) {
  const list = <div className="mt-8 space-y-8 sm:mt-12 sm:space-y-10">{children}</div>;
  if (!shipped) return list;
  return (
    <details className="ui-roadmap-shipped mt-6">
      <summary className="ui-roadmap-steps-summary">
        Show all {count} shipped {count === 1 ? "item" : "items"}
      </summary>
      {list}
    </details>
  );
}
