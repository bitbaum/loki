import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ProjectRole } from "@/db/schema/project-memberships";
import { roleGuide } from "@/lib/project-capabilities";
import { ProjectAskBox } from "./ProjectAskBox";
import { ownerSiteUrl } from "../../../widget/owner-pass";

/**
 * The manual for someone who was invited onto a project, at the top of the
 * page they land on — and the place to use it: the box to ask in, right
 * here (ProjectAskBox), then the site as the other door. What happens to
 * what they ask is the same line the invite page showed. A Builder's "Open"
 * link carries the pass that makes their note on the site build at once; the
 * site remembers it in that browser, and the site's own feedback button has
 * a sign-in door for any other browser.
 */
export function MemberGuide({
  projectId,
  role,
  projectName,
  ownerName,
  liveUrl,
  ownerPass,
  joined,
}: {
  projectId: string;
  role: ProjectRole;
  projectName: string;
  ownerName: string | null;
  liveUrl: string | null;
  ownerPass: string | null;
  /** Arrived straight from "Join": lead with that. */
  joined: boolean;
}) {
  const owner = ownerName ?? "The owner";
  const site = liveUrl ? hostOf(liveUrl) : null;
  const guide = roleGuide(role, { site, owner });
  const builder = role === "editor";
  return (
    <section className="ui-project-section" aria-labelledby="member-guide-title">
      {joined && <p className="ui-kicker">You’re in</p>}
      <h2 id="member-guide-title" className="text-lg font-semibold">
        {builder ? `How you change ${projectName}` : `How you ask for a change to ${projectName}`}
      </h2>
      <p className="mt-2 text-base text-text-secondary">{guide.then}</p>
      <ProjectAskBox projectId={projectId} projectName={projectName} />
      <p className="mt-3 text-sm text-text-secondary">
        Everything you asked for, and where each one is:{" "}
        <Link href="/my-feedback" className="underline underline-offset-2">
          your requests
        </Link>
        .
      </p>
      {liveUrl && (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-sm text-text-tertiary">
            Or tap Feedback on the site itself — there you can also point at the spot.
          </p>
          <a
            href={ownerPass ? ownerSiteUrl(liveUrl, ownerPass) : liveUrl}
            target="_blank"
            rel="noreferrer"
            className="ui-btn-secondary min-h-11 gap-2"
          >
            Open {site} <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
          </a>
        </div>
      )}
    </section>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
