/**
 * Chat mode: a plain chat that the Cat and Loki both live in. The visitor
 * asks; whichever of them the question belongs to answers as itself, from the
 * fleet map, and points at the project that fits
 * (src/app/api/widget/chat/route.ts). Every bubble says who is speaking.
 *
 * Answers are rendered as TEXT, never HTML — the reply is model output shown
 * on someone else's site. Links come back as a separate list the server built
 * from the map, and only http(s) URLs are turned into anchors.
 *
 * The conversation lives in memory for the life of the page: a front-desk
 * question does not need to survive a reload, and storing it would be keeping
 * a stranger's words for no reason.
 */
import { h } from "./dom";

/** Mirrors the route's caps (WIDGET_CHAT_MAX_MESSAGE / _MAX_HISTORY). */
export const CHAT_MAX_MESSAGE = 1000;
export const CHAT_MAX_HISTORY = 12;

type Turn = { role: "user" | "assistant"; content: string };
type Link = { label: string; url: string };
type Speaker = "cat" | "loki" | null;
type Message = { speaker: Speaker; text: string };

const SPEAKER_NAMES: Record<"cat" | "loki", string> = { cat: "Cat", loki: "Loki" };

/** Each resident introduces itself, in its own voice — there is no joint persona. */
export const CHAT_GREETINGS: Message[] = [
  {
    speaker: "cat",
    text: "I'm the Cat. Ask me about earning, selling or getting paid — in Bitcoin.",
  },
  {
    speaker: "loki",
    text: "I'm Loki. Ask me about getting something built or run. Between us we know every project here.",
  },
];

export const CHAT_STARTERS = [
  "What can you build for me?",
  "I want to earn in Bitcoin",
  "How do I run AI agents on my code?",
  "What are you working on right now?",
];

export function safeHttpUrl(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" || u.protocol === "http:" ? u.href : null;
  } catch {
    return null;
  }
}

export function createChat(opts: { apiBase: string; token: string }) {
  const history: Turn[] = [];
  let busy = false;

  const el = h("div", "chat");
  const log = h("div", "chatlog");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");

  for (const g of CHAT_GREETINGS) said(g);

  const starters = h("div", "starters");
  for (const q of CHAT_STARTERS) {
    const b = h("button", "starter", q);
    b.addEventListener("click", () => void send(q));
    starters.appendChild(b);
  }

  const input = h("textarea", "chatinput");
  input.maxLength = CHAT_MAX_MESSAGE;
  input.rows = 2;
  input.placeholder = "Ask about any project…";
  const sendBtn = h("button", "go", "Ask");
  sendBtn.disabled = true;
  input.addEventListener("input", () => {
    sendBtn.disabled = busy || !input.value.trim();
  });
  sendBtn.addEventListener("click", () => void send());
  const form = h("div", "chatform");
  form.append(input, sendBtn);

  el.append(log, starters, form);

  /** One agent's message: its name, then what it said — both as text. */
  function said(message: Message, into?: HTMLElement): HTMLElement {
    const m = into ?? h("div", "msg bot");
    m.textContent = "";
    m.classList.remove("pending");
    if (message.speaker) {
      m.classList.add(`from-${message.speaker}`);
      m.appendChild(h("span", "who", SPEAKER_NAMES[message.speaker]));
    }
    m.appendChild(h("span", "said", message.text));
    if (!into) log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    return m;
  }

  function bubble(role: "user" | "bot", text: string): HTMLElement {
    const m = h("div", `msg ${role}`);
    m.textContent = text;
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    return m;
  }

  function linkRow(links: Link[]) {
    const safe = links
      .map((l) => ({ label: String(l.label ?? "").slice(0, 80), url: safeHttpUrl(l.url) }))
      .filter((l): l is Link => Boolean(l.url && l.label));
    if (!safe.length) return;
    const row = h("div", "chatlinks");
    for (const l of safe) {
      const a = h("a", "chatlink", `${l.label} →`) as HTMLAnchorElement;
      a.href = l.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      row.appendChild(a);
    }
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  }

  async function send(question?: string) {
    const message = (question ?? input.value).trim().slice(0, CHAT_MAX_MESSAGE);
    if (busy || !message) return;
    busy = true;
    sendBtn.disabled = true;
    starters.style.display = "none";
    input.value = "";
    bubble("user", message);
    const pending = bubble("bot", "…");
    pending.classList.add("pending");
    try {
      const res = await fetch(`${opts.apiBase}/api/widget/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: opts.token,
          message,
          history: history
            .slice(-CHAT_MAX_HISTORY)
            .map((t) => ({ ...t, content: t.content.slice(0, 2000) })),
          url: location.href.slice(0, 1000),
          pageTitle: document.title.slice(0, 300) || undefined,
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        reply?: string;
        messages?: Message[];
        links?: Link[];
        error?: string;
      } | null;
      if (!res.ok || !body?.reply) throw new Error(body?.error ?? `Request failed (${res.status})`);
      const messages: Message[] = (Array.isArray(body.messages) ? body.messages : [])
        .filter((m) => typeof m?.text === "string" && m.text.trim())
        .map((m) => ({
          speaker: m.speaker === "cat" || m.speaker === "loki" ? m.speaker : null,
          text: m.text.slice(0, 4000),
        }));
      // The first message replaces the "…"; any further speaker gets a bubble of its own.
      const [first, ...rest] = messages.length ? messages : [{ speaker: null, text: body.reply }];
      said(first!, pending);
      for (const m of rest) said(m);
      history.push({ role: "user", content: message }, { role: "assistant", content: body.reply });
      linkRow(Array.isArray(body.links) ? body.links : []);
    } catch (err) {
      pending.classList.remove("pending");
      pending.classList.add("failed");
      pending.textContent =
        err instanceof Error ? err.message : "Could not reach the assistant — try again.";
      input.value = message;
    } finally {
      busy = false;
      sendBtn.disabled = !input.value.trim();
      input.focus();
    }
  }

  return {
    el,
    input,
    focus: () => input.focus(),
    /** Enter sends, Shift+Enter is a newline — called from the panel's keyboard trap. */
    onKey(e: KeyboardEvent): boolean {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
        e.preventDefault();
        void send();
        return true;
      }
      return false;
    },
    ask: (q: string) => void send(q),
  };
}
