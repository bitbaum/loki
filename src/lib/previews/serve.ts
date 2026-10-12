/**
 * Serving a preview folder: which file a URL may name, what type it is, and
 * the one thing Loki adds to every page — its feedback widget, so the person
 * the site was built for can say what to change, on the site itself.
 *
 * Pure (path only), so every rule here is tested without a server.
 */
import path from "path";
import { PREVIEWS } from "@/config/previews";

/**
 * The file a request names inside `dir`, or null when it must not be served.
 *
 * Refused: any segment that is empty, `.` or `..`, starts with a dot (the
 * folder is a git repository: `.git/config` must never be reachable), or holds
 * a separator or NUL after decoding. The result is re-checked to sit inside
 * `dir` after resolution, so a rule missed above still cannot escape it.
 */
export function resolvePreviewFile(dir: string, segments: readonly string[]): string | null {
  const parts = segments.length ? [...segments] : [PREVIEWS.entryFile];
  for (const part of parts) {
    if (!part || part.startsWith(".") || /[\\/\0]/.test(part)) return null;
  }
  const root = path.resolve(dir);
  const file = path.resolve(root, ...parts);
  const rel = path.relative(root, file);
  if (!rel || rel.startsWith("..") || path.isAbsolute(rel)) return null;
  return file;
}

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".mp3": "audio/mpeg",
  ".m4a": "audio/mp4",
  ".ogg": "audio/ogg",
  ".wav": "audio/wav",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".otf": "font/otf",
  ".pdf": "application/pdf",
};

/** The Content-Type to send, or null for a file type previews do not serve. */
export function previewContentType(file: string): string | null {
  return TYPES[path.extname(file).toLowerCase()] ?? null;
}

export function isHtmlFile(file: string): boolean {
  return previewContentType(file)?.startsWith("text/html") ?? false;
}

/** The tag that loads the widget for this preview's project. */
export function widgetScriptTag(token: string, scriptSrc = "/widget.js"): string {
  const safe = token.replace(/[^A-Za-z0-9_]/g, "");
  return `<script src="${scriptSrc}" data-fc-project="${safe}" async></script>`;
}

/**
 * Put the widget into a page, just before its last `</body>` (or at the end
 * when the page has none). A page that already embeds a widget is left alone:
 * one launcher per page.
 */
export function injectPreviewWidget(html: string, token: string, scriptSrc?: string): string {
  if (/data-fc-project\s*=/.test(html)) return html;
  const tag = widgetScriptTag(token, scriptSrc);
  const at = html.toLowerCase().lastIndexOf("</body>");
  return at === -1 ? `${html}\n${tag}\n` : `${html.slice(0, at)}${tag}\n${html.slice(at)}`;
}
