/**
 * Vision preflight for Loki image attachments — turns screenshots into
 * actionable text the chat brain and terminal agents can use.
 *
 * Model choice is a CHAIN, not a pin (config/vision-models.ts). The previous
 * hardcoded Groq model was decommissioned and every attached image 404'd; a
 * single pinned free model is a scheduled outage, so the provider chain and the
 * `probe:models` check exist to make the next rot loud instead of silent.
 */
import { analyzeImages } from "@/lib/vision";
import type { ImageAttachment } from "@/lib/loki/attachments";
import { SCREENSHOT_SHOWN_PREFIX } from "@/lib/project-mention";

// The first line is read by code, not only by people: it is how a screenshot
// sent with "fix this" and no project picked finds the project it is of
// (projectShownInScreenshot). Keep the prefix in step with SCREENSHOT_SHOWN_PREFIX.
const SYSTEM = `You analyze UI screenshots and error states for a developer using an AI agent fleet.
Start with exactly one line: "${SCREENSHOT_SHOWN_PREFIX} <the app or website the screenshot is of — its name, and any URL or domain visible — or "unknown">".
Then be concrete: visible bugs, layout issues, clipped elements, error messages, and what to change in code.
No hype, no preamble. Use short paragraphs or bullets.`;

export async function describeAttachedImages(
  images: ImageAttachment[],
  userText: string,
): Promise<string> {
  if (images.length === 0) return "";

  const question =
    userText.trim() ||
    "The user attached screenshot(s) without a question. Describe what's wrong or notable and suggest fixes.";

  try {
    const { text, model } = await analyzeImages({
      systemPrompt: SYSTEM,
      prompt: question,
      images: images.map((img) => ({
        mimeType: img.mimeType,
        dataBase64: img.dataBase64,
        name: img.name,
      })),
      maxTokens: 900,
      timeoutMs: 45_000,
    });

    // The model is named in the block because this analysis is the ONE part of
    // a Loki turn that is not grounded in Loki's records — it is a model's
    // reading of a picture. Saying which model read it keeps that visible rather
    // than letting it blend into the cited answer around it.
    const blocks = images.map((img) => img.name).join(", ");
    return `\n\n--- Attached image analysis (${blocks}, via ${model}) ---\n${text}`;
  } catch (e) {
    const msg = e instanceof Error ? e.message : "vision failed";
    return `\n\n[Could not analyze attached image(s): ${msg}. Describe the issue in words or try a smaller screenshot.]`;
  }
}
