/**
 * Loki Feedback Widget — self-contained embed for customer sites.
 *
 * Usage (docs/architecture/feedback-widget.md):
 *   <script src="https://<loki-host>/widget.js" data-fc-project="fcw_..." async></script>
 *
 * Constraints that shape this file:
 * - Zero dependencies, one bundle: it must mount on ANY site (static HTML,
 *   WordPress, Next, ...) — no React, no shared chunks.
 * - All UI lives in a Shadow DOM so host CSS and widget CSS can't bleed
 *   into each other. The ONE exception: element-picking highlights must
 *   style host-page elements, so a tiny fcw-* stylesheet is injected into
 *   document.head (removed classes on cleanup).
 * - The token is write-only by design; the API base is derived from this
 *   script's own src, so one snippet works on every deployment.
 *
 * This file owns the panel — chips, textarea, attach row, submit — plus the
 * boot gate and the programmatic window.Loki entry point. The launcher, the
 * element picker, the screenshot strip, the stylesheets and the DOM helpers
 * live in their own modules alongside it.
 */

import { forgetOwnerPass, takeOwnerPass } from "./owner-pass";
import { buildSuggestion, formatDiagnostics, type ReportDiagnostics } from "./report-payload";
import { mergeTranscript } from "./voice";
import { createVoiceControl } from "./voice-control";
import { DEFAULT_PLACEMENT, normalizePlacement, type Placement } from "./placement";
import { buildDocCSS, buildShadowCSS, type WidgetTheme } from "./theme";
import { CAMERA_SVG, h } from "./dom";
import { isHiddenByVisitor, readVisitorPlacement } from "./visitor-placement";
import { createLauncher } from "./launcher";
import { createPicker } from "./picker";
import { createAttachments } from "./attachments";
import { createChat } from "./chat";
import {
  initialWidgetSurfaceMode,
  parseWidgetSurfaceModes,
  WIDGET_SURFACE_MODE_META,
  type WidgetSurfaceMode,
} from "./surface-modes";

type Scope = "element" | "page" | "site";

const MAX_LEN = 2000;
const MAX_ELEMENTS = 10;
const MAX_SCREENSHOTS = 5;
/** Stop recording here. Kept under the server's ~2 min upload cap so the
 *  visitor is never told "too long" after they have already said it. */
const VOICE_MAX_MS = 110_000;

interface ReportInput {
  /** Pre-filled first line so the visitor never faces an empty box. */
  message?: string;
  diagnostics?: ReportDiagnostics;
}

interface LokiApi {
  /**
   * True once the panel can actually be opened — i.e. the boot gate said
   * active AND mount() has run.
   *
   * A host needs this to decide what its own "Report" control should be. The
   * stub below is published synchronously and therefore exists even when the
   * widget will never render (token paused, boot unreachable); a host that
   * treats "report is a function" as "clicking will do something" ships a
   * button that silently no-ops. Read `ready` and fall back to a real link.
   */
  ready: boolean;
  report(input?: ReportInput): void;
  /**
   * Open the panel in Chat mode, optionally asking a first question — so a
   * host page can put its own "Ask about our projects" box on the page and
   * hand the question to the widget. A no-op on an embed without chat mode.
   */
  ask(question?: string): void;
}

(() => {
  const script = document.currentScript as HTMLScriptElement | null;
  const token = script?.getAttribute("data-fc-project") ?? "";
  if (!token) {
    console.warn("[loki-widget] missing data-fc-project attribute");
    return;
  }
  const apiBase = script?.src ? new URL(script.src).origin : "";
  // The owner, arriving from Loki's "Open your site" link or returning with the
  // pass kept from it. Their notes start the fix instead of waiting in an inbox.
  const ownerState = takeOwnerPass(token);
  let ownerPass = ownerState.pass;
  // Legacy escape hatch, kept working: px from the bottom edge, set in the
  // customer's own HTML. Superseded by the placement served from boot, which an
  // operator can change without touching their site — but an explicitly set
  // attribute still wins (see boot()).
  const bottomOffset = parseInt(script?.getAttribute("data-fc-bottom") ?? "", 10);
  // Modes are captured with the script tag (async scripts lose currentScript later).
  // Report alone unless the embed lists more: chat is a studio front desk, and
  // this bundle also runs on pilot sites that never asked for one.
  const modesAttr = script?.getAttribute("data-fc-modes") ?? "report";

  /** Filled by boot() before mount(); the launcher never paints without it. */
  let placement: Placement = { ...DEFAULT_PLACEMENT };
  /** Where the visitor dragged/parked it, if they did. Their choice outranks
   *  both the operator's and the auto-avoid, and only for them. */
  let visitorOverride: Placement | null = readVisitorPlacement(token);
  if (document.getElementById("loki-feedback-host")) return;

  // Publish the programmatic entry point SYNCHRONOUSLY, before the async boot
  // gate decides whether to render. A host page that calls report() from an
  // error toast must not have to know whether the widget has finished booting,
  // so calls made too early are held (latest wins — a double-click on "Report"
  // means the second click, not two panels) and replayed once mount() runs.
  // If the boot gate says inactive, the held report is simply never shown:
  // the widget is off, and a queued submission could not land anyway.
  let pendingReport: ReportInput | null = null;
  let liveReport: ((input: ReportInput) => void) | null = null;
  let pendingAsk: string | null = null;
  let liveAsk: ((question: string) => void) | null = null;
  const api: LokiApi = {
    ready: false,
    report(input: ReportInput = {}) {
      if (liveReport) liveReport(input);
      else pendingReport = input;
    },
    ask(question = "") {
      if (liveAsk) liveAsk(question);
      else pendingAsk = question;
    },
  };
  (window as unknown as { Loki?: LokiApi }).Loki = api;
  // Arriving from the owner link: open straight to the note, so "look at my
  // site and say what to change" is one step, not a hunt for the button.
  if (ownerState.arrived) pendingReport = {};

  const mount = (theme: WidgetTheme) => {
    // ---- state ----
    let scope: Scope = "page";
    let submitting = false;

    // ---- shadow scaffold ----
    const host = h("div");
    host.id = "loki-feedback-host";
    const root = host.attachShadow({ mode: "open" });
    const style = h("style");
    style.textContent = buildShadowCSS(theme);
    root.appendChild(style);
    document.body.appendChild(host);

    const docStyle = h("style");
    docStyle.textContent = buildDocCSS(theme);

    const launcher = createLauncher({
      root,
      host,
      token,
      getPlacement: () => placement,
      getVisitorOverride: () => visitorOverride,
      setVisitorOverride: (value) => {
        visitorOverride = value;
      },
      onOpen: openPanel,
    });
    const fab = launcher.fab;

    // ---- panel (built once, shown on demand) ----
    const backdrop = h("div", "backdrop");
    backdrop.addEventListener("click", closePanel);

    const panel = h("div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Loki");

    const hdr = h("div", "hdr");
    const hdrText = h("div");
    // The brand line is what makes this recognisably Loki on a stranger's
    // site — the same mono micro-label Loki's own pages use.
    const brand = h("div", "brand");
    const brandName = h("span", "mono", "Loki");
    brand.append(h("span", "dot"), brandName);
    // Report's form and Chat's conversation are two views of one panel; the
    // mode chips swap them. Declared here so syncModes() can reach both.
    const reportView = h("div", "report-view");
    hdrText.appendChild(brand);
    // Surface modes: Report ships today; Chat / Watch are progressive seams
    // (data-fc-modes="report,chat,watch"). The whole panel is Loki-on-the-site.
    const enabledModes = parseWidgetSurfaceModes(modesAttr);
    let surfaceMode: WidgetSurfaceMode = initialWidgetSurfaceMode(enabledModes);
    const chat = enabledModes.includes("chat") ? createChat({ apiBase, token }) : null;
    const title = h("b");
    const modesRow = h("div", "modes");
    modesRow.setAttribute("role", "tablist");
    modesRow.setAttribute("aria-label", "Loki modes");
    const modeHint = h("div", "mode-hint");
    const modeBtns = new Map<WidgetSurfaceMode, HTMLButtonElement>();
    function syncModes() {
      for (const [m, btn] of modeBtns) {
        const meta = WIDGET_SURFACE_MODE_META[m];
        btn.classList.toggle("on", m === surfaceMode);
        btn.setAttribute("aria-selected", m === surfaceMode ? "true" : "false");
        btn.disabled = !meta.shipped;
        btn.title = meta.hint;
      }
      // The owner is not filing a report for someone else to triage: what they
      // say here is built and shipped, and the hint says exactly that.
      modeHint.textContent =
        ownerPass && surfaceMode === "report"
          ? "Your site: what you say here gets built and goes live."
          : WIDGET_SURFACE_MODE_META[surfaceMode].hint;
      const chatting = surfaceMode === "chat" && chat !== null;
      title.textContent = chatting ? "What are you looking for?" : "What should change?";
      reportView.style.display = chatting ? "none" : "";
      if (chat) chat.el.style.display = chatting ? "" : "none";
      // In chat the panel is just "Chat" — the Cat and Loki are who is IN it,
      // and each bubble names its speaker. Report stays Loki's.
      brandName.textContent = chatting ? "Chat" : "Loki";
    }
    for (const m of enabledModes) {
      const meta = WIDGET_SURFACE_MODE_META[m];
      const btn = h("button", "mode", meta.label);
      btn.setAttribute("role", "tab");
      btn.addEventListener("click", () => {
        if (!WIDGET_SURFACE_MODE_META[m].shipped) return;
        surfaceMode = m;
        syncModes();
        if (m === "chat") chat?.focus();
        else textarea.focus();
      });
      modeBtns.set(m, btn);
      modesRow.appendChild(btn);
    }
    hdrText.appendChild(modesRow);
    hdrText.appendChild(modeHint);
    hdrText.appendChild(title);
    const hdrPage = h("div", "page");
    hdrText.appendChild(hdrPage);
    const closeBtn = h("button", "x", "✕");
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", closePanel);
    hdr.append(hdrText, closeBtn);

    const chips = h("div", "chips");
    const chipDefs: Array<{ key: Scope; label: string }> = [
      { key: "element", label: "An element" },
      { key: "page", label: "This page" },
      { key: "site", label: "Whole site" },
    ];
    const chipEls = new Map<Scope, HTMLButtonElement>();
    for (const def of chipDefs) {
      const chip = h("button", "chip", def.label);
      chip.addEventListener("click", () => {
        scope = def.key;
        if (def.key === "element") picker.start();
        syncChips();
      });
      chipEls.set(def.key, chip);
      chips.appendChild(chip);
    }
    const hint = h("div", "hint");

    const textarea = h("textarea");
    textarea.maxLength = MAX_LEN;
    textarea.placeholder = ownerPass
      ? "Say or type what to change. It gets built."
      : "What should be improved?";
    const cnt = h("div", "cnt", `0/${MAX_LEN}`);

    // Diagnostics travel with the submission but stay OUT of the textarea: the
    // visitor should see a clean sentence they can edit, not a wall of context
    // they have to scroll past or delete.
    let diagnostics: ReportDiagnostics | null = null;
    const diagNote = h("div", "diag");
    function syncDiagnostics() {
      const text = diagnostics ? formatDiagnostics(diagnostics) : "";
      diagNote.style.display = text ? "block" : "none";
      diagNote.textContent = text ? "⚙ Technical details attached" : "";
      diagNote.title = text;
    }
    syncDiagnostics();
    textarea.addEventListener("input", () => {
      cnt.textContent = `${textarea.value.length}/${MAX_LEN}`;
      sendBtn.disabled = !textarea.value.trim();
    });

    const contact = h("input");
    contact.type = "text";
    contact.placeholder = "Name / email (optional)";
    // Loki already knows who the owner is; asking them for an email is noise.
    if (ownerPass) contact.style.display = "none";
    contact.autocomplete = "off";
    // Same cap the ingest route enforces, so the field stops accepting text at
    // the limit instead of taking it and losing the whole report on submit.
    // The textarea already does this; the contact input did not.
    contact.maxLength = 200;

    // ---- image attach (file picker + paste; client-downscaled) ----
    const attachRow = h("div", "attachrow");
    const fileInput = h("input");
    fileInput.type = "file";
    fileInput.accept = "image/*";
    fileInput.multiple = true;
    fileInput.style.display = "none";
    const attachBtn = h("button", "attach");
    const cameraIcon = h("span");
    cameraIcon.innerHTML = CAMERA_SVG;
    attachBtn.append(cameraIcon, h("span", undefined, "Screenshots"));
    attachBtn.setAttribute("aria-label", "Add screenshots (or paste)");
    attachBtn.addEventListener("click", () => fileInput.click());
    const shotsContainer = h("div", "shots");
    const attachments = createAttachments({
      attachBtn,
      container: shotsContainer,
      max: MAX_SCREENSHOTS,
      onError: (message) => {
        errEl.textContent = message;
      },
    });
    // ---- voice input ----
    const voiceControl = createVoiceControl({
      endpoint: `${apiBase}/api/widget/transcribe`,
      token,
      maxMs: VOICE_MAX_MS,
      onTranscript: (text) => {
        textarea.value = mergeTranscript(textarea.value, text, MAX_LEN);
        cnt.textContent = `${textarea.value.length}/${MAX_LEN}`;
        sendBtn.disabled = !textarea.value.trim();
        textarea.focus();
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      },
      onError: (message) => {
        errEl.textContent = message;
      },
    });
    const voice = voiceControl?.recorder ?? null;

    if (voiceControl) attachRow.append(voiceControl.button);
    attachRow.append(attachBtn, fileInput);

    fileInput.addEventListener("change", () => {
      void attachments.attachMany(fileInput.files);
      fileInput.value = "";
    });
    // Paste a screenshot straight into the panel (desktop muscle memory).
    panel.addEventListener("paste", (e: ClipboardEvent) => {
      const items = Array.from(e.clipboardData?.items ?? []).filter((i) =>
        i.type.startsWith("image/"),
      );
      if (items.length > 0) {
        e.preventDefault();
        for (const item of items) {
          void attachments.attach(item.getAsFile());
        }
      }
    });

    const row = h("div", "row");
    const sendBtn = h("button", "go", "Send");
    sendBtn.disabled = true;
    sendBtn.addEventListener("click", submit);
    const cancelBtn = h("button", "ghost", "Cancel");
    cancelBtn.addEventListener("click", closePanel);
    row.append(sendBtn, cancelBtn);

    const errEl = h("div", "err");
    const keys = h("div", "keys");
    keys.append(
      h("span", "mono", "Esc closes"),
      h("span", "sep", "·"),
      h("span", "mono", "Ctrl+Enter sends"),
    );

    reportView.append(
      chips,
      hint,
      textarea,
      cnt,
      diagNote,
      contact,
      attachRow,
      shotsContainer,
      row,
      errEl,
      keys,
    );
    panel.append(hdr, reportView);
    if (chat) panel.append(chat.el);
    syncModes();

    const picker = createPicker({
      root,
      host,
      docStyle,
      backdrop,
      panel,
      maxElements: MAX_ELEMENTS,
      onCancel: () => {
        scope = "page";
      },
      onStop: () => {
        if (scope === "element" && picker.selected().length === 0) scope = "page";
        syncChips();
        textarea.focus();
      },
    });

    // ---- behaviors ----
    function syncChips() {
      const selectedCount = picker.selected().length;
      for (const [key, chip] of chipEls) chip.classList.toggle("on", key === scope);
      hint.textContent =
        scope === "element"
          ? selectedCount
            ? `${selectedCount} element${selectedCount > 1 ? "s" : ""} selected`
            : "Pick the element the feedback is about"
          : "";
      hint.style.display = hint.textContent ? "block" : "none";
    }

    function openPanel() {
      fab.style.display = "none";
      hdrPage.textContent = document.title || location.pathname;
      root.append(backdrop, panel);
      syncChips();
      document.addEventListener("keydown", onKeydown, true);
      if (surfaceMode === "chat" && chat) chat.focus();
      else textarea.focus();
    }

    function closePanel() {
      if (picker.isPicking()) picker.stop();
      // Abandon any in-flight recording. Closing the panel with the mic still
      // open would leave the browser's "recording" indicator lit on someone
      // else's site, which reads as the page still listening after the visitor
      // dismissed it — and would transcribe audio they chose not to send.
      voice?.cancel();
      picker.clearSelection();
      backdrop.remove();
      panel.remove();
      document.removeEventListener("keydown", onKeydown, true);
      scope = "page";
      textarea.value = "";
      contact.value = "";
      attachments.reset();
      attachments.render();
      cnt.textContent = `0/${MAX_LEN}`;
      diagnostics = null;
      syncDiagnostics();
      errEl.textContent = "";
      sendBtn.disabled = true;
      submitting = false;
      sendBtn.textContent = "Send";
      fab.style.display = "";
    }

    function onKeydown(e: KeyboardEvent) {
      // The panel is a modal overlay rendered in a shadow root. Host pages bind
      // global hotkeys (⌘K command palette, "/" search, "?" help, digit
      // shortcuts) on window/document. Because the event retargets to the shadow
      // HOST element when it crosses the boundary, the host's own
      // "is the user typing?" guard reads the wrong node and fires anyway —
      // stealing keystrokes while the user types feedback (observed on both
      // orangecat.ch and loki.orangecat.ch, which embed this same widget).
      // While the panel is open we own the keyboard: stop every keystroke at the
      // shadow boundary so nothing leaks to the host's global shortcuts. This is
      // standard modal keyboard-trap behaviour and is the single fix that covers
      // every embedding host at once.
      e.stopPropagation();
      // Chat's own keys: the trap above stops the event before it reaches the
      // shadow textarea's listeners, so Enter-to-send is handled here.
      if (chat && surfaceMode === "chat" && e.composedPath().includes(chat.input) && chat.onKey(e))
        return;
      if (e.key === "Escape") {
        if (picker.isPicking()) picker.stop();
        else closePanel();
      } else if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && surfaceMode !== "chat") {
        if (!sendBtn.disabled) void submit();
      }
    }

    function suggestionWithDiagnostics(): string {
      return buildSuggestion(textarea.value, diagnostics, MAX_LEN);
    }

    async function submit() {
      if (submitting || !textarea.value.trim()) return;
      submitting = true;
      sendBtn.disabled = true;
      sendBtn.textContent = "Sending…";
      errEl.textContent = "";
      const shots = attachments.shots();
      const selected = picker.selected();
      try {
        const res = await fetch(`${apiBase}/api/feedback`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            token,
            suggestion: suggestionWithDiagnostics(),
            // Every field here is clamped to the server's own cap. Two of them
            // were not, and the ingest route rejects the WHOLE submission with
            // a bare "Invalid submission" naming no field — so a visitor who
            // typed a long signature into "Name / email", or who was on a page
            // with a very long pathname, lost their entire report with no way
            // to know why. Caps: api/feedback/route.ts FeedbackBody.
            contact: contact.value.trim().slice(0, 200) || undefined,
            page: location.pathname.slice(0, 300),
            url: location.href.slice(0, 1000),
            pageTitle: document.title.slice(0, 300) || undefined,
            scope,
            screenshots: shots.length ? shots : undefined,
            selectedElements: selected.length ? selected : undefined,
            ownerPass: ownerPass ?? undefined,
          }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error ?? `Request failed (${res.status})`);
        }
        const body = (await res.json()) as {
          claimUrl?: string;
          owner?: boolean;
          building?: boolean;
          buildNote?: string;
        };
        if (ownerPass && !body.owner) {
          // Expired or revoked: stop presenting it, and read as a visitor.
          forgetOwnerPass(token);
          ownerPass = null;
        }
        if (body.owner) showOwnerSuccess(body.building === true, body.buildNote ?? null);
        else showSuccess(body.claimUrl ?? null);
      } catch (err) {
        submitting = false;
        sendBtn.disabled = false;
        sendBtn.textContent = "Send";
        errEl.textContent = err instanceof Error ? err.message : "Could not send, try again";
      }
    }

    function resetForm() {
      panel.textContent = "";
      panel.append(hdr, reportView);
      if (chat) panel.append(chat.el);
      textarea.value = "";
      cnt.textContent = `0/${MAX_LEN}`;
      submitting = false;
      sendBtn.disabled = true;
      sendBtn.textContent = "Send";
    }

    /** The owner's note: say what happens now, then let them say the next one. */
    function showOwnerSuccess(building: boolean, note: string | null) {
      panel.textContent = "";
      const ok = h("div", "ok");
      ok.append(
        h("div", "tick", building ? "✓" : "!"),
        h("p", undefined, building ? "On it. An agent is building this now." : "Saved."),
        h(
          "div",
          "sub",
          building
            ? "It goes live on this site by itself. Loki tells you when it is."
            : (note ?? "It waits in Loki under Feedback."),
        ),
      );
      const more = h("button", "track", "Say something else") as HTMLButtonElement;
      more.type = "button";
      more.addEventListener("click", () => {
        resetForm();
        textarea.focus();
      });
      ok.append(more);
      panel.appendChild(ok);
    }

    function showSuccess(claimUrl: string | null) {
      panel.textContent = "";
      const ok = h("div", "ok");
      const tick = h("div", "tick", "✓");
      ok.append(
        tick,
        h("p", undefined, "Sent. Thank you."),
        h("div", "sub", "Track what happens next in Loki."),
      );
      if (claimUrl) {
        const track = h("a", "track", "Track this feedback →") as HTMLAnchorElement;
        track.href = claimUrl;
        track.target = "_blank";
        track.rel = "noopener noreferrer";
        ok.append(track);
      }
      panel.appendChild(ok);
      setTimeout(() => {
        // Keep the success view open while the tracking invitation is visible.
        // A visitor should never have to race a disappearing confirmation.
        if (claimUrl) return;
        closePanel();
        // Rebuild the form for the next open (success view replaced it).
        panel.textContent = "";
        panel.append(hdr, reportView);
        if (chat) panel.append(chat.el);
      }, 2200);
    }

    // Programmatic entry point: open prefilled so "report this" is one click.
    // An already-open panel is left alone — the visitor may be mid-sentence,
    // and silently replacing their text would lose it.
    liveReport = (input: ReportInput) => {
      if (panel.isConnected) {
        textarea.focus();
        return;
      }
      openPanel();
      diagnostics = input.diagnostics ?? null;
      syncDiagnostics();
      if (input.message) {
        textarea.value = input.message.slice(0, MAX_LEN);
        cnt.textContent = `${textarea.value.length}/${MAX_LEN}`;
        sendBtn.disabled = !textarea.value.trim();
        // Caret at the end: the visitor adds detail, never clears boilerplate.
        textarea.setSelectionRange(textarea.value.length, textarea.value.length);
      }
    };
    liveAsk = (question: string) => {
      if (!chat) return;
      if (!panel.isConnected) openPanel();
      surfaceMode = "chat";
      syncModes();
      chat.focus();
      if (question.trim()) chat.ask(question);
    };
    // Only now can a click actually open something — see LokiApi.ready.
    api.ready = true;
    if (pendingAsk !== null) {
      const held = pendingAsk;
      pendingAsk = null;
      liveAsk(held);
    }
    if (pendingReport) {
      const held = pendingReport;
      pendingReport = null;
      liveReport(held);
    }
  };

  // Boot gate — the server decides whether to render at all. This makes the
  // Loki token row a remote kill switch: pausing/revoking hides the FAB
  // on the customer site within the cache window, no deploy needed. It also
  // doubles as the heartbeat behind the setup UI's "Live" state. Fail closed:
  // if Loki is unreachable, submissions couldn't land anyway — don't
  // render a dead FAB.
  const boot = async () => {
    try {
      const res = await fetch(`${apiBase}/api/widget-boot?token=${encodeURIComponent(token)}`);
      const body = (await res.json()) as {
        active?: boolean;
        placement?: unknown;
        theme?: WidgetTheme;
      };
      if (body.active !== true) return;
      // Theme must come from boot — the widget has no fallback palette.
      // If boot doesn't provide colors, the widget doesn't render.
      if (!body.theme) return;
      const theme = body.theme;
      // Placement arrives with the render verdict, so the launcher paints once
      // in its final corner instead of appearing bottom-right and jumping.
      placement = normalizePlacement(body.placement);
      // The legacy data-fc-bottom attribute still wins where a customer set it:
      // their HTML is an explicit instruction from someone who looked at the
      // page, and silently overriding it would move a launcher they had already
      // positioned by hand.
      if (Number.isFinite(bottomOffset)) placement.offsetY = bottomOffset;
      // A visitor who dismissed the widget on this site gets no widget, without
      // a round trip to ask. Checked after boot so a revoked token still short-
      // circuits first — the operator's kill switch outranks the preference.
      if (isHiddenByVisitor(visitorOverride)) return;
      if (document.body) mount(theme);
      else document.addEventListener("DOMContentLoaded", () => mount(theme));
    } catch {
      return;
    }
  };
  void boot();
})();
