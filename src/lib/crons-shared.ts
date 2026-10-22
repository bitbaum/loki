import { z } from "zod";
import { cronProblem, describeCron } from "@/lib/cron-words";

/**
 * User-facing display name for scheduled cron jobs. Internally these remain
 * "cron jobs" (table cron_jobs, /api/crons) — the UI calls them "Scheduled Jobs"
 * so the word "Autopilot" belongs to ONE thing only: the auto-inject engine (the
 * fleet Build all/Pause all toggle). SSOT for every heading/label that names this
 * feature. Prose sentences use the lowercase noun "scheduled job(s)".
 */
export const SCHEDULED_JOBS_LABEL = "Runs on a schedule";

export const CreateCronBody = z.object({
  name: z.string().trim().min(1, "name is required"),
  // A line the scheduler cannot read is refused here, in words, rather than
  // stored and never run.
  scheduleExpr: z
    .string()
    .trim()
    .min(1, "scheduleExpr is required")
    .superRefine((expr, ctx) => {
      const problem = cronProblem(expr);
      if (problem) ctx.addIssue({ code: "custom", message: problem });
    }),
  message: z.string().trim().min(1, "message is required"),
  model: z.string().optional(),
  timeoutSeconds: z.number().optional(),
  tz: z.string().optional(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
});

export const PatchCronBody = z.object({
  id: z.string().min(1, "id is required"),
  enabled: z.boolean().optional(),
  message: z.string().optional(),
  projectId: z.string().optional(),
  projectName: z.string().optional(),
});

export const RunCronBody = z.object({
  id: z.string().uuid("Invalid job id"),
});

export type CreateCronJobBody = z.infer<typeof CreateCronBody>;
export type PatchCronJobBody = z.infer<typeof PatchCronBody>;

/** Mirrors the openclaw cron job schema. Loki-specific fields are optional. */
export type CronJob = {
  id: string;
  agentId: string;
  name: string;
  enabled: boolean;
  schedule: { kind: string; expr: string; tz: string };
  sessionTarget: string;
  wakeMode: string;
  payload: {
    kind: string;
    message: string;
    timeoutSeconds: number;
    thinking: string;
    model: string;
  };
  delivery: {
    mode: string;
    channel: string;
    to: string;
    bestEffort: boolean;
  };
  state: {
    lastRunAtMs?: number;
    lastStatus?: string;
    lastRunStatus?: string;
    lastDurationMs?: number;
    consecutiveErrors?: number;
    lastError?: string;
    lastErrorReason?: string;
    lastDelivered?: string;
    lastDeliveryStatus?: string;
    nextRunAtMs?: number;
  };
  createdAtMs: number;
  updatedAtMs: number;
  projectId?: string;
  projectName?: string;
};

const CRON_LABELS: Record<string, { compact: string; verbose: string }> = {
  "0 6 * * *": { compact: "Daily 6:00", verbose: "Daily at 6:00" },
  "0 20 * * 5": { compact: "Fri 20:00", verbose: "Every Friday at 20:00" },
  "0 20 * * 0-4": { compact: "Sun-Thu 20:00", verbose: "Sun-Thu at 20:00" },
  "30 3 * * *": { compact: "Daily 3:30", verbose: "Daily at 3:30" },
  "0 9 * * 1": { compact: "Mon 9:00", verbose: "Every Monday at 9:00" },
  "0 4 * * 0": { compact: "Sun 4:00", verbose: "Every Sunday at 4:00" },
  "0 7,11,15,19 * * *": { compact: "4x daily", verbose: "4x daily (7, 11, 15, 19)" },
  "0 10 * * 4": { compact: "Thu 10:00", verbose: "Every Thursday at 10:00" },
  "0 9 1 * *": { compact: "Monthly 1st", verbose: "1st of every month at 9:00" },
};

export function humanCronSchedule(expr: string, tz?: string): string {
  const entry = CRON_LABELS[expr];
  if (tz) return `${entry?.verbose ?? describeCron(expr) ?? expr} (${tz})`;
  return entry?.compact ?? expr;
}
