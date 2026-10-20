import type { Metadata } from "next";
import { Suspense } from "react";
import { TerminalPageClient } from "@/components/terminal/TerminalPageClient";
import { PageTitle } from "@/components/ui/page-title";
import { isRuntimeAvailable } from "@/lib/runtime";
import { EXECUTOR_COPY } from "@/config/executor-copy";

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
      {/* The page's one <h1>, at every width. Below sm it is for screen
          readers only: an open session hides the app bars there and a
          visible row here would come out of a pane fighting for every line.
          It used to be display:none on a phone, which left the page with no
          heading at all. */}
      <div className="ui-page-header sr-only sm:not-sr-only sm:flex">
        <div>
          <PageTitle title={EXECUTOR_COPY.terminal.pageTitle} />
          <p className="ui-page-subtitle">{EXECUTOR_COPY.terminal.pageSubtitle}</p>
        </div>
      </div>
      <Suspense
        fallback={<div className="ui-empty-page text-sm text-text-muted">Loading sessions…</div>}
      >
        <TerminalPageClient local={local} />
      </Suspense>
    </div>
  );
}
