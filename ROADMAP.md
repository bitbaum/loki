# Roadmap

Where Loki is going, in order. This file is the canonical roadmap: the fleet
map (`/api/fleet/map`) reads it, `/roadmap` renders it, and the same record is
what every other fleet site shows for its own project. Format:
`docs/architecture/building-in-public-records.md`. Nothing is dated; the order
carries the argument. Nothing here claims what is not true.

## Now

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

### Fleet command center
The web control plane coordinates fleets of AI agents across projects, with one-button autopilot: pause all, or build all.
- [x] Agents drain each project's queue, then pick the next-best task
- [x] Per-project pause / resume / direct-send, with per-project autopilot overrides
- [x] Handoff between agent sessions with truthful status on every card
- [x] Multi-user foundation: GitHub OAuth, organizations, team invites, agent tokens

### Fleet Runner desktop app
The desktop app owns the agent terminals, agent launching and state sync on your computer — the same React tree the web serves.
- [x] Tray icon, OS notifications on agent idle, embedded session watcher
- [x] One tag push produces installers for Linux, macOS and Windows
- [x] Auto-update through the GitHub release feed

### The feedback loop, end to end
A visitor's note on any fleet site becomes a pull request, a deploy, and a walkthrough of the change on the live page.
- [x] One script tag puts a feedback button on any site; reports land in a per-project inbox
- [x] One click dispatches an agent; the fix ledger follows the PR to merge and deploy
- [x] The owner's own note starts the build straight from the site
- [x] "Watch the fix": a narrated cursor walks the owner through the change on the live page; a step it cannot show is filed back as a report
- [x] Failed runs say why in one sentence

### OrangeCat project handoff
A signed "Build it with Loki" link carries a public brief into Loki's guided project setup.
- [x] Loki asks for project context before agent work begins
- [x] Linking is optional and never publishes private work by itself

## Next

### One box becomes a pool
Runners on several boxes claim from the one queue; each site knows which box serves it.
- [ ] `new-site.sh --host`, and a register that records the host per site
- [ ] Runner units on a second box claiming from the shared queue
- [ ] Deploy reconciler that targets the right box

### Bring your own key, metered by default
The builder pays their model vendor directly and pays Loki for the platform; every run records the tokens it spent, per tenant, from day one.
- [ ] Tokens per run per tenant recorded and shown on the run
- [ ] BYOK as the default execution path for new accounts
- [ ] A metered pool (wholesale tokens sold inside a plan) once the numbers say so

### Partner track
Learner, then candidate (build one real project), then partner (a tenant on the box, allowed to register client sites). Approval and revenue-share rules are decided on Solon; payouts flow through OrangeCat.
- [ ] `partner_status` on the account and a `partner_applications` record with the reason, shown either way
- [ ] The candidate build is an ordinary project with an approval control in Control
- [ ] Self-serve "Go live" for a tenant's site through the existing runner channel
- [ ] The not-approved path: the docs and scripts to run the stack yourself

### Signed installers and native channels
Make Fleet Runner trivial to install on every platform, including for builders who never open a terminal.
- [ ] Apple-signed and notarized macOS builds, and a signed Windows executable
- [ ] Homebrew tap, winget, and a .deb apt repository
- [ ] Headless CLI install path for servers and CI runners

### Remote control channel
Web and mobile become genuine remote control surfaces, not eventually-consistent dashboards.
- [ ] The local app opens an authenticated outbound WebSocket when remote control is on
- [ ] Falls back to the existing queue when the local app is offline
- [ ] Scoped credentials through the existing agent token system

### Mobile fleet control
Native iOS and Android apps on the remote control channel, made for steering and approval rather than authoring.
- [ ] Push notifications for Beacon mode and Mission checkpoints
- [ ] Swipe to approve or reject agent output where a human is actually needed
- [ ] Voice capture for the autopilot intent ladder

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
A systems-design course whose only exercise is the candidate build, whose textbook is the fleet's own agent-facing docs, and whose last module is how to run the stack yourself.
- [ ] `/academy` with enrolment creating a learner record
- [ ] Five modules: the three planes, the feedback loop, tokens to `ui-*`, shipping, running it yourself

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
The same control patterns — autonomy dial, handoff, queues, visibility, override — on a different execution substrate.
- [ ] Per-fleet autonomy on the same dial: Manual → Queue → Beacon → Continuous → Mission
