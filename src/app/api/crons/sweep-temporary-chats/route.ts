// Cron target — the temporary-chat sweep (lib/loki/temporary-chat.ts).
//
// A temporary chat is deleted when the person leaves it; this takes the ones
// nobody came back to leave — a closed tab whose delete never arrived, a
// phone that died — once they are a day old, so "temporary" is a promise
// kept by the clock as well as by the client.
//
// Schedule: daily 04:40 UTC (systemd timer, scripts/install-hetzner-crons.sh).

import { type NextRequest, NextResponse } from "next/server";
import { requireCronAuth } from "@/lib/cron-auth";
import { deleteStaleEphemeralConversations } from "@/db/queries/conversations";
import { TEMPORARY_CHAT_MAX_AGE_MS } from "@/lib/loki/temporary-chat";

export async function GET(req: NextRequest) {
  const denied = requireCronAuth(req);
  if (denied) return denied;
  const deleted = await deleteStaleEphemeralConversations(
    new Date(Date.now() - TEMPORARY_CHAT_MAX_AGE_MS),
  );
  return NextResponse.json({ ok: true, deleted });
}
