"use client";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Globe, Pencil } from "lucide-react";
import { Composer } from "@/components/composer/Composer";
import { SiteConsultation } from "@/components/public/SiteConsultation";
import { COMMISSION, WEBSITE_MODES, WEBSITE_MODE_IDS, type WebsiteMode } from "@/config/commission";
import { ROUTES } from "@/config/auth";
import { CONSULT_CHECKS, type ConsultCheckId } from "@/config/site-consult";
import { useSiteConsultation } from "@/hooks/use-site-consultation";
import { appendToBrief, extractWebsite, saysMoreThanAddress } from "@/lib/website-from-speech";
import { clearWebsiteDraft, parseWebsiteDraft, saveWebsiteDraft } from "@/lib/website-draft";
import { cn } from "@/lib/utils";

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
 * On "Improve this site", the address alone starts a free consultation
 * (SiteConsultation): Loki reads the live page and says what is costing the
 * owner visitors BEFORE anything is built, and each finding becomes a fix they
 * can keep or drop. That is the moment the visitor sees Loki understood their
 * site — so it comes first, and a build can be nothing more than "fix these".
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
  const [mode, setMode] = useState<WebsiteMode>("refresh");
  const [fixes, setFixes] = useState<ConsultCheckId[] | null>(null);
  const [editingSite, setEditingSite] = useState(false);
  const [ready, setReady] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const requestId = useRef("");

  // Restore a draft: from the studio's handoff link (#brief=…) or from this tab.
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const handoff = location.hash.startsWith("#brief=");
      let raw: string | null = null;
      try {
        raw = handoff
          ? decodeURIComponent(location.hash.slice(7))
          : sessionStorage.getItem(COMMISSION.draftKey);
      } catch {
        /* Storage is optional. */
      }
      const draft = parseWebsiteDraft(raw, handoff);
      if (draft.website !== undefined) setWebsite(draft.website);
      if (draft.changes !== undefined) setChanges(draft.changes);
      if (draft.mode) setMode(draft.mode);
      if (draft.fixes) setFixes(draft.fixes);
      if (draft.requestId) requestId.current = draft.requestId;
      if (handoff) history.replaceState(null, "", location.pathname + location.search);
      setReady(true);
    });
    return () => cancelAnimationFrame(frame);
  }, []);

  const refresh = mode === "refresh";
  const { state: consultState, retry } = useSiteConsultation(website, ready && refresh);
  const report = consultState.status === "ready" ? consultState.consultation : null;
  const found = report?.findings.map((f) => f.id) ?? [];
  const selected = new Set(fixes ?? found);
  const chosen = refresh ? found.filter((id) => selected.has(id)) : [];

  useEffect(() => {
    if (ready) saveWebsiteDraft({ website, changes, requestId: requestId.current, mode, fixes });
  }, [website, changes, mode, fixes, ready]);

  function changeWebsite(next: string) {
    requestId.current = "";
    setFixes(null);
    setWebsite(next.slice(0, COMMISSION.maxWebsite));
  }

  function toggleFix(id: ConsultCheckId) {
    requestId.current = "";
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setFixes(found.filter((f) => next.has(f)));
  }

  /** One thing said or typed: take the address out of it if we have none yet. */
  function hear(text: string): boolean {
    const said = text.trim();
    if (!said) return false;
    requestId.current = "";
    const address = website ? null : extractWebsite(said);
    if (address) changeWebsite(address);
    if (!address || saysMoreThanAddress(said))
      setChanges((prev) => appendToBrief(prev, said, COMMISSION.maxChanges));
    return true;
  }

  async function build() {
    if (sending || !website.trim() || (!changes.trim() && !chosen.length)) return;
    setError("");
    requestId.current ||= crypto.randomUUID();
    saveWebsiteDraft({ website, changes, requestId: requestId.current, mode, fixes });
    if (!signedIn) {
      router.push(`${ROUTES.SIGN_UP}?callbackUrl=${encodeURIComponent(COMMISSION.path)}`);
      return;
    }
    setSending(true);
    try {
      const response = await fetch(COMMISSION.buildPath, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          website,
          changes,
          requestId: requestId.current,
          mode,
          fixes: chosen,
        }),
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
      clearWebsiteDraft();
      router.push(body.projectPath);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Try again; your brief is still here.");
    } finally {
      setSending(false);
    }
  }

  const hasBrief = changes.trim().length > 0 || website.trim().length > 0;
  const needsSite = hasBrief && !website.trim();
  const canBuild = !needsSite && (changes.trim().length > 0 || chosen.length > 0);
  const copy = WEBSITE_MODES[mode];
  const action =
    chosen.length > 0
      ? `${copy.action} — ${chosen.length} ${chosen.length === 1 ? "fix" : "fixes"}`
      : copy.action;
  const handoff = [changes.trim(), ...chosen.map((id) => `- ${CONSULT_CHECKS[id].title}`)]
    .filter(Boolean)
    .join("\n");

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2" role="group" aria-label="What to do with the website">
        {WEBSITE_MODE_IDS.map((id) => (
          <button
            key={id}
            type="button"
            aria-pressed={mode === id}
            onClick={() => {
              requestId.current = "";
              setMode(id);
            }}
            className={cn("ui-chip-toggle", mode === id && "ui-chip-toggle-active")}
          >
            {WEBSITE_MODES[id].label}
          </button>
        ))}
      </div>

      <Composer
        onSend={(text) => hear(text)}
        placeholder={hasBrief ? "Anything else? Say it or type it…" : copy.placeholder}
        ariaLabel="Describe your website and what should change"
        attach={false}
        disabled={!ready || sending}
        hint="Type, or tap the mic and say it — in any language."
      />

      {refresh && (
        <SiteConsultation
          state={consultState}
          selected={selected}
          onToggle={toggleFix}
          onRetry={retry}
        />
      )}

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
                onChange={(e) => changeWebsite(e.target.value)}
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
            {report ? "Anything else you want (optional)" : copy.changesLabel}
          </label>
          <textarea
            id="change-brief-text"
            className="ui-input min-h-24 w-full resize-y text-base"
            rows={Math.min(
              10,
              Math.max(3, changes.split("\n").length + Math.ceil(changes.length / 40)),
            )}
            placeholder={
              report ? "e.g. “Add online booking” — or leave it to the fixes above." : undefined
            }
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
              disabled={sending || !ready || !canBuild}
            >
              {sending ? "Creating your project…" : action}
            </button>
            <span className="text-sm text-text-muted">
              {needsSite
                ? "Add the website address first."
                : !canBuild
                  ? "Pick a fix above, or say what you want."
                  : signedIn
                    ? copy.note
                    : "You sign in next; this brief stays here."}
            </span>
          </div>
        </section>
      )}

      <p className="text-sm text-text-secondary">
        Prefer to hand it to people?{" "}
        <a
          className="ui-public-link"
          href={`${COMMISSION.studioHireUrl}#brief=${encodeURIComponent(JSON.stringify({ website, changes: handoff }))}`}
        >
          Take this brief to the bitbaum studio
        </a>
        .
      </p>
    </div>
  );
}
