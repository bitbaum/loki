import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { ROUTES } from "@/config/auth";
import { BUILD_REQUEST_COPY, BUILD_REQUESTS } from "@/config/build-requests";
import { COMMISSION } from "@/config/commission";
import { getOwnBuildRequest } from "@/db/queries/build-requests";
import { getProjectAccess } from "@/db/queries/project-access";
import { siteName } from "@/lib/previews/from-website";
import { getSessionUserId } from "@/lib/session";
import { isValidUuid } from "@/lib/utils";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { BeforeAfter } from "@/components/public/InstantPreview";

export const metadata: Metadata = { title: "Your request", robots: { index: false } };

/**
 * One build request from /change, as the person who filed it sees it
 * (config/build-requests): waiting for a person, being built — with the
 * preview's own address and code — or not started, with the reason. Theirs
 * only; anyone else gets a 404, never a hint the request exists.
 */
export default async function BuildRequestPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isValidUuid(id)) notFound();
  const userId = await getSessionUserId();
  if (!userId)
    redirect(`${ROUTES.SIGN_IN}?callbackUrl=${encodeURIComponent(BUILD_REQUESTS.pagePath(id))}`);
  const row = await getOwnBuildRequest(userId, id);
  if (!row) notFound();
  const copy = BUILD_REQUEST_COPY[row.status];
  // Their seat on the site made for them (lib/build-requests/decide.ts).
  const seat = row.projectId
    ? await getProjectAccess(userId, row.projectId).catch(() => null)
    : null;
  const words = typeof row.brief.changes === "string" ? row.brief.changes.trim() : "";

  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="ui-public-container py-10 sm:py-14">
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <div className="ui-public-eyebrow">Your request · {siteName(row.website)}</div>
            <h1 className="ui-public-display-md mt-3">{copy.title}</h1>
            <p className="mt-3 text-base text-text-secondary">{copy.body}</p>
          </div>

          {row.status === "building" && row.previewUrl && (
            <section className="ui-change-brief" aria-label="Your new version">
              <a
                className="ui-btn-primary min-h-11 inline-flex"
                href={row.previewUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open the new version <ExternalLink className="h-4 w-4" aria-hidden />
              </a>
              {row.accessCode && (
                <p className="text-sm text-text-secondary">
                  The code to open it:{" "}
                  <strong className="text-text-primary">{row.accessCode}</strong>
                </p>
              )}
              {row.projectId && seat && (
                <p className="text-sm text-text-secondary">
                  Want something different? Say it on{" "}
                  <Link className="ui-public-link" href={`/projects/${row.projectId}#ask`}>
                    your project page
                  </Link>
                  . The site&apos;s owner decides what gets built, and you are told when it is live.
                </p>
              )}
            </section>
          )}

          {row.status === "declined" && row.note && (
            <blockquote className="ui-change-brief text-sm text-text-secondary">
              {row.note}
            </blockquote>
          )}

          <section className="ui-change-brief" aria-label="What you asked for">
            <div className="ui-change-brief-label">What you asked for</div>
            <p className="ui-change-brief-site">{siteName(row.website)}</p>
            {words && <p className="whitespace-pre-wrap text-sm text-text-secondary">{words}</p>}
            {row.look && (
              <div className="space-y-2">
                <BeforeAfter
                  before={row.look.before}
                  after={row.look.after}
                  website={row.website}
                />
                {row.look.summary && <p className="ui-instant-summary">{row.look.summary}</p>}
              </div>
            )}
          </section>

          {row.status === "declined" && (
            <Link className="ui-public-link text-sm" href={COMMISSION.path}>
              Start a new request
            </Link>
          )}
        </div>
      </main>
    </PublicSurface>
  );
}
