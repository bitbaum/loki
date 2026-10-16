/**
 * Speak while browsing: one bar, and the real site stays usable underneath.
 *
 * While the person talks, Loki notes which part of the page is in view — at
 * the start, whenever scrolling settles, and whenever they tap Mark — and the
 * note it makes puts each sentence under the part that was in view when it
 * was said (voice-moments.ts). It used to have an unlabelled target icon that
 * opened the element picker's own bar on top of this one: two bars, two
 * "Done" buttons, and no way to tell which ended the recording (2026-10-16).
 */
import { createHostScanner } from "./host-scan";
import { overlaps } from "./placement";
import { h } from "./dom";
import { pressVerb } from "./press";
import { addMoment, alignNote, inView, timeline, type Moment } from "./voice-moments";
import { createVoiceRecorder, formatElapsed, type VoiceState } from "./voice";
import { captureFeedbackContext, type FeedbackCapture } from "./feedback-capture";
import type { SelectedEl } from "./picker";
import type { WidgetTheme } from "./theme";

/** The upload cap, with room under the server's: one take is at most this. */
const MAX_MS = 110_000;

/** The clock, and — in the last 15 seconds — that it is about to stop, so a
 *  long note never ends mid-sentence without warning. */
export function listening(elapsedMs: number): string {
  const clock = `Listening ${formatElapsed(elapsedMs)}`;
  return MAX_MS - elapsedMs <= 15_000 ? `${clock} · stops at ${formatElapsed(MAX_MS)}` : clock;
}

export function createBrowseVoice(opts: {
  root: ShadowRoot;
  host: HTMLElement;
  theme: WidgetTheme;
  endpoint: string;
  token: string;
  selected: () => SelectedEl[];
  onActive(active: boolean): void;
  onTranscript(text: string, capture: FeedbackCapture): void;
  onError(message: string): void;
}) {
  const dock = h("div", "browse-voice");
  dock.setAttribute("role", "region");
  dock.setAttribute("aria-label", "Voice review controls");
  const status = h("span", "bv-status", "Starting microphone…");
  status.setAttribute("role", "timer");
  status.setAttribute("aria-live", "off");
  // Mark: "this part, here" — a word, not an icon nobody could read.
  const point = h("button", "bv-point", "Mark");
  point.type = "button";
  point.title = "Mark the part of the page you are talking about";
  point.setAttribute("aria-label", "Mark the part of the page you are talking about");
  const stop = h("button", "bv-stop", "Done");
  stop.type = "button";
  const cancel = h("button", "bv-cancel", "✕");
  cancel.type = "button";
  cancel.setAttribute("aria-label", "Cancel this recording");
  cancel.title = "Cancel this recording";
  // Said once, as recording starts, and then out of the way.
  const hint = h(
    "div",
    "bv-hint",
    `Scroll and talk. Loki notes which part of the page you are on as you go — ${pressVerb().verb} Mark for the part you mean. No video, no screenshots.`,
  );
  hint.setAttribute("role", "status");
  const style = h("style");
  style.textContent = `
.browse-voice{position:fixed;bottom:max(12px,env(safe-area-inset-bottom));left:12px;right:12px;margin:auto;width:max-content;max-width:calc(100vw - 24px);z-index:2147483646;box-sizing:border-box;display:flex;align-items:center;gap:6px;padding:6px 8px 6px 12px;border:1px solid ${opts.theme.borderStrong};border-radius:${opts.theme.radiusSurface ?? "12px"};background:${opts.theme.surfaceRaised};color:${opts.theme.text};box-shadow:0 5px 24px rgba(0,0,0,.2);font:14px/1.4 ${opts.theme.fontSans ?? "system-ui,sans-serif"}}
.browse-voice .bv-status{min-width:0;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-variant-numeric:tabular-nums}.browse-voice .bv-status::before{content:"";display:inline-block;width:8px;height:8px;margin-right:8px;border-radius:50%;background:${opts.theme.error};vertical-align:1px;animation:bvpulse 1.4s ease-in-out infinite}.browse-voice[data-state="transcribing"] .bv-status::before{background:${opts.theme.textMuted};animation:none}@keyframes bvpulse{50%{opacity:.3}}@media (prefers-reduced-motion:reduce){.browse-voice .bv-status::before{animation:none}}.browse-voice .bv-point{border:1px solid ${opts.theme.borderStrong}!important;padding:8px 12px!important;font-weight:500}.browse-voice .bv-point.marked{border-color:${opts.theme.text}!important}.browse-voice .bv-cancel{color:${opts.theme.textSecondary}}.bv-hint{position:absolute;left:0;right:0;bottom:calc(100% + 8px);padding:10px 12px;border-radius:${opts.theme.radiusSurface ?? "12px"};background:${opts.theme.surface};border:1px solid ${opts.theme.border};color:${opts.theme.textSecondary};font-size:13px;line-height:1.45;white-space:normal;box-shadow:0 5px 24px rgba(0,0,0,.15)}.browse-voice.below .bv-hint{bottom:auto;top:calc(100% + 8px)}.browse-voice button{font:inherit;min-width:44px;min-height:44px;border:0;border-radius:${opts.theme.radiusControl ?? "10px"};cursor:pointer;color:inherit;background:transparent;padding:8px}.browse-voice .bv-stop{background:${opts.theme.text};color:${opts.theme.surfaceRaised}}.browse-voice .bv-point svg{width:20px;height:20px}.browse-voice button:focus-visible{outline:2px solid ${opts.theme.text};outline-offset:2px}
`;
  dock.append(hint, status, point, stop, cancel);
  let visible = false;
  let capture: FeedbackCapture | null = null;
  let moments: Moment[] = [];
  let startedAt = 0;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  let markTimer: ReturnType<typeof setTimeout> | null = null;
  let state: VoiceState = "idle";
  const ours = (el: Element) => opts.host.contains(el) || !!el.closest("#loki-feedback-host");
  /** Note what is in view now; `marked` when the person tapped Mark. */
  const sample = (marked = false) => {
    if (state !== "recording") return;
    moments = addMoment(moments, {
      at: Date.now() - startedAt,
      label: inView(ours),
      page: location.pathname,
      ...(marked ? { marked: true } : {}),
    });
  };
  point.addEventListener("click", () => {
    sample(true);
    hint.remove();
    // Say what was marked, in the bar itself, for a moment.
    const label = moments.at(-1)?.label ?? "this part";
    status.textContent = `Marked “${label}”`;
    point.classList.add("marked");
    if (markTimer) clearTimeout(markTimer);
    markTimer = setTimeout(() => point.classList.remove("marked"), 1200);
  });
  let placementFrame: number | null = null;
  const reposition = () => {
    if (!visible) return;
    const box = dock.getBoundingClientRect();
    const left = Math.max(12, (innerWidth - box.width) / 2);
    const pickerBar = opts.root.querySelector(".pickbar")?.getBoundingClientRect();
    const scan = createHostScanner(opts.host);
    const candidates = [
      innerHeight - box.height - 12,
      12,
      innerHeight - box.height * 2 - 28,
      box.height + 28,
      innerHeight - box.height * 3 - 44,
      box.height * 2 + 44,
    ]
      .filter((top) => top >= 12 && top + box.height <= innerHeight - 12)
      .map((top) => ({ left, top, right: left + box.width, bottom: top + box.height }));
    const options = candidates
      .filter((candidate) => !pickerBar || !overlaps(candidate, pickerBar))
      .map((rect) => ({ rect, verdict: scan.verdict(rect) }));
    const chosen =
      options.find((option) => option.verdict === "free") ??
      options.find((option) => option.verdict === "text") ??
      options.find((option) => option.verdict === "surface");
    if (chosen) {
      dock.style.top = `${chosen.rect.top}px`;
      dock.style.bottom = "auto";
      // The hint opens away from the screen edge it is near.
      dock.classList.toggle("below", chosen.rect.top < innerHeight / 2);
    }
  };
  const queuePlacement = () => {
    if (placementFrame !== null) return;
    placementFrame = requestAnimationFrame(() => {
      placementFrame = null;
      reposition();
    });
  };
  const onScroll = () => {
    queuePlacement();
    if (scrollTimer) clearTimeout(scrollTimer);
    scrollTimer = setTimeout(() => sample(), 700);
  };
  const beforeUnload = (event: BeforeUnloadEvent) => {
    if (state === "recording" || state === "transcribing") {
      event.preventDefault();
      event.returnValue = "";
    }
  };
  const show = (active: boolean) => {
    if (visible === active) return;
    visible = active;
    if (active) {
      opts.root.append(style, dock);
      if (!dock.contains(hint)) dock.prepend(hint);
      if (hintTimer) clearTimeout(hintTimer);
      hintTimer = setTimeout(() => hint.remove(), 6000);
      window.addEventListener("scroll", onScroll, { passive: true, capture: true });
      window.addEventListener("beforeunload", beforeUnload);
      window.addEventListener("resize", queuePlacement);
      queuePlacement();
    } else {
      dock.remove();
      style.remove();
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("beforeunload", beforeUnload);
      window.removeEventListener("resize", queuePlacement);
      if (placementFrame !== null) {
        cancelAnimationFrame(placementFrame);
        placementFrame = null;
      }
      if (scrollTimer) clearTimeout(scrollTimer);
      if (hintTimer) clearTimeout(hintTimer);
      hint.remove();
    }
    opts.onActive(active);
  };
  const recorder = createVoiceRecorder({
    endpoint: opts.endpoint,
    token: opts.token,
    maxMs: MAX_MS,
    onState(next, detail) {
      const previous = state;
      state = next;
      show(["requesting", "recording", "transcribing"].includes(next));
      if (next === "recording" && previous !== "recording") {
        capture = captureFeedbackContext(opts.selected());
        startedAt = Date.now();
        moments = [];
        sample();
      }
      dock.dataset.state = next;
      point.disabled = next !== "recording";
      stop.disabled = next !== "recording";
      if (next === "recording" && previous !== "recording") stop.focus({ preventScroll: true });
      // A "Marked …" confirmation keeps the bar for a beat before the clock returns.
      if (!(next === "recording" && point.classList.contains("marked")))
        status.textContent =
          next === "recording"
            ? listening(detail?.elapsedMs ?? 0)
            : next === "transcribing"
              ? "Writing it down…"
              : "Allow microphone…";
      if (next === "error") opts.onError(detail?.error ?? "Could not record that note.");
    },
    onTranscript(text, segments) {
      if (!capture) return;
      const frozen = {
        ...capture,
        diagnostics: {
          ...capture.diagnostics,
          ...(moments.length ? { "On screen while speaking": timeline(moments) } : {}),
        },
      };
      opts.onTranscript(alignNote(text, segments, moments), frozen);
    },
  });
  dock.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") recorder.cancel();
  });
  const capturePoint = () => {
    const selected = opts.selected();
    if (selected.length) {
      const current = captureFeedbackContext(selected);
      capture = { ...current, diagnostics: { ...capture?.diagnostics, ...current.diagnostics } };
      point.title = selected.map((item) => item.elementText).join(", ");
    }
  };
  stop.addEventListener("click", () => {
    if (JSON.stringify(opts.selected()) !== JSON.stringify(capture?.selected)) capturePoint();
    recorder.stop();
  });
  cancel.addEventListener("click", () => recorder.cancel());
  return {
    active: () => visible,
    start: () => {
      if (visible) return;
      moments = [];
      capture = captureFeedbackContext(opts.selected());
      void recorder.start();
    },
    cancel: () => recorder.cancel(),
    pointed() {
      if (!visible) return;
      capturePoint();
      sample(true);
      reposition();
    },
  };
}
