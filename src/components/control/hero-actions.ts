/**
 * The Control hero's two queue actions, and the sentence each one leaves
 * behind.
 *
 * Both buttons used to fire and forget: "Run it in the cloud" posted, ignored
 * the answer and refreshed. When the reroute moved nothing (a project only
 * this computer has the files for, a row a builder had just claimed) the card
 * looked the same as before the tap, which reads as a button that does not
 * work. Whatever happened is now said, on the card, in one sentence.
 */
import { postJson } from "@/lib/api/fetch";

type RerouteBody = {
  rerouted?: number;
  skipped?: { projectKey: string; reason: string }[];
  error?: string;
};

/** Pure: what to say after a reroute answered. Exported for the test. */
export function rerouteNotice(ok: boolean, body: RerouteBody): string {
  if (!ok) return body.error ?? "Could not hand the queue to the cloud runner.";
  const moved = body.rerouted ?? 0;
  const skipped = body.skipped ?? [];
  const parts: string[] = [];
  if (moved > 0) {
    parts.push(`Handed ${moved} dispatch${moved === 1 ? "" : "es"} to the cloud runner.`);
  }
  if (skipped.length > 0) {
    const first = skipped[0];
    parts.push(
      `${skipped.length} stayed for this computer — ${first.projectKey || "a project"}: ${first.reason}.`,
    );
  }
  return parts.join(" ") || "Nothing was waiting any more — a runner already picked it up.";
}

/** Pure: what to say after "Stop waiting" answered. */
export function stopWaitingNotice(ok: boolean, body: { stopped?: number; error?: string }): string {
  if (!ok) return body.error ?? "Could not stop waiting — try again.";
  const n = body.stopped ?? 0;
  if (n === 0) return "Nothing was stuck any more — a runner picked it up.";
  return `Stopped waiting on ${n} dispatch${n === 1 ? "" : "es"}. Retry or dismiss ${
    n === 1 ? "it" : "each one"
  } in the failed list below.`;
}

async function post(url: string): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  try {
    const res = await postJson(url, {});
    const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    return { ok: res.ok, body };
  } catch {
    return { ok: false, body: { error: "Could not reach Loki — check your connection." } };
  }
}

export async function runQueueInCloud(): Promise<string> {
  const { ok, body } = await post("/api/control/reroute");
  return rerouteNotice(ok, body as RerouteBody);
}

export async function stopWaitingOnQueue(): Promise<string> {
  const { ok, body } = await post("/api/control/stop-waiting");
  return stopWaitingNotice(ok, body as { stopped?: number; error?: string });
}
