"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCircle2, ExternalLink, PackageCheck } from "lucide-react";
import { Card, CardHeader } from "@/components/ui/card";
import { UPDATE_DECISION_LABELS, type UpdateAction } from "@/config/package-updates";
import { compactRelativeDate } from "@/lib/dates";
import type { DecidedUpdate, UpdateCard } from "@/lib/packages/view";
import { PackageUpdateCard } from "./PackageUpdateCard";

type Handled = { update: UpdateCard; chose: string; message: string };

/**
 * Package updates on Approvals: the ones waiting for a person, and — so an
 * answer never just vanishes — what was just done and what was decided lately.
 *
 * An answered card leaves the server's list at once (it no longer needs a
 * decision), and its own message left with it. So the queue keeps what it was
 * told here, above the cards, until the page is left; `recent` is the same
 * record read back from the database, for the next visit.
 */
export function PackageUpdateQueue({
  updates,
  recent = [],
}: {
  updates: UpdateCard[];
  recent?: DecidedUpdate[];
}) {
  const [handled, setHandled] = useState<Handled[]>([]);
  const handledIds = new Set(handled.map((h) => h.update.id));
  const waiting = updates.filter((u) => !handledIds.has(u.id));
  const earlier = recent.filter((r) => !handledIds.has(r.id));
  if (waiting.length === 0 && handled.length === 0 && earlier.length === 0) return null;

  function onHandled(update: UpdateCard, decision: UpdateAction, message: string) {
    setHandled((prev) => [
      { update, chose: UPDATE_DECISION_LABELS[decision], message },
      ...prev.filter((h) => h.update.id !== update.id),
    ]);
  }

  return (
    <div id="package-updates">
      <Card>
        <CardHeader
          icon={PackageCheck}
          title="Package updates"
          right={
            waiting.length > 0 ? (
              <span className="text-xs font-medium text-status-warning">
                {waiting.length} waiting
              </span>
            ) : (
              <span className="text-xs font-medium text-status-positive">All answered</span>
            )
          }
        />
        {waiting.length > 0 && (
          <p className="mb-3 text-sm text-text-secondary">
            Held for you by each project&apos;s update setting. Nothing here merges until you say
            so.
          </p>
        )}

        {handled.length > 0 && (
          <ul className="mb-3 space-y-2" aria-label="Just done">
            {handled.map((h) => (
              <li
                key={h.update.id}
                role="status"
                className="ui-list-row flex items-start gap-3 px-4 py-3"
              >
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-status-positive"
                  aria-hidden
                />
                <div className="min-w-0 space-y-1 text-sm">
                  <p className="wrap-anywhere text-text-primary">
                    <span className="font-medium">{h.chose}</span> · {h.update.projectName}
                    {h.update.bumps.length > 0 &&
                      ` · ${h.update.bumps.map((b) => `${b.name} ${b.from} → ${b.to}`).join(", ")}`}
                  </p>
                  <p className="text-text-secondary">{h.message}</p>
                  <a
                    href={h.update.prUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="ui-link-subtle inline-flex min-h-11 items-center gap-1 text-xs"
                  >
                    Open pull request #{h.update.prNumber} on GitHub
                    <ExternalLink className="h-3 w-3" aria-hidden />
                  </a>
                </div>
              </li>
            ))}
          </ul>
        )}

        {waiting.length > 0 && (
          <div className="space-y-3">
            {waiting.map((u) => (
              <PackageUpdateCard key={u.id} update={u} onHandled={onHandled} />
            ))}
          </div>
        )}

        {earlier.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="ui-micro-label">Answered recently</p>
            <ul className="space-y-2">
              {earlier.map((r) => (
                <li key={r.id} className="ui-list-row space-y-1 px-4 py-3 text-sm">
                  <p className="wrap-anywhere text-text-primary">
                    <span className="font-medium">{r.chose}</span> ·{" "}
                    <Link href={r.projectHref} className="hover:underline">
                      {r.projectName}
                    </Link>{" "}
                    · {r.summary}
                  </p>
                  <p className="text-text-secondary">{r.outcome}</p>
                  <p className="text-xs text-text-tertiary">
                    {compactRelativeDate(r.decidedAt)} ·{" "}
                    <a href={r.prUrl} target="_blank" rel="noreferrer" className="ui-link-subtle">
                      Pull request #{r.prNumber}
                    </a>
                  </p>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>
    </div>
  );
}
