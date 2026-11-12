import Link from "next/link";
import { Compass } from "lucide-react";
import { PublicHeaderActions } from "@/components/public/PublicHeaderActions";
import { PublicSurface } from "@/components/public/PublicSurface";
import { EmptyState } from "@/components/ui/empty-state";

export const metadata = { title: "Page not found" };

/**
 * Any address nothing answers, outside the signed-in shell (a mistyped public
 * link, a deleted article, an old bookmark). Without this file the framework
 * drew its own bare "404 | This page could not be found." on a black screen:
 * no brand, no menu and no way back, so the only move left was the browser's
 * Back button. That is a dead end (fleet AGENTS.md, "No dead ends").
 *
 * The public header gives the way to everything public; the one button goes
 * to the start, which is the app for someone signed in and the homepage for
 * everyone else (`/` decides). Pages inside the app have their own, in
 * (app)/not-found.tsx, which keeps the sidebar and the bottom bar.
 */
export default function NotFound() {
  return (
    <PublicSurface right={<PublicHeaderActions />}>
      <main className="ui-auth-main">
        <div className="ui-auth-container">
          <h1 className="sr-only">Page not found</h1>
          <EmptyState
            icon={Compass}
            title="This page doesn’t exist."
            size="lg"
            action={
              <Link href="/" className="ui-btn-secondary min-h-11">
                Go to the start
              </Link>
            }
          />
        </div>
      </main>
    </PublicSurface>
  );
}
