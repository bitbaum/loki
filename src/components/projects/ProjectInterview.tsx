"use client";

/**
 * The interview card — five questions, one at a time, before anything is built.
 *
 * "Build it with Loki" used to go straight from a click on OrangeCat to an
 * agent at work, on a brief that was often a single public sentence. This card
 * is the beat in between: Loki reads the page, asks the owner what the page
 * could not say, writes the answers into the profile, and only then starts.
 *
 * One question on screen at a time, on purpose. The same five fields rendered
 * as a form is the thing people do not fill in — the project-brief module was
 * written specifically to avoid asking for mission/customers/stack "field by
 * field". A question you can answer in a sentence and move past is a different
 * act from a form you have to survive.
 *
 * Skipping is always available and never punished: the plan runs on whatever
 * was answered, and an owner in a hurry ends up exactly where they are today.
 */

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, Check, Loader2, MessageCircleQuestion, SkipForward } from "lucide-react";
import { postJson } from "@/lib/api/fetch";
import { INTERVIEW_ANSWER_MAX, type InterviewFieldId } from "@/lib/project-interview";

type Question = {
  id: InterviewFieldId;
  question: string;
  hint: string;
  essential: boolean;
};

export function ProjectInterview({
  projectId,
  needed,
  autoStart = false,
  kickoffHref,
}: {
  projectId: string;
  /** Server-computed needsInterview — whether there are essential gaps to ask about. */
  needed: boolean;
  /** Arrived from an OrangeCat handoff: open the questions without a click. */
  autoStart?: boolean;
  /**
   * Where to go once the answers are saved — the same project page, flagged to
   * start the kickoff. Navigating rather than signalling a sibling is
   * deliberate: the kickoff plans from the profile the server holds, and the
   * server only holds these answers after a round trip. A client-side handoff
   * would race the write and plan from the blanks the interview just filled.
   */
  kickoffHref: string;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(autoStart);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [index, setIndex] = useState(0);
  const [answers, setAnswers] = useState<Partial<Record<InterviewFieldId, string>>>({});
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState("");

  const current = questions?.[index] ?? null;
  const total = questions?.length ?? 0;

  async function load() {
    setLoading(true);
    setError("");
    try {
      const res = await fetch(`/api/projects/${projectId}/interview`);
      const json = (await res.json()) as { questions?: Question[]; error?: string };
      if (!res.ok || !json.questions)
        throw new Error(json.error || "Could not load the questions.");
      setQuestions(json.questions);
      // Nothing to ask — do not sit there as an empty card in the way of work.
      if (json.questions.length === 0) finish({});
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the questions.");
    } finally {
      setLoading(false);
    }
  }

  /** Save what was answered and hand the page over to the kickoff. */
  async function finish(collected: Partial<Record<InterviewFieldId, string>>) {
    setSaving(true);
    setError("");
    try {
      // A fully-skipped interview still posts: the route answers `skipped` and
      // writes nothing, so there is one code path instead of two.
      const res = await postJson(`/api/projects/${projectId}/interview`, { answers: collected });
      const json = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok || !json.ok) throw new Error(json.error || "Could not save your answers.");
      setFinished(true);
      router.replace(kickoffHref);
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save your answers.");
    } finally {
      setSaving(false);
    }
  }

  function advance(value: string | null) {
    if (!current) return;
    const collected =
      value && value.trim() ? { ...answers, [current.id]: value.trim() } : { ...answers };
    setAnswers(collected);
    setDraft("");
    if (index + 1 < total) {
      setIndex(index + 1);
      return;
    }
    void finish(collected);
  }

  // Open once on an OrangeCat arrival. The ref keeps React's double-invoked
  // effects from firing two loads for the same one-shot arrival.
  const autoFired = useRef(false);
  useEffect(() => {
    if (!open || questions || loading || autoFired.current) return;
    autoFired.current = true;
    void load();
    // load() reads only props; the gates above are the whole dependency.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, questions, loading]);

  if (!needed && !open && !finished) return null;

  if (finished) {
    return (
      <section className="ui-card-shell space-y-2 p-4 sm:p-5" aria-live="polite">
        <p className="ui-kicker">Interview</p>
        <p className="flex items-center gap-2 text-sm text-text-secondary">
          <Check className="h-4 w-4 text-status-positive" aria-hidden />
          Saved to the project profile. Everything below builds from it.
        </p>
      </section>
    );
  }

  return (
    <section
      className="ui-card-shell space-y-4 p-4 sm:p-5"
      aria-labelledby="project-interview-title"
    >
      <div className="flex items-start gap-3">
        <MessageCircleQuestion className="mt-0.5 h-5 w-5 shrink-0 text-accent-text" aria-hidden />
        <div className="min-w-0">
          <p className="ui-kicker">Interview</p>
          <h2 id="project-interview-title" className="text-lg font-semibold text-text-primary">
            A few questions first
          </h2>
          {!open && (
            <p className="mt-1 text-sm leading-relaxed text-text-secondary">
              Your public page says what this is. It does not say who it is for or what finished
              looks like — and an agent briefed without those builds the wrong thing well. Five
              questions, skip any of them.
            </p>
          )}
        </div>
      </div>

      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ui-btn-primary min-h-11 gap-2"
        >
          Answer the questions
          <ArrowRight className="h-4 w-4" aria-hidden />
        </button>
      )}

      {open && loading && (
        <p className="flex items-center gap-2 text-sm text-text-secondary">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Reading your page…
        </p>
      )}

      {open && current && (
        <div className="space-y-3">
          <div className="flex items-baseline justify-between gap-3">
            <p className="ui-micro-label">
              Question {index + 1} of {total}
            </p>
            {!current.essential && <span className="ui-badge">optional</span>}
          </div>

          <label htmlFor="project-interview-answer" className="block">
            <span className="block text-base font-medium leading-snug text-text-primary">
              {current.question}
            </span>
            <span className="mt-1 block text-sm text-text-muted">{current.hint}</span>
          </label>

          <textarea
            id="project-interview-answer"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              // Enter sends, Shift+Enter breaks the line. Five questions with a
              // mouse trip between each is the form this exists to not be.
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!saving) advance(draft);
              }
            }}
            rows={3}
            maxLength={INTERVIEW_ANSWER_MAX}
            autoFocus
            disabled={saving}
            className="ui-input w-full min-w-0"
            placeholder="Type your answer…"
          />

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => advance(draft)}
              disabled={saving || !draft.trim()}
              className="ui-btn-primary min-h-11 gap-2"
            >
              {saving ? "Saving…" : index + 1 < total ? "Next" : "Save and start"}
              {!saving && <ArrowRight className="h-4 w-4" aria-hidden />}
            </button>
            <button
              type="button"
              onClick={() => advance(null)}
              disabled={saving}
              className="ui-btn-secondary min-h-11 gap-2"
            >
              <SkipForward className="h-4 w-4" aria-hidden />
              Skip
            </button>
            <button
              type="button"
              onClick={() => void finish(answers)}
              disabled={saving}
              className="ui-btn-ghost min-h-11 text-sm"
            >
              Skip the rest
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="text-sm text-status-negative">{error}</p>
          {/* An error is never a wall. The questions are an improvement to the
              build, not a condition of it — so the build is always one tap away. */}
          <button
            type="button"
            onClick={() => {
              router.replace(kickoffHref);
              router.refresh();
            }}
            className="ui-btn-secondary min-h-11 gap-2"
          >
            Skip to the build
            <ArrowRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}
    </section>
  );
}
