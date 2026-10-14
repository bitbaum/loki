/**
 * The plan as the first build reads it: one instruction block naming each
 * planned package, how to install it, what to use it for and what not to
 * write instead — plus, for client work, how the site keeps the starter's
 * token structure while wearing the client's brand.
 *
 * Small on purpose. The fleet brief already lists every package with a line
 * of description; this block only says WHICH of them this site uses and for
 * what, under KIT_PLAN_BLOCK_MAX_CHARS. A plan that would not fit is cut at a
 * whole line and says how many it left out, never truncated mid-instruction.
 *
 * Pure: no network, no database.
 */
import { KIT_PLAN_BLOCK_MAX_CHARS } from "@/config/kit-plan";
import type { KitPlan, PlannedKit } from "./plan";

const OVERFLOW_LINE_MAX = 170;

export const KIT_PLAN_HEADING = "BUILT FROM (the fleet's shared packages this site uses):";

function kitLine(kit: PlannedKit): string {
  const how = kit.inStarter
    ? "Already in the starter."
    : kit.install
      ? `Install: ${kit.install}.`
      : "Install it as fleet SHARED.md says.";
  return `- ${kit.plain}: ${kit.name}, for ${kit.use}. ${how} Do not write your own ${kit.avoid}.`;
}

/** The block for a kickoff prompt, or "" when nothing is planned. */
export function renderKitPlanBlock(plan: KitPlan, max = KIT_PLAN_BLOCK_MAX_CHARS): string {
  if (plan.kits.length === 0) return "";
  const head = `${KIT_PLAN_HEADING}\nWire these into the features they name instead of writing those features yourself.`;
  const tail =
    "If one cannot do what this site needs, say so in your handoff rather than writing a replacement.";
  const lines: string[] = [];
  let used = head.length + tail.length + 2;
  for (const [i, kit] of plan.kits.entries()) {
    const line = kitLine(kit);
    const left = plan.kits.length - i - 1;
    // Reserve room for the "also planned" line unless this is the last kit.
    const reserve = left > 0 ? OVERFLOW_LINE_MAX + 1 : 0;
    if (used + line.length + 1 + reserve > max) {
      const skipped = plan.kits.slice(i).map((k) => k.name);
      lines.push(
        `- Also planned, see fleet SHARED.md for each: ${skipped.join(", ")}`.slice(
          0,
          OVERFLOW_LINE_MAX,
        ),
      );
      break;
    }
    lines.push(line);
    used += line.length + 1;
  }
  return [head, ...lines, tail].join("\n");
}

/**
 * Client work wears the client's brand. Follows the starter's own instruction
 * (fleet templates/app app/globals.css and tailwind.config.mjs) and fleet
 * SHARED.md's design-tokens row: a client's site must never install
 * @bitbaum/design-tokens, because a retheme of our brand would repaint theirs.
 */
export const CLIENT_TOKENS_BLOCK = [
  "CLIENT WORK — this site belongs to a client, so it wears the client's brand, not bitbaum's.",
  "The starter imports @bitbaum/design-tokens, which is our own look. Keep the token STRUCTURE and replace the VALUES:",
  '- app/globals.css: replace `@import "@bitbaum/design-tokens/tokens.css"` with the client\'s own tokens file defining the same variables.',
  "- tailwind.config.mjs: replace the @bitbaum/design-tokens/tailwind-preset with the client's own preset that maps the SAME semantic names (bg-surface-page, text-fg-primary, bg-accent, text-on-accent, font-display, …), so no component changes.",
  "- Then remove @bitbaum/design-tokens from package.json: a client's site must never install it (fleet SHARED.md, design-tokens row). Use the client's colours and faces; where none are given yet, choose neutral ones and say so in your handoff.",
].join("\n");

/** Everything the kit plan adds to a kickoff prompt: the plan, then the client's tokens. */
export function renderKickoffKitBlocks(plan: KitPlan, opts: { clientTokens: boolean }): string {
  return [renderKitPlanBlock(plan), opts.clientTokens ? CLIENT_TOKENS_BLOCK : ""]
    .filter(Boolean)
    .join("\n\n");
}
