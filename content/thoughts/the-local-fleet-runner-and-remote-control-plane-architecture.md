---
title: The Local Fleet Runner and the Remote Control Plane
summary: Why the daemon-centric model was a necessary bootstrap, why the best teams are converging on something cleaner, and the right long-term shape for Loki — a local runner that executes and a remote control plane that decides.
excerpt: Our current daemon-centric model was a necessary bootstrap. The cleaner shape splits the system in two — a local runner that owns execution on the machine, and a remote control plane that owns state, decisions, and visibility.
publishedAt: 2026-05-17
supersededBy: /whitepaper
tags: fleet-runner,architecture,control-plane,daemon,local-first
featured: false
author: Loki
readingTimeMin: 6
---

# The Local Fleet Runner + Remote Control Plane Architecture

**Why our current daemon-centric model was a necessary bootstrap, why the best teams are converging on something cleaner, and what the right long-term shape actually looks like for Loki.**

*May 2026*

---

## For the Non-Technical Reader (Start Here)

Imagine you are a builder who runs 8–12 serious AI agents at the same time across different projects.

Right now, you have two places you want to interact with them:

1. **On your own computer** — where the agents actually live and do work (in your terminal, with access to your files, git, tests, etc.).
2. **From anywhere else** — your phone on the train, another laptop, a browser at a cafe, or a shared team view.

The dream is simple:
- The agents run reliably on *your* machines (fast, private, with full access to your environment).
- You can see what they're doing and steer them from the web or phone without losing power or context.
- The experience feels coherent whether you're sitting at the machine or controlling it remotely.

This is not a small feature. It is the fundamental product architecture question.

Most early tools solved this by running everything in the cloud (easy remote control, but weak local experience) or everything locally with no good remote story (great when you're at your desk, useless when you're not).

The winning pattern that is emerging in 2026 among the most serious teams is this:

**Make the local machine the authoritative place where the real work happens.** Build a proper local application that feels like a first-class product (think "Cursor for your entire agent fleet"). Then let the web and mobile act as high-quality remote control surfaces that talk to that local application.

This post explains:
- Why our current approach (a web app that sometimes talks to a background daemon) was reasonable but ultimately transitional.
- What Cursor, Anthropic, and xAI are actually doing at the architectural level.
- What the cleaner, more scalable model looks like in detail.
- How we should think about building toward it without blowing up everything that already works.

If you're non-technical, you can stop after the next two sections and still understand the strategic choice in front of us.

---

## The Core Tension (Why This Is Hard)

Any system that wants to give people powerful AI agents faces a fundamental conflict:

- **Local execution is better** for speed, privacy, access to real files/tools/credentials, low latency, and working with the exact environment the user cares about.
- **Remote/cloud execution is better** for long-running tasks, parallelism, working when the user's laptop is closed, and easy access from any device.

Most teams end up with a messy compromise. We certainly have.

The question is not "local or cloud?" — the best systems use both. The real question is:

**Who owns the execution, and how does the remote control surface talk to it cleanly?**

Get this wrong and you accumulate years of painful workarounds. Get it right and a lot of other problems become much easier.

---

## Our Current Architecture (The "Dual Runtime + Daemon" Model)

As of May 2026, Loki is a hybrid system. This is documented clearly in `docs/development/cloud-local-workflows.md`.

### The Two Worlds

When someone uses the hosted web portal (`loki.vercel.app`):

- All commands (send prompt, switch agent, pause auto-continue, etc.) go to our backend.
- Because the backend has no access to the user's machine, it writes the work into a queue (database or events).
- A program the user runs on their own computer (the daemon) polls for work, executes it against their local Zellij sessions, and pushes status back.

When someone runs the web server locally with `RUNTIME_AVAILABLE=true`:

- The same web UI code can sometimes talk directly to Zellij on that machine.
- This path is faster and more direct for people who want to run everything on their laptop.

We also have two different implementations of the "local executor":
- The older, production-oriented `cockpit-daemon.sh`
- The newer, more ambitious `home/` stack (Brain + Bridge + Worker)

This creates the pattern we have discussed at length: heavy branching on `isRuntimeAvailable()`, command queuing, state pushing, reliability bandaids (singleton locks, failure budgets, stale command reclaim, etc.), and the constant feeling that the web UI is one step removed from reality.

### Why We Ended Up Here

This model made sense as a bootstrap:

- It let us offer a hosted web experience without requiring users to keep a web server running 24/7.
- It let power users run everything locally when they wanted maximum speed and control.
- It was possible to ship incrementally while we were still figuring out the product.

It is the classic "personal power tool that grew into a multi-user SaaS" architecture. Many great products go through this phase.

The problem is that it does not scale gracefully into the product we actually want to build.

---

## What the Serious Teams Are Actually Doing in 2026

I researched the current (May 2026) architectures of the three closest comparables.

### Cursor

Cursor runs a hybrid model, but with clearer ownership:

- The **local IDE** (their VS Code fork) is the primary, high-fidelity execution environment for interactive work.
- Long-running or parallel agents run in isolated cloud VMs (or self-hosted workers in the user's infrastructure).
- They have explicit **handoff** between local and cloud sessions.
- Remote monitoring and control from web/mobile exists, but local execution is still privileged when the user is at their machine.

Crucially, they treat the local runtime as first-class rather than something the cloud has to route around.

### Anthropic – Claude Code

This is the clearest example of the pattern we should study.

- The **local CLI** is the strong, full-power execution path (with proper sandboxing).
- The web version runs agents in Anthropic's isolated sandboxes.
- They built a first-class feature called **Remote Control**: you can control a running *local* Claude Code session from the web or mobile app.

How it works technically:
- The local `claude` process can run in "remote control server" mode.
- It registers outbound (no inbound ports needed) with Anthropic's backend using scoped credentials.
- The web/app becomes a remote UI. All actual tool execution (file edits, terminal, MCP tools) still happens on the user's machine inside their sandbox.
- The conversation and steering flow through Anthropic's infrastructure, but the agent's "hands" stay local.

This is extremely close to the model we discussed: local execution as the source of truth, with a clean remote control channel on top.

### xAI – Grok Build

Grok Build (launched May 2026) is even more explicit about local-first execution:

- Primary experience is a local TUI/CLI with strong sandboxing.
- Model inference goes through their remote proxy.
- They use open protocols (MCP for tools, ACP for agent communication) so the local client can talk to remote services and vice versa.
- They support running on remote machines/VPS while still allowing web integration.

Again, the pattern is consistent: local client owns execution and local context. Remote layers provide scale and coordination.

### The Converging Pattern

All three serious efforts have landed in a similar place:

1. **Local client owns execution** when the user's machine is available.
2. **Cloud provides scale** for long-running/parallel work and when the machine is unavailable.
3. **Remote control surfaces** (web, mobile, Slack, etc.) talk to a coordination layer.
4. The local client maintains an authenticated outbound connection to that coordination layer when remote control is desired.
5. Clean protocols (MCP, etc.) make the boundaries explicit.

This is not accidental. It is what happens when you have enough real usage to feel the pain of the earlier hybrid compromises.

---

## The Better Model for Loki

If we take the vision seriously — a polished local "fleet runner" (Electron app) that people install, plus a web portal (and eventually mobile) that can control it — then the right architecture looks like this:

### Core Principles

1. **The local application is the source of truth for that machine.**
   - It owns Zellij, agent launching, session watching, handoff files, git, etc.
   - It can run completely standalone (like Cursor can).

2. **The web portal is a remote client.**
   - It does not pretend to have direct knowledge of the user's machine.
   - It sends commands and receives state through a well-defined channel.

3. **The connection between web and local should be direct and authenticated.**
   - When the user wants remote control, their local Electron app opens an authenticated WebSocket (or similar) to our backend.
   - Commands flow: Web → Backend → User's specific local app (via the open connection).
   - State flows the other way with low latency.

4. **We still support pure cloud execution** for long-running tasks, parallelism, and when the user's machines are off — but it becomes a complementary mode rather than the default path for hosted users.

### High-Level Diagram

```
                    ┌─────────────────────┐
                    │   Web Portal        │
                    │   (Remote Control)  │
                    └──────────┬──────────┘
                               │
                               ▼ (authenticated commands + state)
                    ┌─────────────────────┐
                    │   Backend /         │
                    │   Control Plane     │
                    └──────────┬──────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
          ▼                    ▼                    ▼
   ┌──────────────┐     ┌──────────────┐     ┌──────────────┐
   │ Local        │     │ Local        │     │ Cloud        │
   │ Electron App │     │ Electron App │     │ Agents       │
   │ (User's Mac) │     │ (User's PC)  │     │ (Scale/      │
   │              │     │              │     │ Parallel)    │
   └──────┬───────┘     └──────┬───────┘     └──────────────┘
          │                    │
          ▼                    ▼
     Zellij + Agents      Zellij + Agents
     (real execution)     (real execution)
```

The key shift is that the local Electron app is no longer just "a daemon that polls." It is a first-class application that can optionally maintain a live connection to the control plane.

---

## Technical Deep Dive (for Engineers)

### Current Problems with the Daemon Model

1. **Implicit ownership**
   - The web backend has to know too much about local reality.
   - State is eventually consistent and often stale.

2. **Poor failure modes for remote control**
   - If the daemon is down or the laptop sleeps, commands just queue silently.
   - There's no good way for the web UI to know "your local app is connected and healthy right now."

3. **High branching complexity**
   - Dozens of places have to handle "am I talking to a real local runtime or a daemon?"

4. **Difficult to make the experiences feel the same**
   - The web UI is always one layer removed from execution.

### The Cleaner Model (Local Client + Control Plane)

**Local Electron App responsibilities:**
- All direct Zellij/agent interaction
- Local session watching and handoff management
- Running the equivalent of our current `home/` logic (or a Rust/Go equivalent for better performance)
- Maintaining an authenticated, resumable connection to the backend when the user enables remote control
- Exposing a local API or IPC for the TUI/desktop UI

**Backend / Control Plane responsibilities:**
- Auth, billing, team features, long-term memory across machines
- Coordination of cloud agents (when used)
- Routing commands to the correct user's local client (via the open WebSocket)
- Fan-out for team views, notifications, etc.
- Acting as a relay when the local client is not connected (queueing + later delivery)

**Communication**
- Primary channel: authenticated WebSocket (or similar bidirectional protocol) initiated by the local client.
- Fallback: the existing queueing mechanism for when the client is offline.
- Use something like the Agent Communication Protocol (ACP) ideas or MCP where it makes sense for extensibility.

This is very similar to what Anthropic built with Remote Control and what Cursor enables with handoff + self-hosted workers.

### Security Considerations

- The local client proves its identity using the existing agent token system (or a derived, scoped credential).
- All execution of dangerous actions (file writes, terminal commands) stays on the user's machine.
- The backend never sees raw file contents unless the user explicitly shares them.
- Outbound-only connections from the local client are strongly preferred (much easier to firewall).

---

## Why This Matters for a Seed Round

Investors in this category are increasingly sophisticated about agent infrastructure.

They will ask questions like:
- "Where does the actual work happen?"
- "How do you handle the local vs remote experience without it feeling broken?"
- "What's your story for teams and multiple machines?"

Having a clear, modern answer ("Local app owns execution on each machine. Web and mobile are excellent remote clients that talk to those local apps through a clean channel.") is dramatically more credible than "we have a web app and a daemon that polls."

It also makes the product story much cleaner: "Install the fleet runner on your machines. Control everything from the web or your phone."

---

## Pragmatic Path Forward

We do not have to rip everything out tomorrow.

A reasonable sequence:

1. **Decide on the target architecture** (this post is part of that decision).
2. Build the local Electron app as the new primary runtime (start by making the current best parts of the `home/` stack + daemon logic into a proper packaged app).
3. Add the authenticated outbound connection + basic command relay as an optional feature.
4. Gradually move more of the "cloud when local is unavailable" behavior into proper cloud agents that can later hand off to the local app.
5. Keep the existing daemon path working for a transition period (especially for users who don't want Electron).

The recent UI improvements (truthful cards, better agent labels, pause indicators, etc.) will transfer extremely well once the underlying model is cleaner.

---

## Final Thought

The daemon polling model was not a mistake. It was the right tool for getting a working hybrid system into the hands of real users while we were still discovering what the product should be.

But we are past the discovery phase on the core vision.

The teams that are winning right now (Cursor, Anthropic, and the parts of xAI that are moving fastest on agentic coding) are converging on a model where **local execution is first-class and remote control is a clean, intentional layer on top** — not an afterthought mediated by database polling.

If we want Loki to feel like a serious, long-term platform rather than a very advanced internal tool, we should stop treating the current daemon architecture as the foundation and start treating it as the bridge we needed to cross to get here.

The destination is a local fleet runner that people are happy to install, plus a web (and eventually mobile) experience that can control it without feeling like a second-class citizen.

That is the architecture the best teams are choosing. It is also the one that will let us build the product we actually want.

---

*This post synthesizes discussions from late May 2026 around Loki's architecture, competitive analysis of Cursor, Claude Code, and Grok Build, and the practical realities of building a local-first + remote-control system that can credibly support a seed-stage SaaS.*

*References: `docs/development/cloud-local-workflows.md`, recent control layer refactors, and public information on the architectures of the leading agentic coding tools as of May 2026.*