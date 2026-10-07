/**
 * What a page actually serves, read from its HTML before any script runs —
 * the facts the consultation's rules judge (lib/site-consult/findings.ts).
 *
 * Regex, not a DOM: this runs on a stranger's HTML on the server, and nothing
 * here needs more than tags and attributes. Every reader is forgiving — markup
 * in the wild is broken — and every fact is a count or a short string, never
 * the page itself, so nothing the site says can reach a prompt or the browser
 * as markup.
 *
 * Pure (no I/O): pinned in scripts/test/site-consult.ts.
 */

export type PageFacts = {
  lang: string | null;
  title: string | null;
  description: string | null;
  viewport: string | null;
  robots: string;
  h1Count: number;
  hasShareImage: boolean;
  hasStructuredData: boolean;
  images: number;
  imagesWithoutAlt: number;
  insecureResources: number;
  telLinks: number;
  mailLinks: number;
  forms: number;
  contactLinks: number;
  /** A phone number shown as plain text, when no tel: link exists. */
  plainPhone: string | null;
  copyrightYear: number | null;
  words: number;
};

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  copy: "©",
  ndash: "–",
  mdash: "—",
  auml: "ä",
  ouml: "ö",
  uuml: "ü",
  Auml: "Ä",
  Ouml: "Ö",
  Uuml: "Ü",
  eacute: "é",
  egrave: "è",
  agrave: "à",
  ccedil: "ç",
  szlig: "ß",
};

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (whole, code: string) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : Number(code.slice(1));
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : whole;
    }
    return ENTITIES[code] ?? whole;
  });
}

const clean = (text: string) => decodeEntities(text).replace(/\s+/g, " ").trim();

/** Attributes of one tag, names lower-cased. */
export function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const body = tag.replace(/^<\s*[\w:-]+/, "").replace(/\/?>$/, "");
  const re = /([^\s"'=<>`/]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  for (let m = re.exec(body); m; m = re.exec(body)) {
    const name = m[1].toLowerCase();
    if (!(name in out)) out[name] = decodeEntities(m[2] ?? m[3] ?? m[4] ?? "");
  }
  return out;
}

const tags = (html: string, name: string) =>
  html.match(new RegExp(`<${name}\\b[^>]*>`, "gi")) ?? [];

function meta(metas: Record<string, string>[], key: string): string | null {
  const hit = metas.find(
    (m) => (m.name ?? m.property ?? "").toLowerCase() === key && typeof m.content === "string",
  );
  return hit ? clean(hit.content) : null;
}

/** The words a visitor reads, before scripts run. */
export function visibleText(html: string): string {
  return clean(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<head\b[\s\S]*?<\/head>/gi, " ")
      .replace(/<(script|style|noscript|template|svg|iframe)\b[\s\S]*?<\/\1>/gi, " ")
      .replace(/<[^>]+>/g, " "),
  );
}

const CONTACT_WORDS =
  /\b(contact|kontakt|contatt|contacto|contato|get in touch|book|booking|buchen|termin|reserv|anfrage|offerte|quote|appointment|rendez-vous|rdv|schreiben sie|write to us|call us)/i;

/** +41 44 123 45 67, 044 123 45 67, +49 (0)30 1234567 — 9 to 15 digits. */
const PHONE = /(?:\+\d{1,3}[\s.\-/]?(?:\(0\)\s?)?|\b0)\d{1,4}(?:[\s.\-/]?\d{2,4}){2,4}\b/g;

function firstPhone(text: string): string | null {
  for (const match of text.match(PHONE) ?? []) {
    const digits = match.replace(/\D/g, "").length;
    if (digits >= 9 && digits <= 15) return match.trim();
  }
  return null;
}

function copyrightYear(text: string): number | null {
  const re = /(?:©|\(c\)|copyright)[^0-9]{0,40}((?:19|20)\d{2})(?:\s*[-–—/]\s*((?:19|20)\d{2}))?/gi;
  let best: number | null = null;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const year = Math.max(Number(m[1]), m[2] ? Number(m[2]) : 0);
    best = best === null ? year : Math.max(best, year);
  }
  return best;
}

export function readPage(html: string, finalUrl: string, robotsHeader = ""): PageFacts {
  const metas = tags(html, "meta").map(attrs);
  const robots = [
    ...metas
      .filter((m) => ["robots", "googlebot"].includes((m.name ?? "").toLowerCase()))
      .map((m) => m.content ?? ""),
    robotsHeader,
  ]
    .join(", ")
    .toLowerCase();

  const titleMatch = /<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  const htmlTag = tags(html, "html")[0];
  const images = tags(html, "img").map(attrs);
  const anchors = [...html.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a>/gi)].map((m) => ({
    href: (attrs(`<a ${m[1]}>`).href ?? "").trim(),
    text: clean(m[2].replace(/<[^>]+>/g, " ")),
  }));
  const buttons = [...html.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/gi)].map((m) =>
    clean(m[1].replace(/<[^>]+>/g, " ")),
  );
  const https = finalUrl.startsWith("https:");
  const resourceTags = ["img", "script", "iframe", "source", "video", "audio", "embed"]
    .flatMap((t) => tags(html, t))
    .map(attrs)
    .map((a) => a.src ?? "");
  const stylesheets = tags(html, "link")
    .map(attrs)
    .filter((a) => (a.rel ?? "").toLowerCase().includes("stylesheet"))
    .map((a) => a.href ?? "");
  const text = visibleText(html);
  const telLinks = anchors.filter((a) => /^tel:/i.test(a.href)).length;

  return {
    lang: htmlTag ? attrs(htmlTag).lang?.trim() || null : null,
    title: titleMatch ? clean(titleMatch[1]) || null : null,
    description: meta(metas, "description") || null,
    viewport: meta(metas, "viewport"),
    robots,
    h1Count: tags(html, "h1").length,
    hasShareImage: Boolean(meta(metas, "og:image") || meta(metas, "twitter:image")),
    hasStructuredData:
      /<script\b[^>]*type\s*=\s*["']?application\/ld\+json/i.test(html) ||
      /itemtype\s*=\s*["']?https?:\/\/schema\.org/i.test(html),
    images: images.length,
    imagesWithoutAlt: images.filter((a) => !("alt" in a)).length,
    insecureResources: https
      ? [...resourceTags, ...stylesheets].filter((src) => /^http:\/\//i.test(src.trim())).length
      : 0,
    telLinks,
    mailLinks: anchors.filter((a) => /^mailto:/i.test(a.href)).length,
    forms: tags(html, "form").length,
    contactLinks:
      anchors.filter((a) => CONTACT_WORDS.test(a.href) || CONTACT_WORDS.test(a.text)).length +
      buttons.filter((b) => CONTACT_WORDS.test(b)).length,
    plainPhone: telLinks ? null : firstPhone(text),
    copyrightYear: copyrightYear(text),
    words: text ? text.split(" ").length : 0,
  };
}
