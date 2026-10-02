"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Globe, Pencil } from "lucide-react";
import { Composer } from "@/components/composer/Composer";
import { COMMISSION } from "@/config/commission";
import { ROUTES } from "@/config/auth";
import { appendToBrief, extractWebsite } from "@/lib/website-from-speech";

type Draft = { website: string; changes: string; requestId: string };

/**
 * "Change your website", told in your own words — typed or spoken.
 *
 * It used to be two empty boxes (an address, then a textarea) and nothing else:
 * a form to fill in, on a page whose visitor came to SAY what they want. Now
 * it is the fleet's composer (@bitbaum/chatkit through Loki's Composer — the
 * same box, mic and Whisper leg every Loki chat uses), and each thing said
 * joins a brief shown back underneath, so a person can keep talking ("…and add
 * online booking") before anything is built.
 *
 * The address is found in the words (lib/website-from-speech), not asked for first,
 * and not by a model: this page is anonymous, and a stranger's every keystroke
 * must not spend the shared free AI quota. If no address was said, the brief
 * asks for one in one line.
 *
 * Everything after is unchanged and deliberate: the draft survives sign-in
 * (sessionStorage), a resubmit reuses its requestId so it cannot create two
 * projects, and the build goes through the same project + kickoff pipeline
 * (/api/projects/from-website) as every other project.
 */
export function WebsiteChangeBrief({ signedIn }: { signedIn: boolean }) {
  const router = useRouter();
  const [website, setWebsite] = useState("");
  const [changes, setChanges] = useState("");
  const [editingSite, setEditingSite] = useState(false);
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef("");

  // Restore a draft: from the studio's handoff link (#brief=…) or from this tab.
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

  /** One thing said or typed: take the address out of it if we have none yet. */
  function hear(text: string): boolean {
    const said = text.trim();
    if (!said) return false;
    requestId.current = "";
    if (!website) {
      const found = extractWebsite(said);
      if (found) setWebsite(found.slice(0, COMMISSION.maxWebsite));
    }
    setChanges((prev) => appendToBrief(prev, said, COMMISSION.maxChanges));
    return true;
  }

  async function build() {
    if (sending || !website.trim() || !changes.trim()) return;
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

  const hasBrief = changes.trim().length > 0;
  const needsSite = hasBrief && !website.trim();

  return (
    <div className="space-y-4">
      <Composer
        onSend={(text) => hear(text)}
        placeholder={
          hasBrief
            ? "Anything else? Say it or type it…"
            : "e.g. “My site is my-bakery.ch — add online ordering and make it easier to read on a phone.”"
        }
        ariaLabel="Describe your website and what should change"
        attach={false}
        disabled={!ready || sending}
        hint="Type, or tap the mic and say it — in any language."
      />

      {hasBrief && (
        <section className="ui-change-brief" aria-label="Your brief">
          <div className="ui-change-brief-row">
            <Globe className="h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
            {editingSite || needsSite ? (
              <input
                className="ui-input-tight min-w-0 flex-1 text-sm"
                type="text"
                inputMode="url"
                autoComplete="url"
                placeholder="Which website? e.g. my-bakery.ch"
                aria-label="Website address"
                autoFocus={editingSite}
                maxLength={COMMISSION.maxWebsite}
                value={website}
                onChange={(e) => {
                  requestId.current = "";
                  setWebsite(e.target.value);
                }}
                onBlur={() => setEditingSite(false)}
              />
            ) : (
              <>
                <span className="ui-change-brief-site">{website}</span>
                <button
                  type="button"
                  onClick={() => setEditingSite(true)}
                  className="ui-btn-icon"
                  aria-label="Change the website address"
                >
                  <Pencil className="h-3.5 w-3.5" aria-hidden />
                </button>
              </>
            )}
          </div>

          <label htmlFor="change-brief-text" className="ui-change-brief-label">
            What should change
          </label>
          <textarea
            id="change-brief-text"
            className="ui-input min-h-24 w-full resize-y text-base"
            rows={Math.min(
              10,
              Math.max(3, changes.split("\n").length + Math.ceil(changes.length / 40)),
            )}
            maxLength={COMMISSION.maxChanges}
            value={changes}
            onChange={(e) => {
              requestId.current = "";
              setChanges(e.target.value);
            }}
          />

          {error && (
            <p role="alert" className="ui-error">
              {error}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void build()}
              className="ui-btn-primary min-h-11"
              disabled={sending || !ready || needsSite}
            >
              {sending ? "Creating your project…" : "Build a new version"}
            </button>
            <span className="text-sm text-text-muted">
              {needsSite
                ? "Add the website address first."
                : signedIn
                  ? "Your live site is not touched — you review the new version first."
                  : "You sign in next; this brief stays here."}
            </span>
          </div>
        </section>
      )}

      <p className="text-sm text-text-secondary">
        Prefer to hand it to people?{" "}
        <a
          className="ui-public-link"
          href={`${COMMISSION.studioHireUrl}#brief=${encodeURIComponent(JSON.stringify({ website, changes }))}`}
        >
          Take this brief to the bitbaum studio
        </a>
        .
      </p>
    </div>
  );
}
