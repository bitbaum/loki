/**
 * Ask mode: an honest second opinion on this site, before anything is filed.
 *
 * A client looking at the site someone built for them usually cannot tell a
 * mistake from a convention. Here they ask Loki — about the element they
 * picked, this page, or the whole site — and get an answer that may well be
 * "leave it, and here is why". Each change Loki does recommend comes with a
 * "Request this" button that carries it into Report, prefilled, with the same
 * picked elements attached — so asking and requesting are one flow, not two.
 *
 * Answers are rendered as TEXT, never HTML: model output shown on someone
 * else's site. The conversation lives in memory for the life of the page.
 * Server: src/app/api/widget/advise/route.ts; prompt: src/lib/widget-advise/.
 */
import { h } from "./dom";
import type { SelectedEl } from "./picker";
import { SNAPSHOT_MAX_CHARS, takeSnapshot, type SnapshotScope } from "./page-snapshot";
import { REVIEW_SESSION_MAX } from "./watch-trail";

/** Mirrors ADVISE_MAX_QUESTION / ADVISE_MAX_HISTORY in the route's advisor module. */
export const ADVISE_MAX_QUESTION = 1000;
export const ADVISE_MAX_HISTORY = 8;

/** What the owner "asks" when they press Review on the watch pill. */
export const REVIEW_QUESTION = "Review what I just did on this site. What should be improved?";

type Turn = { role: "user" | "assistant"; content: string };

export const ADVISE_STARTERS: Record<SnapshotScope, string[]> = {
  element: [
    "Is this good as it is?",
    "Why might it have been done this way?",
    "How could this work better?",
  ],
  page: [
    "What would you improve on this page?",
    "Is this page clear to a first-time visitor?",
    "Should I leave anything here alone?",
  ],
  site: [
    "How can we make the website better?",
    "What is missing from the site?",
    "Is anything confusing for a visitor?",
  ],
};

export function createAdvise(opts: {
  apiBase: string;
  token: string;
  getScope(): SnapshotScope;
  getSelected(): SelectedEl[];
  /** Carry a change (or the unanswered question) into Report, prefilled. */
  onRequest(text: string): void;
}) {
  const history: Turn[] = [];
  let busy = false;

  const el = h("div", "chat advise");
  const log = h("div", "chatlog");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");

  const starters = h("div", "starters");

  const input = h("textarea", "chatinput");
  input.maxLength = ADVISE_MAX_QUESTION;
  input.rows = 2;
  input.placeholder = "Ask anything about this site…";
  const sendBtn = h("button", "go", "Ask");
  sendBtn.disabled = true;
  input.addEventListener("input", () => {
    sendBtn.disabled = busy || !input.value.trim();
  });
  sendBtn.addEventListener("click", () => void send());
  const form = h("div", "chatform");
  form.append(input, sendBtn);
  el.append(log, starters, form);

  function renderStarters() {
    starters.textContent = "";
    for (const q of ADVISE_STARTERS[opts.getScope()]) {
      const b = h("button", "starter", q);
      b.addEventListener("click", () => void send(q));
      starters.appendChild(b);
    }
  }
  renderStarters();

  function bubble(role: "user" | "bot", text: string): HTMLElement {
    const m = h("div", `msg ${role}`);
    if (role === "bot") {
      m.classList.add("from-loki");
      m.appendChild(h("span", "who", "Loki"));
      m.appendChild(h("span", "said", text));
    } else {
      m.textContent = text;
    }
    log.appendChild(m);
    log.scrollTop = log.scrollHeight;
    return m;
  }

  /** The recommended changes, each one tap from a request to the builder. */
  function changeList(changes: string[], title = "Suggested changes", action = "Request this →") {
    if (!changes.length) return;
    const box = h("div", "changes");
    box.appendChild(h("div", "changes-title", title));
    for (const text of changes) {
      const row = h("div", "change");
      row.appendChild(h("span", "change-text", text));
      const req = h("button", "change-send", action);
      req.title = "Send this to whoever builds the site";
      req.addEventListener("click", () => opts.onRequest(text));
      row.appendChild(req);
      box.appendChild(row);
    }
    log.appendChild(box);
    log.scrollTop = log.scrollHeight;
  }

  /**
   * `session` is Watch's record of what the owner just did (widget/watch.ts):
   * with it, the answer is a review of their session, not of the page alone.
   */
  async function send(question?: string, session?: string) {
    const message = (question ?? input.value).trim().slice(0, ADVISE_MAX_QUESTION);
    if (busy || !message) return;
    busy = true;
    sendBtn.disabled = true;
    starters.style.display = "none";
    input.value = "";
    const selected = opts.getSelected();
    // "An element" with nothing picked is still a good question about the page.
    // A session review is about the page they are on, whatever chip is lit.
    const scope: SnapshotScope =
      session || (opts.getScope() === "element" && selected.length === 0)
        ? "page"
        : opts.getScope();
    bubble("user", message);
    const pending = bubble(
      "bot",
      session
        ? "Going through what you did…"
        : scope === "site"
          ? "Reading the site…"
          : "Looking at the " + scope + "…",
    );
    pending.classList.add("pending");
    try {
      const snapshot = (await takeSnapshot(scope, selected)).slice(0, SNAPSHOT_MAX_CHARS);
      const res = await fetch(`${opts.apiBase}/api/widget/advise`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token: opts.token,
          question: message,
          scope,
          snapshot,
          session: session ? session.slice(0, REVIEW_SESSION_MAX) : undefined,
          history: history
            .slice(-ADVISE_MAX_HISTORY)
            .map((t) => ({ ...t, content: t.content.slice(0, 3000) })),
        }),
      });
      const body = (await res.json().catch(() => null)) as {
        reply?: string;
        changes?: unknown;
        degraded?: boolean;
        error?: string;
      } | null;
      if (!res.ok || !body?.reply) throw new Error(body?.error ?? `Request failed (${res.status})`);
      pending.remove();
      bubble("bot", body.reply.slice(0, 6000));
      const changes = (Array.isArray(body.changes) ? body.changes : [])
        .filter((c): c is string => typeof c === "string" && c.trim().length > 0)
        .map((c) => c.slice(0, 300))
        .slice(0, 5);
      changeList(changes);
      // No answer is never a dead end: the question itself can go to the builder.
      if (body.degraded) changeList([message], "Ask the builder instead", "Send this question →");
      history.push({ role: "user", content: message }, { role: "assistant", content: body.reply });
    } catch (err) {
      pending.classList.remove("pending");
      pending.classList.add("failed");
      pending.textContent =
        err instanceof Error ? err.message : "Could not reach Loki — try again.";
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
    /** The scope chips changed: offer questions that fit the new scope. */
    refresh: renderStarters,
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
    /** Watch's Review: judge the owner's session, not only the page. */
    review: (session: string) => void send(REVIEW_QUESTION, session),
  };
}
