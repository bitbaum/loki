"use client";
import { AlertTriangle, CircleCheck, Loader2, RefreshCw } from "lucide-react";
import {
  CONSULT_AREAS,
  CONSULT_SCOPE,
  CONSULT_SEVERITY,
  type ConsultCheckId,
  type ConsultSeverity,
} from "@/config/site-consult";
import type { ConsultState } from "@/hooks/use-site-consultation";
import type { Consultation, Finding } from "@/lib/site-consult/findings";
import { cn } from "@/lib/utils";

const SEVERITY_TAG: Record<ConsultSeverity, string> = {
  urgent: "ui-tag ui-tag-negative",
  improve: "ui-tag ui-tag-warning",
};

/**
 * The consultation, shown before anything is built: a verdict, how the site
 * looks in Google today, what is costing the owner visitors (with the proof
 * Loki saw), and what is already right. Each finding is a row the owner keeps
 * in — or takes out of — the build.
 */
export function SiteConsultation({
  state,
  selected,
  onToggle,
  onRetry,
}: {
  state: ConsultState;
  selected: ReadonlySet<ConsultCheckId>;
  onToggle: (id: ConsultCheckId) => void;
  onRetry: () => void;
}) {
  if (state.status === "idle") return null;
  if (state.status === "loading")
    return (
      <div className="ui-consult-loading" role="status" aria-live="polite">
        <Loader2 className="ui-spinner mt-0.5 shrink-0" aria-hidden />
        <div className="min-w-0">
          <p className="font-medium text-text-primary">
            Looking at <span className="wrap-anywhere">{state.website}</span> the way a new visitor
            and Google do…
          </p>
          <p className="mt-1 text-text-muted">{Object.values(CONSULT_AREAS).join(" · ")}</p>
        </div>
      </div>
    );
  if (state.status === "error")
    return (
      <div className="ui-consult-loading" role="alert">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-text-tertiary" aria-hidden />
        <div className="min-w-0 space-y-2">
          <p className="font-medium text-text-primary">Loki couldn’t read that page.</p>
          <p>{state.error}</p>
          <p className="text-text-muted">
            Check the address, or skip the consultation and just say what you want below.
          </p>
          <button type="button" onClick={onRetry} className="ui-btn-secondary min-h-11">
            <RefreshCw className="h-4 w-4" aria-hidden /> Try again
          </button>
        </div>
      </div>
    );
  return <Report consultation={state.consultation} selected={selected} onToggle={onToggle} />;
}

function Report({
  consultation: c,
  selected,
  onToggle,
}: {
  consultation: Consultation;
  selected: ReadonlySet<ConsultCheckId>;
  onToggle: (id: ConsultCheckId) => void;
}) {
  const groups = (Object.keys(CONSULT_SEVERITY) as ConsultSeverity[])
    .map((severity) => ({ severity, items: c.findings.filter((f) => f.severity === severity) }))
    .filter((g) => g.items.length > 0);
  const path = (() => {
    const url = new URL(c.site.url);
    return url.pathname === "/"
      ? ""
      : ` › ${url.pathname.replace(/^\/|\/$/g, "").replaceAll("/", " › ")}`;
  })();

  return (
    <section className="ui-consult" aria-labelledby="consult-headline">
      <div className="ui-consult-head">
        <div className="min-w-0">
          <div className="ui-public-eyebrow">Free consultation · {c.site.host}</div>
          <h2 id="consult-headline" className="ui-consult-headline">
            {c.headline}
          </h2>
        </div>
      </div>

      <div className="flex flex-wrap gap-2" aria-label="Summary">
        {c.counts.urgent > 0 && (
          <span className={SEVERITY_TAG.urgent}>
            {c.counts.urgent} {CONSULT_SEVERITY.urgent.label.toLowerCase()}
          </span>
        )}
        {c.counts.improve > 0 && (
          <span className={SEVERITY_TAG.improve}>
            {c.counts.improve} {CONSULT_SEVERITY.improve.label.toLowerCase()}
          </span>
        )}
        <span className="ui-tag ui-tag-positive">{c.counts.passed} already right</span>
      </div>

      <div className="space-y-2">
        <div className="ui-change-brief-label">How Google shows you today</div>
        <div className="ui-consult-snippet">
          <div className="ui-consult-snippet-url">
            {c.site.host}
            {path}
          </div>
          {c.site.title ? (
            <div className="ui-consult-snippet-title">{c.site.title}</div>
          ) : (
            <div className="ui-consult-snippet-missing">No title — Google makes one up.</div>
          )}
          {c.site.description ? (
            <p className="ui-consult-snippet-desc">{c.site.description}</p>
          ) : (
            <p className="ui-consult-snippet-missing">
              No description — Google picks a random line from the page.
            </p>
          )}
        </div>
      </div>

      {groups.map((group) => (
        <div key={group.severity} className="ui-consult-group">
          <div className="ui-change-brief-label">{CONSULT_SEVERITY[group.severity].label}</div>
          {group.items.map((finding) => (
            <FindingRow
              key={finding.id}
              finding={finding}
              on={selected.has(finding.id)}
              onToggle={() => onToggle(finding.id)}
            />
          ))}
        </div>
      ))}

      {c.passed.length > 0 && (
        <details className="ui-consult-group">
          <summary className="ui-public-link-standalone min-h-11 cursor-pointer text-sm">
            What is already right ({c.passed.length})
          </summary>
          <ul className="ui-consult-passed">
            {c.passed.map((p) => (
              <li key={p.id} className="flex items-start gap-2">
                <CircleCheck className="mt-0.5 h-4 w-4 shrink-0 text-status-positive" aria-hidden />
                {p.label}
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="ui-consult-scope">{CONSULT_SCOPE}</p>
    </section>
  );
}

function FindingRow({
  finding: f,
  on,
  onToggle,
}: {
  finding: Finding;
  on: boolean;
  onToggle: () => void;
}) {
  return (
    <label className={cn("ui-consult-finding", !on && "ui-consult-finding-off")}>
      <span className="ui-checkbox-hit pt-0.5">
        <input
          type="checkbox"
          checked={on}
          onChange={onToggle}
          className="h-5 w-5 shrink-0"
          aria-describedby={`consult-why-${f.id}`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="ui-consult-finding-title">{f.title}</span>
          <span className="ui-tag ui-tag-neutral">{CONSULT_AREAS[f.area]}</span>
        </span>
        {f.evidence && <span className="ui-consult-evidence block">{f.evidence}</span>}
        <span id={`consult-why-${f.id}`} className="ui-consult-why block">
          {f.why}
        </span>
      </span>
    </label>
  );
}
