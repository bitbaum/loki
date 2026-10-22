"use client";

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, ShieldAlert, FlaskConical, FileText, Pause } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { getJson } from "@/lib/api/fetch";
import { handleApplyAdvice } from "@/app/actions";
import { haptic } from "@/lib/haptics";
import { ACTION_COPY } from "@/config/action-copy";
import { NAV } from "@/config/navigation";
import Link from "next/link";
import { ADVICE_AUTO_APPLY_SECONDS } from "@/lib/constants/today";
import { RECOMMENDATION, REPORT_VERDICT, type Recommendation } from "@/lib/actions/advice-rules";
import type { ActionAdvice, AdviceReport } from "@/lib/actions/advisor";

/**
 * The decision popup for one queued action.
 *
 * Replaces "Done / Skip with no context" with: a recommendation, the evidence
 * it rests on, what applying it actually does, the alternatives, and one line
 * of perspective. Safe recommendations (skip — nothing executes) apply
 * themselves on a countdown; dispatch recommendations stay one click, because
 * approving is what lets untrusted visitor text reach an agent.
 */

const AUTO_APPLY_ALL_KEY = "loki.advice.autoApplyAll";

const AUTO_APPLY_EVENT = "loki:advice-auto-apply";

function readAutoApplyAll(): boolean {
  try {
    return localStorage.getItem(AUTO_APPLY_ALL_KEY) === "1";
  } catch {
    return false;
  }
}
function writeAutoApplyAll(on: boolean): void {
  try {
    localStorage.setItem(AUTO_APPLY_ALL_KEY, on ? "1" : "0");
  } catch {
    /* private mode */
  }
  window.dispatchEvent(new Event(AUTO_APPLY_EVENT));
}
/** "storage" only fires in OTHER tabs, so same-tab toggles need their own event. */
function subscribeAutoApplyAll(onChange: () => void): () => void {
  window.addEventListener(AUTO_APPLY_EVENT, onChange);
  window.addEventListener("storage", onChange);
  return () => {
    window.removeEventListener(AUTO_APPLY_EVENT, onChange);
    window.removeEventListener("storage", onChange);
  };
}

const RECOMMENDATION_TAG: Record<Recommendation, { label: string; tone: string }> = {
  [RECOMMENDATION.DISPATCH]: { label: "Dispatch", tone: "ui-tag-positive" },
  [RECOMMENDATION.DISPATCH_TRIMMED]: { label: "Dispatch (trimmed)", tone: "ui-tag-positive" },
  [RECOMMENDATION.SKIP]: { label: "Skip", tone: "ui-tag-neutral" },
  [RECOMMENDATION.REVIEW]: { label: "Read it first", tone: "ui-tag-warning" },
};

const REPORT_TAG = {
  [REPORT_VERDICT.CREDIBLE]: { label: "Real report", tone: "ui-tag-positive", Icon: FileText },
  [REPORT_VERDICT.LOW_SIGNAL]: {
    label: "Test traffic",
    tone: "ui-tag-neutral",
    Icon: FlaskConical,
  },
  [REPORT_VERDICT.STEERING]: {
    label: "Contains a directive",
    tone: "ui-tag-warning",
    Icon: ShieldAlert,
  },
} as const;

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="ui-micro-label mb-1.5">{label}</div>
      {children}
    </div>
  );
}

function ReportItem({ report }: { report: AdviceReport }) {
  const tag = REPORT_TAG[report.verdict];
  const { Icon } = tag;
  return (
    <li className="rounded-md border border-border-subtle bg-surface-base p-2.5">
      <div className="flex items-center gap-2 flex-wrap">
        <span className={`ui-tag ${tag.tone}`}>
          <Icon className="h-3 w-3" />
          {tag.label}
        </span>
        <span className="text-micro text-text-tertiary truncate">{report.source}</span>
      </div>
      {/* Visitor-controlled text: rendered as plain content, never interpreted. */}
      <p className="mt-1.5 text-xs text-text-secondary whitespace-pre-wrap break-words">
        {report.excerpt}
      </p>
      <p className="mt-1 text-micro text-text-tertiary italic">{report.note}</p>
    </li>
  );
}

export function ActionDecisionModal({
  actionId,
  onClose,
}: {
  actionId: string;
  onClose: () => void;
}) {
  const router = useRouter();
  const [advice, setAdvice] = useState<ActionAdvice | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState(false);
  const [seconds, setSeconds] = useState(ADVICE_AUTO_APPLY_SECONDS);
  const [result, setResult] = useState<
    { kind: "dispatched"; projectKey: string } | { kind: "skipped" } | { kind: "deferred" } | null
  >(null);
  // localStorage is an external store: useSyncExternalStore reads it without a
  // mount-effect setState, and gives SSR a defined (opt-out) snapshot so the
  // checkbox never hydrates against a different value than it rendered with.
  const autoApplyAll = useSyncExternalStore(subscribeAutoApplyAll, readAutoApplyAll, () => false);

  useEffect(() => {
    let live = true;
    getJson<{ advice: ActionAdvice }>(`/api/actions/${actionId}/advice`)
      .then((r) => {
        if (live) setAdvice(r.advice);
      })
      .catch(() => {
        if (live) setError("Could not read this action — decide with the buttons on the card.");
      });
    return () => {
      live = false;
    };
  }, [actionId]);

  const apply = useCallback(
    async (option: Recommendation) => {
      haptic();
      setBusy(true);
      try {
        const outcome = await handleApplyAdvice(actionId, option);
        if ("skipped" in outcome) {
          setResult({ kind: "skipped" });
          return;
        }
        if (outcome.error) {
          setError(outcome.error);
          setBusy(false);
          return;
        }
        if (outcome.projectKey) {
          setResult({ kind: "dispatched", projectKey: outcome.projectKey });
          return;
        }
        if (outcome.deferred) {
          setResult({ kind: "deferred" });
          return;
        }
        setResult({ kind: "skipped" });
      } catch {
        setError("Failed to apply — try again.");
        setBusy(false);
      }
    },
    [actionId],
  );

  // Auto-apply. Skip runs itself (rejecting executes nothing). Dispatch only
  // when the operator has explicitly opted in — approving is the step that
  // lets untrusted visitor text reach an agent, so it is opt-in by default.
  const autoEligible =
    !!advice &&
    advice.autoSafe &&
    (advice.recommendation === RECOMMENDATION.SKIP || autoApplyAll) &&
    !held &&
    !busy;

  // Two timers on purpose: one fires the decision, one animates the number.
  // Firing off a single timeout (rather than "apply when the counter hits 0")
  // keeps the state update inside a callback, and means a slow render can
  // never make the grace period silently longer than it says it is.
  useEffect(() => {
    if (!autoEligible || !advice) return;
    const t = setTimeout(() => {
      void apply(advice.recommendation);
    }, ADVICE_AUTO_APPLY_SECONDS * 1000);
    return () => clearTimeout(t);
  }, [autoEligible, apply, advice]);

  useEffect(() => {
    if (!autoEligible) return;
    const i = setInterval(() => setSeconds((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(i);
  }, [autoEligible]);

  if (result) {
    const project = result.kind === "dispatched" ? result.projectKey : null;
    return (
      <Modal
        onClose={() => {
          router.refresh();
          onClose();
        }}
        size="lg"
      >
        <div className="space-y-4 p-1">
          <h2 className="text-base font-semibold text-text-primary">
            {result.kind === "dispatched" && project
              ? ACTION_COPY.dispatch.sent(project)
              : result.kind === "deferred"
                ? ACTION_COPY.dispatch.deferred
                : "Skipped. It is off the queue."}
          </h2>
          <div className="flex flex-col gap-2 sm:flex-row">
            {project && (
              <Link
                href={`${NAV.control.href}?project=${encodeURIComponent(project)}`}
                className="ui-btn-primary min-h-11 justify-center"
              >
                {ACTION_COPY.dispatch.watch}
              </Link>
            )}
            <button
              type="button"
              onClick={() => {
                router.refresh();
                onClose();
              }}
              className="ui-btn-secondary min-h-11 justify-center"
            >
              {ACTION_COPY.dispatch.stay}
            </button>
          </div>
        </div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} size="2xl" padded={false} disableClose={busy}>
      <div className="flex flex-col max-h-[var(--modal-max-height)]">
        {!advice && !error && (
          <div className="p-5 text-sm text-text-secondary">Reading the evidence…</div>
        )}
        {error && !advice && <div className="p-5 ui-box-error">{error}</div>}

        {advice && (
          <>
            <div className="px-5 pt-5 pb-3 border-b border-border-subtle">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`ui-tag ${RECOMMENDATION_TAG[advice.recommendation].tone}`}>
                  <Sparkles className="h-3 w-3" />
                  Recommended: {RECOMMENDATION_TAG[advice.recommendation].label}
                </span>
                <span className="text-micro text-text-tertiary">
                  {advice.confidence} confidence
                </span>
              </div>
              <h2 className="mt-2 text-base md:text-lg font-semibold text-text-primary">
                {advice.headline}
              </h2>
              <p className="mt-0.5 text-xs text-text-tertiary truncate">{advice.title}</p>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              <Section label="What's going on">
                <p className="text-sm text-text-secondary">{advice.background}</p>
              </Section>

              <Section label="If you take the recommendation">
                <p className="text-sm text-text-secondary">{advice.whatHappens}</p>
              </Section>

              {advice.why.length > 0 && (
                <Section label="Why">
                  <ul className="space-y-1">
                    {advice.why.map((r, i) => (
                      <li key={i} className="text-sm text-text-secondary flex gap-2">
                        <span className="text-text-muted">·</span>
                        <span>{r}</span>
                      </li>
                    ))}
                  </ul>
                </Section>
              )}

              <div className="rounded-md border border-border-subtle bg-surface-raised p-3">
                <div className="ui-micro-label mb-1">Worth two seconds</div>
                <p className="text-sm text-text-secondary">{advice.perspective.note}</p>
                <p className="mt-2 text-micro text-text-tertiary italic">
                  {advice.perspective.principle}
                </p>
              </div>

              {/* Evidence last: it is the longest block and the tags above
                  already carry its conclusion, so it is what you scroll TO
                  when you want to check the reasoning, not what you wade
                  through before reaching the decision. */}
              {advice.reports.length > 0 && (
                <Section label={`The evidence (${advice.reports.length})`}>
                  <ul className="space-y-2">
                    {advice.reports.map((r, i) => (
                      <ReportItem key={i} report={r} />
                    ))}
                  </ul>
                </Section>
              )}
            </div>

            <div className="px-5 py-4 border-t border-border-subtle space-y-3">
              {error && <p className="ui-error-xs">{error}</p>}

              {autoEligible && (
                <div className="flex items-center justify-between gap-3">
                  <span className="text-xs text-text-secondary">
                    Applying the recommendation in {seconds}s.
                  </span>
                  <button onClick={() => setHeld(true)} className="ui-btn-secondary text-xs">
                    <Pause className="h-3 w-3" />
                    Hold
                  </button>
                </div>
              )}

              <div className="flex flex-col gap-2">
                {advice.options.map((o) => (
                  <button
                    key={o.id}
                    onClick={() => (o.id === RECOMMENDATION.REVIEW ? onClose() : apply(o.id))}
                    disabled={busy}
                    className={`${o.recommended ? "ui-btn-primary" : "ui-btn-secondary"} justify-start text-left disabled:opacity-50`}
                  >
                    <span className="flex-1 min-w-0">
                      <span className="block text-sm font-medium">{o.label}</span>
                      <span className="block text-micro opacity-80">{o.detail}</span>
                    </span>
                  </button>
                ))}
              </div>

              <label className="flex items-start gap-2 text-micro text-text-tertiary cursor-pointer">
                <input
                  type="checkbox"
                  checked={autoApplyAll}
                  onChange={(e) => writeAutoApplyAll(e.target.checked)}
                  className="mt-0.5"
                />
                <span>
                  Also apply confident <em>dispatch</em> recommendations on their own. Off by
                  default: approving is what lets untrusted visitor text reach an agent, so that one
                  stays your call until you say otherwise.
                </span>
              </label>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
