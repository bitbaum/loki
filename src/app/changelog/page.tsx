import Link from "next/link";
import { Fragment, type ReactNode } from "react";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { ownRecord } from "@/lib/register/own-record";
import { loadRepoRecords, type RepoChangelogEntry } from "@/lib/register/repo-records";
import { longDate } from "@/lib/dates";

/**
 * What changed in the product, dated, in the words of someone using it —
 * CHANGELOG.md in this repository, parsed by the same reader that feeds the
 * fleet map. This route used to forward to /releases, which is the Fleet
 * Runner desktop release history and still is; the product changelog and the
 * installer's release notes are two records.
 *
 * The map publishes only the newest 20 entries, as flat text. This page is the
 * whole record, so it asks the same parser (cached with the map) for every
 * entry with its sub-headings. History is not capped here: an old entry is the
 * evidence for a claim made about it.
 */
export const metadata = {
  title: "Changelog",
  description: "What changed in Loki, dated, in the words of someone using it.",
};

export const revalidate = 300;

const PR_BASE = "https://github.com/bitbaum/loki/pull/";

/** "(#937, #943)" → each number a link to the pull request it names. */
function withPrLinks(text: string): ReactNode {
  const parts = text.split(/(#\d{2,5}\b)/);
  return parts.map((part, i) =>
    /^#\d+$/.test(part) ? (
      <a key={i} href={`${PR_BASE}${part.slice(1)}`} className="ui-public-link">
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function monthKey(date: string): string {
  return date.slice(0, 7);
}

function monthLabel(key: string): string {
  return new Date(`${key}-15T12:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Map-only fallback (no file reachable): one unheaded section of flat lines. */
function fromMap(entries: Array<{ date: string; done: string }>): RepoChangelogEntry[] {
  return entries.map((e) => ({
    date: e.date,
    title: null,
    done: e.done,
    sections: [{ heading: null, items: e.done.split("\n").map((text) => ({ lead: null, text })) }],
  }));
}

export default async function ChangelogPage() {
  const record = await ownRecord();
  const repo = record ? await loadRepoRecords(record.entry.urls.repo) : null;
  const entries: RepoChangelogEntry[] = repo?.changelog.length
    ? repo.changelog
    : fromMap(record?.entry.changelog ?? []);
  const source = repo?.source.changelog ?? record?.entry.records.source.changelog ?? null;

  const months: Array<{ key: string; entries: RepoChangelogEntry[] }> = [];
  for (const entry of entries) {
    const key = monthKey(entry.date);
    const last = months[months.length - 1];
    if (last && last.key === key) last.entries.push(entry);
    else months.push({ key, entries: [entry] });
  }

  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="ui-public-container-mid py-12 sm:py-24 lg:py-32">
        <div className="ui-public-eyebrow">WHAT SHIPPED</div>
        <h1 className="ui-public-page-title mt-3 sm:mt-4">Changelog</h1>
        <p className="ui-public-lede mt-4 max-w-2xl sm:mt-6">
          Every entry is something a person can open and check: the numbers link to the pull request
          that made the change. Fixes carry the same weight as features, and say what was wrong.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 sm:mt-8">
          <Link href="/releases" className="ui-btn-chip">
            Fleet Runner releases
          </Link>
          <Link href="/roadmap" className="ui-btn-chip">
            Roadmap
          </Link>
        </div>
        {months.length > 1 && (
          <nav className="ui-public-jumpbar" aria-label="Changelog months">
            {months.map((m) => (
              <a key={m.key} href={`#m-${m.key}`} className="ui-public-jumpbar-link">
                {monthLabel(m.key)}
              </a>
            ))}
          </nav>
        )}
      </div>

      <div className="ui-public-container-mid pb-14 sm:pb-24">
        {!record ? (
          <p className="ui-public-section-lede" role="status">
            The development record is temporarily unavailable. Please retry shortly.
          </p>
        ) : entries.length === 0 ? (
          <p className="ui-public-section-lede">No changes have been recorded yet.</p>
        ) : (
          <div className="space-y-14 sm:space-y-20">
            {months.map((month) => (
              <section
                key={month.key}
                id={`m-${month.key}`}
                className="border-t border-border-subtle pt-10 sm:pt-16"
              >
                <h2 className="ui-public-display-md">{monthLabel(month.key)}</h2>
                <ol className="mt-8 space-y-10 sm:mt-12 sm:space-y-14">
                  {month.entries.map((entry, i) => (
                    <li key={`${entry.date}-${i}`} className="max-w-2xl">
                      <h3 className="ui-public-meta">
                        <time dateTime={entry.date}>{longDate(entry.date)}</time>
                        {entry.title ? (
                          <>
                            {" · "}
                            <span className="ui-public-prose-strong">{entry.title}</span>
                          </>
                        ) : null}
                      </h3>
                      {entry.sections.map((section, s) => (
                        <div key={s} className="mt-4">
                          {section.heading && (
                            <h4 className="ui-public-section-kicker">{section.heading}</h4>
                          )}
                          <ul className="space-y-3">
                            {section.items.map((item, j) => (
                              <li key={j} className="ui-public-prose-li">
                                <span className="ui-public-prose-bullet" />
                                <span className="min-w-0">
                                  {item.lead && (
                                    <span className="ui-public-prose-strong">{item.lead}</span>
                                  )}
                                  {item.lead && item.text ? " " : null}
                                  {withPrLinks(item.text)}
                                </span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      ))}
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>
        )}
        {source && (
          <p className="ui-public-meta mt-12 max-w-2xl">
            This page renders{" "}
            <a href={source} className="ui-public-link">
              CHANGELOG.md
            </a>{" "}
            from the repository, through the same fleet record every site uses. The installer&apos;s
            own release notes are on{" "}
            <Link href="/releases" className="ui-public-link">
              Fleet Runner releases
            </Link>
            .
          </p>
        )}
      </div>
    </PublicSurface>
  );
}
