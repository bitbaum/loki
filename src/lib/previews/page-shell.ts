/**
 * The frame around every page Loki itself serves inside a preview: the access
 * gate, "not open yet", and the before-and-after tour. Plain HTML, because a
 * preview route answers with the prospect's own files and has no React tree
 * to render into.
 *
 * Colours come from PALETTE.widget — Loki's dark theme, generated from
 * src/app/globals.css: no colour is typed here.
 */
import { escapeHtml } from "@/lib/escape-html";
import { PALETTE } from "@/lib/palette";

/** The fleet's one escaper, under the short name these templates read best with. */
export const esc = escapeHtml;

/** The two widths a Loki page takes: a card for a question, a column for a tour. */
export type ShellWidth = "card" | "column";

export function previewShell(
  title: string,
  body: string,
  opts: { width?: ShellWidth; style?: string; lang?: string } = {},
): string {
  const t = PALETTE.widget;
  const width = opts.width ?? "card";
  return `<!doctype html>
<html lang="${esc(opts.lang ?? "en")}"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>${esc(title)}</title>
<style>
*{box-sizing:border-box}
html,body{min-height:100%;margin:0}
body{display:grid;place-items:${width === "card" ? "center" : "start center"};padding:${width === "card" ? "24px 16px" : "0 0 48px"};background:${t.surface};color:${t.text};font:400 16px/1.55 ${t.fontSans}}
main{width:min(100%,${width === "card" ? "400px" : "1040px"});display:grid;gap:${width === "card" ? "20px" : "32px"};${width === "card" ? "" : "padding:0 16px"}}
h1{margin:0;font-size:24px;font-weight:600;line-height:1.25}
p{margin:0;color:${t.textSecondary}}
a{color:${t.text}}
form{display:grid;gap:10px}
label{font:500 12px ${t.fontMono};letter-spacing:.08em;text-transform:uppercase;color:${t.textTertiary}}
.row{display:flex;gap:8px}
input{flex:1;min-width:0;height:48px;padding:0 14px;border:1px solid ${t.borderDark};border-radius:${t.radiusControl};background:${t.surfaceRaised};color:${t.text};font:500 18px ${t.fontMono};letter-spacing:.1em}
input:focus{outline:2px solid ${t.accent};outline-offset:1px}
button,.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 20px;border:0;border-radius:${t.radiusControl};background:${t.accent};color:${t.inkOnAccent};font:600 15px ${t.fontSans};cursor:pointer;text-decoration:none}
.btn-quiet{background:${t.surfaceRaised};color:${t.text};border:1px solid ${t.borderDark}}
button:disabled{opacity:.6;cursor:progress}
button:focus-visible,.btn:focus-visible{outline:2px solid ${t.text};outline-offset:2px}
.msg{min-height:1.5em;font-size:14px;color:${t.textSecondary}}
.msg.err{color:${t.error}}
${opts.style ?? ""}
</style></head><body><main>${body}</main></body></html>`;
}
