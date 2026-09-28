/**
 * What the advisor gets to see: a TEXT outline of the page the visitor is on —
 * and, for "Whole site", of a few more pages of the same site.
 *
 * Why an outline and not the HTML: a real page is hundreds of kilobytes of
 * markup, scripts and class soup, and a model given that spends its budget on
 * noise. What a person judges a page by — what it says first, what it asks you
 * to do, how you find your way, what is missing — survives as a few kilobytes
 * of structure. Every section is capped, and the whole thing is capped again,
 * so the request size is bounded however large the host page is.
 *
 * Everything is read from the live DOM (or, for other pages, fetched from the
 * same origin — the browser's own cookies and no cross-site request), so the
 * advisor sees the page as this visitor sees it, not a crawler's copy.
 */
import type { SelectedEl } from "./picker";

/** Mirrors the advise route's field caps (src/app/api/widget/advise/route.ts). */
export const SNAPSHOT_MAX_CHARS = 14_000;
export const SITE_MAX_PAGES = 5;
const PAGE_OUTLINE_MAX = 5_000;
const OTHER_PAGE_MAX = 1_400;
const ELEMENT_HTML_MAX = 1_200;

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const cut = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function visible(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true;
  if (el.closest("#loki-feedback-host")) return false;
  return el.getClientRects().length > 0;
}

/**
 * An element's text with word boundaries kept. textContent runs adjacent
 * blocks together ("Welcome to the farmStay with us"), which reads to a model
 * as one garbled word; a laid-out page has innerText, a fetched one gets its
 * text nodes joined with spaces.
 */
function readableText(el: Element, live: boolean): string {
  if (live && el instanceof HTMLElement) return clean(el.innerText);
  const parts: string[] = [];
  const walker = el.ownerDocument.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const tag = n.parentElement?.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "NOSCRIPT") continue;
    parts.push(n.textContent ?? "");
  }
  return clean(parts.join(" "));
}

/** Up to `max` distinct, non-empty labels from the matching elements. */
function labels(root: ParentNode, selector: string, max: number, live: boolean): string[] {
  const out: string[] = [];
  for (const el of Array.from(root.querySelectorAll(selector))) {
    if (live && !visible(el)) continue;
    const label = cut(
      clean(el.getAttribute("aria-label") || el.textContent || el.getAttribute("value")),
      80,
    );
    if (label && !out.includes(label)) out.push(label);
    if (out.length >= max) break;
  }
  return out;
}

/**
 * The outline of one document. `live` is true for the page the visitor is on
 * (visibility is measurable); fetched pages were never laid out, so everything
 * in them counts.
 */
export function outlineDocument(doc: Document, live: boolean, max = PAGE_OUTLINE_MAX): string {
  const lines: string[] = [];
  const meta = (name: string) =>
    clean(doc.querySelector(`meta[name="${name}"]`)?.getAttribute("content"));
  lines.push(`Title: ${cut(clean(doc.title), 160) || "(none)"}`);
  const description = meta("description");
  lines.push(`Meta description: ${description ? cut(description, 240) : "(none)"}`);
  const lang = doc.documentElement.getAttribute("lang");
  if (lang) lines.push(`Language: ${lang}`);

  const headings: string[] = [];
  for (const el of Array.from(doc.querySelectorAll("h1, h2, h3"))) {
    if (live && !visible(el)) continue;
    const text = cut(clean(el.textContent), 100);
    if (text) headings.push(`${"  ".repeat(Number(el.tagName[1]) - 1)}${el.tagName}: ${text}`);
    if (headings.length >= 30) break;
  }
  lines.push(headings.length ? `Headings:\n${headings.join("\n")}` : "Headings: (none)");

  const nav = labels(doc, "nav a, header a", 20, live);
  if (nav.length) lines.push(`Navigation: ${nav.join(" · ")}`);
  const actions = labels(
    doc,
    'main a[class*="btn"], main a[class*="button"], button, [role="button"], input[type="submit"]',
    15,
    live,
  );
  if (actions.length) lines.push(`Buttons / calls to action: ${actions.join(" · ")}`);

  const forms = Array.from(doc.querySelectorAll("form"))
    .filter((f) => !live || visible(f))
    .slice(0, 4);
  forms.forEach((form, i) => {
    const fields = Array.from(form.querySelectorAll("input, select, textarea"))
      .filter((f) => (f as HTMLInputElement).type !== "hidden")
      .map((f) => {
        const id = f.getAttribute("id");
        const label =
          (id && clean(doc.querySelector(`label[for="${CSS.escape(id)}"]`)?.textContent)) ||
          f.getAttribute("placeholder") ||
          f.getAttribute("name") ||
          f.tagName.toLowerCase();
        return cut(clean(label), 40);
      });
    lines.push(`Form ${i + 1}: ${fields.length} field(s) — ${fields.slice(0, 10).join(", ")}`);
  });

  const images = Array.from(doc.querySelectorAll("img")).filter((img) => !live || visible(img));
  const noAlt = images.filter((img) => !img.hasAttribute("alt")).length;
  if (images.length) lines.push(`Images: ${images.length} (${noAlt} without alt text)`);

  const footer = cut(clean(doc.querySelector("footer")?.textContent), 300);
  if (footer) lines.push(`Footer: ${footer}`);

  const main = doc.querySelector("main") ?? doc.body;
  const words = main ? readableText(main, live) : "";
  lines.push(
    `Visible text (${words.split(" ").filter(Boolean).length} words): ${cut(words, 1800)}`,
  );
  return cut(lines.join("\n"), max);
}

/** An element's markup as the SITE wrote it: the picker's own fcw-* highlight
 *  classes (and a class attribute that held only those) are removed. */
function siteMarkup(el: Element): string {
  const copy = el.cloneNode(true) as Element;
  for (const node of [copy, ...Array.from(copy.querySelectorAll("[class]"))]) {
    for (const c of Array.from(node.classList)) if (c.startsWith("fcw-")) node.classList.remove(c);
    if (node.getAttribute("class") === "") node.removeAttribute("class");
  }
  return copy.outerHTML.replace(/\s+/g, " ");
}

/** The picked elements, with enough of their markup and style to judge them. */
export function describeElements(selected: SelectedEl[]): string {
  const parts: string[] = [];
  selected.forEach((sel, i) => {
    let el: Element | null = null;
    try {
      el = document.querySelector(sel.selector);
    } catch {
      el = null;
    }
    const lines = [`Element ${i + 1}: <${sel.elementType}> "${cut(clean(sel.elementText), 120)}"`];
    lines.push(`  selector: ${sel.selector}`);
    if (el instanceof HTMLElement) {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      lines.push(
        `  size: ${Math.round(r.width)}×${Math.round(r.height)}px at ${Math.round(r.left)},${Math.round(r.top + scrollY)} (viewport ${innerWidth}×${innerHeight})`,
      );
      lines.push(
        `  style: font ${cs.fontSize} ${cs.fontWeight} ${cut(cs.fontFamily, 40)}; color ${cs.color}; background ${cs.backgroundColor}`,
      );
      const html = siteMarkup(el);
      lines.push(`  html: ${cut(html, ELEMENT_HTML_MAX)}`);
    }
    parts.push(lines.join("\n"));
  });
  return parts.join("\n\n");
}

/** Same-origin page links this page offers, navigation first, deduplicated. */
export function sameOriginPages(doc: Document, here: URL, max = SITE_MAX_PAGES): string[] {
  const out: string[] = [];
  const seen = new Set([here.origin + here.pathname]);
  const anchors = [
    ...Array.from(doc.querySelectorAll("nav a[href], header a[href]")),
    ...Array.from(doc.querySelectorAll("a[href]")),
  ];
  for (const a of anchors) {
    let url: URL;
    try {
      url = new URL(a.getAttribute("href") ?? "", here);
    } catch {
      continue;
    }
    if (url.origin !== here.origin) continue;
    if (/\.(pdf|jpe?g|png|gif|webp|svg|zip|mp4|mp3)$/i.test(url.pathname)) continue;
    const key = url.origin + url.pathname;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= max) break;
  }
  return out;
}

async function outlineRemote(url: string): Promise<string> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(url, { signal: ctrl.signal, credentials: "same-origin" });
    clearTimeout(timer);
    if (!res.ok || !(res.headers.get("content-type") ?? "").includes("html")) return "";
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    return `--- ${new URL(url).pathname} ---\n${outlineDocument(doc, false, OTHER_PAGE_MAX)}`;
  } catch {
    return "";
  }
}

export type SnapshotScope = "element" | "page" | "site";

/**
 * The whole context for one question. For "site" it reads a few more pages;
 * a page that fails to load is skipped, never fatal — the advisor says what it
 * could see.
 */
export async function takeSnapshot(scope: SnapshotScope, selected: SelectedEl[]): Promise<string> {
  const here = new URL(location.href);
  const sections = [
    `Site: ${here.origin}`,
    `Current page: ${here.pathname}`,
    `Viewport: ${innerWidth}×${innerHeight}${matchMedia("(pointer: coarse)").matches ? " (touch)" : ""}`,
  ];
  if (scope === "element" && selected.length) {
    sections.push(`=== Selected element(s) ===\n${describeElements(selected)}`);
  }
  sections.push(`=== This page ===\n${outlineDocument(document, true)}`);
  if (scope === "site") {
    const others = (await Promise.all(sameOriginPages(document, here).map(outlineRemote))).filter(
      Boolean,
    );
    sections.push(
      others.length
        ? `=== Other pages of the site ===\n${others.join("\n\n")}`
        : "=== Other pages of the site ===\n(no other pages could be read from here)",
    );
  }
  return cut(sections.join("\n\n"), SNAPSHOT_MAX_CHARS);
}
