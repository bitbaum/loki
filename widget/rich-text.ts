/**
 * Loki's answers as a few plain blocks — paragraphs, bullet lists, short
 * headings and **bold** — so a model's markdown reads as structure instead of
 * as "* The headline …" with the asterisks left in (heidi.orangecat.ch,
 * 2026-10-09).
 *
 * Pure and tested (scripts/test/widget-rich-text.ts). The output is DATA that
 * conversation.ts turns into text nodes: nothing here is ever HTML, because it
 * renders on someone else's site.
 */

import { h } from "./dom";

export type Span = { text: string; bold?: boolean };
export type Block =
  { kind: "p"; spans: Span[] } | { kind: "h"; spans: Span[] } | { kind: "ul"; items: Span[][] };

/** `**bold**` (and `__bold__`) to spans; everything else stays literal. */
export function parseSpans(line: string): Span[] {
  const out: Span[] = [];
  const re = /\*\*([^*]+)\*\*|__([^_]+)__/g;
  let last = 0;
  for (const m of line.matchAll(re)) {
    if (m.index! > last) out.push({ text: line.slice(last, m.index) });
    out.push({ text: m[1] ?? m[2], bold: true });
    last = m.index! + m[0].length;
  }
  if (last < line.length) out.push({ text: line.slice(last) });
  return out.length ? out : [{ text: line }];
}

const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/;
const HEADING = /^\s*#{1,6}\s+(.*)$/;

export function parseBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  let list: Span[][] | null = null;
  const flushPara = () => {
    if (para.length) blocks.push({ kind: "p", spans: parseSpans(para.join("\n")) });
    para = [];
  };
  const flushList = () => {
    if (list?.length) blocks.push({ kind: "ul", items: list });
    list = null;
  };
  for (const raw of text.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.trimEnd();
    const bullet = BULLET.exec(line);
    const heading = HEADING.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (bullet) {
      flushPara();
      (list ??= []).push(parseSpans(bullet[1]));
    } else if (heading) {
      flushPara();
      flushList();
      blocks.push({ kind: "h", spans: parseSpans(heading[1]) });
    } else if (list && /^\s{2,}\S/.test(raw)) {
      // An indented continuation belongs to the bullet above it.
      list[list.length - 1].push({ text: ` ${line.trim()}` });
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  // A short label on its own line, right above a list ("What works"), is a
  // heading the model wrote without the #.
  return blocks.map((b, i) => {
    const next = blocks[i + 1];
    if (b.kind !== "p" || next?.kind !== "ul") return b;
    const text = b.spans.map((s) => s.text).join("");
    return text.length <= 40 && !text.includes("\n") && !/[.!?…]$/.test(text)
      ? { kind: "h", spans: b.spans }
      : b;
  });
}

/** The blocks as DOM — text nodes and plain elements only, never HTML. */
export function richBody(text: string): HTMLElement {
  const body = h("div", "said rich");
  const spans = (parent: HTMLElement, list: Span[]) => {
    for (const s of list) parent.append(s.bold ? h("b", undefined, s.text) : s.text);
  };
  for (const b of parseBlocks(text)) {
    if (b.kind === "ul") {
      const ul = h("ul");
      for (const item of b.items) spans(ul.appendChild(h("li")), item);
      body.appendChild(ul);
    } else spans(body.appendChild(h("p", b.kind === "h" ? "rh" : undefined)), b.spans);
  }
  return body;
}
