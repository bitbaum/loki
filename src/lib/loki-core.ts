/**
 * Loki chat core — SSOT for the assistant logic behind the app.
 *
 * Order of preference, and the reasoning behind it:
 *
 *   1. IN-APP TOOL LOOP — context-first: the retrieval planner seeds the turn
 *      with the records the question is about, the model answers from them
 *      (one call, usually), and calls Loki's own tools only for depth. Every
 *      record is a verifiable Fact. This is the only path where grounding is
 *      actually enforceable, because it is the only one where we own retrieval.
 *   2. GATEWAY — the OpenClaw agent, kept as a fallback for when the loop
 *      cannot run (no key, loop disabled, loop threw). It gets the SAME seed
 *      and the same post-hoc verification, but its retrieval is outside our
 *      control. That is precisely why it is no longer first.
 *   3. GROQ single-shot — last resort, clearly labelled.
 *
 * Every path returns the same envelope: the text, which path served it, the
 * model, the sources retrieved, the tools used, the grounding verdict, and
 * the real elapsed time. The UI renders all of it. Until 2026-09-11 the
 * primary path's grounding flag was computed and then dropped by both routes,
 * so a turn that failed verification rendered pixel-identical to a clean one.
 *
 * Returns `{ status, body }` — the /api/loki route wraps it in NextResponse;
 * in-process callers (the Loki messages route) read `body.text`.
 */
import { askGatewayAgent, isGatewayConfigured } from "@/lib/openclaw-gateway";
import { callGroqText, GROQ_FAST_MODEL } from "@/lib/groq";
import { normaliseCitations, stripReasoning } from "@/lib/agent/llm";
import { getUserPreferences } from "@/db/queries/user-preferences";
import { buildGroundedTurn, directiveEvidence, type RetrievedSource } from "@/lib/agent/context";
import { runLokiTurn, type LokiTurnEvent } from "@/lib/agent/loop";
import type { ChatMessage } from "@/lib/agent/llm";
import type { LokiProvenance as ProvenanceShape, LokiVia } from "@/lib/loki/provenance";
import {
  verifyAnswer,
  buildRepairPrompt,
  directiveId,
  type Violation,
} from "@bitbaum/ai-kit/grounding";
import { NO_BASIS } from "@bitbaum/ai-kit/grounding";
import { rateLimitMessage } from "@/lib/agent/groq-error";
import { checkAiBudget, recordAiSpend } from "@/lib/ai-budget/gate";
import type { Fact } from "@bitbaum/ai-kit/grounding";
import { APP_NAME } from "@/config/brand";
import { ECOSYSTEM, ORANGECAT_CAPABILITIES } from "@/config/ecosystem";
import { HTTP_TIMEOUT_LONG_MS } from "@/lib/constants/time";
import { looksLikePlan, ANSWER_ONLY } from "@/lib/loki/plan-as-answer";

const LOKI_SYSTEM_PROMPT =
  `You are Loki, the assistant inside ${APP_NAME} — the operator's execution layer: the captain over their fleet of AI agents and projects, and the workspace holding the people, commitments and spending that work runs on. ` +
  `When fleet context about the operator's projects is provided, treat it as current ground truth and answer specifically and accurately from it; if a question falls outside it, say so rather than inventing detail. Be concise and direct.`;

/**
 * What the NEIGHBOURING product can do, and the line Loki must not cross.
 *
 * Added when OrangeCat shipped its Studio: an operator asking "can I make a
 * trailer for this project?" was being told no, which was wrong — and the
 * tempting fix (letting Loki sound capable) is exactly the failure the preface
 * below exists to prevent. So the facts come from the ecosystem SSOT and the
 * boundary is stated in the same breath.
 */
const NEIGHBOUR_CAPABILITIES = [
  `NEIGHBOURING PRODUCT — ${ECOSYSTEM.orangeCat.title}, the operator's economic layer. These are ITS capabilities, not yours:`,
  ...ORANGECAT_CAPABILITIES.lines.map((line) => `- ${line}`),
  `You cannot render, compose or publish any of it yourself. When the operator wants to MAKE something rather than build software, point them at ${ORANGECAT_CAPABILITIES.studioUrl} and say plainly that it happens there, not here.`,
].join("\n");

/**
 * Ground-truth of what Loki can actually DO, injected into every fallback
 * turn's context.
 *
 * Why a message preface and not just the system prompt: the gateway Loki is
 * the external OpenClaw agent — it never sees LOKI_SYSTEM_PROMPT. The only
 * reliable way to bind that brain per-turn is to prepend this to the message.
 *
 * This exists because Loki once told the operator a "security sandbox hard-blocked"
 * a calendar write and invented an Approve button that would book it — both false.
 */
const LOKI_CAPABILITIES = `CAPABILITIES — ground truth; never exceed or invent beyond this: You answer from the operator's Loki records (projects, agent runs, visitor feedback, approvals, people, goals, habits, commitments, notes). You have NO ability to send messages or emails. You cannot change Google Calendar yourself. Your only lever is the ${APP_NAME} approval queue — you PROPOSE actions and the operator must approve each one. Never claim a "security sandbox" blocked you, and never report a result (an event booked, a message sent) you did not receive confirmation of. If you cannot do something, say so plainly.

${NEIGHBOUR_CAPABILITIES}`;

function voiceClause(voice: string | null | undefined): string {
  const v = voice?.trim();
  return v ? ` Adopt this writing voice in your reply: ${v}` : "";
}

/** True when the gateway's text is not a real answer. */
function isUnusableGatewayText(text: string): boolean {
  const t = text.trim();
  return t.length === 0 || /couldn'?t generate a response/i.test(t);
}

/**
 * True when a modest model degenerated into restating the injected fleet index
 * (a bulleted list of most/all projects) instead of answering. Eight+
 * `- **Name**` bullets is a listing, not a focused answer. Applied to EVERY
 * path now — the tool loop's free OpenRouter links are as prone to it as the
 * gateway's model was.
 */
export function looksLikeFleetEcho(text: string): boolean {
  const bullets = text.match(/^\s*[-*]\s+\*\*[^*\n]+\*\*/gm);
  return (bullets?.length ?? 0) >= 8;
}

async function callGroq(
  message: string,
  voice: string | null,
  onEvent?: (event: LokiTurnEvent) => void,
): Promise<{ text: string; model: string }> {
  const ask = (prompt: string) =>
    callGroqText(prompt, {
      feature: "loki-chat-fallback",
      systemPrompt: LOKI_SYSTEM_PROMPT + voiceClause(voice),
      // A chat turn with the whole fleet in context needs room, and the model
      // must be allowed to think in its HIDDEN channel rather than out loud in
      // the answer: at "low" effort gpt-oss narrated its plan into the reply
      // and ran out of tokens before answering. Raised together, as groq.ts
      // documents — effort spends from the same budget.
      maxTokens: 2048,
      reasoningEffort: "medium",
      timeoutMs: HTTP_TIMEOUT_LONG_MS,
      // The fallback streams too. It is tempting to treat this path as "degraded,
      // so it can be silent" — but it is the path that runs precisely when the
      // free tiers are drained and the tool loop cannot start, which is to say on
      // the slowest days. Leaving it unstreamed meant the operator saw no
      // streaming at all exactly when they most needed to see progress.
      ...(onEvent
        ? {
            sink: {
              delta: (text: string) => onEvent({ type: "delta", text }),
              reset: () => onEvent({ type: "reset" }),
            },
          }
        : {}),
    });
  let text = await ask(message);
  if (looksLikePlan(text)) {
    // One retry, with the instruction the first attempt showed it needed. The
    // reset event clears what was streamed so the operator does not keep the
    // plan on screen above the answer.
    onEvent?.({ type: "reset" });
    console.warn("[loki] groq fallback returned a plan instead of an answer — retrying once");
    text = await ask(message + ANSWER_ONLY);
  }
  return { text, model: `groq/${GROQ_FAST_MODEL}` };
}

export type AskLokiResult = { status: number; body: Record<string, unknown> };

/**
 * Per-turn grounding report, returned to the client alongside the answer.
 *
 * `checked: false` means the turn had no records to check against, which is
 * honestly different from "checked and clean".
 */
export function groundingMeta(factCount: number, violations: Violation[]) {
  return {
    checked: factCount > 0,
    ok: violations.length === 0,
    factCount,
    unsupported: violations.map((v) => ({ kind: v.kind, text: v.text })),
  };
}

/** Everything the UI needs to say where an answer came from — shape SSOT in lib/loki/provenance.ts. */
type LokiProvenance = Omit<ProvenanceShape, "retrieved"> & { retrieved: RetrievedSource[] };

function toolLoopEnabled(userId?: string): boolean {
  return (
    Boolean(userId) &&
    process.env.LOKI_TOOL_LOOP !== "0" &&
    Boolean(process.env.GROQ_API_KEY || process.env.OPENROUTER_API_KEY)
  );
}

/**
 * One journal line per served turn. Before, a turn that WORKED logged nothing
 * and a turn that fell back logged only its failure — so "how is Loki doing"
 * had no answer short of asking the operator. This is the line the next
 * investigation greps for.
 */
function logTurn(p: LokiProvenance & { userId?: string; textLength: number }) {
  const retrieved = p.retrieved
    .filter((r) => r.count > 0)
    .map((r) => `${r.source}:${r.count}`)
    .join(",");
  console.info(
    `[loki] turn via=${p.via} model=${p.model} ms=${p.durationMs} rounds=${p.rounds} facts=${p.grounding.factCount} retrieved=${retrieved || "-"} tools=${p.toolsUsed.join(",") || "-"} grounded=${p.grounding.checked ? (p.grounding.ok ? "ok" : `FLAGGED(${p.grounding.unsupported.length})`) : "unchecked"} chars=${p.textLength}`,
  );
}

export type AskLokiOpts = {
  sessionKey?: string;
  userId?: string;
  /** Prior turns of this conversation, oldest first. The loop trims them. */
  history?: ChatMessage[];
  /**
   * Present when an operator is watching the turn happen: the loop streams its
   * prose and reports each tool it runs, instead of going quiet until it is
   * finished. Only the tool-loop path can honour it — the fallbacks below
   * produce their answer in one piece — so a turn that falls back simply stops
   * emitting, which is the truth about what it is doing.
   */
  onEvent?: (event: LokiTurnEvent) => void;
};

/**
 * Ask Loki a question.
 */
export async function askLoki(message: string, opts?: AskLokiOpts): Promise<AskLokiResult> {
  const startedAt = Date.now();
  // Ration BEFORE any provider is called, and only for identified users —
  // an anonymous caller has no ledger to charge, and the paths they can reach
  // do not draw on the rationed pool. The whole turn is gated once, not each
  // path: admitting a turn here and refusing it three fallbacks later would
  // burn the budget it was meant to protect and still say no.
  if (opts?.userId) {
    const verdict = await checkAiBudget(opts.userId);
    if (!verdict.allowed) {
      return {
        status: 429,
        body: {
          error: verdict.message,
          ...(verdict.retryAfterSeconds !== undefined
            ? { retryAfterSeconds: verdict.retryAfterSeconds }
            : {}),
        },
      };
    }
  }

  if (toolLoopEnabled(opts?.userId)) {
    try {
      const voicePref = await getUserPreferences(opts!.userId!)
        .then((p) => p.writingVoice)
        .catch(() => null);
      const result = await runLokiTurn({
        userId: opts!.userId!,
        message,
        voice: voicePref,
        history: opts?.history,
        onEvent: opts?.onEvent,
      });
      // Booked whether or not the turn produced usable text: the tokens were
      // spent either way, and only charging for successes would let a run of
      // empty answers drain the day for free.
      await recordAiSpend(opts!.userId!, result.usageTokens);
      if (result.text.trim() && !looksLikeFleetEcho(result.text)) {
        const provenance: LokiProvenance = {
          via: "tool-loop",
          model: `loki/${result.model}`,
          durationMs: Date.now() - startedAt,
          toolsUsed: result.toolsUsed,
          rounds: result.rounds,
          retrieved: result.retrieved,
          grounding: groundingMeta(result.facts.length, result.violations),
        };
        logTurn({ ...provenance, userId: opts?.userId, textLength: result.text.length });
        return {
          status: 200,
          body: {
            ok: true,
            text: result.text,
            ...provenance,
            // Sent so the transcript can resolve [F8] to the record it names.
            sources: result.sources,
          },
        };
      }
      console.warn(
        `[loki] tool loop produced ${result.text.trim() ? "a fleet echo" : "no text"} — falling back to gateway`,
      );
    } catch (e) {
      // Never let the loop take the turn down with it. A fallback that answers
      // is better than an error that does not, and the gateway path below is
      // fully grounded too — just not tool-driven.
      console.error("[loki] tool loop failed:", e instanceof Error ? e.message : e);
    }
  }

  return askLokiViaGateway(message, opts, startedAt);
}

/** The fallback path: the same grounded seed + gateway/Groq. */
async function askLokiViaGateway(
  message: string,
  opts: AskLokiOpts | undefined,
  startedAt: number,
): Promise<AskLokiResult> {
  // Arriving here means the tool loop did not produce the answer — and it may
  // have streamed prose before giving up. That text is void: this path answers
  // from scratch, so it must REPLACE what is on screen, never continue it.
  // Without this a loop that died at 80% of a sentence would splice into the
  // fallback's opening words and the operator could not tell where one answer
  // ended and the other began.
  opts?.onEvent?.({ type: "reset" });

  const [voice, grounded] = await Promise.all([
    opts?.userId
      ? getUserPreferences(opts.userId)
          .then((p) => p.writingVoice)
          .catch(() => null)
      : Promise.resolve(null),
    opts?.userId
      ? buildGroundedTurn(opts.userId, message).catch(() => null)
      : Promise.resolve(null),
  ]);

  const facts: Fact[] = grounded?.facts ?? [];
  const retrieved = grounded?.retrieved ?? [];
  const evidence = grounded ? directiveEvidence(grounded.directives) : [];
  // The computed briefs are rendered into the context as [D1]…[Dn], so the
  // model cites them — and the verifier must be told those handles are real.
  // Without this every directive citation is flagged `unknown-citation`, which
  // triggers a repair pass on a CORRECT answer. Observed live on the first
  // production turn after this shipped: five flags, all `[D5]`, all legitimate.
  // The tool loop always passed these; this path never did.
  const citationIds = (grounded?.directives ?? []).map((_, i) => directiveId(i));

  const background = grounded?.context
    ? `${LOKI_CAPABILITIES}\n\n---\n\n${grounded.context}`
    : LOKI_CAPABILITIES;
  const contextualMessage = `${background}\n\n---\n\n${message}`;

  /**
   * Check an answer and, if it makes unsupported claims, give the model exactly
   * one chance to delete them. What survives a failed repair is returned WITH
   * its violations attached rather than suppressed.
   */
  async function groundOrRepair(
    text: string,
    regenerate: (repair: string) => Promise<string>,
  ): Promise<{ text: string; violations: Violation[] }> {
    if (facts.length === 0) return { text, violations: [] };
    const first = verifyAnswer({
      answer: text,
      facts,
      userMessage: message,
      extraEvidence: evidence,
      extraCitationIds: citationIds,
    });
    if (first.ok) return { text, violations: [] };

    console.warn(
      "[loki] ungrounded claims, repairing:",
      first.violations
        .map((v) => `${v.kind}:${v.text}`)
        .join(", ")
        .slice(0, 300),
    );
    const repaired = (
      await regenerate(buildRepairPrompt(first.violations, NO_BASIS)).catch(() => "")
    ).trim();
    if (!repaired) return { text, violations: first.violations };

    const second = verifyAnswer({
      answer: repaired,
      facts,
      userMessage: message,
      extraEvidence: evidence,
      extraCitationIds: citationIds,
    });
    // A repair is a deletion: keep it only if it removed claims without
    // introducing different ones.
    const before = new Set(first.violations.map((v) => v.text));
    const inventedNew = second.violations.some((v) => !before.has(v.text));
    if (second.violations.length < first.violations.length && !inventedNew) {
      return { text: repaired, violations: second.violations };
    }
    return { text, violations: first.violations };
  }

  const finish = (
    text: string,
    via: LokiVia,
    model: string,
    violations: Violation[],
  ): AskLokiResult => {
    const provenance: LokiProvenance = {
      via,
      model,
      durationMs: Date.now() - startedAt,
      toolsUsed: [],
      rounds: 1,
      retrieved,
      grounding: groundingMeta(facts.length, violations),
    };
    logTurn({ ...provenance, userId: opts?.userId, textLength: text.length });
    return { status: 200, body: { ok: true, text, ...provenance } };
  };

  if (isGatewayConfigured()) {
    const v = voice?.trim();
    const prefaced = v
      ? `[Voice for this reply — ${v}]\n\n${contextualMessage}`
      : contextualMessage;
    const res = await askGatewayAgent(prefaced, { sessionKey: opts?.sessionKey });
    // The gateway is a third model seam, and the one that actually shipped a
    // `</think>` block into the transcript: its agent runs whatever model it
    // likes (gemini-flash-latest at the time), so reasoning output is not
    // hypothetical here — it is the observed case.
    const text = normaliseCitations(stripReasoning(res.text ?? "")).trim();
    if (res.ok && !isUnusableGatewayText(text) && !looksLikeFleetEcho(text)) {
      const checked = await groundOrRepair(text, async (repair) => {
        const again = await askGatewayAgent(repair, { sessionKey: opts?.sessionKey });
        return again.ok ? normaliseCitations(stripReasoning(again.text ?? "")) : "";
      });
      return finish(checked.text, "gateway", res.model ?? "openclaw/main", checked.violations);
    }
    const reason = !res.ok
      ? (res.error ?? "gateway error")
      : looksLikeFleetEcho(text)
        ? "the model restated the fleet instead of answering"
        : "the model returned an empty/incomplete response";
    console.error("[loki] gateway unusable:", reason);
    if (!process.env.GROQ_API_KEY) {
      return { status: 503, body: { error: `Loki is offline — ${reason}.` } };
    }
    console.warn("[loki] degraded: falling back to Groq");
  }

  // Groq fallback — DEGRADED, labelled. Still grounded, still verified: the
  // fallback path is a SMALLER model, so it is the path most likely to
  // fabricate and the last one that should skip the check.
  try {
    const { text, model } = await callGroq(contextualMessage, voice, opts?.onEvent);
    // Same rationed pool as the tool loop, so it is booked too. `callGroqText`
    // surfaces no usage count, so 0 books the estimate.
    if (opts?.userId) await recordAiSpend(opts.userId, 0);
    const checked = await groundOrRepair(text, async (repair) => {
      opts?.onEvent?.({ type: "status", label: "verifying" });
      const { text: fixed } = await callGroq(
        `${contextualMessage}\n\n---\n\nYour previous answer:\n${text}\n\n---\n\n${repair}`,
        voice,
      );
      return fixed;
    });
    return finish(checked.text, "groq-fallback", model, checked.violations);
  } catch (e) {
    const raw = e instanceof Error ? e.message : String(e);
    const hint = /\b401\b|invalid.api.key/i.test(raw)
      ? "Groq API key is invalid"
      : /\b429\b/.test(raw)
        ? rateLimitMessage(raw)
        : /\b5\d\d\b/.test(raw)
          ? "Groq server error"
          : /timeout|abort/i.test(raw)
            ? "Groq timed out"
            : `Loki is unavailable right now (${raw.slice(0, 80)})`;
    console.error("[loki] Groq fallback failed:", raw);
    return { status: 503, body: { error: `Loki is offline — ${hint}.` } };
  }
}
