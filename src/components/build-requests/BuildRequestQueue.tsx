"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Section } from "@/components/ui/section-heading";
import { BeforeAfter } from "@/components/public/InstantPreview";
import { BUILD_REQUESTS } from "@/config/build-requests";
import { compactRelativeDate } from "@/lib/dates";

export type BuildRequestCard = {
  id: string;
  website: string;
  email: string | null;
  words: string;
  look: { before: string; after: string; summary: string | null } | null;
  status: "waiting" | "building" | "declined";
  previewUrl: string | null;
  accessCode: string | null;
  note: string | null;
  createdAt: string;
};

/**
 * New accounts' builds from /change, waiting for the operator
 * (config/build-requests). Approve starts it as your client work behind a code
 * of its own; Decline tells them, with your note if you write one. Decided
 * ones stay below so an answer never just vanishes.
 */
export function BuildRequestQueue({ requests }: { requests: BuildRequestCard[] }) {
  if (requests.length === 0) return null;
  const waiting = requests.filter((r) => r.status === "waiting");
  return (
    <div id="build-requests" className="scroll-mt-24">
      <Section
        title="Build requests"
        right={
          waiting.length > 0 ? (
            <span className="ui-approvals-count">{waiting.length}</span>
          ) : undefined
        }
      >
        <div className="ui-approvals-list">
          {requests.map((r) => (
            <BuildRequestRow key={r.id} request={r} />
          ))}
        </div>
      </Section>
    </div>
  );
}

function BuildRequestRow({ request: r }: { request: BuildRequestCard }) {
  const router = useRouter();
  const [busy, setBusy] = useState<"approve" | "decline" | null>(null);
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");

  async function decide(decision: "approve" | "decline") {
    setBusy(decision);
    setError("");
    try {
      const res = await fetch(`/api/build-requests/${r.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          decision === "approve" ? { decision } : { decision, note: note.trim() || null },
        ),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? "That did not go through. Try again.");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "That did not go through. Try again.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="ui-approvals-item space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-text-primary">{r.website}</span>
        <span className="text-xs text-text-muted">
          {r.email ?? "no email"} · {compactRelativeDate(r.createdAt)}
        </span>
      </div>
      {r.words && <p className="whitespace-pre-wrap text-sm text-text-secondary">{r.words}</p>}
      {r.look && (
        <div className="space-y-1">
          <BeforeAfter before={r.look.before} after={r.look.after} website={r.website} />
          {r.look.summary && <p className="text-xs text-text-muted">{r.look.summary}</p>}
        </div>
      )}
      {r.status === "waiting" ? (
        <div className="space-y-2">
          {declining && (
            <textarea
              className="ui-input min-h-20 w-full text-sm"
              placeholder="Why not, in a sentence they will read (optional)"
              maxLength={BUILD_REQUESTS.noteMax}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          )}
          <div className="flex flex-wrap gap-2">
            {!declining && (
              <button
                type="button"
                className="ui-btn-primary min-h-11"
                disabled={busy !== null}
                onClick={() => void decide("approve")}
              >
                {busy === "approve" ? "Starting the build…" : "Approve and build"}
              </button>
            )}
            <button
              type="button"
              className="ui-btn-secondary min-h-11"
              disabled={busy !== null}
              onClick={() => (declining ? void decide("decline") : setDeclining(true))}
            >
              {busy === "decline" ? "Declining…" : declining ? "Send the decline" : "Decline"}
            </button>
            {declining && (
              <button
                type="button"
                className="ui-btn-ghost min-h-11"
                disabled={busy !== null}
                onClick={() => setDeclining(false)}
              >
                Cancel
              </button>
            )}
          </div>
          {error && (
            <p role="alert" className="ui-error">
              {error}
            </p>
          )}
        </div>
      ) : r.status === "building" ? (
        <p className="text-sm text-text-secondary">
          Approved.{" "}
          {r.previewUrl ? (
            <>
              Building at{" "}
              <a className="underline" href={r.previewUrl} target="_blank" rel="noreferrer">
                {r.previewUrl}
              </a>
              {r.accessCode ? ` · code ${r.accessCode}` : ""}
            </>
          ) : (
            "Building."
          )}
        </p>
      ) : (
        <p className="text-sm text-text-secondary">Declined{r.note ? `: “${r.note}”` : "."}</p>
      )}
    </div>
  );
}
