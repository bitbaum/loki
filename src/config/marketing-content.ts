import { APP_DOMAIN } from "./brand";

// Central source of truth for all public marketing copy.
// Rebrand, reposition, or A/B test by editing this file — no component changes.

// Hero product visual — static chrome only. The actual fleet snapshot (projects,
// status, metrics) is fetched LIVE from the owner's real fleet in page.tsx via
// getHeroFleetSnapshot(); we never ship fabricated fleet data. This holds only
// the constant label text used by the console header.
export const HOME_HERO_CONSOLE = {
  label: "Fleet Command",
} as const;

// Mission — one striking statement, minimal elaboration
export const MISSION = {
  eyebrow: "WHY WE EXIST",
  title: "Mission",
  statement: "Direct the creation of everything you can imagine.",
  paragraphs: [
    "We are building the control plane for the age of autonomous creation. Today, one person commands a fleet of AI agents building software. Tomorrow, the same person commands fleets of robots building the physical world.",
    "The leverage shifts from companies to individuals. The bottleneck moves from raw capability to human direction.",
    "We are deliberately building in support for open and local models. The future of creation will not be gated behind closed frontier subscriptions.",
  ],
};

// Philosophy — short, declarative maxims with concrete reasoning
export const PHILOSOPHY = {
  eyebrow: "PRINCIPLES",
  title: "Principles",
  lede: "The constraints we use when building the control layer for the age of autonomous creation — from software agents today to robot fleets in the future.",
  values: [
    {
      name: "Choose where agents run.",
      description:
        "Connect Fleet Runner for work on your computer. Eligible accounts can also use the shared cloud builder. Keep project context and control in one place.",
    },
    {
      name: "Humans in the loop, by default.",
      description:
        "You decide how much the system decides. Per project. Per moment. Autonomy is a dial — not a switch you flip once and forget.",
    },
    {
      name: "Software today. Robots tomorrow.",
      description:
        "The same control patterns that orchestrate agents will orchestrate robots. We are building the abstraction layer for both.",
    },
    {
      name: "Open models, first class.",
      // "Open AND LOCAL models compete equally for your work" claimed a
      // capability that does not exist: the chat chain is freeChain("LOKI") —
      // Groq, OpenRouter, Gemini, all hosted — and every agent adapter is a
      // hosted-model CLI. There is no Ollama / llama.cpp / LM Studio path
      // anywhere in src. What IS true is the open-WEIGHT half: llama, qwen and
      // gpt-oss drive the loop today. So the claim keeps the half it earns and
      // states the other as the direction it is.
      description:
        "Frontier subscriptions are not the destination. Open-weight models drive Loki today — llama, qwen and gpt-oss — and running them locally is where this is going.",
    },
    {
      name: "Nothing hidden.",
      description:
        "You always know what each agent is doing and why. No black boxes inside your own fleet.",
    },
    {
      name: "Built for serious operators.",
      // Said "infrastructure for builders running many agents at once across
      // multiple projects — not a friendly chat assistant" until 2026-09-21.
      // That is the narrow framing #801 removed everywhere else on the same
      // day, and scripts/test/execution-plane.ts records why: it "named Loki's
      // deepest capability and not the product — Today, People, Crew, Money,
      // Goals and Habits ship here too", and under the narrow label those
      // surfaces read as scope creep. That rename pinned the three places it
      // lives internally and never reached the page the public reads.
      description:
        "Loki is where an operator's work actually gets done — commanding agent fleets is the largest part of it, alongside the people you work with, what you owe, and what you spend.",
    },
  ],
  closer:
    "These are not slogans. They are the constraints we use when making product and engineering decisions.",
};

// Investors — sharp thesis, declarative bullets
export const INVESTORS = {
  eyebrow: "FOR INVESTORS",
  headline: "The control layer for the age of autonomous creation.",
  thesis:
    "One person commanding a fleet of agents is the new unit of leverage. We are building the operating system for that future — and for the robotic fleets that will follow.",
  whyNow: [
    "Agent capability has crossed the orchestration threshold. The bottleneck is no longer raw generation. It is human direction.",
    "The most advanced users are already running many agents at once across multiple projects. They need infrastructure built for that reality.",
    "The winning architecture combines remote command with a clear choice of execution location. Loki supports the shared cloud builder for eligible accounts and Fleet Runner on your computer.",
    "Open and local models are converging on frontier capability. Whoever controls the orchestration layer will be neutral to model choice.",
    "The same control patterns transfer to physical robotics. The market has not yet appreciated this.",
  ],
  built:
    "A web command center coordinates fleets of AI agents across projects. Eligible accounts can run work on the shared cloud builder; Fleet Runner adds execution on the operator's computer, with sessions visible from the web. Per-project autonomy controls, handoffs, queue management, and truthful status surfaces are live and in daily use. Multi-OS Fleet Runner installers (Linux, macOS, Windows) ship from one CI matrix on every release tag.",
  // Scannable bullets, not a prose wall — the page pairs these with the live
  // fleet snapshot (same real data source as the homepage hero).
  traction: [
    "Loki runs its creator's entire operation — a live fleet of projects dispatched, monitored, and governed daily through the product itself.",
    "We use Loki in our own work and verify changes against real workflows; a successful agent run alone does not prove a live result.",
    "The homepage hero and this page render the same live snapshot of that fleet — real data, never fabricated numbers.",
    "The bet: the same workflow generalizes to anyone running many agents at once.",
  ],
  ask: "We are raising to broaden secure cloud execution, improve Fleet Runner, expand open-model support, and lay groundwork for robotic orchestration.",
};

export const INVESTOR_DETAILS = {
  deck: "Available upon request",
  contact: "cato@orangecat.ch",
};

// Roadmap — three honest buckets ("Shipping now" / "Next" / "Research") with
// one-liner items. Detail bullets render collapsed; strategy-essay sections
// keep a short summary plus a link to the full Thoughts essay instead of
// re-printing the argument on the roadmap.
export type RoadmapItem = {
  title: string;
  /** One line — what this is and why it matters. */
  line: string;
  /** Optional detail bullets, rendered inside a collapsed <details>. */
  details?: string[];
  /** Optional pointer to the Thoughts essay carrying the full argument. */
  essay?: { label: string; href: string };
};
export type RoadmapBucket = {
  title: string;
  summary: string;
  items: RoadmapItem[];
};

export const ROADMAP: {
  eyebrow: string;
  title: string;
  lede: string;
  buckets: RoadmapBucket[];
  throughlines: {
    eyebrow: string;
    title: string;
    lede: string;
    items: { title: string; body: string }[];
  };
  closer: string;
} = {
  eyebrow: "PRODUCT DIRECTION",
  title: "Roadmap",
  lede: "Building the operating system for people running serious AI agent operations — and for the robotic fleets that come next.",
  buckets: [
    {
      title: "Shipping now",
      summary:
        "Live in production. The system already coordinates real fleets across real projects.",
      items: [
        {
          title: "Fleet command center",
          line: "The web control plane coordinates fleets of AI agents across projects, with one-button autopilot: pause all, or build all.",
          details: [
            "Agents drain each project's queue, then pick the next-best task.",
            "Per-project pause / resume / direct-send semantics with per-project autopilot overrides.",
            "Reliable handoff system between agent sessions, with truthful card status surfaces.",
            "Multi-user SaaS foundation — GitHub OAuth, organizations, team invites, agent tokens.",
          ],
        },
        {
          title: "Fleet Runner desktop app",
          line: "One local execution path: the desktop app owns the agent terminals, agent launching, and state sync — the same React tree the web serves.",
          details: [
            "Tray icon, OS notifications on agent idle, and an embedded session watcher for fire-and-walk-away dispatch.",
            "The legacy bash runner was retired by deletion — one path, not two.",
            "Multi-OS release pipeline: one tag push produces installers for Linux, macOS and Windows from a shared CI matrix.",
            // Moved up from "Next", where it was listed as forthcoming while
            // already running: `build.publish` is the GitHub provider, and the
            // latest-*.yml update feeds publish with every release.
            "Auto-update through the GitHub release feed, so a running install pulls each new version in the background instead of going stale.",
          ],
        },
        {
          title: "OrangeCat project handoff",
          line: "A signed “Build it with Loki” link carries the public brief into Loki's guided project setup.",
          details: [
            "Loki asks for project context before agent work begins. You can choose an existing project instead when the handoff matches one.",
            "OrangeCat linking is optional. Linking alone does not publish private work; publishing requires a separate owner action.",
          ],
        },
      ],
    },
    {
      title: "Next",
      summary:
        "Concrete engineering, in sequence: distribution first, then the remote control channel, then mobile on top of it.",
      items: [
        {
          // Two of the four details here had already SHIPPED, and one of them
          // contradicted a "Shipping now" bullet on this same page ("one tag
          // push produces installers for Linux, macOS and Windows"). Checked
          // against release fleet-runner-v0.8.29: mac .dmg/.zip, win .exe and
          // both Linux artefacts all publish, and `build.publish` is exactly
          // the GitHub provider this promised. A roadmap that lists finished
          // work as forthcoming makes the product look less built than it is,
          // and it is the same untrue-copy problem as any other.
          //
          // What is genuinely outstanding is the SIGNING — no CSC_LINK /
          // APPLE_ID secret exists at repo or org level, and desktop-release.yml
          // says so itself: "empty when the secret is unset -> unsigned build,
          // exactly as today". That is what the first detail now claims.
          title: "Signed installers and native channels",
          line: "Make Fleet Runner trivial to install on every platform — including for builders who never open a terminal.",
          details: [
            "Apple-signed and notarized macOS builds, and a signed Windows .exe, so the first launch stops needing a Gatekeeper or SmartScreen detour. The builds themselves already ship on every tagged release.",
            "Native package channels where they exist — Homebrew tap for macOS, winget for Windows, .deb apt repo for Linux.",
            "Headless CLI agent install path for servers, CI runners, and operators who prefer a pure terminal flow.",
          ],
        },
        {
          title: "Remote control channel",
          line: "Web and mobile become genuine remote control surfaces — not eventually-consistent dashboards.",
          details: [
            "The local app opens an authenticated outbound WebSocket to the control plane when remote control is enabled; commands flow surface → backend → that user's specific local app.",
            "Falls back to the existing queue when the local app is offline.",
            "Scoped credentials via the existing agent token system. Outbound-only connections — easy to firewall.",
            "All execution of dangerous actions stays on the user's machine. The backend never sees raw file contents unless the user explicitly shares them.",
          ],
        },
        {
          title: "Mobile fleet control",
          line: "Native iOS and Android apps on the remote control channel — optimized for steering and approval, not authoring.",
          details: [
            "Push notifications for Beacon mode and Mission checkpoints.",
            "Swipe actions for approving or rejecting agent outputs at the moments that actually need a human.",
            "Voice capture for the autopilot intent ladder — direct the fleet while walking.",
          ],
        },
      ],
    },
    {
      title: "Research",
      summary:
        "Directions we are committed to that are design and strategy work today. Nothing here is presented as available.",
      items: [
        {
          title: "Secure cloud execution for more accounts",
          line: "Expand isolated cloud builders beyond the eligible-account service while preserving a clear per-project choice of where work runs.",
          details: [
            "Cloud builder sessions already run for eligible accounts; per-account sandboxing is the prerequisite for broader availability.",
            "Keep the project execution setting, session view, and current builder visible so users can tell where a job will run.",
            "Support additional parallelism and availability without routing work to a different machine silently.",
          ],
        },
        {
          title: "The fleet learns from its own runs",
          line: "The same evidence that decides whether a run was done should decide how the next one is briefed — with a human gate on every learned change.",
          details: [
            "Every dispatch is stored with the exact prompt that produced it and the graded outcome it earned — one joinable record instead of two disconnected logs.",
            "Prompt improvements are proposed from real run history and reviewed by a human before they land.",
            "Per-project lessons carry forward as references the agent may consult, never as rules it must obey; every learned change stays in version control.",
            "The judge that grades a run is a different model lineage from the agent that did the work — an unsupervised self-grading harness learns to game its own scoring, so the human gate is the feature, not the friction.",
          ],
        },
        {
          title: "Team and multi-machine surfaces",
          line: "Same control plane, multiple operators, multiple machines — shared fleet views, per-operator permissions, per-project autonomy ceilings.",
          details: [
            "Coordination when several people steer the same fleet without stepping on each other.",
            "Multi-machine orchestration for power users running across desktop, laptop, and remote box.",
          ],
        },
        {
          title: "Stakeholder graph",
          line: "Track each project's surrounding relationships — competitors, collaborators, investors, customers — as typed edges in OrangeCat's entity graph, surfaced on Loki for the agent to act on. Competitors ship first as the most automatable category.",
          essay: {
            label: "Read the essay: Where Stakeholders Live",
            href: "/thoughts/where-stakeholders-live",
          },
        },
        {
          title: "Funding-triggered work orders",
          line: "Connect verified OrangeCat settlements to owner-approved project work, with explicit controls and an audit trail.",
          details: [
            "Confirmed Bitcoin funding can already be linked to a Loki project and shown as a read-only summary.",
            "Automatic work orders, escrow, fiat settlement, and other payment rails are not available yet.",
          ],
        },
        {
          title: "Physical robotic fleets",
          line: "The same control patterns — autonomy dial, handoff, queues, visibility, override — applied to a different execution substrate. Not a separate product line bolted on later.",
          details: [
            "Per-fleet autonomy — the same dial: Manual → Queue → Beacon → Continuous → Mission.",
            "The person who today directs a fleet of agents building software is developing the muscles that will let them direct a fleet of robots building physical things.",
          ],
        },
      ],
    },
  ],
  throughlines: {
    eyebrow: "WHAT STAYS CONSTANT",
    title: "Throughlines",
    lede: "These do not change as the phases ship. They are constraints we hold across every stage.",
    items: [
      {
        title: "The execution location is visible and chosen.",
        body: "Projects run on their configured builder. Eligible accounts can use the cloud builder; Fleet Runner runs work on your computer when you choose it.",
      },
      {
        title: "Open and local models are first-class.",
        body: "Frontier subscriptions are often the best tool. But the infrastructure does not require them — the user points their fleet at whatever model serves their goals best.",
      },
      {
        title: "Autonomy is a user-controlled switch.",
        body: "Pause all, or build all — with per-project overrides. Per project. Per moment. Never forced.",
      },
      {
        title: "Outbound connections only.",
        body: "The local client connects out to the control plane, not the other way around. Easier to firewall. Easier to reason about. Credible to security-conscious operators.",
      },
      {
        title: "Nothing hidden.",
        body: "Every agent's state is legible. No black boxes inside your own fleet.",
      },
    ],
  },
  closer:
    "This is the public-facing roadmap. Detailed engineering plans, deadlines, and sequencing live in internal documents and the architecture reference post.",
};

// Shared final CTA used at the bottom of every marketing page
export const FINAL_CTA = {
  title: "Begin.",
  note: "For builders running real agent operations.",
  cta: "Start building",
};

// Download / install section for the desktop Fleet Runner (the optional local app).
//
// SSOT for the public download experience. The shape is deliberately narrative,
// not a flat file list: a non-technical visitor reads it top to bottom and gets
// answers in order — what is this, do I need it, how to get it, what happens
// next. Update links + copy here when we ship real artifacts.
//
// Platform status is honest: only "ready" platforms show a real installer URL.
// "comingSoon" platforms surface a release-watch CTA (GitHub releases atom
// subscription) and a *clearly demoted* build-from-source path for developers,
// instead of pretending the source tree is a download.
export const DESKTOP_DOWNLOAD = {
  // Top-level back-compat fields (used by /download page metadata + homepage).
  eyebrow: "DESKTOP APP",
  title: "Get Fleet Runner",
  lede: "Loki runs in your browser as a full control plane. Fleet Runner is the optional desktop app that lets agents act on your computer — open files, run commands, drive terminal sessions — while you stay in command from the web or your phone.",

  hero: {
    eyebrow: "DESKTOP APP",
    title: "Get Fleet Runner",
    lede: "Loki runs in your browser as a full control plane. Fleet Runner is the optional desktop app that lets agents act on your computer — open files, run commands, drive terminal sessions — while you stay in command from the web or your phone.",
  },

  // Web vs. desktop — answers "do I need this?" in plain language.
  comparison: {
    web: {
      label: `Web (${APP_DOMAIN})`,
      tagline: "Already available — no install",
      bullets: [
        "Full fleet visibility across all projects",
        "Browse history, projects, and queues",
        "Dispatch commands from any browser or phone",
        "Create projects, dispatch work, and steer eligible cloud sessions from the browser",
      ],
    },
    desktop: {
      label: "Desktop (Fleet Runner)",
      tagline: "Adds local execution",
      bullets: [
        "Actually runs agents on your machine",
        "Runs agents in terminals it owns, plus handoffs",
        "Native notifications when an agent finishes",
        "Keeps working after you close your browser",
      ],
    },
    note: "You can start with the web today and add Fleet Runner whenever you want agents to actually do work on your machine.",
  },

  // Three steps that answer "what happens after I click download?"
  // Numbered so visual layout can render as a step indicator on dark bg.
  setupSteps: [
    {
      number: "01",
      title: "Make it runnable, then open",
      // The builds are NOT signed: desktop-release.yml wires CSC_LINK /
      // APPLE_ID from secrets that do not exist at repo or org level, and its
      // own comment says so — "gated: empty when the secret is unset \u2192 unsigned
      // build, exactly as today". So the first launch is where a new user
      // actually gets stuck, and this step used to tell them the opposite:
      // "on macOS and Windows, a normal double-click is enough". It is not.
      // Gatekeeper refuses an unsigned app outright and SmartScreen interrupts
      // one. The page was already careful about the Linux chmod friction and
      // silent about the two that block.
      body: "On Linux, downloads start non-executable for safety \u2014 paste the one-line command shown under Download to mark Fleet Runner executable and launch it. On macOS, the builds are not yet signed by Apple, so the first launch needs right-click \u2192 Open, then Open again (a plain double-click is refused). On Windows, SmartScreen shows \u201cWindows protected your PC\u201d \u2014 choose More info \u2192 Run anyway. After the first launch, both open normally.",
    },
    {
      number: "02",
      title: "Sign in — once",
      body: 'Use the same Loki account you signed up with on the web. The desktop app opens straight to your dashboard. From the web, you can also click "Open in Fleet Runner" to log the desktop app in without copy-pasting a token. From v0.3.0 onward, Fleet Runner checks for updates on launch and downloads them in the background — you\'ll never have to manually re-download.',
    },
    {
      number: "03",
      title: "Dispatch your first intent",
      body: "Choose a project and its Runs on setting in Control, then dispatch an intent. Eligible accounts can use the cloud builder; other projects can run through Fleet Runner on your computer. Install a supported agent CLI for the builder you choose.",
    },
  ],

  // Platforms with honest "ready" vs "comingSoon" status. The component shows
  // a real CTA + secondary formats for ready platforms, and a release-watch
  // link + collapsed build-from-source for coming-soon platforms.
  platforms: [
    {
      id: "linux",
      label: "Linux",
      status: "ready" as const,
      primary: {
        // .deb is the recommended default — system package manager handles
        // perms + integration. AppImage hits KDE/KIO "for security reasons"
        // refusal on double-click (Dolphin blocks the +x bit by policy) and
        // requires terminal chmod, which is a dead-end for non-power-users.
        // Most Loki users are on Ubuntu/Debian derivatives where .deb
        // Just Works. AppImage stays as a secondary for Arch / Fedora /
        // immutable distros where .deb isn't the right format.
        label: "Download .deb (Ubuntu / Debian / Mint)",
        note: "Recommended · installs via package manager",
        // /releases/latest/download/... — GitHub redirects to the current
        // release, so this URL survives future version bumps.
        url: "https://github.com/bitbaum/loki-releases/releases/latest/download/Fleet-Runner-linux-amd64.deb",
      },
      secondary: [
        {
          label: "AppImage (other distros)",
          url: "https://github.com/bitbaum/loki-releases/releases/latest/download/Fleet-Runner-linux-x86_64.AppImage",
        },
      ],
      afterDownload:
        "Open a terminal and paste this one line. It installs Fleet Runner system-wide, then launches it. No file-manager dance, no KDE security popup:",
      command: "sudo dpkg -i ~/Downloads/Fleet-Runner-linux-amd64.deb && fleet-runner",
    },
    {
      id: "mac",
      label: "macOS",
      // Shipping since fleet-runner-v0.8.11 (2026-08-04) restored the
      // three-platform matrix; v0.8.12 carries Fleet-Runner-mac-arm64.dmg and
      // .zip. The old "the latest release has no mac asset" comment outlived
      // its truth by ~3 weeks and hid working downloads behind a coming-soon
      // panel — while /releases said the opposite two files away.
      status: "ready" as const,
      primary: {
        label: "Download .dmg",
        note: "Apple Silicon",
        url: "https://github.com/bitbaum/loki-releases/releases/latest/download/Fleet-Runner-mac-arm64.dmg",
      },
      secondary: [
        {
          label: ".zip (no installer)",
          url: "https://github.com/bitbaum/loki-releases/releases/latest/download/Fleet-Runner-mac-arm64.zip",
        },
      ],
      afterDownload:
        'Open the .dmg, drag Fleet Runner to Applications, then launch it. First time only: macOS will warn "Apple cannot check this for malicious software" (we\'re not yet code-signed). Control-click the app → Open → Open. After that one bypass, it launches normally:',
      command: "open ~/Applications/Fleet\\ Runner.app",
    },
    {
      id: "win",
      label: "Windows",
      // Shipping since v0.8.11; v0.8.12 carries Fleet-Runner-win-x64.exe.
      status: "ready" as const,
      primary: {
        label: "Download installer",
        note: "x64",
        url: "https://github.com/bitbaum/loki-releases/releases/latest/download/Fleet-Runner-win-x64.exe",
      },
      secondary: [],
      afterDownload:
        'Run the .exe. Windows SmartScreen may say "unrecognized app" (we\'re not yet code-signed). Click "More info" → "Run anyway." The installer takes care of the rest:',
      command: "Fleet-Runner-win-x64.exe",
    },
  ],

  // "What Fleet Runner uses on your computer" — plain-language explanation of
  // why each tool exists, not a wall of curl commands.
  prerequisites: {
    title: "What Fleet Runner uses on your computer",
    description:
      "Fleet Runner runs the supported agent CLI you choose; install that agent and sign in with its provider. Eligible accounts can also use the cloud builder. The current agent list appears in Loki and may vary by builder.",
    items: [
      {
        title: "Choose an agent",
        role: "Claude Code · Codex · Cursor Agent · Antigravity · Grok · OpenClaw",
        required: true,
        whyYouNeedIt:
          "Install and sign in to at least one supported agent CLI on the computer that will run it. Loki shows which agents are available for each builder.",
        command: "",
        href: "",
        installLabel: "",
      },
    ],
  },

  // Developer / advanced — collapsed by default in the UI.
  developer: {
    label: "For developers",
    description: "Build the desktop app yourself, or run the headless CLI agent instead.",
    buildFromSource: {
      label: "Build the desktop app from source",
      body: "Clone and build a native package for your machine. Useful if you're contributing, want a development build, or are on a platform we don't ship binaries for yet.",
      command:
        "git clone https://github.com/bitbaum/loki.git && cd loki/desktop && npm install && npm run dist:linux  # or dist:mac / dist:win",
    },
    headlessAgent: {
      label: "Headless CLI agent",
      body: "For CI runners, headless servers, or operators who prefer a pure terminal flow. Fleet Runner is the recommended path; the CLI agent covers machines that can't run a desktop app.",
      command: "curl -fsSL https://loki.orangecat.ch/api/agent/install | node - init",
    },
  },

  // "Coming to more surfaces" — kept in case the homepage section wants it.
  future: {
    desktop: "Signed installers for macOS and Windows, reducing first-launch security prompts.",
    mobile:
      "Native iOS and Android apps on the same remote control channel — fleet visibility, queues, and dispatch from your phone.",
  },
};
/**
 * The status field is widened back to the full union on purpose. It is derived
 * from the data, so once every platform shipped, `status` narrowed to the
 * single literal "ready" and TypeScript declared the coming-soon branch
 * `never` — deleting a correct, still-needed UI state purely because today's
 * data doesn't exercise it. The union is the contract; the data is just its
 * current value.
 */
type DesktopDownloadPlatformShape = Omit<(typeof DESKTOP_DOWNLOAD.platforms)[number], "status">;
export type DesktopDownloadPlatform =
  | (DesktopDownloadPlatformShape & { status: "ready" })
  | (DesktopDownloadPlatformShape & { status: "comingSoon" });

export const PRODUCT_SURFACES = [
  {
    label: "Loki",
    title: "Say what you want. It runs.",
    body: "One conversational composer turns plain language into action — “code review for kivvi” dispatches it into that project; a question gets answered. The system picks the project and the path, so you hold less in your head.",
    meta: "Natural language · auto-routing · voice",
  },
  {
    label: "Control",
    title: "See the whole fleet at once.",
    body: "Every project, active agent, queue item, and handoff sits in one operating view instead of disappearing into terminal tabs.",
    meta: "Live sessions · autonomy levels · dispatch",
  },
  {
    label: "Runner",
    title: "Choose the builder for each project.",
    body: "Eligible accounts can use the shared cloud builder. Fleet Runner runs agents against your computer's checkout and tools when a project is set to run locally.",
    meta: "Cloud builder · Fleet Runner · per-project routing",
  },
  {
    label: "Beacon",
    title: "Human judgment appears at the right moments.",
    body: "Fleet-wide play/pause with per-project queues and overrides — each project asks for oversight only when the next decision actually needs you.",
    meta: "Approvals · voice intent · remote command",
  },
  {
    label: "Terminal",
    title: "Watch and drive any agent live.",
    body: "An embedded terminal per project — see exactly what the cloud builder or your local runner is typing, and type into it yourself when the moment calls for hands on the wheel.",
    meta: "Live PTY · cloud + local · per-project tabs",
  },
  {
    label: "Feedback",
    title: "Your visitors file the work.",
    body: "One script tag puts a feedback button on any site you run. Reports land in a per-project inbox, one click dispatches an agent to fix them, and when the fix ships the reporter gets an email.",
    meta: "Embeddable widget · agent dispatch · closed loop",
  },
] as const;

/** Homepage shows the four surfaces a first-time visitor needs. The rest live in-product. */
export const HOME_PRODUCT_SURFACES = PRODUCT_SURFACES.slice(0, 4);

export const START_PATHS = [
  {
    title: "Start in the browser",
    body: "Create a project, set where its work runs, then dispatch and follow agent sessions from Loki. Eligible accounts can start on the cloud builder without an install.",
    href: "/sign-up",
    cta: "Start building",
  },
  {
    title: "Run on your computer",
    body: "Install Fleet Runner when a project should use your local checkout, tools, and agent sign-in.",
    href: "/download",
    cta: "Get Fleet Runner",
  },
  {
    title: "Read the architecture",
    body: "Understand the local-runner, remote-control, queue, and handoff design before committing your workflow to it.",
    href: "/whitepaper",
    cta: "View whitepaper",
  },
] as const;

// Kept as a re-export for existing imports. New public integration surfaces
// should import from config/ecosystem directly.
export { ORANGECAT_INTEGRATION } from "./ecosystem";
