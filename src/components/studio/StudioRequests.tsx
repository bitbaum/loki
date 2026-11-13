"use client";
import { useEffect, useRef, useState } from "react";
import { STUDIO, STUDIO_REVIEW, STUDIO_STATUS } from "@/config/studio";
import { timeAgo } from "@/lib/dates";
import type { listStudioRequests, StudioReviewView } from "@/db/queries/studio-requests";

type RequestList = Awaited<ReturnType<typeof listStudioRequests>>;
export function StudioRequests({
  initialRequests,
  initialId,
  projects,
}: {
  initialRequests: RequestList;
  initialId?: string;
  projects: { id: string; name: string }[];
}) {
  const [requests, setRequests] = useState(initialRequests);
  const [id, setId] = useState(initialId ?? initialRequests[0]?.id ?? "");
  const [view, setView] = useState<StudioReviewView | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [revision, setRevision] = useState(0);
  const retries = useRef(new Map<string, string>());
  const detail = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!id) return;
    const controller = new AbortController();
    fetch(`${STUDIO.reviewPath}/${id}`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const body = (await response.json()) as { request?: StudioReviewView; error?: string };
        if (!response.ok || !body.request)
          throw new Error(body.error ?? "Request could not be loaded. Try again.");
        setView(body.request);
      })
      .catch((err: unknown) => {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Try again.");
      });
    return () => controller.abort();
  }, [id, revision]);
  async function submit(event: React.FormEvent<HTMLFormElement>, action: Record<string, unknown>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    const identity = JSON.stringify({ id, ...action });
    const mutationId = retries.current.get(identity) ?? crypto.randomUUID();
    retries.current.set(identity, mutationId);
    try {
      const response = await fetch(`${STUDIO.reviewPath}/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...action, mutationId }),
      });
      const body = (await response.json()) as { ok?: boolean; error?: string };
      if (!response.ok || !body.ok) throw new Error(body.error ?? "Action not saved. Try again.");
      retries.current.delete(identity);
      const list = (await fetch(STUDIO.reviewPath, { cache: "no-store" }).then((r) =>
        r.json(),
      )) as { requests?: RequestList };
      if (list.requests) setRequests(list.requests);
      setRevision((r) => r + 1);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Try again; the form is still here.");
    } finally {
      setBusy(false);
    }
  }
  const value = (form: HTMLFormElement, name: string) => String(new FormData(form).get(name) ?? "");
  const label = (name: string, title: string, textarea = false, initial = "") => (
    <label className="block space-y-2 text-sm text-text-secondary">
      {title}
      {textarea ? (
        <textarea
          name={name}
          className="ui-input min-h-28 w-full text-base"
          required
          maxLength={2000}
          defaultValue={initial}
        />
      ) : (
        <input
          name={name}
          className="ui-input w-full text-base"
          required
          maxLength={2000}
          defaultValue={initial}
        />
      )}
    </label>
  );
  // One primary action per request: "Send reply". Every form here used to
  // end in the same solid button, four on one screen (2026-11-12).
  const send = (title: string, tone: "primary" | "secondary" | "danger" = "secondary") => (
    <button className={`ui-btn-${tone} min-h-11`} disabled={busy}>
      {busy ? "Saving…" : title}
    </button>
  );
  const selected = requests.find((r) => r.id === id);
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="min-w-0 space-y-3">
        {requests.length === 0 && (
          <p className="ui-page-subtitle">
            No studio requests yet. New Bitbaum briefs and partner applications will appear here.
          </p>
        )}
        {requests.map((r) => (
          <button
            key={r.id}
            type="button"
            className="ui-card-shell w-full space-y-2 p-4 text-left"
            aria-pressed={id === r.id}
            onClick={() => {
              setView(null);
              setError("");
              setId(r.id);
              // On a phone the detail sits under the whole list: tapping a
              // card looked like it did nothing (2026-11-12).
              if (window.matchMedia("(max-width: 1023px)").matches)
                detail.current?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            {/* The whole title, two lines at most: slice(0, 70) cut words
                in half ("Checking the partner f"). */}
            <span className="line-clamp-2 break-words font-medium text-text-primary">
              {r.kind === "partner" ? (r.partnerName ?? r.changes) : r.website}
            </span>
            <span className="block text-sm text-text-secondary">
              {STUDIO_STATUS[r.status][0]}
              {r.revoked ? " · Link revoked" : ""} · {timeAgo(new Date(r.updatedAt).getTime())}
            </span>
          </button>
        ))}
      </div>
      <div ref={detail} className="min-w-0 scroll-mt-4 space-y-5 lg:col-span-2">
        {error && (
          <div role="alert" className="ui-error space-y-2">
            <p>{error}</p>
            <button className="ui-btn-secondary" onClick={() => setRevision((r) => r + 1)}>
              Reload request
            </button>
          </div>
        )}
        {id && !view && <p className="ui-page-subtitle">Loading request…</p>}
        {view && (
          <>
            <section className="ui-card-shell space-y-3 p-5">
              <h2 className="text-xl font-semibold text-text-primary">{view.status.title}</h2>
              {/* The studio owner's next step, not the applicant's. */}
              <p className="text-text-secondary">
                {(selected && STUDIO_REVIEW[selected.status]) ?? view.status.next}
              </p>
              <p className="whitespace-pre-wrap break-words text-text-primary">{view.changes}</p>
              {view.website && (
                <a
                  href={view.website}
                  target="_blank"
                  rel="noreferrer"
                  className="block break-all text-accent-text underline"
                >
                  {view.website}
                </a>
              )}
              {view.contact && (
                <p className="break-all text-sm text-text-secondary">
                  Reply address: {view.contact}
                </p>
              )}
              {view.offer && (
                <p className="text-sm text-text-secondary">
                  {view.offer.name} · {view.offer.price} · {view.offer.what}
                </p>
              )}
              {view.revoked && (
                <p className="ui-error">
                  Guest link revoked. This request is still visible to its studio owner.
                </p>
              )}
            </section>
            {view.delivery && (
              <section className="ui-card-shell space-y-3 p-5">
                <h3 className="font-semibold text-text-primary">
                  Preview {view.delivery.version}
                  {view.delivery.accepted ? " · accepted" : ""}
                </h3>
                <p className="whitespace-pre-wrap text-text-secondary">{view.delivery.scope}</p>
                <a
                  className="text-accent-text underline"
                  href={view.delivery.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open preview
                </a>
                {view.fee && (
                  <p className="text-sm text-text-secondary">
                    Fee {view.fee.amount} {view.fee.currency}
                    {view.fee.paidAt
                      ? ` · paid on ${new Date(view.fee.paidAt).toLocaleDateString()}`
                      : view.fee.url
                        ? " · listed in the builder's name on OrangeCat"
                        : " · not listed yet: the builder signs in to Loki with OrangeCat first"}
                    {view.fee.url && (
                      <>
                        {" · "}
                        <a
                          className="text-accent-text underline"
                          href={view.fee.url}
                          target="_blank"
                          rel="noreferrer"
                        >
                          Open on OrangeCat
                        </a>
                      </>
                    )}
                  </p>
                )}
              </section>
            )}
            <section className="ui-card-shell space-y-4 p-5">
              <h3 className="font-semibold text-text-primary">Reply or record the next step</h3>
              <form
                className="space-y-3"
                onSubmit={(e) =>
                  void submit(e, { action: "message", body: value(e.currentTarget, "body") })
                }
              >
                {label("body", "Reply visible in this request", true)}
                {send("Send reply", "primary")}
              </form>
              {!view.partner?.approved && (
                <form
                  className="space-y-3"
                  onSubmit={(e) =>
                    void submit(e, {
                      action: "set_status",
                      status: value(e.currentTarget, "status"),
                      body: value(e.currentTarget, "body"),
                    })
                  }
                >
                  <label className="block space-y-2 text-sm text-text-secondary">
                    Next status
                    <select name="status" className="ui-input w-full">
                      <option value="review">Under review</option>
                      <option value="needs_information">More information needed</option>
                      {view.kind === "website" && (
                        <option value="in_progress">Work in progress</option>
                      )}
                      <option value="closed">Closed</option>
                    </select>
                  </label>
                  {label("body", "Reason and next action", true)}
                  {send("Record next step")}
                </form>
              )}
            </section>
            {view.kind === "website" && !view.revoked && (
              <>
                <section className="ui-card-shell space-y-4 p-5">
                  <h3 className="font-semibold text-text-primary">Publish a preview for review</h3>
                  <form
                    className="space-y-3"
                    onSubmit={(e) =>
                      void submit(e, {
                        action: "publish_preview",
                        expectedVersion: view.delivery?.version ?? 0,
                        previewUrl: value(e.currentTarget, "url"),
                        scope: value(e.currentTarget, "scope"),
                        summary: value(e.currentTarget, "summary"),
                      })
                    }
                  >
                    {label("url", "Preview URL")}
                    {label("scope", "Scope this version asks the customer to accept", true)}
                    {label("summary", "Changes and verification evidence", true)}
                    {send("Publish next preview")}
                  </form>
                </section>
                <section className="ui-card-shell space-y-4 p-5">
                  <h3 className="font-semibold text-text-primary">Internal project</h3>
                  <form
                    className="space-y-3"
                    onSubmit={(e) =>
                      void submit(e, {
                        action: "link_project",
                        projectId: value(e.currentTarget, "project"),
                      })
                    }
                  >
                    <select
                      className="ui-input w-full"
                      name="project"
                      required
                      defaultValue={view.projectId ?? ""}
                    >
                      <option value="">Choose an owned project</option>
                      {projects.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-sm text-text-secondary">
                      Linking keeps the build traceable. It grants no customer or partner project
                      access.
                    </p>
                    {send("Link project")}
                  </form>
                </section>
                {view.target === "partner" && (
                  <section className="ui-card-shell space-y-4 p-5">
                    <h3 className="font-semibold text-text-primary">Assign an approved builder</h3>
                    {view.preferredPartnerId && (
                      <p className="break-all text-sm text-text-secondary">
                        Customer preference: {view.preferredPartnerId}
                      </p>
                    )}
                    <form
                      className="space-y-3"
                      onSubmit={(e) =>
                        void submit(e, {
                          action: "assign_partner",
                          partnerId: value(e.currentTarget, "partner"),
                        })
                      }
                    >
                      <select
                        className="ui-input w-full"
                        name="partner"
                        required
                        defaultValue={view.partnerId ?? ""}
                      >
                        <option value="">Choose a builder application</option>
                        {requests
                          .filter(
                            (r) => r.kind === "partner" && r.status === "approved" && !r.revoked,
                          )
                          .map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.partnerName ?? r.changes.slice(0, 60)}
                            </option>
                          ))}
                      </select>
                      <p className="text-sm text-text-secondary">
                        The server verifies approval, publication consent and current availability
                        before assignment.
                      </p>
                      {view.partnerId && (
                        <p className="text-sm text-text-secondary">
                          {view.builderUserId
                            ? view.projectId
                              ? "The builder holds a seat on the linked project and builds in a Loki of their own, on their own engine."
                              : "The builder has a Loki account. Link a project above and they get a seat on it."
                            : "The builder has no Loki account yet. They sign in with OrangeCat from their portal, and the seat follows."}
                        </p>
                      )}
                      {send("Assign this brief")}
                    </form>
                  </section>
                )}
              </>
            )}
            {view.partner && (
              <section className="ui-card-shell space-y-4 p-5">
                <h3 className="font-semibold text-text-primary">Builder application</h3>
                <p className="text-sm text-text-secondary">
                  Studio approval: {view.partner.approved ? "approved" : "pending"} · Course
                  (optional):{" "}
                  {view.partner.coursePassed
                    ? "passed"
                    : view.partner.assessment
                      ? "evidence to review"
                      : "not taken"}{" "}
                  · Profile: {view.partner.profilePublished ? "published" : "not published"}
                </p>
                <p className="text-sm text-text-secondary">
                  Decide on their work: what they wrote above, the links they gave, and the course
                  evidence if they chose to take it. The course is a credential, never a condition.
                </p>
                {view.partner.assessment ? (
                  <div className="space-y-3">
                    <p className="text-sm text-text-secondary">
                      Course version: {view.partner.assessment.version}
                    </p>
                    {Object.entries(view.partner.assessment.answers).map(([key, answer]) => (
                      <div key={key}>
                        <h4 className="font-medium text-text-primary">{key}</h4>
                        <p className="whitespace-pre-wrap break-words text-text-secondary">
                          {answer}
                        </p>
                      </div>
                    ))}
                    <a
                      className="mr-4 text-accent-text underline"
                      target="_blank"
                      rel="noreferrer"
                      href={view.partner.assessment.projectUrl}
                    >
                      Capstone preview
                    </a>
                    <a
                      className="text-accent-text underline"
                      target="_blank"
                      rel="noreferrer"
                      href={view.partner.assessment.sourceUrl}
                    >
                      Source and check evidence
                    </a>
                  </div>
                ) : (
                  <p className="text-text-secondary">
                    No course evidence: they have not taken the optional course.
                  </p>
                )}
                {view.partner.assessment && !view.partner.coursePassed && (
                  <form
                    className="space-y-3"
                    onSubmit={(e) =>
                      void submit(e, {
                        action: "review_course",
                        passed: value(e.currentTarget, "result") === "passed",
                        body: value(e.currentTarget, "body"),
                      })
                    }
                  >
                    <select name="result" className="ui-input w-full">
                      <option value="needs_information">Request better evidence</option>
                      <option value="passed">Pass the course</option>
                    </select>
                    {label("body", "Assessment against the course rubric", true)}
                    {send("Record course review")}
                  </form>
                )}
                {!view.revoked && (
                  // Two buttons that say what they do. A select pre-set to
                  // "Approve this builder" over "Record builder decision"
                  // hid which way the button would go (2026-11-12).
                  <form
                    className="space-y-3"
                    onSubmit={(e) => {
                      const submitter = (e.nativeEvent as SubmitEvent).submitter;
                      void submit(e, {
                        action: submitter?.getAttribute("value") ?? "decline_partner",
                        body: value(e.currentTarget, "body"),
                      });
                    }}
                  >
                    {label("body", "Studio decision and reasons (they receive this)", true)}
                    <DecisionButtons approved={view.partner.approved} busy={busy} />
                  </form>
                )}
                {view.partner.profile && (
                  <div className="space-y-2">
                    <p className="text-text-primary">
                      {view.partner.profile.name} · {view.partner.profile.headline}
                    </p>
                    <p className="text-sm text-text-secondary">
                      {view.partner.profile.rate} · {view.partner.profile.availability}
                    </p>
                    <a
                      className="break-all text-accent-text underline"
                      href={view.partner.profile.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {view.partner.profile.url}
                    </a>
                    {view.partner.approved && !view.partner.profilePublished && (
                      <form onSubmit={(e) => void submit(e, { action: "publish_profile" })}>
                        {send("Approve and publish proposed profile")}
                      </form>
                    )}
                  </div>
                )}
              </section>
            )}
            <section className="ui-card-shell space-y-3 p-5">
              <h3 className="font-semibold text-text-primary">Request history</h3>
              {view.history.map((h) => (
                <article key={h.id} className="space-y-1">
                  <p className="text-sm text-text-muted">
                    {h.actor} ·{" "}
                    <time
                      dateTime={new Date(h.at).toISOString()}
                      title={new Date(h.at).toLocaleString("en-CH")}
                    >
                      {timeAgo(new Date(h.at).getTime())}
                    </time>
                    {h.version ? ` · version ${h.version}` : ""}
                  </p>
                  <p className="whitespace-pre-wrap break-words text-text-secondary">{h.body}</p>
                </article>
              ))}
            </section>
            {!view.revoked && (
              <form
                className="ui-card-shell space-y-3 p-5"
                onSubmit={(e) => void submit(e, { action: "revoke_access" })}
              >
                <RevokeConfirm />
                {send("Stop their link", "danger")}
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The partner decision as two buttons that say what they do (the form reads which was pressed). */
function DecisionButtons({ approved, busy }: { approved: boolean; busy: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {!approved && (
        <button
          name="result"
          value="approve_partner"
          className="ui-btn-secondary min-h-11"
          disabled={busy}
        >
          {busy ? "Saving…" : "Approve builder"}
        </button>
      )}
      <button
        name="result"
        value="decline_partner"
        className="ui-btn-secondary min-h-11"
        disabled={busy}
      >
        {busy ? "Saving…" : approved ? "Withdraw approval" : "Decline application"}
      </button>
    </div>
  );
}

/** The confirmation before a guest link stops working; the box is a finger's width. */
function RevokeConfirm() {
  return (
    <label className="flex items-start gap-3 text-sm text-text-secondary">
      <span className="ui-checkbox-hit mt-0.5">
        <input type="checkbox" required />
      </span>
      Stop their link from working. The customer or applicant will no longer be able to open this
      request.
    </label>
  );
}
