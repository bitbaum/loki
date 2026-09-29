/**
 * "Watch it work" for a project — the run told as a conversation.
 *
 * Asked for on 2026-09-28: "I'm not sure if I can actually see the chat, just
 * like here in Claude, and watch how things get implemented." What existed was
 * the raw terminal (a TUI on a phone, bytes rather than meaning) and a one-line
 * phase chip. Everything needed to tell the run as a readable thread was
 * already recorded, just never put in one place:
 *
 *   - what YOU asked (prompt_history.resolved_prompt, linked by run id);
 *   - every hop the run declared (run_events: claimed, launched, submitted,
 *     generating, progress, blocked, handoff, closed…);
 *   - what the AGENT said it did at the end (the handoff summary);
 *   - and, while it works, the tail of its screen (a peek, stripped of ANSI).
 *
 * This module is the pure half: it turns those records into the ordered items
 * the page renders, so the wording and the ordering can be tested without a
 * database or a browser. It deliberately collapses the noisy hops — a hundred
 * "progress" heartbeats become one "working" line with the latest time — so the
 * thread reads like a chat, not a log.
 */
import type { RunEventKind } from "@/db/schema/run-events";
import { runEventKindLabel } from "@/lib/feedback/run-step";

export type WatchItem =
  | { type: "you"; at: string; text: string }
  | { type: "step"; at: string; kind: RunEventKind; text: string; tone: "neutral" | "warning" }
  | {
      type: "agent";
      at: string;
      done: string | null;
      next: string | null;
      outcome: string | null;
      commit: string | null;
    };

export type WatchInput = {
  prompt: { text: string; at: Date } | null;
  events: { kind: RunEventKind; detail: Record<string, unknown> | null; createdAt: Date }[];
  run: {
    outcome: string | null;
    finishedAt: Date | null;
    summary: { done?: string; next?: string; commit?: string } | null;
    error?: string | null;
  } | null;
};

/** Hops that say nothing a person needs once the next hop exists. */
const QUIET: ReadonlySet<RunEventKind> = new Set(["recorded", "promoted", "reclassified"]);

const clean = (s: string | undefined | null): string | null => {
  const t = (s ?? "").trim();
  return t && !/^(none|n\/a|-|unknown)$/i.test(t) ? t : null;
};

/** Human wording for one hop, using its detail when that says more. */
function stepText(kind: RunEventKind, detail: Record<string, unknown> | null): string {
  if (kind === "blocked") {
    const reason = typeof detail?.reason === "string" ? detail.reason.trim() : "";
    return reason ? `Needs you — ${reason}` : "Needs you — the agent is waiting for input";
  }
  if (kind === "closed") {
    const outcome = typeof detail?.outcome === "string" ? detail.outcome : null;
    return outcome ? `Run ended (${outcome.replace(/_/g, " ")})` : runEventKindLabel(kind);
  }
  return runEventKindLabel(kind);
}

export function buildWatchTimeline(input: WatchInput): WatchItem[] {
  const items: WatchItem[] = [];
  if (input.prompt?.text.trim()) {
    items.push({ type: "you", at: input.prompt.at.toISOString(), text: input.prompt.text.trim() });
  }

  for (const e of input.events) {
    if (QUIET.has(e.kind)) continue;
    const last = items.at(-1);
    // Heartbeats and repeated "generating" collapse into the line already there.
    if (
      last?.type === "step" &&
      (e.kind === "progress" || e.kind === "generating") &&
      (last.kind === "progress" || last.kind === "generating")
    ) {
      items[items.length - 1] = { ...last, at: e.createdAt.toISOString() };
      continue;
    }
    // The handoff becomes the agent's own message below; a "closed" right after
    // it is the same fact twice.
    if (e.kind === "handoff") continue;
    if (e.kind === "closed" && input.run?.summary) continue;
    items.push({
      type: "step",
      at: e.createdAt.toISOString(),
      kind: e.kind,
      text: stepText(e.kind, e.detail),
      tone: e.kind === "blocked" ? "warning" : "neutral",
    });
  }

  const summary = input.run?.summary ?? null;
  const done = clean(summary?.done);
  const next = clean(summary?.next);
  // Only the agent's OWN words become an agent message. A failure is Loki's to
  // explain (humanizeRunFailure, with the way out beside it); dressing the
  // runner's error up as something the agent said is what the first real
  // Watch showed: "Agent: Dispatch failed before the prompt reached…".
  if (done || next) {
    items.push({
      type: "agent",
      at: (input.run?.finishedAt ?? new Date()).toISOString(),
      done,
      next,
      outcome: input.run?.outcome ?? null,
      commit: clean(summary?.commit),
    });
  }
  return items;
}

// ── Failure, in words ───────────────────────────────────────────────────────

const DISPATCH_PREFIX_RE = /^(?:dispatch failed before the prompt reached the agent:\s*)/i;

/**
 * One plain sentence for why a run stopped, naming the provider the way the
 * person knows it. The runner's text is written for logs ("claude cannot
 * generate because its usage limit is exhausted. Switch this project to…");
 * the page already carries the switch, so the sentence only has to say what
 * happened.
 */
export function humanizeRunFailure(
  error: string | null | undefined,
  providerLabel: string,
  quotaDeath: boolean,
): string {
  if (quotaDeath) return `${providerLabel} has run out of usage for now.`;
  const text = (error ?? "").replace(DISPATCH_PREFIX_RE, "").trim();
  if (!text) return `${providerLabel} stopped before it finished.`;
  const first = text.split(/(?<=[.!?])\s/)[0] ?? text;
  const sentence = first.charAt(0).toUpperCase() + first.slice(1);
  return sentence.length > 200 ? `${sentence.slice(0, 197)}…` : sentence;
}

// ── Live tail ────────────────────────────────────────────────────────────────

// CSI / OSC escape sequences and the stray control bytes a TUI leaves behind.
const ANSI_RE =
  /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-Z\\-_]|[\x00-\x08\x0b-\x1f\x7f]/g;

/**
 * The last few meaningful lines of an agent's screen, as plain text.
 * Box-drawing borders and blank lines are dropped: on a phone the frame is
 * noise and the words are the point.
 */
export function tailForWatch(screen: string, lines = 12): string[] {
  return screen
    .replace(ANSI_RE, "")
    .split(/\r?\n/)
    .map((l) => l.replace(/[│┃║╭╮╯╰─━═┌┐└┘├┤┬┴┼]+/g, " ").replace(/\s+$/g, ""))
    .filter((l) => l.trim().length > 0)
    .slice(-lines);
}

// Lines a coding CLI draws around its work rather than as it: the input box,
// key hints, permission-mode banners, model/usage footers.
const CHROME_LINE =
  /^\s*>|for shortcuts|esc to (interrupt|cancel)|bypass permissions|auto-accept|accept edits|shift\+tab|ctrl\+|context left|tokens? used|^\s*\?\s/i;
const LEADING_GLYPHS = /^[\s✻✽✶✳✢✦·⏺●○◐◓◑◒⎿└*•+\-⠀-⣿]+/u;

/**
 * The one line that says what the agent is doing right now ("Writing
 * src/app/page.tsx"), read bottom-up from the tail and cleaned of spinner
 * glyphs and "(12s · esc to interrupt)" suffixes. Watch headlines it as plain
 * text and folds the raw screen behind a tap, the way Claude and ChatGPT show
 * one live step instead of a terminal. Null when nothing readable is on screen.
 */
export function latestActivityLine(tail: string[]): string | null {
  for (let i = tail.length - 1; i >= 0; i--) {
    const raw = tail[i]!;
    const cleaned = raw
      .replace(/\s*\([^)]*(esc to|tokens|\d+s)[^)]*\)\s*$/i, "")
      .replace(LEADING_GLYPHS, "")
      .trim();
    if (!/[A-Za-z]{2}/.test(cleaned)) continue;
    if (CHROME_LINE.test(cleaned)) continue;
    return cleaned.length > 120 ? `${cleaned.slice(0, 117)}…` : cleaned;
  }
  return null;
}
