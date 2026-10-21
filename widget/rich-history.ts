/**
 * A visual answer (```chat_ui JSON fences) as readable text for the history
 * the widget sends back to /api/widget/chat.
 *
 * This mirrors `richAnswerText` from @bitbaum/chatkit. The panel bundle
 * (public/widget.js) loads on every customer page and must carry no
 * third-party dependency (scripts/test/widget-self-contained.ts); chatkit
 * lives only in the lazily loaded chat chunk. Parity with chatkit is pinned
 * by scripts/test/widget-visual-answer.ts, so a chatkit change that this copy
 * misses fails CI instead of drifting.
 */
type Rec = Record<string, unknown>;
const record = (v: unknown): v is Rec => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max = 2000): v is string =>
  typeof v === "string" && !!v.trim() && v.length <= max;
const list = (v: unknown, max: number): v is unknown[] =>
  Array.isArray(v) && v.length > 0 && v.length <= max;

function safeImageSrc(value: unknown): boolean {
  if (!str(value, 4096) || /[\s\\]/.test(value) || [...value].some((c) => c.charCodeAt(0) < 32))
    return false;
  if (/^\/(?!\/)/.test(value)) return true;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password;
  } catch {
    return false;
  }
}

type Node = { id: string; label: string; detail?: string };
type Edge = { from: string; to: string; label?: string };

function blockText(raw: string): string {
  if (raw.length > 40000) return "";
  let b: unknown;
  try {
    b = JSON.parse(raw);
  } catch {
    return "";
  }
  if (!record(b) || !str(b.title, 200)) return "";
  const title = b.title;
  switch (b.type) {
    case "audio":
      if (
        !safeImageSrc(b.src) ||
        (b.creator !== undefined && !str(b.creator, 200)) ||
        (b.caption !== undefined && !str(b.caption, 1000))
      )
        return "";
      return `${title}${b.creator ? ` — ${b.creator}` : ""}${b.caption ? `\n${b.caption}` : ""}\n${b.src}`;
    case "callout":
      return str(b.body) ? `${title}\n${b.body}` : "";
    case "gallery": {
      if (
        !list(b.images, 6) ||
        !b.images.every(
          (i) =>
            record(i) &&
            safeImageSrc(i.src) &&
            str(i.alt, 300) &&
            (i.caption === undefined || str(i.caption, 500)),
        )
      )
        return "";
      const images = b.images as { src: string; alt: string; caption?: string }[];
      return `${title}\n${images.map((i) => `${i.alt}${i.caption ? ` — ${i.caption}` : ""}\n${i.src}`).join("\n")}`;
    }
    case "diagram": {
      if (
        !list(b.nodes, 8) ||
        !b.nodes.every(
          (n) =>
            record(n) &&
            str(n.id, 50) &&
            str(n.label, 120) &&
            (n.detail === undefined || str(n.detail, 300)),
        )
      )
        return "";
      const nodes = b.nodes as Node[];
      const ids = new Set(nodes.map((n) => n.id));
      if (
        ids.size !== nodes.length ||
        !Array.isArray(b.edges) ||
        b.edges.length > 16 ||
        !b.edges.every(
          (e) =>
            record(e) &&
            ids.has(e.from as string) &&
            ids.has(e.to as string) &&
            (e.label === undefined || str(e.label, 100)),
        )
      )
        return "";
      const edges = b.edges as Edge[];
      const label = (id: string) => nodes.find((n) => n.id === id)!.label;
      return `${title}\n${nodes.map((n) => `${n.label}${n.detail ? `: ${n.detail}` : ""}`).join("\n")}\n${edges.map((e) => `${label(e.from)} → ${label(e.to)}${e.label ? ` (${e.label})` : ""}`).join("\n")}`;
    }
    case "choices": {
      if (
        !str(b.submit, 80) ||
        !list(b.options, 6) ||
        !b.options.every((o) => record(o) && str(o.label, 200) && str(o.reply, 500))
      )
        return "";
      const options = b.options as { label: string }[];
      return `${title}\n${options.map((o) => `- ${o.label}`).join("\n")}`;
    }
    default:
      return "";
  }
}

/** Same output as chatkit's richAnswerText: visuals become their words. */
export function richAnswerText(text: string): string {
  return text.replace(/```chat_ui\s*([\s\S]*?)(?:```|$)/g, (_, raw: string) => blockText(raw));
}
