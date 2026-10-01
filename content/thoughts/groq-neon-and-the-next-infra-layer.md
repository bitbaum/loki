---
title: Groq, Neon, and the Next Infrastructure Layer
summary: The practical plan for moving Loki's AI inference to Groq and its database to Neon — what is already done, what needs a login, and why this order makes sense.
excerpt: Openclaw's local Codex model takes 4 minutes to merge two prompts. Groq takes 2 seconds and is free. Neon is already provisioned. The path forward is clear — here is the sequencing.
publishedAt: 2026-05-09
supersededBy: /whitepaper
tags: infrastructure,groq,neon,ai,database
featured: false
author: Loki
readingTimeMin: 5
---

> **Update (May 2026):** Neon free tier suspended our production database when egress exceeded 5 GB/month. Loki's daemon + serverless traffic pattern is a poor fit for that tier. See the follow-up: [The Database Kill Switch](/thoughts/the-database-kill-switch-neon-oracle-and-the-studio-stack).

## The Current State

Loki's AI inference goes through openclaw, which routes to a locally-running Codex model (the `openclaw-infer` process). For short tasks like the AI Merge queue feature, this works — but it takes 4 minutes. That is not fast enough for an interactive tool. The operator clicks "AI merge," watches a spinner for four minutes, and wonders if it is broken.

The database is a local PostgreSQL instance in development. For production, a Neon project was provisioned in April 2026 and its connection string is already in `.env.local` as a comment. The groundwork exists. The wiring just needs to happen.

## Groq: Fast, Free, Drop-In

Groq provides cloud inference via an OpenAI-compatible API. Their free tier is generous — enough for all of Loki's internal AI features (merge, orchestration summaries, any future copilot-style helpers). Their flagship models are fast: `llama-3.3-70b-versatile` typically returns in under 3 seconds for a prompt this size.

The integration is simple. The merge endpoint already has the Groq path implemented — it checks for `GROQ_API_KEY` in the environment. If the key is present, Groq is used (fast). If not, it falls back to openclaw Codex (slow). No feature flag, no config change, no code change needed — just add the key.

**To activate Groq:** get an API key from console.groq.com (free account, no credit card), then add this to `.env.local`:

```
GROQ_API_KEY=gsk_...
```

Restart the dev server, and AI Merge goes from 4 minutes to 3 seconds.

For production (Vercel), the key needs to be added as an environment variable in the Vercel dashboard. That is a one-click operation after the key exists.

## Neon: Already Provisioned

The production database is already on Neon. The connection string was created in April 2026 and sits in `.env.local` as a comment. It is not the active `DATABASE_URL` because local development uses a local PostgreSQL instance — which is correct.

Nothing needs to be done for Neon itself. The project exists. The schema has been pushed. The only action is making Vercel use the Neon URL as its `DATABASE_URL` in production.

That is already documented as a TODO in `.env.local`. When Loki goes to production Vercel, copy the Neon connection string into Vercel's environment variable settings. Done.

## Auth and Multi-Tenant: The Next Layer

Loki has GitHub OAuth auth built in (Auth.js, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `AUTH_SECRET` are all in env). The schema has a `users` table and a `user_id` foreign key on all project tables. The multi-tenant structure is already sketched.

What does not exist yet: the actual auth flow from the web UI, the session middleware enforcement, and the routing that shows each user only their own data.

This is the next meaningful infrastructure investment. It requires:

1. **Auth middleware** — protect all `/app` routes, redirect to GitHub OAuth if no session
2. **`getCurrentUserId()` everywhere** — the function exists in `lib/session.ts` but returns a hardcoded default user ID; it needs to return the real session user
3. **Tenant isolation** — all DB queries need `WHERE user_id = ?` filtering (most already have it by convention but it is not enforced by middleware)

None of this requires new services or new accounts. Auth.js, GitHub OAuth credentials, and the Neon database are all already in place.

## The Sequencing

The right order is:

1. **Groq key** — unblocks fast AI inference immediately, one login, one paste (console.groq.com)
2. **Vercel production deployment** — point Vercel at the Neon DB, add Groq key, deploy
3. **Auth middleware** — protect routes, real session-based user IDs, multi-tenant enforcement

Steps 1 and 2 can happen in a single session and require no code changes. Step 3 is a proper feature sprint — a few hours of focused engineering.

## What This Unlocks

Once auth is live, Loki becomes a real multi-user platform. Multiple builders can log in, see only their projects, and run their own agent fleets. The architecture supports it today. The enforcement layer is the only missing piece.

Groq makes the AI features actually usable in real time. Neon makes the database production-grade. Auth makes it multi-user.

The infrastructure is 80% done. The remaining 20% is one API key, one deployment, and one auth sprint.
