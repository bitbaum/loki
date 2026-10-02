import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { FinalCta } from "@/components/public/FinalCta";
import {
  COMPARE_CHECKED_ON,
  COMPARE_DIFFERENCES,
  COMPARE_GROUPS,
  COMPARE_HONEST,
  COMPARE_LOKI_ROW,
} from "@/config/compare";
import { longDate } from "@/lib/dates";

export const metadata = {
  title: "Compare",
  description:
    "How Loki sits next to Claude Code, Codex, Cursor, Copilot, Devin, Lovable, Replit, v0 and open agents — where the work runs, how you hand it over, and what goes online.",
};

const COLUMNS = [
  "Tool",
  "Where it works",
  "How you hand it work",
  "Opens pull requests",
  "Puts it online",
];

export default function ComparePage() {
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="ui-public-container-mid py-12 sm:py-20">
        <div className="ui-public-eyebrow">COMPARE</div>
        <h1 className="ui-public-page-title mt-3 sm:mt-4">
          Loki runs the agents. It isn&rsquo;t one.
        </h1>
        <p className="ui-public-lede mt-4 max-w-2xl sm:mt-6">
          Most tools on this page are a single company&rsquo;s AI that writes code, or a website
          builder with its own hosting. Loki is the place where those agents do your work — from a
          description to a site that is online and keeps improving.
        </p>

        <div className="ui-public-section-gap grid gap-3 sm:grid-cols-2 sm:gap-4">
          {COMPARE_DIFFERENCES.map((d) => (
            <section key={d.title} className="ui-public-feature-card">
              <h2 className="ui-public-feature-title">{d.title}</h2>
              <p className="ui-public-feature-body">{d.body}</p>
            </section>
          ))}
        </div>

        <h2 className="ui-public-display-md mt-16 sm:mt-24">Side by side</h2>
        <p className="ui-public-meta mt-3">
          As of {longDate(COMPARE_CHECKED_ON)}, from each company&rsquo;s own pages (linked). “—”
          means their page does not say. Prices change too often to list.
        </p>
        <div className="ui-public-compare-wrap mt-6">
          <table className="ui-public-compare">
            <thead>
              <tr>
                {COLUMNS.map((c) => (
                  <th key={c} scope="col">
                    {c}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>{COMPARE_LOKI_ROW.name}</td>
                <td>{COMPARE_LOKI_ROW.runs}</td>
                <td>{COMPARE_LOKI_ROW.handoff}</td>
                <td>{COMPARE_LOKI_ROW.prs}</td>
                <td>{COMPARE_LOKI_ROW.hosts}</td>
              </tr>
              {COMPARE_GROUPS.map((group) => [
                <tr key={group.title} className="ui-public-compare-group">
                  <td colSpan={COLUMNS.length}>{group.title}</td>
                </tr>,
                ...group.rows.map((row) => (
                  <tr key={row.name}>
                    <td>
                      <a
                        href={row.source}
                        className="ui-public-link inline-flex"
                        target="_blank"
                        rel="noreferrer"
                      >
                        {row.name}
                      </a>
                    </td>
                    <td>{row.runs}</td>
                    <td>{row.handoff}</td>
                    <td>{row.prs}</td>
                    <td>{row.hosts}</td>
                  </tr>
                )),
              ])}
            </tbody>
          </table>
        </div>

        <div className="mt-10 space-y-3">
          {COMPARE_GROUPS.map((group) => (
            <p key={group.title} className="ui-public-meta">
              <span className="font-medium text-text-secondary">{group.title}:</span> {group.lede}
            </p>
          ))}
        </div>

        <h2 className="ui-public-display-md mt-16 sm:mt-24">Where the others are better</h2>
        <ul className="mt-6 max-w-2xl space-y-4">
          {COMPARE_HONEST.map((line) => (
            <li key={line} className="ui-public-body-lg">
              {line}
            </li>
          ))}
        </ul>
      </div>

      <FinalCta />
    </PublicSurface>
  );
}
