import {
  House,
  Sun,
  Users,
  Wallet,
  Target,
  FolderKanban,
  Flag,
  Server,
  Zap,
  Calendar,
  Repeat2,
  Bot,
  SquareTerminal,
  MessageSquare,
  Headphones,
  BookOpen,
  Settings,
  Brain,
  Compass,
  Map,
  TrendingUp,
  FileText,
  Download,
  Newspaper,
  Inbox,
  MessagesSquare,
  Handshake,
  LayoutGrid,
  Lightbulb,
  Boxes,
  Cpu,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ORANGECAT_PUBLIC_ORIGIN } from "@/config/orangecat";
import { MODEL_STORE_PATH } from "@/lib/own-model-path";

export type NavItem = {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  active: boolean;
  /** Show in the mobile bottom tab bar (Home · Projects · Loki · More) */
  mobile: boolean;
};

// ─── Individual nav items ─────────────────────────────────────────────────────
// Defined once so SIDEBAR_SECTIONS (groupings) and MOBILE_NAV_ITEMS (filter)
// both consume the same source. Never duplicate an entry.

export const NAV = {
  today: {
    id: "today",
    label: "Today",
    description: "Daily overview & action queue",
    href: "/today",
    icon: Sun,
    active: true,
    mobile: false,
  },
  suggestions: {
    id: "suggestions",
    label: "Suggestions",
    description: "What to do next, across every front — pick one and Loki takes it",
    href: "/suggestions",
    icon: Lightbulb,
    active: true,
    mobile: false,
  },
  loki: {
    id: "loki",
    label: "Loki",
    description: "Say what you want — Loki answers, or builds it with you",
    href: "/loki",
    icon: MessageSquare,
    active: true,
    mobile: true,
  },
  bots: {
    id: "bots",
    label: "Bots",
    description:
      "Your bots on OrangeCat — the Cat, the fleet's specialists and the ones you made, one list; group chats too",
    // The list is OrangeCat's (the bot's face: profile, price, purse); Loki
    // is where a bot's work runs. One list, not two: this opens that one.
    href: `${ORANGECAT_PUBLIC_ORIGIN}/companions/talk`,
    icon: Bot,
    active: true,
    mobile: false,
  },
  voice: {
    id: "voice",
    label: "Voice",
    description: "Talk to Loki with the screen off — it reads the fleet out and listens",
    href: "/voice",
    icon: Headphones,
    active: true,
    mobile: false,
  },
  approvals: {
    id: "approvals",
    label: "Approvals",
    description: "Review & approve actions Loki proposed",
    href: "/approvals",
    icon: Inbox,
    active: true,
    mobile: false,
  },
  terminal: {
    id: "terminal",
    // "Terminal" is the word people look for. It was "Sessions" from
    // 2026-10-19, and on 2026-11-11 the owner, signed in on a phone, could not
    // find the terminal anywhere: no menu said the word.
    label: "Terminal",
    description: "Your agents at work — read one as a chat, or watch its terminal",
    href: "/terminal",
    icon: SquareTerminal,
    active: true,
    mobile: false,
  },
  control: {
    id: "control",
    label: "Home",
    description: "What needs you, what is being built, what got done — and the box to start more",
    href: "/control",
    icon: House,
    active: true,
    mobile: true,
  },
  projects: {
    id: "projects",
    label: "Projects",
    description: "Your project catalog — health, context & goals",
    href: "/projects",
    icon: FolderKanban,
    active: true,
    mobile: true,
  },
  missions: {
    id: "missions",
    label: "Missions",
    description: "Objectives, roadmaps and real execution evidence from your projects",
    href: "/missions",
    icon: Flag,
    active: true,
    mobile: false,
  },
  packages: {
    id: "packages",
    label: "Packages",
    description: "What the fleet is built from — shared packages and who is on which version",
    href: "/packages",
    icon: Boxes,
    active: true,
    mobile: false,
  },
  fleet: {
    id: "fleet",
    label: "Fleet",
    description: "Every project and where it lives — sites, profiles, and the gaps between",
    href: "/fleet",
    icon: LayoutGrid,
    active: true,
    mobile: false,
  },
  feedback: {
    id: "feedback",
    label: "Feedback",
    description: "Visitor & review reports across your fleet — triage and implement",
    href: "/feedback",
    icon: MessagesSquare,
    active: true,
    mobile: false,
  },
  // Not in any menu: reached from a report's mail and from /feedback
  // ("Reports you sent"). Listed so the top bar names it like its siblings —
  // it was the one page with a blank bar (2026-11-12).
  myFeedback: {
    id: "my-feedback",
    label: "My feedback",
    description: "Reports you sent, and where each one is",
    href: "/my-feedback",
    icon: MessagesSquare,
    active: true,
    mobile: false,
  },
  prompts: {
    id: "prompts",
    label: "Prompts",
    description: "Saved instructions for your agents — run one now, or on a schedule",
    href: "/prompts",
    icon: Zap,
    active: true,
    mobile: false,
  },
  activity: {
    id: "activity",
    label: "Activity",
    description: "Project status and event timeline",
    href: "/activity",
    icon: Newspaper,
    active: true,
    mobile: false,
  },
  system: {
    id: "system",
    label: "System",
    description: "Runtime health & scheduled jobs",
    href: "/system",
    icon: Server,
    active: true,
    mobile: false,
  },

  memory: {
    id: "memory",
    label: "Memory",
    description: "Knowledge graph & entity activity",
    href: "/memory",
    icon: Brain,
    active: true,
    mobile: false,
  },
  thoughts: {
    id: "thoughts",
    label: "Thoughts",
    description: "Essays on architecture & systems",
    href: "/thoughts",
    icon: BookOpen,
    active: true,
    mobile: false,
  },

  people: {
    id: "people",
    label: "People",
    description: "Your private address book — every user has their own",
    href: "/people",
    icon: Users,
    active: true,
    mobile: false,
  },
  robots: {
    id: "robots",
    label: "Robots",
    description: "Machines you own — profile, book, rent, or sell",
    href: "/robots",
    icon: Bot,
    active: true,
    mobile: false,
  },
  crew: {
    id: "crew",
    label: "Crew",
    description: "Humans in the loop — assign the work an agent can't do",
    href: "/crew",
    icon: Handshake,
    active: true,
    mobile: false,
  },
  goals: {
    id: "goals",
    label: "Goals",
    description: "Active goals & milestones",
    href: "/goals",
    icon: Target,
    active: true,
    mobile: false,
  },
  habits: {
    id: "habits",
    label: "Habits",
    description: "Daily streaks & 30-day heatmap",
    href: "/habits",
    icon: Repeat2,
    active: true,
    mobile: false,
  },
  events: {
    id: "events",
    label: "Events",
    description: "Deadlines & opportunities",
    href: "/events",
    icon: Calendar,
    active: true,
    mobile: false,
  },
  money: {
    id: "money",
    label: "Money",
    description: "Subscriptions & monthly burn",
    href: "/money",
    icon: Wallet,
    active: true,
    mobile: false,
  },

  download: {
    id: "download",
    label: "Download",
    description: "Get Fleet Runner for your machine",
    href: "/download",
    icon: Download,
    active: true,
    mobile: false,
  },
  // /mission and /philosophy merged into /why (2026-10-01).
  why: {
    id: "why",
    label: "Why Loki",
    description: "What it is for, and the rules it keeps",
    href: "/why",
    icon: Compass,
    active: true,
    mobile: false,
  },
  roadmap: {
    id: "roadmap",
    label: "Roadmap",
    description: "Product direction",
    href: "/roadmap",
    icon: Map,
    active: true,
    mobile: false,
  },
  investors: {
    id: "investors",
    label: "Investors",
    description: "For investors",
    href: "/investors",
    icon: TrendingUp,
    active: true,
    mobile: false,
  },
  whitepaper: {
    id: "whitepaper",
    label: "Whitepaper",
    description: "Technical architecture",
    href: "/whitepaper",
    icon: FileText,
    active: true,
    mobile: false,
  },

  // Not in any menu: Settings → AI opens it ("Compare providers and prices").
  // Listed so the phone's top bar names the page and the palette finds it.
  models: {
    id: "models",
    label: "Models",
    description: "Every model, what it costs, and who you pay",
    href: MODEL_STORE_PATH,
    icon: Cpu,
    active: true,
    mobile: false,
  },
  settings: {
    id: "settings",
    label: "Settings",
    description: "Profile & team management",
    href: "/settings",
    icon: Settings,
    active: true,
    mobile: false,
  },
} satisfies Record<string, NavItem>;

// ─── Sidebar sections — SSOT for sidebar groupings ────────────────────────────
//
// Grouped by THING, not by question. Until 2026-10-19 the sections were three
// operator questions — Now ("what needs me?"), Fleet, Command — and a person
// looking for the terminal had to know it "commands". People look for pages
// by what they are about:
//   • Build — the work: Home, Projects, Sessions (each agent's session, read
//     as a chat or as its terminal), and the saved prompts you send them.
//   • Loki — the assistant: talk to it, by voice too, your day as it keeps
//     it, and what it suggests next.
//   • To review — what waits for your yes.
//   • The fleet — the plumbing.
//   • Private — the PIN-locked book.
// The phone's bottom bar carries the three you open daily — Home, Projects,
// Loki — and "More" opens the rest, in these sections. Every section keeps at
// least two entries on the phone too: a heading over one row (it was "Your
// day" over Today alone, and "Build" over Terminal alone) reads as a menu
// that lost its contents (owner, 2026-10-19).
//
// Two sections sit deliberately OUTSIDE the sidebar:
//   • Account — Settings, appearance, Download, sign out. These are reached
//     from the header account menu, not browsed, so they own no sidebar seat.
//   • The public marketing pages (Why, Roadmap, Investors, Whitepaper,
//     Thoughts, the /fleet register). They stay in NAV so the command palette
//     can still jump to them, and live in the public nav where they belong.

export type SidebarSection = {
  id: string;
  label: string;
  items: NavItem[];
  /** One line: which of the operator's questions this section answers. */
  question: string;
  /** Hidden behind the PIN gate when configured + locked. */
  private?: boolean;
  /** No header, never folded: the items stand on their own (the first four). */
  bare?: boolean;
  /** Folded until opened: there when wanted, not read every day. */
  foldedByDefault?: boolean;
};

export const SIDEBAR_SECTIONS: SidebarSection[] = [
  // Four words, and the same four on the phone's bottom bar: a person's
  // questions, not the product's kinds. Loki first — it is the default
  // screen (config/auth.ts APP_HOME): the owner's own call, 2026-11-01,
  // "a good Loki chat … accessible really easy … the default screen that
  // opens when people open the app, while they still are able to easily
  // go and navigate". The sections used to be Build / Loki / To review /
  // The fleet / Private, by kind of thing — and a newcomer does not know
  // the kinds yet.
  {
    id: "now",
    label: "Loki",
    question: "Say it, see it, build it.",
    bare: true,
    items: [NAV.loki, NAV.control, NAV.projects],
  },
  // Everything else, folded until opened, in groups that each say the
  // question they answer — never a drawer called More, which is where
  // undecided pages went to rot once (scripts/test/navigation.ts). Each
  // page still exists at its address, and says what it is for on hover.
  {
    id: "waiting",
    label: "Waiting for you",
    question: "What is waiting for my yes?",
    foldedByDefault: true,
    items: [NAV.approvals, NAV.feedback],
  },
  {
    id: "day",
    label: "Your day",
    question: "What now, beyond the box — the day, and what is worth doing next.",
    foldedByDefault: true,
    items: [NAV.today, NAV.suggestions],
  },
  {
    id: "talk",
    label: "Other ways to talk",
    // Bots open the one list on OrangeCat (the bot's face is OrangeCat's,
    // its work is Loki's; one list, not two — #1495).
    question: "Loki out loud, and the bots you talk to.",
    foldedByDefault: true,
    items: [NAV.voice, NAV.bots],
  },
  {
    id: "across",
    label: "Across your projects",
    question: "What is every project doing, and what do I tell the agents?",
    foldedByDefault: true,
    items: [NAV.terminal, NAV.missions, NAV.activity, NAV.prompts],
  },
  {
    id: "hood",
    label: "Under the hood",
    question: "What is it all built on, and is it well?",
    foldedByDefault: true,
    items: [NAV.packages, NAV.system],
  },
  {
    id: "private",
    label: "Private",
    question: "My own data.",
    private: true,
    items: [
      NAV.memory,
      NAV.people,
      NAV.crew,
      NAV.robots,
      NAV.goals,
      NAV.habits,
      NAV.events,
      NAV.money,
    ],
  },
];

// ─── Account menu — SSOT for the header account dropdown ─────────────────────
// Identity-scoped destinations. They are NOT sidebar items: you do not browse
// to your own settings, you reach them from your own avatar. Sign out and the
// private-zone lock live in the menu component itself because they are
// actions, not destinations.
export const ACCOUNT_NAV_ITEMS: NavItem[] = [NAV.settings, NAV.download];

// ─── Marketing pages ─────────────────────────────────────────────────────────
// Public surface. Not in the sidebar; kept here so the command palette can
// reach them and so there is one list to render the public nav from.
export const SITE_NAV_ITEMS: NavItem[] = [
  NAV.why,
  NAV.roadmap,
  NAV.thoughts,
  NAV.whitepaper,
  NAV.investors,
  NAV.fleet,
  NAV.download,
];

// Flat list of every reachable destination — the command palette's index and
// the "which page am I on?" lookup used by AppTopBar and PageTitle.
//
// Derived from NAV itself, NOT from SIDEBAR_SECTIONS. Curating the sidebar
// must never make a page unfindable: Cmd-K still reaches Whitepaper even
// though no operator needs a sidebar seat for it. Retired redirect stubs
// (the old `agents` → /control and `atlas` → /projects entries) were deleted
// rather than hidden — left in this list they shadowed the real pages, and
// AppTopBar would have titled /control "Agents".
export const NAV_ITEMS: NavItem[] = Object.values(NAV);

// ─── Fleet workspace tabs ─────────────────────────────────────────────────────
// These are four views of the same active project. The catalog stays the fleet
// index; a project profile is the persistent context beside the three execution
// surfaces. FleetSurfaceGuide preserves the project between every view.
export const FLEET_SURFACES = [
  { id: "profile", href: NAV.projects.href, label: "Profile" },
  { id: "chat", href: NAV.loki.href, label: "Chat" },
  { id: "control", href: NAV.control.href, label: NAV.control.label },
  { id: "terminal", href: NAV.terminal.href, label: NAV.terminal.label },
] as const;

/**
 * The places named on the phone's chat screen, where the tab bar is hidden
 * (useImmersiveChat): in its menu and at the top of its chats panel. One list,
 * so the two ways out of the chat cannot name different places.
 */
export const CHAT_PLACES: NavItem[] = [NAV.control, NAV.projects, NAV.terminal];

// Explicit order: what you open first is first.
export const MOBILE_NAV_ITEMS: NavItem[] = [NAV.loki, NAV.control, NAV.projects];
