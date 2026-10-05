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
    "Name a website and say what you want — typed or spoken. Loki's agents build a new version of your site, or something new of your own inspired by one you admire. You review it first.",
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
            <h1 className="ui-public-display-md mt-3">Start from a website you know.</h1>
            <p className="mt-3 text-base text-text-secondary">
              Say it the way you would tell a person: which site, and what you want. Loki can build
              a new version of your own site, or something new of your own that only takes ideas
              from one you admire. Its agents write the brief and build it, and you review it before
              anything goes live.
            </p>
          </div>
          <WebsiteChangeBrief signedIn={Boolean(session?.user)} />
        </div>
      </main>
    </PublicSurface>
  );
}
