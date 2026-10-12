/**
 * The seam between the widget and its chat chunk (widget/chat/view.tsx).
 *
 * Types and one string constant — so both bundles can import it without
 * either pulling the other in. The widget decides EVERYTHING the
 * conversation says and does (conversation-model.ts, conversation.ts): the
 * words, the actions, the cards. The chunk only draws it with the shared chat
 * (chatkit), the same components Loki's own chat uses. Widget-owned pieces
 * that chatkit has no model for (the About chips, a confirmation card, the
 * changes checklist under an answer) travel as ready-built DOM nodes the
 * chunk mounts where chatkit leaves a slot.
 */

export type KitMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  speaker?: { name: string; id: string };
  failed?: boolean;
  /** Under an answer: its actions (Fix this, the changes, a track link). */
  footer?: HTMLElement | null;
};

export type KitMode = { id: string; label: string; send: string; hint?: string };

export type KitState = {
  messages: KitMessage[];
  /** Loki is working: what it is doing, in words. */
  live: null | { status: string };
  /** After the last turn: the confirmation card, "send as written". */
  after: HTMLElement | null;
  /** One-tap questions above the composer. */
  starters: { label: string; pick: () => void }[];
  placeholder: string;
  /** The ways to send what is typed — Ask Loki, Build it / Send as feedback.
   *  One mode: no switch is shown. */
  modes: KitMode[];
  /** Inside the composer, above the words: the About chips. */
  header: HTMLElement | null;
  /** Under the composer: Continue in Loki. */
  footer: HTMLElement | null;
  /** Screenshots held for the next note, shown in the composer. */
  held: number;
  sending: boolean;
};

export type KitDeps = {
  /** Words and the chosen mode's id; images are already with `stage`. */
  send: (mode: string, text: string) => void;
  /** Screenshots attached in the composer, as data URLs, kept for the next note. */
  stage: (images: string[]) => void;
  /** The widget's own transcription endpoint (it needs the embed token). */
  transcribe: (audio: Blob, locale: string) => Promise<string>;
  /** --ck-* variables from the widget's boot theme (chat/theme.ts). */
  vars: string;
};

export type KitHandle = {
  update(state: KitState): void;
  focus(): void;
  unmount(): void;
};

export type KitModule = {
  mount(container: HTMLElement, deps: KitDeps, state: KitState): KitHandle;
};

/** Where the chunk announces itself once loaded (widget/chat-loader.ts). */
export const KIT_GLOBAL = "__lokiWidgetChat";
