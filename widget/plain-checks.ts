/**
 * What the page checks found, said for a person.
 *
 * page-checks.ts writes each finding the way a builder needs it — "2 tap
 * target(s) are under 24px and crowded by their neighbours, easy to mis-tap
 * (e.g. button “Computed…” at 7×48)" — and that text stays the request a fix
 * is built from, and the key a finding is recognised by (checksSignature).
 * Shown to the owner as it was, it read as jargon (owner, 2026-10-18: "make it
 * easy to understand"). This says the same finding in plain words; anything it
 * does not recognise passes through unchanged.
 */

const n = (count: string, one: string, many: string) => `${count} ${count === "1" ? one : many}`;
const eg = (example: string | undefined) => (example ? ` — for example ${example}` : "");

const RULES: Array<[RegExp, (m: RegExpMatchArray) => string]> = [
  [
    /^The page is \d+px wider than the screen/,
    () => "On a phone the page is wider than the screen, so it slides sideways",
  ],
  [
    /^(\d+) button\(s\)\/link\(s\) have no name a screen reader can read(?: \(e\.g\. (.+)\))?$/,
    (m) =>
      `${n(m[1], "button or link has", "buttons or links have")} no name, so a screen reader can only say “button”${eg(m[2])}`,
  ],
  [
    /^(\d+) form field\(s\) have no label/,
    (m) =>
      `${n(m[1], "form field has", "form fields have")} no label, so people can lose track of what to type`,
  ],
  [
    /^(\d+) tap target\(s\) are under \d+px and crowded by their neighbours, easy to mis-tap(?: \(e\.g\. (.+) at \d+\u00D7\d+\))?$/,
    (m) =>
      `${n(m[1], "button is", "buttons are")} small and close to others, so a thumb easily hits the wrong one${eg(m[2])}`,
  ],
  [
    /^(\d+) image\(s\) have no alt text/,
    (m) =>
      m[1] === "1"
        ? "1 picture has no description for people who cannot see it"
        : `${m[1]} pictures have no description for people who cannot see them`,
  ],
  [/^(\d+) image\(s\) failed to load/, (m) => `${n(m[1], "picture does", "pictures do")} not load`],
  [
    /^The page has no main heading/,
    () => "The page has no main title, so it never says what it is about",
  ],
  [
    /^The page has (\d+) main headings/,
    (m) => `The page has ${m[1]} main titles, so none of them is clearly the one`,
  ],
  [
    /^The page does not declare its language/,
    () =>
      "The page does not say which language it is in, so screen readers may read it with the wrong accent",
  ],
  [
    /^(\d+) piece\(s\) of text are under \d+px(?: \(e\.g\. (.+) at [\d.]+px\))?$/,
    (m) =>
      `${n(m[1], "bit of text is", "bits of text are")} too small to read comfortably${eg(m[2])}`,
  ],
];

export function plainCheck(check: string): string {
  for (const [re, say] of RULES) {
    const m = check.match(re);
    if (m) return say(m);
  }
  return check;
}
