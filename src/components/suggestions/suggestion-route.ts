import type { Suggestion } from "@/lib/suggestions/types";

/**
 * Where "Do it" goes. One rule, shared by the board and anything else that
 * offers a suggestion outside /loki:
 *
 *   - a place to open (`href`) → there;
 *   - a prompt → Loki, with the ask already written and, when it names a
 *     project, that project set. The person reads what will be sent and sends
 *     it — the one tap that is also the approval.
 *
 * Mirrors what Control's idle state does with the build row.
 */
export function suggestionHref(s: Suggestion): string | null {
  if (s.href) return s.href;
  if (!s.prompt) return null;
  const q = new URLSearchParams({ q: s.prompt });
  if (s.project) q.set("project", s.project);
  return `/loki?${q.toString()}`;
}
