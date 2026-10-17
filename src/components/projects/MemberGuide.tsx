import { ArrowUpRight } from "lucide-react";
import type { ProjectRole } from "@/db/schema/project-memberships";
import { roleGuide } from "@/lib/project-capabilities";
import { ownerSiteUrl } from "../../../widget/owner-pass";

/**
 * The manual for someone who was invited onto a project, at the top of the
 * page they land on. The same three lines the invite page showed, so what
 * they read before joining is what they find after. A Builder's "Open" link
 * carries the pass that makes their note on the site build at once; the
 * site remembers it in that browser, and the site's own feedback button has
 * a sign-in door for any other browser.
 */
export function MemberGuide({
  role,
  projectName,
  ownerName,
  liveUrl,
  ownerPass,
  joined,
}: {
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
      <ol className="mt-3 ml-5 list-decimal space-y-2 text-base text-text-secondary">
        {guide.steps.map((step) => (
          <li key={step}>{step}</li>
        ))}
        <li>{guide.then}</li>
      </ol>
      {liveUrl && (
        <a
          href={ownerPass ? ownerSiteUrl(liveUrl, ownerPass) : liveUrl}
          target="_blank"
          rel="noreferrer"
          className="ui-btn-primary mt-4 min-h-11 gap-2"
        >
          Open {site} <ArrowUpRight className="h-4 w-4" aria-hidden="true" />
        </a>
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
