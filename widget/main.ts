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
 * This file owns the panel's frame — header (Loki, the page, Watch), the one
 * conversation (widget/conversation.ts), hiding — plus the boot gate and the
 * programmatic window.Loki entry point. The launcher, the element picker,
 * watch mode, the stylesheets and the DOM helpers live in their own modules.
 */

import { forgetOwnerPass, ownerSignInUrl, takeOwnerDenied, takeOwnerPass } from "./owner-pass";
import { startTourFromFragment } from "./tour";
import type { ReportDiagnostics } from "./report-payload";
import { DEFAULT_PLACEMENT, normalizePlacement, type Placement } from "./placement";
import { buildDocCSS, buildShadowCSS, type WidgetTheme } from "./theme";
import { h, spiralMark } from "./dom";
import { createThoughtsView } from "./thoughts-view";
import {
  isHiddenByVisitor,
  readHiddenMarker,
  readVisitorPlacement,
  restoreRequested,
  writeVisitorPlacement,
} from "./visitor-placement";
import { createLauncher } from "./launcher";
import { createPicker } from "./picker";
import { startWatchMode, type WatchSession } from "./watch";
import { createConversation } from "./conversation";
import { createChanges } from "./changes";
import { assistantFor } from "./thread";
import { showHideToast, watchOfferView } from "./panel-views";
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
  // "Watch the fix" runs apart from the launcher: a hidden button still tours.
  startTourFromFragment(apiBase, token);
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
  // No attribute means the default pair, Request a change + Ask Loki — both are
  // about improving THIS site. Chat stays opt-in: it is a studio front desk, and
  // this bundle also runs on pilot sites that never asked for one.
  const modesAttr = script?.getAttribute("data-fc-modes") ?? null;

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
  let bootedTheme: WidgetTheme | null = null;
  let mounted = false;
  /** Set by mount(): bring back a launcher hidden during this page view. */
  let liveShow: (() => void) | null = null;
  /** Show a widget the visitor had hidden, because something asked for it —
   *  mounting it first if it was hidden before this page loaded. */
  const unhide = () => {
    if (!isHiddenByVisitor(visitorOverride)) return;
    visitorOverride = null;
    writeVisitorPlacement(token, null);
    if (liveShow) liveShow();
    else if (bootedTheme && !mounted) mountWhenReady(bootedTheme);
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

  const mountWhenReady = (theme: WidgetTheme) => {
    if (mounted) return;
    mounted = true;
    const go = () => {
      w.__lokiWidgetBooting = false;
      if (document.getElementById("loki-feedback-host")) return;
      mount(theme);
    };
    if (document.body) go();
    else document.addEventListener("DOMContentLoaded", go);
  };

  const mount = (theme: WidgetTheme) => {
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
      onHide: hideForVisitor,
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
    function hideForVisitor() {
      if (panel.isConnected) closePanel();
      visitorOverride = readHiddenMarker();
      writeVisitorPlacement(token, { hidden: true });
      fab.style.display = "none";
      toast?.remove();
      toast = showHideToast(root, () => api.show());
    }
    liveShow = () => {
      toast?.remove();
      if (!panel.isConnected) fab.style.display = "";
      launcher.reposition();
    };

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
    // The header names who and where, and nothing else competes with it: for
    // the owner, watching is told AND controlled in one place — the notes row
    // under it (Pause / Resume), and Review is the first suggestion in the
    // conversation. It used to carry Review + Stop watching pills beside ✕,
    // two loud buttons repeating what the row and the starter already said.
    // Someone not yet known as the owner keeps one quiet Watch here.
    const watchBtn = h("button", "watchbtn", "Watch");
    watchBtn.type = "button";
    watchBtn.title = "Let Loki watch you use this site and tell you what isn't working";
    const closeBtn = h("button", "x", "✕");
    closeBtn.setAttribute("aria-label", "Close");
    closeBtn.addEventListener("click", closePanel);
    hdrActions.append(watchBtn, closeBtn);
    hdr.append(hdrText, hdrActions);
    const watchOffer = watchOfferView(ownerSignInUrl(apiBase, token, location.href));
    // What Loki is seeing while it watches — the owner's, under the header.
    const thoughts = createThoughtsView(() => {
      if (watchSession?.on()) watchSession.stop();
      else watchSession?.resume();
      syncWatch();
    });
    watchBtn.addEventListener("click", () => {
      watchOffer.style.display = watchOffer.style.display ? "" : "none";
    });
    function syncWatch() {
      const on = watchSession?.on() ?? false;
      watchBtn.style.display = ownerPass ? "none" : "";
      // The spiral in the header turns while Loki watches, stops when it does not.
      brand.classList.toggle("watching", on);
      brand.classList.toggle("paused", !!ownerPass && !on);
      thoughts.el.style.display = ownerPass ? "" : "none";
      thoughts.update(watchSession?.trail() ?? [], on);
      if (ownerPass) watchOffer.style.display = "none";
      // "Hide this button" is a visitor's way out; the owner's panel is their
      // tool, and the link only took space under the composer on a phone.
      hideLink.style.display = ownerPass ? "none" : "";
      madeWith.style.display = ownerPass ? "none" : "";
      // The owner's launcher carries the same state as this header.
      launcher.setOwnerStatus(ownerPass ? { watching: on, unread } : null);
      conversation?.refresh();
    }
    /** What Loki said while the panel was closed — the launcher's badge. */
    let unread = 0;

    // Visible, not only behind a long-press: a visitor who does not want the
    // button should not have to know a gesture to get rid of it.
    const hideLink = h("button", "hide-link", "Hide this button on this site");
    hideLink.addEventListener("click", hideForVisitor);
    // The one line a stranger gets about Loki itself: where they are and
    // where to get one. Quiet, last, and gone for the owner, who knows.
    const madeWith = h("a", "made-with", "Made with Loki — build something of your own →");
    madeWith.href = `${apiBase}/build?from=${encodeURIComponent(location.hostname)}`;
    madeWith.target = "_blank";
    madeWith.rel = "noopener";

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
      picker,
      onBusy: (busy) => brand.classList.toggle("thinking", busy),
      watch: () => watchSession,
    });

    // The owner's changes and where each one is — the half of "Loki tells
    // you when" that happens on the site (widget/changes.ts). Loki says it in
    // the thread when the panel is open, beside the launcher when it is not.
    const changes = createChanges({
      apiBase,
      token,
      pass: () => ownerPass,
      onLive: (c) => {
        const links = c.href ? [{ label: c.action ?? "See it", url: c.href }] : [];
        conversation.say(`“${c.text}” is live on this site.`, links);
        if (panel.isConnected) return;
        unread++;
        syncWatch();
        launcher.say(`“${c.text.slice(0, 60)}${c.text.length > 60 ? "…" : ""}” is live`);
      },
      onPassRefused: () => {
        forgetOwnerPass(token);
        ownerPass = null;
        syncWatch();
        conversation.refresh();
      },
    });
    panel.append(hdr, watchOffer, thoughts.el, changes.el, conversation.el, madeWith, hideLink);

    function openPanel() {
      unread = 0;
      changes.start();
      fab.style.display = "none";
      hdrPage.textContent = document.title || location.pathname;
      root.append(backdrop, panel);
      syncWatch();
      // Opening is to see what is new: land on the newest message.
      conversation.refresh(true);
      document.addEventListener("keydown", onKeydown, true);
      conversation.focus();
    }

    function closePanel() {
      if (picker.isPicking()) picker.stop();
      // Abandon any in-flight recording: a lit "recording" indicator after the
      // panel is closed reads as the page still listening.
      conversation.close();
      backdrop.remove();
      panel.remove();
      document.removeEventListener("keydown", onKeydown, true);
      fab.style.display = fabRest();
    }

    function onKeydown(e: KeyboardEvent) {
      // The panel is a modal overlay in a shadow root. Host pages bind global
      // hotkeys (⌘K, "/", "?") on document, and the event retargets to the
      // shadow HOST, so their "is the user typing?" guard reads the wrong node
      // and steals keystrokes (observed on orangecat.ch and loki.orangecat.ch).
      // While the panel is open we own the keyboard.
      e.stopPropagation();
      if (conversation.onKey(e)) return;
      if (e.key === "Escape") {
        if (picker.isPicking()) picker.stop();
        else closePanel();
      }
    }

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
      watchSession = startWatchMode({
        ...watchOpts,
        onShow: () => {
          if (!panel.isConnected) openPanel();
        },
        onRemark: (r) => {
          conversation.noticed(r);
          if (panel.isConnected) return;
          unread++;
          syncWatch();
          launcher.say(r.short ?? r.say.split("\n")[0]);
        },
        statusShown: () => panel.isConnected || launcher.isShown(),
        onChange: syncWatch,
        onTrail: (trail) => thoughts.update(trail, watchSession?.on() ?? false),
      });
    syncWatch();
    // The owner's changes are asked for on arrival, so a change that went
    // live since their last visit is announced before they open anything.
    changes.start();
    // Only now can a click actually open something — see LokiApi.ready.
    api.ready = true;
    if (ownerDenied) {
      openPanel();
      conversation.say(
        "You're signed in to Loki, but this site belongs to another account — so I can't watch here for you. If it should be yours, ask its owner to share the project with you in Loki.",
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
      };
      // Theme must come from boot — the widget has no fallback palette.
      // If boot doesn't provide colors, the widget doesn't render.
      if (body.active !== true || !body.theme) {
        w.__lokiWidgetBooting = false;
        return;
      }
      const theme = body.theme;
      // Placement arrives with the render verdict, so the launcher paints once
      // in its final corner instead of appearing bottom-right and jumping.
      placement = normalizePlacement(body.placement);
      // The legacy data-fc-bottom attribute still wins where a customer set it:
      // their HTML is an explicit instruction from someone who looked at the
      // page, and silently overriding it would move a launcher they had already
      // positioned by hand.
      if (Number.isFinite(bottomOffset)) placement.offsetY = bottomOffset;
      bootedTheme = theme;
      // A report()/ask() made before boot finished is an explicit request.
      if (pendingReport || pendingAsk !== null) unhide();
      // A visitor who dismissed the widget on this site gets no launcher.
      // Checked after boot so a revoked token still short-circuits first — the
      // operator's kill switch outranks the preference. The API stays usable:
      // report()/ask()/show() from the host page bring the widget back.
      if (isHiddenByVisitor(visitorOverride)) {
        api.ready = true;
        w.__lokiWidgetBooting = false;
        return;
      }
      mountWhenReady(theme);
    } catch {
      w.__lokiWidgetBooting = false;
    }
  };
  void boot();
})();
