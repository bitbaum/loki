"use client";

import { useEffect, useState } from "react";
import { getJson } from "@/lib/api/fetch";
import type { ProviderRunnerView } from "@/app/api/control/providers/route";

/**
 * AI Providers: what each runner can actually build with, measured by the
 * runner itself (installed, credential present, a real probe answered) —
 * one row per provider per runner, with the exact next action.
 */
export function ProviderInventorySettings() {
  const [runners, setRunners] = useState<ProviderRunnerView[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    getJson<{ runners: ProviderRunnerView[] }>("/api/control/providers")
      .then((d) => setRunners(d.runners))
      .catch((e: Error) => setError(e.message));
  }, []);

  return (
    <section className="rounded-lg border p-4">
      <h3 className="text-base font-semibold">AI Providers</h3>
      <p className="text-muted-foreground mb-3 text-sm">
        Measured on each runner. A provider counts as working only after a real prompt answered.
      </p>
      {error && <p className="text-destructive text-sm">{error}</p>}
      {!runners && !error && <p className="text-muted-foreground text-sm">Loading…</p>}
      {runners?.length === 0 && (
        <p className="text-muted-foreground text-sm">No runner has reported yet.</p>
      )}
      {runners?.map((r) => (
        <div key={r.channel} className="mb-4">
          <div className="mb-1 text-sm font-medium">
            {r.channel === "cloud" ? "Cloud builder" : "This computer (Fleet Runner)"}
            <span className="text-muted-foreground ml-2 font-normal">
              seen {new Date(r.observedAt).toLocaleString()}
            </span>
          </div>
          {!r.providers ? (
            <p className="text-muted-foreground text-sm">
              This runner predates the inventory — update it to see providers.
            </p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-muted-foreground text-left">
                <tr>
                  <th className="py-1">Provider</th>
                  <th>Status</th>
                  <th>Installed</th>
                  <th>Credential</th>
                  <th>Next action</th>
                </tr>
              </thead>
              <tbody>
                {r.providers.map((p) => (
                  <tr key={p.id} className="border-t align-top">
                    <td className="py-1">{p.label}</td>
                    <td>{statusOf(p)}</td>
                    <td className="text-muted-foreground">
                      {p.kind === "gateway" ? "gateway" : p.installed ? p.version || "yes" : "no"}
                    </td>
                    <td className="text-muted-foreground">
                      {p.auth === "none" ? "none" : `${p.auth} (${p.authVia})`}
                    </td>
                    <td>{p.nextAction ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      ))}
    </section>
  );
}

function statusOf(p: NonNullable<ProviderRunnerView["providers"]>[number]): string {
  if (p.quota) return "Out of quota";
  if (p.healthy) return "Working";
  if (p.kind === "cli" && !p.installed) return "Not installed";
  if (p.auth === "none") return "No credential";
  if (p.probe && !p.probe.ok) return "Failed probe";
  return "Not yet probed";
}
