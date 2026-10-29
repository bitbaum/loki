# Surfaces: component map and views

The map of where each surface's code lives and what each view is for. Moved
here from `CLAUDE.md` when that file became a pointer to `AGENTS.md`; the rules
these surfaces follow are in `AGENTS.md`. When a component or route moves,
update this file in the same change.

## Component map

```
src/
├── app/           → Pages + API routes (thin, delegate to queries/components)
├── components/
│   ├── ui/        → Shared primitives (Card, Modal, Drawer, Field, PageLayout)
│   ├── shell/     → AppShell, Sidebar, AppTopBar + AccountMenu, MobileNav,
│   │                 AskLokiButton → /loki.
│   │                 The sidebar NAVIGATES; the account menu acts on the
│   │                 ACCOUNT. Nothing appears in both — that split is what
│   │                 stopped the sidebar footer becoming a second settings
│   │                 page. Sign out, Settings, appearance and the private-zone
│   │                 lock live in AccountMenu (top bar, every viewport).
│   │                 Sections are SSOT in config/navigation.ts, grouped by
│   │                 THING, not by question: Build (Home, Projects,
│   │                 Sessions, Prompts) · Loki (chat, Voice, Today,
│   │                 Suggestions) · To review · The fleet +
│   │                 PIN-gated Private. The phone's bottom bar is Home ·
│   │                 Projects · Loki · More (the rest, in those sections).
│   ├── control/   → ControlPanel = HOME (/control, labelled "Home" since
│   │                 2026-10-19), ProjectCard, ProjectProfile.
│   │                 There is no ProjectTile. HomeComposer = the top: what to
│   │                 build + a project chip, sent via /api/inject — the one
│   │                 place work starts (no "Start something" card).
│   │                 Under it, three sections of ListRows answer, in order:
│   │                 "Needs you" (AttentionBar + ControlInbox + the hero,
│   │                 heading hidden when all are quiet), "Being built"
│   │                 (ControlNow: one row per job, live step from the
│   │                 runner's beat via lib/run-step, opening the live
│   │                 session) and "Done" (ControlDone). ControlFoot = two
│   │                 rows: builder (opens settings) + New project.
│   │                 ControlFleetStatus = the hero, shown ONLY for alarms the
│   │                 rows do not already name: ONE question, one button.
│   │                 ControlInbox = one collapsed queue for every small task
│   │                 (feedback triage + widget coverage) — add a group, never a
│   │                 new full-width strip. ControlSettingsSheet = autopilot,
│   │                 refresh, builder detail (settings, not state).
│   │                 See docs/development/responsive-design.md.
│   ├── composer/  → Composer — THE composer (text, attach, voice, model,
│   │                 Send/Stop, optional modes). Loki chat (loki/Composer →
│   │                 LokiComposer), the terminal's Loki rail + Control's quick send
│   │                 (terminal/TerminalComposer) and the session box
│   │                 (terminal/SessionComposer) all render it. Never add a second message box — add a prop.
│   ├── loki/      → LokiWorkspace, Thread, LokiComposer (Composer.tsx), ThreadRail (conversation list) (chat assistant)
│   ├── terminal/  → TerminalSurface (the ONE shell: tab strip + session bar +
│   │                 session + session box), TerminalTabStrip, TerminalModeBar,
│   │                 TerminalComposer, ShellWorkspace (server-owned bash PTYs,
│   │                 local/sandbox only), TerminalView (the one xterm),
│   │                 terminal-transport (substrate seam).
│   │                 SessionComposer = THE box for the agent in a session,
│   │                 in the terminal view AND the conversation view, at
│   │                 every width: microphone, screenshots, prompt library
│   │                 ("/"), "What's going on?" + held-still next steps above
│   │                 it. It picks the path: a live session is typed into
│   │                 (bracketed paste + Enter), a screenshot goes via
│   │                 chat-send, nothing running → tab-inject (starts/queues).
│   │                 There is no Type / Prompt / Voice switch — never add one.
│   │                 The box's row is + · model · mic · send, nothing else.
│   │                 "+" (or "/") opens SessionPicker, a bottom SHEET (photo
│   │                 or screenshot, Keys on a phone, agent commands, Loki's
│   │                 records, the prompt library); chatkit's paperclip is
│   │                 hidden there but mounted — "Photo or screenshot" presses
│   │                 it, so paste and Camera/Photos/Files stay chatkit's. In
│   │                 the conversation view next steps are reply rows under
│   │                 the answer (ReplySteps → the box's sendRequest), never
│   │                 chips over the box. A panel pinned above the box ran off the
│   │                 screen once its search raised the keyboard. Nothing in
│   │                 it takes the keyboard on a touch screen. The agent
│   │                 cannot read Loki's database, so
│   │                 Loki's records reach it only as a VISIBLE file on the box
│   │                 (LokiFiles; feedback via /api/feedback/export, fenced as
│   │                 untrusted) — a library prompt that needs one declares
│   │                 `attach` and gets it; the box agents' contract
│   │                 (scripts/hetzner/box-agent-claude.md, re-applied on every
│   │                 deploy) tells them to ask for it in one line. SessionInfo
│   │                 (the model chip, in BOTH views: TerminalSessionInfo
│   │                 reads the log itself in the terminal view, and the box's
│   │                 row is identical in both) names the model, effort and mode
│   │                 READ from the session log, in words, and changes them
│   │                 in place: each row lists its choices and a tap sends
│   │                 the agent's own command with the choice named
│   │                 (`/model sonnet`, `/effort high`). Never type a bare
│   │                 `/model` from a sheet: the picker opens in the terminal
│   │                 behind it and nothing visible happens (2026-10-18).
│   │                 Models are FAMILIES by Claude Code's own aliases
│   │                 (fable/opus/sonnet/haiku, config/agent-commands.ts),
│   │                 never versions; the row settles on Claude Code's own
│   │                 "Set model to Opus 5.5" (a `setting` transcript item)
│   │                 or shows its refusal in its words.
│   │                 Modes are SSOT in config/terminal-modes.ts; never add a
│   │                 second terminal shell — add a transport.
│   │                 TerminalActions = what the screen needs TYPED (signed
│   │                 out → /login, a menu → Enter), one click from the
│   │                 session. The agent CLIs' own commands are SSOT in
│   │                 config/agent-commands.ts; they are typed as keys, never
│   │                 injected (inject wraps text in project context).
│   │                 A press on the read-only screen puts the cursor in the box.
│   │                 Below md the same state drives phone chrome:
│   │                 TerminalMobileHeader (a chat app's: back to Control ·
│   │                 the session's name, "Claude · 2 sessions · cloud
│   │                 builder" under it · ⋮, and the Chat | Terminal pill
│   │                 centred below; no row of tabs) + TerminalSessionSheet
│   │                 (the name: sessions, New session, where it runs, agent)
│   │                 + TerminalMoreSheet (⋮: What's going on?, full screen,
│   │                 text size, live keystrokes). An open session hides the
│   │                 app bars below md (useImmersiveChat), so back is the way
│   │                 out + TerminalMobileDock = TerminalKeyDeck
│   │                 (the arrows/Esc/Tab/Ctrl a soft keyboard lacks — bytes are
│   │                 SSOT in config/terminal-keys.ts), opened by the Keys
│   │                 button on the terminal's corner — never a second text
│   │                 box. While the phone keyboard is up, the app bar and the
│   │                 view switch step aside and next steps go to one row
│   │                 (`fc-keyboard-open` in globals.css). Keys open hides
│   │                 the next-step row. A command button anywhere TYPES its
│   │                 words, then Enter as its own keystroke (lib/session-
│   │                 keystrokes typeCommand) — in one write Claude Code reads
│   │                 "/model opus\r" as a paste and the CR as a newline.
│   │                 Three surfaces talk, on purpose, and only three: the
│   │                 session box (the agent), TerminalLokiRail (Loki about
│   │                 this session — beside it on a wide screen; on a phone
│   │                 "What's going on?" opens it as a SHEET showing the
│   │                 answer and its steps, with no composer and no model
│   │                 picker, `presentation="sheet"`), and /loki (Loki chat).
│   │                 Two "models" exist and are named apart: the agent's
│   │                 (SessionInfo chip, "Opus 5.5") and the one answering
│   │                 Loki (loki/ModelPicker, "Loki answers with").
│   │                 See docs/development/responsive-design.md.
│   ├── activity/  → ActivityView (scope menus, the answer as a sentence, NeedsYouCard
│   │                 and EventStream as ListRows), ActivityReport (the written
│   │                 report, the page's one action, in a sheet)
│   ├── today/     → Greeting, SummaryBar (the day in one sentence), StickyNoteCard (captures; Loki "add X to my list"), CalendarCard, WeatherCard (one line), CommitmentsCard, HabitsList — sections of rows, no cards
│   ├── people/    → PeopleList (ListRows + Show/Sort menus; import/merge in a
│   │                 sheet, PeopleBookPanel), PersonDetail (the person page)
│   ├── crew/      → CrewWorkspace (asks + roster as ListRows), AssignmentSheet,
│   │                 NewAssignmentButton, AddCrewButton, SharedTaskView.
│   │                 Work for HUMANS: an assignment is a draft until the
│   │                 operator hands it over, and the assignee answers through
│   │                 a share link with no account. Who may move a task is
│   │                 SSOT in config/crew.ts (OPERATOR_MOVES vs ASSIGNEE_MOVES)
│   │                 — never widen one to "fix" a stuck row.
│   ├── projects/  → ProjectsWorkspace + ProjectRow (list), ProjectWorkspaceView +
│   │                 ProjectWorkspaceHeader (detail). ProjectGrid/ProjectDetail
│   │                 survive only as TYPE names (project-grid-row.ts,
│   │                 project-detail-types.ts) — there are no such components
│   ├── goals/     → GoalsList (ListRows, progress ring), GoalDetail (/goals/[id]),
│   │                 NewGoalButton
│   ├── money/     → SubscriptionsList, SubscriptionSheet, NewSubscriptionButton
│   ├── habits/    → HabitsList (check off from the row; heatmap + settings in a
│   │                 sheet), HabitHeatmap, NewHabitButton
│   ├── events/    → EventsList (by date: deadline, else the day it happens),
│   │                 EventSheet, NewEventButton
│   ├── prompts/   → PromptLibraryClient (ListRows: yours, then Loki's by group),
│   │                 RunModal (THE Run sheet: one Run button — a project's
│   │                 agent for project work, Loki for personal prompts,
│   │                 lib/prompt-run), ScheduleModal, PromptForm, PromptPreview
│   ├── settings/  → SettingsTabs (a list of sections on a phone, a rail from lg),
│   │                 one component per section (TeamSettings = invite flow)
│   └── system/    → JobDetail, SystemStats, FleetDoctorCard, ScheduledJobsCard,
│   │                 RecentFailuresCard, HetznerCapacityCard (no AutopilotCard)
├── config/        → SSOT for navigation, channels, prompt-library, subscriptions,
│                    actors (who may be listed vs delegated to) and crew (who
│                    may move an assignment, and to where)
├── db/
│   ├── schema/    → Drizzle tables (SSOT for all types)
│   └── queries/   → Data access functions (one file per domain)
├── hooks/         → useFetch, useCreateMutation, useInlineEdit
└── lib/           → constants, dates, tools, utils, api/* wrappers

home/              → Agent orchestration library. Pure pieces that tail one
                     append-only JSONL event log: watcher.ts (Bridge — emits
                     worker.idle when ~/.loki/sessions/*.md changes),
                     plus decide/render/state/emit/log/projects/calendar-drain.
                     The worker (zellij consumer) was deleted 2026-09-11.
                     The standalone Brain (home/server.ts, port 3001) and its
                     scripts/home-start.sh launcher were RETIRED in a3f470d.
                     These pieces are a LIBRARY, not a process — three different
                     executors embed them via startWatcher():
                       • scripts/box-runner.ts — systemd on the box. The DEFAULT.
                         Exists precisely to delete the "laptop must be on"
                         dependency (b62e3aeb, 2026-06-26).
                       • desktop/ (Fleet Runner) — the user's own machine, for
                         work that must touch local files or a local checkout.
                       • scripts/hosted-runner.ts — ephemeral hosted runs.
                     Do NOT describe any one of them as the sole executor; which
                     one serves a given workflow is SSOT in
                     docs/development/cloud-local-workflows.md. Dispatch goes through /api/inject → pending_command → an authorized
                     runner. Project-owned sessions are the execution identity;
                     Tabs are owned PTYs keyed by project; there is no
                     multiplexer to guess. Which builder runs a project is a
                     STORED decision (locus lock → `builder_pref` → cloud
                     floor, src/lib/execution-access.ts), never presence. To
                     iterate on a single piece, run it directly (`pnpm exec tsx
                     home/watcher.ts --start`); test the whole library with
                     `pnpm run test:home`. Full docs: home/README.md.

widget/            → The embeddable feedback widget customer sites load as
                     <script src=".../widget.js">. Zero-dependency vanilla TS,
                     bundled by esbuild on `prebuild` into public/widget.js
                     (gitignored — built, never committed). widget/chat/ is the
                     one exception to zero-dependency: the conversation drawn
                     by @bitbaum/chatkit (on Preact), its own lazy chunk
                     public/widget-chat.js, opt-in by data-fc-chat="kit". main.ts is the UI
                     (Shadow DOM, so host CSS cannot reach it), voice.ts is
                     speak-your-feedback, report-payload.ts is the shared
                     budgeting the ingest route also relies on.
                     This is the ONLY surface strangers on other people's sites
                     touch, so it earns the same care as src/ — it is covered by
                     `pnpm run lint` and tsc. It cannot see globals.css or
                     Tailwind, so its colours travel differently: the boot
                     response ships PALETTE.widgetThemes — light AND dark,
                     GENERATED from Loki's own globals.css (:root / .dark) by
                     scripts/generate-widget-theme.ts, so the panel is Loki's
                     monochrome, never OrangeCat's orange
                     (scripts/test/widget-theme-from-tokens.ts fails on drift).
                     Every widget stylesheet reads var(--lk-…) and the host
                     says which mode (widget/theme-mode.ts): the owner's Loki
                     choice (user_preferences.theme, saved by ThemeSync),
                     everyone else their device's. Never type a colour into
                     widget/ or palette.ts — change the tokens and regenerate.

extension/         → Loki for Firefox (Android and desktop): fills a form Loki
                     hands it and stops at the final button — the phone half
                     of what Fleet Runner's browser window does on a computer.
                     A web page cannot type into another site, so on a phone
                     an extension is the only way. Recipes are SSOT in
                     src/config/browser-tasks.ts and the filler is the same
                     src/lib/browser-fill.ts Fleet Runner runs; the manifest is
                     GENERATED from the recipe hosts (scripts/build-extension.ts
                     → extension/dist, gitignored). Every hand-off starts at
                     /fill, which picks the filler this device has.
                     scripts/test/browser-extension.ts loads the built
                     extension in Chromium end to end. Shipped to AMO by
                     .github/workflows/extension-release.yml once the AMO key
                     secrets exist.
```

## Views

| View | Route | Status |
|------|-------|--------|
| Home | /control | (Was "Control".) The box to start work in a project, then what needs you, what is being built, what got done, and the project list. In-app primary buttons are monochrome (`ui-btn-primary` = `--accent-primary`); orange is the public site's only |
| Missions | /missions | A search row, a Show menu and one row per project (the problem first, then work in progress). `/missions/[id]`: Objective, Next move (with the one permissioned Continue), Roadmap, Latest handoff, Recent runs. Progress is what the goals report — never described as verified |
| Agents | /agents | RETIRED — redirects to /control. Control already is the roster; escalations land there |
| Loki | /loki | Chat assistant workspace — conversations, project-scoped dispatch, save-to-memory |
| Suggestions | /suggestions | Every front Loki keeps records on — Build, Business, Goals, People, Money, Habits (SSOT `config/suggestion-avenues.ts`) — read into one board of things to do next, each naming the record it came from. "Do it" opens Loki with the ask written and the project set (or the page only the person can act on); "Not now" hides it for a month. Decisions are rows in `suggestion_decisions` and are the ONLY source of the page's numbers; the `/loki` and Control build rows honour them too. Rankers are pure (`lib/build-suggestions/rank.ts`, `lib/suggestions/life.ts`); `lib/suggestions/load.ts` gathers |
| Approvals | /approvals | The Approval Queue as a destination — review/approve Loki's proposed actions; locked-zone state shows pending count + unlock CTA. Package updates a project's setting held (Update / Not now / Stay on this version) sit here too, shown behind the PIN as well — they name no private data. So do new accounts' build requests from /change (`config/build-requests`, operator only): the cloud builder runs only the operator's commands, so a stranger's "Make it real" is filed, approved here, and built as the operator's client work behind a code of that preview's own (`getProjectPreviewCode`); the visitor follows it on `/change/requests/<id>` |
| Feedback | /feedback | Every report across the fleet in one ironing-out loop: what phase each fix is in and the next action, without opening a project. Fed by the embeddable widget (`widget/`, served as `/widget.js`), AI review, and synthesized briefs. `ControlInbox` is the preview; this is the surface |
| My feedback | /my-feedback | The REPORTER's side of the same loop — the one feedback surface whose reader may be a stranger on someone else's site. Renders through the same pieces as `/feedback` (`FeedbackReportText`) on purpose: it kept its own row markup once, and the three-line clamp shipped to the operator inbox never reached it, so the person who asked for it watched their own report swallow the list. Status is DERIVED, never the DB word — `lib/feedback/reporter-view.ts` writes every reporter-facing sentence so builder asks, raw agent errors and run ids cannot travel. A seat on someone else's project (a Builder, a client, a viewer) asks; the owner decides — whoever asks pays, in their own builder (`docs/architecture/private-builders.md`), so no seat spends the owner's engine (the monthly client allowance that did was retired 2026-10-20). A change built FOR the person who asked (`site_feedback.on_allowance`, read as `previewFirst`) opens as a draft and waits here, and on their project page, as "Ready for you" with **Make it live** (`lib/feedback/go-live.ts`). On the site itself a member is known by their own member pass (`#loki-member=`, `lib/feedback/member-pass.ts`) — never the owner's link, which is the owner's console. A visitor with no account follows a note from its tracking link (`/claim-feedback`, mailed to the address they leave), which opens on the note's status; an account is optional, below it |
| Sessions | /terminal | (Was "Terminal".) Each agent's session, read as Chat or as its Terminal (the Chat | Terminal pill names views, never the agent; an agent with no chat view shows only the terminal). The terminal scrolls with a finger and, past the oldest kept line, points at Chat. The model chip's sheet: Model and Effort as `<Segmented>` rows, each choice explained; Mode as a list, switched by Shift+Tab until Claude Code's own footer names it (`use-live-mode`, `lib/claude-mode-footer`). Watch/drive the cloud builder or local Fleet Runner PTY per project tab. Nothing open: your projects, each with Resume (TerminalResume → `/api/agent/launch {resume:true}` → `claude --resume` of the folder's newest conversation; Codex: `codex resume --last`; other agents say Start), never a form. The box runner writes down its open sessions (`desktop/src/main/tab-memory.ts`, `~/.loki/open-tabs.json`) and reopens them when it starts, so a deploy's restart no longer ends them. **Plain shell**: a row "Plain shell" (nothing open, and in the session sheet) opens a real bash login shell on the builder — no project, no agent — operator-only, behind the PIN with a 10-minute idle lock, audited without content (`docs/architecture/plain-shell.md`, `lib/shell-session.ts`); it takes raw keystrokes, never the agent box |
| Activity | /activity | Fleet activity timeline — digests, event stream, per-project status strip across windows (hour/day/week/month). `/digests`, `/decisions` and `/history` are redirect stubs onto this page |
| Atlas | /atlas | RETIRED — redirects to /projects. Live URL and down-state live on Projects |
| Duet | /duet | RETIRED — redirects to /control (side-by-side prompt view earned nothing over Terminal + Control) |
| Today | /today | Calendar, weather, commitments, bills, daily habit check-off, log conversation |
| People | /people | Contacts as ListRows (search row, Show/Sort menus, "We talked today" in the row menu); import and merge in a sheet. `/people/[id]`: note, ways to reach them, conversations, details, actions |
| Crew | /crew | Humans in the loop + the work you hand them. Draft → hand over (mints a share link) → they accept/decline/deliver → you accept. Paid assignments mirror to OrangeCat as a service; the roster is person entities flagged `crew:member`, never a parallel table |
| Money | /money | The month as one sentence (per currency — no exchange rate is invented), subscriptions as ListRows, each opening a sheet (mark paid, edit, verify, alternatives, cancel, delete) |
| Goals | /goals | One sentence, goals as ListRows (progress ring, due · project), Sort/Project menus. `/goals/[id]`: progress, date, milestones, sub-goals (their own pages), habits that feed it, actions |
| Projects | /projects | ListRows: a search row, Show/Sort menus, one plain line per project (`lib/project-list-line.ts`: broken → busy → needs you → how it is) and the time since its last run; earlier `-refresh-` copies and archived projects fold under Archived. The `+` asks "Build a site" or "Add an existing project" (`NewProjectChooser`). A project page: one title, a section menu on a phone (tabs from md), sections as plain headings, checks/stage/feedback counts in Story; per-project dossier + shareable public link (/share/project/[token], audience-scoped resource visibility). A new site's kickoff plans which fleet packages it is BUILT FROM (`lib/kit-plan`, trigger words SSOT `config/kit-plan.ts` keyed by catalogue name, validated against the live catalogue): the kickoff screen says it in plain words (`KitPlanPreview`, text only, never a gate), the first build's prompt carries it as a `BUILT FROM` block with install lines and "do not write your own", and client work is also told to swap `@bitbaum/design-tokens` for the client's tokens. The plan is stored on `user_projects.kit_plan` (a plan — never written into `project_packages`, which stays observations) and shown as a "Planned" line under Built from; the kickoff run's `payload.kitPlan` records planned vs observed after the first build (`lib/kit-plan/coverage.ts`) |
| Packages | /packages | What the fleet is built from: every shared package in bitbaum/fleet's register (read through the fleet brief's one fetch, `lib/packages/catalogue.ts`), its latest version, and which of your projects is on which version (`/packages/[slug]`, behind first). Rows in `project_packages` are OBSERVATIONS read from each repo's package.json + lockfile (`lib/packages/sync.ts`) — never decisions; a project's Story tab shows the same as "Built from". Each project's UPDATE SETTING (`user_projects.package_updates`: Automatic / Ask me / Stay on these versions, SSOT `config/package-updates.ts`) is applied to its open Dependabot PRs every 15 minutes (`lib/packages/updates.ts`, cron `sync-package-updates`): Loki adds its own `hold` label where the setting or a breaking bump says wait, removes only holds it added, and merges only a breaking update a person approved once green — Dependabot proposes, the fleet sweep merges. Held updates are cards on /approvals, read from `package_update_requests`. The package's OWNER (whoever owns the Loki project that is the package repo; with no such project, whoever's GitHub token can push — `lib/packages/release-access.ts`) releases from `/packages/[slug]` ("Unreleased": changes since the highest version tag, next version from conventional commits — under 1.0 breaking is a minor — `lib/packages/release.ts`): Loki dispatches the repo's own `release.yml` (bitbaum/fleet `templates/package`) with an exact version and stores nothing about it. "Rollout" per recent version is DERIVED (`lib/packages/rollout.ts`); "Pause vX.Y.Z everywhere" is the one stored decision (`package_release_pauses`, SSOT words `config/package-releases.ts`): the update sync holds every open update to that version in every project whatever its setting, and resume removes only holds nothing else wants. **npm** (the panel at the top): the owner pastes ONE npm key (made on npmjs.com from a phone; settings SSOT `config/npm-publishing.ts`), Loki keeps it sealed (`lib/secret-box.ts`, table `npm_publish_keys`, never sent to a browser), and for every package npm does not know yet writes it into the package repo as the Actions secret `NPM_BOOTSTRAP_TOKEN` and starts its `publish.yml`, which publishes the first version and links itself as trusted publisher — later releases need no key. The 15-minute package cron does the same for packages registered later (`lib/packages/npm-publish.ts`). Android Chrome/Brave run no extensions, so this needs no browser extension at all |
| Habits | /habits | "3 of 5 done today", a row per habit with its check-off on the left; the row opens a sheet: 30-day heatmap, how often, linked goals, pause, rename, delete |
| Events | /events | Coming up / no date / already happened (deadline, else `date_start`), a Show menu for kinds, a sheet per event (edit, ask Loki, archive, delete) |
| Prompts | /prompts | Your prompts and Loki's library as rows; a row opens the Run sheet with ONE Run (the project's agent — started or queued through the inject core, also for a repo-only project — or Loki, streamed, for personal prompts); repeat on a schedule from the row's menu |
| System | /system | Gateway, memory, disk, uptime, autopilot jobs |
| Memory | /memory | Knowledge graph stats and recent activity |
| Thoughts | /thoughts | Published essays on architecture and execution systems |
| Settings | /settings | Twelve sections: a list of rows on a phone (each opens with a back row; the back gesture returns to the list), a rail from lg. Deep links `#ai`, `#agent` open a section |
