# Changelog

Notable, user-facing changes. Older history lives in the git log (conventional commits).

This file is the canonical changelog: the fleet map (`/api/fleet/map`) reads it,
`/changelog` renders it, and every fleet site does the same with its own
CHANGELOG.md. Format: `docs/architecture/building-in-public-records.md`.

## 2026-09-30 — Scoped Bitbaum portal infrastructure

- Keep Loki's website brief free self-service; redirect legacy paid-intake links to Bitbaum, preserving explicit brief handoffs through sign-in.
- Add bounded Bitbaum request capabilities, versioned preview acceptance, revocation and assigned-partner delivery without project or execution access.
- Add studio-owned course evidence review, separate partner approval and consenting profile publication. The pilot course and commercial offer remain owned by Bitbaum.
- Resolve missing profile repository URLs from the existing project-ID register join so canonical studio development records can be read.

## 2026-09-30

### Fixed
- **Every essay's reading time is its own.** Five essays in Thoughts showed
  "6 min" whatever their length; they now show the time their text takes.

## 2026-09-29

### Changed
- **Nothing runs on your quota unasked.** Every agent run Loki used to start
  on its own — a refused feedback run retried, a refused project run retried
  on another provider, a queued Implement re-sent by the cron — is now off
  unless the box sets `LOKI_AUTO_DISPATCH=1`. A failed row stays Failed with
  its Retry and provider buttons; the choice to spend Claude, Codex or Gemini
  is yours each time. Runs you start yourself are unchanged.

### Fixed
- **The feedback button no longer parks on a line of words.** On Loki's own
  sign-in page at phone width the bottom band is all buttons, and the first
  slot up the edge without a control was the "or sign in" divider, so the
  launcher sat on it. Words now count as occupied: the launcher prefers an
  empty slot, still takes words over any control, and a sign-in fixture in
  the browser test pins it. Verified live afterwards: the one free spot on
  that page was the divider rule beside those words, straddling the card's
  edge, so Loki's own auth pages (sign-in, sign-up, invites, setup) now
  carry no launcher at all — the person there has nothing to report yet,
  and it returns on the next page.

## 2026-09-28

### Added
- **An owner's own report starts the fix.** Tracking a report you left on your
  own site tells Loki who you are — the one thing the anonymous widget could
  not — and the fix starts on the spot, landing you in the Feedback inbox
  where Watch lives. On My feedback, a report on a project you own carries
  "Implement" and "Open in Feedback" instead of "waiting for the maintainer";
  everyone else is told nothing more is needed from them.
- **A builder can actually dispatch.** A collaborator with the builder role
  ("can run agents") was refused with "Project not found" the moment they
  pressed a dispatch button, because dispatch looked the project up by its
  owner. It now asks who may edit; the work still runs in the owner's tenant.
- **Client is a role.** The roster can now say who the project is FOR: a
  client follows the project and every fix and is who the builder answers to,
  without being able to spend the owner's runner. Editors are shown as
  "Builder".
- **Hand a project over.** The owner can hand a project to any member from the
  members panel; it runs in the new owner's tenant from then on and the old
  owner keeps a builder's seat. The studio's hand-over to a client is this
  button.
- **A refused feedback run retries itself.** When the runner refuses a
  feedback run at its last step — the agent answered with a usage-limit wall,
  or opened and never started generating — Loki makes the second attempt a
  person would have made, routed around the spent provider, once. The row
  says "Retried automatically" while the second run moves. Failures that need
  a person (dead credentials, a workspace missing on the builder) still stop
  and say so.
- **Watch the fix.** A shipped feedback item's button opens the live page and
  walks you through the change: a cursor moves to each part, a caption says
  why it is there, and links that stay on the page are really clicked. A step
  the walkthrough cannot show says so on screen and is filed back as a report
  on the project, so a fix that is not really live comes back into the loop
  (#951).
- **Roadmap and changelog come from the repository.** `ROADMAP.md` and
  `CHANGELOG.md` at a project's root are read into the fleet map, and every
  fleet site's `/roadmap` and `/changelog` render that record. Audited the
  same day: the map's roadmaps were mostly one machine-seeded placeholder per
  project with no steps done, its changelogs were run notes, four sites kept
  local copies instead, and two had no pages at all.
- **Ask Loki for a second opinion** in the widget: "is this right, should it
  change, how would you make the site better?" — about a picked element, the
  page, or the whole site. Every suggestion has a "Request this" button (#950).

### Fixed
- **A working Claude is no longer reported as silent.** Loki decides whether
  a dispatched Claude started by reading Claude's own status file for the
  project folder. When the runner and Claude spelled that folder differently
  (a symlink, a trailing slash) the file was never found and a working Claude
  was reported as "produced no response". The folder is now compared by its
  real path. A freshly launched Claude also has any opening dialog closed
  before the prompt goes in, as a running one already did, and a failure with
  no known cause now quotes the last lines Claude's screen showed.
- **A silent agent is routed around, not retried into.** When an agent opened,
  took the prompt and never answered, Loki's automatic retry went straight back
  to the same agent and failed the same way (Petvity, twice in a row). That
  silence now counts as the provider being unable to answer, so the retry runs
  on the next provider in your order, and the row says "The agent opened but
  never answered" instead of telling you to check that the builder is online.
- **The Feedback inbox is one surface again, and a project link by id works.**
  Landing from "Implement" on `/feedback?project=<id>` printed "Nothing
  waiting on you for 5936f8fb-…" — the page filtered by project name and
  showed the reader the id. The filter now accepts a name or an id, an empty
  project view says what is shipped and offers "Show all projects" / "Open
  <project>", the three stat cards became one quiet line, project and source
  filters share the Control inbox's chip, sections use the inbox primitives,
  and a failed row has one primary button (Retry) with Watch beside it. A
  render harness (`scripts/preview/`) now screenshots the page at phone and
  desktop widths in both themes before it ships.
- **Any refused feedback run gets one automatic second attempt** — not only
  the usage-limit and no-generation cases. Only commands the runner could not
  read, dead credentials and a missing workspace still stop and say so.
- **A green "Live" chip no longer opens the website.** It read as "watch it
  live" and landed on a homepage with no idea where to look. The chip is now a
  status ("Shipped · confirm") and the button beside it is the walkthrough
  (#951).
- **Failed runs say why.** Instead of the word "Retry" printed above a Retry
  button, a failed row gives one plain sentence from the run's error: out of
  quota, could not open the repository, ran too long, no session, crashed
  (#951).
- **Hiding the widget is visible and reversible.** The choice is offered in the
  panel, says how to undo it, and `#loki`, `Loki.show()` and the host's own
  Report control all bring it back (#950).

## 2026-09-26

### Added
- **Say what to change on your own site, and it gets built.** Loki's "Open
  your site" link carries an owner pass; a note left through the widget on
  your own site starts the fix instead of waiting in the inbox (#937).
- **Every site deploy looks at the page on a phone before and after,** and
  rolls back if it got worse (#943).

### Fixed
- **New sites skip ports something already listens on;** a private site's
  deploy is actually gated on its CI instead of passing open (#946, #948).
- **Quiet runs stop claiming "working".** A run shows Working only with
  evidence of a live agent producing output (#935).
- **A Claude dialog no longer holds runner updates;** repeating an owner note
  retries it (#939).
- **Header controls are 44px at every pointer** on the public pages (#934).

## 2026-09-25

### Added
- **Power Loki with your own model:** paste a key in Settings and Loki uses your
  best model for its own chat (#921).
- **Implement starts in its own lane** instead of waiting behind the project's
  open run, and it no longer walks into an agent Loki just watched run out of
  quota (#900, #909).
- **A project's story leads:** Loki asks why the project exists, and a pasted
  document is never cut (#906).
- **The composer is one component** across chat, terminal and Control (#899).

### Fixed
- **A deploy never kills a working agent:** the drain waits up to six hours,
  then leaves the old code running (#902). One OOM-killed child no longer
  stops the runner and every agent in it (#908). A runner restart closes the
  runs its sessions were serving (#917).
- **The widget launcher finds a free slot on every host page** and never sits
  on the page's own controls (#918, #882).
- **The project header says what the project is,** with truthful cloud
  presence and one door to take it public (#912, #915).
- **A deploy-failed fix heals** once a later deploy of main ships it (#932).

## 2026-09-24

### Added
- **Chat mode in the widget:** a chat the Cat and Loki both live in, on any
  site that opts in (#879).
- **Invite anyone into a project by email,** account or not (#872).
- **Signed actor-status read for Cat** on OrangeCat (#886).

### Fixed
- **Terminal panes follow the grid,** with an expandable full-width pane and one
  composer (#887).
- **Public pages show who is signed in** and let them sign out (#870).

## 2026-09-22

### Added
- **The front door says what needs you.** Today leads with the one thing
  waiting on a person, and "needs you" means the same thing everywhere (#855,
  #863).
- **Project flags:** raise, edit and clear a flag; flags say how old they are
  and expire (#833, #847).
- **Repository moves are noticed and fixed without asking** (#860).
- **Stage is a real vocabulary,** and "active" stops meaning "a row exists"
  (#843).

### Fixed
- **A project page leads with what is wrong,** not with what the machine is
  doing; the health panel is readable and shows the problem it was opened for
  (#836, #837, #861).
- **The OrangeCat link said "Connected" when only a row existed;** it now says
  whether the link works and offers a way back (#841, #842).
- **The account page said things that were not true** (#850, #853).
- **The backfill starved every project past the first few** (#854, #856).

## 2026-08-15 to 2026-09-21

Ninety-odd merges. The ones a person would have noticed: the feedback widget
grew a fix ledger that follows a pull request to merge and deploy; hosted
(Hermes) runs became a per-project "Runs on" choice; project dossiers gained
shareable public links; and the public pages moved onto the shared design
tokens. Each is in the git log under its own PR.

## 2026-08-14

### Added
- **The terminal tab strip names its agents.** Each tab now shows the project it
  belongs to and the agent actually running in it — `surf-your-life CLAUDE`,
  `Tab #3 GROK` — read from the live process rather than guessed from a label.
  Before this, an operator running Claude in one tab and Grok in another saw
  five identical `Tab #N` labels and had to go back to the physical terminal to
  tell them apart, which defeats the point of a remote command center.
- **Launching an agent from the terminal's empty state.** A tab with nothing in
  it now offers the projects you can start, instead of only explaining that
  nothing is running.

### Fixed
- **Deep links that match no tab say so.** `/terminal?tab=X` for a tab that does
  not exist used to silently show a different session. It now states what it
  could not find and what it fell back to: *No "X" session on This computer —
  showing "Tab #3" instead.*
- **The agent badge had no data to render.** Pane topology was read from a
  legacy `claude-projects.conf` that nothing had written to in months, so the
  runner published an empty pane list on every push — indistinguishable from
  "no agents running". It is now derived from live processes.
- **Default-named tabs can be resolved at all.** Matching an agent to its tab by
  name is impossible when the tab is called `Tab #3`, which shares no text with
  the project directory — every match fell through silently. The join now uses
  the `ZELLIJ_PANE_ID` that the terminal multiplexer exports into each pane and
  the agent process inherits. Any failure yields *no* badge rather than a wrong
  one, because a mislabelled tab aims a dispatched prompt at the wrong agent.
- **The runner version label stopped drifting.** The box reported a version
  pinned at install time, so it claimed `box-0.8.9` across three releases. It
  now reports what it is actually running, and the release timeline lists
  0.8.11 and 0.8.12, which had shipped without being recorded.

### Changed
- **Fleet Runner 0.8.12.** The pane-id join runs on the operator's own machine,
  so local tabs get the same naming the cloud builder already had. A web deploy
  cannot update a desktop app — this needed a release.
- **Thoughts: "You Cannot Direct What You Cannot Name."** Why an unnamed tab is
  a mission-level bug rather than a cosmetic one: if human direction is the
  bottleneck, the number of agents one person can command is bounded by how
  many they can distinguish.

## 2026-08-07

### Added
- **A learning phase on the roadmap.** Loki grades every agent run against
  a definition of done and then forgets the verdict. The new `LEARNING` phase
  commits to closing that loop: storing each dispatch with the prompt that
  produced it and the outcome it earned, reporting per-intent failure and cost,
  and proposing prompt improvements from real run history behind the same
  accept-or-dismiss human gate the Frontier loop already uses.
- **An internal self-improvement plan** (`docs/self-improvement-plan.md`) —
  phased, with an explicit kill criterion on every phase, including one that
  says to abandon the whole effort if the measurement phase shows failures are
  infrastructure noise rather than instruction quality.
- **Thoughts: "The Fleet Learns From What It Reads, Not What It Does."** The
  audit behind the plan. Loki's only self-improvement loop reads arXiv and
  Hacker News every morning to propose how the product should evolve, while the
  prompt-and-outcome record it generates from thousands of its own runs is read
  by display surfaces only. The essay covers what the 2026 literature has
  settled, the four documented ways these loops fail, and why no learned change
  will ever apply itself here.

### Fixed
- **Agents were never asked for the evidence they were graded on.** The fleet's
  definition of done demands the real output of `npm run verify`
  (`lint:`/`tsc:`/`tests:`) in the handoff, and **64.6% of every rejection was
  "not evidenced"** — but the prompts only ever listed `tests:` as a field to
  fill. Measured across every handoff ever written: `tests:` filled 97% of the
  time, `tsc:` and `lint:` filled three times in total. Agents write the shape
  they are shown, and the shape omitted the evidence fields. There is now one
  canonical handoff block, used by every close path, that asks for all of them.
- **A blank evidence field no longer costs a model call to detect.** A
  deterministic pre-check runs before the cross-model reviewer and, when the
  bar demands a check whose field is simply empty, returns the same verdict for
  free — with a stable reason code instead of a one-off sentence. Replayed over
  every graded run in production it would have skipped 94% of reviewer calls.
  It can only ever reject, never approve, and it defers to the reviewer the
  moment it cannot decide.
- A regression test pins the two together: a field the gate can reject you for
  leaving blank must be a field the prompts actually request. The trap that
  produced this bug can no longer be re-armed by adding a field to one side.

### Note
- The measurement phase did its job and **cancelled work**: prompt optimisation
  is parked (48 graded runs produced 48 distinct rejection sentences — no
  repeating signal to learn from) and the schema change that would have fed it
  is deferred, since its only consumer is parked. One read-only query replaced a
  migration, a dispatch-path refactor, and an optimiser build.

## 2026-07-23

### Added
- **OrangeCat fund-to-build integration.** Loki and its sibling product
  OrangeCat are now one typed, two-way bridge. A project can carry several
  typed edges to the economy side — origin, public profile, funding, offering,
  community — instead of a single opaque link, and a signed, ten-minute,
  one-use handoff token lets you jump from an OrangeCat entity straight into
  building it here. Cross-product URLs and ids live in one SSOT
  (`config/ecosystem.ts`).
- **The public surface is filled in.** New `/blog`, `/docs`, `/changelog`, and
  `/support` pages, and the footer is regrouped into Product / Learn / Support /
  Ecosystem / Legal so the marketing site actually leads somewhere.

### Changed
- **The fleet dispatches on purpose.** Hosted-runner dispatch is now a single
  source of truth with a UI trigger and recent-activity context, so a run
  starts intentionally instead of by side effect.
- **Prompts is one filterable grid**, and **Settings** moved to a left-rail
  layout with a neutral (not muddy-orange) disabled state on primary buttons.
- **Frontier** reads like ranked editorial judgment rather than a raw feed.

### Fixed
- **The agent install command pointed at a dead host.** `loki-agent`
  still told users to `curl https://loki.vercel.app/...` months after the
  Vercel exit; it now points at `https://loki.orangecat.ch`.
- Pinned `LC_ALL=C` in the deploy schema-drift check so a locale-sorted `comm`
  stops false-failing an otherwise-live deploy.

## 2026-07-22

### Added
- **`/agents` is a fleet coordination cockpit.** The page was a dead two-pane
  view whose inter-agent message feed only ever read the builder's local files —
  so on the hosted app it was permanently empty. It's now one glanceable column:
  a fleet-status strip (builder presence, project / active / message counts), a
  roster of your registered projects with live open/idle dots and one-tap
  **Watch** (→ Terminal) and **Dispatch** (→ Control), and a coordination feed
  that streams agent-to-agent messages — handoffs, questions, escalations — with
  type-filter chips. A new cloud transport (`agent_messages`) carries those
  messages off the builder's machine so the feed works in the hosted app.
- **Loki knows the economy.** Ask about what people need and Loki now pulls
  OrangeCat's open demand (wishlists + projects) straight into its context, and
  can search the whole economy by meaning — OrangeCat embeds the query
  server-side, so a match comes back without Loki holding a copy of the
  index. Find-what-exists and build-what's-missing are one conversation now.
- **OrangeCat funding events land in the project timeline.** Money moving on the
  economy side shows up in the fleet's Activity — the two products share one story.
- **A founder revenue card + sustainability gates.** `/system` shows real MRR and
  the break-even math; `docs/sustainability-gates.md` freezes the three spend
  gates so the cost of running the fleet stays honest.
- **Each project's README and `docs/` feed fleet knowledge.** The RAG layer now
  indexes repo docs (`repo_doc`), so agents answer from what a project actually
  documents, not just its database rows.

### Changed
- **The feedback widget grew teeth.** It's dogfooded on Loki's own public
  pages, an agent can file page-review findings straight through its API, and a
  project's feedback inbox turns any report into a one-click, scoped agent run.
  FAB contrast, dark-site polish, and a `data-fc-bottom` offset for host sites
  that already have their own floating button round it off.
- **Diagrams respect your theme and your motion settings.** The essay SVGs are
  theme-aware and honor `prefers-reduced-motion`.

### Fixed
- **Deploys stop killing working agents.** The box-runner restart now drains
  in-flight agents first, and a red CI blocks the deploy instead of shipping it —
  atomic releases with automatic rollback if the box schema doesn't match.
- **Cloud dispatch prep no longer dies on an ESM-only SDK import**, and box
  alerting is push-based (no Grafana) with recovery-aware noise suppression.

## 2026-07-17

### Changed
- **Every called-out issue is fixable in one click.** Security risks, broken
  features, and deploy issues on a project profile now carry a Fix button that
  dispatches a scoped agent run through the standard channel-routed pipeline;
  the Next card gained "Run next step". Both confirm inline with a link to
  watch the run in Terminal.
- **The health score is derived, not typed.** The hand-set "N/10" maturity
  number is retired; the score is now the count of ten named checks (brief,
  mission, code, live URL, stage, no open callouts, next step, definition of
  done). Click it for the breakdown that answers "why 9 and not 10" — the same
  derivation feeds the catalog, the profile, and agent context.
- **Activity stops ignoring the repo.** Profiles fetch recent GitHub commits
  (owner's linked token), so "Idle · last active 1mo ago" can no longer appear
  while commits land daily. Now shows last-commit recency + a commits-this-week
  line; Activity lists the recent commits as evidence.
- **The floating Loki bubble is a context-aware assistant.** On a project page
  it proposes the concrete actions the profile calls out (fix an issue, run
  the next step, diagnose a timeout streak — all one click) and holds a
  project-scoped conversation inline; elsewhere it offers fleet-wide starters.
- **Projects now has one clear job.** `/projects` is the portfolio for finding and
  prioritizing work; `/projects/[id]` is the one canonical project workspace. The
  duplicate right-side profile drawer is gone, old `?open=` links redirect to the
  canonical page, and every project row/card has one predictable destination.
- **Project pages are mobile-first working profiles.** Purpose, product context,
  build contract, plan, goals, evidence, resources, sharing, and lifecycle settings
  now live in one anchored page with an explicit return to the portfolio. Chat,
  Control, Terminal, and Profile preserve the active project as adjacent views.
- **Control stays operational.** Its expanded project view keeps run context, agent,
  model, prompts, and private notes; duplicated mission, technology, activity, and
  deletion forms moved to the canonical project workspace.
- **Project memory follows profile and plan changes.** Creation, import, rename,
  deletion, notes, goals, roadmap generation, and attribute/resource edits now
  refresh or retire the project's knowledge embedding. Exact project context
  remains deterministic while vector search supplies cross-project memory.

## 2026-07-16

### Changed
- **Chat, Control, and Terminal are one project workspace.** Moving between the
  three views preserves the active project, and Loki now leads with a compact,
  chat-first interaction instead of permanent filter and focus-mode panels.
- **Loki starts threads only when a message is sent.** Empty database threads no
  longer accumulate or appear in history, and stale transcripts cannot flash while
  a newly selected conversation loads.
- **Loki owns its handoff files.** New handoffs live under
  `~/.loki/sessions`, outside Claude Code's protected configuration tree.
  Runner startup copies legacy Markdown handoffs forward before watching them,
  keeps legacy reads during the transition, leaves Claude's live JSON alone, and
  pushes box-runner completions immediately instead of waiting for a heartbeat.
  Deploys now synchronize the shared `home/` watcher code to the box runner too.

### Fixed
- **Dispatch status follows the run through completion.** Loki now distinguishes
  queued, picked up, delivered, completed, partial, failed, timed out, and hung
  states instead of freezing at an optimistic acknowledgement. Healthy long
  dispatches also retain their claim instead of briefly regressing to queued.
- **Mobile workspace height and handoff controls.** Loki and Terminal composers
  remain above mobile navigation, the three workspace modes fit the viewport, and
  Control renders an honest loading skeleton instead of an empty first paint.

## 2026-07-08

### Added
- **Public pricing page** at `/pricing`. Four tiers (Free / Personal / Pro / Team)
  built on the one gate the code enforces — project count — with the captain-layer
  capabilities listed once as "included in every plan" rather than faked as per-tier
  gates. Honest about billing: paid CTAs open checkout only once Stripe is
  configured; until then every CTA starts a free signup — no dead buttons — and it
  flips live automatically when keys land.
- **Essay — _Every Ship, One Bridge_.** Where agent work runs (your laptop, a box
  you own, the provider's own cloud) is not who commands it. The execution-locus
  landscape and why the captain sits over every locus, not one.

### Fixed
- **Share links are now public URLs.** A project's shareable dossier link was built
  from the server's internal address, so every copied/opened link was unreachable.
  It now uses the canonical public domain — the same source email links use.
- **No test data on the public landing.** A leftover dogfood project could surface in
  the landing page's live Fleet Command console; the public projection now filters
  smoke/test artifacts by construction, and the stray row was purged from production.
- **Correct web address in the download page** (was a stale, unregistered domain).

### Changed
- **Deploy reliability.** A slow-to-stop app process can no longer roll back a healthy
  release (bounded stop + readiness polling), and the nightly fleet-knowledge reindex
  now always runs current code, so shared dossiers embed their full text.

## 2026-07-03 (c)

### Added
- **Workspace addressing begins (Stage 2).** The runner now reports WHICH workspace
  served every dispatch; the id rides the ack into the command record and the run
  ledger. Today it derives from the tab name — the point is the channel: consumers
  address workspaces by id, so the derivation can later become opaque without
  touching them again.
- **Run ledger (Stage 1 of the execution-substrate redesign).** Every hop of a run's
  life now declares itself as an append-only event — dispatched, submitted, blocked
  (with reason: boot dialog, dead credentials), closed (with DoD-gated outcome or
  reaper timeout). A run parked between hops is visible by definition; the week's
  incidents were all silent gaps between exactly these hops.

## 2026-07-03 (b)

### Fixed
- **Changelog garbage gate.** Failure text can no longer land as `health: good` (the
  retired hosted-Hermes path wrote "API call failed…" four times, rendered verbatim on
  the project page), and repeats of a recent entry no longer stack. Existing garbage
  entries scrubbed from prod.
- **Composer Send never fails silently** — an empty-state no-op now surfaces an error
  instead of doing nothing.
- **Dispatch acks: first ack wins and nothing falls on the floor.** The ack endpoint
  dropped `warning`/`verified`, and a double-claim's dedup re-ack clobbered the rich
  result with a bare ok.
- **Dead-credential canary.** When a dispatch verify fails and the agent's transcript
  shows a 401/login notice, the ack names the cause ("run claude setup-token on the
  runner host") instead of letting runs time out namelessly.
- **Dispatch authority framing** — agents refused legitimate dispatches as suspected
  prompt injections; every queued dispatch now opens with an operator-dispatch
  preamble, the task carries an explicit operator-instruction header, and the RAG
  block is labeled read-only background.

## 2026-07-03 (a)

### Added
- **Full project pages.** Clicking a project now opens `/projects/[id]` — a real,
  server-rendered dossier instead of the right-side drawer: **Done** (the changelog +
  run history with outcomes, commits, and durations), **Now** (live agent state, latest
  handoff checks, mission/brief), **Next** (resume state, linked goals with progress,
  dispatch CTA), plus repo/live-site/OrangeCat/Control links and the outcome streak.
  One SSOT assembly (`getProjectDossier`) composes existing data — devLog, runs, live
  state, goals, attributes — with zero new tables; the agent-facing project context is
  slated to converge on the same assembly so humans and agents read identical truth.
  The drawer stays as the quick-edit surface (`Quick edit` button, `?open=` deep links).

## 2026-07-02 (c)

### Fixed
- **Dispatched prompts no longer vanish into boot dialogs.** On a fresh clone the
  trust-folder dialog ate the injected paste (the Enter accepted the dialog), the
  output-activity check mistook boot redraw for generation, and six agents were acked
  "injected" while sitting idle at an empty composer. Dispatch now verifies against the
  CLI's own live session status (`~/.claude/sessions/<pid>.json` flips off "idle" when
  a prompt submits) and re-injects once when verifiably idle.
- **Dispatched prompts actually submit.** Big prompts (with context blocks) were still
  being ingested by the TUI when the fixed-delay Enters arrived — swallowed as in-paste
  newlines, prompt parked in the composer. Injection now wraps the body in explicit
  bracketed-paste markers (atomic ingestion; the following Enter is a real keypress),
  and the verify-retry first sends a bare Enter (submits a parked composer without
  duplicating it) before falling back to a full re-inject.
- **Box agents now read as Working.** The runtime pusher synthesizes the
  direct-terminal observation from the CLI's live status, so a headless PTY agent
  mid-task shows "Working" instead of "process detected, no lifecycle signal".
- **Cloud runtime state can no longer freeze on a laptop snapshot.** With no
  projects.conf (headless box) the pusher pushed zero project entries — project_states
  was only ever fed by the laptop runner, so the UI froze on a days-old "5 awaiting
  input" while real agents ran unseen. The pusher now derives projects from the agent
  processes actually running.
- **Deploys can't hang silently.** The restart ssh once hung 47 minutes after a
  successful restart, freezing the deploy before verification and the runner sync;
  it now runs under a hard timeout with keep-alives.
- **Runs close again: every queued dispatch now carries the handoff exit-contract.**
  The cloud dispatch path never told agents to write `~/.claude/sessions/<tab>.md`,
  so box agents finished real work, searched for the contract, found nothing — and
  their runs sat "waiting" until reaped as timeouts. The contract block is now SSOT
  (`sessionHandoffContract`) shared by the local enrichment path and
  `assembleInjectPrompt`, so run closure no longer depends on which machine executes
  or whose dotfiles it has.

## 2026-07-02 (b)

### Fixed
- **Autopilot scheduler saw zero users.** The nudge-idle cron only counted users with an
  explicit `beacon_settings` row, but a missing row means autopilot ON (the default) —
  so default-mode fleets were never nudged while the hero said "Autopilot on". One SSOT
  helper (`getFleetAutopilotUserIds`) now decides enrollment for schedulers and UI alike.
- **Stale runs are reaped on the clock, with truthful durations.** The run reaper only
  fired on Control page loads; dead runs lingered "waiting" for 51 hours until someone
  looked, then got stamped with fabricated 51-hour durations. Now an hourly cron reaps
  fleet-wide and `finished_at` reflects the actual timeout threshold (60 min).

### Changed
- **The Control hero tells the truth.** "Building" used to mean "the autopilot toggle is
  on" — it stayed green while zero agents worked and every recent run had failed. The
  headline now derives from reality: Building (agents active) / Waiting to dispatch /
  **Stalled** (latest runs failing, with a Review-failures link) / Paused.
- **Run-outcome streaks are clickable.** The ✓/✗ glyph row on each project card now
  deep-links to Activity filtered to that project — a failure signal leads to its cause
  instead of dead-ending.
- **Box-runner journal noise cut ~40k lines/day** — poller status logs on state change
  (plus a 15-min liveness heartbeat), not every 2-second poll.

## 2026-07-02 (a)

### Added
- **Login with OrangeCat** (identity bridge Part A) — OIDC sign-in against orangecat.ch;
  fixed the token exchange (OC requires `client_secret_post`). Existing users can link
  from Settings → Account → Connect OrangeCat.
- **Publish to OrangeCat + changelog→wall promote** (bridge Part C) — opt-in per project;
  devlog entries promote to the OC project wall with idempotent dedupe ids, backstopped
  by a daily reconcile cron so a dropped promote is never silently lost.

## 2026-06-29 (t)

### Added
- **Build / Pause selected** on Control project rail — bulk-select checkboxes kick or pause
  subsets via `fleet-kick` / `fleet-pause`.
- **Loki multi-dispatch** — multiple projects selected + a command fans out (concurrency cap 3).
- **Screenshot → dispatch** — scoped screenshot + implement/default ask routes to dispatch
  with vision preflight, not chat.

## 2026-06-29 (s)

### Added
- **Fleet kick.** Start building on Control (or "develop all my projects" in Loki) proactively
  dispatches `next_best` on eligible idle projects — capped at 3 concurrent; autopilot
  keeps loops going when agents finish.

### Fixed
- **nudge-idle cron** now targets users with autopilot on (`!= off`); the legacy `next_best`
  filter had made the scheduled idle nudge a no-op since the 2026-06-11 mode collapse.

## 2026-06-29 (r)

### Added
- **Loki business plan fast path.** "Generate/iterate business plan for `<project>`" runs
  `generateBusinessPlan` (same as Projects UI) and links to the Business section.
- **Loki profile update drafts.** "Set/update mission, stack, DoD, …" queues a Today action;
  approving applies the attribute (IRON RULE — no silent profile writes from chat).

## 2026-06-29 (q)

### Added
- **Project-aware Loki chat.** Select a project or name it in your message — chat turns
  inject the same profile + goals block as dispatch (`getProjectContext`), without
  sending work to the runner.

## 2026-06-29 (p)

### Added
- **Loki screenshot attachments.** Paste or pick PNG/JPEG/WebP/GIF; Groq vision preflight describes
  the image for chat and dispatch prompts (terminal agents get text, not raw pixels).
- **Composer quick chips** (Next best, Code review, Fix tests, Review UI) and scoped-project pill.

### Changed
- **Model picker** hidden on small screens (Auto default). **FAB hidden on `/loki`** (Loki tab is enough).

## 2026-06-27 (o)

### Changed
- **Single Loki surface.** Shell FAB and `?` shortcut navigate to `/loki` instead of a
  chat-only modal. `loki:open` prefills the composer (`?q=` or in-page event).
- **Fleet-aware Loki commands.** "List my projects" and "create project …" resolve from
  Postgres; ambiguous dispatches show tappable project chips in the transcript.

## 2026-06-28 (n)

### Changed
- **Phase 3 prompt vocabulary.** SSOT in `config/control-labels.ts`: Saved prompts
  (/prompts), Up next (queue), Recent dispatches (activity), Paste from history
  (composer chips). Composer hints say "auto-send" to distinguish from fleet Autopilot.

## 2026-06-28 (m)

### Added
- **Control play/pause hero.** `/control` uses `ui-control-hero` with a prominent fleet
  autopilot card (Building / Paused status, Start building / Pause fleet). Per-project
  toggles use matching Building/Paused labels; project rail shows override chips.

### Changed
- **`useAutomationPolicy`** refetches on `LOKI_REFRESH_EVENT` and broadcasts after
  global mode changes so Control stays in sync with Settings.

## 2026-06-28 (l)

### Changed
- **Retired `swiss-longevity-hub`.** Merged into `surf-your-life` (renamed product);
  removed from `scripts/hetzner/apps.conf`; dropped orphaned `swiss_longevity_hub`
  Postgres database on the box. Prod fleet: **18** projects.
- **`Bitbaum` runtime linked.** `user_projects` row now points at `/home/g/dev/bitbaum`
  for Fleet Runner dispatch.

## 2026-06-27 (k)

### Fixed
- **`applyProjectProfile` batch writes.** Attribute upserts run in one transaction
  (fixes ETIMEDOUT when enriching prod over a remote DB connection).
- **Prod backfill complete.** petvity, sbb-lost-found, and Bitbaum now have full
  build-contract profiles; 20/32 projects indexed with architecture attrs.

## 2026-06-27 (j)

### Added
- **Memory → Fleet knowledge card.** Shows RAG on/off, indexed chunk counts by
  source type, and last reindex time when `EMBEDDINGS_BASE_URL` is configured.
- **`scripts/hetzner/install-fleet-rag.sh`** — SSOT for box embed server, env
  vars, and daily reindex timer.
- **`scripts/test/rag-retrieval.ts`** — verifies retrieval against the vector index.

## 2026-06-27 (i)

### Fixed
- **Cloud dispatch context.** Phone/Loki/beacon `/api/inject` paths now assemble the
  full prompt (operating principles, project profile, goals, intent template, fleet
  RAG) before queueing for Fleet Runner — same SSOT as Control → orchestration/run.
- **AI profile persistence.** Brief/enrich now saves `architecture`, `conventions`,
  and `definition_of_done` (were extracted but dropped on write).

### Changed
- **Project context injection.** Dispatch prompts now include `customers` and
  `next_step` alongside mission/stack/DoD. Build-contract fields have dedicated
  rows in the project drawer.
- **Fleet RAG embed-on-write.** Profile/attr/description saves reindex the
  project's `knowledge_embeddings` chunk when `EMBEDDINGS_BASE_URL` is set.

### Added
- **`src/lib/inject-prompt.ts`** — SSOT for inject prompt assembly (cloud + local).
- **`scripts/test/inject-prompt.ts`** — verifies assembled prompts carry context.

## 2026-06-27 (h)

### Fixed
- **Mobile overlays.** Drawers and modals hide the bottom nav and top bar
  (`fc-overlay-open`) so project profiles and Loki slide-overs use the full screen.
- **Projects mobile.** Drawer close button moved to the title row; tab bar and
  card action links meet 44px tap targets.

### Added
- **`scripts/mobile-pages-audit.mjs`** — Playwright sweep of main routes at 390px.

## 2026-06-27 (g)

### Changed
- **Terminal on mobile.** Expand/collapse full-screen mode hides bottom nav and
  top bar so xterm gets usable height; agent tabs use a dropdown on phones.
  Loki dispatch footers link to `Watch agent →` on `/terminal?source=machine`.
- **Loki develop handoff.** Phrases like "let's develop" resolve to a command
  (`next_best` dispatch) when a project is selected or named, not idle chat.

## 2026-06-27 (f)

### Changed
- **Project profile drawer.** Overview tab follows action-first hierarchy: issues and
  next step up top, filled profile fields only (no empty placeholder spam), business
  plan and developer sections behind progressive disclosure. Activity in the drawer
  filters autopilot noise and caps at eight items with a link to the full timeline.

## 2026-06-27 (e)

### Fixed
- **Duplicate project entities.** Case-insensitive duplicates (e.g. `botsmann` /
  `Botsmann`) merge in Postgres via `scripts/db/merge-duplicate-projects.ts`.
  `findOrCreateProjectEntity` and `createProject` now resolve names
  case-insensitively so duplicates cannot recur.

### Changed
- (continues 2026-06-27 (d) Projects UI hierarchy work)

## 2026-06-27 (d)

### Changed
- **Projects page hierarchy.** Search and filters in one sticky bar; redundant stat
  cards and freeform status chips removed. Attention projects use rich cards;
  the rest is a compact scannable list with “Show all”. GitHub CI hides on cloud
  when unavailable. Duplicate project names collapse to the richest row.
- **Projects URL state.** Search, filter, and open drawer sync to query params.
- **Activity previews.** Recent activity in project profiles redacts tokens/secrets
  and collapses by default. Drawer exposes `role="dialog"` for assistive tech.

## 2026-06-27 (c)

### Changed
- **Projects page redesign.** Summary stats, filter chips, grouped sections (needs
  attention / yours / team), richer project cards with next-step callouts and
  quick actions, collapsible GitHub CI panel scoped to linked repos, and clearer
  empty/search states.

## 2026-06-27 (b)

### Changed
- **Theme control.** Light / Dark / Auto is now a single cycle button in the top bar,
  sidebar footer, and mobile menu — not three separate buttons. Settings uses one
  dropdown.
- **Mobile navigation.** Bottom bar is Today · Control · Loki · Menu; the Menu sheet
  lists routes by sidebar section (Work / Private / Site) with appearance, settings,
  and sign-out in the footer.

## 2026-06-27

### Added
- **Responsive design SSOT.** `docs/development/responsive-design.md` documents mobile
  chrome tokens, shell layout, component patterns, audit commands, and a viewport
  testing checklist.

### Changed
- **Mobile shell and viewport math.** Layer 1 tokens (`--app-topbar-height`,
  `--app-viewport-height`) plus `.app-viewport-pane` / `.app-page-compact` replace
  ad-hoc `100vh` heights on Loki, Terminal, and workspace routes.
- **Control project rail on phones.** Vertical project list instead of a hidden
  horizontal scroll strip.
- **Public marketing surfaces.** Hero fold, lede typography, nav padding, and signed-out
  CTA tuned for narrow viewports.

### Fixed
- **Mobile usability across the app.** Loki composer stacks on phones (no horizontal
  overflow); modals respect bottom-nav inset; drawers scroll with safe-area padding;
  Terminal "My machine" tabs stack above the xterm pane; Habits/People/Projects detail
  layouts wrap on narrow screens; horizontal page scroll contained at the shell.

## 2026-06-25

### Added
- **Fleet-knowledge RAG (pgvector).** Captain-layer retrieval-augmented context: a
  `knowledge_embeddings` vector index over project profiles + dev-logs (never repo
  code — the runtime retrieves that itself). Dispatches now carry a "Relevant context
  from your other projects" block, retrieved against the task. Local embeddings via a
  fastembed server on the box (BAAI/bge-small-en-v1.5, 384-dim, no cloud key); daily
  reindex. Engine under cross-project reference; first real fix for the
  "memory is the weakest strut" gap. Docs: `docs/architecture/fleet-knowledge-rag.md`.
- **Hosted runner via Hermes.** When the local Fleet Runner is offline, a work dispatch
  is auto-routed to a hosted runner that orchestrates Nous Research's **Hermes** (Nous
  Portal, `qwen3-coder-next`) in a sandbox, makes the change, and **opens a PR** — instead
  of the command waiting forever. systemd timer + dedicated runner deployment on the box.
- **Settings → Voice.** A per-user writing-voice preference, injected into Loki's replies
  (both the gateway agent and the Groq fallback) and drafted content. Backed by a
  `thoughts-style-guide.md` house-voice SSOT.
- **Cross-product specs.** `docs/architecture/cross-project-reference.md` (1 target · N
  references) and the RAG design.

### Changed
- **Public hero shows the real fleet.** The landing console now renders the owner's
  *actual* fleet (real project names, real one-line descriptions, real counts, live
  running status) instead of fabricated data — and only says "LIVE" when an agent is
  actually running. No invented metrics ship.
- **Public profile (`/u/…`) reskinned** onto the always-dark `PublicSurface` (it was the
  lone public page rendering light), with a flagship hierarchy, real descriptions, and a
  "Fleet activity" section (recent agent runs) — liveness a repo list can't show.
- **Project descriptions backfilled** from real sources; the "Local repository imported
  from loki-ui" placeholder is suppressed everywhere (profile, hero, RAG).

### Fixed
- **Real-name leak.** Loki addressed the operator by their real name (the shared OpenClaw
  agent's persona/memory held it). Scrubbed across the agent's `USER.md`/`SOUL.md`/memory +
  the Loki source; Loki now uses the pseudonym. The internal routing slug is
  unchanged (cross-surface session continuity preserved).
- **Orphaned-session / stale identity** healing in the auth JWT callback (earlier in the series).
