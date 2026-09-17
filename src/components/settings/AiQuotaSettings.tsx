"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Gauge, Loader2, RefreshCw } from "lucide-react";
import type { QuotaRowView } from "@/lib/ai/quota-view";

/**
 * What is left at each AI vendor, and what happens when it runs out.
 *
 * The rule this panel is built to: a number that does not imply an action is
 * decoration. So no row shows a bare percentage. Each says what is left in
 * answers, when it comes back, and which provider takes over — because "78%"
 * tells you nothing you can do and "about 40 answers, then it moves to
 * OpenRouter" tells you whether to care.
 *
 * Three states, never two. A vendor nobody has called today is UNKNOWN, drawn
 * differently from both full and empty. Rendering it full repeats the bug that
 * made a vendor's own usage endpoint useless — it reported an untouched
 * allowance while the key was locked out — and rendering it empty invents an
 * outage.
 */

type SpendRow = { feature: string; tokens: number; calls: number };

type QuotaResponse = {
  summary: string;
  providers: QuotaRowView[];
  configured: { provider: string; model: string }[];
  spend: SpendRow[];
  spendTotal: number;
};

export function AiQuotaSettings() {
  const [data, setData] = useState<QuotaResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // `alive` rather than a plain fetch-and-set: a reply that lands after the tab
  // is closed would otherwise set state on an unmounted component. The flag is
  // also what keeps the effect body free of a synchronous setState, which is
  // the shape react-hooks/set-state-in-effect exists to prevent.
  const [reloads, setReloads] = useState(0);

  useEffect(() => {
    let alive = true;
    void (async () => {
      try {
        const res = await fetch("/api/ai/quota");
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = (await res.json()) as QuotaResponse;
        if (!alive) return;
        setData(body);
        setError(null);
      } catch {
        // Say what failed AND what it does not mean. A reader must be able to
        // tell "we could not look" from "there is nothing left" — the whole
        // point of the three states this panel draws.
        if (alive) {
          setError("Could not read the providers just now — this says nothing about your quota.");
        }
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
    <section className="ui-settings-section">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-medium text-text-primary">AI capacity</h2>
          <p className="-mt-1 text-sm text-text-secondary">
            Every answer runs on a free tier. This is what each provider last told us was left —
            read from the replies themselves, not by asking the vendor, because at least one
            vendor&apos;s own usage page reports a full tank while the key is locked out.
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          className="ui-btn-ghost min-h-8 shrink-0 gap-1.5 px-2 text-xs"
          disabled={loading}
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`}
            aria-hidden="true"
          />
          Refresh
        </button>
      </div>

      {loading && !data && (
        <p className="flex items-center gap-2 text-sm text-text-muted" role="status">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Reading providers
        </p>
      )}

      {error && <p className="ui-error text-sm">{error}</p>}

      {data && (
        <>
          <div className="ui-quota-summary">
            <Gauge className="h-4 w-4 shrink-0 text-accent-text" aria-hidden="true" />
            <span>{data.summary}</span>
          </div>

          <div className="space-y-2">
            {data.providers.map((p) => (
              <QuotaRow key={`${p.provider}:${p.model}`} row={p} />
            ))}
          </div>

          {data.providers.length === 0 && (
            <p className="text-sm text-text-muted">
              No AI provider keys are configured, so Loki has nothing to answer with.
            </p>
          )}

          <SpendToday spend={data.spend} total={data.spendTotal} />

          <p className="text-xs text-text-muted">
            Counters are recorded from the rate-limit headers on answers already served, so a
            provider only appears once it has served one. Nothing here costs a request to measure.
          </p>
        </>
      )}
    </section>
  );
}

function QuotaRow({ row }: { row: QuotaRowView }) {
  const tone =
    row.state === "exhausted" || row.state === "skipped"
      ? "ui-quota-row-spent"
      : row.urgent
        ? "ui-quota-row-low"
        : "";

  return (
    <div className={`ui-quota-row ${tone}`}>
      <div className="ui-quota-row-head">
        <span className="ui-quota-provider">{row.provider}</span>
        {row.model !== "—" && <span className="ui-quota-model">{row.model}</span>}
        <span className="ui-quota-state">{stateLabel(row)}</span>
      </div>

      {/* A gauge only where there is a ceiling to draw against. An unknown or
          uncapped counter gets no bar rather than a misleading empty one. */}
      {row.level !== null && (
        <div className="ui-quota-track" role="presentation">
          <span
            className={row.state === "exhausted" ? "ui-quota-fill-spent" : "ui-quota-fill"}
            style={{ width: `${Math.round(row.level * 100)}%` }}
          />
        </div>
      )}

      <p className="ui-quota-detail">
        {row.detail}
        {row.refills && <> · back {row.refills}</>}
      </p>
      {/* The counters this vendor also meters, named rather than drawn. Only
          the binding one gets a bar — three bars for one model asked the reader
          to average limits that do not average. */}
      {row.alsoMetered && row.alsoMetered.length > 0 && (
        <p className="ui-quota-detail">also metered: {row.alsoMetered.join(" · ")}</p>
      )}
      {/* Blank when the row above already said the same thing — five identical
          "this is the last link" lines in a column bury the rows that differ. */}
      {row.consequence && (
        <p className="ui-quota-consequence">
          {(row.state === "exhausted" || row.state === "skipped") && (
            <AlertTriangle className="mr-1 inline h-3 w-3" aria-hidden="true" />
          )}
          {row.consequence}
        </p>
      )}
    </div>
  );
}

function stateLabel(row: QuotaRowView): string {
  if (row.state === "unknown") return "not measured";
  // Not "spent". This vendor has capacity and is never reached — the opposite
  // problem, with the opposite fix.
  if (row.state === "skipped") return "never reached";
  // Not "spent" — the tank is not empty, it is under one answer's worth. The
  // number beside this label says so, and a label that contradicts the number
  // next to it is how a dashboard earns the word made-up.
  if (row.shortfall) return "too low";
  if (row.state === "exhausted") return "spent";
  if (row.answers === null) return "available";
  return `~${row.answers.toLocaleString("en-US")} ${row.unitNoun ?? "answers"}`;
}

/**
 * Where today's tokens went.
 *
 * The limits above answer "how much room is left". This answers "what used it",
 * which is the half an operator can act on: a digest that costs more than every
 * chat turn combined is a thing you can move to a cheaper model or run less
 * often, and until now it was invisible.
 *
 * An EMPTY list is drawn as "nothing recorded yet", never as "nothing spent".
 * Those are opposite claims, and the ledger genuinely starts empty each UTC day
 * — same three-state discipline the provider rows already keep.
 */
function SpendToday({ spend, total }: { spend: SpendRow[]; total: number }) {
  if (spend.length === 0) {
    return (
      <div className="ui-settings-section">
        <p className="ui-micro-label">Spent today</p>
        <p className="text-sm text-text-muted">
          Nothing recorded yet today — this fills as features call a model.
        </p>
      </div>
    );
  }

  const widest = Math.max(...spend.map((r) => r.tokens), 1);
  return (
    <div className="ui-settings-section">
      <p className="ui-micro-label">
        Spent today · {total.toLocaleString("en-US")} tokens across {spend.length} feature
        {spend.length === 1 ? "" : "s"}
      </p>
      <div className="space-y-2">
        {spend.map((r) => (
          <div key={r.feature}>
            <div className="ui-quota-row-head">
              <span className="ui-quota-provider">{r.feature}</span>
              <span className="ui-quota-state">
                {r.tokens.toLocaleString("en-US")} tokens · {r.calls} call
                {r.calls === 1 ? "" : "s"}
              </span>
            </div>
            {/* Relative to the heaviest feature, not to a quota: these bars
                compare features with each other, which is the comparison that
                tells you what to change. */}
            <div className="ui-quota-track" role="presentation">
              <span
                className="ui-quota-fill"
                style={{ width: `${Math.max(2, Math.round((r.tokens / widest) * 100))}%` }}
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
