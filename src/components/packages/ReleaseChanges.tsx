import { ExternalLink } from "lucide-react";
import { timeAgo } from "@/lib/dates";
import type { LastRelease, ReleaseState } from "@/lib/packages/release";
import type { CommitKind } from "@/lib/packages/release-notes";

const KIND: Record<CommitKind, { label: string; tone: string }> = {
  breaking: { label: "breaking", tone: "ui-tag-warning" },
  feature: { label: "new", tone: "ui-tag-accent" },
  fix: { label: "fix", tone: "ui-tag-neutral" },
};

/**
 * The changes since the last release, newest first: each one's first line,
 * marked breaking / new / fix, linked to the change on GitHub. A long list
 * ends in "and N more", linked to the whole comparison.
 */
export function ReleaseChanges({ release }: { release: ReleaseState }) {
  const unreleased = release.unreleased;
  if (!unreleased || unreleased.total === 0) return null;
  const more = unreleased.total - unreleased.changes.length;
  const compareUrl = `https://github.com/${release.repo}/compare/v${release.current}...${release.defaultBranch}`;
  return (
    <ul className="space-y-1.5" aria-label="Unreleased changes">
      {unreleased.changes.map((c) => (
        <li key={c.sha} className="flex min-w-0 items-start gap-2 text-sm">
          <span className={`ui-tag ${KIND[c.kind].tone} shrink-0`}>{KIND[c.kind].label}</span>
          {c.url ? (
            <a
              href={c.url}
              target="_blank"
              rel="noreferrer"
              className="min-w-0 wrap-anywhere text-text-secondary hover:underline"
            >
              {c.title}
            </a>
          ) : (
            <span className="min-w-0 wrap-anywhere text-text-secondary">{c.title}</span>
          )}
        </li>
      ))}
      {more > 0 && (
        <li className="text-xs">
          <a
            href={compareUrl}
            target="_blank"
            rel="noreferrer"
            className="ui-link-subtle inline-flex items-center gap-1"
          >
            and {more} more
            <ExternalLink className="h-3 w-3" aria-hidden />
          </a>
        </li>
      )}
    </ul>
  );
}

/** The newest release run, in one line: running, released, or failed — with the way to look. */
export function ReleaseRunLine({ run }: { run: LastRelease }) {
  const v = run.version ? `v${run.version}` : "the last release";
  const when = run.startedAt ? ` · started ${timeAgo(new Date(run.startedAt).getTime())}` : "";
  const link = (
    <a
      href={run.url}
      target="_blank"
      rel="noreferrer"
      className="ui-link-subtle inline-flex items-center gap-1"
    >
      {run.phase === "failed" ? "See what happened" : "See it run"}
      <ExternalLink className="h-3 w-3" aria-hidden />
    </a>
  );
  if (run.phase === "failed") {
    return (
      <p className="ui-callout-negative flex-wrap" role="status">
        <span className="min-w-0">
          Releasing {v} failed{when}. Nothing was tagged.
        </span>
        {link}
      </p>
    );
  }
  if (run.phase === "running") {
    return (
      <p
        className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-secondary"
        role="status"
      >
        <span className="ui-tag ui-tag-accent">releasing</span>
        <span>
          {v}
          {when} — it appears as the latest version once tagged.
        </span>
        {link}
      </p>
    );
  }
  return (
    <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-text-tertiary">
      <span>
        {run.tagged
          ? `Last released: ${v}${when}.`
          : `${v} was released${when}; its tag shows here on the next read.`}
      </span>
      {link}
    </p>
  );
}
