import type { Metadata } from "next";
import { auth } from "@/auth";
import { PublicSurface } from "@/components/public/PublicSurface";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { TakeRepoBrief } from "@/components/public/TakeRepoBrief";

export const metadata: Metadata = {
  title: "Make it yours",
  description:
    "Start your own copy of an open-source Bitbaum project. Loki's agents import it, give it your name and shape it to what you need. MIT, no permission needed.",
};

/**
 * Where OrangeCat's "Steal the cat" lands for people who would rather not
 * fork and set things up by hand. The code is MIT; this page only does the
 * work of taking it.
 */
export default async function TakePage({
  searchParams,
}: {
  searchParams: Promise<{ repo?: string }>;
}) {
  const [{ repo }, session] = await Promise.all([searchParams, auth()]);
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="ui-public-container py-10 sm:py-14">
        <div className="mx-auto max-w-2xl space-y-6">
          <div>
            <div className="ui-public-eyebrow">Open source · MIT</div>
            <h1 className="ui-public-display-md mt-3">Make it yours.</h1>
            <p className="mt-3 text-base text-text-secondary">
              Pick a project and say what your copy should be. Loki&apos;s agents copy the code into
              a project of your own, give it your name and look, and show you the result before
              anything runs. You can also take the code straight from GitHub, with no account at
              all.
            </p>
          </div>
          <TakeRepoBrief signedIn={Boolean(session?.user)} initialRepo={repo} />
        </div>
      </main>
    </PublicSurface>
  );
}
