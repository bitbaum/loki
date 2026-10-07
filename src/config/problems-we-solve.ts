import { ROUTES } from "./auth";
import { COMMISSION } from "./commission";

/**
 * "What it solves" — the homepage's answer to "what is this actually for?"
 *
 * Each card is a situation in the words of the person in it, then what
 * happens in Loki, then ONE link to the page where that happens. Two groups:
 * what a person (or a small team) runs into this month, and what small
 * organisations, communities and the public run into together.
 *
 * Honesty rule: every `solution` describes something that works TODAY, and
 * was checked against the code it names (see the comment on each card). A
 * roadmap item does not belong here, Loki does not render video, music or
 * prose (that is OrangeCat's Studio — config/ecosystem.ts), and nothing an
 * agent does reaches the real world without the owner's say-so.
 *
 * Links go only to pages a signed-out visitor can open: public pages, a
 * section of /how-it-works (an id from config/how-it-works.ts), or sign-up.
 * scripts/test/problems-we-solve.ts pins all of it — a renamed section fails
 * that test instead of leaving a link that lands at the top of the page.
 */

/** A link into one section of /how-it-works. The test checks the id exists. */
const howItWorks = (id: string) => `/how-it-works#${id}`;

type ProblemCard = {
  id: string;
  /** The situation, in the words of the person in it. */
  problem: string;
  /** What happens in Loki — concretely, who does what. */
  solution: string;
  link: { label: string; href: string };
};

type ProblemScale = {
  id: "you" | "everyone";
  title: string;
  subtitle: string;
  items: readonly ProblemCard[];
};

export const PROBLEMS_SECTION = {
  eyebrow: "WHAT IT SOLVES",
  title: "Real problems, small and large.",
  lede: "In each of these you say what you want in plain words. AI agents do the work, you see what they changed, and you decide what goes online.",
  closer: {
    text: "Don’t see yours? Describe it when you start a project — Loki asks a few short questions, and every one of them can be skipped.",
    /** Honest about who has the cloud builder today — see WHERE_IT_RUNS. */
    note: "During the beta the agents run on the cloud builder for invited accounts, or on your own computer with the free Fleet Runner app.",
  },
} as const;

export const PROBLEM_SCALES: readonly ProblemScale[] = [
  {
    id: "you",
    title: "For you",
    subtitle: "What one person, or a small team, runs into this month.",
    items: [
      {
        // Make it happen: src/lib/project-kickoff.ts; site at <name>.orangecat.ch
        id: "idea-no-code",
        problem: "“I know exactly what I want built, but I can’t write code.”",
        solution:
          "Describe it in a sentence or two. Loki sets up the project, puts an AI coding agent on it and publishes the result — a website gets its own address, like yourname.orangecat.ch.",
        link: { label: "Start a project", href: ROUTES.SIGN_UP },
      },
      {
        // /change → WebsiteChangeBrief, WEBSITE_MODES.refresh in config/commission.ts
        id: "outdated-site",
        problem: "“My website is out of date, and the person who built it moved on.”",
        solution:
          "Give Loki the address and say what should be different — typed or spoken. An agent builds a new version. Your live site is not touched — you review the new version first.",
        link: { label: "Start from your website", href: COMMISSION.path },
      },
      {
        // Owner pass in the widget: src/lib/feedback/owner-pass.ts, HOW_SHORT "change"
        id: "small-changes-wait",
        problem: "“Every small change to my site means an email, a quote and a week.”",
        solution:
          "Open your site from Loki, tap the Loki button and say what to change. An agent makes the change and it goes online by itself, checked on a phone-sized screen on the way.",
        link: { label: "See how changes work", href: howItWorks("change") },
      },
      {
        // src/lib/agents/index.ts, src/lib/provider-switch.ts
        id: "too-many-agents",
        problem: "“I pay for several AI coding tools and lose track of which one is doing what.”",
        solution:
          "Run Claude Code, Codex, Cursor, Antigravity and Grok across all your projects from one place. When one has used up its allowance, the run can move to the next one in your order.",
        link: { label: "Which agents", href: howItWorks("agents") },
      },
      {
        // Crew: config/crew.ts (draft → hand over), app/share/task/[token] (no account)
        id: "needs-a-person",
        problem: "“Part of the job needs a person — a phone call, a signature, a visit.”",
        solution:
          "Write the task down and hand it to someone with a link. They accept, decline or deliver from that link, no account needed, and any fee is written on the task so both of you see the terms.",
        link: { label: "Create an account", href: ROUTES.SIGN_UP },
      },
      {
        // Money: app/(app)/(private)/money — calculateMonthlyBurn, nextChargeDate
        id: "what-it-costs",
        problem: "“I don’t know what all these tools cost me each month.”",
        solution:
          "Keep every subscription in one list. Loki adds up your monthly total per currency and shows which charge comes next, so nothing renews without you noticing.",
        link: { label: "Create an account", href: ROUTES.SIGN_UP },
      },
    ],
  },
  {
    id: "everyone",
    title: "For everyone",
    subtitle: "What small organisations, communities and the public run into together.",
    items: [
      {
        // /change — the same flow, for a club, an association or a shop
        id: "small-orgs-locked-out",
        problem:
          "A club, a charity or a corner shop has a website nobody left behind knows how to change.",
        solution:
          "Whoever is there now names the site and says what it needs. The work lives in a real code repository with every change recorded, so the next volunteer does not start from zero.",
        link: { label: "Start from a website", href: COMMISSION.path },
      },
      {
        // /take → TakeRepoBrief
        id: "open-source-out-of-reach",
        problem:
          "Good open-source software is free to take, but only people who code can set it up.",
        solution:
          "Pick a project and say what your copy should be. Agents copy the code into a project of your own, give it your name and look, and show you the result before anything runs.",
        link: { label: "Make it yours", href: "/take" },
      },
      {
        // .github/workflows/selfhost-deploy.yml, scripts/hetzner/page-check.mjs
        id: "broken-on-phones",
        problem: "Sites quietly break on phones — and many people only have a phone to reach them.",
        solution:
          "Every site Loki puts online is opened on a phone-sized screen before and after each change. If the page got worse, the previous version goes back and Loki says why.",
        link: { label: "How changes ship", href: howItWorks("shipping") },
      },
      {
        // widget/, src/app/api/feedback/route.ts — reporter notified on fix
        id: "nobody-hears-back",
        problem: "People report what is broken, never hear back, and stop reporting.",
        solution:
          "One line puts a feedback button on any site. Notes land in the owner’s inbox and wait for their OK, and whoever left an email hears back when it is fixed.",
        link: { label: "The feedback button", href: "/docs/feedback-widget" },
      },
      {
        // Autopilot switch + Approvals: HOW_DEEP "control"
        id: "ai-without-oversight",
        problem: "AI that acts on its own, with nobody answering for what it did.",
        solution:
          "Autopilot is a switch per project, and one switch pauses everything. Anything that needs a decision waits for a person in Approvals — from a phone — and every change is a recorded pull request, not a silent edit.",
        link: { label: "Staying in charge", href: howItWorks("control") },
      },
      {
        // LICENSE (MIT), HOW_DEEP "agents" + "open"
        id: "locked-to-one-vendor",
        problem: "Building with AI means betting on one company’s tools and prices.",
        solution:
          "Loki is open source under the MIT licence and works with agents from five different makers. Its own chat runs on open-weight models, or on your own key.",
        link: { label: "Open source", href: howItWorks("open") },
      },
    ],
  },
];
