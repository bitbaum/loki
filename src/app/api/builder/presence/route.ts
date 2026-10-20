import { NextResponse } from "next/server";
import { getBuilderPresence, getRunnerConnected } from "@/db/queries/runner-presence";
import { getApiUserId } from "@/lib/session";
import { isRuntimeAvailable } from "@/lib/runtime";
import { getExecutionAccess } from "@/lib/execution-access";

/** GET /api/builder/presence — minimal executor state for honesty chips. */
export async function GET() {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const runtimeAvailable = isRuntimeAvailable();
  if (runtimeAvailable) {
    return NextResponse.json({
      runtimeAvailable: true,
      runnerConnected: true,
      builderPresence: { cloud: false, local: true, any: true },
      cloudBuilderAllowed: false,
    });
  }

  // Whether the account may use the cloud builder travels with presence on
  // purpose: every surface that reads "is anything online?" is also the one
  // that decides whether to offer a download, and that offer is wrong for an
  // account that has the cloud (lib/builder-way-forward).
  const [builderPresence, runnerConnected, cloudBuilderAllowed] = await Promise.all([
    getBuilderPresence(userId).catch(() => ({ cloud: false, local: false, any: false })),
    getRunnerConnected(userId).catch(() => false),
    getExecutionAccess(userId)
      .then((a) => a.cloudBuilderAllowed)
      .catch(() => null),
  ]);

  return NextResponse.json({
    runtimeAvailable: false,
    runnerConnected: builderPresence.any ?? runnerConnected,
    builderPresence,
    cloudBuilderAllowed,
  });
}
