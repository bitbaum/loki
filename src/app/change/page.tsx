import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { COMMISSION } from "@/config/commission";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { WebsiteChangeBrief } from "@/components/public/WebsiteChangeBrief";

export const metadata: Metadata = {
  title: "Start from a website",
  description:
    "Name your website and get a free consultation first: what is costing you visitors, what is already right, and what to fix. Then Loki's agents build the new version you choose — you review it before anything goes live.",
};

/**
 * Was /commission — a word that means hiring someone, on a page where you
 * build it yourself. /commission now redirects here (the studio's own
 * engagement contract keeps its name and URL).
 */
export default async function ChangeWebsitePage({
  searchParams,
}: {
  searchParams: Promise<{ package?: string }>;
}) {
  const params = await searchParams;
  if (params.package) redirect(`${COMMISSION.studioHireUrl}#website`);
  const session = await auth();
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="ui-public-container py-10 sm:py-14">
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <div className="ui-public-eyebrow">Start from a website</div>
            <h1 className="ui-public-display-md mt-3">See what your site is costing you.</h1>
            <p className="mt-3 text-base text-text-secondary">
              Name your website. Before anything is built, Loki reads it the way a new visitor and
              Google do and tells you, in plain words, what is losing you visitors and enquiries —
              and what is already right. You keep the fixes you want, add anything else in your own
              words, and Loki&apos;s agents build the new version. Your live site is not touched
              until you have reviewed it.
            </p>
            <p className="mt-2 text-sm text-text-muted">
              Want something new of your own instead? Choose “Make my own, inspired by it” and name
              a site you admire.
            </p>
          </div>
          <WebsiteChangeBrief signedIn={Boolean(session?.user)} />
        </div>
      </main>
    </PublicSurface>
  );
}
