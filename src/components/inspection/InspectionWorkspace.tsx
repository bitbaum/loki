/* eslint-disable @next/next/no-img-element -- Authenticated browser evidence is already encoded JPEG; it must not pass through a public image optimizer. */
"use client";

import Link from "next/link";
import { ReviewBrowser } from "./ReviewBrowser";
import { useState, useEffect, useRef } from "react";
import { useLocalNow } from "@/hooks/use-local-now";
import { trackUsage } from "@/lib/usage/track";
import { useFetch } from "@/hooks/use-fetch";
import { postJson, throwApiError } from "@/lib/api/fetch";
import { Composer } from "@/components/composer/Composer";
import { REVIEW_MODES, reviewIsActive, type ReviewMode } from "@/lib/inspection/contract";
import type { publicReview } from "@/db/queries/site-reviews";
import type { SiteReviewEvent } from "@/db/schema/site-reviews";

type Review = ReturnType<typeof publicReview>;
type Feed = { review: Review; events: SiteReviewEvent[] };
export function InspectionWorkspace({
  projectId,
  projectName,
  initialReview,
  hasWebsite,
  hasCode,
}: {
  projectId: string;
  projectName: string;
  initialReview: Review | null;
  hasWebsite: boolean;
  hasCode: boolean;
}) {
  const now = useLocalNow();
  const threadRef = useRef<HTMLDivElement>(null);
  const followThread = useRef(true);
  const [reviewId, setReviewId] = useState(initialReview?.id ?? null);
  const [choosing, setChoosing] = useState(!initialReview);
  const [mode, setMode] = useState<ReviewMode>(hasWebsite ? (hasCode ? "full" : "visual") : "code");
  const [paths, setPaths] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const {
    data,
    error: fetchError,
    refetch,
  } = useFetch<Feed>(reviewId ? `/api/reviews/${reviewId}` : null, {
    intervalMs: reviewId ? 1500 : undefined,
    timeoutMs: 12000,
  });
  const review =
    data?.review.id === reviewId
      ? data.review
      : initialReview?.id === reviewId
        ? initialReview
        : null;
  const events = data?.review.id === reviewId ? data.events : [];
  const active = review ? reviewIsActive(review.status) : false;
  const findings = events.filter((e) => e.kind === "finding");
  const waiting =
    !!review &&
    active &&
    (!review.heartbeatAt ||
      (now?.getTime() ?? new Date(review.heartbeatAt).getTime()) -
        new Date(review.heartbeatAt).getTime() >
        45000);
  const currentComment = events.filter((e) => e.kind === "assistant").at(-1)?.text;
  const paused = review?.status === "paused";
  useEffect(() => {
    trackUsage({ surface: "projects.review", action: "shown", target: "workspace" });
  }, []);
  const lastEventId = events.at(-1)?.id;
  useEffect(() => {
    if (followThread.current && threadRef.current)
      threadRef.current.scrollTop = threadRef.current.scrollHeight;
  }, [lastEventId]);
  const action = async (name: string, body: object) => {
    trackUsage({ surface: "projects.review", action: "tap", target: name });
    setPending(name);
    setError(null);
    try {
      const response = await postJson(`/api/reviews/${reviewId}`, body);
      if (!response.ok) await throwApiError(response, "Could not update the review. Try again.");
      refetch();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect");
      return false;
    } finally {
      setPending(null);
    }
  };
  const start = async () => {
    trackUsage({ surface: "projects.review", action: "tap", target: `start:${mode}` });
    setPending("start");
    setError(null);
    try {
      const response = await postJson(`/api/projects/${projectId}/reviews`, {
        mode,
        paths: paths
          .split(/\n/)
          .map((s) => s.trim())
          .filter(Boolean),
      });
      if (!response.ok) await throwApiError(response, "Could not start the review.");
      const result: { review: Review } = await response.json();
      setReviewId(result.review.id);
      setChoosing(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not start the review");
    } finally {
      setPending(null);
    }
  };
  return (
    <div className="ui-inspection-workspace" data-fc-place="hidden">
      <header className="space-y-4">
        <Link href={`/projects/${projectId}`} className="ui-link inline-flex min-h-11 items-center">
          ← {projectName}
        </Link>
        <div>
          <h1 className="ui-page-title">Review your project</h1>
          {choosing && (
            <p className="mt-2 max-w-xl text-base leading-relaxed text-text-secondary">
              Look through the site with Loki. Pause anywhere, talk it through, and choose what to
              fix.
            </p>
          )}
        </div>
      </header>
      {(error || fetchError) && (
        <div
          role="alert"
          className="rounded-xl border border-status-warning/40 p-4 text-base text-text-primary"
        >
          {error ?? "The review connection was lost. The last saved view is shown."}
          <button className="ui-link ml-3 min-h-11" onClick={refetch}>
            Retry
          </button>
        </div>
      )}
      {choosing ? (
        <section className="ui-project-section" aria-labelledby="review-scope-title">
          <h2 id="review-scope-title" className="text-lg font-semibold">
            What should we check?
          </h2>
          <fieldset className="mt-5 grid gap-3 sm:grid-cols-2">
            <legend className="sr-only">Review scope</legend>
            {(
              Object.entries(REVIEW_MODES) as [ReviewMode, (typeof REVIEW_MODES)[ReviewMode]][]
            ).map(([key, value]) => {
              const unavailable =
                key === "code" ? !hasCode : key === "full" ? !hasWebsite || !hasCode : !hasWebsite;
              return (
                <label key={key} className="ui-inspection-choice">
                  <input
                    type="radio"
                    name="review-mode"
                    value={key}
                    checked={mode === key}
                    onChange={() => setMode(key)}
                    disabled={unavailable}
                  />
                  <span>
                    <strong className="block font-medium">{value.label}</strong>
                    <span className="mt-1 block text-sm leading-relaxed text-text-secondary">
                      {value.description}
                    </span>
                    {unavailable && (
                      <span className="mt-2 block text-sm text-text-secondary">
                        Connect{" "}
                        {key === "code"
                          ? "code"
                          : key === "full"
                            ? "a website and code"
                            : "a website"}{" "}
                        in project settings first.
                      </span>
                    )}
                  </span>
                </label>
              );
            })}
          </fieldset>
          <details className="mt-5">
            <summary className="min-h-11 cursor-pointer py-2 text-sm text-text-secondary">
              Include specific pages
            </summary>
            <label className="block text-sm text-text-secondary" htmlFor="review-paths">
              Optional paths, one per line. Loki also follows links it discovers.
            </label>
            <textarea
              id="review-paths"
              className="ui-input mt-2 min-h-28 w-full"
              placeholder={"/pricing\n/contact"}
              value={paths}
              onChange={(e) => setPaths(e.target.value)}
            />
          </details>
          <p className="mt-5 max-w-2xl text-sm leading-relaxed text-text-secondary">
            The browser opens public pages in a separate session. It follows links and reads pages
            without submitting forms. Sign-in, payments and other actions remain untested. Coverage
            is listed as the review goes.
          </p>
          <div className="mt-5 flex flex-wrap gap-3">
            <button
              className="ui-btn-primary min-h-11"
              disabled={
                !!pending ||
                (mode === "code"
                  ? !hasCode
                  : mode === "full"
                    ? !hasWebsite || !hasCode
                    : !hasWebsite)
              }
              onClick={start}
            >
              {pending === "start" ? "Starting…" : "Start review"}
            </button>
            {review && (
              <button className="ui-btn-secondary min-h-11" onClick={() => setChoosing(false)}>
                Back to review
              </button>
            )}
          </div>
        </section>
      ) : (
        review && (
          <>
            <section className="ui-inspection-controls" aria-label="Review controls">
              <div className="min-w-0">
                <h2 className="font-semibold">{REVIEW_MODES[review.mode].label}</h2>
                <p role="status" className="mt-1 text-sm text-text-secondary">
                  {paused
                    ? review.workerState === "paused"
                      ? "Paused · ready to discuss"
                      : "Pause requested"
                    : waiting
                      ? review.workerState === "queued"
                        ? "Waiting for the engineer to open the browser"
                        : "No recent update · last saved view"
                      : review.status === "running"
                        ? "Reviewing"
                        : review.status === "finished"
                          ? "Review ended · see coverage below"
                          : review.status === "failed"
                            ? "Review interrupted · coverage is incomplete"
                            : review.status === "stopped"
                              ? "Review stopped · progress saved"
                              : "Queued"}
                </p>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {active ? (
                  <>
                    <button
                      className="ui-btn-primary min-h-11"
                      disabled={!!pending}
                      onClick={() =>
                        action(paused ? "resume" : "pause", { action: paused ? "resume" : "pause" })
                      }
                    >
                      {paused ? "Resume" : "Pause"}
                    </button>
                    <button
                      className="ui-btn-ghost min-h-11"
                      disabled={!!pending}
                      onClick={() => action("stop", { action: "stop" })}
                    >
                      End review
                    </button>
                  </>
                ) : (
                  <button className="ui-btn-secondary min-h-11" onClick={() => setChoosing(true)}>
                    New review
                  </button>
                )}
              </div>
              {currentComment && (
                <p
                  className="basis-full line-clamp-2 text-base leading-relaxed text-text-primary"
                  aria-live="polite"
                >
                  {currentComment}
                </p>
              )}
            </section>
            <div className="ui-inspection-layout">
              <section className="min-w-0" aria-label="Browser view">
                {review.frame ? (
                  <ReviewBrowser frame={review.frame} />
                ) : (
                  <div className="ui-inspection-empty">
                    <h3 className="text-lg font-medium">
                      {review.mode === "code"
                        ? "Looking at the code"
                        : "The browser will appear here"}
                    </h3>
                    <p className="mt-2 max-w-md text-base leading-relaxed text-text-secondary">
                      {review.mode === "code"
                        ? "Findings will cite the files and code that were actually inspected."
                        : "You’ll see captured browser views as Loki follows links and scrolls. Pause to keep a view on screen."}
                    </p>
                  </div>
                )}
                <details className="ui-project-section mt-5">
                  <summary className="min-h-11 cursor-pointer font-medium">
                    Coverage · {review.coverage.filter((p) => p.result === "visited").length} page
                    views recorded
                  </summary>
                  <p className="mb-4 mt-2 text-sm leading-relaxed text-text-secondary">
                    A visited page is not a fully tested flow. Phone and desktop are listed
                    separately. Unlinked routes and pages behind sign-in may be missing.
                  </p>
                  <ul className="space-y-4">
                    {review.coverage.map((p) => (
                      <li key={`${p.url}:${p.width}`} className="break-words text-sm">
                        <a href={p.url} target="_blank" rel="noreferrer" className="ui-link">
                          {new URL(p.url).pathname}
                        </a>
                        <span className="ml-2 text-text-secondary">
                          {p.width}px · {p.result}
                        </span>
                        <p className="mt-1 leading-relaxed text-text-secondary">{p.detail}</p>
                      </li>
                    ))}
                  </ul>
                  {!review.coverage.length && (
                    <p className="text-sm text-text-secondary">No browser pages recorded yet.</p>
                  )}
                </details>
              </section>
              <section className="min-w-0 space-y-5" aria-labelledby="review-conversation-title">
                <h2 id="review-conversation-title" className="text-lg font-semibold">
                  With Loki
                </h2>
                <div
                  className="ui-inspection-conversation"
                  ref={threadRef}
                  onScroll={(e) => {
                    const el = e.currentTarget;
                    followThread.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
                  }}
                >
                  {events
                    .filter((e) => e.kind !== "finding")
                    .slice(-12)
                    .map((e) => (
                      <div
                        key={e.id}
                        className={e.kind === "user" ? "ui-inspection-user" : "ui-inspection-note"}
                      >
                        <span className="mb-1 block text-sm font-medium text-text-secondary">
                          {e.kind === "user" ? "You" : "Loki"}
                        </span>
                        <p className="whitespace-pre-wrap text-base leading-relaxed">{e.text}</p>
                        {e.kind === "dispatch" && (
                          <Link
                            href={
                              e.runId
                                ? `/projects/${projectId}/watch?run=${e.runId}`
                                : `/projects/${projectId}#activity`
                            }
                            className="ui-link mt-2 inline-flex min-h-11 items-center"
                          >
                            {e.runId ? "Watch the fix →" : "Open activity →"}
                          </Link>
                        )}
                      </div>
                    ))}
                  {!events.length && (
                    <p className="text-base leading-relaxed text-text-secondary">
                      Loki’s observations will appear here. You can ask a question at any time.
                    </p>
                  )}
                </div>
                <Composer
                  onSend={(text) => action("discuss", { action: "discuss", text })}
                  placeholder="Ask about what you see…"
                  ariaLabel="Discuss the review with Loki"
                  attach={false}
                  voice={false}
                  sending={pending === "discuss"}
                  disabled={!!pending}
                  hint={
                    active
                      ? "Sending pauses the review. Resume when you’re ready."
                      : "Talk through the saved review."
                  }
                />
              </section>
            </div>
            <section className="ui-project-section" aria-labelledby="review-findings-title">
              <h2 id="review-findings-title" className="text-lg font-semibold">
                Findings{findings.length ? ` · ${findings.length}` : ""}
              </h2>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                Requesting a fix ends the inspection so the engineer can work. Your findings and
                discussion stay here; start a new review when the fix is ready.
              </p>
              {!findings.length && (
                <p className="mt-3 text-base text-text-secondary">
                  No findings recorded yet. This does not mean everything has passed.
                </p>
              )}
              <div className="mt-4 divide-y divide-border-subtle">
                {findings.map((e) => (
                  <article key={e.id} className="space-y-3 py-5">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-sm capitalize text-text-secondary">
                          {e.finding?.category}
                        </p>
                        <h3 className="mt-1 text-lg font-medium">{e.finding?.title}</h3>
                      </div>
                      <button
                        className="ui-btn-secondary min-h-11"
                        disabled={!!pending || !!e.fixRequestedAt || !!e.runId}
                        onClick={() => action("fix", { action: "fix", eventId: e.id })}
                      >
                        {e.fixRequestedAt || e.runId ? "Fix requested" : "Request fix"}
                      </button>
                    </div>
                    <p className="max-w-3xl text-base leading-relaxed">{e.finding?.detail}</p>
                    <details>
                      <summary className="min-h-11 cursor-pointer py-2 text-sm text-text-secondary">
                        Show evidence
                      </summary>
                      <p className="break-words text-sm text-text-secondary">
                        {e.finding?.location}
                      </p>
                      <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">
                        {e.finding?.evidence}
                      </p>
                      {e.image && (
                        <img
                          src={e.image}
                          alt="Browser evidence recorded with this finding"
                          className="mt-3 max-h-96 max-w-full object-contain"
                        />
                      )}
                    </details>
                  </article>
                ))}
              </div>
            </section>
          </>
        )
      )}
    </div>
  );
}
