import type { Metadata } from "next";
import { auth } from "@/auth";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { WebsiteCommissionForm } from "@/components/public/WebsiteCommissionForm";
import { getStudioCommission } from "@/lib/studio-commission";

export const metadata: Metadata = {
  title: "Change an existing website — Loki",
  description:
    "Enter a website address and describe your changes. Build a new version with Loki, or send a request to the Bitbaum studio.",
};

export default async function CommissionPage({
  searchParams,
}: {
  searchParams: Promise<{ package?: string }>;
}) {
  const [session, contract, params] = await Promise.all([
    auth(),
    getStudioCommission(),
    searchParams,
  ]);
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="ui-public-container py-10 sm:py-14">
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <h1 className="ui-public-display-md">What should your website do next?</h1>
            <p className="mt-3 text-base text-text-secondary">
              Paste its address and tell us what you want to change.
            </p>
          </div>
          <WebsiteCommissionForm
            signedIn={Boolean(session?.user)}
            requestedPackage={Boolean(params.package)}
            studio={
              contract ? { offer: contract.offer, availability: contract.availability } : null
            }
          />
        </div>
      </main>
    </PublicSurface>
  );
}
