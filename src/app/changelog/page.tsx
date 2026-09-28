import Link from "next/link";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { ownRecord } from "@/lib/register/own-record";
import { longDate } from "@/lib/dates";

/**
 * What changed in the product, dated, in the words of someone using it —
 * CHANGELOG.md in this repository, read through the fleet map like every
 * other site's changelog. This route used to forward to /releases, which is
 * the Fleet Runner desktop release history and still is; the product
 * changelog and the installer's release notes are two records.
 */
export const metadata = {
  title: "Changelog",
  description: "What changed in Loki, dated, in the words of someone using it.",
};

export const revalidate = 300;

export default async function ChangelogPage() {
  const record = await ownRecord();
  const entries = record?.entry.changelog ?? [];
  const source = record?.entry.records.source.changelog ?? null;
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="ui-public-container-mid py-12 sm:py-24 lg:py-32">
        <div className="ui-public-eyebrow">WHAT SHIPPED</div>
        <h1 className="ui-public-page-title mt-3 sm:mt-4">Changelog</h1>
        <p className="ui-public-lede mt-4 max-w-2xl sm:mt-6">
          Every entry is something a person can open and check. Fixes carry the same weight as
          features, and say what was wrong.
        </p>
        <div className="mt-6 flex flex-wrap gap-3 sm:mt-8">
          <Link href="/releases" className="ui-btn-chip">
            Fleet Runner releases
          </Link>
          <Link href="/roadmap" className="ui-btn-chip">
            Roadmap
          </Link>
        </div>
      </div>

      <div className="ui-public-container-mid pb-14 sm:pb-24">
        {!record ? (
          <p className="ui-public-section-lede" role="status">
            The development record is temporarily unavailable. Please retry shortly.
          </p>
        ) : entries.length === 0 ? (
          <p className="ui-public-section-lede">No changes have been recorded yet.</p>
        ) : (
          <ol className="space-y-10 border-t border-border-subtle pt-10 sm:space-y-14 sm:pt-16">
            {entries.map((entry, i) => (
              <li key={`${entry.date}-${i}`} className="max-w-2xl">
                <h2 className="ui-public-meta">
                  <time dateTime={entry.date}>{longDate(entry.date)}</time>
                </h2>
                <ul className="mt-3 space-y-3">
                  {entry.done.split("\n").map((line, j) => (
                    <li key={j} className="ui-public-prose-li">
                      <span className="ui-public-prose-bullet" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ol>
        )}
        {source && (
          <p className="ui-public-meta mt-12 max-w-2xl">
            This page renders{" "}
            <a href={source} className="ui-public-link">
              CHANGELOG.md
            </a>{" "}
            from the repository, through the same fleet record every site uses.
          </p>
        )}
      </div>
    </PublicSurface>
  );
}
