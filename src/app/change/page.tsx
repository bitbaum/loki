import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { COMMISSION } from "@/config/commission";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { WebsiteChangeBrief } from "@/components/public/WebsiteChangeBrief";

export const metadata: Metadata = {
  title: "Change your website",
  description:
    "Say what your website should do differently — typed or spoken. Loki's agents build a new version for you to review; your live site is not touched until you choose.",
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
            <div className="ui-public-eyebrow">Change your website</div>
            <h1 className="ui-public-display-md mt-3">What should your website do differently?</h1>
            <p className="mt-3 text-base text-text-secondary">
              Say it the way you would tell a person — which site, and what should change. Loki
              writes it up as a brief, its agents build a new version, and you review it before
              anything on your live site changes.
            </p>
          </div>
          <WebsiteChangeBrief signedIn={Boolean(session?.user)} />
        </div>
      </main>
    </PublicSurface>
  );
}
