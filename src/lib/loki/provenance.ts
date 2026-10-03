/**
 * Loki answer provenance — the SSOT for "where did this answer come from".
 *
 * Pure and client-safe (no server imports), because it is read by both the
 * transcript on /loki and the floating assistant, and written by both API
 * routes. One shape, one reader, one renderer: the failure this closes is a
 * grounding verdict that was computed, returned by the core, and then dropped
 * by one route and ignored by one component, so a flagged answer rendered
 * pixel-identical to a clean one.
 *
 * What the operator sees under an answer, in one line:
 *
 *   gpt-oss-120b · groq · read feedback 5, runs 7 · used list_runs · 2.3s
 *
 * plus, when verification found unsupported claims, an explicit warning with
 * the spans — because "looked checked" is worse than "visibly unchecked".
 */

import { readWork, type WorkStep } from "@/lib/loki/work";

export type LokiVia = "tool-loop" | "gateway" | "groq-fallback";

export type LokiRetrieved = { source: string; count: number };

export type LokiGrounding = {
  checked: boolean;
  ok: boolean;
  factCount: number;
  unsupported: Array<{ kind: string; text: string }>;
};

export type LokiProvenance = {
  via: LokiVia;
  model: string;
  durationMs: number;
  toolsUsed: string[];
  /** The work in turn order — notes and tools (lib/loki/work.ts). Older
   *  messages have none and render the answer alone. */
  work: WorkStep[];
  rounds: number;
  retrieved: LokiRetrieved[];
  grounding: LokiGrounding;
};

/** The keys a route must persist for a reopened thread to show provenance. */
export const PROVENANCE_KEYS = [
  "via",
  "model",
  "durationMs",
  "toolsUsed",
  "work",
  "rounds",
  "retrieved",
  "grounding",
] as const;

/** Copy the provenance keys out of a core response body, for persistence. */
export function pickProvenance(body: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PROVENANCE_KEYS) if (body[key] !== undefined) out[key] = body[key];
  return out;
}

/**
 * Read provenance back from opaque persisted meta. Defensive: meta predates
 * this field on every older message, and each key is validated so a partial
 * or foreign object renders as "no provenance" rather than as a crash.
 */
export function readProvenance(
  meta: Record<string, unknown> | null | undefined,
): LokiProvenance | null {
  if (!meta || typeof meta !== "object") return null;
  const via = meta.via;
  if (via !== "tool-loop" && via !== "gateway" && via !== "groq-fallback") return null;
  const model = typeof meta.model === "string" ? meta.model : "";
  const g = meta.grounding as Partial<LokiGrounding> | undefined;
  const grounding: LokiGrounding = {
    checked: g?.checked === true,
    ok: g?.ok !== false,
    factCount: typeof g?.factCount === "number" ? g.factCount : 0,
    unsupported: Array.isArray(g?.unsupported)
      ? g.unsupported
          .filter((u): u is { kind: string; text: string } =>
            Boolean(
              u && typeof u === "object" && typeof (u as { text?: unknown }).text === "string",
            ),
          )
          .map((u) => ({ kind: String(u.kind ?? ""), text: u.text }))
      : [],
  };
  return {
    via,
    model,
    durationMs: typeof meta.durationMs === "number" ? meta.durationMs : 0,
    toolsUsed: Array.isArray(meta.toolsUsed)
      ? meta.toolsUsed.filter((t): t is string => typeof t === "string")
      : [],
    work: readWork(meta),
    rounds: typeof meta.rounds === "number" ? meta.rounds : 0,
    retrieved: Array.isArray(meta.retrieved)
      ? meta.retrieved
          .filter(
            (r): r is LokiRetrieved =>
              Boolean(r && typeof r === "object") &&
              typeof (r as LokiRetrieved).source === "string" &&
              typeof (r as LokiRetrieved).count === "number",
          )
          .map((r) => ({ source: r.source, count: r.count }))
      : [],
    grounding,
  };
}

/** `loki/groq/openai/gpt-oss-120b` → { model: "gpt-oss-120b", vendor: "groq" }. */
export function splitModelId(model: string): { model: string; vendor: string | null } {
  const parts = model.replace(/^loki\//, "").split("/");
  if (parts.length === 1) return { model: parts[0], vendor: null };
  return { model: parts.slice(1).join("/"), vendor: parts[0] };
}

const VIA_LABEL: Record<LokiVia, string> = {
  "tool-loop": "",
  gateway: "via the OpenClaw gateway (fallback)",
  "groq-fallback": "single-shot fallback (degraded)",
};

/** Human labels for source ids — what was read, in the operator's words. */
const SOURCE_LABEL: Record<string, string> = {
  feedback: "feedback",
  runs: "runs",
  sessions: "active agents",
  alerts: "alerts",
  fleet_status: "fleet status",
  approvals: "approvals",
  goals: "goals",
  habits: "habits",
  commitments: "commitments",
  crew: "crew",
  human_tasks: "assignments",
  captures: "notes",
  people: "people",
  knowledge: "docs",
  economy: "economy",
  projects: "projects",
};

export type ProvenanceLine = {
  /** The one-line summary, segments joined with " · ". */
  segments: string[];
  /** True when the answer must be visibly marked as containing unchecked claims. */
  warn: boolean;
  /** The spans verification could not support, for the warning. */
  unsupported: string[];
};

/** Render provenance as segments the UI joins. Pure; unit-tested. */
export function describeProvenance(p: LokiProvenance): ProvenanceLine {
  const { model, vendor } = splitModelId(p.model);
  const segments: string[] = [];
  if (model) segments.push(model);
  if (vendor) segments.push(vendor);
  const viaLabel = VIA_LABEL[p.via];
  if (viaLabel) segments.push(viaLabel);

  const read = p.retrieved
    .filter((r) => r.count > 0)
    .map((r) => `${SOURCE_LABEL[r.source] ?? r.source} ${r.count}`);
  if (read.length > 0) segments.push(`read ${read.join(", ")}`);
  else if (p.grounding.checked) segments.push(`${p.grounding.factCount} records`);

  if (p.toolsUsed.length > 0) segments.push(`used ${[...new Set(p.toolsUsed)].join(", ")}`);
  if (p.durationMs > 0) segments.push(`${(p.durationMs / 1000).toFixed(1)}s`);
  if (!p.grounding.checked) segments.push("unchecked — no records to verify against");

  const warn = p.grounding.checked && !p.grounding.ok;
  return {
    segments,
    warn,
    unsupported: warn ? p.grounding.unsupported.map((u) => u.text) : [],
  };
}
