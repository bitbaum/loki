"use client";

import { useEffect, useState } from "react";
import { Cat } from "lucide-react";

type PublishState =
  | { phase: "loading" }
  | { phase: "unavailable" } // no user_projects row (readonly/foreign project)
  | { phase: "unlinked" }
  | { phase: "unpublished" }
  | { phase: "publishing" }
  | { phase: "published"; orangecatProjectId: string }
  | { phase: "unpublishing"; orangecatProjectId: string };

/** null = never chosen. Rendered as a question, not as an off switch. */
type Autopost = boolean | null;

/**
 * "Publish to OrangeCat" — opt-in per-project projection onto the OrangeCat
 * economic layer (cross-product bridge Part C).
 *
 * Linking an OrangeCat account (OIDC) is NOT this button and is NOT consent to
 * publish. Publish is per-project and starts from the moment of opt-in; past
 * private history is not dumped onto the wall by default.
 *
 * Nor is publishing consent to the FEED. The page and the running account of
 * what agents did on it are two decisions, and the second one lives beside the
 * first as its own switch — because the only way to stop the feed used to be
 * to take the page down. Left on, it is the strongest thing a public project
 * page can carry: dated evidence of work, which is the half of a transparency
 * claim that better copy cannot manufacture.
 */
export function OrangeCatPublishButton({ projectId }: { projectId: string }) {
  const [state, setState] = useState<PublishState>({ phase: "loading" });
  const [autopost, setAutopost] = useState<Autopost>(null);
  const [autopostBusy, setAutopostBusy] = useState(false);
  // Taking it down can fail in ways the person can act on (not linked, an
  // OrangeCat too old to be asked), so the reason is shown rather than swallowed.
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/user-projects/${projectId}/publish-orangecat`);
        if (!res.ok) {
          if (!cancelled) setState({ phase: "unavailable" });
          return;
        }
        const json = (await res.json()) as {
          linked: boolean;
          orangecatProjectId: string | null;
          autopost: Autopost;
        };
        if (cancelled) return;
        setAutopost(json.autopost ?? null);
        if (json.orangecatProjectId) {
          setState({ phase: "published", orangecatProjectId: json.orangecatProjectId });
        } else {
          setState({ phase: json.linked ? "unpublished" : "unlinked" });
        }
      } catch {
        if (!cancelled) setState({ phase: "unavailable" });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  async function publish() {
    setState({ phase: "publishing" });
    try {
      const res = await fetch(`/api/user-projects/${projectId}/publish-orangecat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Publishing answers both questions at once, and says so on the button
        // below: the page goes up and it starts showing what gets built. One
        // press, both answers recorded — and the feed alone is reversible.
        body: JSON.stringify({ autopost: true }),
      });
      const json = (await res.json()) as { orangecatProjectId?: string; reason?: string };
      if (res.ok && json.orangecatProjectId) {
        setAutopost(true);
        setState({ phase: "published", orangecatProjectId: json.orangecatProjectId });
      } else if (json.reason === "not_linked") {
        setState({ phase: "unlinked" });
      } else {
        setState({ phase: "unpublished" });
      }
    } catch {
      setState({ phase: "unpublished" });
    }
  }

  async function unpublish() {
    if (state.phase !== "published") return;
    const ocId = state.orangecatProjectId;
    setError(null);
    setState({ phase: "unpublishing", orangecatProjectId: ocId });
    try {
      const res = await fetch(`/api/user-projects/${projectId}/publish-orangecat`, {
        method: "DELETE",
      });
      if (res.ok) {
        setState({ phase: "unpublished" });
        return;
      }
      const json = (await res.json().catch(() => ({}))) as { error?: string };
      setError(json.error ?? "Could not take it down — try again shortly.");
      setState({ phase: "published", orangecatProjectId: ocId });
    } catch {
      setError("Could not reach OrangeCat — try again shortly.");
      setState({ phase: "published", orangecatProjectId: ocId });
    }
  }

  async function toggleAutopost() {
    const next = autopost !== true;
    setAutopostBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/user-projects/${projectId}/publish-orangecat`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ autopost: next }),
      });
      if (!res.ok) throw new Error("rejected");
      setAutopost(next);
    } catch {
      setError("Could not change the activity setting — try again shortly.");
    } finally {
      setAutopostBusy(false);
    }
  }

  if (state.phase === "loading" || state.phase === "unavailable") return null;

  if (state.phase === "published" || state.phase === "unpublishing") {
    const busy = state.phase === "unpublishing";
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <a
          href={`https://orangecat.ch/projects/${state.orangecatProjectId}`}
          target="_blank"
          rel="noreferrer"
          className="ui-btn-ghost min-h-11 gap-1.5"
          title="Published on OrangeCat — view public page"
          aria-label="View on OrangeCat"
        >
          <Cat className="h-4 w-4 text-accent-text" aria-hidden /> Published
        </a>
        {/* Publishing was one-way until 2026-09-11. The way back belongs next
            to the way out, not in a settings page the publisher never sees. */}
        <button
          type="button"
          onClick={() => void unpublish()}
          disabled={busy}
          className="ui-btn-text-cancel min-h-11 gap-1.5 text-xs"
          title="Set the OrangeCat project back to draft — it stops being public, and nothing is deleted"
        >
          {busy ? "Taking it down…" : "Take it down"}
        </button>
        {/* The feed, as its own decision. Three states, because "nobody has
            chosen" is not "off": an unanswered question reads as an invitation
            and an explicit no is respected without being asked again. */}
        <button
          type="button"
          onClick={() => void toggleAutopost()}
          disabled={autopostBusy}
          className="ui-btn-text-cancel min-h-11 gap-1.5 text-xs"
          aria-pressed={autopost === true}
          title={
            autopost === true
              ? "Every closed run and changelog entry is posted to this project's OrangeCat page as it happens. Click to stop — the page stays up."
              : "Nothing about this project's build activity is being posted. Click to start showing funders what gets built, and when."
          }
        >
          {autopostBusy
            ? "Saving…"
            : autopost === true
              ? "Activity: posting"
              : autopost === false
                ? "Activity: paused"
                : "Show build activity?"}
        </button>
        {error && <span className="ui-error-xs">{error}</span>}
      </span>
    );
  }

  if (state.phase === "unlinked") {
    return (
      <button
        type="button"
        onClick={() => {
          window.location.href =
            "/sign-in?callbackUrl=" + encodeURIComponent(window.location.pathname);
        }}
        className="ui-btn-ghost min-h-11 gap-1.5"
        title="Publish to OrangeCat — connect your OrangeCat account first"
        aria-label="Connect OrangeCat to publish"
      >
        <Cat className="h-4 w-4" aria-hidden /> Publish
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={publish}
      disabled={state.phase === "publishing"}
      className="ui-btn-ghost min-h-11 gap-1.5"
      title="Publish to OrangeCat — a public page that can be funded, and shows what gets built as it happens. The activity half can be paused afterwards without taking the page down."
      aria-label="Publish to OrangeCat"
    >
      <Cat
        className={`h-4 w-4 ${state.phase === "publishing" ? "animate-pulse" : ""}`}
        aria-hidden
      />
      {state.phase === "publishing" ? "Publishing…" : "Publish"}
    </button>
  );
}
