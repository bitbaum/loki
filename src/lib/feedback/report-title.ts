/**
 * A report's title, led by what is different about it.
 *
 * Watch mode files reports in one shape — "While I was using this page a
 * request failed: GET /api/beacon-settings → no response. Fix it so this
 * works." — and a row cuts its title at about forty characters. On 2026-11-12
 * some thirty rows on /feedback and /my-feedback read "While I was using this
 * page a request fai…", identical, with the part that differs cut off. The
 * system-written lead-ins are taken out here, before any row truncates, so
 * the distinguishing fact comes first. The reporter's own words are left
 * as they are.
 */
export function reportTitle(text: string): string {
  const body = text
    .split(/\s*---\s*technical details/i)[0]!
    .replace(/\s+/g, " ")
    .trim();
  const request = body.match(
    /^While I was using this page a request failed:\s*(.+?)\.?\s*Fix it so this works\.?$/i,
  );
  if (request)
    return `A request failed: ${request[1]!.replace(/^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+/, "")}`;
  const error = body.match(
    /^While I was using this page it hit an error:\s*(.+?)\.?\s*Fix it so this works\.?$/i,
  );
  if (error) return `An error: ${error[1]}`;
  const together = body.match(/^Make these changes on this page, together:\s*(.+)$/i);
  if (together) {
    const items = together[1]!
      .split(/\s*\d+\.\s+/)
      .map((t) => t.trim())
      .filter(Boolean);
    if (items.length > 1) return `${items.length} changes: ${items.join(" · ")}`;
    if (items.length === 1) return items[0]!;
  }
  // Cut before its end (a long URL): still drop the lead-in.
  const lead = body.match(
    /^While I was using this page (?:a request failed|it hit an error):\s*(.+)$/i,
  );
  if (lead) return lead[1]!.replace(/^(GET|POST|PUT|PATCH|DELETE|HEAD)\s+/, "");
  return body;
}
