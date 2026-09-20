import {
  Sun,
  Users,
  Wallet,
  Target,
  FolderKanban,
  Server,
  Zap,
  Calendar,
  Repeat2,
  Bot,
  Terminal,
  SquareTerminal,
  MessageSquare,
  BookOpen,
  Settings,
  Brain,
  Compass,
  Anchor,
  Map,
  TrendingUp,
  FileText,
  Download,
  Newspaper,
  Inbox,
  MessagesSquare,
  Handshake,
  LayoutGrid,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type NavItem = {
  id: string;
  label: string;
  description: string;
  href: string;
  icon: LucideIcon;
  active: boolean;
  /** Show in the mobile bottom tab bar (Today · Control · Loki · Menu) */
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
    mobile: true,
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
    label: "Terminal",
    description: "Type directly into a live agent — cloud or this computer",
    href: "/terminal",
    icon: SquareTerminal,
    active: true,
    mobile: false,
  },
  control: {
    id: "control",
    label: "Control",
    description: "Command deck — live agent status, dispatch work",
    href: "/control",
    icon: Terminal,
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
    description: "Agent prompt library & scheduler",
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
  mission: {
    id: "mission",
    label: "Mission",
    description: "Why we exist",
    href: "/mission",
    icon: Compass,
    active: true,
    mobile: false,
  },
  philosophy: {
    id: "philosophy",
    label: "Philosophy",
    description: "Principles we build by",
    href: "/philosophy",
    icon: Anchor,
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
// Loki is an operator console. Its authenticated surface answers three
// questions, and every sidebar section is exactly one of them:
//
//   1. What needs me?       → Now     (Today, Approvals, Feedback)
//   2. What is my fleet doing? → Fleet   (Control, Projects, Activity, System)
//   3. How do I act on it?  → Command (Loki, Terminal, Prompts)
//
// A page that answers none of those three does not belong in the sidebar.
// That test is what dissolved the old "More" section, whose only membership
// rule was that nobody had decided: it held Approvals (a "needs me" surface),
// Terminal and Prompts (acting), Activity and System (fleet state), Thoughts
// (marketing essays) and Fleet (a PUBLIC marketing register rendered inside
// the signed-in shell). Six unrelated things in one drawer named after the
// absence of a decision.
//
// Two sections sit deliberately OUTSIDE the loop:
//   • Private — the user's own data (people, money, habits …). Already
//     PIN-gated, which was the tell: half the sidebar was a different product.
//   • Account — Settings, appearance, Download, sign out. These are reached
//     from the header account menu, not browsed, so they own no sidebar seat.
//
// The public marketing pages (Mission, Philosophy, Roadmap, Investors,
// Whitepaper, Thoughts, the /fleet register) left the sidebar entirely. They
// stay in NAV so the command palette can still jump to them, and they are
// reachable from the public nav where they belong. "Investors" was in the
// signed-in app navigation; that is the clearest evidence the old taxonomy
// grouped pages by who built them rather than by what an operator does.

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
    id: "now",
    label: "Now",
    question: "What needs me?",
    items: [NAV.today, NAV.approvals, NAV.feedback],
  },
  {
    id: "fleet",
    label: "Fleet",
    question: "What is my fleet doing?",
    // System belongs here and not in a drawer of its own: "what is running"
    // includes the runtime that runs it — gateway, disk, scheduled jobs.
    items: [NAV.control, NAV.projects, NAV.activity, NAV.system],
  },
  {
    id: "command",
    label: "Command",
    question: "How do I act on it?",
    // The same act at three altitudes: say it (Loki), type it (Terminal),
    // or save it to repeat (Prompts).
    items: [NAV.loki, NAV.terminal, NAV.prompts],
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
  NAV.mission,
  NAV.philosophy,
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

export const MOBILE_NAV_ITEMS = NAV_ITEMS.filter((item) => item.mobile);
