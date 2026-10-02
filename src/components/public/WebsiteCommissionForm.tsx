"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { COMMISSION } from "@/config/commission";
import { ROUTES } from "@/config/auth";
type Draft = { website: string; changes: string; requestId: string };
export function WebsiteCommissionForm({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [website, setWebsite] = useState("");
  const [changes, setChanges] = useState("");
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef("");
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      try {
        const handoff = location.hash.startsWith("#brief=");
        const raw = handoff
          ? decodeURIComponent(location.hash.slice(7))
          : sessionStorage.getItem(COMMISSION.draftKey);
        const draft: Partial<Draft> | null = raw ? (JSON.parse(raw) as Partial<Draft>) : null;
        if (draft) {
          if (typeof draft.website === "string")
            setWebsite(draft.website.slice(0, COMMISSION.maxWebsite));
          if (typeof draft.changes === "string")
            setChanges(draft.changes.slice(0, COMMISSION.maxChanges));
          if (
            !handoff &&
            typeof draft.requestId === "string" &&
            /^[a-f\d-]{36}$/.test(draft.requestId)
          )
            requestId.current = draft.requestId;
        }
        if (handoff) history.replaceState(null, "", location.pathname + location.search);
      } catch {
        /* Storage is optional. */
      }
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try {
      sessionStorage.setItem(
        COMMISSION.draftKey,
        JSON.stringify({ website, changes, requestId: requestId.current }),
      );
    } catch {
      /* optional */
    }
  }, [website, changes, ready]);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    setError("");
    requestId.current ||= crypto.randomUUID();
    try {
      sessionStorage.setItem(
        COMMISSION.draftKey,
        JSON.stringify({ website, changes, requestId: requestId.current }),
      );
    } catch {
      /* optional */
    }
    if (!signedIn) {
      router.push(`${ROUTES.SIGN_IN}?callbackUrl=${encodeURIComponent(COMMISSION.path)}`);
      return;
    }
    setSending(true);
    try {
      const response = await fetch(COMMISSION.buildPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website, changes, requestId: requestId.current }),
      });
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        projectPath?: string;
      };
      if (!response.ok || !body.ok)
        throw new Error(
          body.error ?? "Your brief is still here. Try again to resume this request.",
        );
      if (!body.projectPath || !/^\/projects\/[\da-f-]+\/watch$/.test(body.projectPath))
        throw new Error("The response was incomplete. Retry to resume this request.");
      try {
        sessionStorage.removeItem(COMMISSION.draftKey);
      } catch {
        /* optional */
      }
      router.push(body.projectPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Try again; your brief is still here.");
    } finally {
      setSending(false);
    }
  }
  return (
    <form
      onSubmit={(event) => void submit(event)}
      className="ui-card-shell space-y-5 p-5 sm:p-6"
      aria-label="Website change brief"
    >
      <div className="space-y-2">
        <label htmlFor="commission-website" className="block text-sm font-medium text-text-primary">
          Website address
        </label>
        <input
          id="commission-website"
          className="ui-input w-full text-base"
          type="text"
          inputMode="url"
          autoComplete="url"
          placeholder="your-company.ch"
          maxLength={COMMISSION.maxWebsite}
          required
          value={website}
          onChange={(e) => {
            requestId.current = "";
            setWebsite(e.target.value);
          }}
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="commission-changes" className="block text-sm font-medium text-text-primary">
          What would you like to change?
        </label>
        <textarea
          id="commission-changes"
          className="ui-input min-h-36 w-full resize-y text-base"
          rows={5}
          maxLength={COMMISSION.maxChanges}
          required
          value={changes}
          onChange={(e) => {
            requestId.current = "";
            setChanges(e.target.value);
          }}
        />
        <p className="text-sm text-text-muted">
          Your own words are enough. Add details in the project later.
        </p>
      </div>
      <p className="text-sm text-text-secondary">
        Loki is a free, independent tool. This creates a private project and prepares a separate
        version for review. Source access, a connected builder or your own provider resources may be
        needed.
      </p>
      {error && (
        <p role="alert" className="ui-error">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="ui-btn-primary min-h-11 w-full sm:w-auto"
        disabled={sending || !ready}
      >
        {sending ? "Creating your project…" : "Build a new version"}
      </button>
      {!signedIn && (
        <p className="text-sm text-text-muted">
          Sign in next. Your brief stays here through sign-in.
        </p>
      )}
      <p className="text-sm text-text-secondary">
        Prefer to hire someone?{" "}
        <a
          className="text-accent-text underline"
          href={`${COMMISSION.studioHireUrl}#brief=${encodeURIComponent(JSON.stringify({ website, changes }))}`}
        >
          Take this brief to the bitbaum studio
        </a>
        .
      </p>
    </form>
  );
}
