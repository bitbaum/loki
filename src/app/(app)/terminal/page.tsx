import type { Metadata } from "next";
import { Suspense } from "react";
import { TerminalPageClient } from "@/components/terminal/TerminalPageClient";
import { PageTitle } from "@/components/ui/page-title";
import { isRuntimeAvailable } from "@/lib/runtime";
import { EXECUTOR_COPY } from "@/config/executor-copy";

export const metadata: Metadata = { title: "Terminal" };

export default function TerminalPage() {
  const local = isRuntimeAvailable();
  return (
    // data-fc-place="hidden": the feedback widget loads here but draws no
    // floating button — it would sit over live terminal output or the composer.
    // It opens from the Feedback button in the terminal header instead.
    <div
      data-fc-place="hidden"
      className="app-page app-page-compact app-viewport-pane flex flex-col gap-3 md:gap-4"
    >
      {/* Both children are mobile-hidden (the top bar already says "Terminal",
          the subtitle starts at sm), so on a phone this block contributed
          nothing but the parent flex gap above a pane fighting for every row. */}
      <div className="ui-page-header hidden sm:flex">
        <div>
          <PageTitle title="Terminal" />
          <p className="ui-page-subtitle">{EXECUTOR_COPY.terminal.pageSubtitle}</p>
        </div>
      </div>
      <Suspense
        fallback={<div className="ui-empty-page text-sm text-text-muted">Loading terminal…</div>}
      >
        <TerminalPageClient local={local} />
      </Suspense>
    </div>
  );
}
