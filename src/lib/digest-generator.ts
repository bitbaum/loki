// Shared digest-generation pipeline: take a per-user window + project filter,
// pull the activity, call Groq for a reader-friendly markdown summary, return
// both the markdown and the raw stats so callers can compose (email subject
// line, in-page render, agent context, etc.).
//
// Used by /api/activity/digest only — the on-demand UI button. The daily email
// cron no longer calls it: a timer may not spend the shared free tier.

import { callGroqText, GROQ_FAST_MODEL } from "@/lib/groq";
import { getProjectDigest, type ProjectDigest } from "@/db/queries/digests";
import { buildDigestUserPrompt } from "@/lib/digest-input";
import { HTTP_TIMEOUT_MS } from "@/lib/constants/time";

/**
 * The report's voice.
 *
 * Two failure modes to design against, and the old prompt hit both. It asked
 * for an "executive-style" summary, which produced management filler nobody
 * reads twice ("the fleet continued to make progress across several
 * projects"). And it never demanded specifics, so the model padded — because
 * the input it was given (see digest-input.ts) contained nothing specific to
 * cite.
 *
 * What a good one reads like: a sharp colleague who actually watched the
 * overnight run telling you what matters in sixty seconds. Concrete nouns,
 * real numbers, named projects, a clear "here is what I would do next" — and
 * the confidence to say "quiet night, nothing to report" when that is the
 * truth, rather than inflating three events into a narrative.
 */
export const DIGEST_SYSTEM_PROMPT = `You are the operator of a fleet of AI coding agents, writing the shift report for the person who owns the projects. You watched the whole window. Now tell them what matters.

You are given real events. Each says what was ASKED for, what the agent REPORTED doing, what it says is NEXT, how long it took, and how it ENDED (done / failed / timed out / still running). You also get the previous window's volume, so you can say whether the fleet is speeding up or stalling.

Write markdown, in this order. Omit any section that would be empty — never print a heading with "none" under it.

**Headline:** one sentence, under 20 words, naming the single most consequential thing that happened. If something broke, that is the headline, not the successes.

## Needs you
Only when something failed, stalled, or is blocked. One bullet each: name the project in bold, say what broke in plain words using the recorded error, and end with the specific next action. If the recorded error names a cause (an agent that never started generating, a missing credential, a timeout), say that cause — do not restate "the run failed".

## Shipped
What actually got done, one bullet per project, quoting the agent's own reported work. Lead with the most substantial. This is the section that tells someone their fleet is worth running — make it concrete, never "made progress on X".

## Still running
Anything in flight, with how long it has been going. Flag anything that has run far longer than that project's other runs.

## What I'd do next
Two or three sentences, maximum. Draw on the agents' own recorded next steps and on any pattern you can see across the window: a project failing repeatedly, one that has gone quiet, an obvious sequencing choice. Be opinionated and specific — name the project and the action. This is the most valuable part of the report; do not waste it restating the sections above.

Rules:
- Specific beats complete. "truthseeker timed out after 1h — the agent was injected but never started generating" earns its line; "3 runs failed" does not.
- Use ONLY the supplied facts. Never invent a cause, a file, or work that is not in the data. If the data does not say why something failed, say that it does not say.
- Name projects exactly as given. Numbers exactly as given.
- Plain, direct sentences. No corporate register, no "leveraged", no "continued to", no emojis, no exclamation marks.
- Do not congratulate. State what happened and let it stand.
- A quiet window gets a short report: the headline, and one line saying it was quiet. Never pad three events into a narrative.`;

export type GeneratedDigest = {
  digest: ProjectDigest;
  markdown: string;
  model: string;
  generatedAt: string;
};

const STATIC_EMPTY_MARKDOWN = (windowLabel: string) =>
  `**Headline:** No activity in the window.\n\nNothing was dispatched or finished in the last ${windowLabel}. Pick a wider window or dispatch a prompt from the Control panel.`;

// Generate a digest. Returns a static "no activity" markdown when the window
// is empty (skips the Groq call — no signal, no spend).
export async function generateDigest({
  userId,
  window,
  project,
  windowLabel,
}: {
  userId: string;
  window: string;
  project: string | null;
  windowLabel: string;
}): Promise<GeneratedDigest> {
  const digest = await getProjectDigest(userId, { window, projectKey: project });

  if (digest.events.length === 0) {
    return {
      digest,
      markdown: STATIC_EMPTY_MARKDOWN(windowLabel),
      model: "static",
      generatedAt: new Date().toISOString(),
    };
  }

  const userPrompt = buildDigestUserPrompt({
    events: digest.events,
    projectKey: digest.projectKey,
    windowLabel,
    previousCount: digest.previousCount,
  });
  const markdown = await callGroqText(userPrompt, {
    feature: "activity-digest",
    systemPrompt: DIGEST_SYSTEM_PROMPT,
    maxTokens: 900,
    temperature: 0.3,
    timeoutMs: HTTP_TIMEOUT_MS,
  });

  return {
    digest,
    markdown,
    model: GROQ_FAST_MODEL,
    generatedAt: new Date().toISOString(),
  };
}
