import { VISIBILITY_EVENT } from "../../widget/visitor-placement";

/**
 * Loki's own feedback widget, from the app's side: open it from a control on
 * the page, and switch its floating button off and on.
 *
 * `ready`, not "report is a function": the widget publishes a stub
 * synchronously, so `report` exists even when the widget will never render
 * (token paused, boot unreachable) and a click would silently do nothing
 * (widget/main.ts, LokiApi.ready). Not ready → the fallback, e.g. /support.
 */
type LokiWidgetApi = {
  ready?: boolean;
  report?: () => void;
  hide?: () => void;
  show?: () => void;
  hidden?: boolean;
};

const lokiApi = (): LokiWidgetApi | undefined =>
  typeof window === "undefined" ? undefined : (window as Window & { Loki?: LokiWidgetApi }).Loki;

export function openFeedback(fallback: () => void): void {
  const api = lokiApi();
  if (api?.ready && typeof api.report === "function") api.report();
  else fallback();
}

/**
 * Whether the person has the feedback button switched off in this browser.
 * `null` while the widget is not available (not loaded yet, paused, or this
 * route has none) — there is no switch to show then.
 */
export function feedbackButtonHidden(): boolean | null {
  const api = lokiApi();
  if (!api?.ready || typeof api.hide !== "function") return null;
  return api.hidden === true;
}

/** Turn the floating button off (`true`) or back on (`false`). */
export function setFeedbackButtonHidden(hidden: boolean): void {
  const api = lokiApi();
  if (hidden) api?.hide?.();
  else api?.show?.();
}

/**
 * Call `onChange` whenever the switch's state may have changed: the widget's
 * own menu toggled it, or the widget finished loading. Returns the unsubscribe.
 * The poll covers the moment between this page mounting and the widget
 * becoming ready, which fires no event of its own.
 */
export function subscribeFeedbackButton(onChange: () => void): () => void {
  window.addEventListener(VISIBILITY_EVENT, onChange);
  const poll = window.setInterval(onChange, 1000);
  return () => {
    window.removeEventListener(VISIBILITY_EVENT, onChange);
    window.clearInterval(poll);
  };
}
