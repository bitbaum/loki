/**
 * The model seam for Loki's tool loop — one call, two tool protocols.
 *
 * Loki must work on models that will not always be frontier. The hard part is
 * that tool calling is where cheap models diverge most: some support OpenAI's
 * native `tools` field, some accept it and ignore it, some emit a plausible
 * *description* of a call instead of the call, and some have no support at all.
 * A loop built on native tool calling alone simply stops working on half the
 * models it is supposed to run on.
 *
 * So both protocols are always live:
 *
 *   NATIVE  — `tools` + `tool_calls`, used when the provider returns them.
 *   TEXT    — a line protocol the model writes into its ordinary reply:
 *
 *                 TOOL: search_people
 *                 ARGS: {"query": "Elena"}
 *
 * Every response is scanned for BOTH, and the results are merged. That is not
 * belt-and-braces: it is the single highest-yield behaviour here, because a
 * model that "narrates" a tool call in prose while native calling is enabled is
 * the most common small-model failure, and under a native-only parser that
 * narration reaches the user as a hallucinated result. Reading it as a real
 * call turns the failure into a working turn.
 *
 * The text protocol is line-based rather than nested JSON on purpose. An 8B
 * model reliably reproduces `TOOL:` / `ARGS:` on their own lines; the same
 * model routinely breaks nested-JSON escaping. The format is chosen for the
 * weakest model expected to run it, not the strongest.
 */
import { HTTP_TIMEOUT_LONG_MS } from "@/lib/constants/time";
import { classifyGroqLimit, groqRetryAfterSeconds, humanizeWait } from "@/lib/agent/groq-error";
import { chainFrom, linkPromptCeilingTokens, type ChatLink } from "@/config/chat-models";
import { recordAIHealthFailure, recordAIHealthSuccess } from "@/lib/ai/health";
import { recordVendorQuota, recordPreflightSkip, recordRefusal } from "@/lib/ai/record-quota";
import { readSseChunks } from "@/lib/agent/sse-stream";

/**
 * Write one tool-loop call to the usage ledger.
 *
 * Lazy import for the same reason `record-quota.ts` uses one: `@/db` throws at
 * MODULE INIT with no connection string, and this module is imported by tests
 * that touch no database.
 */
function recordUsage(provider: string, model: string, feature: string, tokens: number): void {
  void import("@/db/queries/ai-usage")
    .then((m) => m.recordUsage({ provider, model, feature, tokens }))
    .catch(() => undefined);
}

export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  /** Native protocol bookkeeping — echoed back so the provider can match calls. */
  tool_call_id?: string;
  name?: string;
};

export type ToolCall = {
  /** Native id when the provider gave one; synthesised for text-protocol calls. */
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type ModelTurn = {
  /** Prose the model produced, with any text-protocol call lines stripped. */
  text: string;
  /** Calls found via either protocol, de-duplicated. */
  toolCalls: ToolCall[];
  model: string;
  /**
   * Tokens this call actually cost, as the PROVIDER counted them.
   *
   * Reported rather than estimated because the budget being rationed is the
   * provider's, and our own char/4 estimate is only good enough for deciding
   * what fits in a prompt — billing a user's daily share against a guess would
   * drift a little every turn and a lot by evening. 0 when the provider omits
   * `usage`, which reads as "unknown", never as "free".
   */
  usageTokens: number;
};

/**
 * Extract text-protocol calls.
 *
 * Forgiving by design — every leniency here is a small-model behaviour observed
 * in practice rather than a hypothetical:
 *   - wraps the block in ``` fences
 *   - omits ARGS entirely for a no-argument tool
 *   - writes `TOOL: search_people(...)` with the parens it saw in the example
 *   - emits several calls in one reply
 * Rejecting any of these would fail the turn over formatting, which is the
 * failure mode this protocol exists to avoid.
 */
export function parseTextToolCalls(text: string, validNames: string[]): ToolCall[] {
  const calls: ToolCall[] = [];
  const valid = new Set(validNames);
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*(?:[-*>]\s*)?(?:\*\*)?TOOL(?:\*\*)?\s*[:=]\s*(.+?)\s*$/i.exec(lines[i]);
    if (!m) continue;
    // Tolerate `name(...)`, backticks, and trailing punctuation copied from prose.
    const name = m[1]
      .replace(/[`*]/g, "")
      .replace(/\(.*$/, "")
      .replace(/[.,;]$/, "")
      .trim();
    if (!valid.has(name)) continue;

    // ARGS may sit on the next non-empty line, or a couple below if the model
    // inserted a fence. Scan a short window rather than requiring adjacency.
    let args: Record<string, unknown> = {};
    for (let j = i + 1; j < Math.min(i + 4, lines.length); j++) {
      const a = /^\s*(?:[-*>]\s*)?(?:\*\*)?ARGS(?:\*\*)?\s*[:=]\s*(.*)$/i.exec(lines[j]);
      if (a) {
        // The object may continue past this line — a model that opens a ```json
        // fence puts the brace on the NEXT line, and a pretty-printed object
        // spans several. Join forward to the end of the window and let the
        // brace-matching parser find where it actually closes; taking only the
        // ARGS line would silently yield {} and drop the model's arguments.
        const rest = lines.slice(j, Math.min(j + 8, lines.length)).join("\n");
        args = safeJsonObject(a[1]) ?? safeJsonObject(rest.replace(/^[^:]*[:=]/, "")) ?? {};
        break;
      }
      // A new TOOL line means this call simply had no arguments.
      if (/^\s*(?:\*\*)?TOOL(?:\*\*)?\s*[:=]/i.test(lines[j])) break;
    }
    calls.push({ id: `text_${calls.length}_${name}`, name, args });
  }
  return calls;
}

/** Parse a JSON object, tolerating fences and trailing prose. Null if hopeless. */
function safeJsonObject(raw: string): Record<string, unknown> | null {
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  // `null` and `{}` must stay distinguishable. Returning `{}` for "nothing
  // parseable here" would satisfy the caller's `??` fallback and silently
  // discard arguments that were merely on the NEXT line — which is exactly what
  // a model does when it opens a ```json fence after `ARGS:`.
  if (!cleaned) return null;
  if (cleaned === "{}") return {};
  const start = cleaned.indexOf("{");
  if (start === -1) return null;
  // Walk to the matching brace so trailing commentary does not break the parse.
  let depth = 0;
  for (let i = start; i < cleaned.length; i++) {
    if (cleaned[i] === "{") depth++;
    else if (cleaned[i] === "}") {
      depth--;
      if (depth === 0) {
        try {
          const parsed: unknown = JSON.parse(cleaned.slice(start, i + 1));
          return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? (parsed as Record<string, unknown>)
            : null;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Drop a reasoning model's `<think>…</think>` preamble.
 *
 * ── Why this lives here, at the model seam ───────────────────────────────────
 * This repo already knew the trick — TWICE, in `frontier/propose.ts` and
 * `orchestration/dod-gate.ts` — and both copies exist to make JSON parse. The
 * one path where a HUMAN reads the text had none, so a turn on a reasoning
 * model persisted its own chain-of-thought and rendered it as the answer:
 *
 *     ...`.
 *
 *     Everything is clean and strictly compliant.
 *     </think>An opinion or assessment is: Not in your data.
 *
 * A fix applied at three call sites is a fix waiting to be forgotten at the
 * fourth. Cleaning the model's output belongs at the boundary where it ENTERS
 * the system, next to `stripToolCallLines`, which is the same category of job.
 *
 * `lastIndexOf` rather than a regex is deliberate and not laziness: the leak
 * above has a CLOSING tag and no opening one, because the head of the reasoning
 * was lost before it reached us. A `<think>[\s\S]*?</think>` pattern matches
 * nothing there and would have left the whole thing on screen. Taking
 * everything after the last close tag is correct whether or not the opener
 * survived.
 *
 * It also protects the grounding check, which was being run over the model's
 * private reasoning as though it were the answer.
 */
export function stripReasoning(text: string): string {
  const end = text.lastIndexOf("</think>");
  return end === -1 ? text : text.slice(end + "</think>".length).trimStart();
}

/**
 * Rewrite a citation the model wrote in FULLWIDTH brackets as ASCII.
 *
 * Observed live on nemotron: `【F16】` instead of `[F16]`. Both readers of a
 * citation are ASCII-only, so the two failures compound and neither is loud:
 *
 *   - the VERIFIER matches `/\[[FD]\d+\]/`, so it sees no citations at all and
 *     the `unknown-citation` check silently has nothing to check;
 *   - the RENDERER matches the same shape, so the handle is not recognised as a
 *     citation and is printed verbatim — a raw `【F16】` sitting in the prose,
 *     which the transcript's own rule calls "strictly worse than clean prose".
 *
 * Normalising at the seam fixes both at once, and has to happen BEFORE
 * verification rather than in the renderer, or the check stays blind.
 */
export function normaliseCitations(text: string): string {
  return text.replace(/[【［]\s*([FD]\d+(?:\s*,\s*[FD]\d+)*)\s*[】］]/gi, (_m, ids: string) =>
    `[${ids.replace(/\s+/g, "")}]`.toUpperCase(),
  );
}

/**
 * Remove text-protocol lines from prose so a call the model narrated never
 * reaches the operator as if it were an answer.
 */
export function stripToolCallLines(text: string): string {
  return text
    .split(/\r?\n/)
    .filter((l) => !/^\s*(?:[-*>]\s*)?(?:\*\*)?(?:TOOL|ARGS)(?:\*\*)?\s*[:=]/i.test(l))
    .join("\n")
    .replace(/```(?:json)?\s*```/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

type NativeToolCall = { id?: string; function?: { name?: string; arguments?: string } };

export type ModelCallInput = {
  messages: ChatMessage[];
  tools: Array<Record<string, unknown>>;
  validToolNames: string[];
  /**
   * WHO is asking, for the spend ledger — "loki-chat", "loki-e2e".
   *
   * REQUIRED, and the reason is a hole this file had. `groq.ts` was metered and
   * called "one door"; it is not the door chat comes through. Every tool-loop
   * turn — the bulk of the traffic, and the only path Gemini serves — spent
   * tokens that `ai_usage` never saw, so the capacity page listed background
   * features only and a vendor that answers exclusively here could never appear
   * as having served at all.
   */
  feature: string;
  model?: string;
  maxTokens?: number;
  temperature?: number;
  timeoutMs?: number;
  /**
   * Estimated prompt size. Links whose per-call budget is smaller are SKIPPED
   * before any request is made — a preflight, not a failure. Without it a
   * prompt sized for a 128k-context vendor is first sent to Groq, refused as
   * "request too large", and the loop sheds facts to fit the vendor it should
   * simply have walked past.
   */
  promptTokens?: number;
  /**
   * Present = stream this call and hand prose to the operator as it arrives.
   *
   * Absent = the old buffered behaviour, which every non-interactive caller
   * (probes, scheduled prompts, the form assist) still wants: there is nobody
   * watching a screen, and a stream is only more moving parts.
   */
  sink?: StreamSink;
};

/**
 * Where a streamed call sends prose while it is still being written.
 *
 * `reset` exists because a link can die AFTER it has emitted. The walker then
 * hands the turn to the next link, which starts the answer over from nothing —
 * so whatever the operator has already read is void and must be taken back,
 * not appended to. Without it a vendor failing at 80% of an answer produces a
 * visible splice of two different answers and nobody can tell which half is
 * real.
 */
export type StreamSink = {
  /** A chunk of prose that is safe to show. Tool-protocol lines never reach it. */
  delta: (text: string) => void;
  /** Discard everything emitted so far — another link is answering from scratch. */
  reset: () => void;
};

/**
 * Why one link refused, in the only terms the walker can act on.
 *
 * `size` and `daily` are separated from ordinary `capacity` because they demand
 * different moves, and conflating them has broken this loop twice — see
 * `groq-error.ts` for the full account.
 */
type FailureKind = "size" | "daily" | "capacity" | "other";

class LinkError extends Error {
  constructor(
    readonly kind: FailureKind,
    message: string,
  ) {
    super(message);
  }
}

/** One request to one (provider, model). Throws LinkError; never retries. */
async function callOneLink(
  link: ChatLink,
  input: ModelCallInput,
  tools: Array<Record<string, unknown>>,
): Promise<ModelTurn> {
  const key = process.env[link.provider.keyEnv];
  if (!key) throw new LinkError("other", `${link.provider.keyEnv} not set`);

  const res = await fetch(`${link.provider.baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: link.model,
      messages: input.messages,
      // Advertised, not depended on. Providers that reject an unknown field are
      // handled by the retry in the walker rather than by feature-detection
      // tables that would go stale the moment a provider ships a change.
      ...(tools.length > 0 ? { tools, tool_choice: "auto" } : {}),
      // `include_usage` is what keeps a streamed turn billable. Without it the
      // final chunk carries no `usage` and the turn would be charged 0 — the
      // day's ration would drain for free on exactly the turns an operator
      // watches, which are the expensive ones.
      ...(input.sink ? { stream: true, stream_options: { include_usage: true } } : {}),
      max_tokens: input.maxTokens ?? 1400,
      temperature: input.temperature ?? 0.2,
    }),
    signal: AbortSignal.timeout(input.timeoutMs ?? HTTP_TIMEOUT_LONG_MS),
  });

  // Learn what is left at this vendor from the answer we already paid for.
  // Success AND refusal both disclose it, and the refusal is the more valuable
  // reading — it corrects a local counter that had drifted optimistic. Never
  // awaited and never able to throw: a telemetry write must not be able to fail
  // an answer the operator is waiting for.
  recordVendorQuota(res.headers, link);

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    // A 400 mentioning tools means this model cannot take the native field. The
    // walker retries the SAME link without it — the text protocol is already in
    // the prompt, so the turn still works. This is why the loop degrades to weak
    // models instead of failing on them.
    if (res.status === 400 && /tool/i.test(body) && tools.length > 0) {
      throw new LinkError("other", `native tools rejected: ${body.slice(0, 120)}`);
    }
    if (res.status === 429) {
      const kind = classifyGroqLimit(body);
      const retryAfter = groqRetryAfterSeconds(body);
      const wait = humanizeWait(retryAfter);
      // The headers were already recorded above, and for Groq they are not the
      // whole story: the per-day TOKEN pool is stated only here, in the prose of
      // the refusal. Skipping this left the capacity page drawing a healthy
      // provider through an outage. A "size" 429 is deliberately excluded — it
      // reports THIS prompt being too big, which is a fact about the prompt and
      // not about how much allowance is left.
      if (kind !== "size") {
        recordRefusal(link, body, retryAfter, kind === "daily" ? "tokens" : "requests");
      }
      // Keep the wording the shed ladder greps for — `loop.ts` recognises
      // "request too large" and retries with fewer facts.
      if (kind === "size") {
        throw new LinkError("size", `${link.model} 429 request too large: ${body.slice(0, 160)}`);
      }
      if (kind === "daily") {
        throw new LinkError(
          "daily",
          `${link.provider.id} 429 daily quota exhausted${wait ? ` (retry in ${wait})` : ""}: ${body.slice(0, 160)}`,
        );
      }
      throw new LinkError(
        "capacity",
        `${link.model} 429 rate-limited${wait ? ` (retry in ${wait})` : ""}`,
      );
    }
    throw new LinkError(
      "other",
      `${link.model} ${res.status}${body ? `: ${body.slice(0, 120)}` : ""}`,
    );
  }

  const raw = input.sink ? await readStreamedBody(res, input.sink) : await readBufferedBody(res);
  // Reasoning first, then tool lines. Order matters: a model's `<think>` block
  // routinely REHEARSES the call it is about to make ("I should use TOOL:
  // search_people…"), and parsing that rehearsal as a real call runs a tool the
  // model only considered.
  const rawText = normaliseCitations(stripReasoning(raw.text)).trim();

  const native: ToolCall[] = raw.toolCalls
    .map((tc, i) => ({
      id: tc.id ?? `native_${i}`,
      name: tc.function?.name ?? "",
      args: safeJsonObject(tc.function?.arguments ?? "{}") ?? {},
    }))
    .filter((tc) => tc.name && input.validToolNames.includes(tc.name));

  // Merge, preferring native. A model sometimes emits BOTH — the native call and
  // a prose echo of it — and running the tool twice wastes a round trip and can
  // double-propose an action, so dedupe on name+args.
  const seen = new Set(native.map((c) => `${c.name}:${JSON.stringify(c.args)}`));
  const fromText = parseTextToolCalls(rawText, input.validToolNames).filter((c) => {
    const k = `${c.name}:${JSON.stringify(c.args)}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });

  return {
    text: stripToolCallLines(rawText),
    toolCalls: [...native, ...fromText],
    model: `${link.provider.id}/${link.model}`,
    usageTokens: Math.max(0, Math.round(raw.usageTokens)),
  };
}

/** What both body readers produce, before either protocol is parsed. */
type RawBody = { text: string; toolCalls: NativeToolCall[]; usageTokens: number };

/** The whole reply at once — the shape every non-streaming caller gets. */
async function readBufferedBody(res: Response): Promise<RawBody> {
  const data = (await res.json()) as {
    choices?: Array<{ message?: { content?: string; tool_calls?: NativeToolCall[] } }>;
    usage?: { total_tokens?: number };
  };
  const msg = data.choices?.[0]?.message;
  return {
    text: msg?.content ?? "",
    toolCalls: msg?.tool_calls ?? [],
    usageTokens: data.usage?.total_tokens ?? 0,
  };
}

/** Matches a text-protocol call line in either of the shapes models emit. */
const TOOL_LINE_RE = /^\s*(?:[-*>]\s*)?(?:\*\*)?(?:TOOL|ARGS)(?:\*\*)?\s*[:=]/i;

/**
 * Releases prose to a watching operator, and nothing else.
 *
 * Extracted from the stream reader so the one rule that can leak plumbing onto
 * someone's screen is testable without a provider, a socket, or a model. Two
 * properties, both load-bearing:
 *
 *   WHOLE LINES ONLY — a chunk ending in `TOO` could still become `TOOL:`, so
 *                      nothing is released until a newline proves the line is
 *                      finished. The buffered path strips these lines before
 *                      anyone sees them; a naive stream would show them and
 *                      delete them a second later.
 *   ONCE SHUT, SHUT  — a call's `ARGS:` object spans several lines and a model
 *                      may fence it, so after a TOOL/ARGS line the rest of this
 *                      call is the call, not the answer.
 *
 * `end()` releases the final line, which has no newline to prove it complete —
 * the stream ending is that proof.
 */
export function createProseGate(
  emit: (text: string) => void,
  /**
   * Take back everything shown so far.
   *
   * Needed for the leak shape actually seen in production: reasoning that
   * arrives with NO opening tag, because its head was lost upstream. Nothing
   * can tell that text is a model thinking out loud until `</think>` finally
   * appears — so the gate shows it, then retracts it the moment the tag proves
   * what it was. Without this the operator reads the reasoning and it stays on
   * screen until the persisted turn replaces it at the very end.
   */
  onReset?: () => void,
) {
  let pending = "";
  let shut = false;
  let sawOpen = false;
  let released = false;
  // A reasoning model opens with `<think>` and writes for several seconds
  // before the answer begins. Streaming that is worse than streaming nothing:
  // it shows the operator the model talking to itself, then deletes it when the
  // real answer replaces it.
  let thinking = false;

  const release = (line: string) => {
    if (shut) return;

    // A close tag ends the reasoning wherever it appears — including on a line
    // that never had an opener, which is exactly how the leak arrived. Whatever
    // precedes it on this line is reasoning; whatever follows is the answer.
    const close = line.lastIndexOf("</think>");
    if (close !== -1) {
      // A close tag with no opener means everything already shown was
      // reasoning. Retract it rather than leaving it above the real answer.
      if (!sawOpen && released) {
        onReset?.();
        released = false;
      }
      thinking = false;
      sawOpen = false;
      const after = line.slice(close + "</think>".length);
      if (after.trim()) release(after);
      return;
    }
    if (thinking) return;
    if (line.includes("<think>")) {
      thinking = true;
      sawOpen = true;
      // Anything before the opener is ordinary prose and is owed to the reader.
      const before = line.slice(0, line.indexOf("<think>"));
      if (before.trim()) {
        emit(`${before}\n`);
        released = true;
      }
      return;
    }

    if (TOOL_LINE_RE.test(line)) {
      shut = true;
      return;
    }
    emit(`${line}\n`);
    released = true;
  };

  return {
    push(chunk: string) {
      pending += chunk;
      const parts = pending.split("\n");
      pending = parts.pop() ?? "";
      for (const part of parts) release(part);
    },
    end() {
      if (pending) release(pending);
      pending = "";
    },
  };
}

/**
 * The reply as it is written, forwarding prose to the sink.
 *
 * Two things make this more than a `for await` over lines:
 *
 * 1. **Tool-protocol lines must never reach the operator.** A weak model
 *    narrates its calls as `TOOL:` / `ARGS:` lines (see `parseTextToolCalls`),
 *    and the buffered path strips them before anyone sees them. A naive stream
 *    would show the operator the plumbing first and delete it a second later.
 *    So prose is released a COMPLETE LINE AT A TIME — a half-arrived `TOO` can
 *    still turn out to be `TOOL:` — and once a `TOOL:` line appears the rest of
 *    the message is that call (its `ARGS:` object spans several lines), so the
 *    gate shuts for the remainder of the call.
 *
 * 2. **The stream is a preview, never the record.** What is persisted is the
 *    buffered text put through `stripToolCallLines`, and the client swaps the
 *    streamed preview for it when the turn lands. The two agree in the ordinary
 *    case; where they disagree the persisted text wins, because it is the one
 *    that was parsed rather than guessed at line boundaries.
 */
async function readStreamedBody(res: Response, sink: StreamSink): Promise<RawBody> {
  const body = res.body;
  if (!body) throw new LinkError("other", "streamed response had no body");

  let text = ""; // everything the model wrote, gate or no gate
  let usageTokens = 0;
  const calls = new Map<number, { id?: string; name: string; args: string }>();
  const gate = createProseGate(sink.delta, sink.reset);

  await readSseChunks(body, (chunk) => {
    // Usage rides the final chunk (stream_options.include_usage) and is what
    // the day's budget is charged against — never estimated.
    if (chunk.usage?.total_tokens) usageTokens = chunk.usage.total_tokens;

    const delta = chunk.choices?.[0]?.delta;
    if (!delta) return;

    if (delta.content) {
      text += delta.content;
      gate.push(delta.content);
    }

    // Native calls arrive in fragments keyed by index: the name lands in the
    // first fragment and the JSON arguments accumulate across many.
    for (const tc of delta.tool_calls ?? []) {
      const idx = tc.index ?? 0;
      const slot = calls.get(idx) ?? { name: "", args: "" };
      if (tc.id) slot.id = tc.id;
      if (tc.function?.name) slot.name += tc.function.name;
      if (tc.function?.arguments) slot.args += tc.function.arguments;
      calls.set(idx, slot);
    }
  });

  // The trailing line has no newline to prove it complete, but the stream
  // ending proves it.
  gate.end();

  return {
    text,
    toolCalls: [...calls.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, c]) => ({ id: c.id, function: { name: c.name, arguments: c.args } })),
    usageTokens,
  };
}

/**
 * One link, with NO fallback — for probes and diagnostics.
 *
 * Production uses the chain walker below. This exists because a walk cannot give
 * a verdict PER MODEL: it reports whoever answered, so probing "is gemma usable?"
 * through it would happily return a Groq success and call gemma fine. Pinning a
 * model into the chain on that evidence is how free-model rot goes unnoticed.
 */
export async function callModelLinkOnce(link: ChatLink, input: ModelCallInput): Promise<ModelTurn> {
  try {
    return await callOneLink(link, input, input.tools);
  } catch (e) {
    if (
      e instanceof LinkError &&
      /native tools rejected/.test(e.message) &&
      input.tools.length > 0
    ) {
      return callOneLink(link, input, []);
    }
    throw e;
  }
}

/**
 * One model turn, taken by the first link in the chain that answers.
 *
 * The walk encodes what each refusal actually means:
 *
 *   size     — this prompt exceeds THIS vendor's per-request allowance. Another
 *              vendor may have a far larger window (Groq meters ~12k tokens per
 *              minute; the OpenRouter free models carry 128k–1M context), so the
 *              walk continues. Only when EVERY link says size is the size error
 *              surfaced — that is the signal `loop.ts` sheds facts on, and it
 *              must not fire while a link that could have answered remains.
 *   daily    — this VENDOR is done until its budget resets. Every remaining
 *              model of that vendor draws on the same exhausted pool, so they
 *              are skipped wholesale rather than tried one by one.
 *   capacity — a momentary window. Advance; a different model or vendor has its
 *              own window.
 *
 * If the whole chain refuses on capacity alone, the windows are short by
 * definition, so wait ONCE, bounded, and walk it again: a 20s-slower right
 * answer beats falling back to a path that cannot read the tables the question
 * is about.
 */
export async function callModelWithTools(
  input: ModelCallInput & { /** Internal: set after the one bounded wait. */ waited429?: boolean },
): Promise<ModelTurn> {
  const chain = chainFrom(input.model ?? process.env.LOKI_MODEL);
  if (chain.length === 0) {
    const error = new Error("no chat provider configured (set GROQ_API_KEY or OPENROUTER_API_KEY)");
    recordAIHealthFailure(error);
    throw error;
  }

  const failures: string[] = [];
  const kinds = new Set<FailureKind>();
  const drained = new Set<string>();

  const skipped: string[] = [];
  for (const link of chain) {
    if (drained.has(link.provider.id)) continue;
    if (input.promptTokens !== undefined) {
      // The CEILING, not the sizing budget: skipping a link that would have
      // answered costs a 25-second detour and one of 50 daily free requests,
      // while trying one that refuses costs a 1-second 429. See
      // linkPromptCeilingTokens for the measurement behind that asymmetry.
      const budget = linkPromptCeilingTokens(link);
      if (input.promptTokens > budget) {
        skipped.push(
          `${link.provider.id}/${link.model} (prompt ~${input.promptTokens} > ${budget})`,
        );
        // Record the skip, because "never called" and "called and empty" look
        // identical on a dashboard and mean opposite things. Without this the
        // settings page told the operator Groq was waiting to be measured,
        // while every turn was walking past it for a reason they could fix.
        recordPreflightSkip(link, input.promptTokens, budget);
        continue;
      }
    }
    // Two attempts at most: the second drops the native `tools` field for a
    // model that rejected it.
    for (const tools of [input.tools, [] as Array<Record<string, unknown>>]) {
      // Per-ATTEMPT emission tracking. A link can fail after it has already
      // written prose to the screen; the next link then answers from scratch,
      // so what the operator has read is void and has to be taken back rather
      // than appended to (see StreamSink.reset).
      let emitted = false;
      const outer = input.sink;
      const attempt: ModelCallInput = outer
        ? {
            ...input,
            sink: {
              delta: (t) => {
                emitted = true;
                outer.delta(t);
              },
              reset: outer.reset,
            },
          }
        : input;
      try {
        const turn = await callOneLink(link, attempt, tools);
        if (failures.length > 0 || skipped.length > 0) {
          console.warn(
            `[loki] answered on ${turn.model}` +
              (skipped.length ? ` after skipping ${skipped.join(", ")}` : "") +
              (failures.length
                ? ` after ${failures.length} refusal(s): ${failures.join("; ")}`
                : ""),
          );
        }
        // Recorded once per top-level call — a later link answering is the
        // fallback doing its job, not a health problem.
        recordAIHealthSuccess();
        // What it cost, charged to the caller that asked. Fire-and-forget and
        // caught, like every other write on this path: telemetry must not be
        // able to fail an answer someone is waiting for.
        recordUsage(link.provider.id, link.model, input.feature, turn.usageTokens);
        return turn;
      } catch (e) {
        if (emitted) outer?.reset();
        const err =
          e instanceof LinkError
            ? e
            : new LinkError("other", e instanceof Error ? e.message : String(e));
        // Retry this same link without native tools, once.
        if (err.kind === "other" && /native tools rejected/.test(err.message) && tools.length > 0)
          continue;
        failures.push(err.message);
        kinds.add(err.kind);
        if (err.kind === "daily") drained.add(link.provider.id);
        break;
      }
    }
  }

  // Every link refused on a momentary window — the one case where waiting is
  // the right move rather than a wasted 25 seconds.
  if (!input.waited429 && kinds.has("capacity") && !kinds.has("size")) {
    console.warn(`[loki] whole chain rate-limited — waiting 15s for a window`);
    await new Promise((r) => setTimeout(r, 15_000));
    return callModelWithTools({ ...input, waited429: true });
  }

  // Every link was skipped on size and none was even tried: that is a `size`
  // outcome too — the caller's one move is to shed and retry. Not a health
  // failure, for the same reason a provider-side size refusal is not.
  if (failures.length === 0 && skipped.length > 0) {
    throw new Error(`request too large on every model: skipped ${skipped.join(", ")}`);
  }

  // Surface the most ACTIONABLE failure, not the last one. Only `size` gives the
  // caller something to do (shed facts and retry), so it wins when present.
  const summary = [...failures, ...skipped.map((s) => `skipped ${s}`)].join("; ");
  const exhausted = kinds.has("size")
    ? new Error(`request too large on every model: ${summary}`)
    : kinds.has("daily")
      ? new Error(`daily quota exhausted: ${summary}`)
      : new Error(`no chat model answered: ${summary}`);
  // `size` is a request-shape problem, not a vendor outage — recording it as
  // AI-down would make /api/health flap on prompts that are simply too big,
  // which is a caller bug (see loop.ts's shedding), not a chain failure.
  if (!kinds.has("size")) recordAIHealthFailure(exhausted);
  throw exhausted;
}
