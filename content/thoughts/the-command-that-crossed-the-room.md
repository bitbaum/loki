---
title: The Command That Crossed the Room
summary: How Loki gained the ability to command your local AI agents from anywhere in the world — and why a single silent bug had been blocking it from working.
excerpt: You open Loki on your phone, type a message, press Send. Seven seconds later, your AI agent at home starts working on exactly what you told it. This is what that required.
publishedAt: 2026-05-16
supersededBy: /whitepaper
tags: architecture,daemon,remote,zellij,breakthrough,mobile
featured: true
author: g
readingTimeMin: 12
---

## The Moment

Earlier today something happened that is worth writing down.

A message was typed into Loki on a phone. Not on the machine where the AI agents run — on a phone, over the internet, connected to the live Loki website. The message said, to a project called Revamp-Info: start working.

Seven seconds later, on the computer at home, with no one sitting at the keyboard, the AI agent in that project's terminal window received the instruction and started working.

The room was empty. The computer was not touched. The loop kept moving.

This is not a parlor trick. This is the first real demonstration that Loki's central architectural promise — that you should be able to command your creative process from anywhere, not just from your desk — is actually true.

## The Walk Test

An earlier article in this series, [From Localhost to a Portable Creation Loki](/thoughts/from-localhost-to-a-portable-creation-cockpit), described what the real test for this product looks like:

> You leave your computer at home. You go for a walk, or a bike ride, or you sit somewhere away from your machine. Your phone buzzes. The system says the current agent has stopped. You open Loki from your phone, read the handoff, choose what should happen next, and send the next instruction into the same development loop you would have controlled from your desk. Then you put the phone away. The work continues.

Until today, that test could not pass. The sending part was always broken in a way that was very hard to see. Instructions sent from a phone appeared to succeed — the screen showed a confirmation — but they never arrived. The agents at home sat idle. The loop did not continue.

The bug that was causing this had been hiding in plain sight for months, logging success while doing nothing.

## What Loki Is Actually Trying to Do

To understand why this matters, it helps to understand the shape of the system.

When you use Loki locally — sitting at your computer — sending an instruction to an AI agent is simple. You open the control panel, you click a button or type a message, and the instruction is typed directly into the agent's terminal window. Think of it like someone physically walking up to a worker at their desk and speaking to them. Instant, direct, no middleman.

When you use Loki remotely — from your phone, from another city, from a café — that direct path is no longer available. Your phone is connected to the internet. Your computer is at home on your desk, not connected to your phone in any direct way. There is an air gap between where you are and where the agents are.

To cross that air gap, Loki uses a two-part system.

**The cloud side** is the Loki website — loki.vercel.app — which runs on servers in the internet. When you send an instruction from your phone, it reaches those servers first. The servers cannot deliver the instruction to your computer directly. Instead, they write it down in a queue: a list of pending instructions stored in a database, waiting to be picked up.

**The local side** is a small program running quietly in the background on your computer called the daemon. Its only job is to watch that queue. Every five seconds, it asks the servers: is there anything new for me? If there is, it picks up the instruction and delivers it to the correct agent on your local machine. If there is nothing, it waits and asks again.

This is a classic architectural pattern called polling, and it is the right design for this situation. Your computer does not need to be exposed to the internet. It does not need to accept incoming connections. It simply reaches out, checks for messages, and acts on what it finds. Secure, simple, robust.

The problem was that the final delivery step — the moment the daemon takes the instruction it just received and hands it to the right agent — had been silently broken since it was built.

## The Silent Failure

Your computer runs a terminal session manager called Zellij. Think of Zellij as a building with many offices. Each project has its own office. Claude, the AI agent, sits in one office. Revamp-Info, OrangeCat, Loki — each in their own room, each running their own independent session. From the outside, the building has one front door.

When the daemon receives an instruction — say, "tell the agent in OrangeCat to run the test suite" — it needs to walk through the building, find the right office, open the door, and speak to the agent inside. The command for doing this in Zellij is essentially: go to the office named OrangeCat, and type this message.

The bug was this: the daemon did not know which building it was in.

Zellij can run multiple independent sessions. Your machine might have two: one named `marvellous-muskrat` (these names are assigned randomly) containing all your project offices, and one named `marvellous-lemur` used for something else entirely. To navigate to OrangeCat, you first need to know which session OrangeCat lives in.

The daemon had no way of knowing this. When it tried to navigate to OrangeCat, it issued the command without specifying a session. Zellij, receiving an ambiguous command from a process with no session context, did not pick one and try — it silently listed sessions instead. The navigation never happened. The message was never delivered.

But Zellij's navigation command does not return an error when this happens. It returns nothing — a success code, technically, with no output. And the message-typing commands that followed all say `|| true` in the code — programmer shorthand for "if this fails, ignore it and keep going."

So the daemon logged: `inject done ✓`.

The instruction reached the queue. The daemon picked it up. The delivery step completed without an error. Everything looked right. Nothing arrived.

This is the category of bug that is very hard to catch: the one that looks like success. There was no crash, no error message, no red text anywhere. The only evidence was absence — the agent not moving, the work not continuing — and that kind of absence is easy to explain away as "the agent is just slow today" or "maybe the instruction got there and there's nothing urgent to do."

The bug had been there since the remote injection system was built. Every message sent from outside the local machine had silently disappeared.

## The Fix

Once the bug was understood, the fix was direct.

Before attempting to deliver an instruction, the daemon now identifies which session contains the destination office. It does this by asking Zellij to list all open sessions, then checking each one: does this session have a tab called OrangeCat? Does this one have Revamp-Info? It scans systematically until it finds the right building, then uses that session name for every subsequent command.

This is the difference between a courier who arrives at an office park and starts knocking on random doors, and one who first checks the directory at the entrance, finds the right building number, and goes directly there.

```
Before: courier arrives, knocks on air, reports success, leaves
After:  courier arrives, checks directory, finds building 3, delivers message, confirms receipt
```

The change was about thirty lines of shell script. The impact was: everything that was supposed to work started working.

The code added a helper called `_find_session_for_tab`. It scans every Zellij session looking for a tab with the right name, and returns the session that contains it. Every subsequent command in the delivery process now carries that session name explicitly, so Zellij always knows exactly where to look.

When the fix was deployed and tested — a message sent from a phone to the live Loki website — the daemon logs read:

```
07:45:01 inject → tab=Revamp-Info
07:45:03 inject done ✓
```

And this time, the agent moved.

## What This Means

The gap that just closed is not a small one. It is the gap between a tool that works when you are at your desk and a tool that works while you are alive.

Before today, Loki was genuinely useful if you were sitting in front of your machine. You could launch agents, watch them work, redirect them, build things. The control panel was a real operational surface.

But the moment you stepped away from your desk, the loop froze. You could look at what was happening — the runtime state, the agent status, the recent activity — but you could not act on it. Reading without writing. Watching without directing. The information flow ran one direction only.

That changed today. The loop can now be continued from anywhere with an internet connection.

More precisely, what is now possible:

**You can manage a fleet of AI agents from your phone.** Open Loki, see the status of every project, send instructions to any agent, continue any session. The agents do not know you are not at your desk.

**You can keep projects moving while you move.** If you are on a train, in a meeting, waiting somewhere — any moment you have sixty seconds and your phone — you can check on the fleet and send the next instruction. Work that would have paused until you returned to your desk no longer has to.

**You can close the loop the article described.** The Walk Test is now passable. The agent finishes, the status updates in Loki, you read the handoff on your phone, you send the next step. The work continues.

This is what [The Session System and the Loop That Almost Closes Itself](/thoughts/the-session-system-and-the-loop-that-almost-closes-itself) was pointing at: a loop that keeps moving not because a human is constantly present, but because the human can rejoin the loop from wherever they happen to be, at whatever moment they have attention to spare.

The session handoff — the five-field protocol that tells the incoming session exactly what was done, what is next, and whether the codebase is healthy — now matters even more. It is the message the agent leaves for you. You read it on your phone. You decide what to do. You send the next instruction. The agent reads it in its terminal and continues.

The handoff is the meeting that happens without anyone in a room together.

## What the Bug Was Really About

It is worth pausing on what kind of error this was, because it speaks to something about the nature of distributed systems.

The injection pipeline was written in two layers. The local layer — the code that runs on your machine — was built and tested locally, where it worked perfectly. When you type a command into Zellij from inside a Zellij session, Zellij already knows which session you are in. No session specification needed. The code was written, tested locally, confirmed to work. Done.

The remote layer — the daemon that runs as a background service, outside any session — was built later. It called the same commands. But it was not inside a Zellij session. It was not anywhere. It had no session context. And the commands that worked perfectly from inside a session silently did nothing from outside one.

The test environment and the production environment differed in exactly the way that made the bug invisible. Every test confirmed success. Every production run silently failed.

[The Anatomy of a Broken Injection Pipeline](/thoughts/the-anatomy-of-a-broken-injection-pipeline) documented five structural bugs in the injection system. This was a sixth: different from all of them, higher in the stack, invisible to any local test, only discoverable by looking at what the daemon could actually see from its position in the system.

The rule it demonstrates is old and reliable: the reliability of a system is bounded by the least-tested path through it. Local paths get tested constantly, because local paths are the ones you use. Remote paths, daemon paths, background-service paths — these are the ones that accumulate silent failures. They are correct in theory, broken in practice, and they keep logging success until someone asks why the loop is not moving.

## What Comes Next

The remote→local command channel is now working. That was the missing link.

The next piece is the reverse: not just commanding agents from your phone, but receiving richer information from them. The status updates are already flowing — you can see whether each agent is running, idle, or waiting — but what you cannot yet do is speak to the system by voice.

The microphone button visible in Loki is wired for local use. When you are on your machine, it records your voice, sends the audio to a local AI transcription model called Whisper, and converts speech to text before injecting the instruction. No cloud, no subscription, your words processed on your own hardware.

From a phone on the remote site, that path breaks at the first step. The remote server cannot run Whisper. The audio arrives and the server returns an error.

Closing that gap requires a choice: relay the audio back to the local machine for transcription (elegant, local, latency-heavy), use a cloud transcription service (fast, small cost, practical), or use the speech recognition built into the phone's browser (no server needed, lower quality, immediate). Each is a real option. None is obviously right.

But the fact that we are now thinking about voice is downstream of the fact that the text channel is working. You do not build the second floor before the first floor exists. The first floor — type something on your phone, agent receives it on your computer — is now real.

## The Product Exists

The clearest thing that can be said after today is this: the product exists.

Not as a prototype. Not as a local tool that demonstrates a concept. Not as a dashboard that shows data but cannot act on it.

As a system where a human can sit anywhere in the world, look at the state of their creative work, make a decision about what should happen next, and send that decision into a machine that executes it.

The builders who have been reading these articles about the vision — the Walk Test, the cloud control plane, the portable creation loop — have been reading about something that was technically designed but not yet operationally real. The last connection was a daemon that knew how to navigate between sessions.

It is real now.

The loop closes.
