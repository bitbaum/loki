/**
 * Claude Code's permission mode as its own screen shows it, this moment.
 *
 * The log records the mode only on a message you send, so after Shift+Tab the
 * sheet said "Changing — the new mode is shown with your next message" while
 * the terminal's footer had already changed ("⏸ manual mode on"); pressing
 * "Next mode" looked like it did nothing (owner, 2026-10-19). The footer is
 * the truth the instant it changes, so the sheet reads it.
 *
 * Pure: give it the screen's lines, bottom last.
 */

/** Footer words → the mode ids the log uses (CLAUDE_MODES keys). Checked in
 *  order; "manual" is how newer Claude Code names the asking mode. */
const FOOTER_MODES: [RegExp, string][] = [
  [/\baccept edits on\b/i, "acceptEdits"],
  [/\bplan mode on\b/i, "plan"],
  [/\bauto(?:-accept)? mode on\b/i, "auto"],
  [/\bbypass(?:ing)? permissions on\b/i, "bypassPermissions"],
  [/\b(?:manual|default|ask) mode on\b/i, "default"],
];

/** A footer that names no mode: the asking mode, which older versions leave unnamed. */
const BARE_FOOTER = /\?\s*for shortcuts\b/i;

/** How far up from the bottom a footer can sit (the input box and its
 *  border, suggestions under it). */
const FOOTER_WINDOW = 12;

export function modeFromFooter(lines: readonly string[]): string | null {
  const tail = lines.slice(-FOOTER_WINDOW);
  for (let i = tail.length - 1; i >= 0; i--) {
    const line = tail[i]!;
    for (const [re, id] of FOOTER_MODES) if (re.test(line)) return id;
    if (BARE_FOOTER.test(line)) return "default";
  }
  return null;
}
