import * as React from "react";
import { createRoot } from "react-dom/client";
import { FeedbackInbox } from "@/components/feedback/FeedbackInbox";
import { FIXTURE, PROVIDERS } from "./feedback-inbox.fixture";

// The page's own data, served from memory: the component is real, the
// network is not. Writes are logged and acknowledged so buttons work.
const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  if (url.startsWith("/api/feedback/inbox")) return json(FIXTURE);
  if (url.startsWith("/api/providers")) return json(PROVIDERS);
  if (url.startsWith("/api/feedback/") && url.endsWith("/screenshot"))
    return json({ screenshots: [] });
  if (url.startsWith("/api/feedback/") && url.endsWith("/watch"))
    return json({
      work: {
        phase: "working",
        label: "Working",
        stepSummary: "Agent generating",
        queueReason: null,
        diagnostic: null,
        terminalReady: true,
      },
      events: [
        {
          kind: "generating",
          label: "Agent generating",
          at: new Date().toISOString(),
          detail: null,
        },
      ],
      commandLive: null,
      terminalHref: "/terminal?tab=loki",
      projectName: "loki",
    });
  if (url.startsWith("/api/")) {
    console.log("[preview write]", init?.method ?? "GET", url, init?.body ?? "");
    return json({ ok: true, runId: "r-new" });
  }
  return realFetch(input, init);
};

const mount = document.getElementById("root")!;
createRoot(mount).render(
  <div className="app-page max-w-5xl space-y-7 md:space-y-9">
    <div className="space-y-3">
      <div className="ui-page-header">
        <div>
          <h1 className="ui-page-title">Feedback</h1>
        </div>
      </div>
    </div>
    <FeedbackInbox />
  </div>,
);
