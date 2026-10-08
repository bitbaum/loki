/**
 * "Show me": Loki changes THIS page, in this browser only, to show what an
 * idea would look like before anyone builds it. Nothing is saved and nothing
 * reaches the site's server; Undo (or a reload) puts the page back exactly.
 *
 * The model never writes code that runs. It answers with a short list of
 * edits from a closed vocabulary — set styles on an element, change its text,
 * hide it, insert a small piece of markup, add a stylesheet — and every one is
 * checked here before it touches the page: markup goes through an allow-list
 * of tags and attributes (no script, no handlers, no javascript: links) and
 * CSS loses anything that loads or executes (url(), @import, expression).
 * Server: src/app/api/widget/preview/route.ts; prompt: src/lib/widget-preview/.
 */

/** One edit. `target` indexes the outline this browser sent (widget/tour.ts). */
export type PreviewOp =
  | { op: "style"; target: number; css: Record<string, string> }
  | { op: "text"; target: number; text: string }
  | { op: "hide"; target: number }
  | {
      op: "insert";
      target: number;
      where: "before" | "after" | "prepend" | "append";
      html: string;
    }
  | { op: "css"; css: string };

export const PREVIEW_MAX_OPS = 12;
export const PREVIEW_HTML_MAX = 4000;
export const PREVIEW_CSS_MAX = 4000;

const TAGS = new Set([
  "div",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "p",
  "span",
  "strong",
  "em",
  "b",
  "i",
  "small",
  "br",
  "hr",
  "h1",
  "h2",
  "h3",
  "h4",
  "ul",
  "ol",
  "li",
  "a",
  "img",
  "figure",
  "figcaption",
  "blockquote",
  "button",
]);
const ATTRS = new Set(["class", "style", "href", "src", "alt", "title", "role", "aria-label"]);

/** CSS with nothing that loads, imports or executes. Pure. */
export function cleanCss(css: string): string {
  return css
    .replace(/<\/?style[^>]*>/gi, "")
    .replace(/@import[^;]*;?/gi, "")
    .replace(/url\s*\([^)]*\)/gi, "none")
    .replace(/expression\s*\(/gi, "(")
    .replace(/javascript:/gi, "")
    .replace(/behavior\s*:/gi, "")
    .slice(0, PREVIEW_CSS_MAX);
}

/** A property name and value safe to set inline, or null. Pure. */
export function cleanDecl(prop: string, value: string): [string, string] | null {
  const p = prop.trim().toLowerCase();
  if (!/^-?[a-z][a-z-]{0,40}$/.test(p)) return null;
  const v = cleanCss(String(value)).trim().slice(0, 200);
  if (!v || /[{};<>]/.test(v)) return null;
  return [p, v];
}

function safeUrl(value: string, forImage: boolean): string | null {
  const v = value.trim();
  if (v.startsWith("#") || v.startsWith("/")) return v;
  if (/^https:\/\//i.test(v)) return v;
  // A placeholder picture is fine; a data: document or script is not.
  if (forImage && /^data:image\/(png|jpeg|webp|gif|svg\+xml);/i.test(v)) return v;
  return null;
}

/** Copy only allowed elements and attributes out of untrusted markup. */
function sanitizeInto(src: Node, dest: Node): void {
  for (const child of Array.from(src.childNodes)) {
    if (child.nodeType === Node.TEXT_NODE) {
      dest.appendChild(document.createTextNode(child.textContent ?? ""));
      continue;
    }
    if (!(child instanceof Element)) continue;
    const tag = child.tagName.toLowerCase();
    if (!TAGS.has(tag)) {
      // Unknown wrapper: keep its text and allowed children, drop the tag.
      // script/style/iframe content never survives — their children are not
      // markup the page would show anyway.
      if (!["script", "style", "iframe", "object", "embed", "template"].includes(tag))
        sanitizeInto(child, dest);
      continue;
    }
    const el = document.createElement(tag);
    for (const attr of Array.from(child.attributes)) {
      const name = attr.name.toLowerCase();
      if (!ATTRS.has(name)) continue;
      if (name === "href" || name === "src") {
        const url = safeUrl(attr.value, name === "src");
        if (url) el.setAttribute(name, url);
      } else if (name === "style") {
        el.setAttribute("style", cleanCss(attr.value));
      } else {
        el.setAttribute(name, attr.value.slice(0, 200));
      }
    }
    // A preview never sends anyone anywhere or submits anything.
    if (tag === "a") el.addEventListener("click", (e) => e.preventDefault());
    if (tag === "button") (el as HTMLButtonElement).type = "button";
    sanitizeInto(child, el);
    dest.appendChild(el);
  }
}

export function sanitizeHtml(html: string): DocumentFragment {
  const parsed = new DOMParser().parseFromString(
    `<body>${html.slice(0, PREVIEW_HTML_MAX)}</body>`,
    "text/html",
  );
  const frag = document.createDocumentFragment();
  sanitizeInto(parsed.body, frag);
  return frag;
}

/** Marks what the preview added, so it can be told apart and removed. */
const ADDED_ATTR = "data-loki-preview";

/**
 * Apply edits and return the undo. Each edit records what it changed before
 * changing it; undo replays those records backwards. Edits whose target is
 * gone are skipped and counted — the caller says so rather than pretending.
 */
export function applyPreview(
  ops: PreviewOp[],
  els: Element[],
): { undo: () => void; applied: number; skipped: number; first: Element | null } {
  const undos: (() => void)[] = [];
  let applied = 0;
  let skipped = 0;
  let first: Element | null = null;
  const touch = (el: Element) => {
    first ??= el;
  };

  for (const op of ops.slice(0, PREVIEW_MAX_OPS)) {
    if (op.op === "css") {
      const style = document.createElement("style");
      style.setAttribute(ADDED_ATTR, "");
      style.textContent = cleanCss(op.css);
      document.head.appendChild(style);
      undos.push(() => style.remove());
      applied++;
      continue;
    }
    const el = els[op.target];
    if (!(el instanceof HTMLElement) || !el.isConnected) {
      skipped++;
      continue;
    }
    if (op.op === "style" || op.op === "hide") {
      const before = el.getAttribute("style");
      const decls: [string, string][] =
        op.op === "hide"
          ? [["display", "none"]]
          : Object.entries(op.css)
              .map(([p, v]) => cleanDecl(p, v))
              .filter((d): d is [string, string] => d !== null);
      if (decls.length === 0) {
        skipped++;
        continue;
      }
      for (const [p, v] of decls) el.style.setProperty(p, v, "important");
      undos.push(() => {
        // Clear through the style API first: Chromium re-serializes an edited
        // inline style, so a bare removeAttribute leaves `style=""` behind.
        el.style.cssText = before ?? "";
        if (before === null) el.removeAttribute("style");
      });
    } else if (op.op === "text") {
      // Only a leaf: replacing the text of a container would wipe its children.
      if (el.children.length > 0) {
        skipped++;
        continue;
      }
      const before = el.textContent;
      el.textContent = op.text.slice(0, 400);
      undos.push(() => (el.textContent = before));
    } else if (op.op === "insert") {
      const wrap = document.createElement("div");
      wrap.setAttribute(ADDED_ATTR, "");
      wrap.style.display = "contents";
      wrap.appendChild(sanitizeHtml(op.html));
      if (!wrap.childNodes.length) {
        skipped++;
        continue;
      }
      const at = {
        before: "beforebegin",
        after: "afterend",
        prepend: "afterbegin",
        append: "beforeend",
      } as const;
      el.insertAdjacentElement(at[op.where], wrap);
      undos.push(() => wrap.remove());
      touch(wrap.firstElementChild ?? el);
      applied++;
      continue;
    }
    touch(el);
    applied++;
  }
  return {
    undo: () => {
      for (const u of undos.reverse()) u();
    },
    applied,
    skipped,
    first,
  };
}
