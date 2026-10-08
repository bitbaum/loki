/**
 * "Not quite" on a walkthrough's last card: the owner says what is still
 * wrong — typed or spoken — and either sends it (the fix starts again, with
 * their words) or first asks Loki to SHOW it: the page changes in their
 * browser only (widget/preview.ts), and "Build this" sends the words together
 * with what the preview showed. Nothing reaches the site until it is built.
 *
 * Mounted by widget/tour.ts into its card; it owns the compose box, the
 * preview's lifetime and the messages, and gives the card back on Cancel.
 */
import { h } from "./dom";
import { applyPreview, type PreviewOp } from "./preview";
import type { TourOutlineItem } from "./tour";
import type { WidgetTheme } from "./theme";
import { createVoiceControl } from "./voice-control";
import { mergeTranscript } from "./voice";

const ASK_MAX = 1000;
const VOICE_MAX_MS = 90_000;

export type FollowUpHost = {
  apiBase: string;
  token: string;
  /** The site's widget token, for the mic's transcription; null = no mic. */
  projectToken: string | null;
  /** The reporter's words go to the owner; the owner's start a build. */
  audience: "owner" | "reporter";
  /** Write the card's chapter line and sentence. */
  tell(chapter: string, text: string): void;
  /** The card's button row, and where the compose box goes (under the sentence). */
  row: HTMLElement;
  slot: HTMLElement;
  /** Read the page as it is now (after the tour's clicks). */
  outline(): { items: TourOutlineItem[]; els: Element[] };
  /** Ring an element and bring it into view. */
  show(el: Element): void;
  /** Put the end card back as it was. */
  back(): void;
};

export function followUpCSS(t: WidgetTheme): string {
  const rc = t.radiusControl ?? "6px";
  return `
.compose { margin-top: 10px; display: flex; flex-direction: column; gap: 6px; }
.compose textarea { width: 100%; min-height: 76px; resize: vertical; font: inherit; font-size: 14px;
  color: ${t.text}; background: transparent; border: 1px solid ${t.borderStrong}; border-radius: ${rc};
  padding: 8px 10px; }
.compose textarea:focus-visible { outline: 2px solid ${t.accent}; outline-offset: 1px; }
.compose .err { color: ${t.error}; font-size: 12px; min-height: 0; }
.compose .mic { align-self: flex-start; gap: 6px; }
.compose .mic svg { width: 14px; height: 14px; }
.compose .mic .dot { width: 8px; height: 8px; border-radius: 50%; background: ${t.error}; }`;
}

export function mountFollowUp(host: FollowUpHost): { dispose(): void } {
  let undoPreview: (() => void) | null = null;
  let previewSummary: string | null = null;
  const clearPreview = () => {
    undoPreview?.();
    undoPreview = null;
    previewSummary = null;
  };

  const box = h("div", "compose");
  const area = h("textarea") as HTMLTextAreaElement;
  area.maxLength = ASK_MAX;
  area.rows = 3;
  area.placeholder =
    host.audience === "owner"
      ? "e.g. The photos are too small, and the opening hours should be at the top."
      : "e.g. It still doesn't work on my phone.";
  area.setAttribute("aria-label", "What is still not right");
  const err = h("p", "err");
  area.addEventListener("input", () => (err.textContent = ""));
  box.append(area);
  if (host.projectToken) {
    const mic = createVoiceControl({
      endpoint: `${host.apiBase}/api/widget/transcribe`,
      token: host.projectToken,
      maxMs: VOICE_MAX_MS,
      onTranscript: (text) => {
        area.value = mergeTranscript(area.value, text, ASK_MAX);
        area.focus();
      },
      onError: (message) => (err.textContent = message),
    });
    if (mic) box.append(mic.button);
  }
  box.append(err);

  const button = (label: string, onClick: () => void, primary = false) => {
    const b = h("button", primary ? "primary" : undefined, label) as HTMLButtonElement;
    b.type = "button";
    b.addEventListener("click", onClick);
    return b;
  };
  const busy = (b: HTMLButtonElement, label: string) => {
    for (const other of Array.from(host.row.querySelectorAll("button"))) other.disabled = true;
    b.textContent = label;
  };
  const words = () => area.value.trim();
  const needWords = () => {
    if (words().length >= 3) return false;
    err.textContent = "Say what you would like changed first.";
    area.focus();
    return true;
  };

  const post = async (path: string, body: unknown) => {
    const res = await fetch(`${host.apiBase}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok)
      throw new Error(typeof json.error === "string" ? json.error : "Something went wrong");
    return json;
  };

  const compose = () => {
    host.tell(
      "Not quite",
      host.audience === "owner"
        ? "What's still not right — or what would you rather see?"
        : "What's still not right? It goes to the site's owner.",
    );
    host.slot.replaceChildren(box);
    err.textContent = "";
    const buttons: HTMLButtonElement[] = [];
    // Show me: owner and reporter alike may SEE an idea; only words are sent.
    const showMe = button("Show me", () => void preview(showMe), true);
    buttons.push(showMe);
    buttons.push(
      button(host.audience === "owner" ? "Send to Loki" : "Send", () => void send(buttons[1])),
    );
    buttons.push(
      button("Cancel", () => {
        host.slot.replaceChildren();
        host.back();
      }),
    );
    host.row.replaceChildren(...buttons);
    area.focus();
  };

  const preview = async (b: HTMLButtonElement) => {
    if (needWords()) return;
    clearPreview();
    busy(b, "Drawing it…");
    host.tell("Show me", "Drawing it on your page — a few seconds…");
    const outline = host.outline();
    try {
      const plan = await post("/api/widget/preview", {
        t: host.token,
        ask: words(),
        path: location.pathname,
        outline: outline.items,
      });
      const ops = Array.isArray(plan.ops) ? (plan.ops as PreviewOp[]) : [];
      const summary = typeof plan.summary === "string" ? plan.summary : null;
      if (ops.length === 0) {
        compose();
        err.textContent =
          summary ?? "I couldn't show that on this page — send it and it will be built.";
        return;
      }
      const result = applyPreview(ops, outline.els);
      undoPreview = result.undo;
      previewSummary = summary;
      if (result.first) host.show(result.first);
      host.slot.replaceChildren();
      const missed = result.skipped
        ? ` (${result.skipped} part${result.skipped > 1 ? "s" : ""} couldn't be shown.)`
        : "";
      host.tell(
        "Preview · only on your screen",
        `${summary ?? "Here's how it could look."}${missed} Nothing has changed on the real site.`,
      );
      const build = button(
        host.audience === "owner" ? "Build this" : "Send this",
        () => void send(build),
        true,
      );
      host.row.replaceChildren(
        build,
        button("Undo", () => {
          clearPreview();
          compose();
        }),
      );
    } catch (e) {
      compose();
      err.textContent = e instanceof Error ? e.message : "The preview failed — try again.";
    }
  };

  const send = async (b: HTMLButtonElement) => {
    if (needWords()) return;
    busy(b, "Sending…");
    try {
      const answer = await post("/api/widget/tour", {
        t: host.token,
        followUp: {
          text: words(),
          preview: previewSummary ?? undefined,
          path: location.pathname,
        },
      });
      host.slot.replaceChildren();
      host.row.replaceChildren();
      const note = typeof answer.buildNote === "string" ? answer.buildNote : null;
      host.tell(
        "Sent",
        host.audience === "reporter"
          ? "Thank you — the site's owner has it."
          : answer.building
            ? "Loki is building it now. You'll get a new walkthrough when it's live."
            : (note ?? "Saved in Loki under Feedback."),
      );
    } catch (e) {
      compose();
      err.textContent = e instanceof Error ? e.message : "Couldn't send — try again.";
    }
  };

  compose();
  return { dispose: clearPreview };
}
