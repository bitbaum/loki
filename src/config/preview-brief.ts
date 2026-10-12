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
