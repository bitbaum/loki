/**
 * A person's OrangeCat bots, answered on a key the person keeps in Loki.
 *
 * A key lives in one place. A person who gave Loki their xAI key and then
 * opened OrangeCat was asked for it again, and a second copy of a secret is a
 * second place to lose it. Instead OrangeCat asks Loki, over the signed rail
 * and as the linked account, to make the model call: the key is opened here,
 * sent to the vendor's own host from Loki's closed list, and never returned,
 * logged or copied. Removing the key in Loki, or switching its
 * "Also for your OrangeCat bots" off, ends it on OrangeCat in the same moment.
 *
 * Three bounds, all here so they are tested without a network:
 *  - only a key its owner switched on (db/queries getOrangecatModelKey), and
 *    never the person's own endpoint (`custom`): a private host is not
 *    something another product's server may reach through Loki;
 *  - a request is a chat completion and nothing else: messages, a model id,
 *    a temperature, an output cap, and function definitions the model may
 *    ask for. Loki runs none of them; no arbitrary vendor fields pass;
 *  - a ceiling on calls per account, so a fault or a stolen rail secret is a
 *    bounded bill, not an open one.
 */
import { z } from "zod";
import { CUSTOM_VENDOR_ID, VENDOR_IDS, vendorById, type VendorId } from "@/config/model-vendors";

/** Calls per account, across all its bots: a busy day of chat, not a crawl. */
export const ORANGECAT_MODEL_CALLS_PER_HOUR = 240;
export const ORANGECAT_MODEL_MAX_OUTPUT_TOKENS = 8192;
/** The whole request, as sent: room for a few photos, not for a dataset. */
export const ORANGECAT_MODEL_MAX_BODY_CHARS = 12_000_000;
const VENDOR_TIMEOUT_MS = 110_000;

const MODEL_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,119}$/;
const TOOL_NAME = /^[A-Za-z0-9_-]{1,64}$/;
const MAX_TOOLS = 64;

const Part = z.union([
  z.object({ type: z.literal("text"), text: z.string() }).strict(),
  z
    .object({
      type: z.literal("image_url"),
      image_url: z.object({ url: z.string().max(4_000_000) }).strict(),
    })
    .strict(),
]);

const ToolCall = z
  .object({
    id: z.string().min(1).max(120),
    type: z.literal("function"),
    function: z
      .object({ name: z.string().regex(TOOL_NAME), arguments: z.string().max(200_000) })
      .strict(),
  })
  .strict();

/**
 * A turn of the conversation. Tool turns are the vendor's own shape: the
 * model's request to call a function, and the result handed back. The
 * function itself runs on OrangeCat, as the person; Loki only carries words.
 */
const Message = z.union([
  z
    .object({
      role: z.enum(["system", "user"]),
      content: z.union([z.string(), z.array(Part).min(1).max(12)]),
    })
    .strict(),
  z
    .object({
      role: z.literal("assistant"),
      content: z.string().nullable(),
      tool_calls: z.array(ToolCall).min(1).max(MAX_TOOLS).optional(),
    })
    .strict(),
  z
    .object({
      role: z.literal("tool"),
      tool_call_id: z.string().min(1).max(120),
      content: z.string(),
    })
    .strict(),
]);
export type OrangecatModelMessage = z.infer<typeof Message>;

/** A function the model may ask for: a name, what it does, and its arguments as JSON Schema. */
const Tool = z
  .object({
    type: z.literal("function"),
    function: z
      .object({
        name: z.string().regex(TOOL_NAME),
        description: z.string().max(4000).optional(),
        parameters: z.record(z.string(), z.unknown()).optional(),
      })
      .strict(),
  })
  .strict();

/** Never the person's own endpoint: refused at the shape, and again at the key. */
const Vendor = z
  .enum(VENDOR_IDS as [VendorId, ...VendorId[]])
  .refine((v) => v !== CUSTOM_VENDOR_ID, "the person's own endpoint is not shareable");

export const OrangecatModelRequest = z.discriminatedUnion("do", [
  /** Which keys the person has in Loki, and which are switched on. No secrets. */
  z.object({ do: z.literal("keys") }).strict(),
  /** Switch one key on or off for the person's OrangeCat bots. */
  z.object({ do: z.literal("share"), vendor: Vendor, on: z.boolean() }).strict(),
  /** The models a switched-on key can use, from the vendor's own list. */
  z.object({ do: z.literal("models"), vendor: Vendor }).strict(),
  z
    .object({
      do: z.literal("complete"),
      vendor: Vendor,
      /** Omitted: the model the person chose for this key in Loki. */
      model: z.string().regex(MODEL_ID).optional(),
      messages: z.array(Message).min(1).max(400),
      temperature: z.number().min(0).max(2).optional(),
      maxTokens: z.number().int().min(1).max(ORANGECAT_MODEL_MAX_OUTPUT_TOKENS).optional(),
      /** Functions the model may ask for, in the vendor's native format. */
      tools: z.array(Tool).min(1).max(MAX_TOOLS).optional(),
      toolChoice: z.enum(["auto", "none", "required"]).optional(),
    })
    .strict(),
]);
export type OrangecatModelRequest = z.infer<typeof OrangecatModelRequest>;

/** A vendor a key can be shared from: one of Loki's own hosts, never `custom`. */
export function shareableVendor(vendor: string): { id: VendorId; baseUrl: string } | null {
  if (vendor === CUSTOM_VENDOR_ID) return null;
  const v = vendorById(vendor);
  return v?.baseUrl ? { id: v.id, baseUrl: v.baseUrl } : null;
}

export type Completion =
  | {
      ok: true;
      content: string;
      /** Functions the model asked for, to be run by the caller. */
      toolCalls: { id: string; name: string; arguments: string }[];
      model: string;
      finishReason: string | null;
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
    }
  /** `status` is the vendor's own (402 out of credit, 429 busy, 401 a dead key), or null when it did not answer. */
  | { ok: false; status: number | null; detail: string };

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);

/** A vendor's own sentence for a refusal, short, with nothing that looks like a key in it. */
export function vendorSentence(body: unknown): string {
  const b = body as { error?: unknown; message?: unknown } | null;
  const e = b?.error;
  const said =
    typeof e === "string"
      ? e
      : typeof (e as { message?: unknown } | null)?.message === "string"
        ? (e as { message: string }).message
        : typeof b?.message === "string"
          ? b.message
          : "";
  return said
    .replace(/[A-Za-z0-9_-]{24,}/g, "…")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/** The function calls in a vendor's answer; anything not shaped like one is dropped. */
export function readToolCalls(raw: unknown): { id: string; name: string; arguments: string }[] {
  if (!Array.isArray(raw)) return [];
  return raw.slice(0, MAX_TOOLS).flatMap((c, i) => {
    const call = (c ?? {}) as { id?: unknown; function?: { name?: unknown; arguments?: unknown } };
    const name = call.function?.name;
    if (typeof name !== "string" || !TOOL_NAME.test(name)) return [];
    const args = call.function?.arguments;
    return [
      {
        id: typeof call.id === "string" && call.id ? call.id.slice(0, 120) : `call_${i}`,
        name,
        arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
      },
    ];
  });
}

/** One chat completion at the vendor, with the person's key. Never throws; never returns the key. */
export async function completeAtVendor(
  input: {
    baseUrl: string;
    apiKey: string;
    model: string;
    messages: OrangecatModelMessage[];
    temperature?: number;
    maxTokens?: number;
    tools?: z.infer<typeof Tool>[];
    toolChoice?: "auto" | "none" | "required";
  },
  fetchImpl: typeof fetch = fetch,
): Promise<Completion> {
  let res: Response;
  try {
    res = await fetchImpl(`${input.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${input.apiKey}` },
      body: JSON.stringify({
        model: input.model,
        messages: input.messages,
        ...(input.temperature === undefined ? {} : { temperature: input.temperature }),
        ...(input.maxTokens === undefined ? {} : { max_tokens: input.maxTokens }),
        ...(input.tools?.length
          ? { tools: input.tools, tool_choice: input.toolChoice ?? "auto" }
          : {}),
      }),
      signal: AbortSignal.timeout(VENDOR_TIMEOUT_MS),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    return {
      ok: false,
      status: null,
      detail:
        name === "TimeoutError" || name === "AbortError"
          ? "The provider did not answer in time."
          : "The provider could not be reached.",
    };
  }
  const body = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    return {
      ok: false,
      status: res.status,
      detail: vendorSentence(body) || `The provider answered ${res.status}.`,
    };
  }
  const choice = (Array.isArray(body?.choices) ? body.choices[0] : null) as {
    message?: { content?: unknown; tool_calls?: unknown };
    finish_reason?: unknown;
  } | null;
  const content = typeof choice?.message?.content === "string" ? choice.message.content : "";
  const toolCalls = readToolCalls(choice?.message?.tool_calls);
  if (!content.trim() && toolCalls.length === 0) {
    return { ok: false, status: 502, detail: "The provider answered with no words." };
  }
  const usage = (body?.usage ?? {}) as Record<string, unknown>;
  return {
    ok: true,
    content,
    toolCalls,
    model: typeof body?.model === "string" ? body.model : input.model,
    finishReason: typeof choice?.finish_reason === "string" ? choice.finish_reason : null,
    usage: {
      promptTokens: num(usage.prompt_tokens),
      completionTokens: num(usage.completion_tokens),
      totalTokens: num(usage.total_tokens),
    },
  };
}
