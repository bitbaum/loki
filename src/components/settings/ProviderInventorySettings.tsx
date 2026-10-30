"use client";

import { useEffect, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { getJson } from "@/lib/api/fetch";
import { List, ListRow } from "@/components/ui/list-row";
import { SectionHeading } from "@/components/ui/section-heading";
import { EmptyState } from "@/components/ui/empty-state";
import type { ProviderRunnerView } from "@/app/api/control/providers/route";

type Provider = NonNullable<ProviderRunnerView["providers"]>[number];

/**
 * AI providers: what each builder can actually build with, measured by the
 * builder itself (installed, credential present, a real prompt answered) —
 * one row per provider per builder, with the next thing to do on its line.
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
        Checked on each runner. A provider counts as working only once a real prompt has answered.
      </p>
      {error && <p className="ui-error">{error}</p>}
      {!runners && !error && <EmptyState>Loading…</EmptyState>}
      {runners?.length === 0 && <EmptyState>No runner has reported in yet.</EmptyState>}
      {runners?.map((r) => (
        <div key={r.channel}>
          <p className="ui-life-field-label">
            {r.channel === "cloud" ? "Cloud runner" : "This computer"} · checked{" "}
            {formatDistanceToNow(new Date(r.observedAt), { addSuffix: true })}
          </p>
          {!r.providers ? (
            <p className="text-sm text-text-secondary">
              This runner&apos;s app is older than this list — update it to see its providers.
            </p>
          ) : (
            <List aria-label={r.channel === "cloud" ? "Cloud runner" : "This computer"}>
              {r.providers.map((p) => (
                <ListRow
                  key={p.id}
                  title={p.label}
                  secondary={providerLine(p)}
                  // Amber only where something stopped working; "not installed"
                  // is a fact, not a fault.
                  status={p.quota || (p.probe && !p.probe.ok) ? "warning" : undefined}
                  trailing={p.healthy ? "Working" : undefined}
                />
              ))}
            </List>
          )}
        </div>
      ))}
    </section>
  );
}

/** "Not installed — install it with …" — the state, then what to do about it. */
function providerLine(p: Provider): string {
  const state = statusOf(p);
  const detail =
    p.kind === "gateway" ? null : p.installed ? (p.version ? `version ${p.version}` : null) : null;
  const parts = [state === "Working" ? detail : state, p.nextAction].filter(Boolean);
  return parts.join(" — ") || "Ready";
}

function statusOf(p: Provider): string {
  if (p.quota) return "Out of quota";
  if (p.healthy) return "Working";
  if (p.kind === "cli" && !p.installed) return "Not installed";
  if (p.auth === "none") return "No credential";
  if (p.probe && !p.probe.ok) return "Did not answer a test prompt";
  return "Not tested yet";
}
