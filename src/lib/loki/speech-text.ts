import { extractReplies } from "@bitbaum/chatkit";

/**
 * An answer as it should be READ ALOUD.
 *
 * The reference chat has a play button under every answer: on a phone,
 * walking, the answer is heard rather than read. Markdown read literally is
 * noise — "hash hash Summary, asterisk asterisk", a citation "F eight" after
 * every claim — so the text is flattened first. Pure, so it is tested without
 * a voice.
 */

export function plainTextForSpeech(markdown: string): string {
  // Suggested replies are buttons, never words: a quick_replies block is
  // dropped outright rather than announced as "(code)".
  const prose = extractReplies(markdown).text;
  return (
    prose
      // Fenced code is not prose; say that it is there rather than reading it.
      .replace(/```[\s\S]*?```/g, " (code) ")
      .replace(/`([^`]*)`/g, "$1")
      // Citations like [F8] or [D1] are for the eye.
      .replace(/\[(?:[A-Z]{1,2}\d{1,3})\]/g, "")
      // Links: keep the words, drop the URL.
      .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
      .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
      .replace(/https?:\/\/\S+/g, "")
      // Headings, emphasis, quotes, bullets, rules, tables.
      .replace(/^\s{0,3}#{1,6}\s+/gm, "")
      .replace(/^\s*>\s?/gm, "")
      .replace(/^\s*[-*+]\s+/gm, "")
      .replace(/^\s*\d+\.\s+/gm, "")
      .replace(/^\s*[-*_]{3,}\s*$/gm, "")
      .replace(/\|/g, " ")
      .replace(/(\*\*|__)(.*?)\1/g, "$2")
      .replace(/(\*|_)(.*?)\1/g, "$2")
      .replace(/~~(.*?)~~/g, "$1")
      .replace(/[ \t]+/g, " ")
      .replace(/\s*\n\s*\n\s*/g, "\n")
      .trim()
  );
}

/** Which voice language to ask for. Loki's operator dictates in mixed German
 *  and English; a German sentence is detectable cheaply enough by its most
 *  common function words to pick the voice, and the browser's default
 *  otherwise. */
export function guessSpeechLang(text: string, fallback = "en"): string {
  const sample = text.toLowerCase().slice(0, 600);
  const german = (
    sample.match(/\b(und|nicht|das|ist|ich|mit|für|auf|eine?|der|die|sind|wird|noch|auch)\b/g) ?? []
  ).length;
  const english = (
    sample.match(/\b(and|not|the|is|with|for|on|a|an|are|will|also|this|that)\b/g) ?? []
  ).length;
  if (german > english && german >= 3) return "de";
  if (english >= 3) return "en";
  return fallback;
}
