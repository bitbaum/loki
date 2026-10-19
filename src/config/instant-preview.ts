/**
 * The instant preview on /change: a stranger's own site, changed the way they
 * asked, in under a minute — before any account, repository or build.
 *
 * Loki opens the live page in its own browser on the server, photographs it,
 * asks the model for "Show me" edits (the widget's closed vocabulary), applies
 * them there and photographs it again. Nothing reaches the site; the visitor
 * gets two pictures.
 *
 * Unlike the consultation this spends AI on an anonymous visitor, which the
 * owner chose on 2026-10-19 as the price of the first minute. So it is a
 * button, not automatic, and bounded twice: per visitor and for everyone.
 */
export const INSTANT_PREVIEW = {
  path: "/api/site-consult/preview",
  /** Per visitor per hour: a first try and a few rewordings. */
  perVisitor: 5,
  /** Everyone together per hour, so a crowd cannot run up the owner's bill. */
  perHour: 60,
  /** The words sent to the model: the wish plus the fixes kept. */
  askMax: 1000,
  /** Model reply ceiling; the edits are small JSON. */
  maxTokens: 2400,
} as const;

/** What a visitor reads while it works and when it cannot — one place. */
export const INSTANT_PREVIEW_COPY = {
  opening: "Opening your site…",
  drawing: "Drawing the change on your site…",
  button: "Show it on my site",
  again: "Show it again with my new words",
  nowLabel: "Now",
  afterLabel: "With the change",
  slider: "Slide to compare now and with the change",
  note: "A preview in Loki’s browser only — your site is untouched.",
  busy: "Lots of people are trying this right now. Try again in a few minutes — or build it below.",
  limited: "That is a lot of previews in an hour. Try again later — or build it below.",
  noPicture:
    "Loki could not open your site in its browser just now, so there is no picture. You can still build it below.",
  noChange:
    "Loki could not draw that change on the page itself — it needs a real build. Build it below.",
  failed: "Something went wrong drawing the preview. Try again, or build it below.",
} as const;
