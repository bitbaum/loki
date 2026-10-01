import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { COMMISSION } from "@/config/commission";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { WebsiteCommissionForm } from "@/components/public/WebsiteCommissionForm";
export const metadata: Metadata = {
  title: "Change an existing website",
  description:
    "Enter a website address and describe your changes. Build a new version yourself with Loki, the free independent tool.",
};
export default async function CommissionPage({
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
            <h1 className="ui-public-display-md">What should your website do next?</h1>
            <p className="mt-3 text-base text-text-secondary">
              Paste its address and describe what you want to change. Build it yourself with Loki.
            </p>
          </div>
          <WebsiteCommissionForm signedIn={Boolean(session?.user)} />
        </div>
      </main>
    </PublicSurface>
  );
}
