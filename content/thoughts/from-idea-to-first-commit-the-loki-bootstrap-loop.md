---
title: From Idea to First Commit — The Loki Bootstrap Loop
summary: How Loki collapses the bureaucratic distance between "I have an idea" and "the agent is writing code for it," walked through with a concrete example — a tool that writes first-principles rebuttals to articles, with full source and author transparency.
excerpt: The gap between having an idea and the first agent dispatch is mostly paperwork. Loki removes the paperwork. Here is what that looks like today, end to end, with a real project as the example.
publishedAt: 2026-06-05
supersededBy: /whitepaper
tags: control,agents,onboarding,product,bootstrap,first-principles
featured: true
author: Loki
readingTimeMin: 14
---
## The friction between idea and first dispatch

You have an idea. Maybe you just had it. Maybe you have been carrying it for weeks. Either way, between "I want to build this" and "an agent is writing code for it" sits a layer of bureaucracy that has nothing to do with the idea itself.

Pick a name. Find an unclaimed slug. Decide on a stack. Open a terminal. Run create-next-app or pip init or cargo new. Initialize git. Create a remote. Push. Add a README. Write the first spec. Write the second spec. Decide what the first task should be. Open the editor. Sketch the first file. Realize you have not actually started yet.

This is the part Loki collapses.

The mental motion Loki wants is: describe the idea once, in plain language, and have a working project — repo, folder, brief, first task in flight — appear around it. The user supplies intent. The system supplies coordination. The agent supplies code.

This essay is the honest walk-through: what that looks like in production today, what already works, what is still rough, and where the loop is going. We will use a specific example throughout so the description never floats. The example is a real project that this author wants to build and will build, possibly starting from this essay.

## The example: a first-principles rebuttal tool

The project, as described in two sentences:

> Given a link or upload of any article, the system produces a response — or a rebuttal — written from a position of first-principles truth-seeking, with maximum transparency about the sources used, the article's author, that author's public positions over time, and their visible biases. The same treatment applies to talking heads: when a person appears in the source material, their profile is surfaced too — what they have written, what they have said, where they have been right and wrong before.

The MVP is text-only. Speech-to-text and video transcription come later. The first usable version handles articles in any language, returns a structured response, and renders public profiles for every named source and author.

We will call the project `truthseeker` for the rest of the essay. The user can rename it later.

This is not a hypothetical. Someone sent the author a link to a Republik essay arguing that Europe should stop copying Silicon Valley; the author wanted a structured response to it. They wanted the response generated and the analysis done in a system they trust — not pasted into a chat window and forgotten. They want the work to live somewhere, to accumulate, to compare across sources.

That is the project. Now: how does Loki take it from a sentence to a running agent?

## What happens when you sign in today

Open a browser. Go to loki.vercel.app. Sign in with GitHub.

The first thing that should be true on landing: you are on /control, not on an onboarding gate. As of 2026-06-05, the auto-onboard heal logic derives a username from your OAuth name or email local-part. If the derived handle is free, it is yours, and the onboarded-at timestamp is set in the same JWT mint. No forced setup page.

The second thing that should be true: /control immediately offers you the work it already knows you want to do. If you have GitHub repos under your login, a banner appears at the top suggesting "Import your N most recent GitHub repos." One click pulls them in. If you are running inside Fleet Runner (the desktop client) and have a `~/dev` folder full of git repos, another banner offers to import those. Both banners collapse silently when their signal is absent. If neither applies — you are new to GitHub, or you are in a browser without Fleet Runner — a five-card welcome grid offers the manual paths. The visual structure is deliberate: the system surfaces what it can already do for you, then offers what it can do if you tell it more.

For `truthseeker`, neither suggester fires. It is a new idea. There is no existing repo to import, no local folder to scan. We are starting from a sentence.

The right card to click is the first one: "Start a new project" (with Sparkles icon, marked Recommended). If you are not running Fleet Runner, this is a link to `/control/new-from-scratch`. If you are running Fleet Runner with local runtime available, this opens the Bootstrap modal — same destination, richer flow.

## The cloud path: /control/new-from-scratch

This is the path that works for every signed-in user today. No desktop install required. No local terminal. Browser only.

The form asks for four things:

1. **Name** — what the project is called. Letters, digits, hyphens. Becomes the GitHub repo slug and the Loki project key.
2. **Description** — one or two sentences. This is what `truthseeker` becomes: *"First-principles rebuttal generator with full source and author transparency."*
3. **Visibility** — private or public on GitHub.
4. **Template** — currently five choices: Next.js with Tailwind, Python FastAPI, Hono on Cloudflare Workers, plain HTML with Tailwind, or bare (just a README and a .gitignore).

Choose Next.js + Tailwind for `truthseeker`. The MVP is a web tool; the user will paste a link and read the analysis in a browser. Next.js handles routing, server actions for the article-fetch + LLM call, and Tailwind handles styling. The starter template includes a working homepage, a `lib/` directory ready for the article-parser and bias-profile modules, and an `app/api/` route ready for the analyze endpoint.

Click Create. What happens:

- The cloud route at `src/app/api/projects/create-with-github/route.ts` mints a GitHub repo under your account via the GitHub OAuth token attached to your Loki session.
- The same route seeds the template by writing all the starter files in a single Git Tree commit (no per-file API round-trips — one tree, one commit, fast).
- A Loki project entity is created (typed as `project` in the entities table) with the name, description, and a `gitUrl` pointing at the new GitHub repo.
- You are redirected to the success view, which shows the clone command (`git clone git@github.com:<owner>/truthseeker.git`), plus optional editor deeplinks (`vscode://`, `cursor://`) that open the repo directly if your local editor is configured.

At this point, the project exists. It is on GitHub. It is in Loki. You have not opened a terminal yet.

## The local path: Bootstrap modal (Fleet Runner only)

If you are running Fleet Runner — the desktop app — the same "Start a new project" card opens the Bootstrap modal instead of navigating to the cloud page. The modal is the richer version of the flow because it can do things the cloud cannot:

- Walk your local `~/dev` folder before asking you for a name, so it can warn if you already have a folder by that name.
- Clone the repo automatically into `~/dev/truthseeker` once GitHub creation completes — no manual `git clone` step.
- Open a Zellij tab pointed at the new folder.
- Dispatch the first agent prompt automatically — usually a `next_best` intent that asks the agent to read the brief and propose the first work block.

The closed loop is: type a description, click Create, watch the Zellij tab open with the agent already running. The whole sequence from idea to first commit can happen without you switching context.

As of 2026-06-05, the Bootstrap modal is functional for the GitHub-creation and local-clone steps. The auto-dispatch of `next_best` on first launch is partially wired — the queue is seeded, but the agent has to be present in the user's PATH. The new `MissingCLIsBanner` (shipped in v0.6.0) surfaces missing CLIs in advance so this step does not silently no-op.

For `truthseeker`, the Bootstrap path produces:

- `~/dev/truthseeker/` (local clone)
- `https://github.com/<owner>/truthseeker` (remote)
- Loki project record with `gitUrl` set
- Zellij tab `truthseeker` open at the project root
- First dispatch queued: "Read README and propose three-week MVP scope"

## The first dispatch and why it matters

A project that exists but has never had a dispatch is not yet alive. The dispatch row is where Loki crosses from "I created a folder" to "an agent is doing work for me."

The dispatch input lives on every ProjectCard in /control. Its placeholder asks you what the agent should work on, with one example. For a brand-new project, the most productive first dispatch is one of three things:

1. **"Summarize this repo and propose a three-week MVP scope."** This is the analysis-first opener. The agent reads the README and template files, then writes a SCOPE.md or proposes a plan. Useful when you want to think before you build.

2. **"Implement the first thing in the README's TODO list."** This works if the template README includes a starter TODO. The Next.js + Tailwind template does. The agent picks up the first item and writes it.

3. **A specific task** — for `truthseeker`, this would be: *"Build the article-fetch + parse endpoint at /api/analyze. POST a URL, return the article text plus extracted metadata (title, author, publication date, named entities)."* This is the concrete first feature.

Pick one. The dispatch row sends to the daemon, which injects into the Zellij tab. The agent starts working. The first commit usually lands within ten to twenty minutes for a scoped task.

If you are in Fleet Runner with v0.6.0 or later, the dispatch latency is sub-500ms. The bridge SSE channel pushes the `pending_commands` INSERT directly to the desktop, which drains the queue immediately. Before v0.6.0, the same dispatch took up to 25 seconds — the long-poll cycle. The latency difference is barely noticeable for a multi-minute agent run, but it matters for the perceived feel of the system. Push reads as "the system listens." Long-poll reads as "the system checks back every so often." The product positioning depends on the former.

## What the loop actually closes today

Let us be honest about what works and what does not as of 2026-06-05.

**Works:**

- Sign-in to /control in one page load. Auto-onboard handles username derivation.
- GitHub OAuth-linked accounts get a one-click "Import my recent repos" path.
- The bare project-creation flow at `/control/new-from-scratch` mints a GitHub repo, seeds a template (one of five), and creates the Loki project record.
- Fleet Runner's Bootstrap modal goes further: it clones the repo locally, opens a Zellij tab, and queues the first agent prompt.
- Dispatch to a paired Fleet Runner delivers in sub-500ms via the bridge SSE channel.
- Missing agent CLIs surface as a banner before the user tries to dispatch into a dead CLI.
- The autopilot ladder (Manual → Queue → Beacon → Continuous → Mission) is wired and persisted per user.

**Does not work yet, honestly:**

- The cloud path (`/control/new-from-scratch`) does not clone the repo for you. You still run `git clone` in your terminal. The Bootstrap modal does, but only when Fleet Runner is running.
- The first auto-dispatch fires only when the user is on the local prod install (the systemd path) AND the appropriate CLI is on PATH. The cloud-only user has to type the first prompt themselves.
- There is no scheduler firing `next_best` on idle projects autonomously. If you walk away, nothing happens. The autonomy ladder exists; the cron that drives it does not.
- Idea-as-voice ("tell me about your idea") does not exist. You type the description into a form. The form does not yet rewrite a sentence into a full brief.
- Cross-project context — "I am building two related projects, share the source of truth between them" — is not surfaced in the project-creation flow.

**Where this is going:**

The unfinished items are the things that turn Loki from a tool you initiate into a system that operates. The scheduler is the single biggest one. It would mean: idle projects pick up where they left off, on their own, at a cadence the user controls. Combined with the autopilot ladder, this becomes the path from L1 Manual to L5 Mission: the operator dials in trust, the system handles the dispatches.

The voice path is smaller but emotionally larger. Voice is the most natural input for "let me describe what I want to build." A four-sentence description spoken into Fleet Runner becomes a project brief, a repo, a folder, a first task. The bureaucratic distance from idea to first commit goes to roughly zero.

## How this essay informs the next development cycle

Two things are true at once. Loki is closer to the bootstrap loop the product wants than people assume. And it is not yet there. The gap is in three places:

1. **Cloud-side cloning.** The cloud user should be able to start a project end-to-end without touching a terminal. This requires a hosted runtime — a sandboxed environment per user that can clone, run, and dispatch. Today's bootstrap requires the user's machine. The desktop app handles it; the cloud should be able to handle it too. This is not a small build.

2. **First-dispatch autonomy.** When a project is created, the system should propose and execute the first task without the user having to type it. The seeds exist: the autopilot ladder, the prompt library, the `next_best` template, the Groq composer. They have not been connected to the project-creation moment. This is a small build — measured in days, not weeks.

3. **Idea-as-input.** The current Description field is a single text input. The future version is a multimodal capture: voice, paste, link, upload. Whatever the user supplies — a paragraph, a podcast clip, a link to a paper, a screenshot of a hand-drawn sketch — becomes the brief. The system pre-processes it into a structured brief and presents it to the user for confirmation before any external state changes. This is the part that makes the loop feel magical instead of bureaucratic.

When the `truthseeker` project ships, it will use this essay as a reference for two reasons. First, because the project is itself an instance of "system that closes a loop from input (article) to output (response with sources) with minimum bureaucratic distance." The architecture rhymes. Second, because the development of `truthseeker` will run on Loki, and the project should be able to point at the essay and say: *this is how I was made; this is the kind of project I should also enable for my users; this is the loop I am closing in my own domain.*

## What the operator does next

The honest minimum to start `truthseeker` today:

1. Sign in to loki.vercel.app.
2. On /control, click "Start a new project."
3. Fill the form. Name `truthseeker`. Description as above. Visibility private. Template Next.js + Tailwind.
4. Click Create. Wait for the success view.
5. Copy the clone command. Run it in your terminal. Open the folder.
6. Back in /control, find the `truthseeker` card. Type the first dispatch in the prompt input: *"Read the README. Propose a three-week MVP scope. Write it as SCOPE.md. Commit."*
7. Hit Send.

Seven steps. About four minutes if you are signed in already. The first commit on `truthseeker` will land within the next agent run.

The thing Loki adds to this is not magic. It is that steps 2 through 4 collapse seven manual setup steps (create-next-app, git init, gh repo create, push, README, GitHub Pages config if you want it, Loki registration) into one form. It is that step 6 is a single text input that produces a working agent dispatch instead of three browser tabs and four CLI invocations. It is that the loop, once started, runs by itself for the duration of the task.

The destination is shorter. Sign in. Speak two sentences. The system asks one clarifying question. Click confirm. The repo, the folder, the brief, the first task, and the first commit happen in sequence without you having to attend to any of them. You come back to a project that exists, has a name, and has done its first thing.

That is the loop Loki is building toward. `truthseeker` will be one of the first real projects to use it. The article-rebuttal tool itself, once it works, will close the same kind of loop for someone else: paste a link, get a response, see the sources, see the bias. One pattern. Two applications.

The shortest path between an idea and the first version of itself is what Loki is for.
