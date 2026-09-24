# Loki — positioning (one-pager)

**Loki is the captain's bridge over AI agent runtimes — not a runtime, not an agent.**

## What we are
The **orchestration + governance layer** for builders running many AI agents across many projects. Loki points runtimes (Claude Code, Grok Build, Codex, Cursor, OpenClaw, Hermes) at projects, and gives you one place to **command, see, verify, and govern** all of them — from anywhere, including your phone.

## What we are NOT
A better coding agent. That layer is commoditizing and far better-funded than us. We don't out-build Nous's Hermes or Anthropic's Claude Code — **we orchestrate them.** OpenClaw and Hermes are *adapters in our registry*, not rivals.

## The layer model
```
Models            Claude · Grok · Llama …                      intelligence
Model routing     OpenRouter                                   vendor-agnostic access
Runtimes/workers  Claude Code · Grok Build · Hermes · OpenClaw  one agent: tools, memory,
                  · Cursor · Codex                              skills, execution
► LOKI ◄    the captain                                   command + verify + govern
                                                                across many agents & projects
Economy/gov       OrangeCat · Solon                             work plugged into value
```

## One identity, many swappable engines
You talk to exactly **one** agent — **Loki**. Under Loki sits a roster of interchangeable *runtimes* (Claude Code · Grok · Codex · Cursor · Gemini · OpenClaw — and others as they earn their place) behind a single adapter contract. The roster is plumbing the user never sees; the **identity stays singular**. More runtimes is the bet (agent-neutrality) — two identities was never the plan. **Rule: a runtime joins the roster when we'll actually run it, not for completeness.** (Hermes, e.g., is a parked spike until the hosted runner ships — see below.)

## The moat — what only a captain can do
- **Cross-model verification.** Your work is judged by a *different model lineage* than the one that did it — so "done" means done. Structurally impossible for a single-agent runtime (its judge would be itself). Shipped: the definition-of-done stop-gate.
- **Govern + see across the fleet.** Queues, handoffs, per-project autonomy, one injected bar for "done", live status across every project.
- **A compounding loop + economy.** A self-improvement loop (frontier digest → cross-model verify → human-gated goals) and the OrangeCat economic layer. No worker tool builds this.

## Where it goes: the product fits the person
Every product Loki runs carries one control. Whatever you don't like, you point at it and pick **change it for me** or **show me how to get there**. Loki then builds the experience you want, or shows you the path and makes it findable. The end state is products fitted to each person using them, not one shape for everyone. SSOT: `docs/architecture/tailored-experience.md`. Shipped: pointing and both intents (2026-09-24). Not yet: tailoring for one person only, rather than shipping the change to everyone.

## Strategy in one line
**Borrow the workers, own the bridge.** Execution and per-agent skills we increasingly *orchestrate* (a Hermes adapter inherits its sandboxed backends + skill loop); cross-fleet verification, governance, and the economy we *build*. Anything a single agent can do for itself, we adopt. Anything only a captain over many agents can do, we own.

## Who it's for
Builders running **multiple projects** who want autonomous agents they can trust and steer — not a single chat window. For individuals: command your whole fleet, with verification you can believe. For teams (the part we're still building): multi-tenant governance + the shared economy.

## Honest status (2026-06)
Single-builder, pre-1.0, shipping fast. Real and live: the adapter registry (6 live runtimes; a 7th — Hermes — is a proven spike, parked out of the active catalog until the hosted runner wires it), cross-model verification, project-context injection, the self-improvement loop, a local Fleet Runner, and a phased hosted runner. Not yet: multi-tenancy (Phase 3), and hosted execution is mid-build (Phase 0 read-only live; Phase 1 = orchestrate Hermes). We compete with no one on this list — we sit above them.
