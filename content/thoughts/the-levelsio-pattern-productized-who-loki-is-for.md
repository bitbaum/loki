---
title: The Levelsio Pattern, Productized — Who Loki Is For
summary: One tweet from Pieter Levels describes the manual version of what Loki automates. The audience for Loki is not a generic "engineering team buying tools." It is the specific person who already SSHs into a Hetzner VPS to run Claude Code next to their codebase, and wants the missing dashboard.
excerpt: Loki is not a competitor to Cursor or Copilot. It is the productized version of a workflow indie hackers have been improvising for two years — Claude Code on a VPS, SSH in to drive it, walk away while it works. Here is the customer we are actually for.
publishedAt: 2026-06-04
tags: product,positioning,levelsio,fleet-runner,strategy,studio,architecture
featured: true
author: Cato
readingTimeMin: 14
---

## The Tweet That Names the Customer

A few weeks ago, Pieter Levels posted this:

> All my projects run on a Hetzner VPS with Claude Code installed next to the sites/apps that I work on and I just SSH in with Termius and it keeps going forever even if I [close my laptop].
>
> I laugh when I see people holding their laptops half open so their Claude Code doesn't shut off.

I read it twice. Then I read it a third time, because it took a beat to register what it was actually describing.

He is describing the manual version of Loki.

That tweet is a complete picture of an existing workflow: a builder runs AI coding agents on a small Linux server. He SSHes in from his laptop using a polished terminal client. The agents do their work in the server's shell, persisting across his network drops, his coffee breaks, his time zones, his sleep. When he wants to know what they did, he opens his laptop and looks. When he wants to give them a new task, he types it in the same SSH session. When he wakes up and the agent has finished, he reviews the diff and ships.

This is a real workflow. It is being practiced today by a meaningful number of people. It is the closest thing to "AI agents for indie builders" that exists in the wild, and it works well enough that someone with hundreds of thousands of dollars a month in revenue is using it as his daily driver. He is *advocating for it publicly*, in fact, and dunking on people who don't do it.

The interesting thing about that workflow is not that it works. It is that it has a missing piece, and the missing piece is exactly what Loki is.

## What the Manual Pattern Has, and What It Doesn't

Let me describe the workflow he's tweeting about more carefully, because the gap is sharpest when you can see the whole thing.

**He has:** a durable Linux box that doesn't shut down. Each of his fifteen-ish projects has a directory on it. Inside that directory, Claude Code (or its successor) runs in a persistent terminal session — typically via `tmux` or `screen`, so the process keeps going after he disconnects. He SSHes in via Termius, attaches to the session, types a prompt, watches the agent work, types another prompt, eventually disconnects. The agent keeps working on whatever it was doing. Tomorrow, he attaches again, sees the result, reviews the changes Claude made, commits and pushes.

**He doesn't have, and probably wishes he did:**

- A single view of *all his projects' agents at once*. He has to attach to each session separately to see what each one is doing. With fifteen projects, that's fifteen `tmux attach` commands across however many machines. The map of "what's working, what's idle, what's stuck" lives in his head, not on a screen.
- A way to *dispatch to a specific project from his phone*. If he's away from his laptop and remembers that Photo AI needs its dependency upgrade run, he can SSH from his phone but it's clumsy. The natural place to dispatch from is whatever screen he's looking at.
- A *handoff log* that shows what each agent has been doing across many sessions. Right now his agent's history is whatever's still in the terminal scrollback. If he attaches and the terminal has scrolled past, the context is gone. There's no "what did the OrangeCat agent do last week?" view.
- A *policy layer* for when to dispatch the next task automatically. If an agent finishes work at 3 AM, who decides what to give it next? Currently nobody — it sits idle until he wakes up. He could write a script, but he hasn't, and most operators won't.
- *Real-time notifications* when an agent finishes or fails. He's checking his Slack and his GitHub PRs to know if the agent shipped. The agent itself doesn't push anywhere.

None of these missing pieces are critical to the basic workflow. He runs his business without them. But every solo builder running ten or more agents has had the same five thoughts in some order:

1. *"I wish I could see all my agents at once."*
2. *"I wish I could dispatch from my phone."*
3. *"What did the agent do last Tuesday? Wait, the scrollback is gone."*
4. *"It's 3 AM in Lisbon and the agent finished an hour ago and has been sitting idle."*
5. *"Did the build pass? Where's the notification I configured?"*

Loki is the answer to all five.

## What Loki Adds, in Plain Terms

Look at Loki's surface area honestly. It is, at the core, **a dashboard for a fleet of AI coding agents running on machines you control**. The dashboard sees what's happening across all the projects, lets you dispatch new tasks from any device, logs the history of who did what, applies a policy to "the agent just finished — what next?", and surfaces real-time notifications.

The local component (Fleet Runner) is the bit that lives on each of your machines and actually drives the agents. The cloud component (the web UI at loki.orangecat.ch) is the bit you look at from wherever you are. They talk to each other over a thin sync layer.

This is precisely the architecture levelsio describes building manually with `tmux`, `ssh`, his eyes, and an iCloud calendar of "remember to check on the agent at 6 PM." Loki replaces every piece of that stack with a real product. The terminal session becomes a managed agent runtime. The SSH attach becomes a real-time dashboard. The scrollback becomes a structured handoff log. The "remember at 6 PM" becomes an autopilot that fires the next task. The "is the build passing" becomes a push notification on his phone.

None of these features are competing with Cursor or GitHub Copilot. Cursor is an IDE; you use it to write code. Loki is a control plane; you use it to *not* write code, but to know what the agents you delegated to are doing. The two products serve different parts of the day. The Cursor user is the agent operator at the moment of authoring. The Loki user is the agent operator at the moment of supervision.

## Who Actually Buys This

The mistake I almost made for the first few months of building Loki was thinking the customer was "a software engineering team that wants to coordinate AI agent work across many engineers." It is not. That market exists, but the people in it are reaching for different tools — Devin's clones, Sweep, agent IDEs with team-scope features. They have buyers in procurement and budget cycles measured in quarters.

The customer for Loki is the *levelsio-pattern operator*. Specifically:

- A solo founder, freelance developer, or small team of one or two.
- Runs more than one project. Often more than five.
- Already uses some form of AI coding agent — Claude Code, Aider, Cursor in agent mode, Devin, whatever.
- Already does at least some of their agent work on remote infrastructure (a VPS, a desktop they keep running, a cloud workstation) because they got tired of their laptop being the bottleneck.
- Comfortable with terminals, SSH, and config files. Not afraid of `pg_hba.conf` or `systemctl`.
- Has a Twitter or HN presence — they share what they're doing publicly. They pattern-match on tools other respected indie builders use.

This is a smaller audience than "all engineers everywhere." But it's a *real* audience and it is *underserved by a missing product*. The levelsio crowd is not waiting for Cursor to add team features. They're waiting for the dashboard piece of their workflow to become a product they don't have to build themselves.

They will pay for it. Not enterprise SaaS prices. Indie tool prices — somewhere between $10/mo (which is "free enough I don't think about it") and $50/mo (which is "I pay this because it pays itself back in a few hours of recovered attention per month"). The pricing model that fits is the one levelsio's own products use: a flat monthly fee, no per-seat scaling, no per-agent metering, no surprises.

The size of the market is the size of the indie-builder cohort that's currently improvising the manual pattern. I don't have a precise number — nobody does — but the visible evidence is strong. Every other Twitter thread in #buildinpublic is now about agent workflows. Indie hackers have always loved boring stacks, ruthless costs, and tools that respect their attention. Loki's pricing and positioning fit exactly where their wallets are open.

## What This Means for the Roadmap

Naming the customer changes the priority of every feature.

The features that matter most for the levelsio-pattern operator:

- **Multi-machine fleet visibility from one screen.** If you have five Hetzner boxes running agents across fifteen projects, you should see all of them in one place. (Today's Loki shows multiple projects but assumes one machine. Real fleet topology is a v0.7+ thing.)
- **Dispatch from anywhere.** Phone, tablet, browser at the coffee shop. Real-time. This is what v0.6's SSE bridge unlocks; we just shipped Phases A, B, and D.
- **Long-lived agent sessions with structured history.** The local watcher already reads `~/.claude/sessions/*.md` and writes events.jsonl. The history view on the web needs polish.
- **Policy-driven autopilot.** "When the OrangeCat agent finishes, give it the next item from its queue. Unless it failed, in which case raise a blocker." This exists in v0.1 as "strategist" but it's not yet a UI a non-engineer can configure.
- **Push notifications that actually work.** Slack, Discord, web push, even SMS. The user wants to know on their phone, not in their browser.

The features that *don't* matter for this audience, despite being obvious next moves:

- Team seats, shared workspaces, role-based access control. The operator works alone.
- Agentic IDE features (a built-in editor, file tree, code review). They have Cursor for that.
- "Enterprise" anything. Compliance, SSO, audit logs, SOC2. Wrong audience.
- Marketplace / agent app store. The operator picks Claude Code, Grok, Codex from their command line. The marketplace is `npm install`.
- Onboarding tutorials for new-to-AI users. The audience is already past the on-ramp.

It is freeing to know what you're *not* building. Every line item above is on Loki's competitors' roadmaps. We can skip them and ship the things our actual customer wants instead.

## The Naming, Now That It Clicks

"Fleet Runner" was named before any of this came into focus. It turns out to be exactly right.

The desktop app sits on one machine and runs the agents that live there — it is *the runner of one fleet*. Connect multiple Fleet Runners to the same cloud account and you have a fleet-of-fleets — one operator commanding several machines, each running several agents, each working on several projects. The metaphor was always there. It just didn't have a customer attached until levelsio described that customer in a tweet.

The "your fleet keeps running while you walk away" line that I've been trying to articulate for a year writes itself once the audience is named. The operator's pain point is the *laptop-can't-be-the-runtime* problem. The promise is *the laptop is the steering wheel, the fleet is the engine, the engine runs without you*. That's the marketing.

## What Changes Now

A few concrete shifts:

**Pricing strategy.** Whenever Loki introduces paid plans, the model is a flat monthly. $19/mo or $29/mo for the personal plan. Not per-agent. Not per-machine. Not per-seat. The audience has been trained by levelsio and similar operators to expect predictable infrastructure costs. Match the expectation.

**Marketing voice.** Frame as "the missing dashboard for the workflow you're already running." Not "the next-generation agent platform." Not "enterprise AI coordination." The audience is allergic to that language. They want to know what you do that they can't already do with `tmux` and SSH.

**Distribution.** The levelsio crowd lives on Twitter, HN, and a handful of Discord servers. They are reached through public building, not through SEO funnels or paid ads. Loki's marketing is *building in public*, *posting infrastructure receipts*, *publishing thoughts essays like this one*. The audience reads HN and #buildinpublic for sport.

**Product copy.** Stop saying "AI agent platform." Start saying "the dashboard for the agents you already run." Stop showing graphs of "agent productivity over time." Show screenshots of a real terminal next to a real Fleet Runner window, both showing the same agent finishing the same task, captioned: *"This is the second view of the work. The first view is wherever you are."*

**Bundled infrastructure.** Ship the studio stack runbook alongside Fleet Runner. The operator who installs Fleet Runner on their MacBook is one Hetzner provisioning away from the rest. We can make that provisioning literally one click — "install Fleet Runner on the box that hosts your projects." The studio stack we just published in [The Studio Stack — One Box, All Your Projects](/thoughts/the-studio-stack-one-box-all-your-projects) is the runbook this links to.

**Default integrations.** Tailscale and Cloudflare Tunnel as recommended setup, not afterthoughts. The audience already uses both. Ship configs that work with them by default.

**Anti-features.** Resist all the obvious "enterprise" feature pull. No SSO. No SAML. No org permissions. No usage analytics dashboards. No SLA negotiations. These are noise to our audience and would push us toward a different one we don't want.

## The Quiet Insight

The deepest thing here is that Loki's customer was already in the wild, already paying for tools, already telling the world what they wanted in 280-character bursts. The mistake earlier in the year was looking for "a target market" the way enterprise SaaS thinks about target markets — assembling personas from imagined hypotheticals, sizing TAM, calculating willingness-to-pay from comparable products. The actual customer was on Twitter, posting screenshots of their Hetzner dashboards and tweeting about which terminal client they liked best.

If you are building tools for builders, your customers are *building in public*. Read what they say. Don't decompose what they say into "feature requests" or "user research"; read it as *job descriptions for the product you should be building*. The job that levelsio described in that one tweet is a job description for Loki. He told us, for free, exactly who we are for.

The work now is to ship the product that lives up to the description. Which is a tractable problem.

— Cato, 4 June 2026
