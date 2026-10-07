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

/** Enough history for a full screen; the start of a slice may land mid-line. */
const SCREEN_SOURCE_MAX = 200_000;

/**
 * Replay a terminal's raw output into the lines it actually shows.
 *
 * A peek is the PTY's byte buffer, not a picture of the screen. A coding CLI
 * redraws in place — carriage return, cursor up, erase line, write again — so
 * deleting the escape codes (what this used to do) leaves every frame of every
 * redraw concatenated: the Watch "screen" read "Actioning…●✢4*✶75✻ ✻Actioning…
 * 5✻Actioning…●✶*86✢" down a whole phone (operator, 2026-10-07). This applies
 * the moves instead of dropping them: a small cursor model that understands
 * CR, LF, backspace, tab, cursor up/down/left/right/column/position and the
 * erase-line / erase-screen sequences. Colour and mode sequences are ignored;
 * anything else unknown is skipped rather than printed.
 */
export function renderTerminalText(raw: string): string[] {
  let input = raw;
  if (input.length > SCREEN_SOURCE_MAX) {
    input = input.slice(-SCREEN_SOURCE_MAX);
    const nl = input.indexOf("\n");
    if (nl >= 0) input = input.slice(nl + 1);
  }
  const rows: string[][] = [[]];
  let r = 0;
  let c = 0;
  let saved: [number, number] = [0, 0];
  const row = (i: number) => {
    while (rows.length <= i) rows.push([]);
    return rows[i]!;
  };
  const put = (ch: string) => {
    const line = row(r);
    while (line.length < c) line.push(" ");
    line[c] = ch;
    c += 1;
  };

  for (let i = 0; i < input.length; i++) {
    const ch = input[i]!;
    if (ch === "\x1b") {
      const next = input[i + 1];
      if (next === "[") {
        let j = i + 2;
        while (j < input.length && /[0-?]/.test(input[j]!)) j++;
        while (j < input.length && /[ -/]/.test(input[j]!)) j++;
        const final = input[j];
        const params = input.slice(i + 2, j).replace(/^[?>=]/, "");
        const nums = params.split(";").map((n) => Number.parseInt(n, 10));
        const n = Number.isFinite(nums[0]) && nums[0]! > 0 ? nums[0]! : 1;
        const p0 = Number.isFinite(nums[0]) ? nums[0]! : 0;
        switch (final) {
          case "A":
            r = Math.max(0, r - n);
            break;
          case "B":
          case "E":
            r += n;
            if (final === "E") c = 0;
            break;
          case "F":
            r = Math.max(0, r - n);
            c = 0;
            break;
          case "C":
            c += n;
            break;
          case "D":
            c = Math.max(0, c - n);
            break;
          case "G":
            c = n - 1;
            break;
          case "H":
          case "f": {
            // Absolute positions are relative to the visible screen, whose
            // height a buffer does not record; anchor to the newest rows.
            const top = Math.max(0, rows.length - 40);
            r = top + n - 1;
            c = Number.isFinite(nums[1]) && nums[1]! > 0 ? nums[1]! - 1 : 0;
            break;
          }
          case "K": {
            const line = row(r);
            if (p0 === 0) line.length = Math.min(line.length, c);
            else if (p0 === 1) for (let k = 0; k <= c && k < line.length; k++) line[k] = " ";
            else line.length = 0;
            break;
          }
          case "J":
            if (p0 === 2 || p0 === 3) {
              rows.length = 0;
              rows.push([]);
              r = 0;
              c = 0;
            } else if (p0 === 0) {
              row(r).length = Math.min(row(r).length, c);
              rows.length = r + 1;
            }
            break;
          case "s":
            saved = [r, c];
            break;
          case "u":
            [r, c] = saved;
            break;
          default:
            break; // colours, modes, scroll regions: nothing to draw
        }
        i = j;
        continue;
      }
      if (next === "]") {
        // OSC: up to BEL or ST.
        let j = i + 2;
        while (
          j < input.length &&
          input[j] !== "\x07" &&
          !(input[j] === "\x1b" && input[j + 1] === "\\")
        )
          j++;
        i = input[j] === "\x07" ? j : j + 1;
        continue;
      }
      if (next === "7") saved = [r, c];
      else if (next === "8") [r, c] = saved;
      // Two-byte escapes (charset selects take a third byte).
      i += next === "(" || next === ")" ? 2 : 1;
      continue;
    }
    if (ch === "\n") {
      r += 1;
      c = 0;
      row(r);
    } else if (ch === "\r") c = 0;
    else if (ch === "\b") c = Math.max(0, c - 1);
    else if (ch === "\t") c = (Math.floor(c / 8) + 1) * 8;
    else if (ch < " " || ch === "\x7f") continue;
    else put(ch);
  }
  return rows.map((line) => line.join("").replace(/\s+$/g, ""));
}

/**
 * The last few meaningful lines of an agent's screen, as plain text.
 * Box-drawing borders and blank lines are dropped: on a phone the frame is
 * noise and the words are the point.
 */
export function tailForWatch(screen: string, lines = 14): string[] {
  return renderTerminalText(screen)
    .map((l) => l.replace(/[│┃║╭╮╯╰─━═┌┐└┘├┤┬┴┼]+/g, " ").replace(/\s+$/g, ""))
    .filter((l) => l.trim().length > 0)
    .slice(-lines);
}

// Lines a coding CLI draws around its work rather than as it: the input box,
// key hints, permission-mode banners, model/usage footers, tips.
const CHROME_LINE =
  /^\s*[>›❯]|for shortcuts|esc to (interrupt|cancel)|bypass permissions|auto[- ]accept|auto mode|accept edits|shift\+tab|ctrl\+|context left|tokens? used|^\s*\?\s|^\s*tip:/i;
const LEADING_GLYPHS = /^[\s✻✽✶✳✢✦·⏺●○◐◓◑◒⎿└*•+\-⠀-⣿]+/u;
// "✶ Actioning… (3m 37s · ↓ 6.6k tokens)": the spinner's word is a random
// gerund ("Actioning", "Pondering") — it says THAT it works, not WHAT.
const SPINNER_LINE = /^[A-Z][a-z]+(?:ing)?…\s*(?:\(.*\))?$/;
// A detail under an event ("  ⎿ $ cd …", a wrapped continuation).
const DETAIL_LINE = /^\s{2,}|^\s*⎿/u;

const TOOL_VERB: Record<string, string> = {
  Read: "Reading",
  Write: "Writing",
  Edit: "Editing",
  MultiEdit: "Editing",
  Update: "Editing",
  Create: "Creating",
  Bash: "Running",
  Grep: "Searching for",
  Search: "Searching for",
  Glob: "Finding",
  WebFetch: "Reading",
  WebSearch: "Searching the web for",
  Task: "Delegating",
};

/** "Write(src/app/page.tsx)" → "Writing src/app/page.tsx". */
function humanizeToolCall(line: string): string {
  const m = /^([A-Z][A-Za-z]+)\((.*)\)$/.exec(line);
  if (!m) return line;
  const verb = TOOL_VERB[m[1]!];
  return verb ? `${verb} ${m[2]!.trim()}` : line;
}

function cleanActivity(raw: string): string {
  return raw
    .replace(/\s*\([^)]*(esc to|tokens|\d+s)[^)]*\)\s*$/i, "")
    .replace(LEADING_GLYPHS, "")
    .trim();
}

/**
 * The one line that says what the agent is doing right now ("Writing
 * src/app/page.tsx", "Running 1 shell command…"), read bottom-up from the
 * tail. Prefers an event headline (a line at the left edge) over its indented
 * detail, and skips the spinner's decorative word and the input chrome. Watch
 * headlines it as plain text and folds the screen behind a tap, the way
 * Claude and ChatGPT show one live step instead of a terminal. Null when
 * nothing readable is on screen.
 */
export function latestActivityLine(tail: string[]): string | null {
  const pick = (allowDetail: boolean): string | null => {
    for (let i = tail.length - 1; i >= 0; i--) {
      const raw = tail[i]!;
      if (!allowDetail && DETAIL_LINE.test(raw)) continue;
      const cleaned = cleanActivity(raw);
      if (!/[A-Za-z]{2}/.test(cleaned)) continue;
      if (CHROME_LINE.test(cleaned)) continue;
      if (SPINNER_LINE.test(cleaned)) continue;
      const human = humanizeToolCall(cleaned);
      return human.length > 120 ? `${human.slice(0, 117)}…` : human;
    }
    return null;
  };
  return pick(false) ?? pick(true);
}
