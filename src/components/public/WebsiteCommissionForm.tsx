"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { COMMISSION } from "@/config/commission";
import { ROUTES } from "@/config/auth";
import type { StudioCommissionContract } from "@/lib/studio-commission";

type StudioView = Pick<StudioCommissionContract, "offer" | "availability">;
type Mode = "build" | "studio";
type Draft = { website: string; changes: string; contact: string; mode: Mode; requestId: string };

export function WebsiteCommissionForm({
  signedIn,
  studio,
  requestedPackage,
}: {
  signedIn: boolean;
  studio: StudioView | null;
  requestedPackage: boolean;
}) {
  const router = useRouter();
  const [website, setWebsite] = useState("");
  const [changes, setChanges] = useState("");
  const [contact, setContact] = useState("");
  const [company, setCompany] = useState("");
  const [mode, setMode] = useState<Mode>(requestedPackage ? "studio" : "build");
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState<{ claimPath?: string; closed: boolean } | null>(null);
  const requestId = useRef("");

  useEffect(() => {
    // Restore external browser storage after hydration; server HTML remains
    // deterministic and submission waits until recovery has completed.
    const frame = requestAnimationFrame(() => {
      try {
        const raw = sessionStorage.getItem(COMMISSION.draftKey);
        const draft: Partial<Draft> | null = raw ? (JSON.parse(raw) as Partial<Draft>) : null;
        if (draft) {
          setWebsite(String(draft.website ?? "").slice(0, COMMISSION.maxWebsite));
          setChanges(String(draft.changes ?? "").slice(0, COMMISSION.maxChanges));
          setContact(String(draft.contact ?? "").slice(0, 200));
          if (!requestedPackage && (draft.mode === "studio" || draft.mode === "build"))
            setMode(draft.mode);
          if (typeof draft.requestId === "string") requestId.current = draft.requestId;
        }
      } catch {
        /* Private browsing can disable storage; the form still works. */
      }
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, [requestedPackage]);

  useEffect(() => {
    if (!ready || saved) return;
    try {
      sessionStorage.setItem(
        COMMISSION.draftKey,
        JSON.stringify({ website, changes, contact, mode, requestId: requestId.current }),
      );
    } catch {
      /* Best-effort recovery, never a condition on submitting. */
    }
  }, [website, changes, contact, mode, ready, saved]);

  function editWebsite(value: string) {
    requestId.current = "";
    setWebsite(value);
  }
  function editChanges(value: string) {
    requestId.current = "";
    setChanges(value);
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (sending) return;
    setError("");
    requestId.current ||= crypto.randomUUID();
    const draft: Draft = { website, changes, contact, mode, requestId: requestId.current };
    try {
      sessionStorage.setItem(COMMISSION.draftKey, JSON.stringify(draft));
    } catch {
      /* optional */
    }
    if (mode === "build" && !signedIn) {
      router.push(`${ROUTES.SIGN_IN}?callbackUrl=${encodeURIComponent(COMMISSION.path)}`);
      return;
    }
    if (mode === "studio" && !studio) {
      setError("Current studio terms are unavailable. Try reloading; your brief is saved.");
      return;
    }
    setSending(true);
    try {
      const response = await fetch(
        mode === "build" ? COMMISSION.buildPath : COMMISSION.submitPath,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(
            mode === "build"
              ? { website, changes, requestId: requestId.current }
              : {
                  website,
                  changes,
                  requestId: requestId.current,
                  contact: contact.trim(),
                  company,
                  offerId: studio!.offer.id,
                },
          ),
        },
      );
      const body = (await response.json()) as {
        ok?: boolean;
        error?: string;
        projectPath?: string;
        claimPath?: string;
        availability?: { state: string };
      };
      if (!response.ok || !body.ok)
        throw new Error(
          body.error ?? "The request did not go through. Your brief is still here; try again.",
        );
      if (mode === "build") {
        if (!body.projectPath || !/^\/projects\/[\da-f-]+\/watch$/.test(body.projectPath))
          throw new Error("The project response was incomplete. Try again to resume this request.");
        try {
          sessionStorage.removeItem(COMMISSION.draftKey);
        } catch {
          /* optional */
        }
        router.push(body.projectPath);
      } else {
        setSaved({
          claimPath: body.claimPath?.startsWith("/claim-feedback?token=")
            ? body.claimPath
            : undefined,
          closed: body.availability?.state === "closed",
        });
        try {
          sessionStorage.removeItem(COMMISSION.draftKey);
        } catch {
          /* optional */
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The request did not go through. Try again.");
    } finally {
      setSending(false);
    }
  }

  if (saved)
    return (
      <section className="ui-card-shell space-y-4 p-5 sm:p-6" aria-live="polite">
        <h2 className="text-xl font-semibold text-text-primary">Your request is saved</h2>
        <p className="text-text-secondary">
          {saved.closed
            ? "The studio has your website and changes on its waitlist."
            : "The studio has your website and changes for review."}{" "}
          Scope and timing are agreed before work starts.
        </p>
        {saved.claimPath && (
          <Link href={saved.claimPath} className="ui-btn-primary">
            Track this request
          </Link>
        )}
        <p className="text-sm text-text-muted">
          {contact.trim()
            ? `The reply address is ${contact.trim()}.`
            : "You can attach this request to your account to follow its progress."}
        </p>
      </section>
    );

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
          onChange={(event) => editWebsite(event.target.value)}
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
          placeholder="Make booking easier on phones and add a page for our services…"
          maxLength={COMMISSION.maxChanges}
          required
          value={changes}
          onChange={(event) => editChanges(event.target.value)}
        />
        <p className="text-sm text-text-muted">
          Your own words are enough. You can add details in the project later.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Who should build it?">
        <button
          type="button"
          className={mode === "build" ? "ui-btn-primary" : "ui-btn-ghost"}
          aria-pressed={mode === "build"}
          onClick={() => setMode("build")}
        >
          Build with Loki
        </button>
        <button
          type="button"
          className={mode === "studio" ? "ui-btn-primary" : "ui-btn-ghost"}
          aria-pressed={mode === "studio"}
          onClick={() => setMode("studio")}
        >
          Ask the Bitbaum studio
        </button>
      </div>
      {mode === "build" ? (
        <p className="text-sm text-text-secondary">
          Creates a private project and starts the build on a separate version. Follow the
          agent&apos;s progress and review the result in your project. Source access or a connected
          builder may be needed.
        </p>
      ) : studio ? (
        <div className="space-y-3">
          <p className="font-medium text-text-primary">
            {studio.offer.name} · {studio.offer.price} · {studio.offer.shape}
          </p>
          <p className="text-sm text-text-secondary">{studio.offer.what}</p>
          <p className="text-sm text-text-secondary">{studio.availability.line}</p>
          <p className="text-sm text-text-muted">
            Sending is free. The studio confirms the scope in writing before work starts; additional
            development is quoted separately.
          </p>
          <details>
            <summary className="ui-btn-ghost w-fit">Add a reply address (optional)</summary>
            <label htmlFor="commission-contact" className="mt-3 block text-sm text-text-secondary">
              Email for the studio&apos;s reply
            </label>
            <input
              id="commission-contact"
              className="ui-input mt-2 w-full text-base"
              type="email"
              autoComplete="email"
              maxLength={200}
              value={contact}
              onChange={(event) => setContact(event.target.value)}
            />
          </details>
        </div>
      ) : (
        <p className="text-sm text-text-secondary">
          Current studio terms could not be loaded.{" "}
          <a className="text-accent-text underline" href={COMMISSION.studioHireUrl}>
            See the published rates and waitlist
          </a>
          , or build with Loki.
        </p>
      )}
      <div className="hidden" aria-hidden="true">
        <label htmlFor="commission-company">Company website verification</label>
        <input
          id="commission-company"
          tabIndex={-1}
          autoComplete="off"
          value={company}
          onChange={(event) => setCompany(event.target.value)}
        />
      </div>
      {error && (
        <p role="alert" className="text-sm text-status-warning">
          {error}
        </p>
      )}
      <button
        type="submit"
        className="ui-btn-primary min-h-11 w-full sm:w-auto"
        disabled={sending || !ready || (mode === "studio" && !studio)}
      >
        {sending
          ? "Saving your brief…"
          : mode === "build"
            ? "Build a new version"
            : studio?.availability.state === "closed"
              ? "Send to the studio waitlist"
              : "Send to the studio"}
      </button>
      {mode === "build" && !signedIn && (
        <p className="text-sm text-text-muted">
          Sign in next. Your brief stays here through sign-in.
        </p>
      )}
    </form>
  );
}
