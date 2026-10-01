/**
 * /compare — how Loki sits next to the tools people actually use.
 *
 * Every row was read from the vendor's own page on CHECKED_ON (research notes:
 * the 2026-10-01 marketing sweep). Prices are deliberately absent: they change
 * monthly and a stale price is a false claim. Anything a vendor page did not
 * state is "—", never a guess. When a row changes, re-read its source and bump
 * CHECKED_ON; scripts/test/compare-page.ts fails a row without a source.
 */

export const COMPARE_CHECKED_ON = "2026-10-01";

export type CompareRow = {
  name: string;
  /** Where the agent does the work. */
  runs: string;
  /** How you hand it work. */
  handoff: string;
  /** Does it open pull requests (reviewable changes) on your repository? */
  prs: string;
  /** Does it put the result online for you? */
  hosts: string;
  /** The vendor page this row was read from. */
  source: string;
};

export type CompareGroup = {
  title: string;
  lede: string;
  rows: CompareRow[];
};

export const COMPARE_GROUPS: CompareGroup[] = [
  {
    title: "AI coding agents",
    lede: "One company's agent that writes code. Loki runs several of these for you — it is not one of them.",
    rows: [
      {
        name: "Claude Code (Anthropic)",
        runs: "Your computer, or Anthropic's cloud",
        handoff: "Terminal, editor, desktop, web, phone, Slack, GitHub",
        prs: "Yes",
        hosts: "No",
        source: "https://code.claude.com/docs/en/overview",
      },
      {
        name: "Codex (OpenAI)",
        runs: "Your computer, or OpenAI's cloud",
        handoff: "Terminal, editor, desktop, web, phone, GitHub, Slack",
        prs: "Yes",
        hosts: "No",
        source: "https://learn.chatgpt.com/docs",
      },
      {
        name: "Cursor cloud agents",
        runs: "Cursor's cloud (or your editor)",
        handoff: "Desktop, web, phone, Slack, GitHub, Linear",
        prs: "Yes",
        hosts: "No",
        source: "https://cursor.com/docs/cloud-agent",
      },
      {
        name: "GitHub Copilot cloud agent",
        runs: "GitHub's cloud",
        handoff: "Assign it an issue, or mention @copilot",
        prs: "Yes",
        hosts: "No",
        source:
          "https://docs.github.com/en/copilot/concepts/agents/coding-agent/about-coding-agent",
      },
      {
        name: "Devin (Cognition)",
        runs: "Devin's cloud",
        handoff: "Web, Slack, Teams, Jira, Linear",
        prs: "Yes",
        hosts: "No",
        source: "https://docs.devin.ai/get-started/devin-intro",
      },
      {
        name: "Antigravity (Google)",
        runs: "Your computer",
        handoff: "Desktop app, terminal",
        prs: "—",
        hosts: "No",
        source:
          "https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/",
      },
      {
        name: "Grok Build (xAI)",
        runs: "Your computer (beta)",
        handoff: "Terminal",
        prs: "—",
        hosts: "No",
        source: "https://x.ai/news/grok-build-cli",
      },
      {
        name: "Muse Code (Meta)",
        runs: "Your computer",
        handoff: "Terminal",
        prs: "—",
        hosts: "No",
        source: "https://dev.meta.ai/resources/blog/build-with-muse-code/",
      },
    ],
  },
  {
    title: "App builders",
    lede: "Describe an app in the browser and get a hosted result. The closest to what Loki does for a newcomer — inside their own hosting.",
    rows: [
      {
        name: "Lovable",
        runs: "Lovable's cloud",
        handoff: "Chat in the browser",
        prs: "Syncs to GitHub",
        hosts: "Yes",
        source: "https://docs.lovable.dev/introduction/welcome",
      },
      {
        name: "Bolt",
        runs: "In the browser / Bolt's cloud",
        handoff: "Chat in the browser",
        prs: "Exports to GitHub",
        hosts: "Yes",
        source: "https://support.bolt.new/",
      },
      {
        name: "Replit Agent",
        runs: "Replit's cloud",
        handoff: "Chat in the browser or app",
        prs: "—",
        hosts: "Yes",
        source: "https://docs.replit.com/replitai/agent",
      },
      {
        name: "v0 (Vercel)",
        runs: "Vercel's cloud",
        handoff: "Chat in the browser",
        prs: "Yes",
        hosts: "Yes",
        source: "https://v0.app/docs",
      },
    ],
  },
  {
    title: "Open, self-hosted agents",
    lede: "Free software you run yourself. Like Loki, the work can stay on hardware you control.",
    rows: [
      {
        name: "Hermes Agent (Nous Research)",
        runs: "Your computer or your server",
        handoff: "Terminal and chat apps (Telegram, Slack, …)",
        prs: "—",
        hosts: "No",
        source: "https://hermes-agent.nousresearch.com/docs",
      },
      {
        name: "OpenClaw",
        runs: "Your computer",
        handoff: "Chat apps (WhatsApp, Telegram, Slack, …)",
        prs: "—",
        hosts: "No",
        source: "https://openclaw.ai",
      },
      {
        name: "OpenHands",
        runs: "Your computer, their cloud, or your server",
        handoff: "Browser, terminal, Slack, Jira",
        prs: "—",
        hosts: "No",
        source: "https://docs.openhands.dev/overview/introduction",
      },
      {
        name: "Aider",
        runs: "Your computer",
        handoff: "Terminal",
        prs: "No (commits locally)",
        hosts: "No",
        source: "https://aider.chat/",
      },
    ],
  },
];

/** Loki's own row, from this repository's code (checked the same day). */
export const COMPARE_LOKI_ROW: Omit<CompareRow, "source"> = {
  name: "Loki",
  runs: "Its cloud builder (invited accounts during the beta), or your computer with Fleet Runner",
  handoff:
    "Describe it in Loki, chat or voice, the Loki button on your own site, or another AI app",
  prs: "Yes",
  hosts: "Yes — websites at <name>.orangecat.ch",
};

/** What Loki does that the rows above do not, stated narrowly. */
export const COMPARE_DIFFERENCES = [
  {
    title: "It runs the agents — it is not one.",
    body: "Claude Code, Codex, Cursor, Antigravity and Grok each plug in. A project is not tied to one company's model, limits or outage: when one agent has used up its allowance, Loki can hand the work to the next.",
  },
  {
    title: "It owns the whole loop.",
    body: "From a description to a real repository, a deployed site and a feedback button on that site that turns the next note into the next change — and every change is checked on a phone-sized screen and undone if it made things worse.",
  },
  {
    title: "Your computer or ours.",
    body: "Agents can work on your own machine with your own subscriptions, or on an always-on server. Which one is a setting you choose per project, not a guess.",
  },
  {
    title: "Open source.",
    body: "Loki is MIT-licensed — read it, run it, change it.",
  },
] as const;

/** Where the others are better. Said on the page, because it is true. */
export const COMPARE_HONEST = [
  "App builders like Lovable, Bolt, Replit and v0 are more polished for a first-time builder and need nothing installed. Loki's cloud builder is invite-only during the beta; without it you install Fleet Runner and an agent.",
  "The big agents give every user their own isolated cloud machine. Loki's cloud builder is one shared server.",
  "Each company ships new features in its own agent first; Loki gets them by running that same agent, sometimes later.",
  "Cursor, Copilot, Devin and Codex take work straight from Slack, Linear or Jira. Loki's doors are its own app, chat, the feedback button and other AI apps.",
  "They have large teams, support contracts and long track records. Loki is a beta.",
] as const;
