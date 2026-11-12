/**
 * GET /api/control/open-tabs — agent tabs currently open on a builder.
 *
 * Cloud control plane: runner-pushed openTabs from box-runner (owned PTY tabs).
 * Local runtime host (`RUNTIME_AVAILABLE=true`): the owned PTYs it holds (`listOwnedTabs`).
 * Terminal Cloud and This computer both list these and stream via peek-stream.
 * Names only; a shell's tab is listed but its screen stays behind the shell
 * unlock (peek-stream, peek-tab).
 */
import { NextResponse } from "next/server";
import { z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { BUILDER_CHANNELS } from "@/lib/constants/statuses";
import { isRuntimeAvailable } from "@/lib/runtime";
import { getRuntimeSnapshot } from "@/db/queries/runtime-snapshots";
import { getExecutionAccess } from "@/lib/execution-access";

export const runtime = "nodejs";

const Channel = z.enum(BUILDER_CHANNELS);

export async function GET(req: Request) {
  // Session or `ck_` token: an agent that started a session can see it is up.
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const channelParam = Channel.safeParse(new URL(req.url).searchParams.get("channel"));
  const requestedChannel = channelParam.success ? channelParam.data : null;

  if (requestedChannel === "cloud" && !isRuntimeAvailable()) {
    const access = await getExecutionAccess(userId);
    if (!access.cloudBuilderAllowed) {
      return NextResponse.json({
        tabs: [],
        unavailable: {
          code: "cloud-builder-private",
          message:
            "Cloud runner is private for this account. Use This computer after connecting Fleet Runner.",
        },
      });
    }
  }

  let tabs: string[] = [];
  if (isRuntimeAvailable()) {
    const { listOwnedTabs } = await import("@/lib/agent-execution/owned");
    tabs = requestedChannel === "cloud" ? [] : listOwnedTabs(userId);
  } else {
    const snap = await getRuntimeSnapshot(userId, requestedChannel ?? undefined).catch(() => null);
    if (!snap) {
      tabs = [];
    } else if (!requestedChannel) {
      tabs = snap?.openTabs ?? [];
    } else {
      tabs = snap.openTabs;
    }
  }
  return NextResponse.json({ tabs });
}
