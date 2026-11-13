"use client";

import { AlertTriangle } from "lucide-react";
import { describeProvenance, readProvenance } from "@/lib/loki/provenance";

/**
 * What produced this answer, under the answer.
 *
 * Two jobs, and the second is the important one.
 *
 * 1. Say which model answered, what was read, which tools ran, how long it
 *    took. An operator who can see "read feedback 5, runs 7" knows instantly
 *    whether a thin answer is a thin database or a thin retrieval — and
 *    before this, the only way to find out was to read the server journal.
 *
 * 2. Mark an answer that FAILED verification. The grounding harness has always
 *    computed this and the API has always returned it; the /loki route dropped
 *    it on persist and the floating assistant never read it, so a turn whose
 *    unsupported claims survived the repair pass rendered exactly like a clean
 *    one. That is the precise failure the harness exists to prevent — "being
 *    wrong looked exactly like being right" — reintroduced at the last inch.
 *    The warning is loud on purpose.
 */
export function ProvenanceFooter({ meta }: { meta: Record<string, unknown> | null }) {
  const provenance = readProvenance(meta);
  if (!provenance) return null;
  const { segments, details, warn, unsupported } = describeProvenance(provenance);

  return (
    <>
      {segments.length > 0 && (
        <div className="ui-loki-provenance">
          {segments.map((seg, i) => (
            <span key={`${seg}-${i}`}>
              {i > 0 && <span className="ui-loki-provenance-sep">· </span>}
              {seg}
            </span>
          ))}
          {/* Model, routing and steps: there for whoever wants them, not
              read out under every answer. */}
          {details.length > 0 && (
            <details className="ui-loki-provenance-details">
              <summary className="ui-tap cursor-pointer">Details</summary>
              {details.map((d, i) => (
                <span key={`${d}-${i}`} className="block">
                  {d}
                </span>
              ))}
            </details>
          )}
        </div>
      )}
      {warn && (
        <div className="ui-loki-provenance-warn" role="note">
          <span className="flex items-center gap-1.5">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <strong>Some of this is not backed by your records.</strong>
          </span>
          <span>
            {unsupported.length > 0
              ? `Unsupported: ${unsupported.slice(0, 4).join(", ")}${unsupported.length > 4 ? ` and ${unsupported.length - 4} more` : ""}. Check it before acting on it.`
              : "Check it before acting on it."}
          </span>
        </div>
      )}
    </>
  );
}
