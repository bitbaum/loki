import {
  Briefcase,
  Hammer,
  Handshake,
  Repeat2,
  Target,
  Users,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import { NAV } from "./navigation";
import type { SuggestionKind } from "@/lib/suggestions/types";

/**
 * The avenues a suggestion can belong to — SSOT for /suggestions.
 *
 * A person's life has more than one front, and Loki keeps records on several
 * of them: the projects it builds, the people they work with, the money going
 * out, the habits they keep, the goals they set. /suggestions reads all of
 * them and offers one thing to do per fact, so the page is a map of the
 * person's fronts, not a feed. Each avenue states the question it answers and
 * where the records behind it are kept, so an empty avenue is never a dead
 * end: it says what to add and where.
 *
 * `private` avenues read the PIN-gated book (people, money, habits). While the
 * zone is locked they are listed but not loaded, and the page says so.
 */
export type AvenueId = "build" | "business" | "goals" | "people" | "money" | "habits";

export type Avenue = {
  id: AvenueId;
  label: string;
  /** The question this avenue answers, one line. */
  question: string;
  icon: LucideIcon;
  /** Where the records behind it live — the way forward when it is empty. */
  source: { href: string; label: string };
  private: boolean;
};

export const SUGGESTION_AVENUES: readonly Avenue[] = [
  {
    id: "build",
    label: "Build",
    question: "What should the fleet build next?",
    icon: Hammer,
    source: { href: NAV.projects.href, label: "Add a project" },
    private: false,
  },
  {
    id: "business",
    label: "Business",
    question: "Who is waiting on you, and who is asking for what you make?",
    icon: Briefcase,
    source: { href: NAV.crew.href, label: "Open Crew" },
    private: false,
  },
  {
    id: "goals",
    label: "Goals",
    question: "What is due, and what has stalled?",
    icon: Target,
    source: { href: NAV.goals.href, label: "Set a goal" },
    private: false,
  },
  {
    id: "people",
    label: "People",
    question: "Who have you not spoken to in a while?",
    icon: Users,
    source: { href: NAV.people.href, label: "Open People" },
    private: true,
  },
  {
    id: "money",
    label: "Money",
    question: "What is about to be charged?",
    icon: Wallet,
    source: { href: NAV.money.href, label: "Add a subscription" },
    private: true,
  },
  {
    id: "habits",
    label: "Habits",
    question: "What keeps the streak alive today?",
    icon: Repeat2,
    source: { href: NAV.habits.href, label: "Add a habit" },
    private: true,
  },
] as const;

export const AVENUE_BY_ID: Record<AvenueId, Avenue> = Object.fromEntries(
  SUGGESTION_AVENUES.map((a) => [a.id, a]),
) as Record<AvenueId, Avenue>;

/** Every kind a ranker can emit belongs to exactly one avenue. */
export const KIND_AVENUE: Record<SuggestionKind, AvenueId> = {
  fix: "build",
  ship: "build",
  continue: "build",
  idea: "build",
  starter: "build",
  demand: "business",
  crew_review: "business",
  crew_handover: "business",
  deadline: "goals",
  goal: "goals",
  goal_due: "goals",
  event_due: "goals",
  reconnect: "people",
  renewal: "money",
  habit: "habits",
};

/** Icons for the kinds the build row does not know (BuildSuggestions has its own). */
export const LIFE_KIND_ICON: Record<
  "crew_review" | "crew_handover" | "goal_due" | "event_due" | "reconnect" | "renewal" | "habit",
  LucideIcon
> = {
  crew_review: Handshake,
  crew_handover: Handshake,
  goal_due: Target,
  event_due: Target,
  reconnect: Users,
  renewal: Wallet,
  habit: Repeat2,
};
