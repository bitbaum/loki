// Next.js server startup hook — runs once per process on boot.
// Initializes Sentry (env-gated — no-op without NEXT_PUBLIC_SENTRY_DSN), then
// installs the Postgres NOTIFY trigger and starts the /tmp file watcher (local only).
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
    return;
  }
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  await import("../sentry.server.config");

  // Boot-time env sanity check — converts silent config rot (missing /
  // whitespace-corrupted secrets, half-set provider pairs) into a loud signal
  // in the logs + /api/health. Never throws (a crash-loop is its own outage).
  try {
    const { checkEnv } = await import("@/lib/env");
    const issues = checkEnv();
    if (issues.length) {
      for (const i of issues) console.error(`[env] ${i.level}: ${i.key} — ${i.msg}`);
      const { logDebug } = await import("@/db/queries/debug-logs");
      await logDebug({
        source: "instrumentation/env",
        level: issues.some((i) => i.level !== "warn") ? "error" : "warn",
        message: `env check found ${issues.length} issue(s) at boot`,
        meta: { issues },
      }).catch(() => {});
    }
  } catch (e) {
    console.warn("[instrumentation] env check failed:", e);
  }

  // Loki's own model calls go to the box's one usage log (lib/ai/usage-dir).
  try {
    const { adoptFleetUsageLog } = await import("@/lib/ai/usage-dir");
    adoptFleetUsageLog();
  } catch (e) {
    console.warn("[instrumentation] usage log not adopted:", e);
  }

  const { setupNotifyTrigger } = await import("@/db/setup-notify-trigger");
  await setupNotifyTrigger().catch((e) =>
    console.warn("[instrumentation] trigger setup failed:", e),
  );

  if (process.env.RUNTIME_AVAILABLE === "true") {
    const { startSentinelWatcher } = await import("@/lib/sentinel-watcher");
    startSentinelWatcher();
  }
}

// Server-side error capture (Next.js 15+). Mirrors the client-side error
// boundary telemetry — but with the FULL error.message + stack that prod
// builds strip from the client. Lands the row in debug_logs keyed by the
// same digest the client logs, so server + client records correlate. The
// host's logs are unreliable from our env, so we persist to the DB; this is
// the durable substitute. Also forwards to Sentry (no-op without a DSN).
export async function onRequestError(
  ...args: Parameters<typeof Sentry.captureRequestError>
): Promise<void> {
  Sentry.captureRequestError(...args);
  const [error, request, context] = args;
  try {
    const e = error as { message?: string; stack?: string; digest?: string };
    const { logDebug } = await import("@/db/queries/debug-logs");
    await logDebug({
      source: "instrumentation/onRequestError",
      level: "error",
      message: (e?.message ?? "unknown server error").slice(0, 500),
      meta: {
        digest: e?.digest ?? null,
        path: request.path,
        routePath: context.routePath,
        routeType: context.routeType,
        stack: (e?.stack ?? "").split("\n").slice(0, 12).join("\n"),
      },
    });
  } catch {
    // Never throw out of an error reporter — would mask the original error.
  }
}
