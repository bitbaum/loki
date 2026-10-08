/**
 * Checks Watch runs on the live page before a Review, so the critique rests on
 * measurements rather than on what a model guesses from an outline.
 *
 * Each check is something a person cannot see but every visitor pays for — a
 * button a screen reader announces as "button", a tap target smaller than a
 * fingertip, a page that scrolls sideways on a phone — and each finding names
 * an example so it can be acted on. They cost one bounded DOM pass (no layout
 * thrash beyond reading rects) and never touch what anyone typed.
 *
 * Tested in a real browser: scripts/test/widget-watch-browser.ts.
 */

/** WCAG 2.2 AA (2.5.8): targets at least 24×24 CSS px. */
export const MIN_TARGET_PX = 24;
/** Body text under this is hard to read on a phone. */
const MIN_TEXT_PX = 12;
/** Bounded so a huge page costs the same as a normal one. */
const MAX_SCAN = 600;
const MAX_CHECKS = 8;

const clean = (s: string | null | undefined) => (s ?? "").replace(/\s+/g, " ").trim();
const quote = (s: string) => `“${clean(s).slice(0, 40)}”`;

function ours(el: Element): boolean {
  return el.closest("#loki-feedback-host") !== null;
}

function shown(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return true;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none";
}

/** The name a screen reader would read for a control, roughly. */
function accessibleName(el: Element): string {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id) => el.ownerDocument.getElementById(id)?.textContent ?? "")
      .join(" ");
    if (clean(text)) return clean(text);
  }
  const direct = el.getAttribute("aria-label") || el.getAttribute("title");
  if (clean(direct)) return clean(direct);
  if (el instanceof HTMLInputElement && ["submit", "button", "reset"].includes(el.type)) {
    return clean(el.value);
  }
  const imgAlt = Array.from(el.querySelectorAll("img[alt]"))
    .map((i) => i.getAttribute("alt"))
    .join(" ");
  // innerText is "" — not null — for anything the browser skipped painting
  // (content-visibility: auto below the fold), so `??` never fell back and a
  // whole labelled footer read as "no name". Seen on loki.orangecat.ch.
  const svgTitle = Array.from(el.querySelectorAll("svg title"))
    .map((t) => t.textContent)
    .join(" ");
  return clean(`${(el as HTMLElement).innerText || el.textContent || ""} ${imgAlt} ${svgTitle}`);
}

function fieldHasLabel(el: HTMLElement): boolean {
  if (clean(el.getAttribute("aria-label")) || el.getAttribute("aria-labelledby")) return true;
  if (el.closest("label")) return true;
  const id = el.getAttribute("id");
  return !!id && !!el.ownerDocument.querySelector(`label[for="${CSS.escape(id)}"]`);
}

/** An example someone can find on the page: its words, else where a link goes,
 *  else its id or classes — never a bare "a". */
function describe(el: Element): string {
  const name = accessibleName(el);
  const tag = el.tagName.toLowerCase();
  const kind = tag === "a" ? "link" : tag;
  if (name) return `${kind} ${quote(name)}`;
  const href = el.getAttribute("href");
  if (href) return `a link to ${href.slice(0, 60)}`;
  if (el.id) return `${kind}#${el.id}`;
  const cls = (el.getAttribute("class") ?? "").split(/\s+/).filter(Boolean).slice(0, 2).join(".");
  return cls ? `${kind}.${cls}` : kind;
}

/**
 * Run every check against the page as it is now. Returns at most eight lines,
 * worst kind first, each "what — how many — an example".
 */
export function runPageChecks(doc: Document = document): string[] {
  const out: string[] = [];
  const win = doc.defaultView ?? window;

  // A page wider than the screen scrolls sideways — on a phone, everything
  // jiggles under the thumb.
  const overflow = doc.documentElement.scrollWidth - win.innerWidth;
  if (overflow > 1) {
    out.push(
      `The page is ${overflow}px wider than the screen (${win.innerWidth}px), so it scrolls sideways`,
    );
  }

  const controls = Array.from(
    doc.querySelectorAll("a[href],button,[role=button],input,select,textarea,summary"),
  )
    .filter((el) => !ours(el) && shown(el))
    .slice(0, MAX_SCAN);

  const unnamed = controls.filter(
    (el) =>
      !(
        el instanceof HTMLInputElement ||
        el instanceof HTMLSelectElement ||
        el instanceof HTMLTextAreaElement
      ) && !accessibleName(el),
  );
  if (unnamed.length) {
    out.push(
      `${unnamed.length} button(s)/link(s) have no name a screen reader can read (e.g. ${describe(unnamed[0])})`,
    );
  }

  const fields = controls.filter(
    (el): el is HTMLElement =>
      (el instanceof HTMLInputElement &&
        !["hidden", "submit", "button", "reset", "image"].includes(el.type)) ||
      el instanceof HTMLSelectElement ||
      el instanceof HTMLTextAreaElement,
  );
  const unlabeled = fields.filter((el) => !fieldHasLabel(el));
  if (unlabeled.length) {
    const ex = unlabeled[0];
    const hint = clean(ex.getAttribute("placeholder"));
    out.push(
      `${unlabeled.length} form field(s) have no label${hint ? ` — only a placeholder like ${quote(hint)}, which vanishes once typing starts` : ""}`,
    );
  }

  // WCAG 2.5.8 has a spacing exception, and without it this flagged a whole
  // nav ("25 tap targets", e.g. a 336×20 link) on a page that passes: a target
  // under 24px is fine when a 24px circle on its centre touches no other
  // target. Only the cramped ones are a finding.
  const rects = controls.map((el) => el.getBoundingClientRect());
  const half = MIN_TARGET_PX / 2;
  const small = controls.filter((el, i) => {
    const r = rects[i];
    // Inline links inside a sentence are exempt in WCAG 2.5.8 too.
    if (el.tagName === "A" && getComputedStyle(el).display === "inline") return false;
    if (!(r.width > 0 && (r.width < MIN_TARGET_PX || r.height < MIN_TARGET_PX))) return false;
    const cx = r.left + r.width / 2;
    const cy = r.top + r.height / 2;
    return rects.some((o, j) => {
      if (j === i || controls[j].contains(el) || el.contains(controls[j])) return false;
      // Distance from the circle's centre to the other target's box.
      const dx = Math.max(o.left - cx, 0, cx - o.right);
      const dy = Math.max(o.top - cy, 0, cy - o.bottom);
      return dx * dx + dy * dy < half * half;
    });
  });
  if (small.length) {
    const r = small[0].getBoundingClientRect();
    out.push(
      `${small.length} tap target(s) are under ${MIN_TARGET_PX}px and crowded by their neighbours, easy to mis-tap (e.g. ${describe(small[0])} at ${Math.round(r.width)}×${Math.round(r.height)})`,
    );
  }

  const images = Array.from(doc.querySelectorAll("img"))
    .filter((el) => !ours(el) && shown(el))
    .slice(0, MAX_SCAN);
  const noAlt = images.filter(
    (img) => !img.hasAttribute("alt") && !img.closest("[aria-hidden=true]"),
  );
  if (noAlt.length) {
    const src = (noAlt[0].getAttribute("src") ?? "").split("/").pop()?.split("?")[0] ?? "";
    out.push(
      `${noAlt.length} image(s) have no alt text${src ? ` (e.g. ${src.slice(0, 60)})` : ""}`,
    );
  }
  const broken = images.filter(
    (img) => img.complete && img.naturalWidth === 0 && img.getAttribute("src"),
  );
  if (broken.length) {
    const src = (broken[0].getAttribute("src") ?? "").split("/").pop()?.split("?")[0] ?? "";
    out.push(`${broken.length} image(s) failed to load (e.g. ${src.slice(0, 60)})`);
  }

  const h1s = Array.from(doc.querySelectorAll("h1")).filter((el) => !ours(el) && shown(el));
  if (h1s.length !== 1) {
    out.push(
      h1s.length === 0
        ? "The page has no main heading (h1) — what it is about is never stated"
        : `The page has ${h1s.length} main headings (h1), so none of them is THE title`,
    );
  }

  if (!clean(doc.documentElement.getAttribute("lang"))) {
    out.push(
      "The page does not declare its language (<html lang>), so screen readers guess the pronunciation",
    );
  }

  let tiny = 0;
  let tinyExample = "";
  const texts = Array.from(doc.querySelectorAll("p,li,span,a,td,label,small"))
    .filter((el) => !ours(el))
    .slice(0, MAX_SCAN);
  for (const el of texts) {
    const own = Array.from(el.childNodes).some(
      (n) => n.nodeType === 3 && clean(n.textContent).length > 2,
    );
    if (!own || !shown(el)) continue;
    const px = parseFloat(getComputedStyle(el).fontSize);
    if (px && px < MIN_TEXT_PX) {
      tiny++;
      if (!tinyExample) tinyExample = `${quote(el.textContent ?? "")} at ${px}px`;
    }
  }
  if (tiny) out.push(`${tiny} piece(s) of text are under ${MIN_TEXT_PX}px (e.g. ${tinyExample})`);

  return out.slice(0, MAX_CHECKS);
}
