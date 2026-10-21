/**
 * Terminal REPORTS are the bytes a terminal emulator sends back when a program
 * asks it something: Device Attributes (`ESC[c` → `ESC[?1;2c`), cursor
 * position (`ESC[6n` → `ESC[12;40R`), DECRQM, kitty keyboard flags, OSC colour
 * queries, XTVERSION. xterm.js answers these through `onData`, the same event
 * that carries keystrokes.
 *
 * An agent PTY can have any number of viewers (Watch, Terminal, a phone), and
 * every viewer that replays the ring buffer answers every query in it again.
 * Forwarded as "keys", those answers land in the agent's composer as text: the
 * 2026-10-21 Substrata run on Antigravity (Gemini CLI) sat 14 minutes with
 * `1;2c1;2c1;2c…` growing in its input and the task prompt never submitted.
 *
 * A viewer is not the terminal the agent talks to, so its reports are never
 * input. They are dropped at every boundary keys cross: the browser, the
 * server route and the runner.
 */
// CSI reports: DA1 `ESC[?…c`, DA2 `ESC[>…c`, DA3 `ESC[=…c`, CPR `ESC[r;cR`,
// DSR `ESC[0n`/`ESC[3n`, DECRPM `ESC[?…;…$y`, kitty flags `ESC[?…u`,
// window reports `ESC[…t` with a leading 4/6/8 parameter.
const CSI_REPORT_RE =
  /\x1b\[(?:[?>=][0-9;]*c|[0-9]+;[0-9]+R|[03]n|\??[0-9;]+\$y|\?[0-9]*u|[468];[0-9;]+t)/g;
// OSC colour/palette answers (`ESC]10;rgb:…`, `ESC]11;…`, `ESC]4;n;rgb:…`).
const OSC_REPORT_RE = /\x1b\](?:1[0-9]|4;[0-9]+);rgb:[0-9a-fA-F/]+(?:\x07|\x1b\\)/g;
// DCS answers (XTVERSION `ESC P>|…`, DECRQSS `ESC P1$r…`), terminated by ST.
const DCS_REPORT_RE = /\x1bP(?:>\||[01]\$r|[01]\+r)[^\x1b]*\x1b\\/g;

export function stripTerminalReports(data: string): string {
  if (!data.includes("\x1b")) return data;
  return data.replace(CSI_REPORT_RE, "").replace(OSC_REPORT_RE, "").replace(DCS_REPORT_RE, "");
}

/** The visible residue an answered DA query leaves after a TUI eats its ESC[?
 *  prefix — `1;2c`, `?62;22c` — repeated. Not something an agent said. */
const REPORT_RESIDUE_RE = /\??(?:[0-9]{1,3};)+[0-9]{1,3}c|\?[0-9]{1,3}c/g;

export function stripReportResidue(text: string): string {
  return text.replace(REPORT_RESIDUE_RE, "");
}
