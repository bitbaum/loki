/**
 * Raw terminal I/O for the interactive "My machine" terminal: per-keystroke
 * bytes and resizes. Distinct from tab-inject (which is prompt-oriented: line +
 * CR submit semantics) — this writes bytes VERBATIM, no CR, no prompt state.
 *
 * Routing mirrors tab-inject:
 *   - Same box as a live Loki-owned PTY (local dev) → executor directly.
 *   - Otherwise (prod: web app on Hetzner, runner on the user's machine) →
 *     publish a non-durable fast-lane event to the bridge; the runner writes it
 *     into its PTY. NOT pending_commands — a DB row per keystroke is catastrophic.
 */
import { stripTerminalReports } from "@/lib/terminal-reports";
import { NextRequest, NextResponse } from "next/server";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { getApiUserId } from "@/lib/session";
import { isRuntimeAvailable } from "@/lib/runtime";
import { executor } from "@/lib/agent-execution";
import { workspaceIdFor } from "@/lib/agent-execution/ownership";
import { publishFastLaneEvent } from "@/lib/bridge-publish";
import { getExecutionAccess } from "@/lib/execution-access";
import { clampPtyGeometry } from "@/lib/terminal-viewport";
import { BUILDER_CHANNELS } from "@/lib/constants/statuses";

const Channel = z.enum(BUILDER_CHANNELS);

const Body = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("key"),
    tab: z.string().trim().min(1).max(120),
    data: z.string().min(1).max(4000),
    channel: Channel.optional(),
  }),
  z.object({
    kind: z.literal("resize"),
    tab: z.string().trim().min(1).max(120),
    cols: z.number().int().min(1).max(1000),
    rows: z.number().int().min(1).max(1000),
    channel: Channel.optional(),
  }),
]);

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;
  const body = dataOrResp;

  // A resize is the one payload here that changes the SESSION rather than
  // feeding it — a viewer with a collapsed pane must not reflow a running TUI
  // to one row. Floored at the boundary, not in the client, so an old bundle or
  // any other caller is bound by the same rule.
  const geometry = body.kind === "resize" ? clampPtyGeometry(body) : null;

  // Same-box live PTY (local dev): drive the executor directly — lowest latency,
  // no transport hop.
  const wsId = workspaceIdFor(userId, body.tab);
  const wsHandle = isRuntimeAvailable() ? executor.get(wsId) : null;
  if (wsHandle && wsHandle.status !== "exited") {
    if (body.kind === "key") {
      const keys = stripTerminalReports(body.data);
      if (keys) executor.write(wsId, keys);
    } else if (geometry) executor.resize(wsId, geometry.cols, geometry.rows);
    return NextResponse.json({
      ok: true,
      mode: "pty",
      tab: body.tab,
      ...(geometry?.clamped ? { clamped: true } : {}),
    });
  }

  // Otherwise fan out to the runner via the bridge fast lane. Routed by userId,
  // so a user can only drive their own tabs. Optional channel targets cloud
  // box-runner vs desktop Fleet Runner when both are online.
  const ch = body.channel;
  if (ch === "cloud") {
    const access = await getExecutionAccess(userId);
    if (!access.cloudBuilderAllowed) {
      return NextResponse.json(
        { error: "Cloud builder is private for this account." },
        { status: 403 },
      );
    }
  }
  if (body.kind === "key") {
    await publishFastLaneEvent({
      kind: "rawkey",
      u: userId,
      tab: body.tab,
      b: stripTerminalReports(body.data),
      ...(ch ? { ch } : {}),
    });
  } else if (geometry) {
    await publishFastLaneEvent({
      kind: "resize",
      u: userId,
      tab: body.tab,
      c: geometry.cols,
      r: geometry.rows,
      ...(ch ? { ch } : {}),
    });
  }
  return NextResponse.json({
    ok: true,
    mode: "bridge",
    tab: body.tab,
    ...(geometry?.clamped ? { clamped: true } : {}),
  });
}
