import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { ProjectRole } from "@/db/schema/project-memberships";
import { roleGuide } from "@/lib/project-capabilities";
import { ProjectAskBox } from "./ProjectAskBox";
import { FeedbackReportText } from "@/components/feedback/FeedbackReportText";
import { GoLiveButton } from "@/components/feedback/GoLiveButton";
import { ownerSiteUrl } from "../../../widget/owner-pass";
import { memberSiteUrl } from "../../../widget/member-pass";

/**
 * The manual for someone who was invited onto a project, at the top of the
 * page they land on — and the place to use it: the box to ask in, right
 * here (ProjectAskBox), then the site as the other door. What happens to
 * what they ask is the same line the invite page showed. The "Open" link
 * carries the person's member pass, so a note on the site is filed as theirs
 * (feedback/member-pass.ts); the site remembers it in that browser, and the
 * site's own feedback button has a sign-in door for any other browser.
 */
export function MemberGuide({
  projectId,
  role,
  projectName,
  ownerName,
  liveUrl,
  ownerPass,
  memberPass = null,
  joined,
  ready = [],
}: {
  projectId: string;
  role: ProjectRole;
  projectName: string;
  ownerName: string | null;
  liveUrl: string | null;
  ownerPass: string | null;
  /** A client's or viewer's own pass: their notes on the site are theirs. */
  memberPass?: string | null;
  /** Arrived straight from "Join": lead with that. */
  joined: boolean;
  /** A client's changes written and waiting for their "Make it live". */
  ready?: { id: string; suggestion: string }[];
}) {
  const owner = ownerName ?? "The owner";
  const site = liveUrl ? hostOf(liveUrl) : null;
  const guide = roleGuide(role, { site, owner });
  return (
    <section className="ui-project-section" aria-labelledby="member-guide-title">
      {joined && <p className="ui-kicker">You’re in</p>}
      <h2 id="member-guide-title" className="ui-project-section-title">
        How you ask for a change to {projectName}
      </h2>
      <p className="mt-2 text-base text-text-secondary">{guide.then}</p>
      {ready.length > 0 && <ReadyForYou items={ready} />}
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
            href={
              ownerPass
                ? ownerSiteUrl(liveUrl, ownerPass)
                : memberPass
                  ? memberSiteUrl(liveUrl, memberPass)
                  : liveUrl
            }
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

/**
 * A client's changes that are written and wait for them, above the box: the
 * one thing on this page only they can do. Each says what they asked, in
 * their words, and has the one button.
 */
function ReadyForYou({ items }: { items: { id: string; suggestion: string }[] }) {
  return (
    <div className="mt-4 space-y-2" aria-label="Ready for you">
      <h3 className="ui-micro-label">Ready for you · {items.length}</h3>
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="ui-card-shell space-y-3 p-4">
            <FeedbackReportText text={item.suggestion} />
            <GoLiveButton feedbackId={item.id} />
          </li>
        ))}
      </ul>
    </div>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
