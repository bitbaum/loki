import { APP_NAME } from "@/config/brand";
import type { BuilderChannel } from "@/lib/constants/statuses";

/**
 * SSOT for user-facing execution copy.
 *
 * Users see one concept: the **runner** (cloud + optional this computer).
 * "Builder" is a person: the role on a project and an approved builder.
 * Internal code, Settings, and /download may still say "Fleet Runner".
 */
export const EXECUTOR_COPY = {
  /** Unified executor — cloud (box-runner) and/or this computer (desktop app) */
  builder: {
    online: "Runner online",
    /** The two tiers a project can be pinned to (Control → project profile → "Runs on"). */
    cloudChoice: "Cloud runner",
    localChoice: "This computer",
    /** The third tier: no PTY, no Claude credential — Hermes in its own clone on the box. */
    hostedChoice: "Hosted runner (Hermes)",
    hostedDetail:
      "Runs in its own clone on the box with the providers the box already has keys for; every task ends in a pull request. Needs no Claude sign-in.",
    cloudOnline: "Cloud runner online",
    localComputerOnline: "This computer online",
    bothOnline: "Cloud + this computer online",
    cloudOnlyDetail: "This computer offline — cloud runner runs the queue",
    localOnlyDetail: "Cloud runner offline — this computer runs the queue",
    cloudOffline: "Cloud runner offline",
    // A private cloud is not an offline one: a new account's Terminal read
    // "Cloud builder offline" beside "private for this account" (2026-10-12).
    cloudPrivate: "Cloud runner private",
    localComputerOffline: "This computer offline",
    offline: "Runner offline",
    queued: "Queued",
    building: "Building",
    setupOptional: "Browser only",
    uncertain: "Status uncertain",
    staleSync: "Cached value — runner hasn't pushed fresh state",
    versionPrefix: "runner",
  },

  /** This computer = laptop/desktop Fleet Runner (optional local path) */
  thisComputer: "This computer",

  /** Cloud = hosted builder channel (private beta until per-tenant sandboxes ship) */
  cloud: "Cloud runner",

  /**
   * The builder named MID-SENTENCE — "Running now on this computer".
   *
   * Deliberately separate from `thisComputer` / `cloud` above, which are
   * standalone chip labels and title-cased; dropping those into a sentence
   * reads as "Running now on This computer". Same concept, different
   * grammatical position, so both spellings are legitimate.
   *
   * Typed Record<BuilderChannel, …> on purpose: a new channel cannot ship
   * without a name, because the alternative is a dispatch label that silently
   * says nothing about where the work went — which is the whole gap this closes.
   */
  ranOn: {
    local: "this computer",
    cloud: "the cloud runner",
  } as Record<BuilderChannel, string>,

  desktopApp: `${APP_NAME} desktop`,

  queuedWhenOffline: "Queued — runs when the runner is online",

  queuedWhenOfflineLong:
    "Work stays in the queue and starts when a runner is online (cloud or this computer).",

  /** Cloud web app always queues; this means a live builder will drain it. */
  queuedWithBuilderOnline: "With runner — starting shortly",
  queuedWithBuilderOnlineLong:
    "a runner is online and will claim it shortly. Use Control for state, or open Sessions to watch the agent and talk to it. You get a notification when the run finishes.",

  // The first screens a new person reads. Written for someone who has never
  // heard "builder", "CLI" or "tenant" — the earlier copy said "dispatch agents
  // against local folders and your own CLI logins … your queue stays
  // tenant-scoped", which is true and meant nothing to the person reading it
  // (seen on the live site, 2026-10-17).
  onboarding: {
    stepTitle: "You're ready to build",
    stepDescriptionTeam:
      "Use Loki from any browser. Connect a computer of yours only when agents should work on files that live on it.",
    stepDescription: "Same account in your browser and on the desktop app.",
    intro: `${APP_NAME} works in your browser. Building needs a computer: ${APP_NAME}'s own, when your account has them, or yours with the desktop app.`,
    browserPath: {
      title: "Continue in your browser",
      body: "Add projects, keep your plans and notes, and tell Loki what to build. Nothing to install.",
    },
    desktopPath: {
      title: "Let agents work on this computer",
      body: `Install the ${APP_NAME} desktop app and agents build in folders on this computer, with the tools you already have here. Only your account can send them work.`,
      cta: "Get the desktop app",
      href: "/download",
    },
    finishLabel: "Continue →",
    connectedBanner: "This computer is connected — agents can work on it",
  },

  runnerBanner: {
    /** Home's builder row: its one grey line under offlineTitle. */
    offlineDetail: (lastSeen: string | null) =>
      lastSeen
        ? `Last seen ${lastSeen} — work waits until it is back`
        : "Work waits until it is back",
    reconnect: "How to reconnect",
    neverSeenTitle: "Connect a runner to run agents",
    /** Home's never-connected row: a short title and its one grey line (the
     *  full sentences above are for the setup that opens from it). */
    neverSeenRowTitle: "Connect a runner",
    neverSeenDetail: "Install the desktop app",
    offlineTitle: "Runner offline",
    neverSeenBody:
      "Agents need a computer to run on. Install the desktop app and they run on yours, in your own folders.",
    offlineBody:
      "Nothing is building right now. Work you send waits its turn — nothing is lost. Open the desktop app on your computer to start it.",
    reconnectHint: "Using this computer? Open the desktop app from the menu bar. Still stuck?",
    settingsLink: "Settings → Agent tokens",
    downloadLink: "re-install the desktop app",
    // An account that HAS the cloud builder never needs the desktop app to
    // build. The lines above were written for accounts that do not, and read
    // from a second computer they sent the owner to a download (2026-10-12).
    cloudTitle: "Agents run on the cloud runner",
    cloudNeverSeenBody:
      "This account builds on Loki's cloud runner — there is nothing to install. Connect a computer of yours only when an agent should work on files that live there.",
    cloudOfflineTitle: "Cloud runner offline",
    cloudOfflineBody:
      "The cloud runner is offline. Work stays queued — nothing is lost, and nothing needs installing: it is a service on the box that reconnects on its own once it is back.",
    alsoThisComputer: "Also run agents on a computer of yours",
  },

  fleetKick: {
    started: (n: number) =>
      `Started **${n}** project loop${n === 1 ? "" : "s"}. Autopilot keeps going when agents finish.`,
    startedQueued: (n: number) =>
      `Queued **${n}** project${n === 1 ? "" : "s"} to build — starts when the runner is online.`,
    slotsBusy: (max: number) =>
      `All **${max}** build slots are busy — loops continue automatically when agents finish.`,
    nothingToKick:
      "No idle projects to kick right now — agents may already be working, queued, or paused per project.",
    watchControl: "Watch progress on [Control](/control).",
  },

  inject: {
    queuedOfflineApi: "Queued — runner offline (runs when online)",
    hostedFallback: "Runner offline — cloud worker will make the change and open a PR.",
    hostedAndLocal:
      "Runner offline — cloud worker started; this computer runs it too when connected.",
    queuedOnly: "Queued — runs when the runner is online.",
  },

  /** How Loki (and Control) reach the agent CLI — not a separate chat channel. */
  loki: {
    buildChain:
      "Loki dispatches into the same runner queue as Control. A cloud or desktop runner claims the job, types into the agent terminal, and you work alongside it on Terminal → Cloud runner or Your computer.",
    watchCloud: "Cloud runner terminal",
    watchThisComputer: "Your computer",
  },

  /** Short labels on dispatch / terminal actions — honest before click. */
  honesty: {
    queued: "Queued",
    needsBuilder: "Needs runner",
    needsGitHub: "Needs GitHub",
    needsGateway: "Needs Loki gateway",
    // Standing presence chip — it shows while idle, while running, while
    // watching. "Starting shortly" was a lie in two of those three states;
    // the chip only truthfully knows the builder is connected. Post-dispatch
    // confirmations keep their own "starting shortly" copy where it IS true.
    builderStarting: "Runner online",
    notificationWhenDone: "Notification when this run finishes.",

    // How a run that did NOT fail explains itself. These used to be written
    // into payload.error by the reaper, so a `partial` run — a success — was
    // rendered in the red error style, wearing reaper vocabulary: "Reaped as
    // timeout ... corrected to partial (see evidence)". A person reading their
    // own project card is not holding the reaper's dictionary.
    reapedButHandoffWritten:
      "The agent had already saved a handoff when this run was closed, so it counts as partial rather than failed.",
    // Worded for both closers: the time reaper AND a runner restart (#917)
    // reach this, and "ran out of time" was false for a session the builder's
    // restart ended.
    reapedButWorkInRepo:
      "This run ended before it could report back, but its work reached the repo — so it counts as partial rather than failed.",
    // This one IS a failure, so it keeps payload.error. Note what it does NOT
    // claim: the runner's ack says "injected", and what it could not establish
    // is whether the agent picked the prompt up. An earlier draft of this line
    // asserted the prompt "never reached an agent", which the evidence does
    // not support — the pane may have been idle with the agent gone, or the
    // agent may have been wedged. State the observation; the recovery is the
    // same either way, and nothing was completed.
    dispatchNeverConfirmed:
      "The prompt was injected, but the agent was never seen starting work — nothing ran to completion. Safe to retry: no work was recorded for this run.",
    watchQueued: "Watch Control for state. Terminal only while a session is running.",
  },

  terminal: {
    cloudLabel: "Cloud runner",
    cloudLabelLocalHost: "Cloud runner (this server)",
    thisComputerLabel: "Your computer",
    cloudHelp: "Choose a session to read its messages or use its terminal.",
    cloudLoading: "Looking for open sessions…",
    cloudEmpty: "Nothing is open in the cloud.",
    cloudEmptyHint:
      "Start an agent below to open a cloud runner session. Choose its location with Runs on.",
    cloudOfflineHint: "Cloud sessions are offline. Work you send waits until they are back.",
    // Connected to the peek stream but no screen frames arrived → the runner is
    // wedged (e.g. its outbound fetch is failing). Honest, actionable — not a
    // black pane labelled "live".
    cloudStalledHint: "This session stopped sending updates. Check Home, or open another session.",
    thisComputerStalledHint:
      "Your connected computer stopped sending session updates. Check that Fleet Runner is open there.",
    thisComputerHelp: "Choose a session on your connected computer to follow or steer the agent.",
    thisComputerEmpty: "Nothing is open on your computer.",
    thisComputerEmptyHint:
      "Start a session on your computer when Fleet Runner is connected. Choose its location with Runs on.",
    thisComputerOfflineHint: "Open Fleet Runner on your computer to see its sessions here.",
    // "Here" is the device reading the page; "this computer" is the account's
    // one desktop runner. From any other device the first line is a trap, so
    // an account with the cloud builder gets the way that works from anywhere.
    thisComputerOfflineCloudHint:
      "Your computer is not connected. The cloud runs this project from anywhere — nothing to install.",
    thisComputerOfflineCloudDownHint:
      "Neither your computer nor the cloud is connected. Work you send waits until one is back.",
    useCloudBuilder: "Use the cloud",
    thisComputerLoading: "Looking for sessions on this computer…",
  },
} as const;
