import { APP_DOMAIN } from "./brand";

// Central source of truth for all public marketing copy.
// Rebrand, reposition, or A/B test by editing this file — no component changes.

// Hero product visual — static chrome only. The actual fleet snapshot (projects,
// status, metrics) is fetched LIVE from the owner's real fleet in page.tsx via
// getHeroFleetSnapshot(); we never ship fabricated fleet data. This holds only
// the constant label text used by the console header.
export const HOME_HERO_CONSOLE = {
  label: "On Loki right now",
  /** The badge when an agent is working. Never "Live" — fleet rule: nothing is
   *  Live, everything is beta. */
  busy: "Agent working",
  idle: "Beta",
} as const;

// ── Homepage: the three steps ───────────────────────────────────────────────
// The product's actual first flow, in a newcomer's words. Every claim here is
// checked: Make it happen (src/lib/project-kickoff.ts), the live site at
// <name>.orangecat.ch (site-cd.ts), owner notes that build themselves
// (api/feedback/route.ts, #937), and the before/after phone check with
// rollback on every site deploy (selfhost-deploy.yml, #943).
export const HOME_STEPS = [
  {
    number: "01",
    title: "Describe it",
    body: "Write a sentence or two about what you want — a website, a tool, a change to a site you already have. Loki may ask up to five short questions. Skip any of them.",
  },
  {
    number: "02",
    title: "Agents build it and put it online",
    body: "Loki sets up the project, puts an AI coding agent to work, checks the result and publishes it — a website gets its own address, like yourname.orangecat.ch.",
  },
  {
    number: "03",
    title: "Say what to change",
    body: "Open your site, tap the Loki button and say or type what should be different. An agent makes the change and it goes online by itself. Visitors can leave notes too — those wait for your OK.",
  },
] as const;

export const HOME_SAFETY_NOTE =
  "Every change to a site is checked on a phone-sized screen before and after it goes online. If it made the page worse, Loki puts the previous version back.";

// ── Homepage: who it is for ─────────────────────────────────────────────────
// Three doors instead of one pitch. Loki's flows serve all three; the old page
// addressed only the last.
export const HOME_AUDIENCES = [
  {
    title: "You have an idea",
    body: "No code needed. Describe what you want, answer a few questions, and follow along as it is built.",
    href: "/sign-up",
    cta: "Start a project",
  },
  {
    title: "You have a website to change",
    body: "Say which site and what should be different — type it or just speak. Loki turns it into a brief for an agent — free.",
    href: "/change",
    cta: "Change a website",
  },
  {
    title: "You already work with AI agents",
    body: "Run Claude Code, Codex, Cursor, Antigravity and Grok across all your projects from one place — on the cloud builder or your own computer.",
    href: "/how-it-works",
    cta: "How it works",
  },
] as const;

// ── Homepage: where the work runs ───────────────────────────────────────────
// Honest about eligibility: the cloud builder and repositories in the bitbaum
// GitHub organisation are fleet infrastructure, allowed for the founder and an
// explicit allowlist only (src/lib/execution-access.ts
// isFleetInfrastructureAllowed). Everyone else connects Fleet Runner.
export const WHERE_IT_RUNS = {
  eyebrow: "WHERE THE WORK RUNS",
  title: "In the cloud, or on your own computer.",
  lede: "Loki itself runs in your browser and on your phone. The agents need a computer to work on — you choose which one, per project.",
  options: [
    {
      label: "Cloud builder",
      title: "Nothing to install",
      body: "An always-on server does the work, even while your laptop is closed. During the beta it is open to invited accounts.",
      cta: {
        label: "Ask for cloud access",
        href: "mailto:cato@orangecat.ch?subject=Loki%20cloud%20access",
      },
    },
    {
      label: "Your computer",
      title: "Fleet Runner, a free desktop app",
      body: "Agents work on your machine, with your files and your own agent subscriptions. Linux, Windows and Apple-silicon Macs.",
      cta: { label: "Get Fleet Runner", href: "/download" },
    },
  ],
} as const;

// Mission — one striking statement, minimal elaboration
export const MISSION = {
  eyebrow: "WHY WE EXIST",
  title: "Mission",
  statement: "Direct the creation of everything you can imagine.",
  paragraphs: [
    "Today, a person can describe what they want and have AI agents build it, ship it and keep improving it. Loki is where that happens — one project or forty. Tomorrow, we intend the same kind of direction to reach machines that build in the physical world.",
    "The leverage shifts from companies to individuals. The bottleneck moves from raw capability to human direction.",
    "Open-weight models already run Loki's own chat. The future of creation should not be gated behind closed frontier subscriptions — running models locally is where this is going.",
  ],
};

// Philosophy — short, declarative maxims with concrete reasoning
export const PHILOSOPHY = {
  eyebrow: "PRINCIPLES",
  title: "Principles",
  lede: "The constraints we hold while building Loki — the place where AI agents do your work and you stay in charge of it.",
  values: [
    {
      name: "Choose where agents run.",
      description:
        "Connect Fleet Runner for work on your computer. Eligible accounts can also use the shared cloud builder. Keep project context and control in one place.",
    },
    {
      name: "Humans in the loop, by default.",
      description:
        "You decide how much the system decides. Autopilot is a switch you hold — per project, and one button pauses everything. Anything risky waits for your approval, which you can give from your phone.",
    },
    {
      name: "Software today. Robots tomorrow.",
      description:
        "The same patterns that direct software agents should one day direct machines. Today Loki builds software; we design it so that step is possible.",
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
  headline: "Where AI agents do the work — and people stay in charge.",
  thesis:
    "One person directing many agents is the new unit of leverage. Loki is where that person describes the work, the agents build and ship it, and every change stays visible and reversible.",
  whyNow: [
    "Agent capability has crossed the orchestration threshold. The bottleneck is no longer raw generation. It is human direction.",
    "People are already running several agents at once across several projects — and people who never wrote code want the same result. Both need one place to direct, check and ship the work.",
    "The winning architecture combines remote command with a clear choice of execution location. Loki supports the shared cloud builder for eligible accounts and Fleet Runner on your computer.",
    "Open-weight models keep closing the gap on frontier capability. A layer that runs many vendors' agents is neutral to which model wins.",
    "The same control patterns transfer to physical robotics. The market has not yet appreciated this.",
  ],
  built:
    "A web workspace runs AI coding agents (Claude Code, Codex, Cursor, Antigravity, Grok) across many projects: from a plain description to a repository, a deployed site and a feedback loop that turns notes on that site into the next change. Invited accounts run on the shared cloud builder; Fleet Runner runs agents on the operator's own computer (Linux, Windows, Apple-silicon macOS). Every site deploy is checked on a phone-sized screen and rolled back if it got worse. Beta, in daily use.",
  // Scannable bullets, not a prose wall — the page pairs these with the live
  // fleet snapshot (same real data source as the homepage hero).
  traction: [
    "Loki builds and ships its creator's own projects — the studio's sites, OrangeCat and Solon among them — every day, through the product itself.",
    "We use Loki in our own work and verify changes against real workflows; a successful agent run alone does not prove a live result.",
    "The homepage and this page show the same snapshot of projects whose owners chose to show them — real data, never fabricated numbers.",
    "The bet: the same workflow generalizes to anyone running many agents at once.",
  ],
  ask: "We are raising to open the cloud builder to everyone who signs up, with each account isolated, to improve Fleet Runner, and to broaden open-model support.",
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

// The roadmap ITEMS are not here. They are ROADMAP.md at the repository root,
// read into the fleet map (src/lib/register/repo-records.ts) and rendered by
// /roadmap from there — the same record every fleet site shows. This object
// keeps only the page's framing: the lede, the throughlines and the closer.
// The buckets that used to live here went stale twice (finished work listed
// as forthcoming, see the git history of this file); a record next to the
// code, reviewed in the same PR as the change, is the fix.
export const ROADMAP: {
  eyebrow: string;
  title: string;
  lede: string;
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
  lede: "What Loki is building, in order: what is being worked on now, what comes next, what comes later — and what has already shipped.",
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
        // Same correction as PHILOSOPHY above: no local-model path exists.
        title: "Open-weight models, not one vendor.",
        body: "Open-weight models — llama, qwen and gpt-oss — run Loki's own chat today, and you can bring your own key. Running them on your own machine is the direction; there is no local path yet.",
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
    "Nothing here is dated; the order carries the argument, and every change to it is a reviewed commit.",
};

// Shared final CTA used at the bottom of every marketing page
export const FINAL_CTA = {
  title: "Start a project.",
  note: "Free while Loki is in beta. Open source under the MIT licence.",
  cta: "Start a project",
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
  lede: "Loki runs in your browser. Fleet Runner is the desktop app that lets agents work on your own computer — open files, run commands, use the terminal — while you follow along from the web or your phone. You need it unless your account has Loki's cloud builder.",

  hero: {
    eyebrow: "DESKTOP APP",
    title: "Get Fleet Runner",
    lede: "Loki runs in your browser. Fleet Runner is the desktop app that lets agents work on your own computer — open files, run commands, use the terminal — while you follow along from the web or your phone. You need it unless your account has Loki's cloud builder.",
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
        "Create projects, hand out work, and follow cloud builder sessions where your account has it",
      ],
    },
    desktop: {
      label: "Desktop (Fleet Runner)",
      tagline: "Adds local execution",
      bullets: [
        "Runs agents on your own computer",
        "Runs agents in terminals it owns, plus handoffs",
        "Native notifications when an agent finishes",
        "Keeps working after you close your browser",
      ],
    },
    note: "You can start on the web today. If your account does not have the cloud builder, add Fleet Runner so agents have a computer to work on.",
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
      body: 'Use the same Loki account you signed up with on the web. The desktop app opens straight to your dashboard. From the web, you can also click "Open in Fleet Runner" to log the desktop app in without copy-pasting a token. Fleet Runner checks for updates on launch and downloads them in the background — you\'ll never have to manually re-download.',
    },
    {
      number: "03",
      title: "Give it your first piece of work",
      body: "In Control, set the project's Runs on to This computer, then write what you want done and send it. Fleet Runner needs at least one agent installed and signed in on this computer.",
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
        note: "Apple Silicon (M1 or newer) · no Intel build yet",
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
      "Fleet Runner runs the agent you choose; install that agent and sign in with its provider. The current agent list appears in Loki and may vary by builder.",
    items: [
      {
        title: "Choose an agent",
        role: "Claude Code · Codex · Cursor · Antigravity · Grok",
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
      body: "Clone and build a native package for your machine. Useful if you're contributing, want a development build, or are on a platform we don't ship binaries for yet, such as an Intel Mac.",
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

// What is inside, for a visitor who wants a look before signing up. The first
// four render on the homepage. "Beacon" (a tier of the autonomy ladder removed
// 2026-06-11) used to be one of them; the feedback loop — the most-shipped
// area of 2026-09 — was cut. Plain words; the names are the ones in the app.
export const PRODUCT_SURFACES = [
  {
    label: "Feedback",
    title: "Your site collects its own to-do list.",
    body: "A small Loki button sits on every site Loki builds. Notes from you start a fix right away; notes from visitors wait for your OK. Whoever left an email hears back when it is fixed.",
    meta: "Feedback button · fixes · replies",
  },
  {
    label: "Watch",
    title: "See every step the agent takes.",
    body: "Follow a run as a readable thread — what was asked, what the agent is doing, what it changed and where it went live. Step in and type yourself when you want to.",
    meta: "Live view · terminal · hand-off notes",
  },
  {
    label: "Loki",
    title: "Ask in plain words.",
    body: "Chat with Loki by text or voice. Ask what is happening, or say what you want done — it finds the right project and starts the work. You can also reach it from Claude, ChatGPT or Cursor.",
    meta: "Chat · voice · works from other AI apps",
  },
  {
    label: "Control",
    title: "Every project in one place.",
    body: "What is running, what is waiting for you and what just shipped, across all your projects. Pause everything with one button.",
    meta: "Projects · approvals · autopilot on/off",
  },
] as const;

/** Homepage shows the four surfaces a first-time visitor needs. */
export const HOME_PRODUCT_SURFACES = PRODUCT_SURFACES.slice(0, 4);

// Kept as a re-export for existing imports. New public integration surfaces
// should import from config/ecosystem directly.
export { ORANGECAT_INTEGRATION } from "./ecosystem";
