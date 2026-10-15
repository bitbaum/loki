/** A visible mic dock leaves the real site usable while the visitor speaks. */
import { createHostScanner } from "./host-scan";
import { overlaps } from "./placement";
import { h, TARGET_SVG } from "./dom";
import { createVoiceRecorder, formatElapsed, type VoiceState } from "./voice";
import { captureFeedbackContext, type FeedbackCapture } from "./feedback-capture";
import type { SelectedEl } from "./picker";
import type { WidgetTheme } from "./theme";

export function createBrowseVoice(opts: {
  root: ShadowRoot;
  host: HTMLElement;
  theme: WidgetTheme;
  endpoint: string;
  token: string;
  selected: () => SelectedEl[];
  onPoint: () => void;
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
  const point = h("button", "bv-point");
  point.type = "button";
  point.innerHTML = TARGET_SVG;
  point.setAttribute("aria-label", "Point to what this note is about");
  point.addEventListener("click", () => {
    opts.onPoint();
    reposition();
  });
  const stop = h("button", "bv-stop", "Done");
  stop.type = "button";
  const cancel = h("button", "bv-cancel", "Cancel");
  cancel.type = "button";
  const style = h("style");
  style.textContent = `
.browse-voice{position:fixed;bottom:max(12px,env(safe-area-inset-bottom));left:12px;right:12px;margin:auto;width:max-content;max-width:calc(100vw - 24px);z-index:2147483646;box-sizing:border-box;display:flex;align-items:center;gap:6px;padding:6px 8px 6px 12px;border:1px solid ${opts.theme.borderStrong};border-radius:${opts.theme.radiusSurface ?? "12px"};background:${opts.theme.surfaceRaised};color:${opts.theme.text};box-shadow:0 5px 24px rgba(0,0,0,.2);font:14px/1.4 ${opts.theme.fontSans ?? "system-ui,sans-serif"}}
.browse-voice .bv-status{min-width:0;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.browse-voice button{font:inherit;min-width:44px;min-height:44px;border:0;border-radius:${opts.theme.radiusControl ?? "10px"};cursor:pointer;color:inherit;background:transparent;padding:8px}.browse-voice .bv-stop{background:${opts.theme.text};color:${opts.theme.surfaceRaised}}.browse-voice .bv-point svg{width:20px;height:20px}.browse-voice button:focus-visible{outline:2px solid ${opts.theme.text};outline-offset:2px}
`;
  dock.append(status, point, stop, cancel);
  let visible = false;
  let capture: FeedbackCapture | null = null;
  let trail: string[] = [];
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  let state: VoiceState = "idle";
  const sample = () => {
    if (state !== "recording") return;
    const now = captureFeedbackContext(opts.selected());
    const entry = `${new URL(now.url).pathname} · ${now.diagnostics["Screen when speaking"]} · ${now.diagnostics["Visible headings"]}`;
    if (trail.at(-1) !== entry) trail = [...trail, entry].slice(-6);
  };
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
    scrollTimer = setTimeout(sample, 400);
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
    }
    opts.onActive(active);
  };
  const recorder = createVoiceRecorder({
    endpoint: opts.endpoint,
    token: opts.token,
    maxMs: 110000,
    onState(next, detail) {
      const previous = state;
      state = next;
      show(["requesting", "recording", "transcribing"].includes(next));
      if (next === "recording" && previous !== "recording") {
        capture = captureFeedbackContext(opts.selected());
        sample();
      }
      dock.dataset.state = next;
      point.disabled = next !== "recording";
      stop.disabled = next !== "recording";
      if (next === "recording" && previous !== "recording") stop.focus({ preventScroll: true });
      status.textContent =
        next === "recording"
          ? `Recording ${formatElapsed(detail?.elapsedMs ?? 0)}`
          : next === "transcribing"
            ? "Making your note…"
            : "Allow microphone…";
      if (next === "error") opts.onError(detail?.error ?? "Could not record that note.");
    },
    onTranscript(text) {
      if (!capture) return;
      const frozen = {
        ...capture,
        diagnostics: {
          ...capture.diagnostics,
          ...(trail.length > 1
            ? { "Areas visited while speaking": trail.join(" → ").slice(0, 300) }
            : {}),
        },
      };
      opts.onTranscript(text, frozen);
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
      trail = [];
      capture = captureFeedbackContext(opts.selected());
      void recorder.start();
    },
    cancel: () => recorder.cancel(),
    pointed() {
      if (!visible) return;
      capturePoint();
      sample();
      reposition();
    },
  };
}
