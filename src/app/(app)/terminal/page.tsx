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
      {/* Both children are mobile-hidden (the top bar already says "Sessions",
          the subtitle starts at sm), so on a phone this block contributed
          nothing but the parent flex gap above a pane fighting for every row. */}
      <div className="ui-page-header hidden sm:flex">
        <div>
          <PageTitle title="Sessions" />
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
