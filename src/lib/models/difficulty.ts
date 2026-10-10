/**
 * How hard is this turn? — the one question Auto routing needs answered
 * before it can pick a model, answered without spending a model call.
 *
 * Three levels, not a score: a score invites tuning and a level invites a
 * sentence. `light` is a turn a cheap model answers as well as a frontier
 * one (a greeting, a lookup, "add milk to my list"); `heavy` is one where
 * the difference shows (code, strategy, law, anything the person asked to be
 * thought about carefully); `standard` is everything else. The reason is
 * returned so the footer can say "light turn — a short question" and the
 * person can disagree by picking a model.
 *
 * A keyword heuristic, deliberately, and ported in spirit from OrangeCat's
 * message-complexity.ts (which learned the hard way that a table about code
 * and law scores "what do you think of this idea" as trivial). Explicit asks
 * win over everything: "think hard" is heavy whatever the length, "quick"
 * is light.
 */
export type Difficulty = "light" | "standard" | "heavy";

export type DifficultyVerdict = { level: Difficulty; reason: string };

/** The person said so. Checked first; nothing else can override these. */
const ASK_HEAVY =
  /\b(think (hard|carefully|deeply|it through)|carefully|thorough(ly)?|in depth|deep dive|rigorous|step by step)\b/i;
const ASK_LIGHT = /\b(quick(ly)?|just|briefly|one[- ]liner|short answer|tl;?dr|yes or no)\b/i;

/** Phrases whose presence makes a turn hard for a small model. Weights are modest: two should clear heavy, one should not. */
const HEAVY_SIGNS: ReadonlyArray<[RegExp, number, string]> = [
  [/```/, 2, "contains code"],
  [
    /\b(debug|refactor|algorithm|stack ?trace|race condition|typescript|python|sql|regex)\b/i,
    1,
    "code",
  ],
  [
    /\b(architect(ure)?s?|trade-?offs?|pros and cons|strategy|roadmap|business model|competitor|scal(e|es|ing)|migrat(e|ion))\b/i,
    1,
    "a judgement call",
  ],
  [/\b(legal|contract|medical|tax|financial|compliance|gdpr)\b/i, 1, "a professional domain"],
  [
    /\b(what do you think|how would you|what would you|should i|am i missing|is it worth)\b/i,
    1,
    "an opinion asked for",
  ],
  [/\b(analy[sz]e|evaluate|assess|compare|critique|review|prove|derive)\b/i, 1, "analysis"],
  [/\b(write|draft|essay|article|proposal|plan|design|spec)\b/i, 1, "writing to be done"],
  [/\b(research|thesis|literature|study|paper)\b/i, 1, "research"],
];

/** Shapes of a turn a cheap model handles as well as any. */
const LIGHT_SHAPES: ReadonlyArray<[RegExp, string]> = [
  [
    /^(hi|hello|hey|thanks|thank you|ok|okay|cheers|good (morning|evening|night))\b[^?]{0,40}$/i,
    "a greeting",
  ],
  [/^(add|put|note|remind me|remember)\b.{0,160}$/i, "a capture"],
  [
    /^(what time|what'?s the (time|date|weather)|when is|where is|how many)\b.{0,120}$/i,
    "a lookup",
  ],
  [/^(translate|spell|define|what does .{1,40} mean)\b.{0,160}$/i, "a word question"],
];

const LONG_CHARS = 1500;
const MEDIUM_CHARS = 500;
const SHORT_CHARS = 120;
const LONG_HISTORY_CHARS = 16_000;

export function difficultyOf(
  message: string,
  history: ReadonlyArray<{ role: string; content: string }> = [],
): DifficultyVerdict {
  const text = message.trim();
  if (ASK_HEAVY.test(text)) return { level: "heavy", reason: "you asked for care" };
  if (ASK_LIGHT.test(text) && text.length < MEDIUM_CHARS) {
    return { level: "light", reason: "you asked for a quick one" };
  }

  let weight = 0;
  const reasons: string[] = [];
  for (const [re, w, why] of HEAVY_SIGNS) {
    if (re.test(text)) {
      weight += w;
      reasons.push(why);
    }
  }
  if (text.length > LONG_CHARS) {
    weight += 2;
    reasons.push("a long brief");
  } else if (text.length > MEDIUM_CHARS) {
    weight += 1;
    reasons.push("several sentences");
  }
  const numbered = (text.match(/^\s*\d+[.)]\s/gm) ?? []).length;
  if (numbered >= 3) {
    weight += 1;
    reasons.push("a numbered list of asks");
  }
  const historyChars = history.reduce((n, m) => n + m.content.length, 0);
  if (historyChars > LONG_HISTORY_CHARS) {
    weight += 1;
    reasons.push("a long conversation behind it");
  }

  if (weight >= 2) return { level: "heavy", reason: reasons.slice(0, 2).join(", ") };
  if (weight === 1) return { level: "standard", reason: reasons[0]! };

  for (const [re, why] of LIGHT_SHAPES) {
    if (re.test(text)) return { level: "light", reason: why };
  }
  if (text.length <= SHORT_CHARS && historyChars <= LONG_HISTORY_CHARS) {
    return { level: "light", reason: "a short question" };
  }
  return { level: "standard", reason: "an ordinary ask" };
}
