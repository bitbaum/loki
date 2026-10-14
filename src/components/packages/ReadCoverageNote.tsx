import Link from "next/link";
import { timeAgo } from "@/lib/dates";
import type { ReadCoverage } from "@/lib/packages/load";

/**
 * How much of the picture the page is showing: how many repositories were
 * read, when, and — for any that could not be — which, why, and where to fix
 * it. A list that quietly omits three projects reads as "they use nothing".
 */
export function ReadCoverageNote({
  coverage,
  catalogueSource,
}: {
  coverage: ReadCoverage;
  catalogueSource: "live" | "snapshot";
}) {
  const parts: string[] = [];
  if (coverage.withRepo === 0) {
    parts.push("None of your projects has a GitHub repository to read yet");
  } else {
    parts.push(
      `Read ${coverage.read} of ${coverage.withRepo} ${coverage.withRepo === 1 ? "repository" : "repositories"}`,
    );
    if (coverage.lastReadAt) parts.push(`last ${timeAgo(coverage.lastReadAt.getTime())}`);
  }
  parts.push(
    catalogueSource === "live"
      ? "package list from bitbaum/fleet"
      : "package list from Loki's saved copy of bitbaum/fleet (it did not answer just now)",
  );

  return (
    <div className="space-y-2 text-xs text-text-tertiary">
      <p>
        {parts.join(" · ")}.
        {coverage.withRepo === 0 && (
          <>
            {" "}
            <Link href="/projects" className="ui-link-subtle">
              Add a repository to a project
            </Link>
          </>
        )}
      </p>
      {coverage.failures.length > 0 && (
        <details className="ui-disclosure">
          <summary className="ui-disclosure-summary">
            {coverage.failures.length}{" "}
            {coverage.failures.length === 1 ? "repository" : "repositories"} could not be read
          </summary>
          <ul className="space-y-2 px-4 pb-3">
            {coverage.failures.map((f) => (
              <li key={f.projectId} className="flex flex-col gap-0.5">
                <Link
                  href={f.href}
                  className="font-medium text-text-secondary hover:text-text-primary"
                >
                  {f.projectName}
                </Link>
                <span>{f.detail}</span>
              </li>
            ))}
            <li>
              <Link href="/settings#account" className="ui-link-subtle">
                Connect or check GitHub in Settings
              </Link>
            </li>
          </ul>
        </details>
      )}
    </div>
  );
}
