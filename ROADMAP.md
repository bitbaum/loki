# Roadmap

Where Loki is going, in order. This file is the canonical roadmap: the fleet
map (`/api/fleet/map`) reads it, `/roadmap` renders it, and the same record is
what every other fleet site shows for its own project. Format:
`docs/architecture/building-in-public-records.md`. Nothing is dated; the order
carries the argument. Nothing here claims what is not true. "Now" holds only
work that is actually moving; finished items live under "Shipped".

## Now

### Partner track
bitbaum owns the systems design course and partner approval. Loki supplies scoped application and assigned-delivery infrastructure; qualification does not enrol a partner in the whole ecosystem. OrangeCat or Solon handoffs remain optional and require their own purpose and consent.
- [x] Request-scoped application evidence, separate course review and studio approval with visible reasons; bitbaum owns the course and public profile consent
- [ ] The candidate build is an ordinary project with an approval control in Control
- [ ] Self-serve "Go live" for a tenant's site through the existing runner channel
- [ ] The not-approved path: the docs and scripts to run the stack yourself

## Next

### Capacity you can read
The numbers that decide when the next wall is hit, published on the System page and in this file, so "when do we need more" is a reading, not a guess.
- [ ] Queue median wait per builder channel
- [ ] Box memory and CPU headroom
- [ ] Monthly token spend, and the share of it that is routine work
- [ ] Drop-off at "add your API key"

### Tenancy on the box
One Linux user, one clone root, one runner service and one credential file per builder account. The shared cloud builder is one user with one set of keys today, which is why it is restricted to eligible accounts.
- [ ] Design note: tenant model, credential handling, egress limits
- [ ] `new-tenant.sh`: user, dev root, `loki-box-runner@<tenant>` unit
- [ ] Eligibility reads the tenant record instead of an environment allowlist
- [ ] Per-tenant CPU, memory and network limits

### One box becomes a pool
Runners on several boxes claim from the one queue; each site knows which box serves it.
- [ ] `new-site.sh --host`, and a register that records the host per site
- [ ] Runner units on a second box claiming from the shared queue
- [ ] Deploy reconciler that targets the right box

### Bring your own key, metered by default
The builder pays their model vendor directly and pays Loki for the platform; every run records the tokens it spent, per tenant, from day one.
- [x] Loki's own chat runs on your key when you paste one in Settings
- [ ] Tokens per run per tenant recorded and shown on the run
- [ ] BYOK as the default execution path for new accounts
- [ ] A metered pool (wholesale tokens sold inside a plan) once the numbers say so

### Signed installers and native channels
Make Fleet Runner trivial to install on every platform, including for builders who never open a terminal.
- [x] Headless CLI install path for servers and CI runners
- [ ] Apple-signed and notarized macOS builds, and a signed Windows executable
- [ ] Homebrew tap, winget, and a .deb apt repository

### Remote control channel
Web and mobile become genuine remote control surfaces, not eventually-consistent dashboards.
- [x] When your computer is offline, its work waits in a visible queue instead of going somewhere else
- [ ] The local app opens an authenticated outbound WebSocket when remote control is on
- [ ] Scoped credentials through the existing agent token system

### Mobile fleet control
Native iOS and Android apps on the remote control channel, made for steering and approval rather than authoring. No-screen mode (shipped) is the web form of this; a native shell is what it needs if the browser suspends the page when the screen locks.
- [ ] Push notifications when an agent needs you
- [ ] Swipe to approve or reject agent output where a human is actually needed
- [x] Voice capture for commands and approvals

## Later

### Loki as a GitHub App
Builders work in their own GitHub organization: repositories, secrets and CI minutes are theirs, and Loki acts through an app installation rather than as the studio's account.
- [ ] App installation flow and per-installation tokens
- [ ] Provisioning and CD registration against the builder's org

### Own inference for routine work
Reviews, walkthrough scripts, second opinions and briefs on an open-weight model on rented GPUs, once monthly API spend passes roughly thirty thousand dollars and most of it is routine.
- [ ] Route routine features to a self-hosted model behind the same `callTextDetailed` seam
- [ ] Cost per shipped fix published alongside the capacity numbers

### The academy
The studio-owned transferable course is developed in bitbaum. Loki provides optional building tools and the application evidence API; course content and teaching priorities remain in the studio roadmap.
- [x] bitbaum hosts the initial `/academy/` lesson and capstone rubric; its portal records evidence without requiring a Loki account
- [ ] Follow bitbaum's course expansion and assessment calibration after the first pilot reviews

### Secure cloud execution for more accounts
Isolated cloud builders beyond the eligible-account service, with the per-project choice of where work runs kept visible.
- [ ] Per-account sandboxing (the tenancy item above is the prerequisite)
- [ ] More parallelism without routing work to a different machine silently

### The fleet learns from its own runs
The evidence that decides whether a run was done also decides how the next one is briefed, with a human gate on every learned change.
- [ ] Every dispatch stored with the exact prompt and the graded outcome, one joinable record
- [ ] Prompt improvements proposed from run history and reviewed by a person before they land
- [ ] The judge is a different model lineage from the agent that did the work

### Team and multi-machine surfaces
Same control plane, several operators, several machines: shared fleet views, per-operator permissions, per-project autonomy ceilings.
- [ ] Coordination when several people steer one fleet
- [ ] Orchestration across desktop, laptop and remote box

### Stakeholder graph
Each project's competitors, collaborators, investors and customers as typed edges in OrangeCat's entity graph, surfaced on Loki for the agent to act on. Essay: https://loki.orangecat.ch/thoughts/where-stakeholders-live
- [ ] Competitors first, as the most automatable category

### Funding-triggered work orders
Verified OrangeCat settlements connected to owner-approved project work, with explicit controls and an audit trail.
- [x] Confirmed Bitcoin funding can be linked to a Loki project and shown read-only
- [ ] Automatic work orders, escrow and other rails

### Physical robotic fleets
The same control patterns — an on/off autopilot, approvals, handoff, queues, visibility, override — on a different execution substrate.
- [ ] Per-fleet autopilot behind the same approval gate

## Shipped

### No-screen mode
Run the fleet with the phone in a pocket: one tap opens the microphone, the briefing is read aloud, twelve spoken commands approve, dispatch, pause and resume through the seams the screen uses, and what changes — a run finishing, a failure, a new approval — is announced unasked.
- [x] The briefing, the approval list and the failure list composed from one snapshot, pure and tested
- [x] An explicit grammar for the twelve commands; anything else is a question for Loki
- [x] Announcements between turns from a twenty-second poll, bounded to five per poll
- [x] The headphone button as the only button, through the media session
- [ ] Verified on a locked iPhone in a pocket for an hour

### Make it yours
Pick one of the studio's MIT projects and say what your copy is for; agents copy it into a project of your own, keep the licence and the credit, and give it your name and look.

### Change a website from its address
Enter an existing website and say what should change, in plain words. The brief survives signing in and becomes one project, and sending it starts the build.

### Message Loki from any AI app
Loki is an MCP server: claude.ai, ChatGPT, Claude Code and Cursor can ask it questions, list projects and approvals, and — with a separate permission — act. It signs in with your OrangeCat account or an agent token.

### Watch it work
A project's run as a readable thread: what the agent was asked, each step it took, what it is doing right now in one line, and its handoff at the end.

### One account through OrangeCat
Sign up with OrangeCat and the same account opens OrangeCat, Loki and Solon. An existing Loki account links to it with one click; GitHub, Google, X and email sign-in still work.

### Roles, hand-over and invites
Invite anyone into a project by email, with or without an account. A builder can run agents, a client follows the work, and the owner can hand the whole project to another member.

### Approvals from Telegram
Decide on Loki's proposed actions with one tap in Telegram, and give standing approval to small, reversible ones such as an event in your own calendar.

### Found a Solon organization from a project
Loki prepares the link with the project filled in; the owner signs with their own wallet on Solon, and the project is attributed to that organization only with their consent.

### Take a site down
A site Loki built can be taken offline, put behind a password, or removed. The plan shows exactly what will happen before the button exists, and the permanent options are typed, not clicked.

### Crew
Hand work to people, not only agents. An assignment is a draft until you hand it over; the person answers through a link with no account, and a fee can be set in bitcoin, payable to their own OrangeCat profile.

### Fleet command center
The web control plane coordinates fleets of AI agents across projects, with one-button autopilot: pause all, or build all.
- [x] Agents drain each project's queue, then pick the next-best task
- [x] Per-project pause / resume / direct-send, with per-project autopilot overrides
- [x] Handoff between agent sessions with truthful status on every card
- [x] Multi-user foundation: sign-in through OrangeCat (or GitHub, Google, X, email), organizations, team invites, agent tokens

### Fleet Runner desktop app
The desktop app owns the agent terminals, agent launching and state sync on your computer — the same React tree the web serves.
- [x] Tray icon, OS notifications on agent idle, embedded session watcher
- [x] One tag push produces installers for Linux, macOS (Apple silicon) and Windows
- [x] Auto-update through the GitHub release feed

### The feedback loop, end to end
A visitor's note on any fleet site becomes a pull request, a deploy, and a walkthrough of the change on the live page.
- [x] One script tag puts a feedback button on any site; reports land in a per-project inbox
- [x] One click dispatches an agent; the fix ledger follows the PR to merge and deploy
- [x] The owner's own note starts the build straight from the site
- [x] "Watch the fix": a narrated cursor walks the owner through the change on the live page; a step it cannot show is filed back as a report
- [x] The walkthrough tells the story — what was wrong, why this way, what else was considered, who it helps — from a design note the agent writes with each fix
- [x] The reporter gets their own walkthrough of their fix, in plain words
- [x] Failed runs say why in one sentence

### OrangeCat project handoff
A signed "Build it with Loki" link carries a public brief into Loki's guided project setup.
- [x] Loki asks for project context before agent work begins
- [x] Linking is optional and never publishes private work by itself
