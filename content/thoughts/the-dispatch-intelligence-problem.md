---
title: "The Dispatch Intelligence Problem: Why Blind Autocontinue Breaks the Flow"
summary: A first-principles analysis of why mechanical queue drain undermines project momentum, what it would mean for Loki to dispatch intelligently, and the path toward embedding a genuine strategist in the loop.
excerpt: The queue is a backlog. The next best step is a forecast. Blindly draining one while ignoring the other is not automation — it is slot machine pressing. Loki needs a dispatch layer that can read context and decide.
publishedAt: 2026-05-14
supersededBy: /whitepaper
tags: architecture,autoprompting,queue,orchestration,ai,dispatch,intelligence
featured: true
author: g
readingTimeMin: 15
---

## The Scenario

You are building a new authentication module. The agent finishes a full implementation pass — route handlers, session logic, password hashing, the works. The handoff says: done: implemented auth module, next: write tests for the new session logic, health: needs attention (tests failing).

Your queue has three items you wrote earlier in the day:

1. "Add a dark mode toggle to the settings page"
2. "Update the README with the new env vars"
3. "Draft the billing page wireframe"

Autocontinue fires. The system faithfully drains the queue. Item one gets injected: "Add a dark mode toggle to the settings page."

The agent dutifully pivots. It starts touching the settings page. Meanwhile, the auth module it just built has zero tests, a health flag of "needs attention," and failing CI. In three hours, when you come back to the machine, you have a dark mode toggle that nobody asked for yet and a security-critical module that nobody verified.

The system did exactly what you told it to do. That is the problem.

## The Status Quo

The current dispatch logic is a strict priority ladder:

```
autocontinue fires
  └── queue has items? → inject queue[0], shift queue
  └── queue empty?     → run next_best (AI-generated from session handoff)
```

This is mechanical. It is also, in a narrow technical sense, correct — it does what the interface suggests. The queue is supposed to represent the human's intent. The system respects that intent by draining it before falling through to the AI planner.

But the logic misses a layer of reasoning that a thoughtful human would apply naturally: **does the queued item make sense to inject right now, given what was just completed?**

The queue is a backlog. Items are added at the moment of inspiration — you think of something while the agent is three steps ahead in a different concern, and you write it down so you don't lose it. By the time the agent finishes its current task and autocontinue fires, the queued item may be wildly out of context. The agent was deep in auth. Now you're telling it to do dark mode. It has to mentally context-switch mid-flow. The project has to context-switch. The natural continuation thread breaks.

A human pair programmer would not do this. They would look at the handoff — tests failing, health needs attention — and say: "Let's finish this before we move to the settings page." The queue item stays in the backlog. The natural flow continues.

The system currently has no mechanism to make that judgment.

## Why This Matters More Than It Seems

The cost of an artificial flow break is not just one misplaced session. It compounds.

When an agent pivots to an unrelated task mid-flow, it loses the working context it had built up around the previous concern. If it was deep in an auth module, its "recent reasoning" — which files it had read, which edge cases it had considered, which patterns it had already applied — gets overwritten by the new task. When the queue eventually drains and the system loops back to auth, the agent starts with less context than it had at the point of interruption.

Modern LLMs have a context window, but they have something more subtle too: a kind of active working model of the project that accumulates over a session. Interrupt it with an unrelated task and that model has to be rebuilt from scratch. This is not free.

There is also a correctness cost. The session handoff said health was "needs attention." The system ignored that signal entirely — it just drained the queue. If the auth module has a security vulnerability, it is now sitting unexamined in the codebase while the agent adds a color toggle. Every commit made during the dark mode session is built on top of unreviewed, potentially broken foundations.

The queue feels like control. In this scenario, the queue was an anti-control mechanism. It overrode the most important signal the system had — the agent's own assessment that something was incomplete — in favor of a task written down in a moment of unrelated inspiration.

## The Three Possible Worlds

There are fundamentally three philosophies you could adopt for dispatch:

### World A: Queue Supremacy

The queue is always king. If it has items, inject them. Trust the human to manage the queue correctly. If the human writes "fix auth tests" before "dark mode toggle," the system respects that ordering. If the human doesn't, they get what they asked for.

This is the current world. Its virtue is predictability: the system does exactly what the interface says. Its failure mode is that humans use the queue as a "don't lose this thought" scratchpad, not as a carefully ordered execution plan. The ordering in the queue at any given moment reflects the order in which ideas occurred to the human, not the order in which they should be executed relative to the current agent state.

### World B: Next-Best Supremacy

The AI planner always decides. Queue items are suggestions that the planner considers alongside the handoff state, git delta, test results, and goal context. It may choose a queue item. It may choose something else. The queue becomes advice, not commands.

This is the most capable world. A good AI planner with full context should produce better sequences than either blind queue drain or static next-best. Its failure mode is control erosion: the human queued specific things because they have specific reasons, and overriding those without explanation violates trust. If the system keeps doing something other than what the queue says, the human stops using the queue.

### World C: Contextual Triage

A dispatch layer sits between the trigger and the injection. Before choosing what to inject, it reads the current session state and evaluates the queue against it. It may inject a queue item if the item is contextually relevant. It may suppress a queue item and run next-best if the agent's handoff signals urgency. It may ask the human for guidance if genuinely uncertain. The queue retains its role as a human-directed backlog; the planner retains its role as the continuity engine; and neither blindly overrides the other.

This is the right world. It is also the hardest world to build.

## What Contextual Triage Actually Requires

For a dispatch layer to make an intelligent choice, it needs to answer one question: **is the next queue item contextually appropriate given the state the agent just left?**

That question requires reading:

**The session handoff.** The `done`, `next`, `health`, `tests`, and `todos` fields from the last Claude stop. This is the agent's own assessment of where things stand. If `health` is anything other than "good," or if `tests` shows failures, or if `next` describes an obvious follow-up that is not the queue item, the handoff is signaling that the natural flow should continue.

**The queue.** Not just item zero, but all items. The dispatch layer should ask: does any item in the queue relate to what was just completed? If yes, that item may be good to inject even if it is not first. If none relate, the flow-continuation case gets stronger.

**The git delta.** Files changed in the last session tell you what concerns the agent was working in. If auth-related files changed and the queue item touches the settings page, those concerns are orthogonal.

**The goal context.** If the project has active goals linked to this session's work, completing the current thread before starting the next one has compounding value. Goal progress is a strong signal that continuity matters.

**The urgency signals.** Health "critical," failing tests, deployment issues — these are reasons to stay in the current concern even if the queue has items that would normally qualify.

None of these signals individually is conclusive. The power comes from reasoning across all of them simultaneously, which is exactly what a human would do naturally and what a rule-based system cannot.

## The Case for Embedded AI

The dispatch layer described above is not something you can implement with a decision tree. There are too many signals, too many possible queue items, too many kinds of session states. A rule-based dispatcher will either be too permissive (inject queue blindly) or too conservative (always prefer next-best), and the edge cases will be endless.

What the dispatch layer actually needs is an LLM call.

This is where Loki gets its own brain — not the Claude or Codex or Gemini instance running inside the terminal on the local machine, but a lightweight model embedded in the web application itself, capable of reasoning about dispatch decisions before anything reaches the agent.

The call is fast and cheap. It does not need a frontier model. A prompt like:

```
The agent just finished a work session. Here is the handoff:

done: implemented auth module
next: write tests for the new session logic
health: needs attention (tests failing)

Here are the pending queue items:
1. Add a dark mode toggle to the settings page
2. Update the README with the new env vars
3. Draft the billing page wireframe

The following files were changed in the last session: src/auth/*, src/middleware/*.

Question: Should the system drain queue item 1 ("Add a dark mode toggle to the settings page") 
or run next_best to continue the current auth work? 

Answer in one word: QUEUE or NEXTBEST. Then in one sentence, explain why.
```

This is a classification task on a small structured input. A fast model — Groq's Llama-3.1-8b or Mistral-7b, both free-tier accessible — can resolve it in under 300ms. The call costs fractions of a cent. The decision is correct far more often than any rule-based alternative.

The answer arrives before the autocontinue fires. The dispatch layer routes accordingly.

## Groq and the Embedded Intelligence Layer

The `groq-neon-and-the-next-infra-layer.md` article introduced Groq as the free intelligence tier. This is exactly the use case it exists for in Loki. Groq's API provides:

- Sub-second responses on Llama-3.1-8b and Mixtral-8x7b
- A generous free tier (14,400 requests per day, 30 RPM on free tier)
- No streaming required for dispatch decisions (single-shot classification)

The architecture is simple:

```
autocontinue fires (frontend)
  → POST /api/control/dispatch (Next.js route)
    → reads session handoff from beacon file / DB
    → reads queue from file / DB
    → reads recent git delta from project state
    → calls Groq: "QUEUE or NEXTBEST?"
    → returns { action: "queue" | "nextbest", reason: string }
  → frontend receives decision
  → injects accordingly
  → shows reason in the ready banner ("Continuing auth work — queue item postponed")
```

The reason is important. If the system overrides the queue, the human needs to see why. Transparency is what makes the intelligence trustworthy. A dispatch decision with no explanation is a black box. A dispatch decision that says "health needs attention — finishing current thread before switching concerns" is a collaborator.

For paying users, or for projects where the stakes are higher, the same call can route to Claude Haiku, GPT-4o-mini, or Gemini Flash — models that understand more nuance in the handoff signal and can reason about goal context at a deeper level.

This is the beginning of Loki having its own intelligence: not intelligence that executes code, but intelligence that decides how to route the execution that happens inside the terminal.

## The Smarter Queue

The dispatch layer changes the relationship between the queue and next-best from a strict priority hierarchy to a collaborative negotiation. Some implications:

**Queue items get annotated with context.** When you add an item to the queue, Loki records the current project state alongside it: what the last handoff said, what branch was active, what files were recently changed. At dispatch time, the AI sees not just the item text but when and under what conditions it was written. "Add dark mode" written immediately after a design review carries different weight than "add dark mode" written during an unrelated debugging session.

**The queue can surface reasoning.** Rather than silently draining or silently skipping, the ready banner can show: "Queue item postponed: auth tests failing. Will return to dark mode after tests pass." The human sees the decision. They can override it if the AI got it wrong.

**Urgent queue items can override continuity.** Some queue items should jump the AI's continuity preference. "URGENT: revert the last deployment" is not something the system should postpone because the handoff says next_best would do auth tests. Urgency markers — explicit or inferred from language — give certain items dispatch priority regardless of context.

**The queue becomes a prioritized backlog, not a FIFO.** The AI can reorder queue items based on their relevance to the current project state. Items related to the concern the agent just worked in float to the top. Items for completely separate concerns sink. The human's explicit ordering is respected as a tiebreaker, not as an absolute command.

## What This Means for the Vision

The portable cockpit article describes a system where the human directs intent and machines handle execution. The direction is the hard part. Injecting a queue item is not direction — it is a scheduled task. Choosing the right thing to inject at the right moment is direction. That is a judgment call.

The current system has no judgment layer. It is a trigger connected to a dispatch rule. Good projects succeed despite this — because the human watches the handoff and corrects course manually. Bad projects drift because the human is away (on a walk, in a meeting, asleep) and the system keeps draining the queue mechanically, accumulating a set of half-finished concerns that need to be untangled later.

The embedded AI dispatch layer is what completes the portable control plane. Without it, you can observe the system from your phone but you cannot trust the system to make good choices while you are away. With it, you can walk away with higher confidence: the system is not just executing — it is reasoning about what to execute and telling you why.

The next step in autoprompting is not a better prompt. It is a smarter dispatcher.

## The Implementation Path

The dispatch intelligence should be built incrementally, in a sequence that preserves trust at each step:

**Step 1 — Expose the handoff signal in the dispatch decision.**
Before any AI call, teach the existing logic to check the handoff health. If health is "critical" or tests are failing, suppress queue drain and run next-best regardless. This is a rule, not AI, but it captures the most obvious cases where queue drain is clearly wrong. It ships in a day.

**Step 2 — Add the Groq dispatch call.**
Wire `/api/control/dispatch` as a new route that wraps the Groq classification call. Test it independently with real handoffs and queue items. Confirm the decisions are reasonable. The frontend does not change yet — the route exists but is not wired into autocontinue.

**Step 3 — Wire dispatch into autocontinue.**
Replace the current `shiftQueue() or sendIntent("next_best")` logic with a call to `/api/control/dispatch`. Show the reason in the ready banner. Ship behind a per-project toggle ("smart dispatch") so users can opt in while the logic matures.

**Step 4 — Add queue item context annotations.**
Store the current project state snapshot alongside each enqueued item. Make the dispatch AI aware of when each item was written relative to the current state.

**Step 5 — Make the queue dynamic.**
Let the dispatch AI suggest reorderings of the queue based on current context. Show the suggested order in the UI. Let the human accept or reject it.

Each step makes the system meaningfully smarter. Each step is independently shippable. The trust builds with the capability.

## The Bottom Line

Autocontinue's current design treats the queue as an oracle — if items are present, they represent the human's will, and that will is dispatched without question. This works when the human manages the queue with surgical precision, reviewing it after every session and ensuring item ordering reflects current context.

Real usage is nothing like that. The queue is where you dump thoughts while the agent is running. It is a capture buffer. The items are not ordered by execution priority — they are ordered by the moment inspiration struck.

A system that blindly drains a capture buffer and calls that "automation" is performing control theater. It is pretending to be autonomous while actually just accelerating the human's least-considered decisions.

The real autoprompting problem is this: every time the agent stops and autocontinue fires, the system is making a judgment call. It is deciding what the project needs most right now. Currently that judgment call is made by a priority rule that has no context. It should be made by an intelligence layer that reads the handoff, understands the queue, and dispatches the genuinely best next step — whether that is a queue item, a next-best plan, or a suggestion that the human take a look before continuing.

The queue is a tool. The dispatcher is the strategist. We have been shipping the tool without building the strategist.

That is the next thing to build.
