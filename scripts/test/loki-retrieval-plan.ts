/**
 * The retrieval planner, and the gate that closes the class it was built for.
 * Run: npx tsx scripts/test/loki-retrieval-plan.ts
 *
 * THE CLASS: a data source reachable only by TOOL CALL is invisible on every
 * turn where the tool loop cannot run — rate-limited, prompt too large, model
 * degraded. Production served that twice with the same symptom, and the
 * symptom is the nastiest kind: "Not in your data." is *true* of the facts the
 * model was handed, so it reads as a checked negative rather than as a failure.
 *
 *   2026-08-14 — the approval queue. Seven drafts waiting; Loki said nothing
 *                was pending.
 *   2026-09-11 — visitor feedback. Two reports filed minutes earlier, four
 *                runs spawned from them sitting in `waiting`; Loki said "Not in
 *                your data." about all of it, because no seed and no tool had
 *                ever read the feedback table at all.
 *
 * Each was fixed once, by hand, for one table. This file is the third fix: a
 * new tool whose data no seed can reach FAILS HERE, so the class cannot come
 * back a fourth time through a table nobody has thought of yet.
 *
 * Env-independent: the planner is pure, and the registry is read for metadata
 * only (names and kinds) — no handler is invoked, so no database is touched.
 */
import assert from "node:assert/strict";
import {
  planRetrieval,
  sourceLimit,
  toolsForPlan,
  SOURCE_IDS,
  type SourceId,
} from "../../src/lib/agent/plan";
import {
  LOKI_ATTENTION_PROMPT,
  LOKI_FEEDBACK_PROMPT,
  LOKI_RUNS_PROMPT,
  LOKI_PROACTIVE_STARTERS,
} from "../../src/config/loki-suggested-actions";

let passed = 0;
const check = (label: string, fn: () => void) => {
  fn();
  passed += 1;
  console.log(`  ✓ ${label}`);
};

async function main() {
  // ── 1. The questions that were answered "Not in your data." ──────────────────
  // Verbatim from the transcripts, typos and all. Each must now plan the source
  // that holds the answer, and plan it FIRST — the fact set is head-sliced when
  // the prompt must shrink, so a subject in the tail is a subject that gets shed.
  {
    const leads: Array<[string, SourceId]> = [
      ["what was the most recent feedback sent", "feedback"],
      ["did my feedback come through", "feedback"],
      ["what did visitors report this week", "feedback"],
      ["what is pening for approval", "approvals"],
      ["what's pending?", "approvals"],
      ["did the run finish", "runs"],
      ["why did it fail", "runs"],
      ["what is stuck", "runs"],
      ["what needs me", "fleet_status"],
      ["how are things going", "fleet_status"],
      ["is everything ok", "fleet_status"],
      ["what did i note about the lease", "captures"],
      ["who is Elena", "people"],
      ["which goal is stuck at 0%", "goals"],
    ];
    for (const [message, expected] of leads) {
      check(`"${message}" plans ${expected} first`, () => {
        const plan = planRetrieval(message);
        assert.equal(
          plan.sources[0],
          expected,
          `expected ${expected} to lead, got [${plan.sources.join(", ")}]`,
        );
      });
    }
  }

  // ── 1b. Genuinely ambiguous questions plan BOTH readings ────────────────────
  // "is anything waiting" is a question about the approval queue AND about runs
  // nobody has picked up, and there is no way to tell which from the words. The
  // cheap move is to retrieve both: a false positive costs a few hundred tokens,
  // a false negative costs a confident wrong answer about the operator's own
  // records. Asserting a single lead here would encode a guess as a rule.
  {
    const ambiguous: Array<[string, SourceId[]]> = [
      ["is anything waiting", ["approvals", "runs"]],
      ["what's blocked", ["runs", "sessions"]],
      ["is anything wrong", ["fleet_status", "alerts"]],
      // Two true answers in this product: a commitment someone made, and an
      // assignment someone accepted. Retrieve both rather than guess.
      ["who owes me what", ["commitments", "crew", "human_tasks"]],
    ];
    for (const [message, expected] of ambiguous) {
      check(`"${message}" plans ${expected.join(" + ")}`, () => {
        const plan = planRetrieval(message);
        for (const id of expected) {
          assert.ok(
            plan.sources.includes(id),
            `expected ${id} in the plan for "${message}", got [${plan.sources.join(", ")}]`,
          );
        }
      });
    }
  }

  // ── 2. Every planned source gets real depth, and background gets a glance ────
  {
    check("the leading source is given depth, the trailing ones a glance", () => {
      const plan = planRetrieval("what was the most recent feedback sent");
      const lead = sourceLimit(plan, "feedback");
      const background = sourceLimit(plan, "projects");
      assert.ok(lead > 0, "the subject must be fetched");
      assert.ok(background > 0, "background must still be fetched");
    });

    check("a question ABOUT projects still gets the whole fleet", () => {
      // "How many projects am I tracking" must never be answered from a sample —
      // a cited partial count reads as a checked one (fact-budget.ts:omission).
      const aboutProjects = planRetrieval("list all my projects");
      assert.equal(aboutProjects.sources[0], "projects", "projects must lead its own question");
      assert.ok(
        sourceLimit(aboutProjects, "projects") >= 40,
        `the whole fleet must be fetched, got ${sourceLimit(aboutProjects, "projects")}`,
      );
    });

    check("projects as BACKGROUND stay small — they crowded out the subject live", () => {
      // Measured on the first production turn after this shipped: a question
      // about FEEDBACK pulled 38 project facts, making a 12912-token prompt that
      // exceeded every Groq window and fell to a vendor whose daily quota was
      // spent. Background that crowds out the subject is cost, not context.
      const aboutFeedback = planRetrieval("what was the most recent feedback sent");
      const limit = sourceLimit(aboutFeedback, "projects");
      assert.ok(
        limit <= 12,
        `projects are background on a feedback question; ${limit} of them is a prompt, not a hint`,
      );
    });

    check('"most recent" shortens the list — the newest few, not a page', () => {
      const recent = planRetrieval("what was the most recent feedback sent");
      const broad = planRetrieval("show me all the feedback on every project");
      assert.ok(
        sourceLimit(recent, "feedback") <= sourceLimit(broad, "feedback"),
        "a recency question must not fetch MORE than a browse question",
      );
    });
  }

  // ── 3. The fleet pulse and projects ride along on every turn ────────────────
  // Cheap, always relevant, and the reason a question Loki did not anticipate
  // still gets a grounded answer instead of an empty page.
  {
    check("every plan includes the fleet pulse and projects", () => {
      for (const message of ["who is Elena", "asdfgh", "what's my next step", ""]) {
        const plan = planRetrieval(message);
        assert.ok(
          plan.sources.includes("fleet_status"),
          `fleet_status missing for "${message}": [${plan.sources.join(", ")}]`,
        );
        assert.ok(
          plan.sources.includes("projects"),
          `projects missing for "${message}": [${plan.sources.join(", ")}]`,
        );
      }
    });

    check("an unrecognised question falls back to a broad sample, never to nothing", () => {
      const plan = planRetrieval("zxcvbnm qwerty");
      assert.equal(plan.broad, true, "no cue matched, so the plan must be marked broad");
      assert.ok(plan.sources.length >= 5, `a broad plan needs breadth, got ${plan.sources.length}`);
      assert.ok(plan.sources.includes("people"), "broad must still look at people");
      assert.ok(plan.sources.includes("runs"), "broad must still look at runs");
      assert.ok(plan.sources.includes("feedback"), "broad must still look at feedback");
    });
  }

  // ── 3b. The shipped starter chips reach the data they promise ───────────────
  // The chip text is the question, and the planner reads the question's words to
  // decide what to fetch. A starter whose wording misses its own surface is a
  // button that cannot answer what it offers — which is precisely what "What
  // needs me" was: it said "review my fleet", so it planned projects, and it
  // could not see a single run, report or alert.
  {
    const starters: Array<[string, string, SourceId[]]> = [
      [
        "What needs me",
        LOKI_ATTENTION_PROMPT,
        ["fleet_status", "runs", "feedback", "approvals", "alerts"],
      ],
      ["Latest feedback", LOKI_FEEDBACK_PROMPT, ["feedback", "runs"]],
      ["How are my runs", LOKI_RUNS_PROMPT, ["runs", "sessions", "fleet_status"]],
    ];
    for (const [label, prompt, expected] of starters) {
      check(`the "${label}" chip plans ${expected.join(", ")}`, () => {
        const plan = planRetrieval(prompt);
        for (const id of expected) {
          assert.ok(
            plan.sources.includes(id),
            `"${label}" promises ${id} but does not plan it: [${plan.sources.join(", ")}]`,
          );
        }
      });
    }

    check("every shipped starter is planned as something, never as a broad guess", () => {
      for (const starter of LOKI_PROACTIVE_STARTERS) {
        assert.equal(
          planRetrieval(starter.prompt).broad,
          false,
          `starter "${starter.label}" matches no cue — it would fall back to a generic sample`,
        );
      }
    });
  }

  // ── 4. The computed briefs are earned, not always-on ────────────────────────
  {
    check("a planning question earns the daily brief", () => {
      assert.equal(planRetrieval("what should I do today?").brief, true);
      assert.equal(planRetrieval("who is Elena").brief, false);
    });

    check("a fleet or run question earns the computed fleet brief", () => {
      assert.equal(planRetrieval("what needs me").fleetBrief, true);
      assert.equal(planRetrieval("did the run finish").fleetBrief, true);
      assert.equal(planRetrieval("what was the most recent feedback sent").fleetBrief, true);
    });
  }

  // ══ 5. THE GATE ═════════════════════════════════════════════════════════════
  // Every read tool's data must ALSO be reachable from the seed. A tool is depth;
  // the seed is survivability. Add a read tool over a new table without a seed
  // source for it and this fails — which is the whole point, because the
  // alternative is discovering it the way the operator did: by being told their
  // own records do not exist.
  {
    // The real registry lives beside handlers that import @/db, which throws at
    // module init without a connection string. A parseable dummy is enough: the
    // assertions below read tool METADATA only and never invoke a handler, so no
    // connection is ever opened, and this file stays env-independent.
    process.env.DATABASE_URL ||= "postgres://test:test@127.0.0.1:5432/test";
    const { LOKI_TOOLS } = await import("../../src/lib/agent/tools/handlers");

    /**
     * Tool → the planner source that covers the same data. Written out rather
     * than derived: the mapping IS the claim being tested, and deriving it from
     * a name convention would let a rename silently satisfy the gate.
     */
    const TOOL_SEED_SOURCE: Record<string, SourceId | "external"> = {
      search_people: "people",
      list_projects: "projects",
      search_knowledge: "knowledge",
      list_feedback: "feedback",
      list_runs: "runs",
      list_active_agents: "sessions",
      fleet_status: "fleet_status",
      list_alerts: "alerts",
      list_goals: "goals",
      list_habits: "habits",
      list_commitments: "commitments",
      list_pending_approvals: "approvals",
      list_notes: "captures",
      // Not Loki data: another agent's memory, reachable only by asking it.
      // Exempt because there is no table to seed from, and its answer is labelled
      // an unverified second-hand report wherever it appears.
      ask_openclaw: "external",
      list_crew: "crew",
      list_human_tasks: "human_tasks",
      suggest_builds: "builds",
    };

    check("every READ tool has a seed source — no tool-only data", () => {
      for (const [name, tool] of Object.entries(LOKI_TOOLS)) {
        if (tool.kind !== "read") continue;
        const mapped = TOOL_SEED_SOURCE[name];
        assert.ok(
          mapped,
          `tool "${name}" has no entry in TOOL_SEED_SOURCE. Every read tool needs a seed source in plan.ts, or its data is invisible whenever the tool loop cannot run — that is how "Not in your data." was served about records that existed. Add the adapter to the seed and map it here, or mark it "external" with a reason.`,
        );
        if (mapped !== "external") {
          assert.ok(
            (SOURCE_IDS as readonly string[]).includes(mapped),
            `tool "${name}" maps to "${mapped}", which is not a SourceId`,
          );
        }
      }
    });

    check("every seed source is reachable by some question — no orphan sources", () => {
      const probes = [
        "what was the most recent feedback sent",
        "did the run finish",
        "what needs me",
        "what is pending for approval",
        "which goal is stuck",
        "what habit am I about to break",
        "what commitments are due this week",
        "who is on my crew",
        "who owes me what",
        "what did I note about it",
        "who is Elena",
        "why did we choose pgvector",
        "what could I build for someone",
        "what should I build next",
        "list my projects",
        "what do we have, name the three pillars",
        "zxcvbnm",
      ];
      const reached = new Set<string>();
      for (const probe of probes) for (const id of planRetrieval(probe).sources) reached.add(id);
      for (const id of SOURCE_IDS) {
        assert.ok(
          reached.has(id),
          `source "${id}" is never planned by any probe — it can be fetched but nothing asks for it`,
        );
      }
    });

    // ── The advertised catalogue ───────────────────────────────────────────
    // Catalogue plus JSON schema cost 3,010 tokens on every turn before a
    // single record — 47% of a measured 6,442-token turn, and the reason Groq's
    // 8,000-token window is skipped on every call. Narrowing what the model is
    // SHOWN buys that back. Narrowing what it may CALL would be a capability
    // cut, so these pin the difference between the two.
    const TOOL_FOR_SOURCE: Partial<Record<SourceId, string>> = {
      feedback: "list_feedback",
      runs: "list_runs",
      sessions: "list_active_agents",
      alerts: "list_alerts",
      fleet_status: "fleet_status",
      approvals: "list_pending_approvals",
      goals: "list_goals",
      habits: "list_habits",
      commitments: "list_commitments",
      crew: "list_crew",
      human_tasks: "list_human_tasks",
      captures: "list_notes",
      people: "search_people",
      knowledge: "search_knowledge",
      projects: "list_projects",
    };

    check("every planned source has its tool advertised", () => {
      for (const probe of [
        "what was the most recent feedback sent",
        "how are my agent runs doing",
        "which goal is stuck",
        "who owes me what",
      ]) {
        const plan = planRetrieval(probe);
        const shown = toolsForPlan(plan);
        if (shown.size === 0) continue; // a broad plan advertises everything
        for (const source of plan.sources) {
          const needed = TOOL_FOR_SOURCE[source];
          if (!needed) continue;
          assert.ok(
            shown.has(needed),
            `"${probe}" plans ${source} but never offers ${needed}: [${[...shown].join(", ")}]`,
          );
        }
      }
    });

    check("the core tools are offered whatever the question", () => {
      // The pulse and project list answer "what else"; the knowledge index
      // answers "why did we decide that"; propose_action is the ONLY lever Loki
      // has on the world, and hiding it would remove the product's point.
      const shown = toolsForPlan(planRetrieval("who is Elena"));
      for (const core of ["fleet_status", "list_projects", "search_knowledge", "propose_action"]) {
        assert.ok(shown.has(core), `${core} must always be offered: [${[...shown].join(", ")}]`);
      }
    });

    check("a question nobody could route advertises EVERYTHING", () => {
      // Unroutable means it might need anything — the one case where the full
      // catalogue is worth its tokens.
      assert.equal(
        toolsForPlan(planRetrieval("zxcvbnm qwerty")).size,
        0,
        "an empty set means no narrowing",
      );
    });

    check("narrowing is strictly smaller than the registry, or it buys nothing", () => {
      const shown = toolsForPlan(planRetrieval("what was the most recent feedback sent"));
      assert.ok(shown.size > 0, "a routed question narrows");
      assert.ok(
        shown.size < Object.keys(LOKI_TOOLS).length,
        `narrowed to ${shown.size} of ${Object.keys(LOKI_TOOLS).length}`,
      );
    });

    check("every advertised name is a real tool — a catalogue cannot invent one", () => {
      for (const probe of ["what needs me", "who is Elena", "how are my runs", "which goal"]) {
        for (const name of toolsForPlan(planRetrieval(probe))) {
          assert.ok(name in LOKI_TOOLS, `advertised "${name}" is not in the registry`);
        }
      }
    });

    check("propose tools are exempt, and there is still no execute kind", () => {
      const kinds = new Set(Object.values(LOKI_TOOLS).map((t) => t.kind));
      assert.deepEqual(
        [...kinds].sort(),
        ["propose", "read"],
        "Loki may read and propose. An execute kind is a product decision, not a refactor.",
      );
    });
  }

  console.log(`✓ loki retrieval plan: ${passed} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
