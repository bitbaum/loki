---
title: The Builder's Operating System
subtitle: A technical architecture for sustained autonomous execution across many projects simultaneously
publishedAt: 2026-10-01
version: 0.3.2
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

Autopilot — a per-project on/off switch — removes the operator from steps 2–4 entirely for routine continuation. The operator re-enters only when the loop requires judgment: a design decision, an ambiguous requirement, a broken test.

This is not automation for its own sake. It is a division of labor: the agent handles execution, the operator handles judgment. Loki is the interface between them.

## Architecture

Loki is a hosted control plane (a Next.js application) plus a runner that owns the agents. The runner is the always-on cloud builder for accounts that have access to it, or the Fleet Runner desktop app on your own machine — which is the only option for accounts without cloud access, and a choice per project for everyone else. The control plane never touches a terminal of yours; it talks to runners.

### State Propagation

Agent state flows from the runner to the UI; the web application never reads files on your machine.

At the end of a turn the agent writes a structured handoff for its project to `~/.loki/sessions/<project>.md`: what was done, what comes next, health indicators, test status, open tasks. The file is keyed by project, not by a terminal tab. The runner watches that directory, folds each change into the project's state, and also reads the agent CLI's own live status (for Claude Code, the session status file it maintains) so that a working agent is not mistaken for a silent one.

The runner pushes that runtime state to Loki over outbound HTTPS. Loki fans changes out to every open browser over a server-sent event stream, and only changed projects trigger events, keeping bandwidth minimal.

On the client, a React hook consumes the stream and maintains the full project state map. Render cycles are bounded: only components tied to changed projects re-render.

### Agent Execution: The Runner Owns the Process

Sending a prompt to an agent is not typing into your terminal. Loki never borrows a terminal pane, guesses a tab name, or mimics keystrokes into a window you might be using.

Instead, a runner spawns the agent CLI in a pseudo-terminal it owns (node-pty). The agent is a child process of the runner, with a real PTY — it sees a genuine terminal, not a pipe — and the runner holds both ends. Dispatching a prompt means writing into that PTY; watching the agent means reading from it. The browser renders the same byte stream through an embedded terminal, so you can see and type into the live session from the web or your phone.

Each project is identified by a stable id, not by whatever a tab happens to be called. If a project has no running agent when a prompt arrives, the runner starts one — a cold start — instead of failing silently or typing into the wrong place. If a prompt is sent to a session that no longer exists, the failure is loud and names the fix: dispatch to start one.

Because the runner owns the buffer, large prompts are written with backpressure; the class of multiplexer crash that motivated this design cannot happen by construction.

### Where a Project Runs Is a Decision, Not a Guess

Every project has a stored answer to "Runs on": the always-on cloud builder (the default for accounts that have access to it) or the Fleet Runner on your own machine. A checkout that only exists on your laptop stays local; a checkout that lives on the cloud builder stays there. Nothing about who is currently online changes that answer. If the builder you chose is offline, the work queues and the UI says so — it is never quietly rerouted to a different machine.

### Remote Access: The Command Queue

Operators dispatch from a phone, a second machine, or a shared device. The control plane writes each dispatch to a `pending_commands` table; the project's runner claims it over outbound HTTPS, executes it in the PTY it owns, and reports back. The runner pushes runtime state — live sessions, session handoffs, health — to the cloud so the remote UI stays live.

```
Phone → Cloud control plane → pending_commands → Runner-owned PTY → Agent
```

No open ports. No SSH tunnels. No VPN. A runner on your machine makes outbound HTTPS requests only.

### What Autopilot Sends

When autopilot fires, Loki does not compose a new instruction with a model. It sends the head of the project's prompt queue if there is one, and otherwise a fixed "next best step" prompt that asks the agent to continue from its own handoff. An earlier version asked a model to choose between the two; that router was removed in June 2026 because a fixed rule is predictable and costs nothing.

Health gates run first and win: an agent that declares itself working or blocked is never interrupted; an open question for a human holds the loop until it is answered; three runs in a row that change nothing stop the loop until something changes; and a streak of failed runs trips a brake that hands the project back to a person. A broken project should be fixed, not handed new tasks that compound the damage.

### Session Lifecycle Signaling

Because the runner starts every agent in a terminal it owns, it sees the session's whole lifecycle directly — start, output, exit, crash — and records each as an event. Nothing has to be installed into your shell, and the same mechanism works for every supported agent (Claude Code, Codex, Cursor, Antigravity, Grok), not only one.

The agent's part of the contract is the handoff file described above. The agent does not need to know about Loki beyond writing it; the runner is the integration boundary.

### Beside the Agents

Agent orchestration is the largest part of Loki, but not all of it. The same workspace holds the rest of an operator's work: Today, People, Crew (the humans you hand work to), Money, Goals and Habits.

Goals, habits, people, subscriptions, and commitments are tracked in the same interface as project and agent state. This is not an accident of feature creep. It reflects a truth about how serious builders work: the project is not separate from the life. Deadlines exist because of constraints. Habits determine momentum. People are collaborators and stakeholders.

Loki makes this visible together so operators can reason about their actual situation, not a sanitized project view.

## Subscription Tiers

Loki is a hosted product with four levels: a free tier and three paid tiers. The paid tiers are published without prices, nothing is charged until prices are announced, and /pricing shows them as such. The only difference the product enforces between tiers is how many projects you can have; every feature is on every plan.

**Free** — for your first projects. Everything in Loki, with your own agent sign-ins and keys, limited to 3 projects — enough to see the whole loop working.

**Personal** — for one builder managing up to 5 projects.

**Pro** — for builders running many projects at once, with no project ceiling.

**Team** — for groups sharing a fleet: no project ceiling, plus shared projects and roles.

Because Loki is MIT-licensed, running it on your own infrastructure is possible — the architecture runs on a single machine with PostgreSQL — but a self-hosting guide does not exist yet.

## The Standard

Loki is not a productivity app. Productivity apps make individual tasks faster. Loki changes the relationship between the operator and the work.

The standard is: the operator stays in judgment mode. The agents stay in execution mode. The system maintains the state that connects them.

When this works correctly, shipping feels like directing, not doing. The operator's leverage is total attention on the decisions that require a human — not the mechanical steps that connect them.

That is the builder's operating system.
