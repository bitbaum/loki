import type { Milestone } from "@/db/schema/goals";
import type { DevLogEntry, ProjectResource } from "@/db/schema/user-projects";
import type { ProjectActivityEvent } from "@/db/queries/activity";
export type { DevLogEntry, ProjectResource };
// The project profile's activity feed is the unified activity read-model SSOT
// (prompts + run outcomes + lifecycle), the same type the /control panel uses.
export type { ProjectActivityEvent };

// ─── Health Signal Config (base — no Lucide icons, safe to import anywhere) ──

export type HealthSignalKind = "security" | "broken" | "deployment";

export type HealthSignalBase = {
  kind: HealthSignalKind;
  key: string;
  label: string;
  cardLabel: string;
  /** The "nothing is wrong" phrasing, for the health breakdown. Machine-built
   *  from `label` it produced "No broken" / "No open broken recorded." — a
   *  sentence with the noun missing, shown to every reader of a project. The
   *  plural and the noun differ per signal, so they are written, not derived. */
  clearLabel: string;
  /** The check's rule, in words, shown under it in the health panel.
   *  Written per signal for the SAME reason clearLabel is: deriving it from
   *  `label` produced "Passes while no broken is recorded on this project."
   *  — a sentence with its noun missing, on every project. clearLabel was
   *  fixed for that and this field was missed, so the bug survived in the
   *  line directly beneath the one that had been repaired. */
  clearRule: string;
  badgeCls: string;
  cardBorder: string;
  cardBg: string;
  cardText: string;
  cardBody: string;
};

/** Single source of truth for health signal metadata. Icons are added in project-badges.tsx. */
export const HEALTH_SIGNAL_BASE: HealthSignalBase[] = [
  {
    kind: "security",
    key: "security_vulnerability",
    label: "Security risk",
    cardLabel: "Security Risk",
    clearLabel: "No security risks open",
    clearRule: "Passes while no security risk is recorded on this project.",
    badgeCls: "bg-status-negative-subtle text-status-negative border-status-negative/25",
    cardBorder: "border-status-negative/25",
    cardBg: "bg-status-negative-subtle",
    cardText: "text-status-negative",
    cardBody: "text-status-negative/70",
  },
  {
    kind: "broken",
    key: "broken_features",
    label: "Broken",
    cardLabel: "Broken Features",
    clearLabel: "No broken features",
    clearRule: "Passes while no broken feature is recorded on this project.",
    badgeCls: "bg-status-warning-subtle text-status-warning border-status-warning/25",
    cardBorder: "border-status-warning/25",
    cardBg: "bg-status-warning-subtle",
    cardText: "text-status-warning",
    cardBody: "text-status-warning/70",
  },
  {
    kind: "deployment",
    key: "deployment_issue",
    label: "Deploy issue",
    cardLabel: "Deployment Issue",
    clearLabel: "No deploy issues open",
    clearRule: "Passes while no deploy issue is recorded on this project.",
    badgeCls: "bg-status-warning-subtle text-status-warning border-status-warning/25",
    cardBorder: "border-status-warning/25",
    cardBg: "bg-status-warning-subtle",
    cardText: "text-status-warning",
    cardBody: "text-status-warning/70",
  },
];

export type LinkedGoal = {
  id: string;
  title: string;
  description: string | null;
  status: string | null;
  progress: number | null;
  targetDate: string | null;
  milestones: Milestone[] | null;
};

export type LinkedJob = {
  id: string;
  name: string;
  message: string;
  enabled: boolean;
  schedule: string;
  lastStatus?: string;
  consecutiveErrors?: number;
};

export type ProjectData = {
  id: string;
  name: string;
  type: string;
  description: string | null;
  gitUrl: string | null;
  dirPath: string | null;
  source: string | null;
  createdAt: string | null;
  readonly?: boolean;
  attrs: Record<string, string>;
  relations: Array<{
    type: string;
    strength: number | null;
    targetId: string;
    targetName: string;
    targetType: string;
  }>;
  interactions: Array<{
    channel: string;
    direction: string;
    summary: string | null;
    occurredAt: string;
  }>;
  linkedJobs: LinkedJob[];
  linkedGoals: LinkedGoal[];
  resources: ProjectResource[];
  notes: string | null;
  devLog: DevLogEntry[];
  activity: ProjectActivityEvent[];
  runtimeState: ProjectRuntimeState | null;
};

export type ProjectRuntimeState = {
  tabName: string;
  readyAt: string | null;
  closingAt: string | null;
  closedAt: string | null;
  currentPromptLabel: string | null;
  currentPromptStartedAt: string | null;
  sessionUpdatedAt: string | null;
};

/**
 * Resolve project quick-link attrs into ready-to-use href strings.
 * Single source of truth for which attrs feed each link plus the
 * "bare host → https://, bare slug → https://github.com/" prefixing.
 *
 * `gitUrl` is the first-class entities.git_url column populated by the
 * GitHub-import + cloud-bootstrap flows (introduced 2026-06-05). It
 * overrides legacy `attrs.repo` when both are set — entity column wins.
 */
export function getProjectLinks(
  attrs: Record<string, string>,
  gitUrl?: string | null,
  liveUrl?: string | null,
): {
  prodUrl: string | null;
  repo: string | null;
} {
  const prod = liveUrl || attrs["production_url"] || attrs["url"];
  const attrRepo = attrs["repo"] ?? attrs["github_repo"];
  const repo = gitUrl || attrRepo;
  return {
    prodUrl: prod ? (prod.startsWith("http") ? prod : `https://${prod}`) : null,
    repo: repo ? (repo.startsWith("http") ? repo : `https://github.com/${repo}`) : null,
  };
}
