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
import { knownLabel, type KnownFix } from "./known-fixes";
import { REVIEW_QUESTION } from "./loki-api";
import { receiptLinkLabel, receiptText } from "./receipt";
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
    const st = h("a", `noticed-status tone-${known.tone}`);
    st.textContent = `${knownLabel(known)} — ${known.detail}`;
    st.title = known.detail;
    if (known.href) {
      st.href = known.href;
      st.target = "_blank";
      st.rel = "noopener noreferrer";
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
      messages.push({
        id,
        role: "assistant",
        content: item.again ? `${item.text}\n\nLoki fixed this before. It is back.` : item.text,
        speaker: LOKI,
        footer: noticedExtras(
          item,
          item.key ? i.known(item.key) : null,
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
      if (item.claimUrl) {
        const t = h("a", "track", receiptLinkLabel(item));
        t.href = item.claimUrl;
        t.target = "_blank";
        t.rel = "noopener noreferrer";
        footer = t;
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
  const modes: KitMode[] = one
    ? [feedback]
    : [{ id: "ask", label: "Chat with Loki", send: "Send" }, feedback];

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
    footer: i.footer,
    held: i.held,
    sending: pending !== null,
    reviewingNote: model.snapshot().draft?.intent === "note",
  };
}
