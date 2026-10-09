/**
 * A conversation carried in from the widget ("Continue in Loki → Chat").
 *
 * The widget sends its thread as one block of text in `?q=` (widget/continue.ts
 * handoffText: a "From Loki on “…” (url):" head, then "Me: … / Loki: …"
 * lines). It used to land in the composer verbatim — a wall of "Me:" and
 * "Loki noticed:" the owner had to scroll past to say anything, with the
 * site's name truncated beside it (operator, 2026-10-09). It is context, not
 * a message: the chat shows it as one card above an EMPTY box, and sends it
 * as a text attachment with whatever the person writes.
 *
 * Pure (scripts/test/loki-site-handoff.ts).
 */
import type { TextAttachment } from "@/lib/loki/attachments";

export type SiteHandoff = {
  /** The page's title as the widget saw it. */
  source: string;
  /** Its address, http(s) only. */
  url: string | null;
  /** Turns carried over, for the card's one line. */
  turns: number;
  /** The last thing the person said there, for the card's preview. */
  lastAsk: string | null;
  /** The whole block, as the model should read it. */
  text: string;
};

const HEAD = /^From Loki on “([^”]{1,200})” \((https?:\/\/[^)\s]{1,500})\):[ \t]*(?:\n|$)/;
const TURN = /^(Me|Loki|Loki noticed|Sent to the builder):\s/;

export function parseSiteHandoff(q: string | null | undefined): SiteHandoff | null {
  const text = q?.trim();
  if (!text) return null;
  const head = HEAD.exec(text);
  if (!head) return null;
  const lines = text.slice(head[0].length).split("\n");
  const turns = lines.filter((l) => TURN.test(l)).length;
  const mine = lines.filter((l) => l.startsWith("Me: "));
  const lastAsk = mine.length ? mine[mine.length - 1].slice(4).trim() || null : null;
  return { source: head[1].trim(), url: head[2], turns, lastAsk, text };
}

/** What a send with nothing typed says — the person came here to go on. */
export const HANDOFF_DEFAULT_ASK = "Pick up this conversation from my site and take it from here.";

export type HandoffTurn = { who: "you" | "loki" | "noticed" | "sent"; text: string };

/** The block as turns, for the card — continuation lines join their turn. */
export function handoffTurns(h: SiteHandoff): HandoffTurn[] {
  const head = HEAD.exec(h.text);
  const lines = h.text.slice(head ? head[0].length : 0).split("\n");
  const turns: HandoffTurn[] = [];
  for (const line of lines) {
    const m = TURN.exec(line);
    if (m) {
      const who =
        m[1] === "Me"
          ? "you"
          : m[1] === "Loki noticed"
            ? "noticed"
            : m[1] === "Loki"
              ? "loki"
              : "sent";
      turns.push({ who, text: line.slice(m[0].length) });
    } else if (turns.length && line.trim()) {
      turns[turns.length - 1].text += `\n${line}`;
    }
  }
  return turns;
}

export function handoffAttachment(h: SiteHandoff): TextAttachment {
  return { kind: "text", name: "conversation-on-my-site.txt", content: h.text };
}

/** "kestrel.example · 3 messages" */
export function handoffSummary(h: SiteHandoff): string {
  let host = h.source;
  if (h.url) {
    try {
      host = new URL(h.url).host;
    } catch {
      /* keep the title */
    }
  }
  return `${host} · ${h.turns} ${h.turns === 1 ? "message" : "messages"}`;
}
