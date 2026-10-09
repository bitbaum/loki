/**
 * Shared text-completion client — SSOT for the default model and call pattern.
 * Dispatch strategist, prompt-merge, the frontier digest and Loki all use this.
 *
 * ── Why this is no longer Groq-only ──────────────────────────────────────────
 * It kept the name because sixteen call sites import it, but the transport now
 * walks the SAME cross-vendor chain Loki has used all along (`@bitbaum/ai-kit` via
 * config/chat-models). That is the whole fix for 2026-08-18: Groq retired
 * `llama-3.3-70b-versatile`, every direct caller here had exactly one vendor
 * and no fallback, and seven features went dark for eight days. Loki, which
 * already had the chain, degraded instead of dying.
 *
 * The chain is not an abstraction added for this — it already existed, was
 * already configured, and already had a second vendor keyed with its own
 * independent free budget. This deletes a special case rather than adding a
 * layer: there is now ONE way this app reaches a model.
 */

import { HTTP_TIMEOUT_SHORT_MS, HTTP_TIMEOUT_LONG_MS } from "@/lib/constants/time";
import { chainFrom, type ChatLink } from "@/config/chat-models";
import {
  createProseGate,
  normaliseCitations,
  stripReasoning,
  type StreamSink,
} from "@/lib/agent/llm";
import { readSseChunks } from "@/lib/agent/sse-stream";
import { recordAIHealthFailure, recordAIHealthSuccess } from "@/lib/ai/health";
import { recordVendorQuota, recordRefusal } from "@/lib/ai/record-quota";
import { spokenText, type WhisperVerbose } from "@/lib/voice/whisper-silence";
import { retryAfterSeconds as groqRetryAfterSeconds } from "@bitbaum/ai-kit";

/**
 * The default chat model for every direct Groq call in this app.
 *
 * Was `llama-3.3-70b-versatile` until 2026-08-25, when Groq's model list no
 * longer contained it and every call 404'd `model_not_found`. That had been
 * true since 2026-08-18 — eight days in which the frontier digest fell back to
 * a canned headline every night and no caller said a word, because each one
 * degrades on its own.
 *
 * `openai/gpt-oss-20b` is verified live and answers strict JSON cleanly. It is
 * a REASONING model, which is why `reasoningEffort` below defaults to "low":
 * on a trivial prompt the default effort burned 86 of 106 completion tokens on
 * hidden reasoning, and most callers here budget 200–300 max_tokens. At "low"
 * the same prompt costs 6 reasoning tokens. Raising the effort without raising
 * maxTokens is how you get silently truncated answers.
 *
 * Before changing this id, probe it: `npm run probe:models` for tool-call
 * behaviour, `npm run check:models` for mere existence.
 */
export const GROQ_FAST_MODEL = "openai/gpt-oss-20b";
export const GROQ_WHISPER_MODEL = "whisper-large-v3-turbo";

/**
 * Groq model ids that accept the `reasoning_effort` values this app sends
 * ("low" | "medium" | "high"). Sending it to a model that does not understand
 * it is a 400, so this stays an allow-list.
 *
 * qwen/ was removed 2026-08-27. Groq now answers qwen3.6-27b with
 * `reasoning_effort must be one of "none" or "default"`, so every call carrying
 * "low" 400s. That model is the frontier judge panel's SECOND lineage, and a
 * judge that cannot be called abstains — leaving proposals scored only by
 * gpt-oss-120b while the GENERATOR is gpt-oss-20b. Same lineage judging its own
 * output, and the veto floor (one lineage can veto what another loves) silently
 * stopped existing. The panel's whole value is uncorrelated errors.
 *
 * Verified against the live API: with the parameter omitted the model answers
 * normally and emits its <think> preamble, which stripReasoning already handles
 * and the judge's 3500-token budget already accommodates.
 *
 * Exported because the model-rot probe MUST build its request from this exact
 * predicate. A probe that decided separately which models get the parameter
 * would be a second source of truth, and would pass while the real call 400s.
 */
export function supportsReasoningEffort(model: string): boolean {
  return model.startsWith("openai/gpt-oss");
}
export const GROQ_BASE_URL = "https://api.groq.com/openai/v1";
// Transcription stays Groq-direct: Whisper has no equivalent in the free chat
// chain, so there is no second vendor to fall through to. Pretending otherwise
// would be a fallback that cannot fire.
const GROQ_AUDIO_URL = `${GROQ_BASE_URL}/audio/transcriptions`;

type GroqOptions = {
  /**
   * WHO is asking, as a stable slug the capacity page can show a person:
   * "activity-digest", "form-assist", "calendar-extract".
   *
   * REQUIRED, with no default, and that is the entire point. Fifteen callers
   * reached the vendor through this module without the ledger knowing any of
   * them existed; a default here would let the sixteenth do the same. A new
   * caller must now name itself or fail the build.
   */
  feature: string;
  /**
   * Present when an operator is watching: stream the answer instead of
   * buffering it. A link that fails after emitting calls `reset` so the next
   * link's answer replaces what was shown rather than continuing it.
   */
  sink?: StreamSink;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  systemPrompt?: string;
  /** Override the model (defaults to GROQ_FAST_MODEL). Lets a verifier run on a
   *  different model than the generator — the first step of cross-model checking. */
  model?: string;
  /** How much hidden reasoning the model may spend before answering. Reasoning
   *  tokens come out of `maxTokens`, so "low" is the default: it keeps every
   *  existing caller's budget honest. Raise it only together with maxTokens. */
  reasoningEffort?: "low" | "medium" | "high";
  /**
   * Try the next vendor in the chain when this one fails. Default TRUE — the
   * absence of this behaviour is what made a single vendor's model retirement
   * a seven-feature outage.
   *
   * Pass FALSE when WHICH model answered is part of your contract. The frontier
   * judge panel is the case that matters: its value comes from uncorrelated
   * model lineages, so silently substituting judge B's model for judge A would
   * turn two independent votes into one voter counted twice — while still
   * reporting two distinct names. An abstaining judge is honest; a duplicated
   * one is a lie that also disables the veto floor.
   */
  fallback?: boolean;
};

/** What answered, alongside what it said. */
export type TextCompletion = {
  text: string;
  /** The model that actually produced this — NOT the one that was requested.
   *  Callers that record provenance (the frontier digest stores a `model`
   *  column) must persist this, or a fallback silently makes the record wrong. */
  model: string;
  provider: string;
  /** Links that failed before this one answered. Empty on a first-try success. */
  attempts: { model: string; error: string }[];
  /** The vendor's OWN token count. 0 means it did not say, never "free". */
  tokens: number;
};

/**
 * Write one call to the usage ledger.
 *
 * The database is imported LAZILY for the same reason `record-quota.ts` does
 * it: `@/db` throws at MODULE INIT with no connection string, and this module
 * is imported by tests that touch no database at all. Fire-and-forget, and
 * every path caught — a ledger that cannot be written is a stale page, which is
 * survivable; an exception here would fail an answer, which is not.
 */
function recordUsage(provider: string, model: string, feature: string, tokens: number): void {
  void import("@/db/queries/ai-usage")
    .then((m) => m.recordUsage({ provider, model, feature, tokens }))
    .catch(() => undefined);
}

async function callOneLink(
  link: ChatLink,
  prompt: string,
  o: Required<Pick<GroqOptions, "maxTokens" | "temperature" | "timeoutMs" | "reasoningEffort">> &
    Pick<GroqOptions, "systemPrompt" | "sink">,
): Promise<{ text: string; tokens: number }> {
  const key = process.env[link.provider.keyEnv];
  if (!key) throw new Error(`${link.provider.keyEnv} not set`);

  const messages: Array<{ role: string; content: string }> = [];
  if (o.systemPrompt) messages.push({ role: "system", content: o.systemPrompt });
  messages.push({ role: "user", content: prompt });

  const res = await fetch(`${link.provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: link.model,
      messages,
      max_tokens: o.maxTokens,
      temperature: o.temperature,
      ...(supportsReasoningEffort(link.model) ? { reasoning_effort: o.reasoningEffort } : {}),
      ...(o.sink ? { stream: true } : {}),
    }),
    signal: AbortSignal.timeout(o.timeoutMs),
  });

  // Learn what is left at this vendor from the answer we already paid for.
  //
  // This one line is why fifteen features were invisible. They all reach the
  // vendor through here, and this helper read the body and threw the headers
  // away — so every digest, brief and form-fill drew on the same Groq pool the
  // capacity page was drawing, and the page never saw them. The tool loop's own
  // seam has recorded this since the meter existed; this path never did.
  //
  // Success AND refusal both disclose it, and the refusal is the more valuable
  // reading: it corrects a counter that had drifted optimistic.
  recordVendorQuota(res.headers, link);

  // Keep the body: a 429 says WHICH limit was hit (tokens-per-minute vs
  // per-day) and how long to wait. Without it a rate-limited caller cannot tell
  // "retry in 12s" from "you are out for the day".
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    recordRefusal(link, body, groqRetryAfterSeconds(body), "requests");
    throw new Error(`${link.provider.id} ${res.status}${body ? `: ${body.slice(0, 300)}` : ""}`);
  }
  let text: string;
  let tokens = 0;
  if (o.sink) {
    // Streamed: forward prose through the same gate the tool loop uses, so a
    // model that narrates a tool call cannot leak the plumbing here either.
    // This path matters more than it looks — when the free tiers are drained
    // the tool loop cannot run and EVERY turn arrives here, so a fallback that
    // did not stream meant the operator saw no streaming at all on exactly the
    // days the answers were slowest.
    const body = res.body;
    if (!body) throw new Error(`${link.provider.id} streamed response had no body`);
    let acc = "";
    const gate = createProseGate(o.sink.delta, o.sink.reset);
    await readSseChunks(body, (chunk) => {
      const piece = chunk.choices?.[0]?.delta?.content;
      if (!piece) return;
      acc += piece;
      gate.push(piece);
    });
    gate.end();
    text = normaliseCitations(stripReasoning(acc)).trim();
  } else {
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { total_tokens?: number };
    };
    text = normaliseCitations(stripReasoning(data?.choices?.[0]?.message?.content ?? "")).trim();
    // The vendor's OWN count, never an estimate. Absent on some links, which is
    // why the ledger reads 0 as "did not say" rather than "cost nothing".
    tokens = Number(data?.usage?.total_tokens) || 0;
  }
  // A 200 with empty content is a failure for every caller here (they all parse
  // the text). Treating it as success would spend the fallback budget on
  // nothing and hand the caller an empty string to misparse.
  if (!text) throw new Error(`${link.provider.id} returned empty content`);
  return { text, tokens };
}

/**
 * Call the model chain and return the completion text plus WHAT ANSWERED.
 *
 * Throws only when every link failed — and the error names each attempt, so a
 * total outage reports which vendors were tried and why each refused, instead
 * of a single vendor's message standing in for the whole chain.
 */
export async function callTextDetailed(
  prompt: string,
  options: GroqOptions,
): Promise<TextCompletion> {
  const {
    maxTokens = 200,
    temperature = 0.2,
    timeoutMs = HTTP_TIMEOUT_SHORT_MS,
    systemPrompt,
    model = GROQ_FAST_MODEL,
    reasoningEffort = "low",
    fallback = true,
    sink,
    feature,
  } = options;

  const chain = chainFrom(model);
  // `chainFrom` returns [] when no vendor key is configured at all, and drops
  // links whose key is absent. Falling back to the requested model keeps the
  // "no key" error identical to the one callers have always seen.
  const links: ChatLink[] =
    chain.length === 0
      ? [
          {
            provider: {
              id: "groq",
              baseUrl: GROQ_BASE_URL,
              keyEnv: "GROQ_API_KEY",
              models: [model],
              dailyTokens: 0,
            },
            model,
          },
        ]
      : fallback
        ? chain
        : [chain[0]];

  const attempts: { model: string; error: string }[] = [];
  for (const link of links) {
    try {
      // Per-ATTEMPT emission tracking: a link can die after writing to the
      // screen, and the next link answers from scratch, so what was read is
      // void and must be taken back rather than appended to.
      let emitted = false;
      const attemptSink: StreamSink | undefined = sink
        ? {
            delta: (t) => {
              emitted = true;
              sink.delta(t);
            },
            reset: sink.reset,
          }
        : undefined;
      const answered = await callOneLink(link, prompt, {
        maxTokens,
        temperature,
        timeoutMs,
        systemPrompt,
        reasoningEffort,
        sink: attemptSink,
      }).catch((e) => {
        if (emitted) sink?.reset();
        throw e;
      });
      const text = answered.text;
      // What it cost, and who asked. Never awaited and never able to throw:
      // telemetry must not add latency to an answer someone is waiting for, nor
      // turn a good answer into a failed one.
      recordUsage(link.provider.id, link.model, feature, answered.tokens);
      // A fallback that fires SILENTLY hides the very fault it is compensating
      // for: the feature still works, so nothing looks wrong, while the primary
      // is dead. That is how the 2026-08-18 rot survived eight days. Real
      // traffic already knows — this just makes it say so, at zero token cost.
      if (attempts.length > 0) {
        console.warn(
          `[ai] fallback: ${link.provider.id}/${link.model} answered after ` +
            `${attempts.length} failed link(s) — ${attempts.map((a) => `${a.model}: ${a.error}`).join(" | ")}`,
        );
      }
      // Recorded once per call, not per link: a success on a later link is
      // still a success for the caller, and flagging it "degraded" here would
      // report the fallback doing its job as if it were a problem.
      recordAIHealthSuccess();
      return {
        text,
        model: link.model,
        provider: link.provider.id,
        attempts,
        tokens: answered.tokens,
      };
    } catch (err) {
      attempts.push({ model: link.model, error: err instanceof Error ? err.message : String(err) });
    }
  }

  const exhausted = new Error(
    `all ${attempts.length} model link(s) failed: ` +
      attempts.map((a) => `${a.model} → ${a.error}`).join(" | "),
  );
  recordAIHealthFailure(exhausted);
  throw exhausted;
}

/**
 * Call the model chain and return the completion text.
 * Throws if every link fails, no key is set, or the timeouts fire.
 */
export async function callGroqText(prompt: string, options: GroqOptions): Promise<string> {
  return (await callTextDetailed(prompt, options)).text;
}

export async function callGroqTranscribe(
  audio: Blob,
  mimeType = "audio/webm",
  // A mic take answers in seconds; a twenty-minute memo segment does not.
  timeoutMs = HTTP_TIMEOUT_LONG_MS,
): Promise<string> {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error("GROQ_API_KEY not set");

  const form = new FormData();
  const ext = mimeType.split("/")[1]?.split(";")[0] ?? "webm";
  form.append("file", audio, `audio.${ext}`);
  form.append("model", GROQ_WHISPER_MODEL);
  // Verbose: per-segment no-speech estimates, so silence Whisper put words to
  // ("Thank you.") is dropped instead of sent as the person's turn.
  form.append("response_format", "verbose_json");

  const res = await fetch(GROQ_AUDIO_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}` },
    body: form,
    signal: AbortSignal.timeout(timeoutMs),
  });

  // transcribe-quota: Whisper is Groq-direct with no second vendor, but it
  // draws on the same account. An unmetered transport is how a pool empties
  // for reasons the page cannot explain.
  recordVendorQuota(res.headers, {
    provider: {
      id: "groq",
      baseUrl: GROQ_BASE_URL,
      keyEnv: "GROQ_API_KEY",
      models: [GROQ_WHISPER_MODEL],
      dailyTokens: 0,
    },
    model: GROQ_WHISPER_MODEL,
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`groq transcribe ${res.status}: ${body.slice(0, 200)}`);
  }
  return spokenText((await res.json()) as WhisperVerbose);
}
