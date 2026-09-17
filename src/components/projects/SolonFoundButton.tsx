"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Landmark } from "lucide-react";

type SolonGrantResponse =
  | { state: "governed"; orgSlug: string; url: string }
  | { state: "foundable"; url: string }
  | { state: "unlinked" }
  | { state: "unknown" }
  | { state: "unavailable" };

type ViewState =
  | { phase: "loading" }
  | { phase: "hidden" }
  | { phase: "unlinked" }
  | { phase: "foundable" }
  | { phase: "opening" }
  | { phase: "governed"; url: string };

/**
 * Solon, from the project's side — the governance twin of OrangeCatPublishButton.
 *
 * Unlike publishing to OrangeCat, Loki cannot do this FOR the owner. Founding an
 * organization takes a signature from the owner's own Bitcoin wallet, which Loki
 * never holds, so this is a handoff: it opens Solon's founding page with the
 * project filled in and a short-lived grant that lets Solon record the
 * organization as governing this project. The owner signs there.
 *
 * The grant is minted on click, not on page load — a tab left open past the
 * grant's lifetime would otherwise hand Solon an expired link.
 *
 * "unknown" (Solon unreachable) renders nothing rather than a founding link: the
 * project may already have an organization we simply could not see.
 */
export function SolonFoundButton({ projectId }: { projectId: string }) {
  const router = useRouter();
  const [view, setView] = useState<ViewState>({ phase: "loading" });

  const endpoint = `/api/user-projects/${projectId}/solon-grant`;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(endpoint);
        const json = res.ok ? ((await res.json()) as SolonGrantResponse) : null;
        if (cancelled) return;
        if (!json) setView({ phase: "hidden" });
        else if (json.state === "governed") setView({ phase: "governed", url: json.url });
        else if (json.state === "foundable") setView({ phase: "foundable" });
        else if (json.state === "unlinked") setView({ phase: "unlinked" });
        else setView({ phase: "hidden" });
      } catch {
        if (!cancelled) setView({ phase: "hidden" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [endpoint]);

  async function found() {
    setView({ phase: "opening" });
    try {
      const res = await fetch(endpoint);
      const json = res.ok ? ((await res.json()) as SolonGrantResponse) : null;
      if (json?.state === "foundable") {
        window.location.assign(json.url);
        return;
      }
      if (json?.state === "governed") {
        setView({ phase: "governed", url: json.url });
        return;
      }
      setView({ phase: "hidden" });
    } catch {
      setView({ phase: "foundable" });
    }
  }

  if (view.phase === "loading" || view.phase === "hidden") return null;

  if (view.phase === "governed") {
    return (
      <a
        href={view.url}
        target="_blank"
        rel="noreferrer"
        className="ui-btn-ghost min-h-11 gap-1.5"
        title="This project is governed by a Solon organization — view its roster and record"
        aria-label="View this project's organization on Solon"
      >
        <Landmark className="h-4 w-4 text-accent-text" aria-hidden /> On Solon
      </a>
    );
  }

  if (view.phase === "unlinked") {
    return (
      <button
        type="button"
        onClick={() => {
          router.push("/sign-in?callbackUrl=" + encodeURIComponent(window.location.pathname));
        }}
        className="ui-btn-ghost min-h-11 gap-1.5"
        title="Govern on Solon — connect your OrangeCat account first; the organization is founded under that identity"
        aria-label="Connect OrangeCat to govern this project on Solon"
      >
        <Landmark className="h-4 w-4" aria-hidden /> Govern
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() => void found()}
      disabled={view.phase === "opening"}
      className="ui-btn-ghost min-h-11 gap-1.5"
      title="Found a Solon organization for this project — you sign with your own Bitcoin key on Solon"
      aria-label="Found a Solon organization for this project"
    >
      <Landmark
        className={`h-4 w-4 ${view.phase === "opening" ? "animate-pulse" : ""}`}
        aria-hidden
      />
      {view.phase === "opening" ? "Opening Solon…" : "Govern"}
    </button>
  );
}
