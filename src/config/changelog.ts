/**
 * Fleet Runner release history — SSOT for /releases page + footer version pill.
 *
 * Append a new entry to FLEET_RUNNER_RELEASES per release. The first entry
 * (newest) is treated as "current"; the rest render as a vertical timeline.
 *
 * Editing rules:
 *  - One entry per `fleet-runner-vX.Y.Z` tag pushed to loki-releases.
 *  - `date` is the GitHub release publishedAt (UTC, ISO 8601).
 *  - `highlights` is 1–6 short user-facing bullets, written as plain English
 *    sentences ending with a period. No commit-message slang ("refactor:",
 *    "fix:"); the audience here is "person who installed Fleet Runner and
 *    wants to know what changed."
 *  - `breaking` is for genuine compat breaks (config rename, removed flag).
 *    Empty array when none.
 *  - `notes` is an optional one-paragraph hand-written explanation of WHY
 *    the release matters. Empty string is fine for routine releases.
 */

export interface ReleaseEntry {
  version: string; // e.g. "0.7.4"
  tag: string; // e.g. "fleet-runner-v0.7.4" (matches GitHub release tag)
  date: string; // ISO 8601 UTC, e.g. "2026-06-07T14:35:53Z"
  highlights: string[]; // user-facing bullets
  breaking: string[]; // compat-breaks, empty if none
  notes: string; // optional hand-written paragraph; "" if nothing extra to say
}

/** Newest first. */
export const FLEET_RUNNER_RELEASES: ReleaseEntry[] = [
  {
    version: "0.8.33",
    tag: "fleet-runner-v0.8.33",
    date: "2026-09-25T00:00:00Z",
    highlights: [
      "The cloud builder no longer reports offline while the box runner is connected and shipping work. Bridge presence now uses the same cloud/local channel as the heartbeat, so /terminal and the journal agree.",
    ],
    breaking: [],
    notes:
      "A box-* runner that registered bridge presence as local made applyHeartbeatExpiry clear both channels. Presence channel is inferred from the runner version (or LOKI_RUNNER_PRESENCE_CHANNEL) so it matches the runtime-state heartbeat.",
  },
  {
    version: "0.8.32",
    tag: "fleet-runner-v0.8.32",
    date: "2026-09-25T00:00:00Z",
    highlights: [
      "A task that mentions rate limits, credits or context windows is no longer mistaken for the agent running out of quota. The runner used to read those words in the prompt it had just typed and close a working run as failed.",
      "Claude keeps its run while it is still generating, even if its screen shows a usage warning such as \u201capproaching usage limit\u201d.",
    ],
    breaking: [],
    notes:
      "Quota detection now reads only what the agent printed after the prompt was submitted, ignores lines that are just the prompt echoed back, and defers to Claude's own session status. A run is still closed when the agent really hits a usage wall.",
  },
  {
    version: "0.8.31",
    tag: "fleet-runner-v0.8.31",
    date: "2026-09-25T00:00:00Z",
    highlights: [
      "Updated five bundled libraries to their security-patched versions. Nothing in the runner behaves differently \u2014 earlier builds simply carried known-vulnerable copies of code they depend on.",
    ],
    breaking: [],
    notes:
      "These are transitive dependencies, libraries pulled in by other libraries rather than chosen directly, which is why no automatic update ever proposed a fix for them. They ship inside the runner, so the patched versions only reach a machine through a release like this one.",
  },
  {
    version: "0.8.30",
    tag: "fleet-runner-v0.8.30",
    date: "2026-09-22T00:00:00Z",
    highlights: [
      "Crash reporting and the build toolchain move up a version (@sentry/electron 7.19.0, vite 8.3.0), and the YAML parser bundled with the runner is updated to 4.3.2.",
    ],
    breaking: [],
    notes:
      "Dependency maintenance only — nothing about how the runner behaves changes. These updates sat in three separate pull requests for up to fifteen days: the auto-merge sweep had deadlocked, and each was additionally red on the release-drift gate, which asks any change reaching a machine to bump this version and add the entry you are reading. Shipped as one release rather than three so operators get one update, not three identical-looking ones.",
  },
  {
    version: "0.8.29",
    tag: "fleet-runner-v0.8.29",
    date: "2026-09-20T00:00:00Z",
    highlights: [
      "The About dialog and the installer's copyright metadata now read \u00a9 2026 Cato. Every build since the rename had shipped a name that was retired months ago \u2014 it was in the desktop app rather than the website, so no audit of the site ever looked there.",
    ],
    breaking: [],
    notes:
      "Cosmetic, but it shipped in every installer: the only place the retired identity was still compiled into a binary rather than rendered from content.",
  },
  {
    version: "0.8.28",
    tag: "fleet-runner-v0.8.28",
    date: "2026-09-17T09:00:00Z",
    highlights: [
      "A provider quota screen is now reported as an exhausted usage limit with a provider-switch action, instead of being mistaken for model generation.",
      "Grok weekly-limit screens and other zero-capacity messages stop the run honestly even when the terminal redraws after prompt delivery.",
      "Retry now replaces a live terminal when the project provider changed, so choosing Cursor cannot silently inject into an old Grok session.",
      "The provider switch command now follows the project's Cloud or This computer setting instead of silently defaulting to Cloud.",
    ],
    breaking: [],
    notes:
      "Prompt delivery and model generation are separate facts. Fleet Runner now checks the provider screen before it tells Loki that generation began.",
  },
  {
    version: "0.8.27",
    tag: "fleet-runner-v0.8.27",
    date: "2026-09-17T08:00:00Z",
    highlights: [
      "Every Terminal viewer now receives the current agent screen immediately, including when the agent is quiet and another viewer was already connected.",
      "Reopening or switching into a cloud session no longer leaves a connected black terminal that later claims the builder is not responding.",
    ],
    breaking: [],
    notes:
      "The runner still keeps one efficient PTY subscription per session; it now replays that retained screen for each new viewer.",
  },
  {
    version: "0.8.26",
    tag: "fleet-runner-v0.8.26",
    date: "2026-09-16T19:00:00Z",
    highlights: [
      "Feedback Implement now prepares Grok and Cursor for unattended work, so a first-run trust or approval screen cannot consume the implementation brief.",
      "Run verification watches the whole post-submit output window. Short quiet moments no longer turn an actively working Grok or Cursor session into a false Failed row.",
      "When an agent still cannot start, Loki names the observed blocker and the action to take in Terminal instead of showing a generic Retry message.",
    ],
    breaking: [],
    notes:
      "Proven through the production feedback loop: Grok was visibly reading and editing in Loki Terminal while the old verifier had already marked the run Failed.",
  },
  {
    version: "0.8.24",
    tag: "fleet-runner-v0.8.24",
    date: "2026-09-14T00:00:00Z",
    highlights: [
      "The product is now called Loki, and the runner says so everywhere it used to say the old name: the app it connects to, the config folder it reads, and the environment keys it accepts (LOKI_*).",
      "Existing installs keep working: the old host redirects to loki.orangecat.ch and the old config folder is still read.",
    ],
    breaking: [
      "Environment keys were renamed from the old prefix to LOKI_*; a launcher that set the old keys must set the new ones.",
    ],
    notes:
      "A rename, not a behaviour change. It ships as its own version so the tag, the /releases page and the machines that auto-update agree on what they run.",
  },
  {
    version: "0.8.23",
    tag: "fleet-runner-v0.8.23",
    date: "2026-09-12T18:00:00Z",
    highlights: [
      'The runner now says WHY a quiet agent is quiet. After 90 seconds of no output from a dispatched run it asks the same question the dispatch path already asks — is this agent signed in? — and puts the answer on the next progress beat. Loki\'s feedback row then reads "Needs you to sign in" with a link straight to that terminal, instead of "the agent never reported any output".',
      "A blocked agent prints nothing, so a beat is now allowed through on silence that carries a reason; silence alone still stays quiet, and the rate stays one beat per window.",
    ],
    breaking: [],
    notes:
      "Fixes a real thirteen-minute wait on 2026-09-12: a dispatched fix sat at a Claude sign-in prompt and the only way to discover it was to open a terminal by hand. The authentication check already existed but ran once, in an 8-second window at inject time.",
  },
  {
    version: "0.8.22",
    tag: "fleet-runner-v0.8.22",
    date: "2026-09-11T15:00:00Z",
    highlights: [
      "A dispatch for a project whose folder is not on this computer is refused instead of attempted. The runner used to launch the agent in a directory that does not exist and report that the prompt 'did not stick'; now the run says which workspace is missing and that the project lives on another builder.",
    ],
    breaking: [],
    notes:
      "Projects Loki set up on the cloud builder are already routed there, so this is the belt to that braces: if such a dispatch reaches a laptop anyway, the failure names its real cause in one line instead of looking like a broken agent.",
  },
  {
    version: "0.8.21",
    tag: "fleet-runner-v0.8.21",
    date: "2026-09-11T13:00:00Z",
    highlights: [
      'The runner reports progress while an agent works: once a dispatched prompt has landed, it watches that agent\'s terminal and beats PATCH /api/control/runs/:id/progress at most every 45 seconds, only while the terminal keeps printing. Feedback and Control now read "Working · 47 min" with a Watch link into the terminal instead of guessing "Not running" from the clock at minute ten.',
      "Silence is honest: no output means no beat, so a run that goes quiet turns Stalled with how long it worked and how long it has been silent.",
    ],
    breaking: [],
    notes:
      "Server side ships in the same Loki deploy (the box runner restarts once idle). A desktop Fleet Runner on 0.8.20 keeps working; its runs simply show the pre-heartbeat phases until it updates.",
  },
  {
    version: "0.8.20",
    tag: "fleet-runner-v0.8.20",
    date: "2026-09-11T10:00:00Z",
    highlights: [
      "The retired focus_tab command is now refused at the door: it no longer exists in the command contract, so nothing can enqueue it and the runner has no case for it.",
      "Runner and desktop descriptions say what the app is now: the Loki desktop agent runtime that owns the agent terminals on this computer.",
    ],
    breaking: [],
    notes:
      "Follow-up to 0.8.19. No behaviour change for a running fleet; this release exists because the desktop tree changed and the changelog is the single source of truth for what shipped.",
  },
  {
    version: "0.8.19",
    tag: "fleet-runner-v0.8.19",
    date: "2026-09-11T09:21:39Z",
    highlights: [
      'Fleet Runner no longer tries to bring up a zellij session on boot, so the "Could not bring zellij up" notification is gone for good.',
      "Every agent runs in a terminal Fleet Runner owns. A prompt for a project with no running agent is refused with a clear reason instead of being typed into a guessed terminal tab; the cloud starts the agent for you.",
      "Agent installers run in an owned terminal too, so you can watch them from the web terminal.",
      "The Restoration section of Settings → Agent is gone with the cold-start it configured.",
    ],
    breaking: [
      "LOKI_RUNNER_PTY is ignored: there is no zellij mode to force any more. Agents that were driven in your own zellij tabs are not seen by Fleet Runner; dispatch them once to move them into an owned terminal.",
      "The focus_tab command is retired. Watch the agent in the web terminal instead.",
    ],
    notes:
      "One substrate. Since 0.8.3 the owned terminal was the default with zellij kept as a fallback for tabs it could not find, and the fallback is where every stuck dispatch ended up: a keystroke typed into a tab named 'Tab #9', a cold-start that spawned a session no terminal could show, a desired-state restore that reproduced the box's fleet on a laptop. This release deletes the fallback rather than hardening it again.",
  },
  {
    version: "0.8.18",
    tag: "fleet-runner-v0.8.18",
    date: "2026-09-09T15:35:00Z",
    highlights: [
      "Feedback implementation now resumes Claude's durable native session instead of treating a terminal tab name as the identity of the work.",
      "Watch links follow the project to whichever runner owns its live session, without forcing Cloud or exposing a tab name in the URL.",
      "A runner restart no longer makes Loki kill a live terminal merely because an in-memory session map was lost.",
    ],
    breaking: [],
    notes:
      "This closes the identity gap between Implement and Watch: the database session id drives resume, while a tab remains only the transport used to display and type into that session.",
  },
  {
    version: "0.8.17",
    tag: "fleet-runner-v0.8.17",
    date: "2026-09-04T12:55:00Z",
    highlights: [
      "Dependency refresh — no behaviour change; this release exists so the updated lockfile actually reaches installed runners.",
    ],
    breaking: [],
    notes:
      "Dependabot bumped @types/node (#411), which edits desktop/package-lock.json — a file that determines what gets built into the runner. Nothing bumped the version alongside it, so main went red on the release-drift gate and the merge queue stopped: the sweep only merges onto a green base. The gate was right. A lockfile change with no release is a change that lives on the server and on no machine, which is the failure the gate was written for after six commits went missing at v0.8.12. Worth noting the shape: a dependency bot can trip a release gate, and its PR will never carry the bump itself.",
  },
  {
    version: "0.8.16",
    tag: "fleet-runner-v0.8.16",
    date: "2026-09-04T12:10:00Z",
    highlights: [
      "When a prompt reaches an agent but the agent never starts generating, the advice now names the agent you are actually running instead of always saying “grok”.",
    ],
    breaking: [],
    notes:
      "Seen on a real dispatch: “launched claude (pty) + injected … Retry, or switch the project agent away from grok if this repeats.” One sentence naming the agent that ran and, as advice, one that did not — a literal left over from when grok was the default, in a message that already had the right agent in scope. Small, but it is the sentence you read when something has gone wrong, and advice about an agent you are not using undermines the diagnosis around it. A gate now requires any failure message that names an agent to interpolate the real one.",
  },
  {
    version: "0.8.15",
    tag: "fleet-runner-v0.8.15",
    date: "2026-08-28T07:30:00Z",
    highlights: [
      "Fleet Runner now points at the bitbaum organisation, where the studio's repositories live as of today.",
    ],
    breaking: [],
    notes:
      "The 41-repo fleet moved from the personal catomean account into the bitbaum GitHub org, and desktop carried two literal owner references (the issue-report link, the auto-updater's feed owner) that the sweep updates alongside every other repo. Same shape as 0.8.14 four commits ago: an owner literal in desktop/ changes, the release-drift gate catches it, a release ships. This one is the last time it should be an account name at all — the org is the stable home going forward.",
  },
  {
    version: "0.8.14",
    tag: "fleet-runner-v0.8.14",
    date: "2026-08-27T19:40:00Z",
    highlights: [
      "Fleet Runner now points at the renamed GitHub account, so updates and release downloads resolve again.",
    ],
    breaking: [],
    notes:
      "The GitHub account this project lives under was renamed, and two files in desktop/ carried the old name — an update URL and a package reference. GitHub redirects repository URLs, but only until somebody else claims the freed name, so a redirect is not something an auto-updater should depend on. Cut as its own release because the check that fails when desktop code changes without a version bump is exactly the check that caught it, four commits after it was written to prevent this.",
  },
  {
    version: "0.8.13",
    tag: "fleet-runner-v0.8.13",
    date: "2026-08-26T09:20:00Z",
    highlights: [
      "Your machine now tells the fleet whether it is on wall power or on battery, and dispatches stop being routed to a laptop that will sleep when the lid shuts.",
      "A run that touches the same directory twice is metered once. Long sessions were being billed for the same tokens repeatedly, which inflated the cost shown against a project.",
      'Dispatched work reports the phase it is actually in instead of sitting on a bare "dispatched" chip until it finishes.',
      "The agent count on Control now counts agents that are genuinely working, not every process that happens to be alive.",
    ],
    breaking: [],
    notes:
      "Everything here was merged between 14 and 26 August and had been sitting on the server, unreachable by any machine, because a release was never cut. Fleet Runner ships only when a fleet-runner-v tag exists, that tag was minted by hand, and nothing checked that anyone had done it — so seven changed files reported no problem at all while going nowhere. CI now fails when desktop code changes without a version bump, and mints and publishes the tag itself once main is green. This release is the backlog that gap accumulated.",
  },
  {
    version: "0.8.12",
    tag: "fleet-runner-v0.8.12",
    date: "2026-08-14T11:00:00Z",
    highlights: [
      'The terminal tab strip now names the agent running in each tab, including tabs you never renamed. A machine with Claude in one tab and Grok in another reads "Tab #3 GROK" and "Tab #4 CLAUDE" instead of five identical labels.',
      "Tabs also show the project they belong to, read from the live agent process rather than from a config file.",
      "When the tab cannot be identified, no badge is shown at all — a wrong badge would aim a dispatched prompt at the wrong agent.",
    ],
    breaking: [],
    notes:
      'Local counterpart to the web-side tab-truth work. The join reads the ZELLIJ_PANE_ID that zellij exports into each pane and the agent CLI inherits (via /proc/<pid>/environ), then resolves it against the session\'s own metadata — pane id to tab position to tab name. This replaces name-matching, which cannot work for a default-named tab: "Tab #3" shares no text with the project directory, so every match fell through silently and the runner published an empty pane list. Resolution order is pane id, then config entry, then directory basename, and any parse failure yields an empty map. Needed a release because the web deploy updates the cloud builder but cannot update a desktop app.',
  },
  {
    version: "0.8.11",
    tag: "fleet-runner-v0.8.11",
    date: "2026-08-04T14:15:31Z",
    highlights: [
      "macOS and Windows installers are published again, alongside Linux.",
      "The Linux build ships a usable application icon.",
      "Per-run cost metering now measures the directory the agent actually runs in, so worktree-isolated dispatches are attributed to the right project.",
    ],
    breaking: [],
    notes:
      "Recorded here after the fact: this release shipped on 2026-08-04 but was never added to the timeline, so /releases and the footer version pill both kept claiming 0.8.9 while operators were running 0.8.11. The release itself restored the full three-platform matrix (#157) after a period when only Linux was being produced.",
  },
  {
    version: "0.8.9",
    tag: "fleet-runner-v0.8.9",
    date: "2026-06-18T17:09:04Z",
    highlights: [
      'The "My machine" terminal is now fully interactive — char-level keystrokes, Ctrl-C / Tab / arrows, and live resize — at parity with the server terminal.',
    ],
    breaking: [],
    notes:
      "P3 terminal interactive parity. A non-durable rawkey/resize event rides the existing bridge NOTIFY → SSE channel (no per-keystroke DB rows, no command-claim); the runner dispatches it to writeRawKey/resizePty, writing bytes verbatim into the agent's owned PTY. Strictly additive and independent of the autopilot command-drain path. Verified end-to-end: typed in the browser terminal, echoed from a runner-owned PTY with no zellij dependency; killing an agent leaves the runner green (PTY isolation confirmed). Linux (AppImage + .deb).",
  },
  {
    version: "0.8.8",
    tag: "fleet-runner-v0.8.8",
    date: "2026-06-18T09:00:00Z",
    highlights: [
      "The runner no longer goes silently offline after the dashboard restarts (e.g. during a deploy). The command poll now has a hard timeout, so a half-open connection can't wedge the loop with the app still running.",
    ],
    breaking: [],
    notes:
      "Reliability: the wait=0 command poll had no request timeout, so a connection left half-open by a backend restart could hang the poll forever — the poller went silent, the process stayed alive (so nothing restarted it), and the autopilot loop stalled. Bounded the poll with AbortSignal.timeout(20s); on timeout it backs off and retries instead of hanging. Pairs with the supervised systemd service (Restart=always) for end-to-end 'never silently offline'.",
  },
  {
    version: "0.8.7",
    tag: "fleet-runner-v0.8.7",
    date: "2026-06-18T07:00:00Z",
    highlights: [
      "Dispatched and next-best prompts now actually submit. Large multi-line prompts were being pasted into the agent's input but never sent (stuck as “[Pasted text +N lines]”), so the agent looked launched but never started working.",
    ],
    breaking: [],
    notes:
      "Injection fix. Claude's TUI treats a big multi-line write as a bracketed paste and absorbs a trailing carriage return into the paste buffer instead of submitting — so the prompt sat in the input unsent and every dispatch reported “the agent didn't pick up the prompt within the window.” Fixed by sending the submit Enter as a separate keystroke after the paste settles (two nudged CRs at 250ms/800ms). Found by driving kivvi end-to-end and reading the live PTY.",
  },
  {
    version: "0.8.6",
    tag: "fleet-runner-v0.8.6",
    date: "2026-06-18T00:00:00Z",
    highlights: [
      "Autopilot is reliable now: the runner no longer freezes after a terminal peek, so dispatched and next-best prompts keep flowing instead of silently queueing forever.",
      "Newly launched agents appear in the dashboard and the live terminal within a second, instead of after a 5-minute heartbeat.",
      "The status heartbeat can no longer get stuck on a slow request, so the dashboard stops showing stale state.",
    ],
    breaking: [],
    notes:
      "Reliability release for the autopilot loop. Three root causes of the 'nothing works' freeze: (1) the live-terminal peek ran a synchronous zellij dump-screen that blocked the runner's single event loop and starved command acks → every command was re-served forever; fixed by streaming only owned PTYs (async, in-memory). (2) the status push had no request timeout → one hung request killed the heartbeat. (3) runtime state was only pushed every 5 min → launched agents took minutes to appear; now pushed immediately after each command.",
  },
  {
    version: "0.8.3",
    tag: "fleet-runner-v0.8.3",
    date: "2026-06-17T21:30:00Z",
    highlights: [
      'Agents now run in a terminal Fleet Runner owns by default — no more dispatch/launch timeouts when your Zellij session isn\'t attached (the recurring "spawnSync /bin/sh ETIMEDOUT").',
      "If an owned-terminal launch ever fails, it falls back to Zellij automatically, so launching can't dead-end.",
      "Watch any agent live from the web app in full color with scrollback.",
    ],
    breaking: [],
    notes:
      "Makes the owned-PTY execution from 0.8.2 the default (set LOKI_RUNNER_PTY=false to force Zellij). This removes the structural cause of the launch timeouts: launching no longer depends on an attached Zellij client.",
  },
  {
    version: "0.8.2",
    tag: "fleet-runner-v0.8.2",
    date: "2026-06-17T20:45:00Z",
    highlights: [
      "Fleet Runner can now run each agent in a terminal it owns directly, instead of driving your Zellij by name — which is what made dispatch into some projects time out when the session wasn't attached.",
      "Watch any owned-terminal agent live from the web app, in full color with scrollback (a true byte stream, not a once-a-second screenshot).",
      "Opt-in for now: set LOKI_RUNNER_PTY=true to switch a project's agents to owned terminals; everything else keeps using Zellij until you flip it.",
    ],
    breaking: [],
    notes:
      "First step of moving agent execution off Zellij name-puppeting onto Loki-owned PTYs (docs/architecture/agent-execution-platform.md). Ships node-pty in the runner (load-verified in the packaged build) but stays behind a flag so this release behaves exactly like 0.8.1 until you opt a project in.",
  },
  {
    version: "0.8.1",
    tag: "fleet-runner-v0.8.1",
    date: "2026-06-17T18:00:00Z",
    highlights: [
      "Reliable dispatch: a single verified command ensures the project's Zellij tab, launches the agent if none is running, injects the prompt, and confirms the agent picked it up — instead of silently typing into a closed or wrong tab.",
      'Fuzzy tab matching: project keys now resolve to the tab names you actually use, so "revampit" finds your "revamp-it" tab (case + hyphens + spaces no longer matter).',
      'Detached-session launches now fail with a clear "zellij attach <session>" instruction instead of a cryptic spawn timeout; stale commands queued while the runner was offline are purged instead of failing noisily on reconnect.',
      'Self-healing bridge connection so the runner stops getting stuck "offline", and an honest offline state when a dispatch can\'t reach your machine.',
      "Auto-update enabled: future Fleet Runner fixes download in place — no more manual reinstalls.",
    ],
    breaking: [],
    notes:
      "The reliability release for the dispatch loop (Control → your local Zellij). Pairs with the web app's new Terminal tab, real Activity timeline, sidebar Light/Dark/Auto switch, and the dark-first Geist redesign deployed on loki.orangecat.ch.",
  },
  {
    version: "0.8.0",
    tag: "fleet-runner-v0.8.0",
    date: "2026-06-08T00:00:00Z",
    highlights: [
      "One-click agent switching from the project card chip or Cmd+K — quits the live CLI and launches the new agent without typing /quit in the terminal.",
      'Rate-limit and quota banners on project cards offer a single "Switch to …" button with automatic fallback order (Claude → Cursor → Codex → Gemini → Grok).',
      'Agent label mismatch warnings when the UI preference disagrees with the live process scan, so "Claude" no longer silently shows while Codex is running.',
      "Switch-agent commands now scan /proc and quit every running agent in the project directory before launching the replacement.",
    ],
    breaking: [],
    notes:
      "Mostly a web UI + API release — deploys immediately on loki.orangecat.ch. Fleet Runner v0.8.0 picks up the improved remote switch_agent poller when you next update the desktop app; until then, cloud-queued switches still work on the existing runner.",
  },
  {
    version: "0.7.9",
    tag: "fleet-runner-v0.7.9",
    date: "2026-06-08T00:00:00Z",
    highlights: [
      "Remote focus-tab commands now use the same Zellij adapter path as Peek/injection, including focus confirmation.",
      "Desktop command handling now logs handled/rejected command IDs, making remote-control failures debuggable from systemd logs.",
    ],
    breaking: [],
    notes:
      "Closes the last dogfood gap found while testing production Control against the local Zellij workspace: queued focus commands were claimed but could appear to land on the wrong tab without useful logs.",
  },
  {
    version: "0.7.8",
    tag: "fleet-runner-v0.7.8",
    date: "2026-06-08T00:00:00Z",
    highlights: [
      "Agent availability detection now searches common user CLI install locations, including nvm Node bins and `~/.local/bin`, instead of trusting Electron's reduced PATH.",
      "Fixes false 'Missing local tools' banners when Claude, Gemini, Codex, Cursor, or Grok are installed and work in the terminal.",
    ],
    breaking: [],
    notes:
      "Completes the v0.7.7 Control-state fix by making the desktop app report the same installed tools the user's terminal can actually run.",
  },
  {
    version: "0.7.7",
    tag: "fleet-runner-v0.7.7",
    date: "2026-06-08T00:00:00Z",
    highlights: [
      "Runtime heartbeats now push per-project session and process state, not just the list of open Zellij tabs.",
      "The Control UI can show last done, next step, session health, current prompt, and active agent state after a refresh even if no new handoff event fired.",
      "Project-to-tab matching now tolerates punctuation and case differences such as `revampit` versus `revamp-it`.",
    ],
    breaking: [],
    notes:
      "Fixes the UI drift where Fleet Runner showed open workspaces but each project still said 'No live observation'. The pusher now sends the same rich runtime snapshot the server route already knew how to store.",
  },
  {
    version: "0.7.6",
    tag: "fleet-runner-v0.7.6",
    date: "2026-06-08T00:00:00Z",
    highlights: [
      "Fleet Runner now drains the full remote-control command set from the hosted web app: launch agent, focus tab, close tab, switch agent, install CLI, auto-continue, and prompt injection.",
      "Local project import now writes and repairs the canonical `dirPath`, so imported repositories actually appear in /control and can launch agents.",
      "The desktop command boundary has regression coverage for every supported queued command type.",
    ],
    breaking: [],
    notes:
      "Fixes the dogfood gap where the cloud UI looked connected but only `truthseeker` appeared and most remote actions were rejected by the desktop poller. This release makes the web app and phone UI a real controller for the local Zellij workspace.",
  },
  {
    version: "0.7.5",
    tag: "fleet-runner-v0.7.5",
    // The GitHub release's publishedAt, as this file's own editing rule
    // requires. It was `new Date()`, computed at render time, so /releases
    // re-dated a June 2026 release to "today" on every single deploy — a
    // timeline that silently rewrote its own history.
    date: "2026-06-08T05:31:25Z",
    highlights: [
      "In-app update banner — when a newer version is detected, /control shows the exact upgrade path with a one-click Copy button.",
      "On .deb installs (Linux), the banner shows the `sudo dpkg -i <path>` command since electron-updater can't escalate sudo. No more silent update failures.",
      "On AppImage/dmg/exe, the banner has a 'Restart to install' button that triggers electron-updater's quitAndInstall directly.",
      "Banner is dismissable per-version (sessionStorage) so it doesn't nag, but re-appears on the next release.",
    ],
    breaking: [],
    notes:
      "Permanent fix for the .deb auto-update problem the user surfaced on 2026-06-07: they installed v0.7.0, received zero update notifications across 4 shipped releases (v0.7.1-v0.7.4), and didn't know they were stale. The auto-updater was downloading the new .debs but couldn't apply them — Linux dpkg requires sudo and Electron can't escalate. Now even when auto-apply fails, the user always sees what to do.",
  },
  {
    version: "0.7.4",
    tag: "fleet-runner-v0.7.4",
    date: "2026-06-07T14:35:53Z",
    highlights: [
      "Removed the bundled local renderer entirely — Fleet Runner is now a clean Electron wrapper around the cloud /control UI.",
      "Fixes the v0.7.0 boot disaster where users saw a half-working stub with 'YOUR MACHINES. YOUR AGENTS.' and zero projects.",
      "Smaller binary, no dependency on `agent-projects.conf` local file, no parallel-UI drift risk.",
      "Splash → web shell transition is the only boot path; clean offline page if cloud is unreachable.",
    ],
    breaking: [],
    notes:
      "Architectural cleanup. The bundled renderer was an aspirational 'local-first' surface that never reached parity with /control. Deleting it (2,135 lines) puts Fleet Runner in the same category as Slack / Linear / Notion desktop: web UI + native integrations (tray, deep-link auth, IPC for Peek + auto-mint + local-dev-scan, auto-update).",
  },
  {
    version: "0.7.3",
    tag: "fleet-runner-v0.7.3",
    date: "2026-06-07T12:35:45Z",
    highlights: [
      "Clear stale auth tokens automatically when the server rejects them (401/403).",
      "Renamed window title from 'Cockpit Fleet Runner' (legacy pre-rename) to 'Fleet Runner'.",
      "Pusher and poller now signal token-invalid back to the auto-mint flow, so a dead token recovers without user intervention.",
    ],
    breaking: [],
    notes:
      "Fixes a real bug where a revoked token would lock the user permanently offline — auto-mint's 'if existing token, bail' guard kept reusing the dead one. Now the runner deletes bad tokens on 401, and the next /control load mints a fresh one from the signed-in browser session.",
  },
  {
    version: "0.7.2",
    tag: "fleet-runner-v0.7.2",
    date: "2026-06-06T13:12:25Z",
    highlights: [
      "Peek tab feature — eye-icon button on /control's workspaces table opens a drawer showing the live screen contents of any Zellij tab.",
      "Sub-200ms round-trip per peek; auto-refresh toggle re-snapshots every 3s for watching long-running agents.",
    ],
    breaking: [],
    notes:
      "Closes the biggest visibility gap in /control: you could see tab names and state chips but had to alt-tab into Zellij to see what an agent was actually saying. Peek brings the agent's view into Loki itself.",
  },
  {
    version: "0.7.1",
    tag: "fleet-runner-v0.7.1",
    date: "2026-06-06T12:51:05Z",
    highlights: [
      "Reverted the v0.7.0 'bundled-renderer-as-primary' boot flip.",
      "Fleet Runner opens loki.orangecat.ch inside Electron again — the same UI you know from the browser.",
      "Updated download CTA on the marketing site to point at the latest release dynamically.",
    ],
    breaking: [],
    notes:
      "Emergency revert. v0.7.0 shipped the bundled renderer as the default boot target before it had parity with /control, which produced the 'YOUR MACHINES. YOUR AGENTS. / 0 projects / Sync error: Failed to fetch' screen. v0.7.4 later deletes the bundled renderer entirely; v0.7.1 was the safe rollback to v0.6 behavior in the meantime.",
  },
  {
    version: "0.7.0",
    tag: "fleet-runner-v0.7.0",
    date: "2026-06-06T10:11:13Z",
    highlights: [
      "Per-project autopilot mode override (UI toggle on each ProjectCard).",
      "Typed command boundary at the desktop runtime (zod-validated commands from cloud).",
      "Autonomous scheduler that nudges idle projects when no human dispatch happens.",
      "Beacon /tmp/*.json migrated to the cloud DB for cross-device visibility.",
    ],
    breaking: [
      "Bundled renderer became the default boot target — produced a broken UX, reverted in v0.7.1, removed entirely in v0.7.4.",
    ],
    notes:
      "Major v0.6 → v0.7 cut. Several real features landed (autopilot, typed boundary, scheduler) but the Phase C 'make the bundled renderer the primary' change went out before parity work was done. v0.7.1 reverted that part; v0.7.4 deleted the bundled renderer for good.",
  },
  {
    version: "0.6.0",
    tag: "fleet-runner-v0.6.0",
    date: "2026-06-05T10:32:36Z",
    highlights: [
      "Real-time updates via Postgres LISTEN/NOTIFY + SSE bridge — replaces the v0.5 30-second polling.",
      "Sub-second latency from DB row change → browser UI update.",
      "Bridge server runs on bridge.orangecat.ch (Hetzner CX22), reachable from desktop + web + mobile.",
      "Runner pusher is event-driven (worker.idle from session.md changes) instead of pure heartbeat.",
    ],
    breaking: [],
    notes:
      "The architectural foundation for everything that came after. Pre-v0.6, /control polled /api/control every 30s and the daemon-offline indicator was always lying about staleness. v0.6 inverts the dataflow: clients subscribe to an SSE stream, the bridge LISTENs on Postgres NOTIFY events, every row change fans out to connected clients within milliseconds.",
  },
  {
    version: "0.5.1",
    tag: "fleet-runner-v0.5.1",
    date: "2026-06-04T06:41:38Z",
    highlights: [
      "Offline fallback: when the cloud is unreachable, Fleet Runner falls back to a branded offline page with retry.",
      "Local agent operations keep working when the cloud is down (poller, pusher, watcher all decoupled).",
    ],
    breaking: [],
    notes: "",
  },
  {
    version: "0.5.0",
    tag: "fleet-runner-v0.5.0",
    date: "2026-06-04T06:31:33Z",
    highlights: [
      "Local-first contract: Fleet Runner is functional even when the cloud is unreachable.",
      "Bundled Zellij binary in resources/ — first-launch works without a separate Zellij install.",
      "Native application menu (File / Edit / View / Window / Help) instead of webview-style chrome.",
    ],
    breaking: [],
    notes: "",
  },
  {
    version: "0.4.4",
    tag: "fleet-runner-v0.4.4",
    date: "2026-06-03T21:08:51Z",
    highlights: [
      "Splash screen on launch (brand mark + spinner) — eliminates the Chromium-white flash before the web shell paints.",
      "Persisted window bounds across launches (geometry + maximized state).",
      "Deep-link auth: clicking `loki://auth?token=...` from the web app hands a fresh token to the desktop without copy-paste.",
    ],
    breaking: [],
    notes: "",
  },
];

/** Most-recent release — used by the footer pill / 'current version' badges. */
export const CURRENT_RELEASE: ReleaseEntry = FLEET_RUNNER_RELEASES[0];

/**
 * Loki platform changelog — user-facing changes to the hosted web
 * platform (as opposed to Fleet Runner desktop releases above). The platform
 * ships continuously, so entries are dated milestones, not versions: add one
 * when a feature is complete and verified in production, not per deploy.
 * Same editing rules as releases: plain-English bullets for the person who
 * uses the product, no commit-message slang.
 */
export interface PlatformChangeEntry {
  date: string; // ISO 8601 date the feature was live + verified
  title: string; // feature name, e.g. "Feedback widget"
  highlights: string[];
  /** Optional deep link (docs page or Thoughts essay) for the full story. */
  link?: { href: string; label: string };
}

/** Newest first. */
export const PLATFORM_CHANGELOG: PlatformChangeEntry[] = [
  {
    date: "2026-07-31",
    title: "Feedback pipeline — honest attribution, image attach, and the loop made visible",
    highlights: [
      'Every dispatch now gets its own attributed run: a second dispatch to a busy project waits until the current run finishes, so summaries, outcomes, and "your feedback shipped" emails can never credit the wrong work.',
      "Visitors can attach an image to a report (file picker or paste, downscaled client-side); it shows as a thumbnail in the inbox.",
      "Repeat reports dedupe at ingest into a ×N counter on one row — volume signal without inbox noise.",
      "Agent-filed rows (AI review findings, synthesized briefs) are typed and badged, briefs are never re-clustered by the daily digest, and visitor text is fenced as data in every composed prompt.",
      "The loop in numbers: resolved count and median report→fix time on each inbox and the fleet strip.",
      'Resolved reports you feature appear on the landing page — "shipped because a visitor asked", with real excerpts only you curate.',
    ],
    link: { href: "/docs/feedback-widget", label: "Docs: feedback widget" },
  },
  {
    date: "2026-07-29",
    title: "Feedback widget — visitor reports become fleet work",
    highlights: [
      "One script tag puts a feedback button on any site you run. Visitors point at the exact element that's broken; reports land in a per-project inbox.",
      "One click dispatches an agent to fix a report — with an optional instruction of yours prepended to the prompt.",
      "Remote control without deploys: pause, resume, rotate, or revoke the widget from Loki and the customer site follows within seconds. Live status comes from a real heartbeat, not install intent.",
      "Install and uninstall are one click too: an agent adds or removes the embed in your repo and ships it through your normal review flow.",
      "At volume, Synthesize clusters new reports into structured briefs, and a daily digest files themes as draft actions on Approvals — nothing executes without your approval.",
      "The loop closes itself: when a dispatched fix deploys, the report auto-resolves and the visitor who left an email hears their feedback shipped.",
    ],
    link: { href: "/docs/feedback-widget", label: "Docs: feedback widget" },
  },
];
