/**
 * Loki's tool registry — the SSOT for what Loki can actually do.
 *
 * Why Loki gets its own tools at all. Until now Loki was a thin proxy to the
 * OpenClaw `main` agent, whose tool root is `~/.openclaw/workspace/`. Asked who
 * to contact, it grepped a schema-less JSON blob there and narrated the
 * incidental matches as attributes — reporting a contact as "Ilya Druzhnikov
 * (UZH)" when UZH is the substring inside drUZHnikov. Loki's own `people`
 * table, which is authoritative, was invisible to it.
 *
 * You cannot constrain an agent whose retrieval you do not own. So retrieval
 * moves in-app: these tools read Loki's tables directly, and the gateway
 * is demoted to ONE tool among them, whose output is explicitly untrusted.
 *
 * THE INVARIANT THAT MAKES THIS SAFE: every tool returns `Fact[]`, never prose.
 * A tool result therefore enters the same grounding contract as everything else
 * — declared fields, `<not recorded>` for gaps, a citation id, and the
 * post-generation verifier. A tool that returned a formatted string would be an
 * unverifiable hole straight through the harness, so `ToolResult` has no such
 * escape hatch. Keep it that way.
 *
 * Two kinds, and the split is a safety boundary:
 *   read     — pure lookups. Free to run, run automatically, never confirmed.
 *   propose  — enqueue into the approval queue. Loki never decides for itself
 *              whether something runs: it lands as a DRAFT and waits for the
 *              operator, unless the operator has already said yes in advance
 *              for that type (lib/actions/standing-approval.ts — calendar
 *              events and commitments only, both private and reversible).
 *              There is deliberately no `execute` kind. A tool that acted on
 *              its own authority, rather than on an authorisation the operator
 *              gave at some point, would be a product decision, not a refactor.
 */
import { z } from "zod";
import type { Fact } from "@bitbaum/ai-kit/grounding";

/** Read = lookup. Propose = enqueue a draft for the operator to approve. */
export type ToolKind = "read" | "propose";

export type ToolContext = {
  userId: string;
  /** The operator's original message, for tools that need the raw query. */
  message: string;
};

export type ToolResult = {
  /** Records retrieved or created. The ONLY channel back into the answer. */
  facts: Fact[];
  /**
   * One line the model sees in place of an empty result — "no people matched
   * 'Elena'". Never a substitute for facts, and never carries data of its own:
   * it exists so an empty result is legible as an ANSWER rather than as a
   * failure the model feels obliged to paper over.
   */
  note?: string;
};

export type ToolDef<S extends z.ZodTypeAny = z.ZodTypeAny> = {
  name: string;
  kind: ToolKind;
  /** Shown to the model. One line, imperative, says when to reach for it. */
  description: string;
  /** Argument schema — also rendered into the catalog the model reads. */
  params: S;
  /** A copyable example call. See CATALOG note on why this is not optional. */
  example: string;
  handler: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolResult>;
};

/** Registry type — a map so lookup is O(1) and names cannot duplicate. */
export type ToolRegistry = Record<string, ToolDef>;

/**
 * Define a tool with its argument type inferred from its own zod schema.
 *
 * The registry stores tools erased to `ToolDef`, because a heterogeneous map
 * cannot carry each entry's schema type. Without this helper every handler
 * would receive `unknown` and each one would re-cast — the same cast written
 * eight times, each an opportunity to cast to the wrong shape. Here the cast
 * happens once, at the only place where the schema and the handler are both in
 * scope and TypeScript can still check them against each other.
 */
export function defineTool<S extends z.ZodTypeAny>(def: {
  name: string;
  kind: ToolKind;
  description: string;
  params: S;
  example: string;
  handler: (args: z.infer<S>, ctx: ToolContext) => Promise<ToolResult>;
}): ToolDef {
  return def as unknown as ToolDef;
}

/**
 * Render the tool catalog for the model.
 *
 * Each entry carries a COPYABLE example call, not a prose description of the
 * format. This is not stylistic: measured across this fleet's agent runs, a
 * field shown as a copyable line was emitted correctly ~97% of the time, while
 * the same requirement described in prose was honoured about 3% of the time.
 * Weak models reproduce the shape they are shown. Show the shape.
 */
export function renderToolCatalog(registry: ToolRegistry): string {
  const lines = Object.values(registry).map((t) => {
    const shape = describeParams(t.params);
    return [
      `### ${t.name}${t.kind === "propose" ? "  (proposes a draft — needs the operator's approval)" : ""}`,
      t.description,
      shape ? `Arguments: ${shape}` : "Arguments: none",
      `Example:`,
      t.example,
    ].join("\n");
  });
  return lines.join("\n\n");
}

/**
 * Flatten a zod object schema to `key: type (optional)` — enough for the model
 * to fill correctly without shipping a full JSON Schema, which costs tokens
 * that small models spend badly. Non-object schemas render as "" (no args).
 */
function describeParams(schema: z.ZodTypeAny): string {
  const def = schema as unknown as { shape?: Record<string, z.ZodTypeAny> };
  const shape = typeof (schema as { shape?: unknown }).shape === "object" ? def.shape : undefined;
  if (!shape) return "";
  return Object.entries(shape)
    .map(([key, value]) => {
      const v = value as unknown as { isOptional?: () => boolean; _def?: { typeName?: string } };
      const optional = typeof v.isOptional === "function" && v.isOptional();
      const typeName =
        String(v._def?.typeName ?? "")
          .replace(/^Zod/, "")
          .toLowerCase() || "string";
      return `${key}: ${optional ? `${typeName}?` : typeName}`;
    })
    .join(", ");
}

/** Names the model is allowed to call — the closed set the parser validates against. */
export function toolNames(registry: ToolRegistry): string[] {
  return Object.keys(registry);
}

/**
 * OpenAI-style function specs, for providers with native tool calling.
 * Derived from the same registry as the text catalog so the two protocols can
 * never advertise a different tool set — the drift that would let a model call
 * something the executor does not have.
 */
export function toOpenAITools(registry: ToolRegistry): Array<Record<string, unknown>> {
  return Object.values(registry).map((t) => ({
    type: "function",
    function: {
      name: t.name,
      // The first sentence only. The full description is already in the text
      // catalog the model reads; repeating it here charged ~1000 tokens per
      // call for the second copy, on the vendor with the smallest window.
      description: t.description.split(/(?<=\.)\s+/)[0] ?? t.description,
      parameters: zodToJsonSchema(t.params),
    },
  }));
}

/**
 * Minimal zod → JSON Schema for the flat, single-level argument objects these
 * tools take. Deliberately not a general converter: a tool needing nested or
 * union arguments is a tool a small model will call wrongly, so the limitation
 * is a design constraint worth keeping visible rather than engineering away.
 */
function zodToJsonSchema(schema: z.ZodTypeAny): Record<string, unknown> {
  const shape = (schema as unknown as { shape?: Record<string, z.ZodTypeAny> }).shape;
  if (!shape) return { type: "object", properties: {} };
  const properties: Record<string, unknown> = {};
  const required: string[] = [];
  for (const [key, value] of Object.entries(shape)) {
    const v = value as unknown as { isOptional?: () => boolean; _def?: { typeName?: string } };
    const typeName = String(v._def?.typeName ?? "");
    const jsonType =
      typeName === "ZodNumber" ? "number" : typeName === "ZodBoolean" ? "boolean" : "string";
    properties[key] = { type: jsonType };
    if (!(typeof v.isOptional === "function" && v.isOptional())) required.push(key);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}
