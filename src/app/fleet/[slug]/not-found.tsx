import Link from "next/link";
import { Compass } from "lucide-react";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";

/**
 * What a reader gets when a project has no public build profile.
 *
 * The ask this answers, in the owner's words: "I click the project on
 * OrangeCat, and I expect Heidi's Loki profile if it exists, or an invitation
 * to create one if it doesn't." A bare 404 is neither — and the arriving
 * reader followed a link from a real project's public page, so the one thing
 * they should not hit is a dead end.
 *
 * Deliberately the same page for an unknown slug and for a project whose owner
 * has not consented to public listing: if the two differed, this page would
 * confirm which private projects exist. The status code stays 404 (this is
 * `not-found.tsx`), so nothing pretends an arbitrary slug is a page.
 */
export default function ProjectProfileNotFound() {
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <div className="ui-public-container-mid py-16 sm:py-24">
        <Compass className="h-10 w-10 text-text-muted" aria-hidden />
        <h1 className="ui-public-page-title mt-6">No public profile for this project</h1>
        <p className="ui-public-section-lede mt-4">
          Projects built with Loki publish a public page — purpose, roadmap, changelog, and what
          moved last — from their own record. This one has not published yet, or is not listed
          publicly.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <Link href="/fleet" className="ui-public-cta">
            Browse the projects that have
          </Link>
          <Link href="/sign-up" className="ui-public-cta-ghost">
            Publish yours
          </Link>
        </div>
        <p className="ui-public-meta mt-6">
          Already building here? A project publishes this page from its workspace — turn on public
          listing in the project&apos;s settings.
        </p>
      </div>
    </PublicSurface>
  );
}
