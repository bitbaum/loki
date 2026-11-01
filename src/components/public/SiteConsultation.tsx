"use client";
import { useEffect, useState } from "react";
import { AlertTriangle, CircleCheck, CircleX, RefreshCw } from "lucide-react";
import { LokiMark } from "@/components/shell/LokiMark";
import {
  CONSULT_AREAS,
  CONSULT_QUESTIONS,
  CONSULT_SCOPE,
  CONSULT_SEVERITY,
  type ConsultCheckId,
  type ConsultQuestionId,
  type ConsultSeverity,
} from "@/config/site-consult";
import type { ConsultState } from "@/hooks/use-site-consultation";
import { consultTalk } from "@/lib/site-consult/advice";
import type { Consultation, Finding } from "@/lib/site-consult/findings";
import { cn } from "@/lib/utils";

const SEVERITY_TAG: Record<ConsultSeverity, string> = {
  urgent: "ui-tag ui-tag-negative",
  improve: "ui-tag ui-tag-warning",
};

/** What Loki says while it reads — real steps of the tour, in order. */
const READING_STEPS = [
  "Opening the homepage…",
  "Following the links a visitor sees first…",
  "Reading each page the way Google does…",
  "Checking it on a phone…",
  "Weighing what costs you visitors…",
];

/**
 * The consultation as a conversation, shown before anything is built.
 *
 * It used to be a printed report: a verdict, a list, a scope line. A person
 * who just named their site wants to be TALKED to — what did you look at,
 * what should I do first, what is fine — so Loki says those things in turn,
 * then lays out every fix as a row the owner keeps or drops, and finishes by
 * asking two one-tap questions whose answers go into the brief. The talk is
 * rules, not a model (lib/site-consult/advice): this page is anonymous.
 */
export function SiteConsultation({
  state,
  selected,
  onToggle,
  onRetry,
  answers,
  onAnswer,
}: {
  state: ConsultState;
  selected: ReadonlySet<ConsultCheckId>;
  onToggle: (id: ConsultCheckId) => void;
  onRetry: () => void;
  answers: Partial<Record<ConsultQuestionId, string>>;
  onAnswer: (question: ConsultQuestionId, option: string | null) => void;
}) {
  if (state.status === "idle") return null;
  if (state.status === "loading") return <Reading website={state.website} />;
  if (state.status === "error")
    return (
      <div className="ui-consult-loading" role="alert">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
        <div className="min-w-0 space-y-2">
          <p className="font-medium text-text-primary">I couldn’t read that site.</p>
          <p>{state.error}</p>
          <p className="text-text-muted">
            Check the address, or skip this and just tell me what you want below.
          </p>
          <button type="button" onClick={onRetry} className="ui-btn-secondary min-h-11">
            <RefreshCw className="h-4 w-4" aria-hidden /> Try again
          </button>
        </div>
      </div>
    );
  return (
    <Talk
      consultation={state.consultation}
      selected={selected}
      onToggle={onToggle}
      answers={answers}
      onAnswer={onAnswer}
    />
  );
}

function Reading({ website }: { website: string }) {
  const [step, setStep] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setStep((s) => Math.min(s + 1, READING_STEPS.length - 1)), 2200);
    return () => clearInterval(id);
  }, []);
  return (
    <div className="ui-consult-talk" role="status" aria-live="polite">
      <LokiSays>
        <p className="font-medium text-text-primary">
          Reading <span className="wrap-anywhere">{website}</span>…
        </p>
        <p key={step} className="ui-consult-reading-step">
          {READING_STEPS[step]}
        </p>
        <span className="ui-chat-typing mt-2" aria-hidden>
          <span />
          <span />
          <span />
        </span>
      </LokiSays>
    </div>
  );
}

function LokiSays({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("ui-consult-turn", className)}>
      <span className="ui-consult-avatar" aria-hidden>
        <LokiMark turns="tiny" size={16} />
      </span>
      <div className="ui-consult-bubble">{children}</div>
    </div>
  );
}

function Talk({
  consultation: c,
  selected,
  onToggle,
  answers,
  onAnswer,
}: {
  consultation: Consultation;
  selected: ReadonlySet<ConsultCheckId>;
  onToggle: (id: ConsultCheckId) => void;
  answers: Partial<Record<ConsultQuestionId, string>>;
  onAnswer: (question: ConsultQuestionId, option: string | null) => void;
}) {
  const talk = consultTalk(c);
  const groups = (Object.keys(CONSULT_SEVERITY) as ConsultSeverity[])
    .map((severity) => ({ severity, items: c.findings.filter((f) => f.severity === severity) }))
    .filter((g) => g.items.length > 0);
  const path = (() => {
    const url = new URL(c.site.url);
    return url.pathname === "/"
      ? ""
      : ` › ${url.pathname.replace(/^\/|\/$/g, "").replaceAll("/", " › ")}`;
  })();
  // One question at a time: the next appears once the one before is answered.
  const open = CONSULT_QUESTIONS.findIndex((q) => !answers[q.id]);
  const shown = open === -1 ? CONSULT_QUESTIONS.length : open + 1;

  return (
    <section className="ui-consult-talk" aria-labelledby="consult-headline">
      <div className="ui-public-eyebrow">Free consultation · {c.site.host}</div>

      <LokiSays>
        <p>{talk.opening}</p>
        {c.pages.length > 1 && (
          <ul className="ui-consult-tour" aria-label="Pages Loki read">
            {c.pages.map((p) => (
              <li
                key={p.url}
                className={cn("ui-consult-page", !p.ok && "ui-consult-page-broken")}
                title={p.ok ? (p.title ?? undefined) : (p.problem ?? undefined)}
              >
                {p.ok ? (
                  <CircleCheck className="h-3.5 w-3.5 shrink-0" aria-hidden />
                ) : (
                  <CircleX className="h-3.5 w-3.5 shrink-0" aria-hidden />
                )}
                <span className="truncate">{p.path === "/" ? "Homepage" : p.path}</span>
                {!p.ok && <span className="sr-only"> (did not open)</span>}
              </li>
            ))}
          </ul>
        )}
      </LokiSays>

      <LokiSays>
        <h2 id="consult-headline" className="ui-consult-headline">
          {c.headline}
        </h2>
        <div className="mt-3 flex flex-wrap gap-2" aria-label="Summary">
          {c.counts.urgent > 0 && (
            <span className={SEVERITY_TAG.urgent}>
              {c.counts.urgent} {CONSULT_SEVERITY.urgent.label.toLowerCase()}
            </span>
          )}
          {c.counts.improve > 0 && (
            <span className={SEVERITY_TAG.improve}>
              {c.counts.improve} {CONSULT_SEVERITY.improve.label.toLowerCase()}
            </span>
          )}
          <span className="ui-tag ui-tag-positive">{c.counts.passed} already right</span>
        </div>
      </LokiSays>

      {talk.firstMove && (
        <LokiSays>
          <p className="ui-consult-advice-kicker">My advice — start here</p>
          <p className="ui-consult-finding-title mt-1">{talk.firstMove.title}</p>
          <p className="ui-consult-why">{talk.firstMove.because}</p>
        </LokiSays>
      )}

      <LokiSays>
        <p>This is how Google shows you today:</p>
        <div className="ui-consult-snippet mt-2">
          <div className="ui-consult-snippet-url">
            {c.site.host}
            {path}
          </div>
          {c.site.title ? (
            <div className="ui-consult-snippet-title">{c.site.title}</div>
          ) : (
            <div className="ui-consult-snippet-missing">No title — Google makes one up.</div>
          )}
          {c.site.description ? (
            <p className="ui-consult-snippet-desc">{c.site.description}</p>
          ) : (
            <p className="ui-consult-snippet-missing">
              No description — Google picks a random line from the page.
            </p>
          )}
        </div>
      </LokiSays>

      {groups.length > 0 && (
        <LokiSays>
          <p>Everything I would fix — each one is in the build unless you take it out:</p>
          <div className="mt-3 space-y-4">
            {groups.map((group) => (
              <div key={group.severity} className="ui-consult-group">
                <div className="ui-change-brief-label">
                  {CONSULT_SEVERITY[group.severity].label}
                </div>
                {group.items.map((finding) => (
                  <FindingRow
                    key={finding.id}
                    finding={finding}
                    on={selected.has(finding.id)}
                    onToggle={() => onToggle(finding.id)}
                  />
                ))}
              </div>
            ))}
          </div>
        </LokiSays>
      )}

      {talk.strengths && (
        <LokiSays>
          <p>{talk.strengths}</p>
          {c.passed.length > 3 && (
            <details className="mt-2">
              <summary className="ui-public-link-standalone min-h-11 cursor-pointer text-sm">
                All {c.passed.length} things that are right
              </summary>
              <ul className="ui-consult-passed">
                {c.passed.map((p) => (
                  <li key={p.id} className="flex items-start gap-2">
                    <CircleCheck
                      className="mt-0.5 h-4 w-4 shrink-0 text-status-positive"
                      aria-hidden
                    />
                    {p.label}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </LokiSays>
      )}

      <LokiSays>
        <p>{talk.handover}</p>
      </LokiSays>

      {CONSULT_QUESTIONS.slice(0, shown).map((q) => {
        const picked = answers[q.id];
        const option = q.options.find((o) => o.id === picked);
        return (
          <div key={q.id} className="space-y-3">
            <LokiSays>
              <p className="font-medium text-text-primary">{q.ask}</p>
              {!option && (
                // One answer per row, the full width of the bubble: as chips
                // they wrapped into a ragged staircase on a phone (2026-10-19).
                <div className="ui-consult-replies" role="group" aria-label={q.ask}>
                  {q.options.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className="ui-consult-reply"
                      onClick={() => onAnswer(q.id, o.id)}
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}
            </LokiSays>
            {option && (
              <div className="ui-consult-you">
                <span className="ui-consult-you-bubble">{option.label}</span>
                <button
                  type="button"
                  className="ui-public-link-standalone min-h-11 text-xs"
                  onClick={() => onAnswer(q.id, null)}
                >
                  Change
                </button>
              </div>
            )}
          </div>
        );
      })}

      {open === -1 && (
        <LokiSays>
          <p>
            Got it. Your brief is below — add anything else in your own words, then start the build.
          </p>
        </LokiSays>
      )}

      <p className="ui-consult-scope">{CONSULT_SCOPE}</p>
    </section>
  );
}

function FindingRow({
  finding: f,
  on,
  onToggle,
}: {
  finding: Finding;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <label className={cn("ui-consult-finding", !on && "ui-consult-finding-off")}>
      <span className="ui-checkbox-hit pt-0.5">
        <input
          type="checkbox"
          checked={on}
          onChange={onToggle}
          className="h-5 w-5 shrink-0"
          aria-describedby={`consult-why-${f.id}`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="ui-consult-finding-title">{f.title}</span>
          <span className="ui-tag ui-tag-neutral">{CONSULT_AREAS[f.area]}</span>
        </span>
        {f.evidence && <span className="ui-consult-evidence block">{f.evidence}</span>}
        <span id={`consult-why-${f.id}`} className="ui-consult-why block">
          {f.why}
        </span>
      </span>
    </label>
  );
}
