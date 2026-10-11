import preset from "@bitbaum/design-tokens/tailwind-preset";

// Every colour, face, radius and tracking comes from @bitbaum/design-tokens:
// the preset maps utility names (bg-surface-page, text-fg-primary, bg-accent,
// text-on-accent, font-display, …) onto the CSS variables in its tokens.css,
// which app/globals.css imports. Nothing visual is defined here.
//
// A CLIENT-owned app must not keep this preset — a retheme of our brand would
// repaint somebody else's (fleet SHARED.md, design-tokens row). Replace the
// preset and the tokens.css import with the client's own tokens, keeping the
// same semantic names so no component changes.

/** @type {import('tailwindcss').Config} */
const config = {
  presets: [preset],
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
};

export default config;
