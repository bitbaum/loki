import Link from "next/link";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { FinalCta } from "@/components/public/FinalCta";
import { ROADMAP } from "@/config/marketing-content";
import { ownRecord } from "@/lib/register/own-record";
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
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="ui-public-container-mid py-12 sm:py-24 lg:py-32">
        <div className="ui-public-eyebrow">{ROADMAP.eyebrow}</div>
        <h1 className="ui-public-page-title mt-3 sm:mt-4">{ROADMAP.title}</h1>
        <p className="ui-public-lede mt-4 max-w-2xl sm:mt-6">{ROADMAP.lede}</p>
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
          <RoadmapJourney journey={buildJourney(record.entry.roadmap)} />
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
