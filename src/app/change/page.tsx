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
      <main className="ui-public-container pb-14 pt-10 sm:pt-16">
        <div className="mx-auto max-w-2xl space-y-6">
          {/* One title and one paragraph. The note under it ("want something
              of your own instead? choose …") repeated the choice the form
              shows right below it. */}
          <div>
            <h1 className="ui-public-page-title">See what your site is costing you.</h1>
            <p className="ui-public-body-lg mt-4">
              Name your website. Before anything is built, Loki reads it the way a new visitor and
              Google do and tells you, in plain words, what is losing you visitors and enquiries —
              and what is already right. You keep the fixes you want, add anything else in your own
              words, and Loki&apos;s agents build the new version. Your live site is not touched
              until you have reviewed it.
            </p>
          </div>
          <WebsiteChangeBrief signedIn={Boolean(session?.user)} />
        </div>
      </main>
    </PublicSurface>
  );
}
