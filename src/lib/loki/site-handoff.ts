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

/**
 * What a send with nothing typed says — the person came here to go on.
 *
 * It names the site and the last thing they asked there, because this line
 * becomes the thread's title and its first bubble. The generic "Pick up this
 * conversation from my site…" it replaced titled every hand-off the same,
 * truncated, and read to the classifier as a work order: it was queued for a
 * builder that was offline instead of being answered (operator, 2026-10-09).
 * The caller sends it as chat, never as a dispatch.
 */
export function handoffAsk(h: SiteHandoff): string {
  const host = handoffHost(h);
  const last = h.lastAsk?.replace(/\s+/g, " ").trim();
  if (!last) return `Pick up where we left off on ${host}.`;
  const clipped = last.length > 120 ? `${last.slice(0, 119).trimEnd()}…` : last;
  return `On ${host}: ${clipped}`;
}

function handoffHost(h: SiteHandoff): string {
  if (!h.url) return h.source;
  try {
    return new URL(h.url).host;
  } catch {
    return h.source;
  }
}

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
  return `${handoffHost(h)} · ${h.turns} ${h.turns === 1 ? "message" : "messages"}`;
}
