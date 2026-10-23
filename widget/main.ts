/**
 * Loki Feedback Widget — self-contained embed for customer sites.
 *
 * Usage (docs/architecture/feedback-widget.md):
 *   <script src="https://<loki-host>/widget.js" data-fc-project="fcw_..." async></script>
 *
 * Constraints that shape this file:
 * - Zero dependencies, one bundle: it must mount on ANY site (static HTML,
 *   WordPress, Next, ...) — no React. The one other file is opt-in and lazy:
 *   with data-fc-chat="kit" the conversation is drawn by the shared chat
 *   (public/widget-chat.js, widget/chat/), fetched on first open, and the
 *   panel draws its own if that chunk cannot load.
 * - All UI lives in a Shadow DOM so host CSS and widget CSS can't bleed
 *   into each other. The ONE exception: element-picking highlights must
 *   style host-page elements, so a tiny fcw-* stylesheet is injected into
 *   document.head (removed classes on cleanup).
 * - The token is write-only by design; the API base is derived from this
 *   script's own src, so one snippet works on every deployment.
 *
 * This file owns the panel's frame — header (Loki and the page), the one
 * conversation (widget/conversation.ts), hiding — plus the boot gate and the
 * programmatic window.Loki entry point. The launcher, the element picker,
 * watch mode, the stylesheets and the DOM helpers live in their own modules.
 */

import { pageLabel } from "./page-label";
import { forgetOwnerPass, takeOwnerDenied, takeOwnerPass } from "./owner-pass";
import { forgetMemberPass, takeMemberPass } from "./member-pass";
import { startTourFromFragment } from "./tour";
import type { ReportDiagnostics } from "./report-payload";
import { DEFAULT_PLACEMENT, normalizePlacement, type Placement } from "./placement";
import {
  buildDocCSS,
  buildShadowCSS,
  themesFrom,
  themeVarsCSS,
  varTheme,
  type WidgetTheme,
  type WidgetThemes,
} from "./theme";
import { createThemeMode } from "./theme-mode";
import { createBrowseVoice } from "./browse-voice";
import { createQuickTalk } from "./quick-talk";
import { isVoiceSupported } from "./voice";
import { h, spiralMark } from "./dom";
import { createThoughtsView } from "./thoughts-view";
import { attachSheet } from "./sheet";
import {
  isHiddenByVisitor,
  readHiddenMarker,
  STATUS_EVENT,
  VISIBILITY_EVENT,
  type LauncherStatus,
  readVisitorPlacement,
  restoreRequested,
  writeVisitorPlacement,
} from "./visitor-placement";
import { createLauncher } from "./launcher";
import { createPicker } from "./picker";
import { startWatchMode, type WatchSession } from "./watch";
import { installSelfWatch } from "./self-watch";
import { askAdvisor, READ_QUESTION } from "./loki-api";
import { createConversation } from "./conversation";
import { unsavedChanges } from "./conversation-model";
import { loadChat } from "./chat-loader";
import { chatkitVars } from "./chat/theme";
import { createChanges } from "./changes";
import { assistantFor } from "./thread";
import { showHideToast } from "./panel-views";
import { parseWidgetSurfaceModes } from "./surface-modes";

const MAX_ELEMENTS = 10;

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
  /**
   * Bring the launcher back for a visitor who hid it on this site. The same
   * thing happens when the address carries `#loki`, and when a host calls
   * report() or ask() — an explicit request from the page outranks a hidden
   * button, or the host's own "Report" control would silently do nothing.
   */
  show(): void;
  /**
   * Hide the launcher for this person on this site — the same choice as "Hide
   * on this site" in the launcher's menu, remembered in this browser. For a
   * host that offers its own on/off switch (Loki's account menu does). Undone
   * by show(), report(), ask() or `#loki`.
   */
  hide(): void;
  /** Whether this person has the launcher hidden on this site. */
  readonly hidden: boolean;
  /**
   * Open the panel — what a tap on the launcher does. For a host that draws
   * its own launcher (`data-fc-place="host"`, Loki's top bar). Like report()
   * it brings back a launcher the person had hidden.
   */
  open(): void;
  /**
   * What the launcher would show: the owner's watching state and the count of
   * what Loki said while the panel was closed. Changes are announced as a
   * `loki:status` event on `window` (detail: the same object).
   */
  readonly status: LauncherStatus;
}

(() => {
  // document.currentScript is null for a `type="module"` tag and for some tag
  // managers' injection; before this fallback such an install rendered nothing
  // and said so only in the console. The attribute is the contract, so find it.
  const script =
    (document.currentScript as HTMLScriptElement | null) ??
    document.querySelector<HTMLScriptElement>('script[src*="widget.js"][data-fc-project]');
  const token = script?.getAttribute("data-fc-project") ?? "";
  if (!token) {
    console.warn("[loki-widget] missing data-fc-project attribute");
    return;
  }
  const apiBase = script?.src ? new URL(script.src).origin : "";
  // Light or dark, as Loki is (theme-mode.ts): one per page, shared by the
  // panel and the walkthrough so they never disagree.
  const themeMode = createThemeMode(token, script?.getAttribute("data-fc-theme"));
  // "Watch the fix" runs apart from the launcher: a hidden button still tours.
  startTourFromFragment(apiBase, token, themeMode);
  // The owner, arriving from Loki's "Open your site" link or returning with the
  // pass kept from it. Their notes start the fix instead of waiting in an inbox.
  const ownerState = takeOwnerPass(token);
  let ownerPass = ownerState.pass;
  // A project member (a client) arriving from their own "Open the site" link
  // in Loki, or returning with it: the panel stays the ordinary one, and
  // their notes are filed as theirs (member-pass.ts).
  let memberPass = takeMemberPass(token);
  // Legacy escape hatch, kept working: px from the bottom edge, set in the
  // customer's own HTML. Superseded by the placement served from boot, which an
  // operator can change without touching their site — but an explicitly set
  // attribute still wins (see boot()).
  const bottomOffset = parseInt(script?.getAttribute("data-fc-bottom") ?? "", 10);
  // Modes are captured with the script tag (async scripts lose currentScript later).
  // No attribute means the default pair, Request a change + Ask Loki — both are
  // about improving THIS site. Chat stays opt-in: it is a studio front desk, and
  // this bundle also runs on pilot sites that never asked for one.
  const modesAttr = script?.getAttribute("data-fc-modes") ?? null;
  // `data-fc-chat="kit"`: draw the conversation with the shared chat (chatkit,
  // the one Loki's own chat uses), loaded as its own chunk on first open.
  // Rolled out on Loki's own widget first; without it, the panel draws its own.
  const useKitChat = script?.getAttribute("data-fc-chat") === "kit";
  const scriptNonce = script?.nonce || undefined;

  /** Filled by boot() before mount(); the launcher never paints without it. */
  let placement: Placement = { ...DEFAULT_PLACEMENT };
  /** Where the visitor dragged/parked it, if they did. Their choice outranks
   *  both the operator's and the auto-avoid, and only for them. */
  let visitorOverride: Placement | null = readVisitorPlacement(token);
  // One widget per page, however many tags a site ends up with (a snippet in
  // the template AND one from a tag manager rendered two launchers). Boot is
  // async, so the host element alone cannot say "someone is already coming";
  // the flag covers that window and is cleared if the boot decides not to
  // render, so an SPA that removes and re-adds the tag still gets its widget.
  const w = window as unknown as { __lokiWidgetBooting?: boolean };
  if (document.getElementById("loki-feedback-host") || w.__lokiWidgetBooting) return;
  w.__lokiWidgetBooting = true;

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
  /** Set once boot says render, even if the visitor hid the launcher — so an
   *  explicit report()/ask()/show() can still mount it. */
  let bootedThemes: WidgetThemes | null = null;
  let mounted = false;
  /** Last status announced — see LokiApi.status. */
  let status: LauncherStatus = { owner: false, watching: false, unread: 0 };
  const announceStatus = (next: LauncherStatus) => {
    if (
      next.owner === status.owner &&
      next.watching === status.watching &&
      next.unread === status.unread
    )
      return;
    status = next;
    window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: { ...next } }));
  };
  /** `ready` flipped: say so, so a host-drawn launcher can start answering. */
  const markReady = () => {
    api.ready = true;
    window.dispatchEvent(new CustomEvent(STATUS_EVENT, { detail: { ...status } }));
  };
  /** Set by mount(): bring back a launcher hidden during this page view. */
  let liveShow: (() => void) | null = null;
  /** Set by mount(): hide a launcher that is on screen, toast optional. */
  let liveHide: ((opts: { toast: boolean }) => void) | null = null;
  const announceVisibility = () =>
    window.dispatchEvent(
      new CustomEvent(VISIBILITY_EVENT, { detail: { hidden: isHiddenByVisitor(visitorOverride) } }),
    );
  /** Show a widget the visitor had hidden, because something asked for it —
   *  mounting it first if it was hidden before this page loaded. */
  const unhide = () => {
    if (!isHiddenByVisitor(visitorOverride)) return;
    visitorOverride = null;
    writeVisitorPlacement(token, null);
    if (liveShow) liveShow();
    else if (bootedThemes && !mounted) mountWhenReady(bootedThemes);
    announceVisibility();
  };
  /** The host's switch: same stored choice as the menu's "Hide on this site",
   *  without the toast (the host's own control already shows the state). */
  const hide = () => {
    if (isHiddenByVisitor(visitorOverride)) return;
    if (liveHide) liveHide({ toast: false });
    else {
      visitorOverride = readHiddenMarker();
      writeVisitorPlacement(token, { hidden: true });
      announceVisibility();
    }
  };
  const api: LokiApi = {
    ready: false,
    report(input: ReportInput = {}) {
      unhide();
      if (liveReport) liveReport(input);
      else pendingReport = input;
    },
    ask(question = "") {
      unhide();
      if (liveAsk) liveAsk(question);
      else pendingAsk = question;
    },
    show: unhide,
    hide,
    get hidden() {
      return isHiddenByVisitor(visitorOverride);
    },
    open() {
      api.report();
    },
    get status() {
      return { ...status };
    },
  };
  (window as unknown as { Loki?: LokiApi }).Loki = api;
  // Arriving from the owner link (or returning through the "This is my site" link): open the
  // conversation straight away, so "look at my site and say what to change"
  // is one step, not a hunt for the button. report({}) only opens the panel.
  if (ownerState.arrived) pendingReport = {};
  // Returned through that link signed in as someone else: say so on the site.
  const ownerDenied = takeOwnerDenied();
  // The owner arriving from their link, or anyone opening the page with
  // `#loki`, gets the launcher back even if this browser hid it earlier. Without
  // this, "Hide on this site" was permanent: nothing on the page could undo it.
  if (ownerState.arrived || ownerDenied || restoreRequested()) {
    visitorOverride = null;
    writeVisitorPlacement(token, null);
  }

  // Typing #loki onto a page that is already open is a hash change, not a load.
  window.addEventListener("hashchange", () => {
    if (restoreRequested()) api.show();
  });

  const mountWhenReady = (themes: WidgetThemes) => {
    if (mounted) return;
    mounted = true;
    const go = () => {
      w.__lokiWidgetBooting = false;
      if (document.getElementById("loki-feedback-host")) return;
      mount(themes);
    };
    if (document.body) go();
    else document.addEventListener("DOMContentLoaded", go);
  };

  const mount = (themes: WidgetThemes) => {
    // Every stylesheet below is written against variables; the host defines
    // them for light and dark and themeMode says which (theme.ts).
    const theme: WidgetTheme = varTheme(themes);
    // ---- shadow scaffold ----
    const host = h("div");
    host.id = "loki-feedback-host";
    themeMode.bind(host);
    const root = host.attachShadow({ mode: "open" });
    const style = h("style");
    style.textContent = themeVarsCSS(themes) + buildShadowCSS(theme);
    root.appendChild(style);
    document.body.appendChild(host);

    const docStyle = h("style");
    // The host page cannot read the panel's variables: concrete colours.
    docStyle.textContent = buildDocCSS(themes.light);

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
      onHide: () => hideForVisitor(),
    });
    const fab = launcher.fab;
    /** The launcher's resting display: none while the visitor has it hidden. */
    const fabRest = () => (isHiddenByVisitor(visitorOverride) ? "none" : "");

    // ---- hiding, and getting it back ----
    //
    // Hiding used to live only behind a long-press / right-click on the
    // launcher, and it was one-way: the launcher was removed, the choice stored,
    // and nothing on any page could bring it back — not even the host's own
    // "Report" control. Now it is offered in the panel too, it says how to undo
    // it, and #loki, Loki.show(), report() and ask() all restore it.
    let toast: HTMLElement | null = null;
    function hideForVisitor({ toast: withToast = true }: { toast?: boolean } = {}) {
      if (panel.isConnected) closePanel();
      visitorOverride = readHiddenMarker();
      writeVisitorPlacement(token, { hidden: true });
      fab.style.display = "none";
      toast?.remove();
      toast = withToast ? showHideToast(root, () => api.show()) : null;
      announceVisibility();
    }
    liveHide = hideForVisitor;
    liveShow = () => {
      toast?.remove();
      if (!panel.isConnected) fab.style.display = "";
      launcher.reposition();
    };

    // The widget watching ITSELF (self-watch.ts) — the owner's, like Watch.
    let selfWatch: ReturnType<typeof installSelfWatch> | null = null;

    // ---- panel (built once, shown on demand) ----
    const backdrop = h("div", "backdrop");
    backdrop.addEventListener("click", closePanel);

    const panel = h("div", "panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-label", "Loki");

    // ---- header: who you are talking to, about which page, and Watch ----
    const hdr = h("div", "hdr");
    const hdrText = h("div");
    // The brand line is what makes this recognisably Loki on a stranger's
    // site — the same mono micro-label Loki's own pages use.
    const brand = h("div", "brand");
    brand.append(spiralMark(), h("span", "mono", "Loki"));
    const hdrPage = h("div", "page");
    hdrText.append(brand, hdrPage);
    const hdrActions = h("div", "hdr-actions");
    const closeBtn = h("button", "x", "✕");
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", closePanel);
    hdrActions.append(closeBtn);
    hdr.append(hdrText, hdrActions);
    // The owner's changes and where each one is — the half of "Loki tells
    // you when" that happens on the site (widget/changes.ts). Loki says it in
    // the thread when the panel is open, beside the launcher when it is not.
    const changes = createChanges({
      apiBase,
      token,
      pass: () => ownerPass,
      onLive: (c) => {
        const links = c.href ? [{ label: c.action ?? "See it", url: c.href }] : [];
        conversation.say(`Done — “${c.text}” is live on this site.`, links);
        if (panel.isConnected) return;
        unread++;
        syncWatch();
        launcher.say(`“${c.text.slice(0, 60)}${c.text.length > 60 ? "…" : ""}” is live`);
      },
      onTheme: (pref) => themeMode.setPreference(pref),
      onPassRefused: () => {
        forgetOwnerPass(token);
        ownerPass = null;
        syncWatch();
        conversation.refresh();
      },
      // A fix moved (building → live): the card that noticed it follows.
      onUpdate: () => {
        if (panel.isConnected) conversation.refresh();
      },
      onRender: () => thoughts.repaint(),
      onSay: (text) => conversation.say(text),
      // Changes said on the open card wait on the owner's Save: counted, and
      // a row in the list that brings the card into view.
      unsaved: () => unsavedChanges(conversation?.model.snapshot().draft ?? null),
      onUnsaved: () => {
        thoughts.close();
        conversation.showDraft();
      },
    });
    // The owner's one status line under the header: watching, and where
    // their changes are (thoughts-view.ts).
    const thoughts = createThoughtsView(() => {
      if (watchSession?.on()) watchSession.stop();
      else watchSession?.resume();
      syncWatch();
    }, changes);
    function syncWatch() {
      const on = watchSession?.on() ?? false;
      // The spiral in the header turns while Loki watches, stops when it does not.
      brand.classList.toggle("watching", on);
      brand.classList.toggle("paused", !!ownerPass && !on);
      thoughts.el.style.display = ownerPass ? "" : "none";
      // The owner's status line is the header: the brand row and the page
      // name are a visitor's orientation, and for the owner they were two
      // more rows before the conversation. The close button follows the line.
      panel.classList.toggle("owner", !!ownerPass);
      (ownerPass ? thoughts.head : hdrActions).append(closeBtn);
      thoughts.update(watchSession?.trail() ?? [], on);
      // "Hide this button" is a visitor's way out; the owner's panel is their
      // tool, and the link only took space under the composer on a phone.
      hideLink.hidden = !!ownerPass;
      madeWith.hidden = !!ownerPass;
      // The owner's launcher carries the same state as this header.
      launcher.setOwnerStatus(ownerPass ? { watching: on, unread } : null);
      announceStatus({ owner: !!ownerPass, watching: !!ownerPass && on, unread });
      quickTalk?.sync();
      conversation?.refresh();
    }
    /** What Loki said while the panel was closed — the launcher's badge. */
    let unread = 0;

    // Visible, not only behind a long-press: a visitor who does not want the
    // button should not have to know a gesture to get rid of it.
    const hideLink = h("button", "hide-link", "Hide this button on this site");
    hideLink.addEventListener("click", () => hideForVisitor());
    // The one line a stranger gets about Loki itself: where they are and
    // where to get one. Quiet, last, and gone for the owner, who knows.
    // On a phone only "Made with Loki →" shows (theme.ts .mw-more): the whole
    // sentence wrapped the footer to two rows and pushed Send under it.
    const madeWith = h("a", "made-with", "Made with Loki");
    madeWith.append(h("span", "mw-more", " — build something of your own"), " →");
    madeWith.href = `${apiBase}/build?from=${encodeURIComponent(location.hostname)}`;
    madeWith.target = "_blank";
    madeWith.rel = "noopener";

    let browseVoice: ReturnType<typeof createBrowseVoice> | null = null;
    let quickTalk: ReturnType<typeof createQuickTalk> | null = null;
    /** Talk while you scroll — from the panel's Talk or beside the launcher. */
    function startTalk() {
      if (conversation.hasDraft()) {
        if (!panel.isConnected) openPanel();
        conversation.say("Save or cancel your current note before starting another.");
        return;
      }
      browseVoice?.start();
    }
    const modes = parseWidgetSurfaceModes(modesAttr);
    const picker = createPicker({
      root,
      host,
      docStyle,
      backdrop,
      panel,
      maxElements: MAX_ELEMENTS,
      onCancel: () => conversation.refresh(),
      onStop: () => {
        if (browseVoice?.active()) {
          browseVoice.pointed();
          closePanel();
          return;
        }
        conversation.refresh();
        conversation.focus();
      },
    });
    /** Set once watch mode starts (owner only) — see the end of mount(). */
    let watchSession: WatchSession | null = null;
    const conversation = createConversation({
      apiBase,
      token,
      assistant: () => assistantFor(modes, ownerPass !== null),
      ownerPass: () => ownerPass,
      onPassRefused: () => {
        // Expired or revoked: stop presenting it, and read as a visitor.
        forgetOwnerPass(token);
        ownerPass = null;
        syncWatch();
        conversation.refresh();
      },
      memberPass: () => memberPass,
      onMemberRefused: () => {
        forgetMemberPass(token);
        memberPass = null;
      },
      picker,
      onBusy: (busy) => {
        brand.classList.toggle("thinking", busy);
        thoughts.el.classList.toggle("thinking", busy);
      },
      // A change was filed: Your changes shows where it went, at once.
      onSent: () => changes.start(),
      watch: () => watchSession,
      known: (key) => changes.known(key),
      // The one microphone: talk while you scroll (browse-voice.ts).
      ...(isVoiceSupported() ? { talk: startTalk } : {}),
    });
    // The open card came or went: the header's count and list follow.
    conversation.model.subscribe(() => changes.repaint());

    const foot = h("div", "panel-foot");
    foot.append(madeWith, hideLink);
    panel.append(hdr, thoughts.el, conversation.el, foot);
    // On a phone the panel is a sheet: drag its top up for more, down to peek
    // at the page under it, further down to put it away (sheet.ts).
    const sheet = attachSheet({ panel, handle: hdr, onClose: closePanel });

    function openPanel() {
      unread = 0;
      changes.start();
      fab.style.display = "none";
      hdrPage.textContent = pageLabel(document.title, location.pathname);
      root.append(backdrop, panel);
      syncWatch();
      // Opening is to see what is new: land on the newest message.
      conversation.refresh(true);
      if (useKitChat && !conversation.kit())
        void loadChat(apiBase, scriptNonce).then((mod) => {
          // No chunk (CSP, offline): the panel keeps drawing its own — no dead end.
          if (!mod || conversation.kit()) return;
          conversation.useKit(mod, chatkitVars(theme));
          if (panel.isConnected) conversation.focus();
        });
      root.addEventListener("keydown", onKeydown as EventListener);
      document.addEventListener("keydown", onDocumentKeydown);
      conversation.focus();
      // Measured once it has laid out: a panel too wide for this phone is
      // Loki's bug, and Loki should hear about it from here.
      setTimeout(() => {
        if (panel.isConnected) selfWatch?.checkPanel(panel);
      }, 400);
    }

    function closePanel() {
      if (picker.isPicking()) picker.stop();
      // Abandon any in-flight recording: a lit "recording" indicator after the
      // panel is closed reads as the page still listening.
      conversation.close();
      backdrop.remove();
      panel.remove();
      // Opened again, it is the resting sheet, not the typing one it was
      // closed as (the removed box never reports losing focus).
      sheet.reset();
      root.removeEventListener("keydown", onKeydown as EventListener);
      document.removeEventListener("keydown", onDocumentKeydown);
      fab.style.display = browseVoice?.active() ? "none" : fabRest();
    }

    function onKeydown(e: KeyboardEvent) {
      // The panel is a modal overlay in a shadow root. Host pages bind global
      // hotkeys (⌘K, "/", "?") on document, and the event retargets to the
      // shadow HOST, so their "is the user typing?" guard reads the wrong node
      // and steals keystrokes (observed on orangecat.ch and loki.orangecat.ch).
      // While the panel is open we own the keyboard — stopped here, at the
      // shadow root on the way OUT, not on document on the way in: stopping
      // it in the capture phase also kept it from every control inside the
      // panel that listens for itself (a composer's Enter, a dialog's Escape).
      e.stopPropagation();
      if (conversation.onKey(e)) return;
      if (e.key === "Escape" && !e.defaultPrevented) {
        if (picker.isPicking()) picker.stop();
        else closePanel();
      }
    }

    /** Escape with focus outside the panel (on the page behind it) still closes it. */
    function onDocumentKeydown(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.composedPath().includes(host)) return;
      if (picker.isPicking()) picker.stop();
      else closePanel();
    }

    browseVoice = createBrowseVoice({
      root,
      host,
      theme,
      token,
      endpoint: `${apiBase}/api/widget/transcribe`,
      selected: () => picker.selected(),
      onActive: (active) => {
        if (active) closePanel();
        else {
          if (picker.isPicking()) {
            picker.stop();
            closePanel();
          }
          if (!panel.isConnected) {
            fab.style.display = fabRest();
            root.removeEventListener("keydown", onKeydown as EventListener);
            document.removeEventListener("keydown", onDocumentKeydown);
          }
        }
        syncWatch();
      },
      onTranscript: (text, capture, moments, spokenMs) => {
        if (picker.isPicking()) picker.stop();
        openPanel();
        conversation.recorded(text, capture, moments, spokenMs);
      },
      onError: (message) => {
        openPanel();
        conversation.say(message);
      },
    });

    if (isVoiceSupported())
      quickTalk = createQuickTalk({
        root,
        fab,
        launcher,
        wanted: () => !!ownerPass && !panel.isConnected && !browseVoice?.active(),
        onTalk: startTalk,
      });

    // Programmatic entry point: the host's own "Report" control opens the
    // send confirmation prefilled, with whatever the host attached.
    liveReport = (input: ReportInput) => {
      if (!panel.isConnected) openPanel();
      if (input.message || input.diagnostics)
        conversation.draft(input.message ?? "", input.diagnostics ?? null);
    };
    liveAsk = (question: string) => {
      if (!panel.isConnected) openPanel();
      if (question.trim()) conversation.ask(question);
    };
    // The owner: watch mode (widget/watch.ts). Its state lives on the launcher
    // ("Loki · watching", a count of what it said); what it notices, Loki says
    // in this conversation and, while the panel is closed, in a bubble beside
    // the launcher. The top bar appears only when neither can be seen.
    const watchOpts = { root, host, theme, token, apiBase, pass: () => ownerPass };
    if (ownerPass)
      selfWatch = installSelfWatch({
        apiBase,
        token,
        pass: () => ownerPass,
        active: () => watchSession?.on() ?? false,
        onFinding: (say) => conversation.model.selfNote(say),
      });
    if (ownerPass)
      watchSession = startWatchMode({
        ...watchOpts,
        onOwnRequest: (method, url, status, ms) => selfWatch?.ownRequest(method, url, status, ms),
        onShow: () => {
          if (!panel.isConnected) openPanel();
        },
        onPoint: () => {
          openPanel();
          picker.start();
        },
        onRemark: (r) => {
          conversation.model.noticed(r);
          if (panel.isConnected || browseVoice?.active()) return;
          unread++;
          syncWatch();
          launcher.say(r.short ?? r.say.split("\n")[0]);
        },
        onWithdraw: (slot) => conversation.model.unnoticed(slot),
        statusShown: () => !!browseVoice?.active() || panel.isConnected || launcher.isShown(),
        onChange: syncWatch,
        onTrail: (trail) => thoughts.update(trail, watchSession?.on() ?? false),
        known: (key) => changes.known(key),
        knownReady: () => changes.ready(),
        read: async () => {
          const pass = ownerPass;
          if (!pass) return null;
          const a = await askAdvisor({
            apiBase,
            token,
            question: READ_QUESTION,
            scope: "page",
            selected: [],
            history: [],
            ownerPass: pass,
            read: true,
          });
          if (a.degraded) return null;
          return {
            say: a.messages.map((m: { text: string }) => m.text).join("\n"),
            changes: a.changes,
          };
        },
      });
    syncWatch();
    // The owner's changes are asked for on arrival, so a change that went
    // live since their last visit is announced before they open anything.
    changes.start();
    // Only now can a click actually open something — see LokiApi.ready.
    markReady();
    if (ownerDenied) {
      openPanel();
      conversation.say(
        "You're signed in to Loki, but with an account that can't edit this site. If it should be yours, ask its owner to share the project with you in Loki as an editor, then sign in here again. Until then you can still ask me anything and send notes.",
      );
    }
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
        themes?: WidgetThemes;
      };
      // Theme must come from boot — the widget has no fallback palette.
      // If boot doesn't provide colors, the widget doesn't render.
      const themes = themesFrom(body);
      if (body.active !== true || !themes) {
        w.__lokiWidgetBooting = false;
        return;
      }
      // Placement arrives with the render verdict, so the launcher paints once
      // in its final corner instead of appearing bottom-right and jumping.
      placement = normalizePlacement(body.placement);
      // The legacy data-fc-bottom attribute still wins where a customer set it:
      // their HTML is an explicit instruction from someone who looked at the
      // page, and silently overriding it would move a launcher they had already
      // positioned by hand.
      if (Number.isFinite(bottomOffset)) placement.offsetY = bottomOffset;
      bootedThemes = themes;
      // A report()/ask() made before boot finished is an explicit request.
      if (pendingReport || pendingAsk !== null) unhide();
      // A visitor who dismissed the widget on this site gets no launcher.
      // Checked after boot so a revoked token still short-circuits first — the
      // operator's kill switch outranks the preference. The API stays usable:
      // report()/ask()/show() from the host page bring the widget back.
      if (isHiddenByVisitor(visitorOverride)) {
        markReady();
        w.__lokiWidgetBooting = false;
        return;
      }
      mountWhenReady(themes);
    } catch {
      w.__lokiWidgetBooting = false;
    }
  };
  void boot();
})();
