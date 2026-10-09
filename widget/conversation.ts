/**
 * The panel's one conversation with Loki.
 *
 * It replaces three tools that shared a box and nothing else — "Request a
 * change" (a form), "Ask Loki" (an advisor) and "Chat" (a studio front desk),
 * each behind a tab with its own history, and scope chips above two of them.
 * A person had to decide which tool they needed before saying anything, and
 * advice that should become a request had to be carried across by hand.
 *
 * Now: say anything. Loki answers about this page or site (or, on a studio
 * front desk, about the projects). Every change Loki recommends — and your
 * own message, as written — has "Send to builder", which opens a short
 * confirmation IN the thread; the receipt ("an agent is building this", or a
 * link to track it) lands in the thread too. The thread is kept per tab
 * (widget/thread.ts), so it survives the site's own page loads.
 *
 * Model output is rendered as TEXT, never HTML: it is shown on someone else's
 * site. Links come from the server's map and only http(s) become anchors.
 */
import { h } from "./dom";
import type { Picker, SelectedEl } from "./picker";
import { createAttachments } from "./attachments";
import { createVoiceControl } from "./voice-control";
import { mergeTranscript } from "./voice";
import { buildSuggestion, formatDiagnostics, type ReportDiagnostics } from "./report-payload";
import { sendReport } from "./send-report";
import { askAdvisor, askConcierge, REVIEW_QUESTION, type Answer } from "./loki-api";
import {
  historyFor,
  pushItem,
  restoreThread,
  type Assistant,
  type Link,
  type ThreadItem,
} from "./thread";
import { createContinueRow } from "./continue-row";
import { greetingFor, ownerDoor } from "./greeting";

/** The ingest's cap on `suggestion` (api/feedback FeedbackBody). */
export const MAX_LEN = 2000;
const MAX_SCREENSHOTS = 5;
/** Stop recording under the server's ~2 min upload cap. */
const VOICE_MAX_MS = 110_000;
const ASK_MAX = 1000;

const threadKey = (token: string) => `loki-thread:${token}`;

function readThread(token: string): ThreadItem[] {
  try {
    return restoreThread(JSON.parse(sessionStorage.getItem(threadKey(token)) ?? "[]"), Date.now());
  } catch {
    return [];
  }
}

function writeThread(token: string, thread: ThreadItem[]): void {
  try {
    sessionStorage.setItem(threadKey(token), JSON.stringify(thread));
  } catch {
    /* storage blocked: the thread lasts for this page view */
  }
}

const CONCIERGE_GREETING = [
  {
    speaker: "cat" as const,
    text: "I'm the Cat. Ask me about earning, selling or getting paid — in Bitcoin.",
  },
  {
    speaker: "loki" as const,
    text: "I'm Loki. Ask me about getting something built or run — or tell me what should change on this site.",
  },
];

const STARTERS: Record<Assistant, string[]> = {
  advisor: [
    "What would you improve here?",
    "Is this clear to a first-time visitor?",
    "Something here is broken",
  ],
  concierge: [
    "What can you build for me?",
    "I want to earn in Bitcoin",
    "How do I run AI agents on my code?",
  ],
  none: [],
};

export type ConversationWatch = {
  /** Watching right now (owner, not paused). */
  on: () => boolean;
  /** The session as Review sends it. */
  session: () => string;
  /** The watched steps as report lines — null while paused. */
  diagnostics: () => ReportDiagnostics | null;
};

export function createConversation(opts: {
  apiBase: string;
  token: string;
  assistant: () => Assistant;
  /** The owner pass, while the server still honours it. */
  ownerPass: () => string | null;
  /** The server refused the pass (expired, revoked): stop presenting it. */
  onPassRefused: () => void;
  picker: Picker;
  watch: () => ConversationWatch | null;
}) {
  let thread = readThread(opts.token);
  let busy = false;
  let scopeSite = false;
  let draftOpen: HTMLElement | null = null;

  const el = h("div", "convo");
  const log = h("div", "chatlog");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  const starters = h("div", "starters");

  // ---- what the next message is about: this page, the whole site, or an
  // element you point at — for a question to Loki and for feedback alike ----
  const ctx = h("div", "ctxbar");
  ctx.appendChild(h("span", "ctx-label", "About"));
  const seg = h("div", "seg");
  seg.setAttribute("role", "radiogroup");
  seg.setAttribute("aria-label", "What this is about");
  const pageBtn = h("button", "segbtn", "This page");
  const siteBtn = h("button", "segbtn", "Whole site");
  const pointBtn = h("button", "segbtn", "An element");
  for (const b of [pageBtn, siteBtn, pointBtn]) {
    b.type = "button";
    b.setAttribute("role", "radio");
    seg.appendChild(b);
  }
  pageBtn.addEventListener("click", () => {
    opts.picker.clearSelection();
    scopeSite = false;
    syncContext();
  });
  siteBtn.addEventListener("click", () => {
    opts.picker.clearSelection();
    scopeSite = true;
    syncContext();
  });
  // Tapping it again while something is picked picks again (adds/changes).
  pointBtn.addEventListener("click", () => opts.picker.start());
  ctx.append(seg);

  const shots = h("div", "shots");
  const err = h("div", "err");
  const fileInput = h("input");
  fileInput.type = "file";
  fileInput.accept = "image/*";
  fileInput.multiple = true;
  fileInput.style.display = "none";
  const attachBtn = h("button", "attach");
  attachBtn.type = "button";
  attachBtn.setAttribute("aria-label", "Add screenshots (or paste one)");
  attachBtn.title = "Add screenshots (or paste one)";
  attachBtn.addEventListener("click", () => fileInput.click());
  const attachments = createAttachments({
    attachBtn,
    container: shots,
    max: MAX_SCREENSHOTS,
    onError: (m) => (err.textContent = m),
  });
  // The attachments module draws its own button (icon + "Screenshots" / count).
  attachments.render();
  fileInput.addEventListener("change", () => {
    void attachments.attachMany(fileInput.files);
    fileInput.value = "";
  });

  // ---- composer ----
  const input = h("textarea", "chatinput");
  input.rows = 2;
  input.maxLength = MAX_LEN;
  // Two ways to say it, side by side: straight to the builder as feedback, or
  // ask Loki first. Neither is hidden behind the other.
  const sendBtn = h("button", "go");
  sendBtn.type = "button";
  sendBtn.disabled = true;
  sendBtn.addEventListener("click", () => void submit());
  const feedbackBtn = h("button", "ghost feedback");
  feedbackBtn.type = "button";
  feedbackBtn.disabled = true;
  feedbackBtn.addEventListener("click", () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    syncButtons();
    openDraft(text);
  });
  const syncButtons = () => {
    const empty = !input.value.trim();
    sendBtn.disabled = busy || empty;
    feedbackBtn.disabled = empty;
  };
  input.addEventListener("input", syncButtons);
  const voice = createVoiceControl({
    endpoint: `${opts.apiBase}/api/widget/transcribe`,
    token: opts.token,
    maxMs: VOICE_MAX_MS,
    onTranscript: (text) => {
      input.value = mergeTranscript(input.value, text, MAX_LEN);
      syncButtons();
      input.focus();
    },
    onError: (m) => (err.textContent = m),
  });
  const tools = h("div", "tools");
  if (voice) tools.append(voice.button);
  tools.append(attachBtn, fileInput);
  const actions = h("div", "composer-actions");
  actions.append(tools, feedbackBtn, sendBtn);
  const form = h("div", "composer");
  form.append(input, actions);

  // The way out of the card and into Loki itself (continue-row.ts).
  const cont = createContinueRow({
    apiBase: opts.apiBase,
    token: opts.token,
    thread: () => thread,
    owner: () => opts.ownerPass() !== null,
  });
  el.append(log, starters, ctx, shots, form, cont.el, err);

  el.addEventListener("paste", (e: ClipboardEvent) => {
    const images = Array.from(e.clipboardData?.items ?? []).filter((i) =>
      i.type.startsWith("image/"),
    );
    if (!images.length) return;
    e.preventDefault();
    for (const item of images) void attachments.attach(item.getAsFile());
  });

  const owner = () => opts.ownerPass() !== null;
  const sendLabel = () => (owner() ? "Build this →" : "Send to builder →");

  function syncContext() {
    const picked = opts.picker.selected().length;
    const now = scope();
    for (const [b, s] of [
      [pageBtn, "page"],
      [siteBtn, "site"],
      [pointBtn, "element"],
    ] as const) {
      b.classList.toggle("on", now === s);
      b.setAttribute("aria-checked", now === s ? "true" : "false");
    }
    pointBtn.textContent = picked ? `${picked} element${picked > 1 ? "s" : ""}` : "An element";
    pointBtn.title = picked ? "Tap to pick again" : "Point at something on the page";
    const a = opts.assistant();
    input.placeholder =
      now === "element"
        ? "What about what you picked?"
        : owner()
          ? "Say what to change, or ask Loki…"
          : a === "none"
            ? "What should change?"
            : "What should change — or ask Loki anything…";
    // With no AI on this embed, feedback is the only way, so it leads.
    feedbackBtn.textContent = owner() ? "Build it" : "Send as feedback";
    feedbackBtn.className = a === "none" ? "go feedback" : "ghost feedback";
    sendBtn.textContent = "Ask Loki";
    sendBtn.style.display = a === "none" ? "none" : "";
    cont.sync();
  }

  function scope(): "element" | "page" | "site" {
    return opts.picker.selected().length ? "element" : scopeSite ? "site" : "page";
  }

  // ---- rendering ----
  function bubble(cls: string, who: string | null, text: string): HTMLElement {
    const m = h("div", `msg ${cls}`);
    if (who) m.appendChild(h("span", "who", who));
    m.appendChild(h("span", "said", text));
    return m;
  }

  function changeBox(title: string, items: string[], action: string): HTMLElement {
    const box = h("div", "changes");
    box.appendChild(h("div", "changes-title", title));
    for (const text of items) {
      const row = h("div", "change");
      row.appendChild(h("span", "change-text", text));
      const b = h("button", "change-send", action);
      b.type = "button";
      b.addEventListener("click", () => openDraft(text));
      row.appendChild(b);
      box.appendChild(row);
    }
    return box;
  }

  /**
   * Rebuild the thread. Follows the newest message only when you were already
   * at the bottom (or it is your own action); reading further up, your place
   * is kept — a remark arriving while you reach for a button must not move
   * the button out from under the tap (it did, on loki.orangecat.ch).
   */
  function render(follow = false) {
    const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 24;
    const keep = log.scrollTop;
    log.textContent = "";

    const a = opts.assistant();
    if (a === "concierge" && !owner()) {
      for (const g of CONCIERGE_GREETING)
        log.appendChild(
          bubble(`bot from-${g.speaker}`, g.speaker === "cat" ? "Cat" : "Loki", g.text),
        );
    } else {
      log.appendChild(
        bubble(
          "bot from-loki",
          "Loki",
          greetingFor({ assistant: a, owner: owner(), watching: opts.watch()?.on() ?? false }),
        ),
      );
      if (!owner()) log.appendChild(ownerDoor(opts.apiBase, opts.token));
    }
    const lastYou = thread.map((i) => i.kind).lastIndexOf("you");
    thread.forEach((item, idx) => {
      if (item.kind === "you") {
        const m = bubble("user", null, item.text);
        log.appendChild(m);
        // Your own words, as written, are always one tap from the builder —
        // asking Loki first is an offer, never a gate.
        if (idx === lastYou && a !== "none") {
          const act = h(
            "button",
            "act",
            owner() ? "Build this as written" : "Send to builder as written",
          );
          act.type = "button";
          act.addEventListener("click", () => openDraft(item.text));
          log.appendChild(act);
        }
      } else if (item.kind === "loki") {
        const sp = item.speaker ?? "loki";
        log.appendChild(bubble(`bot from-${sp}`, sp === "cat" ? "Cat" : "Loki", item.text));
        if (item.changes?.length)
          log.appendChild(changeBox("Suggested changes", item.changes, sendLabel()));
        if (item.links?.length) {
          const row = h("div", "chatlinks");
          for (const l of item.links) {
            const link = h("a", "chatlink", `${l.label} →`);
            link.href = l.url;
            link.target = "_blank";
            link.rel = "noopener noreferrer";
            row.appendChild(link);
          }
          log.appendChild(row);
        }
      } else if (item.kind === "noticed") {
        // Loki speaking up unasked: what it saw, then what to do about it.
        const m = bubble("bot noticed from-loki", "Loki noticed", item.text);
        if (!item.filed) {
          const row = h("div", "noticed-actions");
          const fix = h("button", "change-send", owner() ? "Fix this →" : "Send to builder →");
          fix.type = "button";
          fix.addEventListener("click", () => openDraft(item.fix));
          const why = h("button", "act", "Why does it matter?");
          why.type = "button";
          why.addEventListener(
            "click",
            () =>
              void ask(
                `Why is this a problem, and how would you fix it? ${item.text}`,
                opts.watch()?.session(),
              ),
          );
          row.append(fix, why);
          m.appendChild(row);
        }
        log.appendChild(m);
      } else {
        const m = bubble(
          "bot sent from-loki",
          "Loki",
          item.owner
            ? item.building
              ? `On it — an agent is building “${item.text}”. It goes live on this site by itself; Loki tells you when.`
              : `Saved “${item.text}”. ${item.note ?? "It waits in Loki under Feedback."}`
            : `Sent to whoever builds this site: “${item.text}”. Thank you.`,
        );
        if (item.claimUrl) {
          const t = h(
            "a",
            "track",
            item.owner ? "Follow the build →" : "Track what happens next →",
          );
          t.href = item.claimUrl;
          t.target = "_blank";
          t.rel = "noopener noreferrer";
          m.appendChild(t);
        }
        log.appendChild(m);
      }
    });
    if (draftOpen) log.appendChild(draftOpen);
    renderStarters();
    log.scrollTop = follow || atBottom ? log.scrollHeight : keep;
  }

  function renderStarters() {
    starters.textContent = "";
    const list = [...STARTERS[opts.assistant()]];
    if (opts.watch()?.on()) list.unshift(REVIEW_QUESTION);
    // Starters are for an empty conversation; after that they are noise.
    const empty = !thread.some((i) => i.kind === "you" || i.kind === "noticed");
    starters.style.display = list.length && (empty || opts.watch()?.on()) ? "" : "none";
    for (const q of empty ? list : list.slice(0, 1)) {
      const b = h(
        "button",
        q === REVIEW_QUESTION ? "starter primary" : "starter",
        q === REVIEW_QUESTION ? "Review what I just did" : q,
      );
      b.type = "button";
      b.addEventListener("click", () => {
        if (q === REVIEW_QUESTION) review();
        else void ask(q);
      });
      starters.appendChild(b);
    }
  }

  function remember(item: ThreadItem) {
    thread = pushItem(thread, item);
    writeThread(opts.token, thread);
  }

  // ---- asking ----
  async function ask(question: string, session?: string) {
    const text = question.trim().slice(0, ASK_MAX);
    if (busy || !text) return;
    const a = opts.assistant();
    if (a === "none") {
      openDraft(text);
      return;
    }
    busy = true;
    sendBtn.disabled = true;
    err.textContent = "";
    remember({ kind: "you", at: Date.now(), text });
    render(true);
    const pending = bubble(
      "bot from-loki pending",
      "Loki",
      session ? "Going through what you did…" : "Looking…",
    );
    log.appendChild(pending);
    log.scrollTop = log.scrollHeight;
    const history = historyFor(thread.slice(0, -1), 12, 3000);
    try {
      const answer: Answer =
        a === "concierge"
          ? await askConcierge({ apiBase: opts.apiBase, token: opts.token, message: text, history })
          : await askAdvisor({
              apiBase: opts.apiBase,
              token: opts.token,
              question: text,
              scope: session ? "page" : scope(),
              selected: opts.picker.selected(),
              history,
              session,
              ownerPass: opts.ownerPass() ?? undefined,
            });
      answer.messages.forEach((m, i) =>
        remember({
          kind: "loki",
          at: Date.now(),
          speaker: m.speaker,
          text: m.text,
          // Changes and links follow the last speaker's words.
          ...(i === answer.messages.length - 1 && answer.changes.length
            ? { changes: answer.changes }
            : {}),
          ...(i === answer.messages.length - 1 && answer.links.length
            ? { links: answer.links }
            : {}),
          ...(answer.degraded ? { degraded: true } : {}),
        }),
      );
    } catch (e) {
      // No dead end: the question is still in the thread, one tap from the builder.
      err.textContent = e instanceof Error ? e.message : "Could not reach Loki — try again.";
    } finally {
      busy = false;
      syncContext();
      render(true);
      sendBtn.disabled = !input.value.trim();
    }
  }

  async function submit() {
    const text = input.value.trim();
    if (!text || busy) return;
    input.value = "";
    sendBtn.disabled = true;
    await ask(text);
  }

  function review() {
    const w = opts.watch();
    if (!w) return;
    void ask(REVIEW_QUESTION, w.session());
  }

  // ---- sending to the builder: a confirmation card in the thread ----
  function openDraft(text: string, diagnostics: ReportDiagnostics | null = null) {
    const diag = diagnostics ?? (owner() ? (opts.watch()?.diagnostics() ?? null) : null);
    const card = h("div", "sendcard");
    card.appendChild(
      h(
        "div",
        "changes-title",
        owner() ? "Build this on your site" : "Send to whoever builds this site",
      ),
    );
    const box = h("textarea", "chatinput");
    box.maxLength = MAX_LEN;
    box.value = text.slice(0, MAX_LEN);
    card.appendChild(box);
    const contact = h("input");
    contact.type = "text";
    contact.placeholder = "Your name / email (optional)";
    contact.maxLength = 200;
    contact.autocomplete = "off";
    // Loki already knows who the owner is.
    if (!owner()) card.appendChild(contact);
    const extras = [
      opts.picker.selected().length ? `${opts.picker.selected().length} picked element(s)` : "",
      attachments.shots().length ? `${attachments.shots().length} screenshot(s)` : "",
      diag && formatDiagnostics(diag) ? "the steps that led here" : "",
    ].filter(Boolean);
    if (extras.length) {
      const note = h("div", "diag", `Goes with it: ${extras.join(", ")}`);
      note.style.display = "block";
      if (diag) note.title = formatDiagnostics(diag);
      card.appendChild(note);
    }
    const row = h("div", "row");
    const go = h("button", "go", owner() ? "Build it" : "Send");
    go.type = "button";
    const cancel = h("button", "ghost", "Cancel");
    cancel.type = "button";
    const cardErr = h("div", "err");
    row.append(go, cancel);
    card.append(row, cardErr);
    cancel.addEventListener("click", () => {
      draftOpen = null;
      render();
      input.focus();
    });
    go.addEventListener("click", async () => {
      const body = box.value.trim();
      if (!body) return;
      go.disabled = true;
      go.textContent = "Sending…";
      cardErr.textContent = "";
      const selected: SelectedEl[] = opts.picker.selected();
      try {
        const pass = opts.ownerPass();
        const res = await sendReport(opts.apiBase, {
          token: opts.token,
          suggestion: buildSuggestion(body, diag, MAX_LEN),
          contact: contact.value,
          scope: scope(),
          screenshots: attachments.shots(),
          selectedElements: selected,
          ownerPass: pass ?? undefined,
        });
        if (pass && !res.owner) opts.onPassRefused();
        draftOpen = null;
        attachments.reset();
        attachments.render();
        opts.picker.clearSelection();
        remember({
          kind: "sent",
          at: Date.now(),
          text: body.slice(0, 300),
          owner: res.owner === true,
          ...(res.building ? { building: true } : {}),
          ...(res.buildNote ? { note: res.buildNote } : {}),
          // One link either way: a visitor tracks their report, the owner
          // follows the build Loki just started.
          ...(res.claimUrl || res.followUrl ? { claimUrl: res.followUrl ?? res.claimUrl } : {}),
        });
        syncContext();
        render(true);
      } catch (e) {
        go.disabled = false;
        go.textContent = owner() ? "Build it" : "Send";
        cardErr.textContent = e instanceof Error ? e.message : "Could not send — try again.";
      }
    });
    draftOpen = card;
    render(true);
    box.focus();
    box.setSelectionRange(box.value.length, box.value.length);
  }

  syncContext();
  render(true);

  return {
    el,
    input,
    focus: () => input.focus(),
    /** Re-read who is speaking (owner/visitor) and what is picked. */
    /** `follow`: jump to the newest message (opening the panel to see it). */
    refresh: (follow = false) => {
      syncContext();
      render(follow);
    },
    ask: (q: string) => void ask(q),
    review,
    /** Host page's report(): straight to the confirmation, prefilled. */
    draft: (message: string, diagnostics: ReportDiagnostics | null) =>
      openDraft(message, diagnostics),
    /** Watch noticed something: Loki says it in the thread, with Fix this. */
    noticed: (remark: { say: string; fix: string; filed?: boolean }) => {
      remember({
        kind: "noticed",
        at: Date.now(),
        text: remark.say,
        fix: remark.fix,
        ...(remark.filed ? { filed: true } : {}),
      });
      render();
    },
    /** Loki says something unprompted (e.g. "this site is not yours"). */
    say: (text: string, links?: Link[]) => {
      remember({ kind: "loki", at: Date.now(), speaker: "loki", text, links });
      render(true);
    },
    /** Closing the panel: stop the mic; the thread itself is kept. */
    close: () => {
      voice?.recorder.cancel();
      draftOpen = null;
      err.textContent = "";
    },
    /** Enter asks, Shift+Enter is a newline. */
    onKey(e: KeyboardEvent): boolean {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.composedPath().includes(input)) {
        e.preventDefault();
        void submit();
        return true;
      }
      return false;
    },
  };
}

export type Conversation = ReturnType<typeof createConversation>;
