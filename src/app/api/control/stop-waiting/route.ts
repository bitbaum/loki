import { jsonError, jsonOk } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { stopWaitingOnStalledCommands } from "@/db/queries/pending-commands";
import { closeRunUndelivered } from "@/db/queries/orchestration-runs";

// POST /api/control/stop-waiting
// The Control hero's "Stop waiting": every dispatch the stall headline counted
// becomes a failed dispatch (Retry / Dismiss in the list below the hero), and
// its run is closed so the project's lane is free for the next one. Nothing is
// deleted — the prompts stay one tap from being sent again.
export async function POST() {
  const userId = await getApiUserId();
  if (!userId) return jsonError("Unauthorized", 401);
  const stopped = await stopWaitingOnStalledCommands(userId);
  await Promise.all(
    stopped
      .filter((r) => r.runId)
      .map((r) =>
        closeRunUndelivered(
          r.runId!,
          userId,
          "you stopped waiting from Control after no runner picked it up",
        ).catch(() => {}),
      ),
  );
  return jsonOk({ stopped: stopped.length });
}
