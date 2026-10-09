/**
 * The shape of the composer's model menu.
 *
 * Lives here rather than in the route so a CLIENT component can name the type
 * without importing a server route module. A type-only import is erased at
 * build time and would have worked, but it puts a route in the import graph of
 * a bundle that must never reach for one — and the next person to add a
 * non-type import to that line would get no warning at all.
 */

export type LokiModelOption = {
  /** The `model` value to send back with a message. */
  id: string;
  /** The model name on its own, for the row. */
  label: string;
  /** Vendor, for the row's subtitle and grouping. */
  provider: string;
  /** False = listed but not selectable, with `reason` saying why. */
  usable: boolean;
  reason?: string;
  /** True for a model on the user's own key (Settings → AI). */
  own?: boolean;
};

export type LokiModelsResponse = {
  /** The user's own models first, then the server's chain, in order. */
  options: LokiModelOption[];
  /** The model the chain would start at on "Auto", for the Auto row's subtitle. */
  autoStartsAt: string | null;
  /** Where to add a key for a vendor this server has none for. */
  addKeyHref: string;
};

/**
 * A model id as a person reads it: a name and one line on what it is for.
 *
 * The menu used to print raw vendor ids — `openai/gpt-oss-120b`, `:free`
 * suffixes and all — which answer "which one should I pick?" with plumbing.
 * Known families get a written line; anything new still reads cleanly from
 * its id, so a vendor adding a model never shows up as a blank row.
 */
export function describeChatModel(id: string): { name: string; blurb: string } {
  const bare = id
    .split("/")
    .pop()!
    .replace(/:free$/, "");
  const known: [RegExp, string, string][] = [
    [/gpt-oss-120b/, "GPT-OSS 120B", "The strongest open model here — for real work"],
    [/gpt-oss-20b/, "GPT-OSS 20B", "Quick answers, light on budget"],
    [/qwen/i, "", "Good all-rounder, careful with code"],
    [/llama-4|scout|maverick/i, "", "Reads screenshots as well as text"],
    [/llama/i, "", "Fast and dependable for everyday questions"],
    [/deepseek/i, "", "Strong at reasoning and code"],
    [/kimi/i, "", "Long context — whole files at once"],
  ];
  const pretty = bare
    .split(/[-_]/)
    .map((part) =>
      /^\d+(\.\d+)?b$/i.test(part)
        ? part.toUpperCase()
        : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(" ");
  for (const [re, name, blurb] of known) if (re.test(bare)) return { name: name || pretty, blurb };
  return { name: pretty, blurb: "Open model on the free chain" };
}
