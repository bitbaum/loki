/**
 * The conversation's state and every call it makes — no DOM.
 *
 * Split out of conversation.ts so the panel can be drawn by more than one view
 * (the vanilla DOM view in conversation.ts today; the shared chat, chatkit,
 * next — docs/architecture/feedback-widget.md) without either one owning the
 * rules. Everything a view needs is in `snapshot()`; everything it can do is a
 * method here; it learns of changes through `subscribe()`.
 *
 * What stays in the view: the scope menu, the screenshots tray, the picker
 * and the inputs — they reach the model only as the readers passed in `opts`.
 */
import { CAPTURE_CONTEXT_LIMITS } from "./capture-context";
import type { FeedbackCapture } from "./feedback-capture";
import { clampMoments, type ReportMoment } from "./moments-contract";
import { cleanWalkRead, walkSession, type WalkItem, type WalkRead } from "./walk-read";
import { understandNote } from "./loki-api";
import { buildSuggestion, type ReportDiagnostics } from "./report-payload";
import { sendReport } from "./send-report";
import { sendSelfReport } from "./self-report";
import {
  ADVISE_MAX_QUESTION,
  askAdvisor,
  askConcierge,
  REVIEW_QUESTION,
  type Answer,
} from "./loki-api";
import {
  dropNoticed,
  historyFor,
  pushItem,
  pushNoticed,
  restoreThread,
  type Assistant,
  type Link,
  type ThreadItem,
} from "./thread";
import type { About } from "./about-bar";
import type { Picker } from "./picker";

/** The ingest's cap on `suggestion` (api/feedback FeedbackBody). */
export const MAX_LEN = 2000;
/** A spoken question can run two minutes; the server takes what the widget sends. */
export const ASK_MAX = ADVISE_MAX_QUESTION;

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

export const CONCIERGE_GREETING = [
  {
    speaker: "cat" as const,
    text: "Ask about earning, selling or getting paid in Bitcoin.",
  },
  {
    speaker: "loki" as const,
    text: "Ask about building or running something, or improving this site.",
  },
];

export const STARTERS: Record<Assistant, string[]> = {
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
  /** Record that the owner talked to Loki, so Review does not read the time
   *  as the site doing nothing. Optional: a view without Watch has none. */
  talked?: (text: string) => void;
};

/** A confirmation card in the thread: what will be sent, before it is. */
export type Draft = {
  text: string;
  diagnostics: ReportDiagnostics | null;
  capture?: FeedbackCapture;
  intent?: "note" | "fix";
  /** What was seen while each thing was said (voice-moments.ts). */
  moments?: ReportMoment[];
  /** A spoken note: the words exactly as transcribed (the box may hold Loki's read of them). */
  verbatim?: string;
  /** How long the person talked. */
  spokenMs?: number;
  /** Loki's read of a spoken note (walk-read.ts), once it is back. */
  read?: WalkRead;
  /** The read's list as the person edits it; absent shows the words in one box. */
  items?: WalkItem[];
  /** The read is on its way — the card works without it in the meantime. */
  reading?: boolean;
};

/**
 * Changes said but not saved yet: a spoken note's change lines while its card
 * is open (or the note itself, before Loki has read it into lines). They wait
 * on the owner's Save, so the header counts them among what needs them.
 */
export function unsavedChanges(draft: Draft | null): number {
  if (!draft || draft.intent !== "note") return 0;
  if (draft.items) return draft.items.filter((i) => i.kind === "change" && i.text.trim()).length;
  return draft.text.trim() ? 1 : 0;
}

const draftKey = (token: string) => `loki-voice-draft:${token}`;
function readRecordedDraft(token: string): Draft | null {
  try {
    const raw = JSON.parse(sessionStorage.getItem(draftKey(token)) ?? "null") as Draft | null;
    if (
      !raw ||
      raw.intent !== "note" ||
      typeof raw.text !== "string" ||
      raw.text.length > 12000 ||
      !raw.capture ||
      typeof raw.capture.url !== "string" ||
      !/^https?:\/\//.test(raw.capture.url) ||
      typeof raw.capture.page !== "string" ||
      !Array.isArray(raw.capture.selected) ||
      raw.capture.selected.length > 10 ||
      !raw.capture.diagnostics ||
      typeof raw.capture.diagnostics !== "object"
    )
      return null;
    const selected = raw.capture.selected
      .filter(
        (item) =>
          typeof item.elementType === "string" &&
          typeof item.elementText === "string" &&
          typeof item.selector === "string",
      )
      .map((item) => ({
        elementType: item.elementType.slice(0, 100),
        elementText: item.elementText.slice(0, 300),
        selector: item.selector.slice(0, 500),
      }));
    const diagnostics = Object.fromEntries(
      Object.entries(raw.capture.diagnostics)
        .slice(0, CAPTURE_CONTEXT_LIMITS.fields)
        .filter(
          ([, value]) =>
            typeof value === "string" ||
            typeof value === "boolean" ||
            typeof value === "number" ||
            value === null,
        )
        .map(([key, value]) => [
          key.slice(0, CAPTURE_CONTEXT_LIMITS.keyChars),
          typeof value === "string" ? value.slice(0, CAPTURE_CONTEXT_LIMITS.valueChars) : value,
        ]),
    );
    const capture = {
      url: raw.capture.url.slice(0, 1000),
      page: raw.capture.page.slice(0, 300),
      title: String(raw.capture.title ?? "").slice(0, 300),
      selected,
      diagnostics,
    };
    const moments = clampMoments(raw.moments);
    const read = cleanWalkRead(raw.read);
    const items = Array.isArray(raw.items) ? cleanWalkRead({ items: raw.items })?.items : undefined;
    return {
      text: raw.text,
      intent: "note",
      capture,
      diagnostics,
      ...(moments.length ? { moments } : {}),
      ...(typeof raw.verbatim === "string" ? { verbatim: raw.verbatim.slice(0, 12000) } : {}),
      ...(typeof raw.spokenMs === "number" && Number.isFinite(raw.spokenMs)
        ? { spokenMs: Math.max(0, Math.min(raw.spokenMs, 3_600_000)) }
        : {}),
      ...(read ? { read } : {}),
      ...(items?.length ? { items } : {}),
    };
  } catch {
    return null;
  }
}
function keepRecordedDraft(token: string, draft: Draft | null) {
  try {
    if (draft?.intent === "note") sessionStorage.setItem(draftKey(token), JSON.stringify(draft));
    else sessionStorage.removeItem(draftKey(token));
  } catch {
    /* The current note remains available when storage is blocked. */
  }
}

export type ConversationSnapshot = {
  thread: readonly ThreadItem[];
  /** Waiting on Loki; `review` when it is going through what you did. */
  pending: null | { review: boolean };
  /** The last thing that went wrong, in words — cleared by the next action. */
  error: string;
  draft: Draft | null;
};

export type ConversationModelOpts = {
  apiBase: string;
  token: string;
  assistant: () => Assistant;
  /** The owner pass, while the server still honours it. */
  ownerPass: () => string | null;
  /** A project member's pass (member-pass.ts), while the server honours it. */
  memberPass?: () => string | null;
  /** The server no longer honours the member pass: stop sending it. */
  onMemberRefused?: () => void;
  /** The server refused the pass (expired, revoked): stop presenting it. */
  onPassRefused: () => void;
  picker: Picker;
  watch: () => ConversationWatch | null;
  /** What the next message is about (the view's scope menu). */
  about: () => About;
  /** The ingest's scope for what is about the SITE. */
  scope: () => "element" | "page" | "site";
  /** The screenshots waiting to go with the next note (the view's tray). */
  screenshots: { list: () => string[]; clear: () => void };
  onBusy?: (busy: boolean) => void;
  /** A note was filed — Your changes refreshes to show where it went. */
  onSent?: () => void;
};

/** Which starter questions show, and whether Review leads them. */
export function startersFor(
  assistant: Assistant,
  thread: readonly ThreadItem[],
  watching: boolean,
): { list: string[]; review: boolean } {
  // Watching already adds a live status and a tailored review action. Keep
  // the empty conversation focused on that single next step on small screens.
  if (watching) return { list: [REVIEW_QUESTION], review: true };
  const all = [...STARTERS[assistant]];
  // Starters are for an empty conversation; after that they are noise —
  // once the user has begun, they are noise.
  const empty = !thread.some((i) => i.kind === "you" || i.kind === "noticed");
  if (!all.length || !empty) return { list: [], review: false };
  return { list: all, review: false };
}

export function createConversationModel(opts: ConversationModelOpts) {
  let thread = readThread(opts.token);
  let pending: ConversationSnapshot["pending"] = null;
  let error = "";
  let draft: Draft | null = readRecordedDraft(opts.token);
  const listeners = new Set<(follow: boolean) => void>();

  const owner = () => opts.ownerPass() !== null;
  const snapshot = (): ConversationSnapshot => ({ thread, pending, error, draft });
  /** `follow`: the view should jump to the newest message (your own action). */
  const changed = (follow = false) => listeners.forEach((l) => l(follow));

  function remember(item: ThreadItem) {
    thread = pushItem(thread, item);
    writeThread(opts.token, thread);
  }

  function fail(e: unknown, fallback: string) {
    error = e instanceof Error ? e.message : fallback;
    changed();
  }

  async function ask(question: string, session?: string) {
    const text = question.trim().slice(0, ASK_MAX);
    if (pending || !text) return;
    const a = opts.assistant();
    if (a === "none") return openDraft(text);
    pending = { review: !!session };
    error = "";
    opts.onBusy?.(true);
    remember({ kind: "you", at: Date.now(), text });
    if (!session) opts.watch()?.talked?.(text);
    changed(true);
    const history = historyFor(thread.slice(0, -1), 12, 3000);
    try {
      const answer: Answer =
        a === "concierge"
          ? await askConcierge({ apiBase: opts.apiBase, token: opts.token, message: text, history })
          : await askAdvisor({
              apiBase: opts.apiBase,
              token: opts.token,
              question: text,
              scope: session ? "page" : opts.scope(),
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
      error = e instanceof Error ? e.message : "Could not reach Loki — try again.";
    } finally {
      pending = null;
      opts.onBusy?.(false);
      changed(true);
    }
  }

  function review() {
    const w = opts.watch();
    if (w) void ask(REVIEW_QUESTION, w.session());
  }

  /**
   * The owner's word IS the decision: a change starts building straight away,
   * with the watched steps attached, and its receipt says where it went. The
   * confirmation card is a visitor's (it asks who they are), or the owner's
   * when they choose "Edit first".
   */
  function build(text: string, key?: string) {
    if (draft?.intent === "note") {
      error = "Save or cancel your current note before requesting another change.";
      changed(true);
      return;
    }
    error = "";
    if (opts.about() === "loki" && !key) {
      toLoki(text).catch((e) => fail(e, "Could not send it to Loki — try again."));
      return;
    }
    if (!owner()) return openDraft(text);
    deliver(text, "", opts.watch()?.diagnostics() ?? null, key).catch((e) =>
      fail(e, "Could not start it — try again."),
    );
  }

  /** A note about the widget itself, to Loki's own project — no confirmation
   *  card: there is no builder of this site to introduce yourself to. */
  async function toLoki(body: string) {
    const res = await sendSelfReport(opts.apiBase, {
      token: opts.token,
      kind: "note",
      note: body,
      ownerPass: opts.ownerPass() ?? undefined,
      screenshots: opts.screenshots.list(),
    });
    opts.screenshots.clear();
    remember({
      kind: "sent",
      at: Date.now(),
      text: body.slice(0, MAX_LEN),
      owner: false,
      toLoki: true,
      ...(res.building ? { building: true } : {}),
      ...(res.note ? { note: res.note } : {}),
      // The build when one started, else the claim link — never no way to follow.
      ...(res.followUrl || res.claimUrl ? { claimUrl: res.followUrl ?? res.claimUrl } : {}),
    });
    changed(true);
  }

  /** File the note; the receipt lands in the thread. Throws the server's words. */
  async function deliver(
    body: string,
    contact: string,
    diag: ReportDiagnostics | null,
    key?: string,
    capture?: FeedbackCapture,
    intent?: "note" | "fix",
    moments?: ReportMoment[],
  ) {
    const pass = opts.ownerPass();
    const res = await sendReport(opts.apiBase, {
      token: opts.token,
      intent,
      capture,
      moments: moments?.length ? clampMoments(moments) : undefined,
      suggestion: capture ? body.trim().slice(0, MAX_LEN) : buildSuggestion(body, diag, MAX_LEN),
      contact,
      scope: capture ? (capture.selected.length ? "element" : "page") : opts.scope(),
      screenshots: opts.screenshots.list(),
      selectedElements: opts.picker.selected(),
      ownerPass: pass ?? undefined,
      ...memberField(pass),
      // The finding's key rides with its fix, so the next visit's remark
      // finds this row instead of filing another.
      ...(pass && key ? { noticeKey: key } : {}),
    });
    if (pass && !res.owner) opts.onPassRefused();
    memberHonoured(pass, res);
    sent(res, body);
  }

  /** The member pass rides only when the owner's does not: the owner's wins. */
  function memberField(ownerPass: string | null): { memberPass?: string } {
    const member = ownerPass ? null : (opts.memberPass?.() ?? null);
    return member ? { memberPass: member } : {};
  }

  /** A member pass the server no longer honours is dropped, never resent. */
  function memberHonoured(ownerPass: string | null, res: { member?: boolean }) {
    if (!ownerPass && opts.memberPass?.() && res.member !== true) opts.onMemberRefused?.();
  }

  /** After filing: the card goes (or keeps what is left), the receipt lands. */
  function sent(
    res: Awaited<ReturnType<typeof sendReport>>,
    body: string,
    left?: Draft,
    count = 1,
  ) {
    draft = left ?? null;
    keepRecordedDraft(opts.token, draft);
    opts.screenshots.clear();
    opts.picker.clearSelection();
    remember({
      kind: "sent",
      at: Date.now(),
      text: body.slice(0, MAX_LEN),
      owner: res.owner === true,
      ...(res.member ? { member: true } : {}),
      ...(res.building ? { building: true } : {}),
      ...(res.savedOnly ? { savedOnly: true } : {}),
      ...(count > 1 ? { changes: count } : {}),
      ...(res.buildNote || res.say ? { note: res.buildNote ?? res.say } : {}),
      // One link either way: a visitor tracks their report, the owner
      // follows the build Loki just started.
      ...(res.claimUrl || res.followUrl ? { claimUrl: res.followUrl ?? res.claimUrl } : {}),
    });
    changed(true);
    opts.onSent?.();
  }

  function openDraft(text: string, diagnostics: ReportDiagnostics | null = null) {
    if (draft?.intent === "note") {
      error = "Save or cancel your current note first.";
      changed(true);
      return;
    }
    const diag = diagnostics ?? (owner() ? (opts.watch()?.diagnostics() ?? null) : null);
    draft = { text: text.slice(0, MAX_LEN), diagnostics: diag };
    changed(true);
  }

  return {
    snapshot,
    /** Called on every change; `follow` asks the view to show the newest. */
    subscribe(listener: (follow: boolean) => void): () => void {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    owner,
    ask: (q: string, session?: string) => void ask(q, session),
    review,
    build,
    openDraft,
    /** Send the open confirmation card, as edited. Throws the server's words
     *  for the card to show beside its button. */
    sendDraft: (body: string, contact: string, intent?: "note" | "fix") => {
      if (body.trim().length > MAX_LEN)
        return Promise.reject(
          new Error(
            `Shorten this note to ${MAX_LEN} characters before sending. Your full recording text is kept here.`,
          ),
        );
      const diag = draft?.diagnostics ?? null;
      return deliver(
        body,
        contact,
        diag,
        undefined,
        draft?.capture,
        intent ?? draft?.intent,
        draft?.moments,
      );
    },
    recorded(
      text: string,
      capture: FeedbackCapture,
      moments: ReportMoment[] = [],
      spokenMs?: number,
    ) {
      const note: Draft = {
        text,
        verbatim: text,
        diagnostics: capture.diagnostics,
        capture,
        intent: "note",
        reading: true,
        ...(moments.length ? { moments } : {}),
        ...(spokenMs ? { spokenMs } : {}),
      };
      draft = note;
      keepRecordedDraft(opts.token, draft);
      changed(true);
      // Loki reads it the way a person would listen (walk-read.ts). Nothing
      // waits on this: the card works with the words as spoken meanwhile, and
      // a read that fails leaves them exactly as they are.
      void understandNote({ apiBase: opts.apiBase, token: opts.token, note: text, moments }).then(
        (read) => {
          if (draft !== note) return;
          // A new object, so the card is drawn again with the read in it.
          // Only words the person has not touched are replaced.
          const untouched = draft.text === note.verbatim;
          draft = {
            ...draft,
            reading: false,
            ...(read
              ? untouched
                ? { read, text: read.ask, items: read.items.map((i) => ({ ...i })) }
                : { read }
              : {}),
          };
          keepRecordedDraft(opts.token, draft);
          changed();
        },
      );
    },
    /** Put the words exactly as spoken back in the box. */
    useExactWords() {
      if (!draft?.verbatim) return;
      draft = { ...draft, text: draft.verbatim, items: undefined };
      keepRecordedDraft(opts.token, draft);
      changed();
    },
    /** Ask Loki about a spoken note, with the whole walk as what it looks at. */
    askAboutNote(text: string) {
      const moments = draft?.moments ?? [];
      draft = null;
      keepRecordedDraft(opts.token, null);
      void ask(text, moments.length > 1 ? walkSession(moments) : undefined);
    },
    /** Change one listed item's words; empty words drop it. */
    editItem(index: number, text: string) {
      if (!draft?.items?.[index]) return;
      draft.items[index] = { ...draft.items[index], text };
      keepRecordedDraft(opts.token, draft);
    },
    dropItem(index: number) {
      if (!draft?.items) return;
      const items = draft.items.filter((_, i) => i !== index);
      draft = items.length
        ? { ...draft, items }
        : { ...draft, items: undefined, text: draft.verbatim ?? draft.text };
      keepRecordedDraft(opts.token, draft);
      changed();
    },
    /**
     * File every listed change as its own note — each with the moments it came
     * from, on the page it was said on — so each is built on its own (and the
     * owner's saved notes build page by page). Questions stay on the card for
     * Ask. One receipt for the lot. Throws the server's words.
     */
    async sendItems(contact: string, intent?: "note" | "fix") {
      const note = draft;
      const items = note?.items?.filter((i) => i.text.trim()) ?? [];
      const changes = items.filter((i) => i.kind === "change");
      if (!note || !changes.length) return;
      const pass = opts.ownerPass();
      let res: Awaited<ReturnType<typeof sendReport>> | null = null;
      for (const item of changes) {
        const moments = (note.moments ?? []).filter((_, i) => item.parts.includes(i));
        const pages = new Set(moments.map((m) => m.page));
        const capture =
          note.capture && pages.size === 1
            ? { ...note.capture, page: [...pages][0] }
            : note.capture;
        const body = (item.where ? `${item.where}: ${item.text}` : item.text).slice(0, MAX_LEN);
        res = await sendReport(opts.apiBase, {
          token: opts.token,
          intent: intent ?? "note",
          capture,
          moments: clampMoments(moments.length ? moments : (note.moments ?? [])),
          suggestion: body,
          contact,
          scope: capture?.selected.length ? "element" : "page",
          screenshots: opts.screenshots.list(),
          selectedElements: opts.picker.selected(),
          ownerPass: pass ?? undefined,
          ...memberField(pass),
        });
        // Filed: off the card, so a failure on the next keeps only what is left.
        note.items = note.items?.filter((i) => i !== item);
      }
      if (!res) return;
      if (pass && !res.owner) opts.onPassRefused();
      memberHonoured(pass, res);
      const questions = note.items?.filter((i) => i.kind === "question") ?? [];
      // One change per line, each whole: the receipt shows them as a list.
      const said =
        changes.length === 1 ? changes[0].text : changes.map((c) => `• ${c.text}`).join("\n");
      sent(res, said, questions.length ? { ...note, items: questions } : undefined, changes.length);
    },
    editDraft(text: string) {
      if (!draft) return;
      draft.text = text;
      keepRecordedDraft(opts.token, draft);
    },
    closeDraft: () => {
      draft = null;
      keepRecordedDraft(opts.token, null);
      changed();
    },
    clearError: () => {
      if (!error) return;
      error = "";
      changed();
    },
    /** Watch noticed something: Loki says it in the thread, with Fix this. */
    noticed(remark: { say: string; fix: string; filed?: boolean; key?: string; again?: boolean }) {
      const item: Extract<ThreadItem, { kind: "noticed" }> = {
        kind: "noticed",
        at: Date.now(),
        text: remark.say,
        fix: remark.fix,
        ...(remark.filed ? { filed: true } : {}),
        ...(remark.key ? { key: remark.key } : {}),
        ...(remark.again ? { again: true } : {}),
      };
      const next = pushNoticed(thread, item);
      if (next === thread) return;
      thread = next;
      writeThread(opts.token, thread);
      changed();
    },
    /** The newest reading of a page found nothing: its older card goes. */
    unnoticed(slot: string) {
      const next = dropNoticed(thread, slot);
      if (next === thread) return;
      thread = next;
      writeThread(opts.token, thread);
      changed();
    },
    /** Loki on Loki (self-watch.ts) — quiet: never moves your reading place. */
    selfNote(text: string) {
      remember({ kind: "loki", at: Date.now(), speaker: "loki", text });
      changed();
    },
    /** Loki says something unprompted (e.g. "this site is not yours"). */
    say(text: string, links?: Link[]) {
      remember({ kind: "loki", at: Date.now(), speaker: "loki", text, links });
      changed(true);
    },
    /** Closing the panel: the card and the error go; the thread is kept. */
    close() {
      if (draft?.intent !== "note") draft = null;
      error = "";
    },
  };
}

export type ConversationModel = ReturnType<typeof createConversationModel>;
