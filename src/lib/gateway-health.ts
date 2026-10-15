/**
 * Is the OpenClaw gateway answering? The one fact WhatsApp and the Telegram
 * chat depend on.
 *
 * WHY THIS EXISTS. WhatsApp and the Telegram chat are carried by the gateway on
 * bitbaum; Loki has no inbound channel of its own. It died on 2026-10-08 —
 * after the box rebooted, the openclaw user's systemd manager stayed dead and
 * took the gateway with it — and NOTHING said so for a week: the host health
 * sweep had stopped watching it the same day, on the belief that it was
 * retired. Forwarding a message to WhatsApp to land in the calendar simply
 * stopped working, and the operator found out by noticing.
 *
 * Pure on purpose: the probe takes its fetch, and the raise/clear decision is
 * a function of two booleans, so both are pinned without a network.
 */
export type GatewayProbe = { up: boolean; detail: string };

/**
 * Any HTTP answer, whatever its status, means the gateway process is up and
 * listening: the dashboard answers 200, and an auth wall would answer 401 —
 * both are "up". Only a refused connection or a timeout is "down".
 */
export async function probeGateway(
  url: string,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 4000,
): Promise<GatewayProbe> {
  // An explicit controller and timer, not AbortSignal.timeout: that timer is
  // unreferenced, so in a bare script the process can exit while the probe is
  // still waiting (the first version of the test "passed" by never finishing).
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { signal: controller.signal, redirect: "manual" });
    return { up: true, detail: `HTTP ${res.status}` };
  } catch (e) {
    const why =
      e instanceof Error ? (e.cause instanceof Error ? e.cause.message : e.message) : String(e);
    return { up: false, detail: why.slice(0, 120) };
  } finally {
    clearTimeout(timer);
  }
}

export type GatewayTransition = "raise" | "clear" | "none";

/**
 * Down with no flag up: raise it (once — the alert dedupes the next ticks).
 * Up with a flag up: clear it, so the NEXT outage is not swallowed by a flag
 * that never fell. Anything else changes nothing.
 */
export function gatewayTransition(up: boolean, alertOpen: boolean): GatewayTransition {
  if (!up && !alertOpen) return "raise";
  if (up && alertOpen) return "clear";
  return "none";
}
