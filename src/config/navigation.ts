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
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

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
    description: "Talk to your fleet — ask or dispatch in plain language",
    href: "/loki",
    icon: MessageSquare,
    active: true,
    mobile: true,
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
    label: "Sessions",
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
};

export const SIDEBAR_SECTIONS: SidebarSection[] = [
  {
    id: "build",
    label: "Build",
    question: "What am I building?",
    items: [NAV.control, NAV.missions, NAV.projects, NAV.terminal, NAV.prompts],
  },
  {
    id: "ask",
    label: "Loki",
    question: "What does Loki know and suggest?",
    items: [NAV.loki, NAV.voice, NAV.today, NAV.suggestions],
  },
  {
    id: "review",
    label: "To review",
    question: "What is waiting for my yes?",
    // Home lists these as they arrive; each also has a page of its own.
    items: [NAV.approvals, NAV.feedback],
  },
  {
    id: "fleet",
    label: "The fleet",
    question: "What is it all built on?",
    // The plumbing: rarely visited, there when something is off.
    items: [NAV.packages, NAV.activity, NAV.system],
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

// Explicit order: what you open first is first.
export const MOBILE_NAV_ITEMS: NavItem[] = [NAV.control, NAV.projects, NAV.loki];
