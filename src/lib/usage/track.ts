import type { UsageAction, UsageSurface } from "@/config/usage-surfaces";

/**
 * Record what the operator just did with a surface. Fire-and-forget from a
 * client component: it never throws, never blocks, and `keepalive` lets a tap
 * that navigates away still land. The server refuses pairs the registry does
 * not list (src/config/usage-surfaces.ts), so a typo here is a 400 in the
 * network tab, not a silent new event name.
 */
export function trackUsage(event: {
  surface: UsageSurface;
  action: UsageAction;
  target?: string | null;
  meta?: Record<string, unknown>;
}): void {
  if (typeof window === "undefined" || typeof fetch !== "function") return;
  try {
    void fetch("/api/usage", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        events: [{ ...event, path: window.location.pathname }],
      }),
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // A tally must never cost the surface it tallies.
  }
}
