import { ShieldAlert, AlertTriangle } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { timeAgo } from "@/lib/dates";
import {
  PROJECT_STAGE_MEANING,
  PROJECT_STAGES,
  resolveProjectStage,
} from "@/lib/constants/statuses";
import { signalHasExpired, type AttrProvenance } from "@/lib/project-signals";
import { HEALTH_SIGNAL_BASE } from "./project-detail-types";
import type { HealthSignalBase, HealthSignalKind } from "./project-detail-types";

export type { HealthSignalKind, AttrProvenance };

export type HealthSignalConfig = HealthSignalBase & { icon: LucideIcon };

const KIND_ICON: Record<HealthSignalKind, LucideIcon> = {
  security: ShieldAlert,
  broken: AlertTriangle,
  deployment: AlertTriangle,
};

/** HEALTH_SIGNAL_BASE + Lucide icons. Add new signals in project-detail-types.ts only. */
export const HEALTH_SIGNAL_CONFIG: HealthSignalConfig[] = HEALTH_SIGNAL_BASE.map((s) => ({
  ...s,
  icon: KIND_ICON[s.kind],
}));

export type HealthSignal = {
  kind: HealthSignalKind;
  label: string;
  value: string;
  /** ISO of the last write, when the caller loaded provenance. */
  updatedAt?: string;
  /** What wrote it — an agent, the UI, an import. */
  source?: string | null;
};

export function getHealthSignals(
  attrs: Record<string, string>,
  meta?: AttrProvenance,
): HealthSignal[] {
  const signals: HealthSignal[] = [];
  for (const cfg of HEALTH_SIGNAL_CONFIG) {
    if (!attrs[cfg.key]) continue;
    if (signalHasExpired(meta, cfg.key)) continue;
    if (cfg.kind === "broken") {
      const count = attrs[cfg.key].split(",").length;
      signals.push({
        kind: cfg.kind,
        label: `${count} broken feature${count > 1 ? "s" : ""}`,
        value: attrs[cfg.key],
        updatedAt: meta?.[cfg.key]?.updatedAt,
        source: meta?.[cfg.key]?.source ?? null,
      });
    } else {
      signals.push({
        kind: cfg.kind,
        label: cfg.label,
        value: attrs[cfg.key],
        updatedAt: meta?.[cfg.key]?.updatedAt,
        source: meta?.[cfg.key]?.source ?? null,
      });
    }
  }
  return signals;
}

// MaturityBar is retired: the score is derived from named checks now — see
// HealthScoreBar (HealthScore.tsx) + computeProjectHealth (lib/project-health.ts).

const STATUS_COLOR_MAP: Record<string, string> = {
  active: "bg-status-positive-subtle text-status-positive border-status-positive/25",
  production: "bg-status-positive-subtle text-status-positive border-status-positive/25",
  live: "bg-status-positive-subtle text-status-positive border-status-positive/25",
  launched: "bg-status-positive-subtle text-status-positive border-status-positive/25",
  planning: "bg-status-warning-subtle text-status-warning border-status-warning/25",
  "pre-launch": "bg-status-warning-subtle text-status-warning border-status-warning/25",
  blueprint: "bg-status-warning-subtle text-status-warning border-status-warning/25",
  early: "bg-status-warning-subtle text-status-warning border-status-warning/25",
  "in-progress": "bg-accent-muted text-accent-text border-accent-primary/25",
  development: "bg-accent-muted text-accent-text border-accent-primary/25",
  paused: "bg-surface-raised text-text-muted border-border-default",
  archived: "bg-surface-raised text-text-muted border-border-default",
  deprecated: "bg-surface-raised text-text-muted border-border-default",
};

export function StatusBadge({ value }: { value: string }) {
  /* Resolve to a real stage, or say the value is not one.

     STATUS_COLOR_MAP keyed on 13 strings and `shortProjectStatus` returned
     null for anything else — so a project whose stage read "Early Stage" or
     "MVP" showed NO badge at all, indistinguishable from a project that had
     never set one. That is the shape George called a hard-coded demo: a
     vocabulary implied by colour, enforced nowhere, silently swallowing what
     it did not recognise.

     PROJECT_STAGE is the vocabulary now. Legacy values map to what they meant;
     anything still unrecognised renders the raw text marked as unrecognised,
     because "this project's stage is a word nobody defined" is a fact the
     operator should see, not a blank. */
  const stage = resolveProjectStage(value);
  const cls = stage
    ? (STATUS_COLOR_MAP[stage] ?? "bg-surface-raised text-text-tertiary border-border-subtle")
    : "bg-surface-raised text-text-muted border-border-subtle border-dashed";
  // The badge is inline-flex; truncate on the outer text node won't add
  // an ellipsis because flex layout doesn't apply text-overflow to anonymous
  // children. Wrap the text in a real span so truncate has a block-like
  // target. Spotted live on Projects mobile: a status like "Strategic
  // planning only - no code, n…" was cutting mid-word with no ellipsis,
  // making the chip look broken.
  //
  // The "Stage" prefix is not decoration. This chip is one word — "Production"
  // — sitting next to the health chip, and a reader has to supply the missing
  // noun themselves. Worse, the app already spends "status" on CI status, run
  // status and agent status, so guessing wrong is easy. One word for this
  // field everywhere: the health check calls it "Stage declared", the editor
  // says "+ stage", and this says Stage.
  return (
    <span
      className={`ui-projects-badge max-w-[180px] overflow-hidden ${cls}`}
      title={
        stage
          ? `Stage: ${stage} — ${PROJECT_STAGE_MEANING[stage]}${
              stage !== value.trim().toLowerCase() ? `\n\nStored as: "${value}"` : ""
            }`
          : `"${value}" is not one of Loki's stages (${PROJECT_STAGES.join(", ")}). Set a stage on the project to make this meaningful.`
      }
    >
      <span className="ui-badge-prefix">Stage</span>
      <span className="truncate">{stage ?? value}</span>
      {/* The badge stops short of claiming a vocabulary it cannot back. A
          dashed border and a "?" say "this is not a stage Loki knows" — which
          is information; rendering nothing was not. */}
      {!stage && <span aria-hidden>?</span>}
    </span>
  );
}

export function HealthBadge({ signal }: { signal: HealthSignal }) {
  const cfg = HEALTH_SIGNAL_CONFIG.find((c) => c.kind === signal.kind)!;
  const Icon = cfg.icon;
  /* An age, because "Security risk" alone is undated and therefore unweighable:
     a note written this morning and one typed in June looked identical, and
     both outranked every other project equally. The row already had this in
     the database and was discarding it.

     Terse on the badge (`· 23d`) and spelled out in the tooltip with the exact
     date and what wrote it — the badge is scanned, the tooltip is read. */
  const relative = signal.updatedAt ? timeAgo(new Date(signal.updatedAt).getTime()) : null;
  /* "· 6mo", not "· 6mo ago". Looked at on production and the full phrase cost
     ~10 characters per badge, which pushed evig's third flag onto a second
     line and shoved the next-step text down with it. "ago" is doing no work
     next to a label that is plainly a timestamp, and the tooltip below still
     spells the whole thing out. */
  const age = relative?.replace(/\s*ago$/, "") ?? null;
  const written = signal.updatedAt
    ? `Noted ${relative}${signal.source ? ` by ${signal.source}` : ""} · ${new Date(
        signal.updatedAt,
      ).toLocaleDateString()}`
    : null;
  return (
    <span
      className={`ui-projects-badge gap-1 ${cfg.badgeCls}`}
      title={written ? `${signal.value}\n\n${written}` : signal.value}
    >
      <Icon className="h-3 w-3 shrink-0" />
      {signal.label}
      {age && <span className="opacity-70">· {age}</span>}
    </span>
  );
}
