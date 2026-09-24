---
title: The Builder's Operating System
subtitle: A technical architecture for sustained autonomous execution across many projects simultaneously
publishedAt: 2026-09-24
version: 0.4
---

## The Execution Gap

Every serious builder faces the same problem. The tools keep improving. AI models get faster, cheaper, more capable. Yet the bottleneck is never the tool. It is the operator.

The operator is you. The person who must decide what runs next, notice when something breaks, understand what each agent just did, and dispatch the next instruction — across five projects, each in a different state of motion.

This is the execution gap: the distance between the intelligence available in your tools and your ability to direct it consistently, at scale, without burning out or losing the thread.

Loki is an operating system for closing that gap.

## Why Context Switching Kills Momentum

When a builder runs multiple projects simultaneously, each project exists in a mental model: what was last done, what broke, what to tackle next. These models decay. A three-day interruption is not three days of lost progress — it is three days of lost context that must be reconstructed before any progress is possible.

Traditional tools treat this as a knowledge management problem. Write things down. Use wikis. Maintain notes. But the problem is not storage. The problem is time cost and continuity. Reconstructing context is not free.

Loki approaches this differently. The system itself maintains the model. Every agent session writes a structured handoff: what was completed, what comes next, what the health of the codebase is, how many open tasks remain. When you return to a project, Loki surfaces the state — not as a document to read, but as an operational signal: this agent is ready, here is what it proposes to do next.

The operator makes one decision. The loop continues.

## The Agent Paradox

AI agents create a new problem as they solve the old one.

A single agent writing code faster than a human is unambiguously useful. But a portfolio of five or ten agents, each in a different terminal tab, each completing tasks at different moments — this creates coordination overhead that quickly exceeds the time saved.

Loki calls this the agent paradox: the more capable your agents, the more you need a system to manage them. Without a coordination layer, gains from agent execution are partially consumed by the cognitive cost of tracking, directing, and reviewing that execution.

The coordination layer is not an agent. It is an interface.

## The Builder Loop

The fundamental unit of work in Loki is the builder loop:

```
Agent runs → signals completion → Loki surfaces state → operator decides → agent runs
```

Each iteration is one cycle. Loki is built to make this cycle as tight as possible:

1. The agent completes a task and signals the session lifecycle
2. Loki reads the session file and marks the project ready
3. The operator sees the ready state and the proposed next action
4. With one tap or keystroke, the next iteration begins

Auto-continue removes the operator from steps 2–4 entirely for routine continuation. The operator re-enters only when the loop requires judgment: a design decision, an ambiguous requirement, a broken test.

This is not automation for its own sake. It is a division of labor: the agent handles execution, the operator handles judgment. Loki is the interface between them.

## Architecture

Loki is a hosted control plane (a Next.js application) plus a runner that owns the agents. The runner is the always-on cloud builder by default, or the Fleet Runner desktop app on your own machine when you choose that for a project. The control plane never touches a terminal of yours; it talks to runners.

### State Propagation

Agent state flows from the terminal to the UI through a layered propagation mechanism:

The agent writes structured session files to `/tmp` on completion. These files contain the session handoff: what was done, what comes next, health indicators, test status, open tasks. The files follow a naming convention: `agent-ready-<tab>`, `agent-session-<tab>`, `agent-current-prompt-<tab>`.

The Loki SSE stream reads these files at 2-second intervals and emits diff-patched updates to all connected clients. Only changed projects trigger events, keeping bandwidth minimal.

On the client, a React hook consumes the SSE stream and maintains the full project state map. Render cycles are bounded: only components tied to changed projects re-render.

### Agent Execution: The Runner Owns the Process

Sending a prompt to an agent is not typing into your terminal. Loki never borrows a terminal pane, guesses a tab name, or mimics keystrokes into a window you might be using.

Instead, a runner spawns the agent CLI in a pseudo-terminal it owns (node-pty). The agent is a child process of the runner, with a real PTY — it sees a genuine terminal, not a pipe — and the runner holds both ends. Dispatching a prompt means writing into that PTY; watching the agent means reading from it. The browser renders the same byte stream through an embedded terminal, so you can see and type into the live session from the web or your phone.

Each project is identified by a stable id, not by whatever a tab happens to be called. If a project has no running agent when a prompt arrives, the runner starts one — a cold start — instead of failing silently or typing into the wrong place. If a prompt is sent to a session that no longer exists, the failure is loud and names the fix: dispatch to start one.

Because the runner owns the buffer, large prompts are written with backpressure; the class of multiplexer crash that motivated this design cannot happen by construction.

### Where a Project Runs Is a Decision, Not a Guess

Every project has a stored answer to "Runs on": the always-on cloud builder (the default) or the Fleet Runner on your own machine. A checkout that only exists on your laptop stays local; a checkout that lives on the cloud builder stays there. Nothing about who is currently online changes that answer. If the builder you chose is offline, the work queues and the UI says so — it is never quietly rerouted to a different machine.

### Remote Access: The Command Queue

Operators dispatch from a phone, a second machine, or a shared device. The control plane writes each dispatch to a `pending_commands` table; the project's runner claims it over outbound HTTPS, executes it in the PTY it owns, and reports back. The runner pushes runtime state — live sessions, session handoffs, health — to the cloud so the remote UI stays live.

```
Phone → Cloud control plane → pending_commands → Runner-owned PTY → Agent
```

No open ports. No SSH tunnels. No VPN. A runner on your machine makes outbound HTTPS requests only.

### Dispatch Intelligence

When auto-continue fires, Loki does not blindly send "next task." It routes intelligently.

If a prompt queue exists, Loki asks the dispatch router — a Groq inference call on the session handoff and queue contents — whether to drain the queue or run the agent's own judgment. The router returns an action (`queue` or `nextbest`) with a reasoning string that appears in the UI.

The queue drain itself respects health gates: if the session reports critical health or failing tests, queue items are bypassed and the agent is forced into recovery mode. A broken project should fix itself, not accept new tasks that compound the damage.

### Session Lifecycle Signaling

Agent hooks are shell functions executed at the start and end of every Claude Code session. They translate terminal events into Loki state signals:

- Session start: clears ready marker, writes current-prompt sentinel
- Session end: writes session handoff file, sets ready marker, pings Loki
- Hard stop: writes closed and sentinel markers

These hooks are installed once and run automatically. The agent does not need to know about Loki. The shell layer is the integration boundary.

### Point At It: The Product Fits the Person

Every product Loki builds or runs carries the same small control. Whatever a person doesn't like, they point at it, and choose one of two things: **change it for me**, or **show me how to get there**.

The first is a change request: an agent reshapes that part of the product and ships it through the same loop as any other fix. The second is a person who couldn't find their way. Often the product already does what they want, so the answer is the path, made findable from where they were standing, and not a new feature. It is never only an explanation, because whoever comes next gets lost at the same spot.

This is where the system is heading: products that are not the same for everyone, but fitted to each person using them, one pointed-at element at a time. Today a change ships for everyone who uses the product. The next step is changes that apply to one person without being imposed on everyone else.

### The Life OS Layer

Agent orchestration is the fleet management half of Loki. The other half is personal operating surface.

Goals, habits, people, subscriptions, and commitments are tracked in the same interface as project and agent state. This is not an accident of feature creep. It reflects a truth about how serious builders work: the project is not separate from the life. Deadlines exist because of constraints. Habits determine momentum. People are collaborators and stakeholders.

Loki makes this visible together so operators can reason about their actual situation, not a sanitized project view.

## Subscription Tiers

Loki is a hosted SaaS product with four levels: a free tier and three paid tiers. Only the free tier is purchasable today — the three paid tiers are published without prices while the billing rail is finished, and /pricing shows them as such.

**Free** — for commanding your first projects. The full captain dashboard with your own runner and agent keys, limited in project count — enough to see the whole loop working before paying anything.

**Personal** — for solo builders managing up to 5 projects. Cloud builder by default, your own machine via Fleet Runner when you want it, remote access from anywhere. Full project/agent/life OS features. Designed for the individual operator who wants to run the full system without self-hosting.

**Pro** — for power builders running many projects at once, with no project ceiling. Faster dispatch inference, extended prompt history, priority support, and direct access to new features in beta. Intended for builders where Loki is an operational dependency.

**Team** — for small groups sharing a fleet. Multi-user project state, shared prompt queues, and team-level dashboards. Built for pairs and small studios who want a shared execution surface without enterprise overhead.

Self-hosted deployment remains fully supported for operators who prefer to run Loki on their own infrastructure. The architecture is designed to run on a single machine with PostgreSQL.

## The Standard

Loki is not a productivity app. Productivity apps make individual tasks faster. Loki changes the relationship between the operator and the work.

The standard is: the operator stays in judgment mode. The agents stay in execution mode. The system maintains the state that connects them.

When this works correctly, shipping feels like directing, not doing. The operator's leverage is total attention on the decisions that require a human — not the mechanical steps that connect them.

That is the builder's operating system.
