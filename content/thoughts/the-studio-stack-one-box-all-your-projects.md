---
title: The Studio Stack — One Box, All Your Projects
summary: A €7-a-month Hetzner box can host a portfolio of fifteen indie products. The shape of "many small projects, one operator" doesn't fit managed-service pricing models — and the boring self-hosted alternative scales further than most builders realize. A field guide.
excerpt: Most cloud services are priced for the typical web app — a single product, many users, mostly idle. Solo builders run the opposite shape: many small products, few users each, constant background work. Here is what works at that shape, and what it costs.
publishedAt: 2026-06-04
tags: infrastructure,hetzner,postgres,studio,indie,architecture,levelsio
featured: true
author: Cato
readingTimeMin: 16
---

> Follow-up to [The Database Kill Switch](/thoughts/the-database-kill-switch-neon-oracle-and-the-studio-stack) and [From Polling to Listening](/thoughts/from-polling-to-listening-loki-v0-6). The first told the story of why Neon shut us off. The second told the story of the architectural rebuild. This one is the infrastructure pattern that holds them together — and that scales to a whole portfolio, not just Loki.

## A Question About Shape

A solo builder I respect once asked me what infrastructure he should use for "a website." I gave him the obvious answer: Vercel for the frontend, a Postgres provider like Neon or Supabase for the database, Cloudflare R2 for any large files, an email provider, Stripe if payments are involved. Familiar advice. He thanked me, set it up, and a year later sent me his cloud bills. The infrastructure for one small productivity tool was costing him a hundred and twenty dollars a month. He had a few hundred users.

Per user that was a dollar a month of pure infrastructure — before any of his own time, marketing, or salaries. The product, a calendar app he sells for nine dollars a year, was charging the user roughly nine times its annual revenue back to AWS, Neon, Resend, Cloudflare, and four other vendors in monthly fees. The math only works if he hits volume; volume requires marketing; marketing costs more than infrastructure. The bill kept going up while users came in slowly. He shut it down.

This is not a failure of the cloud. The cloud delivered what it promised. The failure was a mismatch of *shape*. The vendors he chose were priced for "one product, many users, mostly active during business hours, scaling to millions." His actual shape was "one product, hundreds of users, evenly distributed, never going viral." Every vendor charged him for the high end of a curve he was nowhere near, in exchange for the ability to scale to it if he ever needed to.

He never did need to. Most of us don't.

This essay is about the shape that *is* common among independent builders — a portfolio of many small products, each with modest users, all run by one operator — and what infrastructure actually fits that shape. The conclusion is unsurprising once you see the pattern: one boring server, hosting all the products' state, costing somewhere between five and fifteen euros a month, scalable to thousands of users per product before you ever think about it again. The interesting part is *why* the obvious cloud-native advice fails for this shape, and how to set the alternative up without losing the things the cloud genuinely does well.

## The Shape Cloud Services Were Built For

Picture a graph. On one axis, the number of products. On the other, the number of users per product.

A startup VC pitch lives in the upper-left: one product, exponentially growing users. The infrastructure for that shape needs to autoscale fast and handle traffic spikes elegantly. AWS, Vercel, Neon — they're all designed to make this case painless. You pay a little when small, a lot when big, and the curve is smooth enough that you never have to migrate. The pricing scales with success; the success funds the pricing. Healthy match.

A B2B SaaS lives in the middle: a small number of customers, each generating modest steady traffic, mostly during work hours. Managed services fit this case too — the steady traffic stays well within free tiers, the costs are predictable, the operational burden is small. You pay $50 a month and forget about it.

The shape that *doesn't* fit any of these vendors is the lower-right: many products (often more than ten), each with modest users (often dozens to low thousands), all run by one or two people. The studio shape. Each individual product would happily live on a free tier. But the operator has fifteen of them, so the "free tier" promise dies — you can't have fifteen Neon projects each consuming five gigabytes a month and still call it free. You can't keep fifteen Vercel projects all on the Hobby tier and stay within the terms of service when you start making money from them. You can't keep fifteen Supabase projects from gradually drifting into different tier slots.

Each vendor is calibrated for *one product*. The studio operator has *many*. Every line item multiplies by N where N is your number of projects.

Beyond the math, there's the cognitive multiplication. Fifteen Vercel dashboards is fifteen places that might be on fire. Fifteen Neon projects is fifteen quotas to watch. Fifteen Supabase accounts is fifteen sets of API keys to rotate. The operator's most scarce resource is attention. Cloud services that look free at the unit level become expensive in attention at the portfolio level. The studio's actual bottleneck is not infrastructure cost — it is the operator's ability to ignore infrastructure entirely while they build.

## The Studio Stack

The pattern that fits this shape is so boring it sounds wrong on first hearing: **one server, hosting all the products' state, with applications deployed wherever is convenient**. The state means Postgres databases — one per product, sharing the same Postgres process. The applications can be on Vercel (because Vercel's frontend hosting is genuinely fine for the studio shape, even though its API + database story isn't). The static files go on cheap object storage (Cloudflare R2 or Backblaze B2). The domains stay at whatever registrar you already have. The whole thing fits on one small VM and a handful of services where each is genuinely needed.

Concretely, the components and their roles:

A **Hetzner Cloud server** — typically a CX22 (€4.51/mo, 2 vCPU, 4 GB RAM, 40 GB SSD) — runs Postgres 17 with one database per product. The same server can also run a reverse proxy (Caddy, which terminates TLS for free via Let's Encrypt), backup cron jobs, and any small Node processes that need to be always-on (event bridges, schedulers, daemons). One server, multiple roles. The discipline is "if it needs to be always-on, put it here; if it can be serverless, put it on Vercel."

**Vercel** continues to host the frontends and the serverless API routes that don't need persistent connections. Vercel is excellent at exactly this: serving Next.js, running short-lived functions, caching at the edge globally. We pay them nothing for the frontend (well within the Hobby tier for studio-shape traffic), and they handle the parts of the web that benefit from a global CDN.

**Cloudflare R2** or **Backblaze B2** for any user-uploaded media. Images, videos, PDFs, anything heavy. R2 is roughly $0.015 per gigabyte per month with free egress; B2 is $0.005 per gigabyte per month. Cheap, predictable, never approaches Hetzner's disk space or Vercel's deployment limits.

**One domain registrar** for all the domains. Cloudflare Registrar is at cost, no markup. Namecheap is the established alternative. Whatever you use, use only one — your domain inventory is small enough that consolidating saves real attention.

**Three SaaS APIs** for the heavy lifting that's not worth self-hosting: an email-sending service (Resend, Postmark), an AI inference provider (Anthropic, xAI, Groq depending on the workload), and a payments processor (Stripe). That's it.

That is the studio stack. Seven providers total (Hetzner, Vercel, Cloudflare, Backblaze, Resend, Anthropic, Stripe), each chosen because it does exactly one thing well and bills predictably. For a portfolio of fifteen projects with thousands of users distributed across them, the fixed cost is around twelve euros a month, plus whatever variable AI inference fees the products incur (usually under twenty dollars at this scale).

Compare to the "cloud-native" version of the same portfolio: Neon free tier blows past five gigabytes by the third active product, you upgrade to Launch tier at nineteen dollars per project, multiply by fifteen, you're spending three hundred dollars a month on databases alone. The studio stack lets you keep that money or hire someone who actually moves the needle.

## How One Postgres Process Hosts Fifteen Products

The thing that makes the studio stack work is a Postgres feature most people don't think about: **a single Postgres process can host many independent databases**.

When you create a Postgres database, you're not provisioning a new "instance" the way you do with managed services. You're creating a new logical container inside the same process. Each database has its own schema, its own tables, its own permissions. The role `loki` can only see the `loki` database; the role `orangecat` can only see `orangecat`. They share the underlying RAM cache, CPU, and disk, but they're cleanly isolated logically.

The operational model becomes:

```
ssh ubuntu@studio
sudo -u postgres psql

CREATE ROLE petvity WITH LOGIN PASSWORD '...';
CREATE DATABASE petvity OWNER petvity;
\q

# Apply per-role pg_hba rule so petvity can only authenticate to its own DB.
# Set DATABASE_URL on the petvity Vercel project to:
#   postgresql://petvity:...@studio.bitbaum.com:5432/petvity?sslmode=require

# Done. New product on the studio stack in two minutes.
```

That two-minute provisioning is the closest thing to "free tier" that exists at the studio scale. Every new project is essentially free to set up because the marginal infrastructure is one database and one DNS record. The cost of a sixteenth project on this stack is exactly what the cost of the fifteenth was: nothing extra.

There is a real limit, of course. The bottleneck is **RAM**. Postgres caches frequently-accessed data in memory, and once the combined working set across all your databases exceeds RAM, queries hit disk and slow down. On a CX22 (4 GB RAM), the working set ceiling is roughly two and a half gigabytes after Postgres's own overhead. That's enough for maybe fifteen small databases or five medium ones. When you start to feel it (the indicator is Postgres's cache hit ratio dropping below 95%), you upgrade. Hetzner's CX-line lets you rescale a server in place — pick a bigger shape, ten-minute reboot, same IP and SSH key, your data still there. CX32 doubles RAM for €7/mo. CX42 doubles again for €14/mo. You can ride the same physical pattern from your first user to your ten-thousandth.

The other thing worth saying: **independent disks for independent products is overkill at this scale**. The conventional cloud-architecture wisdom — separate databases, separate VPCs, separate accounts — is correct at *enterprise* scale where one product failing must not affect another. At studio scale, your products often share an operator (you), share customers (some), share a brand (some), and share a fate (if the operator gets sick, all of them slow down). The "blast radius" of shared infrastructure is calibrated to who's actually affected by failures, not to a hypothetical. One box failing means all your products are down for the duration it takes to fail over; that's a real risk, mitigated by backups and (eventually) a hot-standby replica. It is not so much more risk than fifteen separate boxes, each of which could fail independently and which collectively have fifteen times the failure surface.

## Levelsio and the Public Reference Architecture

The reason the studio stack feels novel even though it's been around forever is that nobody famous explained it until Pieter Levels did, in public, on Twitter, repeatedly. He runs Nomadlist, Photo AI, Interior AI, Hotelist, and a long tail of smaller projects from a small handful of Hetzner VPSes. His public [stack page](https://levelsio.com/stack/) lists fewer than ten vendors total. He charges flat fees for his products, makes generational money from them solo, and tweets candidly about how unimpressed he is with the complexity people pay for elsewhere.

What he understood earlier than most is that for a portfolio of small products, **the boring stack is the right stack**, and the cloud-native consensus is a tax on the wrong axis. He has tweets where he describes provisioning a new product as "git clone, edit nginx config, restart, done." Each new product is marginal effort because the marginal infrastructure is zero. That speed is the thing competitors can't match if they're paying per-product to a managed-service vendor.

The public reference architecture that's emerged around levelsio's tweets is roughly: Hetzner VPS, SQLite or Postgres on the same box, Cloudflare DNS + R2 storage, Backblaze B2 for backups, Tailscale for the SSH/internal mesh, Cloudflare Tunnel for inbound HTTPS, xAI or Groq for LLM inference, Stripe for billing. Fewer than ten vendors. Predictable monthly bills. Operational complexity reduced to "run apt upgrade weekly and watch Postgres's metrics."

It is not what venture-funded engineering teams build. It is exactly what most independent builders should build, and the reason most don't is that they haven't been told it works. This essay is, in part, a piece of that telling.

## The Ten Vendors Discipline

There is a deeper principle behind the studio stack that's worth naming directly: **fewer vendors is a competitive advantage**.

Every additional SaaS in your stack is a cognitive tax. A different dashboard to learn. A different status page to check when things go wrong. A different billing date. A different password to rotate. A different set of API quirks. A different idea of how authentication works. A different way to find the right Slack channel for support. For *one* vendor, the cost is small. For *many*, the costs stack additively and the operator's attention becomes the bottleneck.

The studio stack's seven vendors aren't chosen to be minimal for minimalism's sake. They're chosen because each one does exactly one job that is too painful to do yourself, and the cost of doing it yourself isn't worth the cost of using the SaaS. You self-host Postgres because Postgres is well-understood and cheap to run. You don't self-host email sending because email deliverability is a multi-year domain that requires specialized knowledge to get right. You don't self-host AI inference because the API providers have economies of scale you can't match.

Where to draw the line between "self-host" and "use a SaaS" is the real architectural question. The shorthand I've landed on: if the thing requires *expertise you don't have* and the SaaS is *priced per-use*, use the SaaS. If the thing requires *general operational hygiene* and the SaaS is *priced per-product or per-tier*, self-host. Email is the first category. Postgres is the second. AI inference straddles — the API providers are vastly cheaper than a GPU for variable workloads, so SaaS wins.

Every quarter, audit your vendor list. For each one, ask: would dropping this vendor be *worse* than the operational time to do the job ourselves? If no, drop it. The audit usually surfaces two or three vendors you could shed; over time, this is how operators end up with the ruthlessly compact stack.

## When the Studio Stack Stops Being Enough

There's a real moment when the studio stack runs out — when you should add the next box, or when you should split a single big product onto its own infrastructure. The triggers are concrete:

- **CPU sustained over 70%.** The box is working hard enough that small spikes start to feel slow. Solution: rescale the same box to a bigger shape, or split the noisiest product onto its own.
- **Postgres cache hit ratio below 95%.** Your working set exceeds RAM and queries are hitting disk. Solution: upgrade the box's RAM (CX22 → CX32 → CX42 in place).
- **p95 query latency above 50ms.** Something is contended — could be locks, could be I/O. Solution: investigate first; could be a missing index, or genuinely a capacity issue.
- **One product becomes a real business with co-founders or external dependencies.** At that point, "shared infrastructure with my other side projects" is the wrong shape. Solution: give the breakout product its own box, its own backup story, its own escalation policy. The studio infrastructure stays for the rest.

None of these are likely to fire for the first six to eighteen months of operating the studio stack. The point of the stack isn't that it's optimal forever — it's that it's appropriate *for the shape you actually have*, and it scales sideways (new products) and upward (bigger box) without forcing a rewrite at any point.

## Backups, Security, the Boring Hardening

Three things people skip on the studio stack that they shouldn't.

**Daily backups, off-box.** A daily `pg_dump` of each database, gzipped, written to `/backups/` on the host is the first step. It's not enough. If the host dies — disk failure, fat-fingered `rm`, ransomware, a region outage — your backups die with it. The boring fix is `rclone` or `b2 sync` from `/backups/` to a Backblaze B2 bucket every night. B2 is $0.005 per gigabyte per month; your fifteen databases probably total under five gigabytes; backups cost twenty-five cents a month. Even at this absurdly low price, almost no one does it from day one. Do it from day one.

**Tailscale for SSH access, public ports closed.** The default studio stack opens port 22 (SSH), 80 (HTTP redirect to 443), 443 (HTTPS), and 5432 (Postgres) to the public internet. That's fine — TLS plus strong passwords keeps it safe — but it does mean your firewall logs are full of script-kiddie scans. The mature pattern is to put Tailscale (free for personal use) on the box and on your laptop, then close port 22 to the public entirely. SSH access goes through the Tailscale mesh, which is a private VPN that doesn't expose anything publicly. Same logic with Postgres: connect via Tailscale from your laptop, close 5432 to the public, let only Vercel's known egress IPs through if needed. Adds ten minutes to the setup, dramatically shrinks the attack surface.

**Cloudflare Tunnel for inbound HTTPS, port 443 closed.** This is the more advanced cousin of Tailscale-for-SSH. Cloudflare Tunnel lets a small daemon on your box maintain an outbound connection to Cloudflare; Cloudflare receives public HTTPS traffic on your domain and forwards it down the tunnel. You can close port 443 entirely on your host firewall. No more inbound from the public internet at all. Slightly more setup, somewhat more debugging when things go wrong, but a great upgrade once the basic stack works.

These three additions — daily off-box backups, Tailscale SSH mesh, Cloudflare Tunnel — together graduate the studio stack from "weekend project that works" to "boring production infrastructure I can trust." They are not optional. They are also not hard. The total time to add all three to an already-running stack is roughly two hours.

## What the Studio Stack Enables, Beyond Cost

I've made the case for the studio stack mostly on cost and operational simplicity, because those are the most concrete arguments. There's a softer benefit worth naming.

When your infrastructure costs are fixed at single-digit euros per month and your operational surface is small enough to fit on one screen, **the cost of starting a new product drops to zero**. You can spin up a fresh idea on a Friday night, point a domain at the studio, create a database with one psql command, and see if it has legs. If it doesn't, the product costs nothing to keep alive at zero traffic — it's just a row in a Postgres database and a Vercel deploy. If it works, it scales on the same infrastructure as everything else.

This is what people who use this stack mean when they say it's "freeing." The constraint that usually keeps solo builders from running portfolios — that infrastructure overhead compounds per-product — disappears. You can be the kind of builder who tries a lot of ideas because trying is cheap. The studio stack is, secretly, an *idea-testing infrastructure*. The fact that it also happens to host the products that work is a byproduct.

That's the deeper case for the boring stack: it removes friction from the most important loop a solo builder is in — try, ship, learn, kill or keep. Friction that managed services charge premium prices to remove higher in the stack is removed here for free, at the cost of an afternoon spent on a Hetzner VM.

## Practical Checklist

If you want to set this up for your own portfolio, the canonical sequence:

1. Provision a Hetzner CX22 in the region closest to your Vercel projects (Falkenstein for `fra1`, Ashburn for `iad1`).
2. Install Postgres 17 via the PGDG repo, not Ubuntu's default. Trust me on this.
3. Create one role and one database per product. Apply per-role `pg_hba` rules.
4. Install Caddy in front. Caddy auto-provisions TLS certs via Let's Encrypt for any subdomain you point at the box.
5. Set up a daily `pg_dump` cron writing to `/backups/`.
6. Set up `rclone` or `b2 sync` to copy `/backups/` to Backblaze B2 nightly.
7. Install Tailscale, join the host to your tailnet, close port 22 to the public.
8. (Optional, later) Install Cloudflare Tunnel, close port 443 to the public.
9. Update each Vercel project's `DATABASE_URL` to point at the new host.
10. Watch the bills shrink and the operational surface shrink with them.

The whole thing is a one-afternoon project. The result is a studio stack capable of hosting your portfolio for the next eighteen months at least, on a single line item that costs about as much as a cup of coffee.

You can find the install scripts, runbooks, and migration kit in this repository under `scripts/db/` and `scripts/oracle/`. They're written for Loki's specific shape but apply unchanged to any indie portfolio.

The most valuable thing this stack gives you isn't the savings or the simplicity. It's the *attention back*. Time you'd have spent watching meters, debugging vendor quirks, and contemplating tier upgrades is time you can spend on the products themselves. That recovered attention is the real return on the boring stack.

— Cato, 4 June 2026
