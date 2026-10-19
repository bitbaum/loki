---
title: You Cannot Direct What You Cannot Name
summary: Loki's terminal showed five tabs called "Tab #1" through "Tab #5". One held Claude, one held Grok, one held Cursor, and the command center could not tell you which was which — so the operator kept going back to the physical terminal it was supposed to replace. Fixing it took three passes and taught the same lesson each time: an orchestration layer must join on the identifiers its substrate already assigns, never on the labels humans happen to read.
excerpt: A control plane that cannot name what it controls is a viewer. Identity has to be carried, not inferred.
publishedAt: 2026-08-14
tags: architecture,terminal,orchestration,runtime-truth,direction
featured: true
author: Loki
readingTimeMin: 7
---

## The bottleneck is direction

Loki's mission is a single sentence: direct the creation of everything you can imagine. Underneath it is a claim about where the constraint lives. Raw capability is not the scarce thing any more — a competent agent will write the code, run the tests, and open the pull request. What is scarce is human direction: the ability of one person to hold a fleet in their head and point it somewhere useful.

That claim has an unglamorous consequence. If direction is the bottleneck, then every ambiguity in the interface is a tax on the only resource that matters. Not a cosmetic tax — a structural one. The number of agents a person can command is bounded by how many they can distinguish.

Which is why a purely cosmetic-looking bug turned out to sit directly on the critical path.

## Five tabs, no names

The operator's terminal had five tabs open. One was running Claude Code, one was running Grok, one was running Cursor's agent, and two were shells. In Loki's own web terminal — the command center, the product — they rendered like this:

```
Tab #1    Tab #3    Tab #4    Tab #5    Bitbaum
```

Every fact worth knowing was missing. Which tab holds which agent. Which project each one is working in. Whether the thing you are about to type into is the model you meant to talk to.

The consequence was not that the UI looked unfinished. The consequence was that the operator stopped using it. Given a choice between a remote surface that shows five identical labels and a physical terminal where you can see the screen, you use the terminal — and the entire remote-command premise quietly evaporates. A control plane that cannot name what it controls has been demoted to a viewer.

Worse, this is exactly the failure mode that gets misfiled as polish. It has no stack trace. Nothing is red. Every check is green. The product simply is not used for the thing it exists to do.

## Three passes, one mistake

The fix took three attempts, and all three failed the same way before the last one worked.

**The first pass** read tab topology out of a legacy dotfile, `claude-projects.conf`. The code was correct and the file was real. Nothing had written to it in months. The pane list published to the database was `[]` on every single push — an empty array that looked exactly like "no agents running" and was in fact "nobody is looking."

**The second pass** replaced the dotfile with live process inspection: walk `/proc`, find the agent processes, read each one's working directory. This is real ground truth, and it still produced `[]`. The reason is worth sitting with. Having found a Grok process in `/home/g/dev/aoz-begleitung`, the code then tried to match that directory against the open tab names — `Tab #1`, `Tab #3`, `Tab #4`. There is no substring in common. There never could be. A default-named tab shares no text with anything, so every match fell through and every process was silently dropped.

The bug was not in the matching logic. The bug was believing that a match was possible. Name-based joining works right up until someone declines to name something, and then it does not degrade — it returns nothing, confidently.

**The third pass** stopped inferring and started reading. Zellij, the terminal multiplexer underneath, already assigns every pane a stable id and exports it into that pane's shell as `ZELLIJ_PANE_ID`. Child processes inherit it. So the agent CLI is already carrying, in its own environment, the answer to "which pane am I in" — it survives wrappers, it survives renames, and it is available at `/proc/<pid>/environ` to anyone who thinks to look. Join that id against the session's own metadata file, which maps pane ids to tab positions and tab positions to names, and the question resolves exactly:

```
Tab #3 → grok
Tab #4 → claude
Tab #5 → cursor
```

Three passes to arrive at a one-line principle: **identity must be carried, not inferred.** The substrate already knew. Two implementations reconstructed a guess instead of reading the answer.

There is a dead end worth naming too, because it looks like the obvious move. Zellij will happily dump its own layout on request — and the dump contains bare panes with no working directory and no command. The API that appears designed for this question cannot answer it. The environment variable nobody documents for this purpose can.

## Silence over confidence

One design decision in that resolver matters more than the join itself.

The lookup runs in a strict order — pane id, then config entry, then directory basename — and if every source fails, it returns an empty map. No badge. The tab renders exactly as it did before.

That is deliberate, and the reasoning is specific to what this surface is. A terminal tab in Loki is not a label you read; it is a target you type into. A badge that says `CLAUDE` on a tab that actually holds Grok does not mislead a human — it aims a dispatched prompt at the wrong agent. The failure of a *wrong* answer is categorically worse than the failure of *no* answer, so the code is built to fall silent rather than guess. Nine processes were examined on the test machine; three resolved and six were dropped, because those six were not in any open tab and a plausible-looking badge for them would have been a lie.

For a system whose job is to let a human aim things, "I don't know" is a complete and respectable answer. "Probably Claude" is not.

## What this buys

The tab strip now reads:

```
● surf-your-life CLAUDE    truthseeker CLAUDE    datacat CLAUDE
```

Project, and the agent actually running in it, sourced from the live process rather than from a name someone hoped would match. On a machine with mixed agents it reads `Tab #3 GROK`, `Tab #4 CLAUDE`, `Tab #5 CURSOR` — the operator's original question, answered.

The gain is not that the strip is prettier. It is that a glance now carries information it did not carry before, and a glance is the unit of fleet operation. Ten projects is not ten times harder than one because the work is ten times larger; it is harder because the operator has to reconstruct, every time they look, which context they are in. Each fact the interface supplies for free is a fact the human no longer has to hold. That is the whole mechanism by which one person commands a fleet, and it is why an unnamed tab is a mission-level bug wearing a cosmetic disguise.

## The honest boundary

One caveat, stated plainly because the alternative is a claim that quietly is not true for the person reading it.

Loki's cloud builder picks this up on a normal deploy, and it is verified live there. But an operator's *own* machine is driven by Fleet Runner, the desktop app — and a web deploy cannot update a desktop application. The pane-id join reached laptops only when Fleet Runner 0.8.12 shipped as a release, which is why that release went out alongside this change rather than at some tidier moment later.

It is a small thing to have to say. It is also precisely the kind of split that produces a phantom bug six weeks from now, when someone sees badges on the cloud tabs and none on their own and concludes the feature is broken. It is not broken. It is two programs, and only one of them was updated. Writing that down is cheaper than rediscovering it.
