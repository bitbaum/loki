"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { isFeedbackWidgetRoute } from "@/config/feedback-widget";

/**
 * Dogfood embed of Loki's own feedback widget — on EVERY surface, not
 * just the public pages (see config/feedback-widget.ts for the short list of
 * exclusions and why each one is excluded). Injects the exact same
 * /widget.js script tag a customer site would use — same code path, same
 * ingest API — pointed at the project the FEEDBACK_WIDGET_TOKEN env var
 * belongs to. Rendered by the root layout only when that env var is set.
 *
 * Imperative injection (not a JSX <script>) so route changes can mount and
 * unmount it cleanly along with the host element the widget creates.
 */
export function DogfoodFeedbackWidget({ token }: { token: string }) {
  const pathname = usePathname();
  const show = isFeedbackWidgetRoute(pathname ?? "");

  useEffect(() => {
    if (!show) return;
    const script = document.createElement("script");
    script.src = "/widget.js";
    script.async = true;
    script.setAttribute("data-fc-project", token);
    // Loki's own widget draws its chat with chatkit first (widget/chat/).
    script.setAttribute("data-fc-chat", "kit");
    document.body.appendChild(script);
    return () => {
      script.remove();
      document.getElementById("loki-feedback-host")?.remove();
    };
  }, [show, token]);

  return null;
}
