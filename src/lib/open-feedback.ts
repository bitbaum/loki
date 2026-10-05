/**
 * Open Loki's own feedback widget from a control on the page — for surfaces
 * where its floating button is hidden (`data-fc-place="hidden"`: the phone's
 * bottom nav, the Terminal). The widget's API opens its panel without a
 * launcher: report a problem, point at an element, attach a screenshot.
 *
 * `ready`, not "report is a function": the widget publishes a stub
 * synchronously, so `report` exists even when the widget will never render
 * (token paused, boot unreachable) and a click would silently do nothing
 * (widget/main.ts, LokiApi.ready). Not ready → the fallback, e.g. /support.
 */
type LokiWidgetApi = { ready?: boolean; report?: () => void };

export function openFeedback(fallback: () => void): void {
  const api = (window as Window & { Loki?: LokiWidgetApi }).Loki;
  if (api?.ready && typeof api.report === "function") api.report();
  else fallback();
}
