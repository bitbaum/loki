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
import { h, spiralMark, keepInViewOnFocus } from "./dom";
import { createAboutBar } from "./about-bar";
import { answerLinks, richBody } from "./rich-text";
import { suggestionBox } from "./suggestions";
import type { Picker } from "./picker";
import { createAttachments } from "./attachments";
import { createVoiceControl } from "./voice-control";
import { mergeTranscript, transcribeAudio } from "./voice";
import { formatDiagnostics, type ReportDiagnostics } from "./report-payload";
import type { KnownFix } from "./known-fixes";
import { REVIEW_QUESTION } from "./loki-api";
import type { Assistant, Link, ThreadItem } from "./thread";
import { createContinueRow } from "./continue-row";
import { greetingFor, ownerDoor } from "./greeting";
import { receiptLinkLabel, receiptText } from "./receipt";
import {
  CONCIERGE_GREETING,
  MAX_LEN,
  createConversationModel,
  startersFor,
  type ConversationWatch,
  type Draft,
} from "./conversation-model";
import { kitState, noticedExtras } from "./conversation-kit";
import type { KitHandle, KitModule } from "./chat/contract";

export { MAX_LEN, type ConversationWatch };

const MAX_SCREENSHOTS = 5;
/** Stop recording under the server's ~2 min upload cap. */
const VOICE_MAX_MS = 110_000;

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
  /** Loki is working on an answer (true) or done (false) — the header's
   *  spiral spins while it thinks. */
  onBusy?: (busy: boolean) => void;
  /** A note was filed — Your changes refreshes to show where it went. */
  onSent?: () => void;
  /** What Loki already did about a remark's key (widget/changes.ts). */
  known?: (key: string) => KnownFix | null;
}) {
  const el = h("div", "convo");
  const log = h("div", "chatlog");
  log.setAttribute("role", "log");
  log.setAttribute("aria-live", "polite");
  const starters = h("div", "starters");

  // What the next message is about (about-bar.ts): the chips, and whether
  // it is about the site at all or about Loki itself.
  const ctx = createAboutBar({
    picked: () => opts.picker.selected().length,
    onPick: () => opts.picker.start(),
    onChange: () => {
      opts.picker.clearSelection();
      syncContext();
    },
  });

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

  // Drawn by the shared chat (useKit) once its chunk has loaded: screenshots
  // are attached in chatkit's composer and held here for the next note.
  let kit: KitHandle | null = null;
  let kitShots: string[] = [];
  const shotsNow = () => (kit ? kitShots : attachments.shots());

  // The rules and the calls (conversation-model.ts); this file draws them.
  const model = createConversationModel({
    apiBase: opts.apiBase,
    token: opts.token,
    assistant: opts.assistant,
    ownerPass: opts.ownerPass,
    onPassRefused: opts.onPassRefused,
    picker: opts.picker,
    watch: opts.watch,
    about: () => ctx.about(),
    scope: () => ctx.scope(),
    screenshots: {
      list: shotsNow,
      clear: () => {
        kitShots = [];
        attachments.reset();
        attachments.render();
      },
    },
    onBusy: opts.onBusy,
    onSent: opts.onSent,
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
  sendBtn.addEventListener("click", () => submit());
  const feedbackBtn = h("button", "ghost feedback");
  feedbackBtn.type = "button";
  feedbackBtn.disabled = true;
  feedbackBtn.addEventListener("click", () => {
    const text = input.value.trim();
    if (!text) return;
    input.value = "";
    syncButtons();
    model.build(text);
  });
  const syncButtons = () => {
    const empty = !input.value.trim();
    sendBtn.disabled = model.snapshot().pending !== null || empty;
    feedbackBtn.disabled = empty;
  };
  input.addEventListener("input", syncButtons);
  keepInViewOnFocus(input);
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
  // One card: what it is about, the words, the screenshots, then the ways to
  // send it. "About" used to be its own bordered bar floating above a
  // free-standing textarea — two boxes for one sentence.
  const form = h("div", "composer");
  form.append(ctx.el, input, shots, actions);

  // The way out of the card and into Loki itself (continue-row.ts).
  const cont = createContinueRow({
    apiBase: opts.apiBase,
    token: opts.token,
    thread: () => [...model.snapshot().thread],
    owner: () => opts.ownerPass() !== null,
  });
  el.append(log, starters, form, cont.el, err);

  attachments.listenPaste(el);

  const owner = () => opts.ownerPass() !== null;
  let feedbackLabel = "Save feedback";

  function syncContext() {
    ctx.sync();
    const now = ctx.about();
    const loki = now === "loki";
    const a = opts.assistant();
    input.placeholder = loki
      ? "What should be better about this panel?"
      : now === "element"
        ? "What about what you picked?"
        : owner()
          ? "Message Loki about this site…"
          : a === "none"
            ? "What should change?"
            : "Message Loki about this site…";
    // With no AI on this embed, feedback is the only way, so it leads.
    // About Loki itself there is no site to advise on and nothing to build
    // here: one way, and it leads.
    feedbackLabel = loki ? "Send to Loki" : owner() ? "Request a fix" : "Save feedback";
    feedbackBtn.textContent = feedbackLabel;
    feedbackBtn.className = a === "none" || loki ? "go feedback" : "ghost feedback";
    sendBtn.textContent = "Chat with Loki";
    sendBtn.style.display = a === "none" || loki ? "none" : "";
    cont.sync();
  }

  // ---- rendering ----
  function bubble(cls: string, who: string | null, text: string): HTMLElement {
    const m = h("div", `msg ${cls}`);
    // The header already names the assistant. Repeating "Loki" above each
    // answer makes the embed look like two products stacked together; keep a
    // speaker label only for the multi-voice concierge conversation.
    if (who && (who !== "Loki" || opts.assistant() === "concierge"))
      m.appendChild(h("span", "who", who));
    if (text) m.appendChild(h("span", "said", text));
    return m;
  }

  // The open confirmation card keeps its own inputs across re-renders: the
  // model holds what it is about, the DOM holds what is being typed.
  let card: { draft: Draft; el: HTMLElement } | null = null;
  let shownError = "";

  /**
   * Rebuild the thread. Follows the newest message only when you were already
   * at the bottom (or it is your own action); reading further up, your place
   * is kept — a remark arriving while you reach for a button must not move
   * the button out from under the tap (it did, on loki.orangecat.ch).
   */
  function render(follow = false) {
    const { thread, pending, error, draft } = model.snapshot();
    if (draft) {
      if (card?.draft !== draft) card = { draft, el: draftCard(draft) };
    } else card = null;
    if (kit) return kit.update(currentKitState());
    const reviewingNote = draft?.intent === "note";
    form.style.display = cont.el.style.display = reviewingNote ? "none" : "";
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
          act.addEventListener("click", () => model.build(item.text));
          log.appendChild(act);
        }
      } else if (item.kind === "loki") {
        const sp = item.speaker ?? "loki";
        // Loki's own words, with structure (rich-text.ts) — text nodes only.
        const said = bubble(`bot from-${sp}`, sp === "cat" ? "Cat" : "Loki", "");
        said.appendChild(richBody(item.text));
        log.appendChild(said);
        if (item.changes?.length)
          log.appendChild(
            suggestionBox({
              items: item.changes,
              owner: owner(),
              onBuild: model.build,
              onEdit: model.openDraft,
            }),
          );
        if (item.links?.length) log.appendChild(answerLinks(item.links));
      } else if (item.kind === "noticed") {
        const m = noticedCard(item, {
          bubble,
          known: item.key ? (opts.known?.(item.key) ?? null) : null,
          owner: owner(),
          onFix: () => model.build(item.fix, item.key),
          onWhy: () =>
            model.ask(
              `Why is this a problem, and how would you fix it? ${item.text}`,
              opts.watch()?.session(),
            ),
        });
        log.appendChild(m);
      } else {
        const m = bubble("bot sent from-loki", "Loki", receiptText(item));
        if (item.claimUrl) {
          const t = h("a", "track", receiptLinkLabel(item));
          t.href = item.claimUrl;
          t.target = "_blank";
          t.rel = "noopener noreferrer";
          m.appendChild(t);
        }
        log.appendChild(m);
      }
    });
    if (pending) {
      const p = bubble(
        "bot from-loki pending",
        "Loki",
        pending.review ? "Going through what you did…" : "Looking…",
      );
      p.querySelector(".who")?.prepend(spiralMark("thinking"));
      log.appendChild(p);
    }
    if (card) log.appendChild(card.el);
    // The line is shared with the screenshot tray and the mic, which write
    // their own errors: the model's replaces it only when the model's changes.
    if (error !== shownError) err.textContent = shownError = error;
    renderStarters();
    if (reviewingNote) starters.style.display = "none";
    syncButtons();
    log.scrollTop = follow || atBottom ? log.scrollHeight : keep;
  }

  function renderStarters() {
    starters.textContent = "";
    const { list } = startersFor(
      opts.assistant(),
      model.snapshot().thread,
      opts.watch()?.on() ?? false,
    );
    starters.style.display = list.length ? "" : "none";
    for (const q of list) {
      const b = h(
        "button",
        q === REVIEW_QUESTION ? "starter primary" : "starter",
        q === REVIEW_QUESTION ? "Review my last few minutes" : q,
      );
      b.type = "button";
      b.addEventListener("click", () => {
        if (q === REVIEW_QUESTION) model.review();
        else model.ask(q);
      });
      starters.appendChild(b);
    }
  }

  function submit() {
    const text = input.value.trim();
    if (!text || model.snapshot().pending) return;
    input.value = "";
    sendBtn.disabled = true;
    model.ask(text);
  }

  /** The confirmation card: what goes to the builder, edited before it does. */
  function draftCard(draft: Draft): HTMLElement {
    const el = h("div", draft.intent === "note" ? "sendcard voice-note" : "sendcard");
    el.appendChild(
      h(
        "div",
        "changes-title",
        draft.intent === "note"
          ? "Review your voice note"
          : owner()
            ? "Build this on your site"
            : "Send to whoever builds this site",
      ),
    );
    const box = h("textarea", "chatinput");
    box.maxLength = MAX_LEN;
    box.value = draft.text;
    box.addEventListener("input", () => model.editDraft(box.value));
    el.appendChild(box);
    if (draft.capture)
      el.appendChild(
        h(
          "p",
          "diag",
          `About ${draft.capture.page}${draft.capture.selected.length ? ` · ${draft.capture.selected.map((item) => item.elementText).join(", ")}` : ""}`,
        ),
      );
    const contact = h("input");
    contact.type = "text";
    contact.placeholder = "Your name / email (optional)";
    contact.maxLength = 200;
    contact.autocomplete = "off";
    // Loki already knows who the owner is.
    if (!owner()) el.appendChild(contact);
    const diag = draft.diagnostics;
    const extras = [
      (draft.capture?.selected ?? opts.picker.selected()).length
        ? `${(draft.capture?.selected ?? opts.picker.selected()).length} picked element(s)`
        : "",
      shotsNow().length ? `${shotsNow().length} screenshot(s)` : "",
      diag && formatDiagnostics(diag)
        ? draft.capture
          ? "page position when recorded"
          : "the steps that led here"
        : "",
    ].filter(Boolean);
    if (extras.length && !draft.capture) {
      const note = h("div", "diag", `Goes with it: ${extras.join(", ")}`);
      note.style.display = "block";
      if (diag) note.title = formatDiagnostics(diag);
      el.appendChild(note);
    }
    const row = h("div", "row");
    const sendLabel = draft.intent === "note" ? "Save note" : owner() ? "Build it" : "Send";
    const go = h("button", "go", sendLabel);
    go.type = "button";
    const requestFix =
      owner() && draft.intent === "note" ? h("button", "ghost", "Request fix") : null;
    if (requestFix) requestFix.type = "button";
    const cancel = h("button", "ghost", "Cancel");
    cancel.type = "button";
    const cardErr = h("div", "err");
    row.append(go);
    if (requestFix) row.append(requestFix);
    row.append(cancel);
    el.append(row, cardErr);
    cancel.addEventListener("click", () => {
      model.closeDraft();
      focus();
    });
    const send = async (intent?: "note" | "fix") => {
      const body = box.value.trim();
      if (!body) return;
      if (body.length > MAX_LEN) {
        cardErr.textContent = `This note is longer than ${MAX_LEN} characters. Shorten it before sending; your full recording text is kept here.`;
        return;
      }
      go.disabled = true;
      if (requestFix) requestFix.disabled = true;
      go.textContent = "Sending…";
      cardErr.textContent = "";
      try {
        await model.sendDraft(body, contact.value, intent);
      } catch (e) {
        go.disabled = false;
        if (requestFix) requestFix.disabled = false;
        go.textContent = sendLabel;
        cardErr.textContent = e instanceof Error ? e.message : "Could not send — try again.";
      }
    };
    go.addEventListener("click", () => void send());
    requestFix?.addEventListener("click", () => void send("fix"));
    // Focus the words once the card is in the thread.
    queueMicrotask(() => {
      box.focus();
      box.setSelectionRange(box.value.length, box.value.length);
    });
    return el;
  }

  let door: HTMLElement | null = null;
  function currentKitState() {
    door ??= ownerDoor(opts.apiBase, opts.token);
    return kitState({
      model,
      assistant: opts.assistant(),
      owner: owner(),
      about: ctx.about(),
      watch: opts.watch(),
      placeholder: input.placeholder,
      feedbackLabel,
      known: (key) => opts.known?.(key) ?? null,
      ownerDoor: () => door as HTMLElement,
      draftCard: card?.el ?? null,
      header: ctx.el,
      footer: cont.el,
      held: kitShots.length,
    });
  }

  const focus = () => {
    const draftInput = card?.el.querySelector("textarea");
    if (draftInput) draftInput.focus({ preventScroll: true });
    else if (kit) kit.focus();
    else input.focus();
  };

  /**
   * Draw the conversation with the shared chat (widget/chat/, loaded as its own
   * chunk). The vanilla thread and composer step aside; the scope menu and
   * Continue in Loki move into chatkit's composer slots. Same model, same rules.
   */
  function useKit(mod: KitModule, vars: string) {
    if (kit) return;
    const host = h("div", "kit-host");
    // chatkit's composer takes pasted screenshots itself; the panel's own tray
    // (listening on the whole conversation) must not take a second copy.
    host.addEventListener("paste", (e) => e.stopPropagation());
    log.style.display = starters.style.display = form.style.display = "none";
    err.style.display = "none";
    el.prepend(host);
    syncContext();
    kit = mod.mount(
      host,
      {
        send: (mode, text) => {
          model.clearError();
          if (mode === "ask") model.ask(text);
          else model.build(text);
        },
        stage: (images) => {
          kitShots = [...kitShots, ...images].slice(-MAX_SCREENSHOTS);
          render();
        },
        transcribe: (audio) =>
          transcribeAudio(`${opts.apiBase}/api/widget/transcribe`, opts.token, audio),
        vars,
      },
      currentKitState(),
    );
  }

  model.subscribe((follow) => {
    syncContext();
    render(follow);
  });
  syncContext();
  render(true);

  return {
    el,
    input,
    focus,
    useKit,
    /** True once the shared chat draws the conversation. */
    kit: () => kit !== null,
    /** Re-read who is speaking (owner/visitor) and what is picked. */
    /** `follow`: jump to the newest message (opening the panel to see it). */
    refresh: (follow = false) => {
      syncContext();
      render(follow);
    },
    ask: (q: string) => model.ask(q),
    review: model.review,
    /** Host page's report(): straight to the confirmation, prefilled. */
    draft: (message: string, diagnostics: ReportDiagnostics | null) =>
      model.openDraft(message, diagnostics),
    /** Watch noticed something: Loki says it in the thread, with Fix this. */
    hasDraft: () => !!model.snapshot().draft,
    recorded: (...args: Parameters<typeof model.recorded>) => {
      model.recorded(...args);
      focus();
    },
    noticed: model.noticed,
    /** Loki on Loki (self-watch.ts) — quiet: never moves your reading place. */
    selfNote: model.selfNote,
    /** Loki says something unprompted (e.g. "this site is not yours"). */
    say: (text: string, links?: Link[]) => model.say(text, links),
    /** Closing the panel: stop the mic; the thread itself is kept. */
    close: () => {
      voice?.recorder.cancel();
      model.close();
      card = null;
      err.textContent = "";
    },
    /** Enter asks, Shift+Enter is a newline. */
    onKey(e: KeyboardEvent): boolean {
      if (e.key === "Enter" && !e.shiftKey && !e.isComposing && e.composedPath().includes(input)) {
        e.preventDefault();
        submit();
        return true;
      }
      return false;
    },
  };
}

export type Conversation = ReturnType<typeof createConversation>;

/**
 * Loki speaking up unasked: what it saw, then what to do about it. A finding
 * Loki already filed a fix for shows where that fix is instead of a second
 * "Fix this" (known-fixes.ts); one fixed and back says so and offers "Fix
 * again".
 */
function noticedCard(
  item: Extract<ThreadItem, { kind: "noticed" }>,
  deps: {
    bubble: (cls: string, who: string | null, text: string) => HTMLElement;
    known: KnownFix | null;
    owner: boolean;
    onFix: () => void;
    onWhy: () => void;
  },
): HTMLElement {
  const m = deps.bubble(
    "bot noticed from-loki",
    item.again ? "Loki noticed — again" : "Loki noticed",
    item.again ? `${item.text}\n\nLoki fixed this before. It is back.` : item.text,
  );
  const extras = noticedExtras(item, deps.known, deps.owner, deps.onFix, deps.onWhy);
  if (extras) m.appendChild(extras);
  return m;
}
