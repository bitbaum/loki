"use client";

/**
 * Taking the SITE down — separate from deleting the project, because they are
 * different questions, and conflating them is what left live websites behind.
 *
 * Three rules shape this UI, and each one is a decision rather than a style:
 *
 *  1. THE PLAN GATES THE ACTION. The button that does the thing does not exist
 *     until you have seen exactly what it would do. Not disabled — absent. A
 *     destructive control you can reach before reading its consequences is a
 *     control you will one day press by accident.
 *  2. CHANGING THE CHOICE INVALIDATES THE PLAN. Reading the plan for "take it
 *     offline" and then pressing a button that deletes is the exact accident
 *     step 1 exists to prevent, so the plan is bound to the choice that
 *     produced it.
 *  3. THE IRREVERSIBLE ONE IS TYPED, NOT CLICKED. Removing a site from the
 *     server cannot be undone, so it asks for the site's name — the same bar
 *     account deletion already sets by asking for your email.
 */
import { useState } from "react";
import { EyeOff, Loader2, Lock, RotateCcw, Trash2 } from "lucide-react";
import { postJson, throwApiError } from "@/lib/api/fetch";

type Mode = "offline" | "private" | "restore" | "delete";

const MODES: {
  id: Mode;
  label: string;
  detail: string;
  reversible: boolean;
  danger?: boolean;
  icon: typeof EyeOff;
}[] = [
  {
    id: "offline",
    label: "Take it off the internet",
    detail:
      "Stops being served immediately. The code, the server files and the address are all kept.",
    reversible: true,
    icon: EyeOff,
  },
  {
    id: "private",
    label: "Put it behind a password",
    detail:
      "Keeps working for anyone who has the password, and makes the repository private. For showing work in progress.",
    reversible: true,
    icon: Lock,
  },
  {
    id: "restore",
    label: "Publish it again",
    detail: "Undoes either of the two above: the site is served publicly again.",
    reversible: true,
    icon: RotateCcw,
  },
  {
    id: "delete",
    label: "Remove it from the server",
    detail:
      "The service, the address, the files and the port are removed, and the port becomes reusable. The repository is archived, not deleted.",
    reversible: false,
    danger: true,
    icon: Trash2,
  },
];

export function SiteRetirePanel({ projectId, liveUrl }: { projectId: string; liveUrl: string }) {
  // Nothing chosen to begin with: on a live site the first option is "Take
  // it off the internet", and it sat pre-selected (2026-11-12).
  const [mode, setMode] = useState<Mode | null>(null);
  /** The plan, and the mode it was produced for — they travel together. */
  const [plan, setPlan] = useState<{ mode: Mode; text: string } | null>(null);
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState<"plan" | "run" | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const chosen = MODES.find((m) => m.id === mode) ?? null;
  const host = liveUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const siteName = host.split(".")[0];
  const planShown = plan?.mode === mode ? plan.text : null;
  const typedOk = mode !== "delete" || typed.trim() === siteName;

  async function send(confirm: boolean) {
    if (!chosen) return;
    setBusy(confirm ? "run" : "plan");
    setError(null);
    try {
      const res = await postJson(`/api/projects/${projectId}/retire`, { mode: chosen.id, confirm });
      if (!res.ok) await throwApiError(res, "Could not reach the site");
      const body = (await res.json()) as { commandId: string; plan?: string | null };
      if (confirm) {
        setDone(
          chosen.reversible
            ? `Done — ${host} is being updated now. You can undo this from here whenever you like.`
            : `Done — ${host} is being removed from the server now.`,
        );
        setPlan(null);
        setTyped("");
      } else {
        setPlan({
          mode: chosen.id,
          text:
            body.plan ??
            `The server has not answered yet (command ${body.commandId.slice(0, 8)}). Its reply appears in Activity — nothing has happened.`,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the site");
    } finally {
      setBusy(null);
    }
  }

  function choose(next: Mode) {
    setMode(next);
    // Rule 2: a plan belongs to the choice that produced it.
    setPlan(null);
    setTyped("");
    setDone(null);
    setError(null);
  }

  return (
    <section className="space-y-4 border-t border-border-subtle pt-5">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-medium text-text-primary">
          <EyeOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          The live site
        </h3>
        <p className="mt-1 text-xs text-text-tertiary">
          {/* Not "it is public right now": after taking it offline this panel
              is still here, and a line that asserts a state it cannot see
              would be wrong exactly when someone comes back to check. */}
          <span className="font-mono text-text-secondary">{host}</span> — whether this address is
          served, and by whom, is decided here. Deleting the project below does not change it.
        </p>
      </div>

      {/* Step 1 — what should happen to it */}
      <fieldset className="space-y-2">
        <legend className="ui-kicker mb-2">What should happen to it</legend>
        {MODES.map((m) => {
          const Icon = m.icon;
          const active = mode === m.id;
          return (
            <label
              key={m.id}
              className={[
                "flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors",
                active
                  ? "border-accent-primary bg-accent-muted"
                  : "border-border-default bg-surface-base hover:border-border-interactive",
              ].join(" ")}
            >
              <input
                type="radio"
                name="site-retire-mode"
                className="mt-1 h-5 w-5 shrink-0"
                checked={active}
                onChange={() => choose(m.id)}
              />
              <span className="min-w-0 flex-1">
                <span className="flex flex-wrap items-center gap-2">
                  <Icon
                    className={`h-3.5 w-3.5 shrink-0 ${m.danger ? "text-status-negative" : "text-text-tertiary"}`}
                    aria-hidden="true"
                  />
                  <span
                    className={`text-sm font-medium ${m.danger ? "text-status-negative" : "text-text-primary"}`}
                  >
                    {m.label}
                  </span>
                  {/* Plain words: the danger option is already red, and a
                      green tag on three of four options taught the eye to
                      skip colour. */}
                  <span className="text-xs text-text-tertiary">
                    {m.reversible ? "Reversible" : "Permanent"}
                  </span>
                </span>
                <span className="mt-1 block text-xs text-text-tertiary">{m.detail}</span>
              </span>
            </label>
          );
        })}
      </fieldset>

      {/* Step 2 — see it before it happens */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => void send(false)}
          disabled={busy !== null || !chosen}
          className="ui-btn-secondary min-h-11 gap-1.5"
        >
          {busy === "plan" ? (
            <Loader2 className="ui-spinner-xs" aria-hidden="true" />
          ) : (
            <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
          )}
          {planShown ? "Check again" : "Show me exactly what happens"}
        </button>
        {!planShown && (
          <span className="text-xs text-text-tertiary">
            {chosen ? "Nothing happens until you have seen this." : "Pick one above first."}
          </span>
        )}
      </div>

      {planShown && chosen && (
        <div className="space-y-3">
          <h4 className="ui-kicker">
            {chosen.reversible ? "What will happen" : "What will be removed"}
          </h4>
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded-lg border border-border-subtle bg-surface-raised p-3 text-micro leading-relaxed text-text-secondary">
            {planShown}
          </pre>

          {/* Step 3 — confirm, typed when it cannot be undone */}
          {mode === "delete" && (
            <label className="block space-y-1.5">
              <span className="ui-kicker">
                Type <span className="font-mono text-text-secondary">{siteName}</span> to confirm
              </span>
              <input
                className="ui-input w-full sm:max-w-xs"
                value={typed}
                onChange={(e) => setTyped(e.target.value)}
                placeholder={siteName}
                autoComplete="off"
                spellCheck={false}
              />
            </label>
          )}

          <button
            type="button"
            onClick={() => void send(true)}
            disabled={busy !== null || !typedOk}
            className={`min-h-11 gap-1.5 ${chosen.danger ? "ui-btn-danger" : "ui-btn-primary"}`}
          >
            {busy === "run" ? (
              <Loader2 className="ui-spinner-xs" aria-hidden="true" />
            ) : (
              <chosen.icon className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            {chosen.label}
          </button>
        </div>
      )}

      {done && <p className="text-xs text-status-positive">{done}</p>}
      {error && <p className="ui-error-xs">{error}</p>}
    </section>
  );
}
