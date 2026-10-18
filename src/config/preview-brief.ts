import { IMPROVEMENTS_FILE, LOKI_PATH, improvementsInstruction } from "@/lib/previews/improvements";

/**
 * The brief an agent gets when Loki builds a preview for someone. Every rule
 * here was learned building the first one (a DJ's site, 2026-10) and finding,
 * on a phone, what a desktop check had missed. Change the standard here and
 * every future preview follows it.
 */
export const PREVIEW_BUILD_RULES = [
  "Research first, from public sources only: their own site, social profiles, music or shop platforms, press, registries. List every source you used in SOURCES.md in this folder.",
  "Never invent facts, quotes, prices, dates, reviews or numbers. Where something real is missing (a booking email, upcoming dates, opening hours), show it as 'Coming soon' rather than making it up, and list it under 'Missing' in SOURCES.md.",
  "Use only material that is about this person or business and already public. Credit photos to where they came from in SOURCES.md.",
  "Build a static site in this folder. index.html is the entry. Put files in img/, media/ and assets/ and refer to them with relative paths (img/photo.jpg), never absolute ones: the preview is served under /p/<name>/.",
  "No build step and no frameworks unless the site truly needs one. Fonts may load from Google Fonts; everything else ships in the folder.",
  "Give the site its own identity drawn from their world: their colours, their imagery, their vocabulary. Do not reuse another preview's look.",
  "Images: every <img> has width and height attributes AND CSS `height:auto` (or an explicit aspect-ratio box) so it can never stretch. Prefer a photo of the person or place over decoration.",
  // The rules above made previews correct; these make them good. Center SOM's
  // preview passed every one of them and the owner still called it cramped and
  // not beautiful: text ran to the screen's edge and the headline was a
  // five-line search-engine title (2026-10-18).
  "Design to a standard, not just to correctness — the owner judges it on a phone in seconds. Every section has a page gutter: nothing touches the screen edge (at least 20px each side on a phone; on wide screens content sits in a centred column, and running text is never wider than about 65 characters).",
  "Type: body text at least 17px on phones with line-height about 1.6; at most two typefaces and four or five sizes. A headline is a few words (eight at most) that a visitor reads at a glance, never a search-engine title — keyword-rich wording belongs in <title> and the meta description, the detail in the paragraph under the headline.",
  "Space: one spacing scale (multiples of 8px) used everywhere; generous room between sections (at least 64px on a phone) and clear room between a heading, its text and its buttons. One primary button per screen; secondary actions look secondary. Their brand colour is the accent, not the background of everything.",
  "Photos are large, sharp and cropped to consistent shapes (object-fit: cover); a section with nothing to show is shorter, not padded with decoration.",
  "Look before you say it is done. Take a screenshot of every page you built at 390 and at 1440 pixels wide with the headless Chromium on this machine (find it with `ls -d ~/.cache/ms-playwright/chromium-*/chrome-linux*/chrome | tail -1`, then run it with `--headless=new --hide-scrollbars --window-size=390,2400 --screenshot=/tmp/look.png file://<page>`), open each picture and judge it against the rules above as the owner would. Fix what is cramped, crowded, plain or misaligned, then look again. A page you have not looked at is not finished.",
  "Phones first. Check the page at 320, 390, 768 and 1440 pixels wide: no sideways scrolling, every tap target at least 44px, no text cut off, no grid with an empty or orphaned last cell.",
  "Every link works: outbound links open the real profile; in-page anchors land under any sticky header.",
  "Do not add a feedback button or any Loki script: Loki adds its widget to every page itself when it serves the preview.",
  "Commit to this folder's local git repository with a message saying what you built. Do not add a remote and do not push: this folder is not a repository on GitHub until the person says yes.",
] as const;

export function previewBuildPrompt(opts: { name: string; about?: string; previewUrl: string }) {
  const about = opts.about?.trim();
  return [
    `Build a website preview for ${opts.name}. They are not a customer yet: this is the first version we show them, to win them as one.`,
    about ? `What we know so far: ${about}` : "",
    "",
    "Rules:",
    ...PREVIEW_BUILD_RULES.map((rule, i) => `${i + 1}. ${rule}`),
    "",
    `When you are done, the preview is at ${opts.previewUrl} (behind the studio's access code). End with a short note: what you built, what you could not find, and what they should be asked.`,
  ]
    .filter((line, i, all) => line !== "" || all[i - 1] !== "")
    .join("\n");
}

/**
 * The rules for a preview that starts FROM a live website (/change "Improve
 * this site" or "Make my own, inspired by it"). The preview rules above apply,
 * except the first: the source is the site the person named, not a research
 * trip. A refresh also writes down what changed (improvements.json), because
 * the person it is for has to SEE the improvement — Loki photographs the live
 * page and the new one side by side from that file; two sites compared from
 * memory is not seeing it.
 */
export const WEBSITE_PREVIEW_RULES = {
  refresh: [
    "Start from the live site: read every page listed below (and any others its navigation reaches), and bring over its real content — texts, photos, logo, contact details, opening hours, prices. Download the images you reuse into img/. List every page and source you used in SOURCES.md.",
    "A preview is a first impression, not a migration. Build the homepage and the pages a visitor actually uses — what they sell or do, prices, about, delivery or opening hours, contact — with their real content, and make those pages genuinely better. When the live site is large (a shop with a catalogue of thousands of items), show its main sections with a handful of real items each and let every other link say, in the site's own language, that it is coming. Keep each page at the live site's own path (the live /o-nas becomes o-nas/index.html here) so the new site reads as the same site, improved.",
    improvementsInstruction(),
  ],
  inspired: [
    "Read the reference site for ideas only, as the request says. Write every word fresh for this person's purpose and use original, generated or properly licensed images. List what you took as inspiration, and from where, in SOURCES.md.",
  ],
} as const;

/** The before-and-after tour Loki serves next to a preview's entry page. */
export function beforeAfterUrl(previewUrl: string): string {
  const base =
    /\.html?$/i.test(previewUrl) || previewUrl.endsWith("/") ? previewUrl : `${previewUrl}/`;
  return new URL(`${LOKI_PATH}/before-after`, base).toString();
}

export function websitePreviewPrompt(opts: {
  request: string;
  mode: keyof typeof WEBSITE_PREVIEW_RULES;
  previewUrl: string;
}) {
  const rules = [...WEBSITE_PREVIEW_RULES[opts.mode], ...PREVIEW_BUILD_RULES.slice(1)];
  return [
    opts.request,
    "",
    "Rules:",
    ...rules.map((rule, i) => `${i + 1}. ${rule}`),
    "",
    opts.mode === "refresh"
      ? `When you are done, the new version is at ${opts.previewUrl} and Loki shows the owner the before-and-after tour at ${beforeAfterUrl(opts.previewUrl)}, drawn from your ${IMPROVEMENTS_FILE} (both behind the studio's access code). End with a short note: the three improvements the owner will notice most, what you could not bring over, and what they should be asked.`
      : `When you are done, the preview is at ${opts.previewUrl} (behind the studio's access code). End with a short note: what you built, what was inspired by the reference, and what they should be asked.`,
  ].join("\n");
}
