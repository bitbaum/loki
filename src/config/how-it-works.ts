/**
 * /how-it-works — the plain story first, then the machinery.
 *
 * Progressive disclosure: a newcomer stops after "The short version"; a
 * builder keeps reading into "Under the hood". Every technical claim names the
 * real mechanism (checked against the code on 2026-10-01 — see the sources in
 * each comment), and nothing here describes what Loki used to be.
 */

export type HowSection = {
  id: string;
  title: string;
  /** One or two plain sentences — readable without the bullets. */
  lede: string;
  /** Detail for the reader who wants it. */
  points?: string[];
};

export const HOW_IT_WORKS_INTRO = {
  eyebrow: "HOW IT WORKS",
  title: "From a sentence to a site that keeps getting better.",
  lede: "Loki is the place where AI coding agents do your work. You describe what you want; agents build it, check it and put it online; and you — or your visitors — say what should change next.",
} as const;

// ── The short version (for everyone) ────────────────────────────────────────
export const HOW_SHORT: HowSection[] = [
  {
    id: "describe",
    title: "1. You describe it",
    lede: "Add a project and say what it is in a sentence or two — or paste the address of a website you already have and say what should be different.",
    points: [
      "Loki can ask up to five short questions first: who it is for, what problem it solves, why it exists. Every question can be skipped, and “Skip to the build” is always there.",
    ],
  },
  {
    id: "build",
    title: "2. Loki sets it up and puts an agent on it",
    lede: "One button — Make it happen — fills in the project profile, plans the first milestones, creates the code repository and starts an AI coding agent on it. Each step shows as it finishes.",
    points: [
      "It keeps going if you close the page or your phone locks: the work runs on the server, not in your browser.",
      "You can watch the run as a readable thread — what was asked, what the agent is doing, what it changed.",
    ],
  },
  {
    id: "online",
    title: "3. It goes online",
    lede: "When the agent's work passes its checks it is merged and published. A website gets its own address, like yourname.orangecat.ch.",
    points: [
      "Before and after every change, the page is opened on a phone-sized screen. If the change made it worse — it stopped loading, scrolls sideways, throws errors, lost images or most of its text — the previous version is put back.",
    ],
  },
  {
    id: "change",
    title: "4. You say what to change — on the site itself",
    lede: "Every site Loki builds carries a small Loki button. Open your site from Loki, tap the button and say or type what should be different. The change is built and goes online by itself.",
    points: [
      "Notes from visitors land in your Feedback inbox and wait for your OK. Whoever left an email hears back when it is fixed.",
      "Repeating a note that is already being built just says “On it”.",
    ],
  },
];

// ── Under the hood (for builders) ───────────────────────────────────────────
export const HOW_DEEP: HowSection[] = [
  {
    id: "architecture",
    title: "The shape of it",
    lede: "The web app is the control plane: it stores projects, runs and the queue, and never runs an agent itself. Builders do the work and talk to it over outbound HTTPS only.",
    points: [
      // src/lib/inject-core.ts, pending_commands, scripts/box-runner.ts, desktop/src/main/poller.ts
      "A dispatch becomes a queued command. A builder polls for commands it may claim, claims one, launches the agent in a terminal it owns (a PTY), delivers the prompt, and reports back.",
      "State fans out live to every open browser, desktop app and phone through a small event bridge (server-sent events).",
      "Because builders only connect out, a computer running Fleet Runner needs no open port and no inbound firewall rule.",
    ],
  },
  {
    id: "builders",
    title: "Where agents run",
    lede: "Which computer runs a project is a stored setting — Runs on — not a guess from who happens to be online.",
    points: [
      // docs/development/cloud-local-workflows.md, src/lib/execution-access.ts
      "Cloud builder: an always-on server. During the beta it is for invited accounts; repositories it creates live in the bitbaum GitHub organisation.",
      "This computer: Fleet Runner, a desktop app for Linux, Windows and Apple-silicon Macs. Agents use your files, your tools and your own agent subscriptions.",
      "Hosted runner: works from its own copy of the repository and ends every task in a pull request. Lightly used so far.",
      "If the chosen builder is offline, the work waits in the queue where you can see it — it is never quietly sent somewhere else.",
    ],
  },
  {
    id: "agents",
    title: "Which agents",
    lede: "Loki drives the agents' own command-line tools through one adapter each: Claude Code, Codex, Cursor Agent, Antigravity and Grok.",
    points: [
      // src/lib/agents/index.ts, src/lib/agent-resolution.ts, src/lib/provider-switch.ts
      "You choose an agent per project. When it has used up its allowance, Loki can route the run to the next one in your order instead of failing.",
      "The agent's own subscription or API key pays for its model; Loki does not resell model usage.",
      "Before a prompt is sent into a running session, Loki checks the agent is actually at its prompt — a session showing a dialog is cleared or restarted first.",
    ],
  },
  {
    id: "run",
    title: "The life of a run",
    lede: "A run is a record with dated events: dispatched, claimed, launched, delivered, generating, progress, handed off, closed.",
    points: [
      // src/db/schema/run-events.ts, src/lib/feedback/fix-shipping.ts
      "A finished agent turn is not treated as a shipped change. Loki follows the run's pull request to merged and to deployed, and only then calls it live.",
      "A run that goes quiet on a builder that has gone offline says so, instead of showing as working.",
      "When a runner restarts, runs whose agent was already working are closed with the reason straight away.",
    ],
  },
  {
    id: "shipping",
    title: "How changes ship",
    lede: "Every change is a pull request on a real Git repository. Green checks merge it; a merge deploys it.",
    points: [
      // .github/workflows/selfhost-deploy.yml, scripts/hetzner/page-check.mjs, rollback.sh
      "Sites run on one server behind a web server that handles HTTPS. Each deploy is a new release folder; the live site is a pointer to one, so going back is instant.",
      "The deploy waits for the commit's checks to be green, then opens the live page in a headless phone-sized browser before and after shipping. If the page got worse, it rolls back and says why.",
      "Screenshots from that check are kept for 14 days.",
    ],
  },
  {
    id: "feedback",
    title: "The feedback button",
    lede: "One script tag puts it on any site. It lives in its own isolated box (Shadow DOM), so the site's styles cannot break it and it cannot break the site.",
    points: [
      // widget/, src/app/api/feedback/route.ts, src/lib/feedback/owner-pass.ts
      "Modes: request a change, ask Loki about the page (it reads an outline of the page, no screenshots), and chat.",
      "The owner's link carries a signed pass in the part of the address that is never sent to a server. A note sent with it starts the fix straight away — at most 40 a day per site.",
      "Visitor notes never start work on their own. They wait in Feedback for the owner's click.",
    ],
  },
  {
    id: "control",
    title: "Staying in charge",
    lede: "Autopilot is on or off, per project, and one switch pauses everything. With autopilot off, nothing starts on your agent subscriptions unless you — or a note you left on your own site — asked for it.",
    points: [
      "Anything that needs a decision waits in Approvals, which works from a phone.",
      "Loki's own chat runs on free model tiers — open-weight gpt-oss and qwen first, then Google's Gemini — or on your own model key if you add one.",
    ],
  },
  {
    id: "connect",
    title: "Reaching Loki from other AI apps",
    lede: "Loki is an MCP server. Claude, ChatGPT, Claude Code and Cursor can ask it about your projects or start work, after you sign in with OrangeCat.",
    points: [
      // docs/development/mcp.md, src/config/mcp.ts
      "Six tools in two permission levels: reading (ask, list projects, see what waits for approval) and acting (decide, dispatch, book).",
    ],
  },
  {
    id: "open",
    title: "Open source",
    lede: "Loki is MIT-licensed. The code, the changelog and the roadmap are public.",
  },
];
