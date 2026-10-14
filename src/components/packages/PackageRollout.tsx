import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { PAUSED_BY_OWNER } from "@/config/package-releases";
import { timeAgo } from "@/lib/dates";
import { ROLLOUT_BUCKETS, redFlag, type RolloutRow } from "@/lib/packages/rollout";
import { ReleasePauseButton } from "./ReleasePauseButton";

/**
 * How each recent version is reaching the person's projects: on it, an update
 * to it open (ready, waiting on tests, held, paused, or failing its tests),
 * behind it with no update yet, or past it. A version whose update fails its
 * tests anywhere is flagged with the projects, so a bad release is seen
 * before it spreads — and the package's owner can pause it everywhere from
 * the same row.
 */
export function PackageRollout({
  slug,
  rows,
  owner,
}: {
  slug: string;
  rows: RolloutRow[];
  /** The viewer may pause and resume (the package's owner). */
  owner: boolean;
}) {
  if (rows.length === 0) return null;
  return (
    <section className="space-y-3" aria-labelledby="package-rollout-title">
      <div>
        <h2 id="package-rollout-title" className="text-lg font-semibold text-text-primary">
          Rollout
        </h2>
        <p className="text-xs text-text-tertiary">
          Each recent version, and where your projects stand on it.
        </p>
      </div>
      <ul className="space-y-2">
        {rows.map((row) => {
          const flag = redFlag(row);
          const parts = ROLLOUT_BUCKETS.filter((b) => row.counts[b.id] > 0).map(
            (b) => `${row.counts[b.id]} ${b.label}`,
          );
          return (
            <li key={row.version} className="ui-list-row min-w-0 space-y-2 px-4 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm text-text-primary">v{row.version}</span>
                {row.latest && <span className="ui-tag ui-tag-positive">latest</span>}
                {row.pause && (
                  <span className="ui-tag ui-tag-warning">
                    {PAUSED_BY_OWNER} · {timeAgo(row.pause.pausedAt.getTime())}
                  </span>
                )}
              </div>
              <p className="wrap-anywhere text-sm text-text-secondary">
                {parts.length > 0 ? parts.join(" · ") : "None of your projects uses this package."}
              </p>
              {flag && (
                <div className="ui-callout-negative flex-col gap-1">
                  <p>{flag}.</p>
                  <ul className="flex flex-wrap gap-x-3 gap-y-0 text-xs">
                    {row.red.map((r) => (
                      <li key={r.prUrl} className="flex min-w-0 items-center gap-1">
                        <Link href={r.href} className="wrap-anywhere hover:underline">
                          {r.projectName}
                        </Link>
                        <a
                          href={r.prUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="ui-link-subtle inline-flex min-h-11 items-center gap-1"
                        >
                          #{r.prNumber}
                          <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {owner && (
                <ReleasePauseButton slug={slug} version={row.version} paused={row.pause !== null} />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
