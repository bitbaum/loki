import type { ReactNode } from "react";
import Link from "next/link";
import { timeAgo } from "@/lib/dates";
import type { ReadCoverage } from "@/lib/packages/load";
import { projectTitle } from "@/lib/project-display";

/**
 * How much of the picture the page is showing: how many repositories were
 * read, when, and — for any that could not be — which, why, and where to fix
 * it. A list that quietly omits three projects reads as "they use nothing".
 */
export function ReadCoverageNote({
  coverage,
  catalogueSource,
  refresh,
}: {
  coverage: ReadCoverage;
  catalogueSource: "live" | "snapshot";
  /** "Read again", at the end of the line. */
  refresh?: ReactNode;
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
  // Only worth a word when it is the fallback.
  if (catalogueSource !== "live") parts.push("the package list is Loki's saved copy for now");

  return (
    <div className="space-y-2 text-sm text-text-tertiary">
      <p>
        {parts.join(" · ")}. {refresh}
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
        <details className="ui-coverage-more">
          <summary>
            {coverage.failures.length}{" "}
            {coverage.failures.length === 1 ? "repository" : "repositories"} could not be read
          </summary>
          <ul className="mt-2 space-y-2">
            {coverage.failures.map((f) => (
              <li key={f.projectId} className="flex flex-col gap-0.5">
                <Link
                  href={f.href}
                  className="font-medium text-text-secondary hover:text-text-primary"
                >
                  {projectTitle({ name: f.projectName })}
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
