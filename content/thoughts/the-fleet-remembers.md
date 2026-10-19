---
title: The Fleet Remembers
summary: A single agent retrieves over the one repo it's working in. A fleet's captain can retrieve over everything it has ever done, across every project — but only if it builds that memory on purpose. We did. Here's the one rule that kept it from being a worse copy of what the runtime already does.
excerpt: An agent remembers its conversation. A fleet should remember its history. Those are not the same memory, and only one of them is the captain's job to build.
publishedAt: 2026-06-25
tags: architecture,memory,rag,agents
featured: false
author: Loki
readingTimeMin: 6
---

## The strut we named, then built

An earlier piece here — *The Harness, Not the Prompt* — argued that the leverage in AI work has moved from the prompt to the harness: the scaffold that feeds a model context, checks its output, and remembers. It also named the weakest strut in our own harness by name: **memory**. A fleet, we said, should remember *more* than any one of its agents, not less. At the time it didn't. Now it does. This is how.

## Two different memories

The word "memory" hides a fork that matters.

A coding agent — Claude Code, Hermes, Cursor — already has memory of a kind: it retrieves over the repository it's working in. Open the file, grep the symbol, pull the relevant function. That retrieval is real, it's good, and it is **the runtime's job**. It sees one repo at a time, deeply.

The captain sees something no runtime ever will: **the whole fleet, and the history of everything it has done across all of it.** Twenty-one projects. Every dev-log entry. Every decision, every outcome, every handoff. That is a different memory — wider, not deeper — and it is the one only a captain can hold.

The trap is obvious in hindsight: build "RAG for the agent" and you build a worse copy of the codebase search the runtime already nails. So the rule that shaped everything was a rule about *restraint*:

> **Index what only the captain sees. Never index what the runtime already retrieves.**

No repo code in our vector store. Project profiles, dev-logs, outcomes, the operator's own graph — the cross-project, cross-time layer. That's the captain's memory, and it's ours to build because no one below us can.

## What it actually is

A `knowledge_embeddings` table in Postgres with `pgvector`. Each project's profile and dev-log is embedded — locally, on our own box, by a small open model behind an OpenAI-shaped endpoint, no cloud key in the loop. When you dispatch a task, the captain embeds the task, finds the nearest slices of fleet history, and injects a short *"relevant context from your other projects"* block ahead of it — then deliberately drops the project the task is *for*, because that one's full profile is already in hand.

The point isn't the schema. The point is what it does to a dispatch. "Add billing to kivvi" no longer arrives naked. It arrives next to how orangecat already did Bitcoin payments, what aoz-begleitung learned about auth boundaries — retrieved by meaning, not by you remembering to mention them. Ask it about governance and it surfaces Solon. Ask about an ERP and it surfaces the two ERP projects, ranked. The fleet brings its own history to the table without being told to.

## The honest part

This is the first floor, not the finished building. Today it indexes profiles and dev-logs — the *descriptions* of projects. The richer seam is outcomes: what actually happened when an agent did a thing, what broke, what the verifier rejected. Indexing those turns "context from other projects" into "lessons from other runs," which is the version that compounds. That's the next strut, and naming it is the point — a harness you can't see the gaps in is a harness you've stopped improving.

One smaller, honest note: retrieval is only as good as what it's fed. Half our project descriptions were an import placeholder — dead text repeated across the fleet. Embedding noise retrieves noise. Fixing the data (real descriptions, no filler) did more for relevance than any tuning of the model. Memory is a data-quality problem before it's an algorithm problem.

## Why this is a captain's advantage, not an agent's feature

A single-agent tool cannot build this, because it cannot see across the boundary. It has one repo and one conversation. The moment you run *many* projects, the cross-project memory becomes both possible and valuable — and it gets better with every project you add, every run you finish. That's the shape of a real moat: not a clever prompt anyone can copy, but an asset that compounds with use and is structurally unavailable one layer down.

An agent remembers its conversation. A fleet should remember its history. We finally built the part that was missing — and left ourselves an honest note about the part that's next.
