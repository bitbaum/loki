import { NextRequest, NextResponse } from "next/server";
import { runToolArgs } from "@/lib/tools";
import { isRuntimeAvailable } from "@/lib/runtime";
import { isSiteOperator } from "@/db/queries/users";
import { readJsonBody, z } from "@/lib/api/route-helpers";
import { callGroqText } from "@/lib/groq";
import { getApiUserId } from "@/lib/session";
import { HTTP_TIMEOUT_LONG_MS } from "@/lib/constants/time";

const Body = z.object({
  prompts: z.array(z.string().trim().min(1).max(4_000)).min(2).max(20),
});

type AgentResult = {
  result?: {
    payloads?: Array<{ text: string; mediaUrl: string | null }>;
  };
};

// ── Groq (fast path — seconds, free tier) ──────────────────────────────────
// Set GROQ_API_KEY in .env.local to enable. Falls back to openclaw agent.
async function mergeViaGroq(message: string): Promise<string> {
  return callGroqText(message, {
    feature: "merge-prompts",
    maxTokens: 500,
    temperature: 0.3,
    timeoutMs: HTTP_TIMEOUT_LONG_MS,
  });
}

// ── openclaw fallback (Claude via gateway, ~20-30s) ────────────────────────
// Uses the same agent+model as Loki. No additional API keys needed.
//
// The OpenClaw `main` agent is the MACHINE OWNER's — on the shared server that
// is the site operator's agent, with their memory and message history. Until
// 2026-10-17 any account could reach it here by making Groq fail (an oversized
// list was enough) and feed it text. Only the machine's owner uses it now, and
// the text travels as an argument, never through a shell.
async function mergeViaAgent(message: string): Promise<string> {
  const result = await runToolArgs(
    "openclaw",
    ["agent", "--agent", "main", "--message", message, "--json"],
    90000,
  );
  if (!result.ok) throw new Error(result.error ?? "agent error");

  const data = JSON.parse(result.data ?? "{}") as AgentResult;
  return (data?.result?.payloads?.[0]?.text ?? "").trim();
}

export async function POST(req: NextRequest) {
  const userId = await getApiUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const dataOrResp = await readJsonBody(req, Body);
  if (dataOrResp instanceof NextResponse) return dataOrResp;

  const { prompts } = dataOrResp;
  const numbered = prompts.map((p, i) => `${i + 1}. ${p}`).join("\n");
  const message = `I have ${prompts.length} tasks to send to an AI coding agent. Merge them into one concise, coherent prompt that covers all the work naturally. Output ONLY the merged prompt — no preamble, no explanation, no quotes.\n\nTasks:\n${numbered}`;

  // Try Groq first (fast). Fall back to openclaw agent (Claude, ~20-30s).
  try {
    const merged = await mergeViaGroq(message);
    if (merged) return NextResponse.json({ ok: true, merged });
  } catch {
    // Groq unavailable or no key — fall through to agent
  }

  const ownsMachine = isRuntimeAvailable() || (await isSiteOperator(userId).catch(() => false));
  if (!ownsMachine) {
    return NextResponse.json({ error: "AI unavailable — please try again." }, { status: 503 });
  }

  try {
    const merged = await mergeViaAgent(message);
    if (merged) return NextResponse.json({ ok: true, merged });
    return NextResponse.json({ error: "Empty response — please try again." }, { status: 500 });
  } catch {
    return NextResponse.json({ error: "AI unavailable — please try again." }, { status: 500 });
  }
}
