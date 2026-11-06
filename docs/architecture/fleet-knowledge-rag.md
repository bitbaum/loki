# Fleet Knowledge — pgvector / RAG for context injection

**Status:** P0 partial · P1 inject wired (cloud + local) · embed-on-write for profiles
**Created:** 2026-06-25 · **Last modified:** 2026-06-27 · **Last modified summary:** Box install script SSOT; Memory page shows index health; embed-on-write on profile saves.

**One line:** Add retrieval to context injection — but only at the layer the *captain* uniquely owns (cross-project + fleet memory + life-OS), never the codebase the *runtime* already retrieves.

## Box operations

Install the local embed server, env vars, and daily reindex timer (first time, or after a box rebuild). After that, every deploy re-syncs `scripts/embed-server.py` and `scripts/hetzner/loki-embed.service` and restarts `loki-embed` only when one of them changed:

```bash
bash scripts/hetzner/install-fleet-rag.sh
```

Manual backfill (also runs nightly at 03:30 UTC via `loki-reindex.timer`):

```bash
ssh root@167.233.22.31 'systemctl start loki-reindex.service'
```

Verify: `/memory` shows chunk counts; `pnpm exec tsx scripts/test/rag-retrieval.ts` exercises retrieval.

## Why now

Context injection is Loki's quiet moat. Today it's a **hand-curated project profile** (mission/stack/architecture/DoD) injected wholesale into every dispatch. High signal, but: static (doesn't track the live codebase), manual (someone writes it), and *task-blind* (the whole profile goes in regardless of what's being asked). RAG makes injected context **relevance-ranked and self-maintaining**. The harness essay already named the gap: *"memory is the weakest strut — a fleet should remember more than any one of its agents."* RAG is how that strut gets built.

## The load-bearing decision: captain RAG ≠ runtime RAG

Do **not** build codebase RAG. Claude Code, Hermes, Cursor — every runtime already embeds/searches the repo it's working in, and does it well. Duplicating that at the captain layer is wasted effort and a worse copy.

The captain sees something **no runtime does: the whole fleet + the operator's life.** That's where retrieval is uniquely ours:

1. **Cross-project knowledge** — "do auth in kivvi like aoz-begleitung does it." Only the captain sees both repos' profiles/decisions. This is the engine under the [cross-project-reference](./cross-project-reference.md) spec's *suggested references*.
2. **Fleet memory** — handoffs, orchestration outcomes, decisions, dev-log entries across all projects. "What did we learn last time we touched deploys?" No single agent's memory holds this.
3. **Life-OS recall** — 1,286 contacts, commitments, captures, interactions. Powers Loki answering "what did I promise Manuel?" over the knowledge graph.

Stay out of the runtime's lane; own the fleet's.

## Prior art on this exact stack (reuse, don't reinvent)

- **OrangeCat** (sibling product) already ships it: `services/ai/embeddings.ts` (provider-agnostic, OpenAI-compatible, `text-embedding-3-small` @ 1536-dim, switchable via `EMBEDDINGS_*` env), a `content_embeddings` table, a `match_content(query_embedding, match_count, min_similarity)` cosine RPC with **outcome-aware ranking** (similarity + a quality_score boost), `MIN_SIMILARITY=0.35`, and **hybrid** keyword+semantic with keyword fallback. It runs on Supabase (pgvector via SQL RPCs).
- **Ivy/OpenClaw** already runs **sqlite-vec** local memory (the `main.sqlite` we scrubbed uses the `vec0` extension).
- **Loki box Postgres:** pgvector **0.8.2 available, not installed** — `CREATE EXTENSION vector` is one statement away.

The pattern is proven by the same operator on the sibling product. Port it; don't re-derive it. This is exactly the kind of shared infra the bitbaum-holding thesis wants common across products.

## Architecture (Loki flavor)

Loki is self-hosted Postgres + Drizzle (not Supabase), so use **raw pgvector via Drizzle**, not RPC functions.

```sql
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE knowledge_embeddings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,  -- multi-tenant partition
  source_type text NOT NULL,        -- 'project_profile' | 'dev_log' | 'orchestration_outcome' | 'decision' | 'entity' | 'commitment' | 'thought'
  source_id   text NOT NULL,        -- the row/chunk this came from
  chunk       text NOT NULL,        -- the embedded text
  embedding   vector(1536) NOT NULL,
  metadata    jsonb NOT NULL DEFAULT '{}',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, source_type, source_id)
);
-- cosine; ivfflat to start (simple), HNSW when recall/scale demands.
CREATE INDEX ON knowledge_embeddings USING ivfflat (embedding vector_cosine_ops) WITH (lists = 100);
CREATE INDEX ON knowledge_embeddings (user_id, source_type);
```

- **Embeddings service:** port OrangeCat's `embeddings.ts` near-verbatim — provider-agnostic OpenAI-compatible (`EMBEDDINGS_API_KEY/BASE_URL/MODEL`). Two viable providers, both already on the box: `text-embedding-3-small` (1536, matches OrangeCat → vectors are *cross-product comparable*) or a **Nous Portal** embedding model (`qwen/qwen3-embedding-8b`, `google/gemini-embedding-2` — we just wired Nous). Recommend `text-embedding-3-small` for cross-product consistency; keep it env-switchable. **Pin the dimension** — it's baked into the column; changing models means a migration.
- **Ingest:** embed-on-write on profile/attr/description saves via `src/lib/rag/reindex-project-profile.ts` (fire-and-forget when `EMBEDDINGS_BASE_URL` is set) + `scripts/reindex-knowledge.ts` for backfill. Dev-log / orchestration sources still manual/cron-only (P2).
- **Retrieve:** embed the task → `ORDER BY embedding <=> $query LIMIT k` **filtered by `user_id`** → threshold at ~0.35 → inject a delimited *"Relevant fleet knowledge"* block alongside (not instead of) the curated profile. Hybrid: union with a keyword/`ILIKE` pass for recall (OrangeCat's recall-first lesson).
- **Multi-tenancy:** every query is `user_id`-scoped. This matters doubly given the shared-`main`-agent hazard flagged in [[bug_loki_realname_leak_scrub]] — the index must never cross tenants.

## Where it plugs in

- **Dispatch context** (`assembleInjectPrompt` / inject-core / orchestration/run): project profile block + optional fleet RAG on **both cloud queue and local inject** paths. Previously cloud `/api/inject` queued bare `promptKey` strings.
- **Cross-project reference:** *suggested references* = nearest project-profile embeddings to the task. RAG is the engine for that spec's Phase 3.
- **Loki:** retrieve over life-OS sources before answering — real recall, not just the gateway agent's own memory.
- **Self-improvement loop:** the frontier generator already wants "Loki's real gaps" — retrieve over dev-logs/outcomes to ground proposals.

## What NOT to do (guardrails)

- **No codebase RAG.** The runtime owns it.
- **RAG complements, never replaces, the curated profile.** Inject both. A retrieved chunk is breadth; the profile is the contract.
- **Mind the token budget.** Cap K, threshold hard, summarize. Log truncation (no silent caps).
- **Watch staleness.** Embed-on-write + periodic reindex; a stale index injects wrong context, which is worse than none.
- **Don't gold-plate the index.** ivfflat + one table is plenty at fleet scale (hundreds–thousands of rows). HNSW/sharding is a later problem, if ever.

## Phasing

1. **P0 — substrate:** `CREATE EXTENSION vector`; `knowledge_embeddings` table (Drizzle); port `embeddings.ts`; reindex script. Index **project profiles + dev-logs** first (smallest, highest-leverage, captain-unique).
2. **P1 — inject:** top-K retrieval folded into dispatch context + cross-project *suggested references*. This is the context-injection win.
3. **P2 — fleet memory:** index orchestration outcomes/handoffs/decisions → "what did we learn doing X." Closes the weakest-strut gap.
4. **P3 — life-OS recall:** index entities/commitments/captures → Loki answers over the knowledge graph.

## Cross-product note

Keep `embeddings.ts` + the table shape aligned with OrangeCat so the two products share one embedding convention (same model, same 1536 dim). That makes a future *shared* knowledge layer (bitbaum-level) a migration, not a rewrite — and lets cross-product retrieval (Loki work ↔ OrangeCat economy) become possible later.
