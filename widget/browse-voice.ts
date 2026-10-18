/**
 * Speak while browsing: one bar, and the real site stays usable underneath.
 *
 * While the person talks, Loki notes which part of the page is in view — at
 * the start, whenever scrolling settles, whenever they tap anything on the
 * site, and whenever they tap Mark — with the text at the reading line, the
 * scroll position and the control they tapped (voice-moments.ts). The note it
 * makes puts each sentence under the part that was in view when it was said,
 * and the structured moments travel beside it so Loki can take the picture
 * of each view afterwards, on the server.
 *
 * A take is capped by the upload limit, but a walk through a site is not:
 * when a take reaches the cap the recorder hands straight into the next one
 * (the microphone stays granted, so no second prompt), the clock keeps
 * counting from the start of the walk, and Done writes all of it down as one
 * note (owner, 2026-10-17: "scroll through the site and click different
 * things while recording an audio").
 *
 * It used to have an unlabelled target icon that opened the element picker's
 * own bar on top of this one: two bars, two "Done" buttons, and no way to
 * tell which ended the recording (2026-10-16).
 */
import { createHostScanner } from "./host-scan";
import { overlaps } from "./placement";
import { h } from "./dom";
import { pressVerb } from "./press";
import {
  addMoment,
  alignNote,
  describeTap,
  inView,
  joinTakes,
  momentsForReport,
  readingText,
  timeline,
  type Moment,
  type TimedText,
} from "./voice-moments";
import type { ReportMoment } from "./moments-contract";
import { createVoiceRecorder, formatElapsed, type VoiceState } from "./voice";
import { captureFeedbackContext, type FeedbackCapture } from "./feedback-capture";
import type { SelectedEl } from "./picker";
import type { WidgetTheme } from "./theme";

/** The upload cap, with room under the server's: one take is at most this. */
const MAX_MS = 110_000;
/** A walk is at most this many takes (~18 minutes) — bounded uploads. */
export const MAX_TAKES = 10;
/** How often the address is checked while recording: a site's own links
 *  change it without telling anyone (pushState fires no event). */
const PATH_POLL_MS = 250;
/** How long a new page gets to draw its heading before Loki notes it. */
const NEW_PAGE_SETTLE_MS = 350;

/** The clock — and, on the last take, in its final 15 seconds, that it is
 *  about to stop, so a long note never ends mid-sentence without warning. */
export function recordingClock(elapsedMs: number, lastTake = true): string {
  const clock = `Recording ${formatElapsed(elapsedMs)}`;
  if (!lastTake) return clock;
  const inTake = elapsedMs % MAX_MS;
  return MAX_MS - inTake <= 15_000 && elapsedMs >= MAX_MS * (MAX_TAKES - 1)
    ? `${clock} · stops at ${formatElapsed(MAX_MS * MAX_TAKES)}`
    : clock;
}

export function createBrowseVoice(opts: {
  root: ShadowRoot;
  host: HTMLElement;
  theme: WidgetTheme;
  endpoint: string;
  token: string;
  selected: () => SelectedEl[];
  onActive(active: boolean): void;
  /** `spokenMs`: how long the walk lasted, start to Done — the card says it. */
  onTranscript(
    text: string,
    capture: FeedbackCapture,
    moments: ReportMoment[],
    spokenMs: number,
  ): void;
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
  // Said once, as recording starts, and then out of the way. One sentence:
  // the four it was went unread (owner, 2026-10-17).
  const hint = h(
    "div",
    "bv-hint",
    `Talk and scroll — Loki follows along. ${pressVerb().Verb} Mark on the part you mean.`,
  );
  // The whole screen says it is recording, not only a dot in a bar: a red
  // edge round the page while Loki listens, grey while it writes it down
  // ("when it is recording it should be clear on the screen", 2026-10-17).
  // Nothing under it is blocked — it takes no pointer events.
  const frame = h("div", "bv-frame");
  frame.setAttribute("aria-hidden", "true");
  hint.setAttribute("role", "status");
  const style = h("style");
  style.textContent = `
.browse-voice .bv-frame{position:fixed;inset:0;pointer-events:none;border:3px solid ${opts.theme.error};border-radius:0;box-sizing:border-box}.browse-voice[data-state="transcribing"] .bv-frame{border-color:${opts.theme.textMuted}}.browse-voice{position:fixed;bottom:max(12px,env(safe-area-inset-bottom));left:12px;right:12px;margin:auto;width:max-content;max-width:calc(100vw - 24px);z-index:2147483646;box-sizing:border-box;display:flex;align-items:center;gap:6px;padding:6px 8px 6px 12px;border:2px solid ${opts.theme.error};border-radius:${opts.theme.radiusSurface ?? "12px"};background:${opts.theme.surfaceRaised};color:${opts.theme.text};box-shadow:0 5px 24px rgba(0,0,0,.2);font:14px/1.4 ${opts.theme.fontSans ?? "system-ui,sans-serif"}}
.browse-voice[data-state="transcribing"]{border-color:${opts.theme.borderStrong}}.browse-voice .bv-status{min-width:0;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:600;font-variant-numeric:tabular-nums}.browse-voice .bv-status::before{content:"";display:inline-block;width:10px;height:10px;margin-right:8px;border-radius:50%;background:${opts.theme.error};vertical-align:1px;animation:bvpulse 1.4s ease-in-out infinite}.browse-voice[data-state="transcribing"] .bv-status::before{background:${opts.theme.textMuted};animation:none}@keyframes bvpulse{50%{opacity:.3}}@media (prefers-reduced-motion:reduce){.browse-voice .bv-status::before{animation:none}}.browse-voice .bv-point{border:1px solid ${opts.theme.borderStrong}!important;padding:8px 12px!important;font-weight:500}.browse-voice .bv-point.marked{border-color:${opts.theme.text}!important}.browse-voice .bv-cancel{color:${opts.theme.textSecondary}}.bv-hint{position:absolute;left:0;right:0;bottom:calc(100% + 8px);padding:10px 12px;border-radius:${opts.theme.radiusSurface ?? "12px"};background:${opts.theme.surface};border:1px solid ${opts.theme.border};color:${opts.theme.textSecondary};font-size:13px;line-height:1.45;white-space:normal;box-shadow:0 5px 24px rgba(0,0,0,.15)}.browse-voice.below .bv-hint{bottom:auto;top:calc(100% + 8px)}.browse-voice button{font:inherit;min-width:44px;min-height:44px;border:0;border-radius:${opts.theme.radiusControl ?? "10px"};cursor:pointer;color:inherit;background:transparent;padding:8px}.browse-voice .bv-stop{background:${opts.theme.text};color:${opts.theme.surfaceRaised}}.browse-voice .bv-point svg{width:20px;height:20px}.browse-voice button:focus-visible{outline:2px solid ${opts.theme.text};outline-offset:2px}
`;
  dock.append(frame, hint, status, point, stop, cancel);
  let visible = false;
  let capture: FeedbackCapture | null = null;
  let moments: Moment[] = [];
  /** When the walk began — moments and the clock count from here. */
  let startedAt = 0;
  /** Earlier takes of this walk, already written down. */
  let takes: Array<{ offsetMs: number; text: string; segments: TimedText[] }> = [];
  /** Where the current take began on the walk's clock. */
  let takeOffsetMs = 0;
  /** How long the walk lasted, set when the last take stops. */
  let spokenMs = 0;
  /** The person pressed Done (or ✕); a stop without it is the cap. */
  let userStopped = false;
  /** The cap stopped the take: write it down and carry straight on. */
  let continuing = false;
  let scrollTimer: ReturnType<typeof setTimeout> | null = null;
  let hintTimer: ReturnType<typeof setTimeout> | null = null;
  let markTimer: ReturnType<typeof setTimeout> | null = null;
  let state: VoiceState = "idle";
  const ours = (el: Element) => opts.host.contains(el) || !!el.closest("#loki-feedback-host");
  const walkElapsed = () => Date.now() - startedAt;
  /** Note what is in view now; `marked` when the person tapped Mark, `tap`
   *  when they tapped something on the site. */
  const sample = (marked = false, tap?: Moment["tap"], at = walkElapsed()) => {
    if (state !== "recording" && !continuing) return;
    moments = addMoment(moments, {
      at,
      label: inView(ours),
      page: location.pathname,
      scrollY: Math.round(scrollY),
      ...(readingText(ours) ? { text: readingText(ours) } : {}),
      ...(marked ? { marked: true } : {}),
      ...(tap ? { tap } : {}),
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
  // A tap on the site: what was tapped, with the part it was in. Capture
  // phase, so a control that stops propagation is still seen; never the
  // widget's own buttons.
  const onTap = (event: MouseEvent) => {
    const tap = describeTap(event.target, ours);
    if (tap) sample(false, tap);
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
  // Another page, without a page load (the site's own links, back/forward):
  // noted from the moment it happened. It used to wait for scrolling to
  // settle, so the first words said on each new page were filed under the
  // page before — every sentence one page early in the replay of the owner's
  // walk through Petvity (2026-10-18). The look waits a beat for the new page
  // to draw its heading; the clock is the moment the address changed.
  let path = location.pathname;
  let pathTimer: ReturnType<typeof setInterval> | null = null;
  const watchPath = () => {
    if (location.pathname === path) return;
    path = location.pathname;
    const at = walkElapsed();
    setTimeout(() => sample(false, undefined, at), NEW_PAGE_SETTLE_MS);
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
      path = location.pathname;
      pathTimer = setInterval(watchPath, PATH_POLL_MS);
      window.addEventListener("popstate", watchPath);
      document.addEventListener("click", onTap, true);
      window.addEventListener("beforeunload", beforeUnload);
      window.addEventListener("resize", queuePlacement);
      queuePlacement();
    } else {
      dock.remove();
      style.remove();
      window.removeEventListener("scroll", onScroll, true);
      if (pathTimer) clearInterval(pathTimer);
      pathTimer = null;
      window.removeEventListener("popstate", watchPath);
      document.removeEventListener("click", onTap, true);
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
  const finish = (text: string, segments: TimedText[]) => {
    if (!capture) return;
    const all = joinTakes([...takes, { offsetMs: takeOffsetMs, text, segments }]);
    const frozen = {
      ...capture,
      diagnostics: {
        ...capture.diagnostics,
        ...(moments.length ? { "On screen while speaking": timeline(moments) } : {}),
      },
    };
    const note = alignNote(all.text, all.segments, moments);
    opts.onTranscript(note, frozen, momentsForReport(all.text, all.segments, moments), spokenMs);
    takes = [];
    takeOffsetMs = 0;
  };
  const recorder = createVoiceRecorder({
    endpoint: opts.endpoint,
    token: opts.token,
    maxMs: MAX_MS,
    onState(next, detail) {
      const previous = state;
      state = next;
      show(["requesting", "recording", "transcribing"].includes(next) || continuing);
      if (next === "recording" && previous !== "recording") {
        if (!continuing) {
          capture = captureFeedbackContext(opts.selected());
          startedAt = Date.now();
          moments = [];
          takes = [];
          takeOffsetMs = 0;
          sample();
        }
        continuing = false;
        userStopped = false;
      }
      // The cap stopped this take, not the person: it is written down and
      // the next take starts the moment the microphone is free again.
      if (next === "transcribing" && !userStopped && takes.length < MAX_TAKES - 1)
        continuing = true;
      if (next === "transcribing" && !continuing) spokenMs = walkElapsed();
      if (next === "idle" && previous === "transcribing" && continuing) {
        void recorder.start();
        return;
      }
      dock.dataset.state = next;
      point.disabled = next !== "recording";
      stop.disabled = next !== "recording";
      if (next === "recording" && previous !== "recording") stop.focus({ preventScroll: true });
      // A "Marked …" confirmation keeps the bar for a beat before the clock returns.
      if (!(next === "recording" && point.classList.contains("marked")))
        status.textContent =
          next === "recording"
            ? recordingClock(takeOffsetMs + (detail?.elapsedMs ?? 0), takes.length >= MAX_TAKES - 1)
            : next === "transcribing"
              ? continuing
                ? "Still listening…"
                : "Writing it down…"
              : "Allow microphone…";
      if (next === "error") {
        continuing = false;
        opts.onError(detail?.error ?? "Could not record that note.");
      }
    },
    onTranscript(text, segments) {
      if (continuing) {
        takes.push({ offsetMs: takeOffsetMs, text, segments });
        takeOffsetMs = walkElapsed();
        return;
      }
      finish(text, segments);
    },
  });
  dock.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") {
      userStopped = true;
      continuing = false;
      recorder.cancel();
    }
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
    userStopped = true;
    recorder.stop();
  });
  cancel.addEventListener("click", () => {
    userStopped = true;
    continuing = false;
    takes = [];
    recorder.cancel();
  });
  return {
    active: () => visible,
    start: () => {
      if (visible) return;
      moments = [];
      takes = [];
      continuing = false;
      capture = captureFeedbackContext(opts.selected());
      void recorder.start();
    },
    cancel: () => {
      userStopped = true;
      continuing = false;
      recorder.cancel();
    },
    pointed() {
      if (!visible) return;
      capturePoint();
      sample(true);
      reposition();
    },
  };
}
