// Backfill the fleet-knowledge vector index — everything Loki should know about
// the operator's work, in one searchable place:
//   project_profile (dossier) · dev_log · goal (roadmaps/task-lists) · thought
//   (the published strategic essays — how the projects relate).
//
// Run on the box (where pgvector + the embed server live):
//   EMBEDDINGS_BASE_URL=http://127.0.0.1:7997/v1 DATABASE_URL=… \
//     node_modules/.bin/tsx scripts/reindex-knowledge.ts
//
// Idempotent — upserts on (user_id, source_type, source_id). Safe to re-run.
// Later phases can add orchestration_outcome / decision / entity / commitment.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { getAllDistinctUserIds, getUserProjects } from "@/db/queries/user-projects";
import { getSelfImprovementTarget } from "@/db/queries/frontier";
import { loadFleetMap } from "@/lib/register/load-map";
import { renderFleetMapOverview } from "@/lib/register/map";
import { getProjectContext } from "@/db/queries/project-context";
import {
  getProjectDossierByProjectKey,
  renderProjectDossierForAgent,
} from "@/db/queries/project-dossier";
import { getGoals, type GoalWithChildren } from "@/db/queries/goals";
import { listThoughts } from "@/lib/thoughts-content";
import {
  upsertKnowledgeBatch,
  pruneKnowledgeToIds,
  type KnowledgeItem,
} from "@/db/queries/knowledge-embeddings";
import { cleanDescription } from "@/lib/project-display";
import { chunkMarkdown } from "@/lib/rag/chunk";
import { embeddingsEnabled } from "@/lib/rag/embeddings";
import type { DevLogEntry } from "@/db/schema/user-projects";
import type { Milestone } from "@/db/schema/goals";

// repo_doc caps: bound embed cost per run. README first, then docs/ markdown.
const MAX_DOC_FILES = 15;
const MAX_CHUNKS_PER_FILE = 30;
const MAX_DOC_CHUNKS_PER_PROJECT = 120;

/**
 * A project's own README + docs/ markdown from the local checkout
 * ($LOKI_REPOS_DIR or ~/dev/<project>). This is the product-level
 * knowledge (what the app does, how its features work) that profiles and
 * dev logs never contain — without it Loki answered "how does X work in
 * <project>" questions with generic filler (2026-07-17: revampit time
 * cards, while the repo had a complete Zeiterfassung feature).
 */
function readRepoDocs(project: string): Array<{ rel: string; body: string }> {
  const base = process.env.LOKI_REPOS_DIR || path.join(os.homedir(), "dev");
  const repo = path.join(base, project);
  if (!fs.existsSync(path.join(repo, ".git"))) return [];
  const files: string[] = [];
  for (const name of ["README.md", "readme.md"]) {
    if (fs.existsSync(path.join(repo, name))) {
      files.push(name);
      break;
    }
  }
  const docsDir = path.join(repo, "docs");
  if (fs.existsSync(docsDir)) {
    const walk = (dir: string, depth: number) => {
      if (depth > 2 || files.length >= MAX_DOC_FILES) return;
      for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
        if (files.length >= MAX_DOC_FILES) return;
        const full = path.join(dir, e.name);
        if (e.isDirectory() && !e.name.startsWith(".") && e.name !== "node_modules")
          walk(full, depth + 1);
        else if (e.isFile() && e.name.endsWith(".md")) files.push(path.relative(repo, full));
      }
    };
    walk(docsDir, 0);
  }
  const out: Array<{ rel: string; body: string }> = [];
  for (const rel of files) {
    try {
      const body = fs.readFileSync(path.join(repo, rel), "utf8");
      if (body.trim()) out.push({ rel, body });
    } catch {
      /* unreadable file — skip, never fail the reindex */
    }
  }
  return out;
}

/** Flatten the goal tree (parents + nested children) into one list. */
function flattenGoals(nodes: GoalWithChildren[]): GoalWithChildren[] {
  const out: GoalWithChildren[] = [];
  for (const n of nodes) {
    out.push(n);
    if (n.children?.length) out.push(...flattenGoals(n.children));
  }
  return out;
}

async function main() {
  if (!embeddingsEnabled()) {
    console.error("[reindex] EMBEDDINGS_BASE_URL not set — nothing to do.");
    process.exit(1);
  }
  const userIds = await getAllDistinctUserIds();
  const owner = await getSelfImprovementTarget().catch(() => null);
  let totalChunks = 0;
  for (const userId of userIds) {
    const projects = await getUserProjects(userId);
    const items: KnowledgeItem[] = [];
    for (const p of projects) {
      // project_profile: the same rich context block we inject per dispatch.
      const dossier = await getProjectDossierByProjectKey(userId, p.name).catch(() => null);
      const ctx = dossier
        ? renderProjectDossierForAgent(dossier)
        : await getProjectContext(userId, p.name).catch(() => null);
      // cleanDescription: never embed the bulk-import placeholder as project context.
      const profile = [p.name, cleanDescription(p.description), p.stack, ctx]
        .filter(Boolean)
        .join("\n");
      if (profile.trim()) {
        items.push({
          sourceType: "project_profile",
          sourceId: p.name,
          chunk: profile.slice(0, 6000),
          metadata: { project: p.name },
        });
      }
      // dev_log: the recent narrative of what's happening on the project.
      const log = (p.devLog as DevLogEntry[]) ?? [];
      const recent = log
        .slice(-8)
        .map((e) => `${e.date}: ${e.done}${e.next ? ` → next: ${e.next}` : ""}`)
        .join("\n");
      if (recent.trim()) {
        items.push({
          sourceType: "dev_log",
          sourceId: `${p.name}:devlog`,
          chunk: `Dev log for ${p.name}:\n${recent}`.slice(0, 6000),
          metadata: { project: p.name },
        });
      }
      // repo_doc: the project's own README/docs — see readRepoDocs.
      let docChunks = 0;
      for (const doc of readRepoDocs(p.name)) {
        if (docChunks >= MAX_DOC_CHUNKS_PER_PROJECT) break;
        const passages = chunkMarkdown(doc.body, {
          maxChars: 1400,
          prefix: `${p.name} docs — ${doc.rel}`,
        });
        for (const [i, chunk] of passages.slice(0, MAX_CHUNKS_PER_FILE).entries()) {
          if (docChunks >= MAX_DOC_CHUNKS_PER_PROJECT) break;
          items.push({
            sourceType: "repo_doc",
            sourceId: `${p.name}:doc:${doc.rel}#${i}`,
            chunk: chunk.slice(0, 2000),
            metadata: { project: p.name, file: doc.rel },
          });
          docChunks++;
        }
      }
    }

    // goal: each project's roadmap / task list. What every project is trying to
    // achieve — the raw material for cross-project synthesis ("how do these fit
    // together"). entityName is the project the goal belongs to (joined query).
    const goals = await getGoals(userId).catch(() => [] as GoalWithChildren[]);
    for (const g of flattenGoals(goals)) {
      const ms = ((g.milestones as Milestone[] | null) ?? [])
        .map((m) => `${m.done ? "✓" : "○"} ${m.title}`)
        .join("; ");
      const chunk = [
        `Goal${g.entityName ? ` for ${g.entityName}` : ""}: ${g.title}`,
        g.description ?? "",
        `Status: ${g.status} · ${g.progress ?? 0}% complete`,
        ms ? `Milestones: ${ms}` : "",
      ]
        .filter(Boolean)
        .join("\n");
      items.push({
        sourceType: "goal",
        sourceId: `goal:${g.id}`,
        chunk: chunk.slice(0, 4000),
        metadata: { project: g.entityName ?? "", title: g.title },
      });
    }

    // thought: the published strategic essays. This is where the operator has
    // written down HOW the projects relate (three-layer thesis, the two halves,
    // etc.) — so Loki can reason about synergies from first-hand sources, not
    // guess. Split each essay into section-sized passages so retrieval returns
    // the relevant part, not a truncated whole. Global content, indexed per user
    // so per-user retrieval reaches it.
    for (const t of listThoughts()) {
      const passages = chunkMarkdown(t.body, { maxChars: 1400, prefix: `Essay: ${t.title}` });
      const chunks = passages.length ? passages : [`Essay: ${t.title}\n${t.summary}`];
      chunks.forEach((chunk, i) => {
        items.push({
          sourceType: "thought",
          sourceId: `thought:${t.slug}#${i}`,
          chunk: chunk.slice(0, 2000),
          metadata: { title: t.title, slug: t.slug },
        });
      });
    }

    // fleet_map: the whole studio in one chunk — every project with its purpose,
    // layer, state, doors and last movement. Per-project chunks answer "what is
    // X"; this one answers "what do we have" and "what is happening", which
    // used to come back as "Not in your data" because no single chunk held the
    // shape of the fleet. Owner-scoped, like the map endpoint it mirrors.
    if (owner && userId === owner.userId) {
      // The owner's own index: client work is theirs to know about, consent or not.
      const map = await loadFleetMap("operator").catch(() => null);
      if (map) {
        items.push({
          sourceType: "fleet_map",
          sourceId: "fleet",
          chunk: renderFleetMapOverview(map).slice(0, 12000),
          metadata: { projects: map.summary.projects, generatedAt: map.generatedAt },
        });
      }
    }

    // Insert-first, prune-after: upsert the fresh set, then (only if it produced
    // rows) drop owned-type orphans not in it. Ordering matters — deleting first
    // would empty the index whenever the embed step fails (learned the hard way).
    const n = await upsertKnowledgeBatch(userId, items);
    if (n > 0) {
      await pruneKnowledgeToIds(
        userId,
        ["project_profile", "dev_log", "goal", "thought", "repo_doc", "fleet_map"],
        items.map((i) => i.sourceId),
      );
    }
    totalChunks += n;
    console.log(
      `[reindex] user ${userId.slice(0, 8)}…: ${n}/${items.length} chunks (${projects.length} projects)`,
    );
  }
  console.log(`[reindex] done — ${totalChunks} chunks indexed across ${userIds.length} user(s)`);
  process.exit(0);
}

main().catch((e) => {
  console.error("[reindex] failed:", e);
  process.exit(1);
});
