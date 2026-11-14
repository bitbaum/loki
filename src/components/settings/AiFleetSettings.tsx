"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ExternalLink, Loader2, Network } from "lucide-react";
import type { FleetUsageView, FleetVendorView } from "@/lib/ai/fleet-usage";
import { SettingsRefresh, SettingsSectionHeader } from "./SettingsSectionHeader";

/**
 * Every app on this server and every AI vendor, today: the operator's card.
 *
 * "This server's free vendors" below it is Loki's own counters. This is the
 * whole server: which vendor answered, which refused and why, and which APPS
 * used it, read from the one log every app writes (lib/ai/fleet-usage.ts).
 * It exists because about $567 went to Google in two days and nobody could
 * say which app had spent it.
 */
type FleetResponse = FleetUsageView & { logConfigured: boolean };

export function AiFleetSettings() {
  const [data, setData] = useState<FleetResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/ai/fleet");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as FleetResponse;
        if (!alive) return;
        setData(body);
        setError(null);
      } catch {
        if (alive)
          setError(
            "Could not read the server's AI use just now. This says nothing about what was used.",
          );
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [reloads]);

  const reload = useCallback(() => {
    setLoading(true);
    setReloads((n) => n + 1);
  }, []);

  return (
    <section className="ui-settings-section" aria-labelledby="fleet-ai-title">
      <SettingsSectionHeader
        id="fleet-ai-title"
        title="Every app on this server"
        lede="Which AI vendor answered today, which did not and why, and which apps used it. Only you see this."
        action={<SettingsRefresh loading={loading} onClick={reload} />}
      />

      {loading && !data && (
        <p className="flex items-center gap-2 text-sm text-text-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reading the server
        </p>
      )}

      {error && <p className="ui-error text-sm">{error}</p>}

      {data && (
        <>
          <div className="ui-quota-summary">
            <Network className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
            <span>
              {data.logConfigured
                ? data.headline
                : "This server is not writing the shared usage log yet, so there is nothing to show. It starts with the next deploy of each app."}
            </span>
          </div>

          <div className="space-y-2">
            {data.vendors.map((v) => (
              <VendorRow key={v.id} vendor={v} />
            ))}
          </div>

          {data.apps.length > 0 && (
            <details className="ui-disclosure">
              <summary className="ui-disclosure-summary">
                <ChevronDown className="ui-disclosure-chevron" aria-hidden="true" />
                <span>By app</span>
                <span className="text-micro text-text-muted">
                  {data.apps.length} app{data.apps.length === 1 ? "" : "s"} today
                </span>
              </summary>
              <div className="ui-disclosure-body space-y-2">
                {data.apps.map((a) => (
                  <div key={a.app} className="ui-quota-row">
                    <div className="ui-quota-row-head">
                      <span className="ui-quota-provider">{a.app}</span>
                      <span className="ui-quota-state">{a.line}</span>
                    </div>
                    {a.vendors.map((p) => (
                      <p key={p.label} className="ui-quota-detail">
                        {p.label}
                        {p.paid ? " (bills per call)" : ""}: {p.line}
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            </details>
          )}

          {data.ownKeyLine && <p className="text-xs text-text-muted">{data.ownKeyLine}</p>}
          <p className="text-xs text-text-muted">{data.coverage}</p>
        </>
      )}
    </section>
  );
}

function VendorRow({ vendor: v }: { vendor: FleetVendorView }) {
  const tone = v.state === "refusing" ? "ui-quota-row-spent" : "";
  return (
    <div className={`ui-quota-row ${tone}`}>
      <div className="ui-quota-row-head">
        <span className="ui-quota-provider">{v.label}</span>
        <span className="ui-quota-model">{v.paid ? "bills per call" : "free"}</span>
        <span className="ui-quota-state">{v.stateLabel}</span>
      </div>
      <p className="ui-quota-detail">
        {v.line}
        {!v.keySet && " · no key on this server"}
      </p>
      {v.apps.length > 0 && (
        <p className="ui-quota-detail">
          Used by: {v.apps.map((a) => `${a.app} (${a.line})`).join(" · ")}
        </p>
      )}
      {v.problem && (
        <p className="ui-quota-detail">
          <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
          Last trouble: {v.problem}
        </p>
      )}
      <p className="ui-quota-consequence">{v.consequence}</p>
      {v.models.length > 1 && (
        <p className="ui-quota-detail">
          By model: {v.models.map((m) => `${m.model} (${m.line})`).join(" · ")}
        </p>
      )}
      {v.consoleUrl && (
        <a
          className="inline-flex min-h-11 items-center gap-1 text-xs text-accent-text underline-offset-2 hover:underline"
          href={v.consoleUrl}
          target="_blank"
          rel="noreferrer"
        >
          Open {v.label}&apos;s own page <ExternalLink className="h-3 w-3" aria-hidden="true" />
        </a>
      )}
    </div>
  );
}
