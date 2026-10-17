/**
 * What the agent is doing right now, in one short line — read from the same
 * session log the conversation view draws ("Editing Header.tsx", "Adding the
 * contact form to the home page").
 *
 * The runner sends it with each progress beat (desktop/src/main/run-progress),
 * so a job card on Control can say what is happening without anyone having the
 * session open. Before, the card could only say "Working" or "Run output still
 * arriving from the builder" (2026-10-17: "it's building, interesting — but
 * what?").
 *
 * Pure: transcript items in, one line or null out.
 */
import { describeToolStep, type TranscriptItem } from "./claude-transcript";

const MAX = 90;

export function latestRunStep(items: readonly TranscriptItem[]): string | null {
  for (let i = items.length - 1; i >= 0; i--) {
    const item = items[i]!;
    if (item.kind === "tool") {
      // Present tense either way: between two steps the latest one is still
      // the best answer to "what is it doing?".
      const { verb, target } = describeToolStep({ ...item, status: "running" });
      return clip(target ? `${verb} ${shortTarget(item.name, target)}` : verb);
    }
    if (item.kind === "assistant") {
      const sentence = firstSentence(item.text);
      if (sentence) return clip(sentence);
      continue;
    }
    // Your message is the newest thing: it has it and has not answered yet.
    if (item.kind === "user") return "Reading the request";
  }
  return null;
}

/** A path reads as its file name; a command as its first words. */
function shortTarget(tool: string, target: string): string {
  const t = target.trim();
  if (/^(Read|Edit|MultiEdit|Write|NotebookEdit)$/.test(tool) && t.includes("/")) {
    return t.split("/").filter(Boolean).pop() ?? t;
  }
  return t;
}

function firstSentence(text: string): string {
  const line =
    text
      .split("\n")
      .map((l) =>
        l
          .replace(/^\s*(?:#{1,6}\s+|[-*•]\s+|\d+[.)]\s+)/, "")
          .replace(/\*\*|`/g, "")
          .trim(),
      )
      .find(Boolean) ?? "";
  return (/^(.+?[.!?])(?:\s|$)/.exec(line)?.[1] ?? line).replace(/[:;,]+$/, "");
}

function clip(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length <= MAX ? t : `${t.slice(0, MAX - 1).trimEnd()}…`;
}
