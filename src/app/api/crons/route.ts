import { NextRequest, NextResponse } from "next/server";
import { isSiteOperator } from "@/db/queries/users";
import { type CronJob, CreateCronBody, PatchCronBody } from "@/lib/crons";
import { readJsonBody } from "@/lib/api/route-helpers";
import { getSessionUserId } from "@/lib/session";
import { getUserPreferences, getActiveTimezone } from "@/db/queries/user-preferences";
import { TELEGRAM_CHAT_ID } from "@/lib/constants";
import {
  insertCronJob,
  listCronJobsForUser,
  updateCronJobForUser,
  getCronJobRowByOpenclawId,
} from "@/db/queries/cron-jobs";

export type { CronJob };

export async function GET() {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    const jobs = await listCronJobsForUser(userId);
    return NextResponse.json({ jobs });
  } catch (e) {
    return NextResponse.json({ jobs: [], error: String(e) });
  }
}

export async function POST(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, CreateCronBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { name, scheduleExpr, message, model, timeoutSeconds, tz, projectId, projectName } =
    dataOrResp;

  const prefs = await getUserPreferences(userId).catch(() => null);
  const defaultTz = getActiveTimezone(prefs);

  // TELEGRAM_CHAT_ID is the server's — the site operator's own chat. Every
  // account's job used to be addressed to it, so a tenant's scheduled output
  // would have landed in the operator's Telegram the day it ran.
  const operator = await isSiteOperator(userId).catch(() => false);
  const delivery =
    TELEGRAM_CHAT_ID && operator
      ? {
          mode: "announce" as const,
          channel: "telegram",
          to: TELEGRAM_CHAT_ID,
          bestEffort: true,
        }
      : {
          mode: "none" as const,
          channel: "none",
          to: "",
          bestEffort: true,
        };

  try {
    const newJob: CronJob = {
      id: crypto.randomUUID(),
      agentId: "main",
      name,
      enabled: true,
      createdAtMs: Date.now(),
      updatedAtMs: Date.now(),
      schedule: { kind: "cron", expr: scheduleExpr, tz: tz ?? defaultTz },
      sessionTarget: "isolated",
      wakeMode: "now",
      payload: {
        kind: "agentTurn",
        message,
        timeoutSeconds: timeoutSeconds ?? 120,
        thinking: "low",
        model: model ?? "codex",
      },
      delivery,
      state: {},
      ...(projectId ? { projectId, projectName: projectName ?? "" } : {}),
    };

    const job = await insertCronJob(userId, newJob);
    return NextResponse.json({ ok: true, job });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  const userId = await getSessionUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, PatchCronBody);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const { id, enabled, message, projectId, projectName } = dataOrResp;

  try {
    const existing = await getCronJobRowByOpenclawId(userId, id);
    if (!existing) return NextResponse.json({ error: "Job not found" }, { status: 404 });

    const patch: Partial<CronJob> = {};
    if (enabled !== undefined) patch.enabled = enabled;
    if (message !== undefined) {
      patch.payload = { ...existing.job.payload, message };
    }
    if (projectId !== undefined) patch.projectId = projectId || undefined;
    if (projectName !== undefined) patch.projectName = projectName || undefined;

    const job = await updateCronJobForUser(userId, id, patch);
    return NextResponse.json({ ok: true, job });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
