"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { getJson } from "@/lib/api/fetch";
import { List, ListRow } from "@/components/ui/list-row";
import { SectionHeading } from "@/components/ui/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import {
  isRunnerStale,
  isUnused,
  providerPlainLine,
  providerTechnicalDetail,
  runnerName,
} from "@/lib/agents/provider-words";
import type { ProviderRunnerView } from "@/app/api/control/providers/route";

/**
 * AI providers: what each builder can actually build with, measured by the
 * builder itself (installed, credential present, a real prompt answered) —
 * one row per provider per builder, in plain words (provider-words.ts), with
 * the runner's own instruction behind "Technical details".
 *
 * Rows, not a five-column table: the table ran off a phone at "Credential".
 */
export function ProviderInventorySettings() {
  const [runners, setRunners] = useState<ProviderRunnerView[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    getJson<{ runners: ProviderRunnerView[] }>("/api/control/providers")
      .then((d) => setRunners(d.runners))
      .catch(() => setError("Could not load your providers — reload to try again."));
  }, []);

  return (
    <section className="ui-settings-section">
      <SectionHeading title="AI providers" />
      <p className="-mt-1 text-sm text-text-secondary">
        What each computer can build with. A provider counts as working only once it has answered a
        real question.
      </p>
      {error && <p className="ui-error">{error}</p>}
      {!runners && !error && <EmptyState>Loading…</EmptyState>}
      {runners?.length === 0 && <EmptyState>No computer has reported in yet.</EmptyState>}
      {runners?.map((r) => (
        <RunnerProviders key={r.channel} runner={r} />
      ))}
    </section>
  );
}

function RunnerProviders({ runner: r }: { runner: ProviderRunnerView }) {
  const [showAll, setShowAll] = useState(false);
  const name = runnerName(r.channel);
  const checked = formatDistanceToNow(new Date(r.observedAt), { addSuffix: true });

  // An old report is not the current state: seven amber rows "checked 1 day
  // ago" read as seven live faults. Say the one true thing instead.
  if (isRunnerStale(r.observedAt)) {
    return (
      <div>
        <p className="ui-life-field-label">{name}</p>
        <p className="text-sm text-text-secondary">
          {r.channel === "cloud"
            ? `Loki's computer last checked in ${checked}. This list will update when it checks in again.`
            : `Your computer last checked in ${checked}. Open Fleet Runner on it to update this list.`}
        </p>
      </div>
    );
  }

  if (!r.providers) {
    return (
      <div>
        <p className="ui-life-field-label">{name}</p>
        <p className="text-sm text-text-secondary">
          The app on this computer is older than this list. Update it to see its providers.
        </p>
      </div>
    );
  }

  const used = r.providers.filter((p) => !isUnused(p));
  const unused = r.providers.filter((p) => isUnused(p));
  const shown = showAll ? [...used, ...unused] : used;
  const details = r.providers
    .map((p) => ({ label: p.label, detail: providerTechnicalDetail(p) }))
    .filter((d): d is { label: string; detail: string } => !!d.detail);

  return (
    <div className="space-y-2">
      <p className="ui-life-field-label">
        {name} · checked {checked}
      </p>
      {shown.length > 0 ? (
        <List aria-label={name}>
          {shown.map((p) => (
            <ListRow
              key={p.id}
              title={p.label}
              secondary={providerPlainLine(p, r.channel)}
              // Amber only where something stopped working; "not set up" is
              // a fact, not a fault.
              status={p.quota || (p.probe && !p.probe.ok) ? "warning" : undefined}
              trailing={p.healthy ? "Working" : undefined}
            />
          ))}
        </List>
      ) : (
        <p className="text-sm text-text-secondary">No provider is set up here yet.</p>
      )}
      {unused.length > 0 && (
        <button type="button" onClick={() => setShowAll((v) => !v)} className="ui-btn-ghost">
          {showAll ? "Show fewer" : `Show ${unused.length} more not set up`}
        </button>
      )}
      {details.length > 0 && (
        <details className="text-xs text-text-tertiary">
          <summary className="ui-tap cursor-pointer">Technical details</summary>
          <ul className="mt-2 space-y-1">
            {details.map((d) => (
              <li key={d.label} className="wrap-anywhere">
                <span className="font-medium text-text-secondary">{d.label}:</span> {d.detail}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
