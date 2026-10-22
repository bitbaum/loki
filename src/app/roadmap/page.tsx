import Link from "next/link";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { FinalCta } from "@/components/public/FinalCta";
import { ROADMAP } from "@/config/marketing-content";
import { ownRecord } from "@/lib/register/own-record";
import { loadRepoRecords } from "@/lib/register/repo-records";
import { recordLinks } from "@/lib/register/record-links";
import { buildJourney } from "@/lib/register/roadmap-journey";
import { RoadmapJourney } from "@/components/public/RoadmapJourney";
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
  const source = record?.entry.records.source.roadmap ?? null;
  // The whole changelog (the map carries only the newest entries), so a step
  // shipped months ago still links to the day it shipped.
  const repo = record ? await loadRepoRecords(record.entry.urls.repo) : null;
  const links = record
    ? recordLinks(
        record.entry.roadmap,
        repo?.changelog.length ? repo.changelog : record.entry.changelog,
      )
    : undefined;
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="ui-public-container-mid pb-6 pt-10 sm:pb-10 sm:pt-16">
        <h1 className="ui-public-page-title">{ROADMAP.title}</h1>
      </div>

      <div className="ui-public-container-mid pb-14 sm:pb-24">
        {!record ? (
          <p className="ui-public-section-lede" role="status">
            The development record is temporarily unavailable. Please retry shortly.
          </p>
        ) : record.entry.roadmap.length === 0 ? (
          <p className="ui-public-section-lede">No roadmap items have been recorded yet.</p>
        ) : (
          // Drawn as a road — behind us, you are here, ahead — instead of four
          // stacked lists of equal weight (see RoadmapJourney).
          <RoadmapJourney journey={buildJourney(record.entry.roadmap)} links={links} />
        )}
      </div>

      <section className="ui-public-band ui-public-section" aria-labelledby="constant">
        <div className="ui-public-container-mid">
          <h2 id="constant" className="ui-public-h2">
            {ROADMAP.throughlines.title}
          </h2>
          <ol className="ui-public-section-gap ui-public-rows ui-public-rows-2">
            {ROADMAP.throughlines.items.map((item, i) => (
              <li key={i} className="ui-public-howto-step">
                <span className="ui-public-howto-num" aria-hidden="true">
                  {String(i + 1).padStart(2, "0")}
                </span>
                <h3 className="ui-public-howto-title">{item.title}</h3>
                <p className="ui-public-howto-body">{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

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
        <p className="mt-4 flex gap-6">
          <Link href="/changelog" className="ui-public-text-link">
            Changelog →
          </Link>
          <Link href="/thoughts" className="ui-public-text-link">
            Thoughts →
          </Link>
        </p>
      </div>

      <FinalCta />
    </PublicSurface>
  );
}
