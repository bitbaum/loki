# Changelog

Notable, user-facing changes. Older history lives in the git log (conventional commits).

This file is the canonical changelog: the fleet map (`/api/fleet/map`) reads it,
`/changelog` renders it, and every fleet site does the same with its own
CHANGELOG.md. Format: `docs/architecture/building-in-public-records.md`.

## 2026-10-30 — The workbench

One project side by side: the session and Loki as columns of one window, the
site in a window of its own.

- **A Workbench row on every project you can work on.** {#workbench} It opens
  `/projects/[id]/workbench`: the agent's session and Loki's chat as two
  columns, and "Open the site" — the live page with your pass, where pointing
  and "Fix it now" already live — beside this window or on the other screen,
  whichever you chose. Nothing in it is new: the columns are the Sessions
  page and the Loki page, mounted as they are.
- **Any pane in its own window.** {#workbench-pop-out} A pane pops out to a
  window that is that pane alone (no sidebar, no top bar), on the other
  screen if you asked. The window it left stops drawing it and takes it back
  when that window closes. Full screen is the browser's own, on the
  workbench.
- **Fleet Runner places the windows.** {#workbench-desktop} Inside the desktop
  app the workbench asks the app, which reads the real display list: the
  other display whole, or this one tiled with the app on the left and the new
  window on the right, and a window already open is brought forward rather
  than opened twice (v0.8.60).
- **The site is a window, not a pane, on purpose.** Every fleet site forbids
  being framed and severs `window.opener`; the workbench says only what it
  knows (`docs/architecture/workbench.md`).

## 2026-10-23 — One widget, not two pieces

The owner's launcher and its microphone are now one thing.

- **The microphone lives inside the launcher.** {#mic-in-pill} "● Watching 🎤"
  is one pill: one outline, one place on the screen, moved by the same drag,
  long-press and menu, and folded away by Minimize together. It used to be a
  second round button drawn beside the launcher.
- **It is never alone.** {#mic-never-alone} On Loki's own pages the launcher
  is the spiral in the top bar, and the microphone used to stay behind as a
  loose circle over the tab bar that could not be moved. Now the pill and the
  microphone appear together or not at all; talking from there is one tap on
  the spiral, then **Talk**.

- **The first look is whole.** {#panel-first-look} A visitor's panel opened
  scrolled to its bottom with the greeting half cut under the header, and on a
  short phone the "Talk to Loki" card was sliced in two and the owner's way in
  was gone. It now opens at the top, the card and the sign-in line are shorter,
  and on short screens the sheet is taller and the suggestion chips step aside.

## 2026-10-22 — Every page, calm

Every page was rebuilt to one bar, written down in
`docs/development/design-reset-2026-10.md`: the way Claude, ChatGPT and Grok
look on a phone.

- **Lists are rows, not boxes.** {#rows} Projects, prompts, feedback, people,
  goals, habits, events, money, chats and sessions are lists of rows. Each row
  has a name, one grey line and one fact on the right, with no badges stacked
  under it and no card inside a card. Headings are sentence case, with no
  letter-spaced capitals and no explaining sentence under every title.
- **One action per page, in the same place.** {#one-action} The page's one
  action is the round button at the top right, as "new chat" is in Claude.
  Everything else is in a row's "…" menu. Nothing sticks to the screen but the
  top bar, the bottom bar and the box you type in, so Projects no longer has
  a third of the screen pinned.
- **Projects read as names.** {#project-names} A project with no title shows
  as words ("Murphys bar"), not its folder ("murphys-bar"), everywhere.
- **The bell counts what still needs you.** {#bell-earlier} Old notifications
  fold under "Earlier" and no longer count, so a nudge from four weeks ago
  stops showing "9+". A repeat of an alert you forgot is raised again instead
  of being swallowed by the old one.
- **Home answers three questions.** {#home-rows} What needs you, what is being
  built and what went quiet, each as rows with the reason in words ("Stopped:
  Claude hit its limit"), under the one box where work starts.
- **Send to terminal works for every project.** {#send-any-project} A project
  with only a repository and no folder now starts or queues its agent, as
  every other send does, instead of failing with "no running agent". Run with
  Loki shows the answer as it is written, with Stop and Try again, and a
  prompt's blanks are never sent as `{{project_name}}`.
- **Missions and Settings finish the job.** {#reset-last-pages} Missions is a
  search row and one row per project, and a mission's page is Objective, Next
  move, Roadmap, Latest handoff and Recent runs — progress still "reported",
  never verified. In Settings, Billing, Projects, Team and Privacy are rows
  too: projects move up and down from their menu (there was no way to drag on a
  phone), invitation links are copied, never shown as addresses, and the PIN
  forms open in a sheet.
- **Fixes found on the way.** {#reset-fixes} An event without a deadline can
  be added again, events with a date and place are listed by that date, an ask
  with nobody on it can be given to someone, the /fleet filters open on a
  computer, the public home page's headline no longer waits for an animation
  to appear, a project's "What changed" is newest first, a request an agent
  received and then went silent on says "the agent went quiet" on the project
  page as Watch does, and Suggestions shows an avenue's best five instead of
  thirty "Put it online" rows.

## 2026-10-20 — Whoever asks pays

- **Voice says why the studio voices are off, and how to turn them on.** {#voice-studio-off}
  When Groq will not read aloud, the Voice page now says why in one line, with
  the link that fixes it: usually Groq's voice terms, accepted once at
  console.groq.com. Until then Loki reads with your phone's voice, and the
  page says so, instead of every voice quietly sounding the same.
- **Change Loki's voice by saying so.** {#voice-change} "Use Troy", "switch
  voice" or "what voices are there" work while you listen, and questions about
  voice mode get true answers instead of advice about other apps. The status
  line reads as sentences ("Three runs failed on loki."), the music bed is
  pitched and loud enough for a phone speaker, End is no longer covered by the
  feedback button, and the voices are an even grid.
- **Watching says each thing once.** {#watch-once} A page's findings are one
  card that updates in place, measured only after the page holds still, so
  "no main title" and "two main titles" no longer argue. A fix that did not
  finish says so, with a link to why. The header counts only what waits on
  you, and a saved note is never quoted cut off.
- **Prompts: one card per prompt, schedules in words.** {#prompts-tidy} The
  same prompt saved twice opens the one you have, and extra copies go with one
  tap. Schedule a prompt as "every Monday at 10:00, Zurich time" instead of a
  cron line. Run asks for the project before it shows the prompt, both actions
  say what they do, and category tags are no longer orange.

- **A request goes to an agent the builder actually has.** {#route-installed}
  When a project is set to an agent its builder does not have — Grok on the
  cloud builder, which runs Claude Code — Loki sends the request to one it
  does and says so on Watch it work, instead of starting nothing and showing
  "Grok is not installed on the cloud builder". A run that still stops for
  that reason offers the agent that is there as the one button, not "Try
  again", which would fail the same way.
- **Watch it work says a stop once, with the way forward beside it.** {#watch-stopped}
  The reason and the buttons now sit together at the top of the card; the
  Loki message that repeated the reason and the "Stopped · 3 steps" line are
  gone, as are the pull-request, merge and live steps under a run that never
  started. An agent that never opened reads "could not start", not
  "stopped". Your request shows what you asked: the technical details a
  report carries for the agent sit behind "Dispatch details".

- **A partner you assign to a brief holds a seat on its project.** {#builder-seat}
  Assign an approved partner to a website brief and, once the partner has
  signed in to Loki with the OrangeCat identity they connected, they are an
  editor on the brief's linked project and build in a private builder of
  their own, on their own engine. The seat follows the assignment and the
  project link and goes when either does; it is never a studio membership,
  so a partner sees one project and nothing else of yours.
- **A partner's fee is paid to the partner.** {#builder-fee} With a delivery a
  partner can state a fee; Loki lists it as a service in the partner's own
  name on OrangeCat, with the partner's own sign-in, and the brief shows the
  link to pay it. The brief is marked paid by OrangeCat's settled payment,
  never by anyone's word, and both sides are told. Loki holds no money and
  takes no share.
- **Your requests on a shared project go to its owner.** {#seat-suggests} Whether you are a
  Builder, a client or a viewer on someone else's project, what you ask for —
  on the project page in Loki or with Feedback on the site — is now a
  suggestion the owner decides on, and you are told when it ships. It used to
  build at once on the owner's subscription (a Builder's always, a client's up
  to a monthly allowance); nobody's request runs on another person's engine
  any more, and the "changes a month" setting is gone. A builder of your own
  on Loki's cloud is the next step on the roadmap.
- **A new account's first build runs on its own computer.** A project with no
  stored builder used to ask for the cloud and be refused as "private" even
  with Fleet Runner connected; it now runs on the computer you connected, and
  a new project's folder is no longer written under the cloud builder's root
  for an account the cloud does not serve.
- **"Hosted runner" is offered only where it exists.** It serves one account;
  everyone else saw it as a choice, could pick it, and queued work that was
  never claimed.
- **An agent on the cloud builder sees only its own environment.** {#agent-env}
  It is born with what a shell needs, the engine key its account holds, and
  a token for the one repository it is working on. It used to inherit the
  builder's whole environment, database password and all.
- **The cloud builder asks Loki what to clone.** {#runner-no-db} It no longer
  reads the database itself: it asks with its own token and gets its own
  account's projects and a token that account may use. One step from a
  builder with no database password at all.
- **A private builder per account.** {#new-tenant} {#private-builder-flag}
  The operator switches it on for an account in System → Plans, and within
  a minute that account has its own builder on Loki's cloud: its own Linux
  user and home on the box, its own runner token, its own agent sign-ins,
  no database password, a memory and CPU ceiling of its own. Its Sessions
  page shows that builder; `claude` then `/login` signs in its own Claude
  account there. Nothing of the studio's — its GitHub organisation, its
  previews, the box's own folders — comes with it. Until now the cloud was
  the founder's alone, with an environment variable as the only other door.
- **Your own key builds, when you say so.** {#your-engine} A key you added
  for Loki's chat can be marked "also for building" in Settings → AI; within
  a minute it reaches your private builder as Claude Code's, Codex's, Grok's
  or Gemini's own variable, and your builds run on it instead of a sign-in.
  A key stays chat-only until you say otherwise. The other way in is as
  before: start the agent in your Sessions and type `/login`.
- **Welcome builds, then your plan's, then your own.** {#welcome-changes} An
  account with a private builder can choose to build on Loki's engine: three
  welcome builds to start, then the builds a month its plan includes (10 on
  Personal, 40 on Pro, 100 on Team), and past them its own sign-in or key.
  Every run records which engine paid for it, a dispatch past the last build
  is refused with the way forward instead of queued, and Loki's welcome
  spending stops for everyone at a cap in francs the owner set.
- **Capacity you can read.** {#capacity-card} The System page shows how long
  work waited for a builder in the last day, per channel, and this month's
  builds, tokens and cost per account — beside what welcome builds cost
  against their cap. The numbers that decide when the box needs a bigger
  neighbour, read instead of guessed.

## 2026-10-17 — See what every session is doing

- **Each tab says what its session is doing.** A breathing dot while it works,
  amber when it is waiting on you, green when it has finished, grey when it is
  just open — on the phone's row of sessions and on the desktop strip alike.
- **Hear from the sessions you are not looking at.** When another session
  finishes or starts waiting on you, one line says so ("orangecat needs you")
  with **Open** beside it. It goes away on its own, when you open that session,
  or with ×.

## 2026-10-17 — Terminal tabs on your phone

- **Several sessions at once, on a phone too.** With more than one session open,
  the top of the Terminal is now a row of them, like a terminal's tabs: tap one
  to switch, swipe for more, tap the one you are in for its settings. **+**
  starts another session from the phone (it used to be desktop only).
- **A second session on the same project, side by side.** Starting a project
  that already has a session now says so and offers "Start another session" or
  "Go to its session". The second one works in its own copy of the project, so
  the two agents never trip over each other's changes; it shows as
  "substrata 2". Starting the same project used to replace the running session.
- **Close a session from the phone.** The session list in the settings sheet
  has a close button on each row (tap twice, so a stray tap never stops an
  agent).

## 2026-10-17 — Your answer no longer disappears

- **Answering a package update no longer makes it vanish.** On Approvals, after you
  press Update, Not now or Stay on this version, the card now stays as a "Just
  done" line saying what Loki did (merged, merging when tests pass, snoozed until
  a date, or why it could not), with a link to the pull request. A new "Answered
  recently" list keeps the last two weeks of answers, with where each one stands
  now.

## 2026-10-15 — Notifications you can actually turn on

- **Chat does more, with less ceremony.** From WhatsApp or Telegram you can now
  say "add dentist Friday 3pm" and it is booked without a second tap (events you
  ask for have no guests, so there is nothing to protect), ask "what's on this
  week", add a reminder or a note, and forward a screenshot, photo or voice note
  that implies one of those. Sending email stays off by design: Loki writes the
  draft, you send it. The chat skill now installs itself on the box when it
  changes, so it can no longer drift from the app.
- **Loki tells you when WhatsApp and the Telegram chat stop being read.** The
  gateway behind them died on Oct 8 and nothing noticed for a week. Now a check
  every ten minutes raises an alert and one Telegram message when it is down,
  and another when it is back.
- **Turn on notifications on your phone.** Settings → Notifications now has an
  "On this phone" card: turn them on, send yourself a test, turn them off. It
  says plainly when a browser cannot (on iPhone: add Loki to the Home Screen
  first) or has blocked them. Until today the server could send a push but no
  screen offered a phone the choice, so a new report on your site reached no
  device at all.
- **The server hands out its own push key.** A phone used to subscribe against
  a key baked in at build time, which a build could lose or get stale; it now
  asks the server for the same key the server signs with, so the two cannot
  disagree.

## 2026-10-14 — Release a shared package from Loki, watch it roll out, pause a bad one

- **Release from the package's page.** Under "Unreleased", a package's page
  lists what changed since its last release, newest first, each change marked
  breaking, new or fix, and says which version that makes — a fix or a
  feature is the next small step, a breaking change the next big one (under
  1.0, the middle number, which is what every project treats as breaking).
  **Release vX.Y.Z** asks once, then starts the package repository's own
  release step: it refuses unless the latest change passed its checks,
  builds, tags the version and writes the release notes. The panel follows
  it — releasing, released, or failed with a link to what happened — and the
  new version reaches every project through its usual updates.
- **Only the package's owner releases.** That is whoever owns the Loki project
  that is the package's repository; for a package no project is, anyone whose
  GitHub access can write to it. Everyone else sees why not, and the way to
  connect GitHub when that is what is missing.
- **No dead ends.** A repository without the release step says so and links
  the fleet's pull request that adds it (or the one-tap way to get one); a
  failing or still-running check links to it; nothing to release says so.
- **Rollout per version.** For each recent version: how many of your projects
  are on it, have an update to it ready, waiting on tests, held or paused, or
  are behind with none yet. A version whose update fails its tests anywhere
  is flagged — "Red in 2 projects — their tests fail on v0.3.0" — with the
  projects and their pull requests.
- **Pause a release everywhere.** The owner's **Pause vX.Y.Z everywhere** holds
  every open update to that version, in every project, whatever its setting,
  at once; those updates show "Paused by the package owner" on Approvals, the
  project and the package page. **Resume** takes off only the holds the pause
  added — a project on "Ask me" stays held, a hold someone put on by hand
  stays. An answer given on a paused update applies when it is resumed.

## 2026-10-14 — A new site is built from the fleet's shared parts

- **Before the first build, Loki says what the site will be built from.**
  Under the start button, in plain words — "Your site will use sign-in,
  search, payments and email", how many other sites already run those parts,
  and that they are kept up to date automatically. It is read from what you
  wrote about the site; if it looks wrong, change the story — the build
  starts either way.
- **The first build wires those parts instead of writing them again.** Its
  instructions name each shared package, how to install it, what to use it
  for and not to write that feature itself — so a bakery's search box, pick-up
  times and Twint payments come from the same packages every other site uses.
- **Client sites wear the client's look.** For work done for a client, the
  build keeps the starter's design structure but replaces our colours and
  fonts with the client's, and does not install our design package.
- **What was planned stays visible.** Under "Built from", a "Planned" line
  names the parts the build was planned with that are not in the code yet.
- **Whether the plan works is measured.** Each first build records what it
  was planned with and, once its code has landed, what it actually installed.

## 2026-10-14 — Package updates arrive on their own, and you choose how

- **Each project says how updates reach it.** Under "Built from", one setting
  with three choices: **Automatic** (the default — an update merges itself
  once the project's tests pass), **Ask me** (each update waits for you on
  Approvals) and **Stay on these versions** (nothing updates until you change
  it back). The line under it says what will happen, and a change reaches the
  updates already open straight away, or within 15 minutes.
- **Breaking updates always ask.** A new major version, or a new minor under
  1.0, waits for you whatever the setting, because the project's code may need
  changes to take it.
- **Updates waiting for you are on Approvals.** Each card says which project,
  which packages from which version to which, whether it is breaking, whether
  its checks pass, and links to the pull request. **Update** takes it (a
  breaking one is merged as soon as its checks pass), **Not now** hides it
  for a week, **Stay on this version** tells Dependabot to stop offering it.
- **You can see every update in flight.** "Built from" and each package's
  page show an open update under the package it changes: waiting on tests,
  held for you, or ready.
- **Nothing new runs in the projects.** The update pull requests are
  Dependabot's and the merging is the fleet's auto-merge, as before; Loki
  only puts a `hold` label on what should wait and takes off only the holds
  it put on — a hold someone added by hand on GitHub stays.

## 2026-10-14 — See what every project is built from

- **A Packages page.** Under Fleet, Packages lists every shared package the
  fleet registers (bitbaum/fleet `registers/packages.json`) with its latest
  version and, for each, how many of your projects use it and how many of
  those are behind. Search finds a package even with a letter wrong.
- **One page per package.** It says what the package is, how to install it,
  where its code lives, and lists your projects that use it with the version
  each one is on — the ones behind first, saying by how much ("2 minor
  versions behind"), each linking to its project.
- **"Built from" on every project.** The Story tab now shows the shared
  packages the project's repository depends on, at the version its lockfile
  actually installed, with the ones behind marked and linked to the package.
- **Nothing to set up in the projects.** Loki reads each repository's
  `package.json` and lockfile from GitHub itself. It reads again when a page
  is opened and the last read is over six hours old, or when you press
  Refresh, and skips a repository whose code has not changed. A repository
  it cannot read is named, with the reason, instead of looking like it uses
  nothing. This is the read-only first step: choosing versions and rolling
  updates out come later.

## 2026-10-12 — One wrong letter no longer hides what you were looking for

- **Search forgives a slip.** ⌘K, People, Projects, Control's "Find
  project", Prompts, Goals, Events, chats, essays, the model store and the
  project pickers all matched the exact letters typed, so "lkoi" found
  nothing and "jonh" found nobody. Now one wrong, missing, doubled or swapped
  letter still finds the thing (two in long words), accents need not be typed
  ("zurich" finds Zürich), and "orange cat" finds OrangeCat.
- **The best match comes first** in ⌘K, People, Prompts and the pickers, and
  ⌘K and the prompt picker mark the part of each result that matched. Lists
  with an order of their own — the sort you picked on Projects, Control and
  the model store, deadlines, recent chats, the goal tree — keep it; the
  search only narrows them.

## 2026-10-12 — The cloud builder runs again

- **Work sent to the cloud starts again.** Since 22:25 UTC on 2026-10-11 the
  cloud builder stopped itself a few seconds after every start — 220 times —
  so every cloud dispatch waited in the queue. The form-filling window added
  to Fleet Runner that evening belongs to the desktop app, and the cloud
  builder, which runs the same code without a screen, tried to load it at
  start-up. It now loads only when a form arrives, which only happens on a
  computer. A new check fails the build if anything the cloud builder loads
  ever needs the desktop app again. Fleet Runner 0.8.42.

## 2026-10-12 — Loki from another computer: nothing to install

- **No download for an account that has the cloud builder.** Opened on a
  second computer, Loki said Fleet Runner was not connected “on this computer”
  and offered one fix: download the desktop app. “This computer” is the one
  machine where your account’s desktop app runs, so from any other device
  that offer was a trap — and the account’s cloud builder was online the
  whole time. Now the card under a dispatch says “Run it in the cloud” (one
  tap, the work moves), the empty terminal says “Use the cloud builder”, and
  the Control banner says plainly that there is nothing to install. The
  download is offered only to accounts whose cloud builder is private.
- **The Terminal no longer says "start it" to a builder that is down.** A
  deep link to a project with no session read “isn’t running on Cloud
  builder — start it, and it opens here” while the chip beside it said the
  cloud builder was offline. Now that screen says the builder is offline and
  what happens to the work, and the start offer waits for a builder that can
  take it.
- **The cloud builder's pulse is public.** `/api/health/builder` answers 200
  while the shared cloud builder is connected and 503 when it is not, so the
  box watchdog and the fleet sweep alert on it the way they already alert on
  a dead site. It was offline all night on 2026-10-11 and only a chip inside
  a signed-in page knew. Each deploy now prints the builder's state and its
  last journal lines into the CI log, and the feedback queue says “Cloud
  builder offline” instead of “Watch shows why” when that is the case.
- **The Mac download is not damaged.** macOS says the app “is damaged and
  can’t be opened” because the build is not yet signed by Apple, and
  right-click → Open does not clear it. `/download` now leads with the
  `.zip` and one Terminal line that installs, clears the refusal and launches
  it. Signed builds need an Apple Developer account (USD 99 a year); the
  pipeline is ready for the certificate.


- **A Suggestions page.** The "Build next" row on the Loki start screen only
  knew about code. The new page under Now reads every front Loki keeps records
  on — Build, Business, Goals, People, Money, Habits — and offers one thing to
  do per fact: the report nobody fixed, the delivery waiting on your yes, the
  goal due Friday at 40%, the subscription renewing Tuesday, the friend you
  have not spoken to in forty days, the twelve-day streak not checked off
  yet. Every card says which record it came from.
- **Two answers, no typing.** "Do it" hands the ask to Loki, already written
  and already scoped to the project, or opens the one place only you can do
  it (checking off a habit, accepting a delivery). "Not now" puts it away for
  a month, with an undo. What you put away stays away on the start screen and
  on Control too.
- **It keeps score, from records.** Taken this week, days in a row, taken in
  all — counted from the decisions you actually made, never estimated.
- **Private fronts stay private.** People, Money and Habits are read only
  while your PIN zone is unlocked; locked, the page says so and offers the
  unlock.
## 2026-10-11 — Shipped means you can see it, and Loki watches whether it gets used

- **A finished change comes with proof.** Agents now report shipped work as
  the live link first, screenshots of the real deployed page (phone first),
  and a plain list of what was and was not checked. `pnpm run ship:report`
  produces it: it confirms the site is running the shipped build and
  photographs the page, instead of announcing a merge and hoping.
- **Loki remembers how you use "Build next".** Each time the row is shown,
  tapped, or rotated past is recorded, and Loki reads it back: ask "how am I
  using Build next?" and it says what gets tapped and what it keeps offering
  for nothing — and it uses the same record when you ask what to build, so
  it leads with the kind of suggestion you actually take.
## 2026-10-11 — Nothing waits on a command someone has to remember

- **The evening plan now actually arrives.** The 19:00 proposal for the
  night shipped yesterday, but its timer only reached the server when
  someone ran a setup command there by hand, so no plan was made. Every
  deploy now installs the scheduled jobs itself, and a test fails if that
  ever stops.
- **Fix checks have their browser.** The picture Loki takes of a live page
  needs a browser on the server. The deploy installs it too, so the first
  visual fix gets a real verdict instead of "no browser".

## 2026-10-11 — Loki looks at a picture when words cannot tell

- **Visual fixes get a verdict too.** A layout, a colour, a thing that
  overlapped: page text could not say whether the fix worked, so those were
  the ones still sent to your eyes. Now, when text cannot tell, Loki takes a
  phone-sized picture of the live page — scrolled to what the reporter
  pointed at — and asks a vision model the same question. The card says
  which it did: "Loki read /pricing" or "Loki looked at a picture of
  /pricing".
- **You see what Loki saw.** When even the picture cannot settle it, the
  picture is on the card, under the reason, so "It worked / Not fixed" can
  usually be answered right there. Tap it for the whole page; it is also in
  every row's details.
- A server with no browser says so on the card, in words, instead of a
  silent "cannot tell".
## 2026-10-11 — Loki suggests what to build next, from your own work

- **"Build next" on the Loki start screen.** Under "What are we working on?"
  there is now a row of things you could build, picked from your own records:
  visitor reports nobody has fixed, a project with code but no live site, the
  next step your last session left, a goal stuck at zero, an idea from your
  sticky notes, and needs people have posted on OrangeCat (the ones closest to
  what you already build come first). Each one names why it is there.
- **One tap starts the work.** Tapping a suggestion for one of your projects
  sends it to an agent on that project. A new idea opens the new-project form
  already filled in, which leads straight into a kickoff. "Other ideas" shows
  the next set. With nothing set up yet, you get first builds that each end in
  something live: your own site, a page for your offer, a booking page.
- **Loki pushes to get it built.** Ask "what should I build?" and Loki answers
  from the same list, recommends one thing and why, scopes the smallest first
  version, and ends with the exact line that starts it.

## 2026-10-11 — Every new site starts as the same complete app

- **New sites start with accounts, three languages and strict security.**
  Both ways Loki creates a site — "Make it happen" with the Next.js starter,
  and a new site on the box — now produce the same app: the bitbaum starter.
  People can create an account with a password, a sign-in link or a passkey
  (and with OrangeCat once the site is registered there), add two-factor
  sign-in, and use it in English, German or French.
  It ships with strict security headers, a health check, tests and the
  pipeline that deploys each change.
- **A new site gets its own database.** Its accounts live in a database made
  for it on the server, with its secrets generated there and never shown.

## 2026-10-11 — Agents building a bitbaum product get the house rules

- **Every agent Loki sends into a bitbaum repo is now told what already
  exists.** Alongside the project's own profile, the dispatch carries the
  studio's rules: read fleet's AGENTS.md, STACK.md and SHARED.md first, start a
  new product from the fleet app template, use the shared packages (each with
  its one-line purpose and install command) instead of writing another health
  route, model call or set of security headers, keep the security bar, and
  count work as done only once it is merged, deployed and checked live.
- The package list and the stack are read from bitbaum/fleet when the agent
  is sent, so they are never a copy kept in Loki. If GitHub is slow or down,
  the dispatch goes ahead with the last saved list.
- Repositories outside the bitbaum org get nothing extra.

## 2026-10-10 — Loki looks before it asks you to

- **"Confirm it worked" is gone.** You could not know whether a fix worked
  without going to look, so the page was asking you to assert what Loki
  should have checked. Now, once a fix is live, Loki reads the live page
  against the report. If the page shows the change, the card says "Close
  it" with what Loki saw ("The footer now reads © 2026"). If the change is
  not there, it says "Try again" and why. If text cannot tell — layout,
  colour, a flow — the card leads with "See it on the site" (the walkthrough)
  and "It worked / Not fixed" sit right beside it. "Do all" leaves those for
  your eyes and says how many.
- One page read per shipped fix, a couple per visit, on your AI budget, only
  when you open the page — never from a timer.

## 2026-10-10 — Feedback decides, you say yes

- **Loki decides each report before you see it.** The page opens with the
  count ("6 decisions"), and every card leads with the one tap Loki
  recommends and why: "Confirm · free — live on /pricing; the agent
  reported success and the deploy went through." "Build · one agent run —
  a visitor's report on /contact; the project can take a run." "File away
  · free — nobody started this in 25 days." Tap to agree. "Something else"
  opens the full row for the reader who disagrees.
- **One button for all of them**, and it says what it spends before you
  tap: "Do all 6 · starts 5 runs, confirms 1, files 2 away".
- **The scope sits beside the number.** "6 decisions · substrata ▾" —
  the project picker is part of the heading, so the count it changes is
  the one next to it. Agents at work, fixes you confirmed and reports
  filed away are three collapsed lines under the queue.

## 2026-10-10 — Feedback says what it means

- **Every report now reads as one paragraph.** What the state is, in one
  bold sentence ("The fix is live on /pricing.", "An agent is working on it
  — 4 min so far.", "The attempt failed: the agent ran out of quota."); the
  report; where and when; then what happens now ("Look at it, then say
  whether it worked." / "Nothing to do; it starts by itself."). Before, a
  status word and a row of buttons left all of that to you.
- **Every button is a verb that names where it goes.** "See the fix on the
  site" (the live page, with Loki's walkthrough), "Watch in Terminal" and
  "Agent's chat" (this run's session, live), "It worked" / "Not fixed",
  "Build it", "Try again", "File away", "Show on the public strip". The
  unexplained star and arrow icons are gone.
- **Each lens says what it means** in one line under the strip: Needs you
  waits for one decision from you per row; Under way is agents and deploys
  at work; Done is fixes you confirmed.
## 2026-10-10 — Loki remembers what it noticed

- **A finding being fixed is not noticed again.** Until now Loki's watch
  mode forgot its own remarks the moment the tab closed: the next visit
  noticed the same missing heading or the same tiny text, offered "Fix
  this" again, and pressing it commissioned the same work twice — the
  words of each filing carried the watched steps, so nothing matched. Now a
  finding carries a key, "Fix this" files it with the note, and the next
  visit looks before it speaks: a finding whose fix is building, in line
  or on its way is left to **Your changes**; one the owner closed is left
  alone; one that was fixed and is back says so — "Loki noticed, again" —
  with **Fix again**.
- **Every card says where its fix is.** A remark from earlier reads
  "Being fixed · Building", "Needs you" or "Fixed 10 Oct" under the
  finding, linked to the live page or to Loki, and follows the fix as it
  moves while the panel is open.
- Pressing "Fix this" twice, in two tabs or on two days, now lands on the
  same row in Loki, with the second press counted rather than built again.

## 2026-10-10 — Auto decides

- **A greeting never spends a frontier model.** With your own keys, every
  turn is judged light, standard or heavy before a model is chosen, and Auto
  picks the cheapest model that is good enough: a cheap one for lookups and
  captures, the best value for ordinary asks, the smartest you have for code,
  strategy and anything you ask to be thought about carefully. The footer
  says which turn it was and why.
- **Your stance.** Thrifty, Balanced or Best — how far up Auto may reach.
  Even Best sends the small things to the cheap pick.
- **Your picks.** On `/models` and in Settings → AI you see the three models
  Auto chose and why, change any of them to another your keys reach, and hand
  it back with "Loki decides". The composer's Auto row names the two ends:
  which model takes the light turns and which the heavy ones.

## 2026-10-10 — Every model, every lab, your own machine

- **The whole landscape on `/models`.** Every chat model in OpenRouter's
  public catalogue — about 460 from 60 labs, Kimi, GLM, Qwen, Llama and
  MiniMax among them — with open weights marked, an intelligence index, the
  price in and out, context, when it was listed, and every way to run it
  through Loki. Filter by open weights, free to try, sees images, reasoning,
  lab or a price ceiling; sort by best value, smartest, cheapest, newest or
  longest context; the filters are the URL, so a view is a link. **Use**
  switches a model on a key you hold; **Add key** opens Settings with the
  vendor and model chosen. "Check for new models" names what appeared since
  the last read.
- **The Chinese labs directly.** Moonshot (Kimi), Z.ai (GLM), Alibaba (Qwen)
  and MiniMax can be connected with their own keys, not only through a
  router — and Fireworks as a host for open models.
- **A model on your own machine.** Point Loki at Ollama or LM Studio behind a
  tunnel (Tailscale Funnel, cloudflared, ngrok) and it thinks for free, with
  your data staying on your laptop. The recipe is on the store; Loki checks
  the address, lists the models it finds, and only ever connects over https
  to a public address.

## 2026-10-10 — One Loki on your site

- **The owner's launcher is one thing, always in one place.** On your own
  site it was two: "Loki · watching" in a corner with a ◎ beside it, and a
  "Loki is watching" bar at the top that took over whenever the corner was
  busy — on a phone, every scroll. Now the launcher never hides and never
  fades for the owner, the ◎ is its other half (there whether watching or
  paused), and the bar appears only on a page that hides the launcher
  outright — carrying the same ◎.
- **Show Loki this screen.** ◎ now offers **This screen** beside tapping an
  element: it marks what is on screen right now, the way a screenshot would
  frame it, and the conversation opens with it attached — say what you would
  change, ask Loki, or build it.

## 2026-10-10 — The night asks first

- **Nothing runs at night that you have not seen.** Every evening Loki shows
  tonight's plan with names and a price on it — which fixes, which site, how
  many of your runs, and what it would cost going by your own last runs — and
  asks for one tap: Approve or Reject, on Control, on Telegram and under
  Approvals. A plan left undecided expires at 02:30 and the morning note says
  nothing was built. Before this, the night decided for you; the plan was
  only visible the morning after.
- **Allow it in advance, for as long as you say.** Settings → Autopilot:
  "Nights run without asking" for a week, a month or three months, optionally
  under a dollar cap a night. Under an allowance the evening message says
  "runs without asking until …"; a night over the cap asks again.
- **Free things stay free.** Filing away reports nobody started in three
  weeks and moving stuck rows to the cloud spend nothing, undo in one tap,
  and happen with or without a yes. The evening plan and the morning note are
  assembled from counts — no model is called to write them.
- The late-night "go to sleep, autopilot has it" strip on Control is
  replaced by the Tonight card, which shows the plan instead of offering a
  switch.
## 2026-10-10 — A store for models: who thinks for you, and who you pay

- **Models, compared.** `/models` lists every provider you can bring —
  OpenRouter, Anthropic, OpenAI, Google, xAI, DeepSeek, Mistral, Groq,
  Together, Cerebras — with who they are, what they are known for, what
  they give away, and their newest models with live prices per million
  tokens and context, read from OpenRouter's public catalogue and refreshed
  on a button. A table sorts them by what decides a bill. **Add to Loki**
  opens Settings with the provider chosen; **Use** chooses the model too.
- **The free pool, in plain words.** The models Loki uses at no charge are
  shared by everyone here and rationed per person; when a day's allowance
  is spent it is spent for everyone. The capacity counters now sit behind
  one line instead of twelve cards. Your own key does not draw on the pool.
- **A second provider.** With one key connected, Settings says why a second
  matters: Auto gets a choice when the first is slow or out of credit, and
  you can compare two models on the same question.

## 2026-10-10 — Your model gets time to think, and you see that it works

- **A model call is bounded by silence, not by a stopwatch.** A 30-second cap
  on the whole call killed the first real turn on a user's own key: grok-4.7
  thought for longer than that before its first word. Now a vendor may take
  up to 90 seconds to say anything on your own key, may stream for up to
  five minutes, and is only cut off when it goes silent for 30 seconds — and
  the sentence you get says which of those happened.
- **Your model failed? One tap answers on the free models.** Under such a
  turn a button sends the same words on Loki's free chain, for that turn
  only. Loki never switches silently: your key failing is the one thing you
  need to see.
- **Every key action says what it did.** Adding a key reads "xAI · grok-4.7
  added. Loki starts here now. Testing it…" and then "Answered in 1.3 s —
  ‘Hello, I'm Grok.’": a real, tiny turn on the key, timed, so "added" is
  backed by an answer. A **Test** button on each row repeats it; changing,
  re-ordering and removing say what changed.
- **Screens that lay out on a phone.** The model picker's rows were being
  squeezed in the bottom sheet and overlapped; a key's row in Settings
  wrapped its model name letter by letter. Both fixed; "xAI" is no longer
  shown as "XAI".
- **No more "update password?"** The key field is masked but is not a
  password field, so the browser stops offering to save your API key as the
  site's login.
- **Your words appear as you speak.** Press the mic and the words scroll in
  as they are heard, one line, dimmed while the server transcribes and
  replaced by its words when they land. The checkmark still ends the take.
  Where the phone's recogniser cannot run, the wave stays and the recording
  is untouched. (chatkit 0.7.0.)
## 2026-10-10 — The night works from what you said, and no further than you allow

- **Autopilot overnight, with a budget.** While you sleep, Loki builds from
  your feedback — one fix per project, your own notes first — reads one
  site that has not been read this week and files what it finds, and files
  away reports nobody started in 21 days with the reason on the row. The
  limit is a number of runs a night, in Settings → When an agent finishes
  (default 4, 0 keeps the filing and stops the building). A project paused
  on Control is left alone. The idle nudge that woke three projects a night
  on a generic "next best" guess is retired: a run with no brief is where the
  queue of things nobody asked for came from.
- **The morning note.** /feedback opens with one line on what the night did
  and what it spent where the runner reported a price; the same line arrives
  on Telegram and push. Nothing when the night did nothing.
- **Feedback on a phone.** The question — how many need you — leads the
  page; the pickers are one quiet line; the numbers close it.
- **Loki reads the page.** The widget's Watch measured — small type, tiny
  targets, missing names — and said so on every page while the page in
  front of you said nothing first. It now also reads each page once per
  visit as a first-time visitor on a phone (purpose, hierarchy, content,
  fit, function) and says at most three things, each quoting the page, or
  nothing. Same "Fix this". Essay: `/thoughts/loki-reads-the-page`.
- **Which model are you.** Loki's chat says what it is running on from its
  own prompt, in one sentence, instead of a tool round and a referral to
  Settings.
- **Share on OrangeCat.** Every Thoughts essay's share bar leads with
  OrangeCat: one tap opens the composer there, prefilled, on the reader's
  own account.
- **"Back in 30 minutes."** Say it to Loki and the next screen you open —
  Control, or the chat — leads with what happened while you were away: what
  needs you, what went live, what finished and what still runs, each line a
  link to where it is acted on. One tap and it is gone. Nothing is recorded
  during the absence; the summary is read from what moved.
- **Fewer things thrown together.** A feedback row's context is one
  sentence that wraps like one; the pickers are words, not boxes; "Pointed
  at" reads as a sentence; the thumbs-down form in the chat is part of the
  thread, not a second dialog; a review files the screenshot it judged with
  its first finding, so you read the finding beside the picture.

## 2026-10-10 — A key with no credits is not a bad key

- **Unfunded keys save.** A key the vendor recognises but cannot bill yet —
  no credits, a spending limit reached — used to be refused as a bad key.
  It is now saved with the vendor's own words and the link to its billing
  page, and Loki uses it the moment the vendor does. The first real xAI key
  pasted into Settings hit exactly this wall.
- **What your keys spend.** Each key's row in Settings → AI shows today's and
  the last thirty days' tokens and calls, and links to the vendor's credits
  and spending cap. Tokens, not francs: the vendor's meter is the bill.
- **Scale, written down.** `docs/architecture/models-and-money.md` says why
  the free pool is a tasting menu, why your own key is the path that scales
  to a billion builders, and what a pass pays for.

## 2026-10-09 — Your models, your keys, your pass

- **Any model, your key.** Settings → AI takes a key from any of ten
  providers (OpenRouter, OpenAI, Anthropic, Google, Groq, Mistral, DeepSeek,
  xAI, Together, Cerebras) — paste, it is checked with the vendor on the spot,
  the strongest model your key can use is pre-chosen. Add several and Loki
  tries them in your order, so one provider's bad day never stops you. Your
  provider bills you; Loki charges nothing for it, on every plan.
- **The model picker shows the way.** Your own models sit at the top marked
  "Your key"; a model this server has no key for says so and the last row of
  the menu is "Add your own key".
- **Passes, in the open.** Billing shows your plan, the days left and the end
  date, a Buy or Extend button per priced plan that pays in Bitcoin on
  OrangeCat, and every pass that ever landed. Nothing renews by itself. The
  operator sees who is on a pass under System → Plans and can grant, extend or
  revoke one by hand — a trial or a month for a bug found shows on your
  Billing tab exactly like a paid pass. How the whole thing fits:
  `docs/architecture/models-and-money.md`.

## 2026-10-09 — The fleet in your ear

- **No-screen mode.** Headphones in, one tap on **Start** at `/voice`, and the
  phone goes in your pocket. Loki reads the briefing — who is working, what is
  waiting on you, what failed — then listens. Say "what's waiting on me",
  "approve the first one", "tell heidi to fix the header", "pause everything",
  "what failed", or ask anything else and hear the answer. Every action is
  the one the screen makes: the Approvals page's decision, the composer's
  send, Control's pause button.
- **Told, not asked.** While you say nothing, the phone checks the fleet every
  twenty seconds and reads what changed into your ear: a run finished and what
  it did, a run failed and why, a new approval, the builder going offline or
  coming back. At most five things per check, so a reconnect does not read out
  the afternoon.
- **The headphone button is the only button.** Press it to send what you just
  said or to cut Loki off and talk; next track repeats the briefing. The lock
  screen shows what Loki is doing.
- **Pleasant to leave on.** A studio voice (six to choose from; the phone's
  own voice takes over mid-sentence if the box has none or the signal drops),
  a quiet music bed the phone composes itself — no file, no licence — that
  ducks under the voice, and a short tone before each kind of news: rising for
  finished, falling for failed, a knock for something that needs you. Talk
  over Loki to interrupt it. Three runs finishing in a minute are one
  sentence; the same news never comes in the same words twice; "details"
  reads what each run did; "Only what needs me" holds finished runs for one
  sentence every five minutes. A dropped line is said once, and once when it
  is back. All four choices sit on the start screen and stay on the phone.
- **Hear it first.** `/no-screen` plays a twenty-second sample — the music,
  the tones, the briefing — on your own phone before you sign in.
- **Essays, anyone first.** Thoughts can fold their technical depth into
  "Under the hood" sections a reader opens on purpose; the fleet-in-your-ear
  essay is the first written that way.
- **Resume, to match pause.** "Resume everything" and "resume heidi" clear a
  per-project pause the same way Control's button set it.
- **What it is not, yet.** It is a web page: the loop is verified in a desktop
  browser with a synthetic microphone, not yet on a locked iPhone in a pocket.
  Approvals behind the private-zone PIN are not read aloud until you unlock
  them on screen; the briefing says they are locked. The public page at
  `/no-screen` says the same.

## 2026-10-08 — Share the walkthrough

- **"Not quite" — and "Show me" first.** A walkthrough's last card now has
  "Not quite": say (or speak) what is still wrong, and Loki starts the fix
  again with your words. Or press **Show me** first: Loki redraws the live
  page the way you described it — on your screen only, nothing saved — and
  "Build this" sends your words together with what the preview showed. Undo
  puts the page back exactly. The person who reported it can say "Not quite"
  too; their words go to your inbox.
- **Finished fixes keep their walkthrough.** Watch the fix and Share now stay
  on a fix after you confirm it, so you can show it to someone later.
- **Copy page link** on the last card copies the page's own address, for
  sharing the site without a walkthrough.

- **Share a fix's walkthrough with anyone.** "Watch the fix" now has a Share
  button, in Loki's inbox and on the walkthrough's last card. The link opens
  the live site and plays the same walkthrough there — the real page, not a
  recording — in plain words: the change shown on the page, without the code
  reasoning, the pull request, or the reporter's words and screenshot.
  Everyone who opens it sees the same story, and passing it around does not
  spend your AI budget once per viewer.
- **A cleaner last card.** The walkthrough ends on one short question and one
  decision — "Looks right — confirm" — with Share beside it, Replay and the
  code change as quiet links underneath, and close as an × in the corner. It
  no longer repeats the agent's change log, and a summary is no longer cut off
  at an abbreviation ("…checks incl.").

## 2026-10-07 — The record points both ways

- **Your site gets a consultation before it gets rebuilt.** On "Start from a
  website", naming your own site now opens a free consultation first: Loki
  reads the live page the way a new visitor and Google do, and says in plain
  words what is costing you visitors right now, what is worth fixing, and
  what is already right — each with the proof it saw, and how Google shows
  you today. Every finding is a fix you keep or drop; "Build a new version —
  5 fixes" builds exactly those, with anything you add in your own words.
  It spends no AI and needs no account.
- **Watch the fix tells the whole story.** The walkthrough now plays in
  chapters, about a minute long: the report and its screenshot, what was
  actually wrong, the change shown live on the page, why it was done that way,
  what else was considered and who it helps. Back, Pause and Next set the pace.
  It reads the story from a short design note the agent now writes into every
  fix's pull request.
- **The person who reported it can watch too.** On "My feedback", a fix that
  is live offers "Watch your fix": their own words, the change shown on the
  page, and one plain sentence about what changed for them — no pull requests
  and no technical reasoning.

- **The roadmap and the changelog link to each other.** A `{#id}` on a
  ROADMAP.md step and on the CHANGELOG.md line that delivered it now links
  them: each step on `/roadmap` names the changelog days that shipped it, and
  each line on `/changelog` names the step it delivered. One model for every
  fleet site (bip-kit 0.6.0); OrangeCat and Solon show the same links.
- **Fleet profiles no longer print the link tokens.** `/fleet/orangecat`
  showed "Events, end to end {#events}" once OrangeCat started linking its
  records; every fleet profile strips them now.
- **A wrapped roadmap step is read whole.** A step written over two lines lost
  its second line, so Solon's roadmap published "…redirect into the" without
  "first organization", and the lost line could be taken as the goal's
  one-line summary.
- **The walkthrough's caption stays on top.** On a phone, the site's own tab
  bar and floating buttons could cover the "Watch the fix" caption and its
  "Looks right" button (Substrata at 390px). The caption now sits above
  everything on the page and rises clear of a bottom tab bar.

## 2026-10-05 — Make it yours

- **Your own copy of an open-source project.** On `/take`, pick OrangeCat,
  Loki, Solon, evig, Substrata or Heidi and say what your copy is for. Loki's
  agents copy the code into a project of your own, keep the licence and the
  credit, and give it your name and look. GitHub Actions are switched off on
  every copy before anything is imported (#1043, #1047).
- **Inspired by, not a copy of.** On `/change`, "Make my own, inspired by it"
  starts an independent site that takes only ideas from an address you
  admire: layout, structure, interaction and mood (#1038).
- **The Terminal on a phone.** Attach a photo or a file, swipe to scroll,
  one bar instead of stacked rows, and suggested next steps read from what
  is on the screen. A screenshot reaches the agent as the image itself, and
  the feedback tool sits in the Terminal's header instead of over the
  terminal (#1042, #1044, #1045, #1046, #1048).

## 2026-10-03 — Your site fixes itself while you use it

- **Watch mode.** Open your site from Loki ("Open your site") and a pill at
  the top says **Loki is watching**. When something on the page breaks — an
  error, or a request that fails — Loki files it with the steps that led
  there and starts the fix; the pill says **Loki is fixing it**, with a link
  to follow. A button that does nothing when tapped three times counts as
  broken too, and **Report** on the pill files anything else that looks
  wrong, with the same steps attached. What you type is never recorded,
  **Pause** stops it, and visitors are never watched.
- **Loki's chat answers first.** A message that sounds like work no longer
  gets "Which project?" over a wall of buttons — it gets an answer, with
  "Run this on a project…" underneath for when you meant it.
- **Talk, follow-ups and 👎.** A hands-free voice conversation, suggested next
  questions under an answer, and a thumbs-down that files the bad answer as
  feedback.
- **The feedback inbox is one view:** Needs you · Under way · Shipped, with
  every report laid out the same way.

## 2026-10-08 — The private link comes back

- **A studio request or partner application mails its private link** to the address given — at intake, or when the address is added later through the portal. The link is the only credential, so until now a closed tab was a lost request.
- **"Send my link again"** (`POST /api/studio-recover`): the address you gave us gets a fresh link to every open request under it, and the old link stops working. The answer is the same whether or not the address is known.

## 2026-10-01 — The studio hears every request

- **A studio brief, a partner application or a reply on one now reaches a
  person.** Each one announces itself the way feedback does: a push, a Telegram
  message and an alert pointing at the review view. Until now the request was
  saved and nobody was told, which is the opposite of "a person will reply".
- **The website chat no longer narrates its own rules.** A fallback model had
  answered a visitor with "Stage used: beta. No URLs written." under the real
  answer; those lines are dropped before the reply is shown.
- **A paused widget token cannot transcribe voice** any more than it can chat.

## 2026-09-30 — Studio requests move to bitbaum

- **Asking Loki to change your website stays free and self-service.** Old
  links to the paid request form now lead to the bitbaum studio, and a brief
  you already wrote is carried through sign-in.
- **A studio request gets its own private link.** Someone who asks the
  bitbaum studio for work can follow that one request, accept a specific
  preview version, and receive the delivery from the partner assigned to it,
  without getting access to anything else in Loki.
- **Course evidence and partner approval are separate steps** that the studio
  reviews, and a partner's public profile is published only with their
  consent. The pilot course and the commercial offer belong to bitbaum (#995).

## 2026-09-30

### Added
- **Change a website from its address.** Enter an existing website and say,
  in plain words, what should change. Your brief survives signing in, becomes
  one project, and the build starts; the brief tells the agent to keep what
  already works, test on phone and desktop, and show you a preview (#987).

### Fixed
- **Every essay's reading time is its own.** Five essays in Thoughts showed
  "6 min" whatever their length; they now show the time their text takes.

## 2026-09-29

### Added
- **Sign up with OrangeCat.** Creating a Loki account now creates an
  OrangeCat account, the one account that also opens OrangeCat and Solon. A
  Loki-only password is still there if you prefer one, and an existing account
  sees one "Connect OrangeCat" button that links the two (#977).
- **Watch reads like a chat.** Your request sits on one side, the agent's
  answer on the other, and while it works one plain line says what it is doing
  right now; the raw screen folds away behind "Show screen" (#975, #976).
- **When an agent is out of quota, the next one is one tap away.** Watch
  offers "Try" with the next agent that still has quota, and a new run skips an
  agent that just ran out (#975).
- **The Telegram agent understands screenshots and videos** you send it
  (#965, #982–#986).

### Changed
- **Nothing runs on your quota unasked.** Every agent run Loki used to start
  on its own — a refused feedback run retried, a refused project run retried
  on another provider, a queued Implement re-sent by the cron — is now off
  unless the box sets `LOKI_AUTO_DISPATCH=1`. A failed row stays Failed with
  its Retry and provider buttons; the choice to spend Claude, Codex or Antigravity
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
  owner keeps a builder's seat. This is the button the studio uses to hand a
  finished project to the person it was built for.
- **A refused feedback run retries itself.** When the runner refuses a
  feedback run at its last step — the agent answered with a usage-limit wall,
  or opened and never started generating — Loki makes the second attempt a
  person would have made, routed around the spent provider, once. The row
  says "Retried automatically" while the second run moves. Failures that need
  a person (dead credentials, a workspace missing on the builder) still stop
  and say so. *Superseded the next day: automatic retries are off by default
  since 2026-09-29, so a failed run waits for you to press Retry (#978).*
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
- **Message Loki from any AI app.** Loki now works as a connector for
  claude.ai, ChatGPT, Claude Code and Cursor: you can ask it questions, see
  your projects and waiting approvals, and, with a separate permission, approve
  or start work. You sign in with your OrangeCat account (#965).
- **Watch it work.** Each project has a page that shows its latest run as a
  readable thread: what the agent was asked, each step it took, the last lines
  on its screen, and its handoff at the end (#963).
- **"Make it happen" keeps going without you.** Setting up a project now runs
  on the server, so locking your phone or leaving the page no longer stops it,
  pressing twice never starts a second agent, and your brief is saved even if
  the AI model fails (#954, #956).
- **A project's own roadmap is no longer behind the PIN.** The PIN now covers
  only personal goals. Before anything is built, the project page shows one
  card with one button, and the Plan tab leads with the roadmap (#962).
- **Control never shows an empty box.** A project with no agent running says
  so in words, with one next step, and the builder chip names which machine is
  online (#957).

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
  *Superseded on 2026-09-29: automatic retries are now off by default (#978).*
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
- **Your own Groq key gets your own limits.** Loki's chat used to trim the
  context it sent to fit the shared free tier even when you had pasted your
  own Groq key; it now uses the room your key actually has (#945).

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
- **Today and Control agree on what is running,** and setting up a site no
  longer overwrites the next step you wrote for the project (#924).
- **Loki answers instead of asking "which project?"** when you have no
  projects yet (#925).

### Removed
- **Nothing in the background spends the shared free AI allowance.** The
  daily Frontier digest, the daily feedback digest, the weekly events scout
  and the second-model check on finished runs are gone; the daily email is
  now built from the record without a model, and the written report stays one
  button away (#897).

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

## 2026-09-23

### Changed
- **The terminal says where an agent will run** — "Cloud builder" or "Your
  computer" — and starting one there no longer changes the project's default.
  The download, quickstart and handoff pages now describe the same two choices
  (#866).

## 2026-09-22

### Added
- **Loki can look further before it answers.** A question that needs several
  lookups gets up to five rounds of them instead of two, and Loki stops early
  rather than repeating the same lookup or proposing the same action twice
  (#865).
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

## 2026-09-20

### Added
- **Loki asks before it builds from one sentence.** A project that arrives
  from OrangeCat's "Build it with Loki" button gets five short questions — who
  it is for, what they do today, what it does for them, what it must use, what
  makes the first version worth shipping. Every question can be skipped, and
  your answers are stored in your own words (#799).

### Changed
- **The menu follows the work.** Three sections, each answering one
  question: Now (what needs me?), Fleet (what is my fleet doing?) and Command
  (how do I act on it?); private pages stay behind the PIN, and the catch-all
  "More" menu is gone (#797).

## 2026-09-18

### Changed
- **Loki is open source again, under the MIT licence.** It had been under a
  restrictive licence since June; the Terms now say the same thing. The name
  and logo are not covered by the licence (#791).
- **Control says what a dispatch will do before you send it:** which agent,
  which model, which machine, and what the last run on that project cost
  (#794).

## 2026-09-17

### Added
- **Found a Solon organization from a project.** Loki prepares the link with
  the project filled in; you sign with your own wallet on Solon, and the
  project is attributed to that organization only with your consent (#759).
- **Approve from Telegram with one tap,** and give standing approval to small
  things that are easy to undo, such as an event in your own calendar (#761).
- **Switch to an agent that still has quota in one tap,** and the choice is
  remembered for the next run instead of going back to the agent that ran out
  (#757).

## 2026-09-15

### Added
- **A third AI provider for Loki's chat.** Google's Gemini joins Groq and
  OpenRouter, and it is the only one of the three that Loki does not share
  with other apps, so it is less likely to run out when they do (#714).
- **A project can run on the hosted runner,** which needs no Claude account
  of yours and ends every task in a pull request (#718).
- **Every registered project has a public page** with its purpose, roadmap
  and changelog (#737).

## 2026-09-14

### Added
- **A public map of every project** the studio runs: what it is for, whether
  it is up, and what last moved. Loki reads the same map when you ask about
  the fleet (#698).

## 2026-09-13

### Changed
- **The product takes the name Loki,** everywhere it used to carry its old
  name (#695).

## 2026-09-11

### Added
- **A site can be taken down.** Take it offline, put it behind a password, or
  remove it, and take its OrangeCat listing back down. The plan
  shows exactly what will happen before the button appears, and the permanent
  options must be typed, not clicked (#657, #661, #667).
- **The feedback inbox follows each fix to the live site.** A fix ledger
  tracks a report from the agent's pull request through merge and deploy, and
  the inbox is grouped by who is waiting on whom (#639).
- **Ship fixes automatically, per project, if you opt in.** Loki merges only
  the pull request its own run opened, once its checks pass (#656).
- **Loki's chat shows its work:** answers stream in, there is a Stop button,
  and each lookup appears as it runs, with what it found (#665).
- **A new site merges its own green pull requests,** so a fix reaches the
  live site without anyone clicking merge (#612).
- **"Build it with Loki" on OrangeCat builds on arrival** instead of stopping
  at a second form (#618).

### Changed
- **Where a project runs is a setting you choose,** not a guess. Cloud is the
  default, "This computer" is a per-project choice, and when your computer is
  offline its work waits in a visible queue instead of going elsewhere (#615).
- **Fleet Runner runs every agent itself,** in terminals it owns; the old
  terminal multiplexer it used to drive is gone (#624, #630).

## 2026-09-02

### Added
- **Speak your feedback.** Visitors can now talk to the feedback button
  instead of typing (#462).

## 2026-08-26

### Added
- **Crew: hand work to people, not only agents.** An assignment is a draft
  until you hand it over; the person answers through a link with no account,
  and a fee can be set in bitcoin, payable to their own OrangeCat profile
  (#391).

## 2026-08-23

### Added
- **Feedback gets its own inbox.** Every project's reports in one place,
  grouped by what needs you, what is in progress and what shipped, with a
  notice when new feedback arrives (#335).

## 2026-08-15

### Added
- **Try Loki without an account.** A sandboxed demo lets you create projects
  and move around freely, while anything that would leave the demo is refused
  (#290).
- **The free AI allowance is shared fairly.** Each active person gets a share
  of the day's free tier, so the first busy user cannot spend it all before
  lunch (#303).

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

## 2026-07-31 — Feedback: honest attribution, image attach, the loop made visible

- Every dispatch now gets its own attributed run: a second dispatch to a busy
  project waits until the current run finishes, so summaries, outcomes and
  "your feedback shipped" emails can never credit the wrong work.
- Visitors can attach an image to a report (file picker or paste); it shows
  as a thumbnail in the inbox.
- Repeat reports collapse into one row with a ×N counter.
- Reports filed by agents (AI review findings, synthesized briefs) are marked
  as such, and a visitor's text is always treated as data, never as an
  instruction to the agent.
- The loop in numbers: how many reports were resolved, and the median time
  from report to fix, on each inbox.
- Resolved reports you choose to feature appear on the landing page, with
  real excerpts only you curate.

## 2026-07-29 — Feedback widget: visitor reports become fleet work

- One script tag puts a feedback button on any site you run. Visitors point
  at the exact element that is broken; reports land in a per-project inbox.
- One click dispatches an agent to fix a report, with an optional instruction
  of yours added to the prompt.
- Pause, resume, rotate or revoke the widget from Loki, and the site follows
  within seconds; its connection status comes from a real heartbeat.
- Installing and removing the widget is one click too: an agent adds or
  removes the embed in your repository through your normal review flow.
- Synthesize groups new reports into briefs, and nothing executes without
  your approval. (A daily digest also filed themes for approval; it was
  removed on 2026-09-25.)
- When a dispatched fix deploys, the report resolves itself, and a visitor
  who left an email hears that their feedback shipped.

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
- **`bitbaum` runtime linked.** `user_projects` row now points at `/home/g/dev/bitbaum`
  for Fleet Runner dispatch.

## 2026-06-27 (k)

### Fixed
- **`applyProjectProfile` batch writes.** Attribute upserts run in one transaction
  (fixes ETIMEDOUT when enriching prod over a remote DB connection).
- **Prod backfill complete.** petvity, sbb-lost-found, and bitbaum now have full
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
