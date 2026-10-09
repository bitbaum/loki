import type { Metadata } from "next";
import Link from "next/link";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { BuildPaths } from "@/components/public/BuildPaths";
import { BUILD_PAGE, fromHost } from "@/config/build-paths";
import { APP_NAME } from "@/config/brand";

export const metadata: Metadata = {
  title: "Build something",
  description:
    "Three ways to get something built with Loki: do it yourself, build it with a partner, or have the bitbaum studio build it.",
};

/**
 * Where every "I want one too" lands.
 *
 * A stranger meets Loki on somebody else's site — the panel in the corner, a
 * fix they watched arrive — and the only invitation used to be a bare
 * homepage. This page is the invitation: the site they came from, named, and
 * the three ways in. Nothing to decide yet; each door says who it is for.
 */
export default async function BuildPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { from } = await searchParams;
  const host = fromHost(from);
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="ui-public-container py-10 sm:py-14">
        <div className="mx-auto max-w-3xl">
          <div className="text-center">
            <div className="ui-public-eyebrow">{BUILD_PAGE.eyebrow}</div>
            <h1 className="ui-public-display-lg mt-3 sm:mt-4">{BUILD_PAGE.title}</h1>
            <p className="ui-public-section-lede mx-auto mt-4">{BUILD_PAGE.lede}</p>
            {host && (
              <p className="ui-public-meta mt-4">
                You met {APP_NAME} on <span className="text-text-primary">{host}</span> — that site
                is built and changed this way.
              </p>
            )}
          </div>
          <BuildPaths className="ui-public-section-gap" />
          <p className="ui-public-meta mt-8 text-center">
            Not sure which?{" "}
            <Link href="/change" className="ui-public-link-standalone">
              Say what should change on a site you have →
            </Link>
          </p>
        </div>
      </main>
    </PublicSurface>
  );
}
