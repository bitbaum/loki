import type { Metadata } from "next";
import { Suspense } from "react";
import { TerminalPageClient } from "@/components/terminal/TerminalPageClient";
import { PageHead, PageTitle } from "@/components/ui/page-title";
import { isRuntimeAvailable } from "@/lib/runtime";

export const metadata: Metadata = { title: "Sessions" };

export default function TerminalPage() {
  const local = isRuntimeAvailable();
  return (
    // data-fc-place="tab": a corner button would sit over live terminal output
    // or the composer, so the feedback launcher is the slim edge tab here —
    // still on screen and one tap away, like on every other page. (It was
    // "hidden" until 2026-10, which left the desktop terminal with no way to
    // report anything but the account menu.)
    <div
      data-fc-place="tab"
      className="app-page app-page-compact app-viewport-pane flex flex-col gap-3 md:gap-4"
    >
      {/* The page's one title, named as the nav names it. On a phone the top
          bar already says "Sessions", so it is read there, not drawn. It
          used to be "Live Terminal – AI Agent Sessions" over a sentence
          explaining the page (design reset rules 1 and 2). */}
      <PageHead title="Sessions" onlyTitle>
        <div className="ui-page-header">
          <PageTitle title="Sessions" />
        </div>
      </PageHead>
      <Suspense
        fallback={<div className="ui-empty-page text-sm text-text-muted">Loading sessions…</div>}
      >
        <TerminalPageClient local={local} />
      </Suspense>
    </div>
  );
}
