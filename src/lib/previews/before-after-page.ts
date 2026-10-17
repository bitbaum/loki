/**
 * The tour: the live site and the new version, page by page, photographed on
 * a phone and shown side by side — then the engineer's account of what
 * changed and why. Served inside the preview behind its access code
 * (lib/previews/handle, `_loki/before-after`), so the owner opens one link
 * and SEES the improvement instead of comparing two sites from memory.
 *
 * Pure (strings in, HTML out). The pictures are separate requests
 * (`_loki/picture?side=…&i=…`), lazy, and each one that cannot be taken
 * collapses to a link, never a broken image.
 */
import { NOTE_NONE, WALKTHROUGH_LABELS, type FixNote } from "@/lib/feedback/fix-note";
import { PICTURE_VIEWPORT } from "@/lib/feedback/page-picture";
import { PALETTE } from "@/lib/palette";
import { esc, previewShell } from "@/lib/previews/page-shell";
import type { BeforeAfterPair, Improvements } from "@/lib/previews/improvements";

const MONO = PALETTE.widget.fontMono;
const STYLE = `
.top{display:grid;gap:14px;padding-top:40px}
.eyebrow{font:500 12px ${MONO};letter-spacing:.08em;text-transform:uppercase;opacity:.7}
.actions{display:flex;flex-wrap:wrap;gap:10px}
.pair{display:grid;gap:14px}
.pair h2{margin:0;font-size:20px;font-weight:600;line-height:1.3}
.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,260px),1fr));gap:16px}
.shot{display:grid;gap:8px;min-width:0}
.shot figcaption{font:500 12px ${MONO};letter-spacing:.08em;text-transform:uppercase;opacity:.7}
.shot img{display:block;width:100%;height:auto;max-height:70vh;aspect-ratio:${PICTURE_VIEWPORT.width}/${PICTURE_VIEWPORT.height};border-radius:16px;border:1px solid rgba(127,127,127,.35);background:rgba(127,127,127,.12);object-fit:cover;object-position:top}
.shot .none{display:none;aspect-ratio:${PICTURE_VIEWPORT.width}/${PICTURE_VIEWPORT.height};max-height:40vh;border-radius:16px;border:1px dashed rgba(127,127,127,.45);padding:16px;place-items:center;text-align:center;font-size:14px}
.shot.failed img{display:none}.shot.failed .none{display:grid}
.shot a{font-size:14px}
.facts{display:grid;gap:10px;margin:0}
.facts div{display:grid;gap:2px}
.facts dt{font:500 12px ${MONO};letter-spacing:.08em;text-transform:uppercase;opacity:.7}
.facts dd{margin:0}
.list{margin:0;padding-left:20px;display:grid;gap:6px}
.scope{font-size:14px;opacity:.8}
figure{margin:0}
`;

function shot(side: "before" | "after", i: number, label: string, href: string, link: string) {
  return `<figure class="shot">
  <figcaption>${esc(label)}</figcaption>
  <img src="_loki/picture?side=${side}&amp;i=${i}" width="${PICTURE_VIEWPORT.width}" height="${PICTURE_VIEWPORT.height}" loading="lazy" alt="${esc(label)}" onerror="this.parentElement.classList.add('failed')">
  <div class="none">No picture yet — open the page instead.</div>
  <a href="${esc(href)}" target="_blank" rel="noopener">${esc(link)}</a>
</figure>`;
}

function fact(label: string, text: string | null | undefined) {
  const value = (text ?? "").trim();
  if (!value) return "";
  const none = value.toLowerCase() === NOTE_NONE.toLowerCase();
  return `<div><dt>${esc(label)}</dt><dd>${none ? "None — checked." : esc(value)}</dd></div>`;
}

function list(title: string, items: readonly string[]) {
  const kept = items.map((s) => s.trim()).filter(Boolean);
  if (!kept.length) return "";
  return `<section class="pair"><h2>${esc(title)}</h2><ul class="list">${kept
    .map((s) => `<li>${esc(s)}</li>`)
    .join("")}</ul></section>`;
}

function walkthrough(note: FixNote | null) {
  if (!note) return "";
  const rows = [
    fact(WALKTHROUGH_LABELS.problem, note.problem),
    fact(WALKTHROUGH_LABELS.change, note.change),
    fact(WALKTHROUGH_LABELS.helps, note.helps),
    fact(WALKTHROUGH_LABELS.why, note.why),
    note.considered.length
      ? `<div><dt>${esc(WALKTHROUGH_LABELS.considered)}</dt><dd><ul class="list">${note.considered
          .map(
            (c) =>
              `<li>${esc(c.option)}${c.whyNot ? ` <span style="opacity:.75">— ${esc(c.whyNot)}</span>` : ""}</li>`,
          )
          .join("")}</ul></dd></div>`
      : "",
    fact(WALKTHROUGH_LABELS.us, note.us),
    fact(WALKTHROUGH_LABELS.downsides, note.downsides),
    fact(WALKTHROUGH_LABELS.costs, note.costs),
    fact(WALKTHROUGH_LABELS.proof, note.proof),
    fact(WALKTHROUGH_LABELS.next, note.next),
  ].join("");
  if (!rows) return "";
  return `<section class="pair" aria-labelledby="account"><h2 id="account">The engineer's account</h2><dl class="facts">${rows}</dl></section>`;
}

export function beforeAfterPage(opts: {
  name: string;
  /** The live site the preview was made from, or null for a preview built from scratch. */
  website: string | null;
  pairs: BeforeAfterPair[];
  improvements: Improvements | null;
  walkthrough: FixNote | null;
}): string {
  const { name, website, pairs, improvements } = opts;
  const headline =
    improvements?.headline ||
    (pairs.length
      ? "The live site next to the new version, page by page, as a visitor on a phone sees them."
      : "The new version is still being built. Come back in a few minutes and this page will show the live site and the new one side by side.");
  const top = `<header class="top">
  <div class="eyebrow">Before and after</div>
  <h1>${esc(name)}</h1>
  <p>${esc(headline)}</p>
  <div class="actions">
    <a class="btn" href="../index.html">Open the new site</a>
    ${website ? `<a class="btn btn-quiet" href="${esc(website)}" target="_blank" rel="noopener">Open the live site</a>` : ""}
  </div>
</header>`;
  const rows = pairs
    .map((pair, i) => {
      const facts = [
        fact("Before", pair.before),
        fact("After", pair.after),
        fact("Why it matters", pair.why),
      ].join("");
      return `<section class="pair">
  <h2>${esc(pair.title)}</h2>
  <div class="shots">
    ${shot("before", i, "Live site today", pair.liveUrl, "Open on the live site")}
    ${shot("after", i, "New version", `../${pair.newPath}`, "Open the new page")}
  </div>
  ${facts ? `<dl class="facts">${facts}</dl>` : ""}
</section>`;
    })
    .join("\n");
  const scope = `<p class="scope">Loki takes these pictures itself, on a phone-sized screen (${PICTURE_VIEWPORT.width} px wide), the first time this page is opened — so they show both sites as they are now, not as described. Leave a note on any page of the new site, with the button in the corner, and it starts a change.</p>`;
  return previewShell(
    `Before and after — ${name}`,
    [
      top,
      rows,
      list("Not brought over", improvements?.notBroughtOver ?? []),
      list("Questions for you", improvements?.questions ?? []),
      walkthrough(opts.walkthrough),
      scope,
    ]
      .filter(Boolean)
      .join("\n"),
    { width: "column", style: STYLE, lang: improvements?.lang ?? "en" },
  );
}
