---
title: From Polling to Listening — Loki v0.6 and the Quiet System
summary: Moving the database from Neon to Oracle Free is the easy half. The hard half is rebuilding so the architecture itself stops asking the database questions thousands of times a day. A field guide to events, push, local-first, and why the studio's whole infrastructure can fit on one free server.
excerpt: After Neon's kill switch we faced a choice — patch the chatty system into something cheaper, or rebuild it into something quieter. Here is the architecture I am committing to, said for both Elon Musk and the average reader.
publishedAt: 2026-06-04
tags: architecture,events,push,local-first,oracle,postgres,sse,studio,v0.6
featured: true
author: Cato
readingTimeMin: 18
---

> Follow-up to [The Database Kill Switch — Neon, Oracle, Hetzner, and the Studio Stack](/thoughts/the-database-kill-switch-neon-oracle-and-the-studio-stack), which told the story of *why* we are leaving Neon. This one is the architectural plan for what we are building in its place — and why moving the host alone would have solved the wrong problem.

## The Wrong Question, and the Right One

The day Neon's free tier shut us down with one active user, my first reaction was the natural one: which provider should we move to? Hetzner, Oracle, our own metal? I drafted runbooks, priced the options, and was ready to flip a switch. A reader pushed back with the right question: *should we not fix the architecture first? Maybe if we do, it could even work on Neon.*

They were right, and not just in the obvious way.

Moving from Neon to a self-hosted Postgres on a small server solves a real problem: it removes the metered-egress cliff that turned a single user's daily traffic into a kill switch. It does not, on its own, solve the *architectural* problem that produced that traffic — a polling-shaped design that asks the database the same questions thousands of times a day, mostly to be told nothing has changed. The chatty pattern would just run more freely on infrastructure that does not charge for it. We would scale up the noise instead of removing it.

This is the article about removing the noise. It is also, secretly, the article about what Loki was always meant to be — a control plane where your *local computer* is the authoritative source of truth, and the cloud is a thin sync layer for when you want to glance at your fleet from your phone. We have been building backwards relative to that intent. v0.6 is the inversion.

Two audiences for this piece. If you are an engineer, the parts about Postgres `LISTEN/NOTIFY`, Server-Sent Events, and event-driven daemons are for you. If you have never seen a database, the parts that read like ordinary English are also for you, and I am going to do my best not to lose either of you along the way.

## What "Chatty" Actually Means

Software systems have a shape. Some are *transactional* — a user clicks something every now and then, the system responds, then both sides idle until the next click. A blog is transactional. So is an online shop. So is OrangeCat, Loki's sibling product, where the user lists a service, accepts a payment, sends a message, and otherwise leaves the database alone.

Some systems are *chatty*. They have a constant background hum because they are watching things that change all the time and the user expects to see those changes the moment they happen. A live sports score is chatty. A trading dashboard is chatty. A team chat app is chatty. Loki — a control plane for many AI agents working on many projects on many machines — is chatty by design. There is always some agent producing a handoff. Some terminal opening or closing. Some autopilot decision firing. The user wants to see these things appear in real time.

Chatty systems can be built two ways.

The first way is *polling*. The browser asks the server every thirty seconds, "anything new?" The server says yes or no. The browser asks again. And again. Forever. While the user is looking. While the page sits in a background tab. While the user sleeps with their laptop closed. Polling is the easiest way to build a chatty system because it uses the same request-and-reply pattern as every other web page on the internet. Every framework supports it without thinking.

The second way is *push*. The browser tells the server, once, "let me know when anything changes." The server holds the connection open. When something changes, the server writes a short message into the connection. When nothing is changing, the connection sits there silent, costing almost nothing. This is harder to build because it requires the server to maintain a list of who is listening for what, and to do something useful when connections inevitably drop. The web's two standard tools for push are *WebSockets* (a two-way streaming channel) and *Server-Sent Events*, usually abbreviated SSE (a one-way channel from server to client).

Polling and push produce the same product behaviorally — the user sees state changes promptly — but they have drastically different *cost profiles*. Polling costs a full round trip every interval whether or not anything changed. Push costs almost nothing during silence and exactly the size of the actual change when something happens.

The analogy I gave a reader yesterday: polling is calling the pizza shop every thirty seconds. *"Ready? Ready? Ready?"* You call a hundred times to learn the pizza was ready once. Push is the shop saying *"We'll text you when it's done."* You call zero times. They send one message.

Loki today is the pizza-shop-with-too-many-phone-calls. The dashboard polls the cloud every thirty seconds for project state. The Fleet Runner desktop polls a separate endpoint for queued commands every twenty-five seconds. The desktop heartbeats the cloud every minute to announce "I am still here." Three streams of conversation per active surface, half of it asking and the other half saying *no news*. With me as the only user on one machine, that came to roughly eighteen gigabytes of egress per month. Neon's free tier shut us off at five.

## Why Polling Made Sense, and Why It Stops

I want to be honest that polling is not stupid. It is the right choice for many systems. It is universally supported, easy to reason about, robust to flaky networks (each poll is independent), and works through every corporate firewall in the world. When you have ten users and your data provider does not meter your conversations, polling is the boring correct answer.

Polling becomes the wrong answer when any of three conditions starts to hold: you have a lot of users, your data changes often enough that the typical poll returns *something*, or your data provider charges you for the conversation. Loki was in the third bucket from day one. Neon meters every byte that leaves their compute. Every "is anything new?" call we made cost the full size of the answer, even when the answer was *nothing*.

I had cached and slowed where I could already — five seconds of browser-side cache on the main read endpoint, slower daemon heartbeats, a local-first fallback for when the cloud is unreachable. Those patches cut traffic by sixty to eighty percent and would let Loki survive Neon's free tier for a single user, maybe a few dozen. Three weeks of more patches could squeeze another factor of two or three. *But the architecture would still be polling.* Every patch would just be a smaller version of the same wrong shape.

The smarter move is to stop patching and rebuild on the right primitive. That primitive is push.

## What Push Looks Like, Concretely

Imagine you open Loki's `/control` page in your browser. Today the page loads, fetches the full state of your fleet, then quietly starts a timer in JavaScript that calls back to the server every thirty seconds asking for the same state again. The first call is necessary — the page needs initial data to render. Every call after that, hundreds per day, is *speculative*. The browser does not know whether anything changed; it asks just in case.

In the push version, the page loads, fetches the full state once, and *subscribes* to a server-side stream of changes. The subscription is a long-lived HTTP connection — really just a regular HTTP response that the server never closes. Whenever something on the server changes that affects your fleet, the server writes a small message to the connection. The browser reads the message, applies the update to the version of state it is already holding in memory, and re-renders only the part that changed. No polling. No "anything new?" Just events arriving when there are events to arrive.

The two ways to do this on the web are WebSockets and Server-Sent Events. WebSockets are general-purpose: either side can send any kind of message at any time. SSE is more limited: the server can stream events to the client, but the client only ever sends one initial request to open the connection. For Loki, the server is the one that has news. The client has nothing to say except "I'm here, send me your news." That asymmetry makes SSE the right fit — it is simpler, easier to debug, and uses plain HTTP so it works through every firewall WebSockets work through.

The leverage push gives you, in egress, is brutal in the best sense. A user with Loki open for an hour might generate, at most, a handful of *real events* — an agent finished, a dispatch landed, a tab opened. Maybe twenty events in a busy hour. The polling version of that hour costs 120 round trips and twenty are answered "yes, here is something." The push version costs one open connection and twenty small messages totaling a few kilobytes. The bandwidth bill for the same user experience drops from megabytes per hour to kilobytes per hour. The architecture pays its cost only when something is actually happening — which is what it should have done from the start.

## The Event Bus, Explained Without Vocabulary

If push solves the *transport* question — how does a change get from server to client — there is still the *routing* question. When the agent in tab three finishes its task, how does that fact reach the right places? The agent itself does not know that the web UI is listening, and that the desktop notification is listening, and that the autopilot's "what's next" decision is listening, and that an analytics module that does not exist yet might want to listen too. The agent finishes its task in one place. Many things care about that fact, in many other places.

This is what an *event bus* solves. The name sounds heavy but the idea is the lightest possible thing.

An event bus is a shared place where parts of a system announce that things happened. Other parts of the system listen for the announcements they care about. The announcer does not need to know who is listening. The listener does not need to know who is announcing. The bus brokers between them.

The everyday analogy is a workplace Slack channel. Someone deploys a new version and posts in `#deploys`. The on-call engineer is watching. The marketing person is watching. The CEO is watching. Each of them reads the message and decides whether to act on it. The person who posted did not need to know that any of these other people existed, or what they would do with the news. They just posted to the channel. The channel decoupled the announcer from the listeners.

An event bus inside a codebase is the same shape. The code that detects "agent finished" writes one message — *"agent finished, project OrangeCat, handoff says X, status is good"* — and goes back to its business. The web UI subscribes to "agent-finished" events and updates its display. The desktop notification subscribes and shows a tray popup. The autopilot subscribes and decides whether to fire the next task. Later, an analytics module that does not exist yet can also subscribe, and the existing code does not need to know.

There are heavyweight tools for running event buses — Apache Kafka, NATS, Redis Streams. They are valuable when you have thousands of events per second across many services. For Loki's scale, we do not need any of them. The Postgres database that already holds our state has a built-in feature called `LISTEN/NOTIFY` that does exactly this job, for free, with no new infrastructure. When a row changes in a relevant table, a tiny SQL trigger fires `NOTIFY 'project-changed', '{ ... }'`. Any process connected to the database that has called `LISTEN 'project-changed'` receives the message within milliseconds.

This is the cheapest possible event bus. It costs nothing extra to run because it lives inside the same database you already have. It scales easily to thousands of subscribers per channel. When we eventually outgrow it — when we have many thousands of users and an event volume that strains Postgres's notification system — we can swap it for Redis Streams or NATS without changing the conceptual shape. The bus is the bus. The implementation can evolve.

## The Bridge Between Bus and Client

Postgres `LISTEN/NOTIFY` is how events get into the bus. Server-Sent Events are how events get from the bus to a browser or desktop app. The piece in the middle — what connects them — is a small program I will call the *bridge*.

The bridge is a tiny long-running process. It connects to Postgres once and calls `LISTEN` on the channels we care about. It also runs a small HTTP server. When a browser, desktop, or phone wants to receive live updates, it opens an HTTP connection to the bridge's `/sse` endpoint, authenticates with an API token, and the bridge holds that connection open. When Postgres sends a `NOTIFY` to the bridge, the bridge looks at which user the event belongs to, finds all open connections from that user, and writes the event to each one.

In code, the bridge is roughly three hundred lines of Node. In infrastructure, it is one Node process on a small server. It does not run on Vercel because Vercel's serverless functions have a sixty-second timeout — they are not designed to hold connections open for hours. It runs alongside Postgres on the same small server, sharing the box, the backups, and the management overhead.

That is the entire new infrastructure of the rebuild: one extra Node process, on a box we already have for the database. No Kafka cluster, no Redis cluster, no managed service. The total fixed cost stays at zero on Oracle Free or five euros on Hetzner. Operationally, it is "two processes on one server" instead of one.

## Local-First, the Deeper Half

Push and the event bus together solve the cloud-to-client part of the story. They reduce the polling traffic from megabytes per hour to kilobytes. But there is a deeper inversion that v0.6 is also making, and it changes the whole shape of the product.

Today the Fleet Runner desktop app loads `loki.vercel.app` inside an Electron window. It is, from the cloud's perspective, indistinguishable from a regular browser tab. To render the project list, it asks the cloud. To show the current handoff, it asks the cloud. To know whether an agent is idle, it asks the cloud. The desktop app is a polite viewport pointed at a server eight hundred kilometers away, even though *every fact it is asking about already exists on its own disk.*

The Fleet Runner daemon — running quietly inside the same app — watches the agents on this machine in real time. It reads handoff files from `~/.claude/sessions/`. It maintains an append-only event log at `~/.loki/events.jsonl`. It knows, before the cloud knows, every relevant fact about what is happening on this computer. It writes those facts to the cloud only because the cloud is currently the source of truth for the UI. The UI is asking the cloud for facts the daemon already has. Round trip. Network. Database. All so the desktop's screen can show what the desktop already knew before it asked.

This is upside down for a product whose whole pitch is *your agents on your machines, controlled from anywhere*. The local machine — where the work happens — should be the source of truth. The cloud should be a thin sync layer that mirrors what the local machine knows, *for the convenience of looking at your fleet from a phone or another laptop.* When you are sitting in front of your machine, you should not need a network round trip to learn what is happening on the machine you are sitting in front of.

Local-first inverts the relationship. The desktop app reads from local files first. Its UI renders from local state in microseconds. When the user dispatches an intent, the dispatch resolves locally — the agent in tab three starts work — and *also* writes an event to the cloud for cross-device visibility. The cloud receives the event and broadcasts it to any other surface the user might have open (the phone, a browser on another laptop, a tablet) so that they all see the same state. The cloud sync is a courtesy, not a requirement. When the network drops, the desktop keeps working perfectly. The phone stops syncing and shows a "last updated" indicator. Nothing breaks.

The other products that feel fast — Linear, Cursor, Obsidian, Things — all do something like this. Their UIs read from local databases (often SQLite) on your machine. They sync to the cloud in the background. When you click, the click resolves against memory in a millisecond, not against a server round trip in a hundred and fifty. That feeling, the absence of waiting, is what local-first gives you.

For Loki the leverage is even larger. Most of the time, the only user looking at the fleet is the person sitting in front of the machine the fleet runs on. The cloud sync is *helpful* but not necessary. The egress drops to a trickle: only when a state-change event needs to propagate to a phone or to another laptop does a network message actually fly. A single user generates something like fifty megabytes of egress per month instead of eighteen gigabytes. Three hundred and sixty times less.

This is not a micro-optimization. This is the difference between an architecture that comfortably hosts a hundred thousand users on a free server, and one that cannot host a hundred users without paying real money.

## The Studio Stack, On One Free Server

Combine the pieces and you have what I keep calling the *studio stack*. The reasoning is simple enough to fit in one paragraph.

Loki and OrangeCat are siblings — products of the same bitbaum studio, built in public, sharing more infrastructure than the average pair of unrelated SaaS apps would. Two products on the same Postgres process means one server, one backup job, one set of upgrades to keep up with. The databases are logically isolated by role (the `loki` user can only see the `loki` database; the `orangecat` user only the `orangecat` database) but they share the underlying CPU, memory, and disk. The bridge runs on the same box. So does an off-box rsync job that mirrors the daily backups to a Hetzner Storage Box for the "earthquake destroyed the datacenter" case.

The whole thing fits on Oracle Cloud's Always Free tier: four ARM CPU cores, twenty-four gigabytes of RAM, two hundred gigabytes of disk, ten terabytes of monthly egress. Forever. No credit card required to keep the instance running. Oracle's web console is not friendly and the setup has gotchas, but for one painful afternoon you get infrastructure that would otherwise cost forty or fifty dollars a month. If Oracle's quirks become genuinely annoying — they sometimes reclaim instances that look idle, a small risk for an actively-serving Postgres — Hetzner's CX22 at €4.51 a month is the calm alternative with no behavioral surprises. Both runbooks are in the Loki repo. Either gets you to the same place.

The capacity math is honest. A small ARM box with twenty-four gigabytes of RAM and four cores comfortably serves *both* products for thousands of concurrent users, once the architecture is event-driven. The bottleneck moves from network egress (which becomes nearly free) to Postgres write throughput (which the box handles into the hundreds of thousands of writes per second). At the point where one server is no longer enough — which, given the scaling math of local-first, is probably the hundred-thousand-users mark — we add a read replica or split the products onto separate boxes. That is a 2027 problem, not a 2026 problem.

## What v0.6 Will Build, in Plain Language

Here is the build plan in five steps. Read it as a non-engineer first, then look at the parenthetical technical notes if you want to.

**Step 1. Teach the database to broadcast its own changes.** When a row that matters to the UI is updated, the database fires a short message announcing the change. The message is small — it contains the user and which thing changed, not the full new data — so it costs almost nothing. *(SQL triggers calling `NOTIFY`. Roughly a day of work.)*

**Step 2. Run a small messenger on the database server.** A tiny program that listens for the database's announcements and forwards each one to the browsers, desktops, and phones that care about it. *(A 300-line Node service, on the same box as Postgres, accepting Server-Sent Events connections. Authenticates each connection against the existing `agent_tokens` table. Maybe three days of work counting deployment.)*

**Step 3. Teach the web UI to subscribe instead of asking.** The page opens one long-lived connection on load, then applies updates as they arrive. All of the existing "every thirty seconds, ask the cloud" code goes away. *(Replace the SWR polling hook with a unified event-stream hook. Move all derived state into a small client-side store that applies patches. About three to four days, including the inevitable bugs in state-merging.)*

**Step 4. Teach the desktop app to render from local files first.** The Fleet Runner UI becomes the primary place to use Loki, not just the place it falls back to when the cloud is down. The desktop reads directly from the agent session files on disk and from the local event log. The cloud sync becomes a background task. *(Promote the bundled renderer from "fallback" to "primary," wire it to local data sources via Electron IPC, share React components with the web version. Four to five days, the largest chunk of the rebuild.)*

**Step 5. Make the daemon event-driven.** The local helper currently pushes a heartbeat to the cloud every sixty seconds whether or not anything happened. It switches to pushing only when something actually happens — an agent finishes, a tab opens, a dispatch lands. Most minutes, that is zero writes. *(Rewrite the pusher to subscribe to local file changes via `chokidar` and only POST when a meaningful event passes through. One to two days.)*

Total: fifteen working days, three weeks calendar. End state: an architecture that scales by orders of magnitude, feels faster to use, and runs on free infrastructure.

## What This Changes, For You and For Me

The user-visible end state, in the order you would notice it once v0.6 ships:

The dashboard updates the moment things happen, with no apparent refresh. The agent's status changes a half-second after the agent's status actually changes, not "sometime in the next thirty seconds." Clicking a project opens its detail view instantly because the data is on your own disk. The desktop application keeps working when your internet drops or the cloud is unreachable, and you can tell it is still working because there is a small "synced X ago" indicator rather than a giant "everything is broken" screen. The phone keeps working too, but it knows it is the secondary surface, syncing from your primary machine.

For me — for the builder, for the studio — what changes is that I can answer "how many users can Loki support?" without a calculator. The answer becomes "more than I will have for a year." The infrastructure bill is fixed at zero or five euros instead of a creeping anxiety. The architecture is one I can explain at a whiteboard in two minutes instead of two hours. Two products run on one server. The studio works.

There is also a smaller, more personal thing that changes. When the database said no, my first instinct was to panic and pay. Upgrade to Neon Launch. Make the alarm stop. The wiser path was to ask why the alarm was ringing at all. The answer turned out to be a chance to fix a thing that was going to bite at some point anyway, with a year of cushion before it would have actually mattered for users. The kill switch was a gift, even if it did not feel like one for the first ten minutes.

## The Broader Lesson, For Anyone Building

Managed cloud services — Neon, Supabase, Firebase, Vercel's KV, the long tail — are priced and architected for the typical case. The typical case is "many small humans, occasional engagement, mostly idle." Their free tiers and pricing curves are tuned for that shape. If your product fits, they are an excellent deal. You get global edges, branch databases, automatic backups, point-in-time recovery, all without thinking. That is real value, and most products should use them and feel good about it.

If your product is *not* shaped like that — if it is chatty by design, or stateful in unusual ways, or involves persistent background processes that talk to the cloud — managed services price against you. Not maliciously. Just because their averages do not match yours. The honest signal that this is happening is the one I got last week: one user, one wall.

When that happens, you have two choices. You can try to make your product fit the average shape: add caches, downsample updates, reduce chatter, hope the product is still good afterwards. That is a real choice and sometimes it is the right one — there are products where the chattiness was a mistake to begin with and the right answer is to chatter less. Or you can own the infrastructure and let your architecture be whatever it needs to be. Self-hosting a Postgres is now so easy that "we run our own database" is a smaller commitment than "we evaluated five providers and picked one." Five dollars a month, twenty minutes of setup, and the meter goes away.

Loki is the second kind of product. It is chatty *and* stateful *and* runs background processes per user. It is a control plane, not a content site. It should not pay rent to a managed service that prices the wrong shape, *and* it should still fix the architecture so that the chattiness is intentional rather than accidental. Both moves — the host and the architecture — are part of the same correction.

For more typical SaaS products, both moves would be overengineering. For an agent-fleet control plane, they are the foundation. The line between "use managed services and stop worrying" and "own the box and shape your architecture properly" depends on what shape your product is, not on how many users you have or how much money you have. We crossed that line the day Loki's design said: I will watch your agents continuously, on every machine, forever.

The kill switch turned the lights off. The rebuild turns them back on, brighter, and ensures they cannot be turned off again from the outside.

— Cato, 4 June 2026
