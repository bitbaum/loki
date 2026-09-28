"use client";

/**
 * One capture of an agent session's screen, from the browser.
 *
 * Fleet Runner's desktop bridge answers directly when present; otherwise the
 * capture goes through the runner-backed pending_commands path (enqueue, then
 * poll), which works from web and mobile. Shared by Control's peek drawer and
 * the project Watch page — it used to live inside the drawer alone.
 *
 * Resolves null when `stillWanted` turns false mid-poll (a newer capture
 * superseded this one); throws with a readable message on failure.
 */
export async function peekTabOnce(
  tab: string,
  stillWanted: () => boolean = () => true,
): Promise<string | null> {
  const bridge = typeof window !== "undefined" ? window.fleetRunner : undefined;
  if (typeof bridge?.peekTab === "function") {
    const result = await bridge.peekTab(tab);
    if (!result.ok) throw new Error(result.error || "Peek failed");
    return result.content;
  }

  const enqueue = await fetch("/api/control/peek-tab", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tab }),
  });
  if (!enqueue.ok) {
    const body = await enqueue.json().catch(() => ({}));
    throw new Error(body.error || `Peek request failed (${enqueue.status})`);
  }
  const { peekId } = (await enqueue.json()) as { peekId?: string };
  if (!peekId) throw new Error("Peek request did not return an id");

  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    if (!stillWanted()) return null;
    const poll = await fetch(`/api/control/peek-tab/${peekId}`, { cache: "no-store" });
    if (!poll.ok) {
      const body = await poll.json().catch(() => ({}));
      throw new Error(body.error || `Peek poll failed (${poll.status})`);
    }
    const body = (await poll.json()) as {
      status: "pending" | "done" | "error";
      content?: string;
      error?: string;
    };
    if (body.status === "done") return body.content ?? "";
    if (body.status === "error") throw new Error(body.error || "Peek failed");
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("Fleet Runner did not claim the peek request within 45s — is it running?");
}
