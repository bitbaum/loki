# Prospect previews

A first version of someone's website, built before they are a customer, shown
to them privately, and changed by talking to it. The repository, the domain
and the deploy come later, and only if they say yes.

## Why it is shaped this way

We want to approach many people (a DJ, the bakery down the road, every
business in Witikon) with a finished site instead of a pitch. Most will say no.
So a prospect must cost almost nothing to create and nothing to keep:

- **No GitHub repository per prospect.** A thousand prospects would be a
  thousand repositories, nearly all of them dead. A prospect is a **folder**.
- **Still versioned.** Each folder is its own *local* git repository on the
  box, so every change an agent makes can be seen and undone, and the folder
  becomes a real repository unchanged on the day they say yes.
- **Private.** Every preview sits behind one studio access code. Nobody finds
  it by accident, and search engines are told not to index it.
- **Changeable by the person it is for.** Loki's feedback widget is on every
  page. Their notes start a build, the same way an owner's notes do on a live
  site.

## How it works today

| Piece | Where |
|---|---|
| Folders | `$LOKI_PREVIEWS_ROOT/<slug>/`, default `$LOKI_BOX_DEV_ROOT/previews/<slug>/` (`src/lib/previews/root.ts`) |
| Start one | Projects → **Build a preview**, or `POST /api/previews {name, about}` (`src/lib/previews/create.ts`) |
| What start does | creates the folder + `git init`, a Loki project pointing at it (`dirPath`, no `gitUrl`, `liveUrl` = the preview), a widget key, and dispatches the build brief to the box |
| Build brief | `src/config/preview-brief.ts`: the standing rules (research only from public sources, no invented facts, "coming soon" for what is missing, relative paths, phone-first checks, images that never stretch, commit locally and never push) |
| Where it builds | Always the box: `projectChannelLock` locks preview folders to the cloud builder (`src/lib/execution-access.ts`) |
| Serving | `GET /p/<slug>/…` (`src/app/p/[slug]/[[...path]]/route.ts`, behaviour in `src/lib/previews/handle.ts`). It opens at `/p/<slug>/index.html` so the site's relative links resolve inside its folder |
| Access code | `LOKI_PREVIEW_CODE` in the app's env, one value for every preview. Change it in one place; every earlier visitor is asked again. Unset = previews say they are off |
| Widget | Added to every HTML page at serve time with the project's key. Same origin as Loki, so nothing to allowlist |
| Owner link | The project page's **Open your site** link carries the owner pass (`#loki-owner=…`). Send that link plus the code: their notes then start builds instead of waiting in the inbox (capped per project per day by `owner-build.ts`) |
| Tests | `scripts/test/previews.ts` (rules), `scripts/test/previews-route.ts` (every path through the route), `scripts/test/public-matcher.ts` (`/p/` public, `/p`, `/projects`, `/prompts` not) |

### To switch it on (once, on the box)

```bash
# /opt/loki/app/.env
LOKI_PREVIEW_CODE=aaaaaa11          # the studio's access code; change it here
LOKI_PREVIEWS_ROOT=/home/ubuntu/dev/previews   # optional; this is the default when LOKI_BOX_DEV_ROOT is set
```

Then restart `loki-app`. The folder root is created on the first preview.

## What comes next, per repository

### Loki (this repo)

1. **Graduation: "They said yes."** A button on a preview project that:
   creates the GitHub repository (the existing `provision` step), adds it as
   the folder's `origin` and pushes the history, sets `gitUrl`, then runs the
   existing client-site path (`register-site`, own domain, widget install). The
   folder stops being a preview; nothing is rebuilt.
2. **"Not interested."** Archive: the project is closed, the widget key
   revoked, the folder moved to `previews/.archive/` (kept, not served).
3. **The preview list.** Projects that are previews get a badge and a filter,
   with the status of each: built, sent, opened, notes received, yes, no.
4. **The shared site kit.** The parts every preview reuses (the audio player
   with waveforms, the video grid, the discography table, the booking block,
   image handling) as a small library copied into each folder at build time,
   so a fix to the kit reaches the next preview without a dependency on Loki.
5. **The check before anyone sees it.** The phone/desktop audit used on the
   first preview (sideways scroll, tap targets, stretched images, clipped
   text, empty grid cells) as a script the build agent must pass before it
   commits.

### Prospecting (Loki, later)

6. **A neighbourhood sweep.** Businesses in an area (Witikon first) from
   OpenStreetMap (free; tags whether a business has a website) and the Swiss
   company register (Zefix). For each one with a site, Loki's existing
   `site-consult` check scores it; the weak ones and the ones with no site get
   a preview. A list, not an auto-pitch: a person decides who to approach.
7. **Outreach rules**, written into the flow: one personal message per
   business, never a bulk send (UWG Art. 3 lit. o), and any "normally costs"
   price must be a real, provable reference (UWG and the price indication
   ordinance).

### OrangeCat and Solon

8. Nothing is needed for previews. A graduated client gets the usual OrangeCat
   project and, if they want governance, a Solon organisation. The Witikon
   local-association idea (a symbolic share of revenue to a Witikon Verein) is
   a Solon question and is planned there, not here.

### Box (bitbaum/fleet)

9. Set the two env lines above. If previews should live at their own address
   (`preview.orangecat.ch`), add a Caddy site that proxies to Loki's `/p/`. The
   app works without it.

## The access code

One code per operator, chosen in the app: the **Access code** field in *Build a
preview* (or said to the chat) is remembered in `user_preferences.preview_code`
and opens every preview that operator owns, old and new. No server edit. A
preview checks its owner's code first, then `LOKI_PREVIEW_CODE` in the server
env as the fallback; with neither, it refuses to be created rather than make a
preview nobody can open. Change it by typing a new one; every visitor who
entered the old one is asked again (the cookie carries a fingerprint of the
code).

## Ask Loki

In Loki's chat, "create website for Murphy's Bar" runs the `create_website` tool
(`src/lib/agent/tools/handlers.ts`): same `createPreview`, no dialog. The
answer is the link and the code to tell them.

## An address that never shows a browser error

A host with no vhost has no certificate, and a browser shows
`ERR_SSL_PROTOCOL_ERROR` for it. That was found on a phone four times, so three
things now stand behind every preview address:

1. **Creation proves it.** `createPreview` waits until the address answers
   over HTTPS (`waitForHost`) and reports `addressNote` plainly when it does
   not. It never says "done" on hope.
2. **`.github/workflows/previews.yml`** (`scripts/hetzner/ensure-preview.sh`):
   `create` makes a preview as the operator on the box (an optional `code` input sets the
   access code: masked in the logs, but a public repo shows a run's inputs, so
   delete the run right after) and fails the run unless its address
   answers; `heal` runs every six hours and re-attaches and re-checks every
   preview folder, so a lost vhost is put back before anyone opens the link.
3. **No code, still an answer.** A preview with no access code yet answers 503
   ("switched off"), which proves the address and certificate work. Set the
   code by saying "set the preview code to ..." in Loki's chat
   (`set_preview_code`) or in the Access code field.

## Its own address

Every preview is served at `/p/<address>/`, and when this server can set it up
it is also the whole of `<address>.orangecat.ch` (`francesco.orangecat.ch`).
That is what the prospect is sent: it reads like their own site, and the day
they buy a domain the move is `attach-domain.sh`, nothing else.

- **Wildcard DNS** (`*.orangecat.ch`) already points every label at the box, so
  there is no record to set. The Caddy vhost is the switch.
- `scripts/hetzner/attach-preview-host.sh <address>` writes
  `/etc/caddy/apps.d/preview-<address>.caddy` (`lib.sh` → `preview_vhost`),
  validates and reloads Caddy. It refuses reserved labels and any host the
  register already serves. `--detach` removes it. Pinned by
  `scripts/hetzner/test-preview-host.sh`.
- The vhost rewrites `/` to the entry file and everything else under
  `/p/<address>/`, and sends `X-Preview-Root: 1`. With that header Loki scopes
  the cookie to `/`, posts the gate to `/`, and loads the widget from Loki's own
  origin (a relative `/widget.js` would be asked of the preview). Without it
  nothing changes (`handle.ts`, `ROOTED_HEADER`).
- The widget token's origins include the new address, or its feedback would
  stop at the new host.
- When the server cannot do this itself, the preview still works at its
  `/p/` path and the creation result says why (`addressNote`).

## A site that already exists

"Build a preview" can take a finished site as a `.zip` (index.html at the top;
one wrapping folder is stripped). `src/lib/previews/unpack.ts` extracts it with
python's zipfile: no absolute or `..` paths, no symlinks, no `.git`, a byte
count that does not trust headers, 25 MB in, 150 MB out. It is committed to the
folder's own git history as it arrived and nothing is built. Pinned by
`scripts/test/preview-unpack.ts`.

## Improve a site that is live (/change)

"Improve this site" (and "Make my own, inspired by it") on `/change` makes a
preview too, not a repository (`src/lib/previews/from-website.ts`, since
2026-10-16 — before that every click created a GitHub repo and a kickoff that
told the agent to "treat the repository as possibly empty").

1. The free consultation reads the homepage **and the pages it links to**
   (`src/lib/site-consult/crawl.ts`: same site only, at most
   `CONSULT.crawlPages`, one overall time budget, every hop through the same
   SSRF-guarded fetch). Site-wide checks (links that lead nowhere, one title on
   many pages, pages that say almost nothing) join the per-page ones.
2. Loki says it as a conversation (`src/lib/site-consult/advice.ts`, rules,
   no model): what it read, the one thing to do first, what already works,
   then two one-tap questions (`CONSULT_QUESTIONS`) whose answers become brief
   lines from config, never browser text.
3. The build brief carries the page tour, the kept fixes and the answers, plus
   the preview rules — and asks for `improvements.html`, a tour of what changed
   with links to the live page and the new one, so the client SEES the
   improvement.
4. "Watch it work" shows the link, the code (one is created if the operator
   has none) and the tour, with a ready-to-paste message for the client.
5. A server with no preview folder falls back to the repository path.

## Create website for <name>

The whole flow, from "create website for Murphy's Bar":

1. The name, and the address it should have (`murphys-bar` unless told
   otherwise): one question at most.
2. `POST /api/previews { name, about, address }` (the Build a preview dialog).
   It makes the folder and local git history, the project (client work, so
   private), the widget token and owner link, attaches
   `<address>.orangecat.ch`, and hands the brief to the cloud builder.
3. The result is the address to send, opened with the access code, and the owner
   link whose notes start changes. No repository, no PR, nothing public.
4. "They said yes": record consent, then graduate (repository) and
   `attach-domain.sh` for their own domain.

## Rules that must not drift

- A preview never gets a GitHub repository or a public domain before the
  person says yes.
- The code is checked on every request, pages and files alike.
- Agents building a preview never push and never add a remote.
- Nothing on a preview is invented. Missing things are shown as "coming soon".
- A preview's project is client work from the moment it exists, so it stays
  off every public list until the person agrees to be shown
  (`docs/architecture/client-work-consent.md`).
