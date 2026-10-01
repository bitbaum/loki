"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, ChevronDown, X, ExternalLink, Loader2 } from "lucide-react";
import type { FrontierProposalRow } from "@/db/schema";

/** One open self-improvement proposal: a single line (title + score) that opens
 *  to the rationale, the judges, the sources and the Accept (→ roadmap goal) /
 *  Dismiss gate. Seventeen proposals rendered fully expanded were most of
 *  /system's height on a phone, so the reading is opt-in per row. A native
 *  <details> keeps the disclosure out of hydration (see .ui-disclosure). */
export function ProposalRow({ proposal }: { proposal: FrontierProposalRow }) {
  const router = useRouter();
  const [busy, setBusy] = useState<null | "accept" | "dismiss">(null);
  const [error, setError] = useState("");

  async function decide(action: "accept" | "dismiss") {
    setBusy(action);
    setError("");
    try {
      const res = await fetch(`/api/frontier/proposals/${proposal.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      router.refresh();
    } catch {
      setError("Failed — try again");
      setBusy(null);
    }
  }

  return (
    <li>
      <details className="ui-proposal-row">
        <summary className="ui-proposal-summary">
          <span className="ui-proposal-title">{proposal.title}</span>
          <span
            className="ui-badge shrink-0"
            title="consensus score — the lowest across the judge panel"
          >
            {proposal.score}
          </span>
          <ChevronDown className="ui-disclosure-chevron" aria-hidden />
        </summary>
        <div className="ui-proposal-body">
          <p className="text-xs leading-relaxed text-text-secondary">{proposal.rationale}</p>

          {proposal.verifierScores && proposal.verifierScores.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="ui-section-label">judged by</span>
              {proposal.verifierScores.map((v) => (
                <span key={v.model} className="ui-proposal-judge">
                  {v.model} {v.score}
                </span>
              ))}
            </div>
          )}

          {proposal.sourceUrls.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {proposal.sourceUrls.map((url) => (
                <a
                  key={url}
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ui-tap ui-proposal-source"
                >
                  <ExternalLink className="h-3 w-3" /> source
                </a>
              ))}
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="ui-btn-xs ui-btn-primary"
              disabled={busy !== null}
              onClick={() => decide("accept")}
            >
              {busy === "accept" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Check className="h-3 w-3" />
              )}
              Accept → goal
            </button>
            <button
              type="button"
              className="ui-btn-xs ui-btn-ghost"
              disabled={busy !== null}
              onClick={() => decide("dismiss")}
            >
              {busy === "dismiss" ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <X className="h-3 w-3" />
              )}
              Dismiss
            </button>
            {error && <span className="ui-error-xs">{error}</span>}
          </div>
        </div>
      </details>
    </li>
  );
}
