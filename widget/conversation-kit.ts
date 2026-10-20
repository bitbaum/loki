/**
 * The conversation as the shared chat draws it (widget/chat/, chatkit).
 *
 * conversation.ts keeps deciding what is said and offered; this turns the
 * model's snapshot into the `KitState` the chat chunk renders — the same
 * thread, the same actions, in the chat Loki itself uses. Widget-owned pieces
 * chatkit has no model for (the changes checklist, Fix this, a receipt's link,
 * the confirmation card) are built here with the widget's own DOM helpers and
 * handed over as nodes.
 */
import { h } from "./dom";
import { answerLinks } from "./rich-text";
import { suggestionBox } from "./suggestions";
import { filedText, knownLabel, type KnownFix } from "./known-fixes";
import { REVIEW_QUESTION } from "./loki-api";
import { receiptFull, receiptLinkLabel, receiptText } from "./receipt";
import { greetingFor } from "./greeting";
import type { Assistant, ThreadItem } from "./thread";
import type { About } from "./about-bar";
import {
  CONCIERGE_GREETING,
  startersFor,
  type ConversationModel,
  type ConversationWatch,
} from "./conversation-model";
import type { KitMessage, KitMode, KitState } from "./chat/contract";

export type KitInputs = {
  model: ConversationModel;
  assistant: Assistant;
  owner: boolean;
  about: About;
  watch: ConversationWatch | null;
  placeholder: string;
  /** The focused feedback action for this owner or visitor. */
  feedbackLabel: string;
  known: (key: string) => KnownFix | null;
  ownerDoor: () => HTMLElement;
  /** The open confirmation card, built by conversation.ts (it owns its inputs). */
  draftCard: HTMLElement | null;
  header: HTMLElement;
  /** Talk, for chatkit's tool row (null: chatkit's own dictation). */
  tools?: HTMLElement | null;
  footer: HTMLElement;
  held: number;
};

const LOKI = { name: "Loki", id: "loki" };
const CAT = { name: "Cat", id: "cat" };

function button(cls: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = h("button", cls, label);
  b.type = "button";
  b.addEventListener("click", onClick);
  return b;
}

/** A remark's words as they stand now — the fix it started follows its fix. */
export function noticedText(
  item: Extract<ThreadItem, { kind: "noticed" }>,
  known: KnownFix | null,
): string {
  const text = filedText(item.text, known);
  return item.again ? `${text}\n\nLoki fixed this before. It is back.` : text;
}

/** Under a remark Loki made unasked: where its fix is, or Fix this + Why. */
export function noticedExtras(
  item: Extract<ThreadItem, { kind: "noticed" }>,
  known: KnownFix | null,
  owner: boolean,
  onFix: () => void,
  onWhy: () => void,
): HTMLElement | null {
  const box = h("div", "noticed-extras");
  const inFlight = !!known && !known.settled;
  if (known && (inFlight || known.live)) {
    // The state in words, then the ONE tap that acts on it as a real link —
    // "Open it in Loki" used to be words inside the status, with nothing to
    // press (2026-10-20). A failed attempt opens that run's Watch page.
    const st = h("div", `noticed-status tone-${known.tone}`);
    st.append(`${knownLabel(known)} — ${known.detail}`);
    if (known.href) {
      const go = h("a", "noticed-go", `${known.action ?? "Open in Loki"} →`);
      go.href = known.href;
      go.target = "_blank";
      go.rel = "noopener noreferrer";
      st.append(" ", go);
    }
    box.appendChild(st);
  }
  if (!item.filed && !inFlight) {
    const row = h("div", "noticed-actions");
    row.append(
      button(
        "change-send",
        owner ? (known?.live ? "Fix again →" : "Fix this →") : "Send to builder →",
        onFix,
      ),
      button("act", "Why does it matter?", onWhy),
    );
    box.appendChild(row);
  }
  return box.childNodes.length ? box : null;
}

export function kitState(i: KitInputs): KitState {
  const { model } = i;
  const { thread, pending, error } = model.snapshot();
  const messages: KitMessage[] = [];

  if (i.assistant === "concierge" && !i.owner) {
    CONCIERGE_GREETING.forEach((g, n) =>
      messages.push({
        id: `hello-${n}`,
        role: "assistant",
        content: g.text,
        speaker: g.speaker === "cat" ? CAT : LOKI,
      }),
    );
  } else {
    messages.push({
      id: "hello",
      role: "assistant",
      content: greetingFor({
        assistant: i.assistant,
        owner: i.owner,
        watching: i.watch?.on() ?? false,
      }),
      speaker: LOKI,
      footer: i.owner ? null : i.ownerDoor(),
    });
  }

  thread.forEach((item, n) => {
    const id = `t${n}-${item.at}`;
    if (item.kind === "you") {
      messages.push({ id, role: "user", content: item.text });
    } else if (item.kind === "loki") {
      const footer = h("div", "kit-extras");
      if (item.changes?.length)
        footer.appendChild(
          suggestionBox({
            items: item.changes,
            owner: i.owner,
            onBuild: model.build,
            onEdit: model.openDraft,
          }),
        );
      if (item.links?.length) footer.appendChild(answerLinks(item.links));
      messages.push({
        id,
        role: "assistant",
        content: item.text,
        speaker: item.speaker === "cat" ? CAT : LOKI,
        footer: footer.childNodes.length ? footer : null,
      });
    } else if (item.kind === "noticed") {
      const known = item.key ? i.known(item.key) : null;
      messages.push({
        id,
        role: "assistant",
        content: noticedText(item, known),
        speaker: LOKI,
        footer: noticedExtras(
          item,
          known,
          i.owner,
          () => model.build(item.fix, item.key),
          () =>
            model.ask(
              `Why is this a problem, and how would you fix it? ${item.text}`,
              i.watch?.session(),
            ),
        ),
      });
    } else {
      let footer: HTMLElement | null = null;
      const full = receiptFull(item);
      if (full || item.claimUrl) {
        footer = h("div", "sent-footer");
        if (full) footer.appendChild(sentFull(full));
        if (item.claimUrl) {
          const t = h("a", "track", receiptLinkLabel(item));
          t.href = item.claimUrl;
          t.target = "_blank";
          t.rel = "noopener noreferrer";
          footer.appendChild(t);
        }
      }
      messages.push({ id, role: "assistant", content: receiptText(item), speaker: LOKI, footer });
    }
  });
  if (error) messages.push({ id: "error", role: "assistant", content: error, failed: true });

  // After the last turn: your own words as written, one tap from the builder
  // (asking Loki first is an offer, never a gate) — then the open card.
  const after = h("div", "kit-after");
  const lastYou = [...thread].reverse().find((t) => t.kind === "you");
  if (lastYou && i.assistant !== "none" && !i.draftCard && i.about !== "loki")
    after.appendChild(
      button("act", i.owner ? "Build this as written" : "Send to builder as written", () =>
        model.build(lastYou.text),
      ),
    );
  if (i.draftCard) after.appendChild(i.draftCard);

  const { list } = startersFor(i.assistant, thread, i.watch?.on() ?? false);
  const one = i.assistant === "none" || i.about === "loki";
  const feedback: KitMode = { id: "feedback", label: i.feedbackLabel, send: i.feedbackLabel };
  const modes: KitMode[] = one ? [feedback] : [{ id: "ask", label: "Ask", send: "Send" }, feedback];

  return {
    messages,
    live: pending ? { status: pending.review ? "Going through what you did…" : "Looking…" } : null,
    after: after.childNodes.length ? after : null,
    starters: list.map((q) => ({
      label: q === REVIEW_QUESTION ? "Review my last few minutes" : q,
      pick: () => (q === REVIEW_QUESTION ? model.review() : model.ask(q)),
    })),
    placeholder: i.placeholder,
    modes,
    header: i.header,
    tools: i.tools ?? null,
    footer: i.footer,
    held: i.held,
    sending: pending !== null,
    reviewingNote: model.snapshot().draft?.intent === "note",
  };
}

/** Notes the person opened with "Show all" — the thread is redrawn often. */
const shownWhole = new Set<string>();

/**
 * The whole of a sent note, under the receipt: clamped to whole lines
 * (SENT_LINES), one tap from all of it. Never a sentence cut at the panel's
 * edge with nothing to open (2026-10-20); the button goes when everything
 * already fits.
 */
export function sentFull(text: string): HTMLElement {
  const box = h("div", "sent-full");
  const body = h("div", "sent-full-text", text);
  const more = h("button", "sent-full-more");
  more.type = "button";
  const set = (open: boolean) => {
    body.classList.toggle("clamped", !open);
    more.textContent = open ? "Show less" : "Show all";
    more.setAttribute("aria-expanded", String(open));
  };
  set(shownWhole.has(text));
  more.addEventListener("click", () => {
    const open = !shownWhole.has(text);
    if (open) shownWhole.add(text);
    else shownWhole.delete(text);
    set(open);
  });
  // Once laid out: a note that fits in the clamp needs no button.
  requestAnimationFrame(() => {
    if (
      body.isConnected &&
      body.classList.contains("clamped") &&
      body.scrollHeight <= body.clientHeight + 1
    )
      more.hidden = true;
  });
  box.append(body, more);
  return box;
}
