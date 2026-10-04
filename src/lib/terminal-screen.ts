/**
 * Reading what the terminal SHOWS — the rendered xterm buffer, not the byte
 * stream. Two readers need it: the link bar (whole URLs) and the AI summary
 * (what the agent is doing). One definition of "a line on screen" for both.
 */

/** The slice of xterm's IBuffer this needs — so it is testable without a DOM. */
export type ScreenBuffer = {
  length: number;
  getLine(index: number): { translateToString(trimRight?: boolean): string } | undefined;
};

/**
 * The last `windowRows` rows joined back into logical lines.
 *
 * TUI tools HARD-wrap long output to the terminal width with no soft-wrap
 * marker, but the grid is unambiguous: a row whose trimmed text fills the full
 * width continued onto the next row. The window backs up to a logical-line
 * boundary so the first line is never cut in half.
 */
export function logicalLines(buf: ScreenBuffer, cols: number, windowRows: number): string[] {
  const row = (i: number) => buf.getLine(i)?.translateToString(true) ?? "";
  let start = Math.max(0, buf.length - windowRows);
  while (start > 0 && row(start - 1).length === cols) start--;
  const lines: string[] = [];
  let logical = "";
  for (let i = start; i < buf.length; i++) {
    const text = row(i);
    logical += text;
    if (text.length < cols) {
      lines.push(logical);
      logical = "";
    }
  }
  if (logical) lines.push(logical);
  return lines;
}

/**
 * The recent screen as plain text for a model: trailing blank rows dropped,
 * runs of blank lines collapsed, and cut from the TOP to `maxChars` — the
 * newest output is what matters.
 */
export function screenText(lines: string[], maxChars: number): string {
  const kept = lines
    .map((l) => l.trimEnd())
    .filter((l, i, all) => l !== "" || (i > 0 && all[i - 1] !== ""));
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  const text = kept.join("\n");
  return text.length <= maxChars ? text : text.slice(text.length - maxChars);
}
