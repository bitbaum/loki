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
import { h, spiralMark, keepInViewOnFocus, micIcon } from "./dom";
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
import { receiptFull, receiptLinkLabel, receiptText } from "./receipt";
import {
  CONCIERGE_GREETING,
  MAX_LEN,
  createConversationModel,
  startersFor,
  type ConversationWatch,
  type Draft,
} from "./conversation-model";
import { kitState, noticedExtras, noticedText, sentFull } from "./conversation-kit";
import { heardLine } from "./walk-read";
import {
  itemCounts,
  itemsList,
  noteExtras,
  noteGuide,
  noteLabels,
  noteQuestion,
  showsRead,
} from "./voice-note-card";
import type { KitHandle, KitModule } from "./chat/contract";

export { MAX_LEN, type ConversationWatch };

const MAX_SCREENSHOTS = 5;
/** Stop recording under the server's ~2 min upload cap. */
const VOICE_MAX_MS = 110_000;

/** Who is speaking, as the passes say — handed on to the model unchanged. */
function passesOf(o: Parameters<typeof createConversation>[0]) {
  const { ownerPass, onPassRefused, memberPass, onMemberRefused } = o;
  return { ownerPass, onPassRefused, memberPass, onMemberRefused };
}

export function createConversation(opts: {
  apiBase: string;
  token: string;
  assistant: () => Assistant;
  /** The owner pass, while the server still honours it. */
  ownerPass: () => string | null;
  /** The server refused the pass (expired, revoked): stop presenting it. */
  onPassRefused: () => void;
  /** A project member's pass (member-pass.ts): their notes are theirs. */
  memberPass?: () => string | null;
  onMemberRefused?: () => void;
  picker: Picker;
  watch: () => ConversationWatch | null;
  /** Loki is working on an answer (true) or done (false) — the header's
   *  spiral spins while it thinks. */
  onBusy?: (busy: boolean) => void;
  /** A note was filed — Your changes refreshes to show where it went. */
  onSent?: () => void;
  /** What Loki already did about a remark's key (widget/changes.ts). */
  known?: (key: string) => KnownFix | null;
  /** Talk while scrolling (browse-voice.ts). When given, it IS the composer's
   *  microphone: one mic in the panel, not a header "Voice note" beside a
   *  composer "Record" that did nearly the same thing (2026-10-17). */
  talk?: () => void;
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
    ...passesOf(opts),
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
  // Two ways to say it, side by side (Fix it / Ask): neither hides the other.
  const sendBtn = Object.assign(h("button", "go"), { type: "button", disabled: true });
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
  const {
    voice,
    talk: talkBtn,
    button: micBtn,
  } = composerMic({
    ...opts,
    onText: (text) => {
      input.value = mergeTranscript(input.value, text, MAX_LEN);
      syncButtons();
      input.focus();
    },
    onError: (m) => (err.textContent = m),
  });
  const tools = h("div", "tools");
  if (micBtn) tools.append(micBtn);
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
    // Each choice says what it is about, in the box itself.
    input.placeholder = loki
      ? "What should be better about this panel?"
      : a === "none"
        ? "What should change?"
        : now === "element"
          ? "Ask about the area you picked, or say what should change…"
          : now === "site"
            ? "Ask about the whole site, or say what should change across it…"
            : "Ask about this page, or say what should change…";
    // With no AI on this embed, feedback is the only way, so it leads.
    // About Loki itself there is no site to advise on and nothing to build
    // here: one way, and it leads.
    // Two words, two intents — long labels read like a form (2026-10-17).
    feedbackLabel = loki ? "Send to Loki" : owner() ? "Fix it" : "Save feedback";
    feedbackBtn.textContent = feedbackLabel;
    feedbackBtn.className = a === "none" || loki ? "go feedback" : "ghost feedback";
    sendBtn.textContent = "Ask";
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
    // A card drawn for the first time is brought into view from its top:
    // a long spoken note under three remarks was found only by scrolling
    // (2026-10-18). Redrawn for its read, it keeps the place.
    let cardIsNew = false;
    let cardDrawn = false;
    if (draft) {
      if (card?.draft !== draft) {
        cardIsNew = !card;
        cardDrawn = true;
        const root = log.getRootNode() as ShadowRoot | Document;
        const typing = !!card && card.el.contains(root.activeElement);
        card = { draft, el: draftCard(draft, cardIsNew || typing) };
      }
    } else card = null;
    if (kit) return kit.update(currentKitState());
    const reviewingNote = draft?.intent === "note";
    form.style.display = reviewingNote ? "none" : "";
    // The continue row decides for itself whether there is anything to take.
    if (reviewingNote) cont.el.style.display = "none";
    else cont.sync();
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
      if (talkBtn && !thread.some(saidSomething)) log.appendChild(talkHero(opts.talk!));
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
        const full = receiptFull(item);
        if (full) m.appendChild(sentFull(full));
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
    if (cardDrawn && card && reviewingNote)
      log.scrollTop += card.el.getBoundingClientRect().top - log.getBoundingClientRect().top - 8;
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
  function draftCard(draft: Draft, takeFocus = true): HTMLElement {
    const el = h("div", draft.intent === "note" ? "sendcard voice-note" : "sendcard");
    const voice = draft.intent === "note";
    const showingRead = voice && showsRead(draft);
    // "Did it hear me?" is answered first: how long, and across which pages.
    el.appendChild(
      h(
        "div",
        "changes-title",
        voice
          ? heardLine(draft.moments ?? [], draft.spokenMs)
          : owner()
            ? "Build this on your site"
            : "Send to whoever builds this site",
      ),
    );
    if (voice) el.appendChild(h("p", "sendcard-sub", noteGuide(draft, owner())));
    const box = h("textarea", showingRead ? "chatinput read" : "chatinput");
    box.maxLength = MAX_LEN;
    box.value = draft.text;
    box.addEventListener("input", () => model.editDraft(box.value));
    // A spoken note is read before it is sent: show it whole, up to the cap
    // in theme.ts, rather than a five-line window onto two minutes of talk.
    if (voice)
      box.rows = Math.min(
        24,
        Math.max(
          showingRead ? 3 : 6,
          draft.text.split("\n").length + Math.ceil(draft.text.length / 60),
        ),
      );
    // Read as a list, the list is the note; the words in one box come back
    // with "Use my exact words instead".
    if (showingRead) box.style.display = "none";
    el.append(...(showingRead ? [itemsList(draft, model.editItem, model.dropItem)] : []), box);
    el.append(...noteExtras(draft, () => model.useExactWords()));
    const contact = h("input");
    contact.type = "text";
    contact.placeholder = "Your email, to hear when it's fixed (optional)";
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
    const row = h("div", "row sendcard-actions");
    // A voice note: Ask first — talking to Loki is what the panel is for —
    // then send it as a change, then (owner) keep it for later.
    // The owner records while Loki watches and builds later (2026-10-18), so
    // their spoken note leads with Save; a visitor's leads with Ask.
    // A question is answered by Ask, whoever asked it.
    const question = showingRead && !itemCounts(draft).changes;
    const labels = noteLabels(draft, owner());
    const saveFirst = voice && owner() && !question;
    const askFirst = voice && !saveFirst;
    const askBtn = voice ? h("button", askFirst ? "go" : "ghost outline", labels.ask) : null;
    if (askBtn) askBtn.type = "button";
    const sendLabel = voice ? labels.save : owner() ? "Build it" : "Send";
    const go = h("button", voice && !saveFirst ? "ghost outline" : "go", sendLabel);
    go.type = "button";
    const requestFix =
      voice && owner() && !question ? h("button", "ghost outline", labels.fix) : null;
    if (requestFix) requestFix.type = "button";
    const cancel = h("button", "ghost", voice ? "Discard" : "Cancel");
    cancel.type = "button";
    const cardErr = h("div", "err");
    const order = saveFirst ? [go, requestFix, askBtn] : [askBtn, requestFix, go];
    row.append(...order.filter((b): b is HTMLButtonElement => !!b), cancel);
    el.append(row, cardErr);
    askBtn?.addEventListener("click", () => {
      const text = noteQuestion(draft, box.value.trim());
      if (!text) return;
      // Asked about the whole walk, not only the page the panel is open on.
      model.askAboutNote(text);
    });
    cancel.addEventListener("click", () => {
      model.closeDraft();
      focus();
    });
    const send = async (intent?: "note" | "fix") => {
      const body = box.value.trim();
      if (!body) return;
      if (!showingRead && body.length > MAX_LEN) {
        cardErr.textContent = `This note is longer than ${MAX_LEN} characters. Shorten it before sending; your full recording text is kept here.`;
        return;
      }
      go.disabled = true;
      if (requestFix) requestFix.disabled = true;
      go.textContent = "Sending…";
      cardErr.textContent = "";
      try {
        if (showingRead) await model.sendItems(contact.value, intent);
        else await model.sendDraft(body, contact.value, intent);
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
    // Not when the card is only redrawn for Loki's read: on a phone that would
    // throw the keyboard up over the card a second time.
    if (takeFocus)
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
      tools: talkBtn,
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
        // Talk replaces chatkit's own dictation: one microphone, not two.
        transcribe: talkBtn
          ? undefined
          : (audio) => transcribeAudio(`${opts.apiBase}/api/widget/transcribe`, opts.token, audio),
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
    kit: () => kit !== null, // true once the shared chat draws the conversation
    /** Re-read who speaks and what is picked; `follow` jumps to the newest. */
    refresh: (follow = false) => {
      syncContext();
      render(follow);
    },
    ask: (q: string) => model.ask(q),
    review: model.review,
    /** Host page's report(): straight to the confirmation, prefilled. */
    draft: (message: string, diagnostics: ReportDiagnostics | null) =>
      model.openDraft(message, diagnostics),
    hasDraft: () => !!model.snapshot().draft,
    /** The rules and state underneath (conversation-model.ts): what Watch
     *  says or takes back, Loki on itself, the open card's changes. */
    model,
    /** Bring the open card into view (the header's "not saved yet" row). */
    showDraft: () => card?.el.scrollIntoView({ block: "start", behavior: "smooth" }),
    recorded: (...args: Parameters<typeof model.recorded>) => {
      model.recorded(...args);
      focus();
    },
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
    noticedText(item, deps.known),
  );
  const extras = noticedExtras(item, deps.known, deps.owner, deps.onFix, deps.onWhy);
  if (extras) m.appendChild(extras);
  return m;
}

/**
 * The composer's ONE microphone: Talk (talk while scrolling, browse-voice.ts)
 * when the panel offers it, else plain dictation into the box.
 */
function composerMic(o: {
  apiBase: string;
  token: string;
  talk?: () => void;
  onText: (text: string) => void;
  onError: (message: string) => void;
}): {
  voice: ReturnType<typeof createVoiceControl>;
  talk: HTMLButtonElement | null;
  button: HTMLButtonElement | null;
} {
  if (o.talk) {
    const talk = talkButton(o.talk);
    return { voice: null, talk, button: talk };
  }
  const voice = createVoiceControl({
    endpoint: `${o.apiBase}/api/widget/transcribe`,
    token: o.token,
    maxMs: VOICE_MAX_MS,
    onTranscript: o.onText,
    onError: o.onError,
  });
  return { voice, talk: null, button: voice?.button ?? null };
}

/** The person has said or sent something — no more invitation to start. */
const saidSomething = (i: { kind: string }) => i.kind === "you" || i.kind === "sent";

/**
 * The way in before anything is said: one big, friendly button. Typing is
 * there too, but talking while you scroll is the quickest way to say what
 * you would change — and the one people did not find as a small mic among
 * the composer's tools (owner, 2026-10-18: "easy, pleasant, exciting").
 */
function talkHero(talk: () => void): HTMLButtonElement {
  const b = h("button", "talk-hero");
  b.type = "button";
  const mic = h("span", "talk-hero-mic");
  mic.append(micIcon());
  const words = h("span", "talk-hero-words");
  words.append(
    h("span", "talk-hero-title", "Talk to Loki"),
    h("span", "talk-hero-sub", "Scroll around and say what you'd change. Loki writes it down."),
  );
  b.append(mic, words);
  b.addEventListener("click", talk);
  return b;
}

/** The composer's microphone when talking hands over to the page: it closes
 *  the panel so the person can scroll while they speak. */
function talkButton(talk: () => void): HTMLButtonElement {
  const b = h("button", "mic talk");
  b.type = "button";
  b.append(micIcon(), h("span", undefined, "Talk"));
  b.setAttribute("aria-label", "Talk to Loki — you can scroll the page while you speak");
  b.title = "Talk to Loki — you can scroll the page while you speak";
  b.addEventListener("click", talk);
  return b;
}
