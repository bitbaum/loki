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
- **Private.** Every preview sits behind its operator's access code (one code
  opens every preview they own; `LOKI_PREVIEW_CODE` in the box env is the
  fallback). Nobody finds it by accident, the gate does not say whose site it
  is, and search engines are told not to index it.
- **Changeable by the person it is for.** Loki's feedback widget is on every
  page. Their notes start a build, the same way an owner's notes do on a live
  site.

## How it works today

| Piece | Where |
|---|---|
| Folders | `$LOKI_PREVIEWS_ROOT/<slug>/`, default `$LOKI_BOX_DEV_ROOT/previews/<slug>/` (`src/lib/previews/root.ts`) |
| Start one | Projects → **Build a preview**, or `POST /api/previews {name, about, address?, code?}` (+ a `.zip` as multipart) (`src/lib/previews/create.ts`); from a live site, `/change` → `POST /api/projects/from-website` (`src/lib/previews/from-website.ts`) |
| What start does | creates the folder + `git init`, a Loki project pointing at it (`dirPath`, no `gitUrl`, `liveUrl` = the preview), a widget key, and dispatches the build brief to the box |
| Build brief | `src/config/preview-brief.ts`: the standing rules (research only from public sources, no invented facts, "coming soon" for what is missing, relative paths, phone-first checks, images that never stretch, commit locally and never push) |
| Where it builds | Always the box: `projectChannelLock` locks preview folders to the cloud builder (`src/lib/execution-access.ts`) |
| Serving | `GET /p/<slug>/…` (`src/app/p/[slug]/[[...path]]/route.ts`, behaviour in `src/lib/previews/handle.ts`). It opens at `/p/<slug>/index.html` so the site's relative links resolve inside its folder |
| Access code | The operator's own (`user_preferences.preview_code`, set in the app), else `LOKI_PREVIEW_CODE` in the app's env. Change it and every earlier visitor is asked again. Neither = the preview answers "not open yet" |
| Widget | Added to every HTML page at serve time with the project's key; the widget token's origins include the preview's own address |
| The tour | `GET /p/<slug>/_loki/before-after` (`src/lib/previews/before-after-page.ts`): the live page and the new page photographed side by side, from the build's `improvements.json` (`src/lib/previews/improvements.ts`) over `.loki/source.json`. Pictures at `_loki/picture?side=before\|after&i=N`, taken by `lib/feedback/page-picture` on first ask and kept in `.loki/pictures/` |
| Loki's files | `.loki/` in the folder: what the preview was made from and its pictures. Git-ignored at creation, never served (dot segments are refused), not part of the site when it graduates |
| Owner link | The project page's **Open your site** link carries the owner pass (`#loki-owner=…`). Send that link plus the code: their notes then start builds instead of waiting in the inbox (capped per project per day by `owner-build.ts`) |
| Tests | `scripts/test/previews.ts` (rules), `scripts/test/previews-route.ts` (every path through the route, the tour and its pictures), `scripts/test/preview-improvements.ts` (the build's file, the rows, the page), `scripts/test/public-matcher.ts` (`/p/` public, `/p`, `/projects`, `/prompts` not) |

### To switch it on (once, on the box)

```bash
# /opt/loki/app/.env
LOKI_PREVIEW_CODE=aaaaaa11          # the studio's access code; change it here
LOKI_PREVIEWS_ROOT=/home/ubuntu/dev/previews   # optional; this is the default when LOKI_BOX_DEV_ROOT is set
```

Then restart `loki-app`. The folder root is created on the first preview. The
previews are served at `/p/<slug>/` and, when the box can attach a vhost, at
`<slug>.orangecat.ch` ("Its own address" below).

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

9. Set the two env lines above. Each preview gets its own address through
   `attach-preview-host.sh` ("Its own address" below); the app works at `/p/`
   without it.

## The access code

One code per operator, chosen in the app: the **Access code** field in *Build a
preview* (or said to the chat) is remembered in `user_preferences.preview_code`
and opens every preview that operator owns, old and new. No server edit. A
preview checks its owner's code first, then `LOKI_PREVIEW_CODE` in the server
env as the fallback. The chat and the dialog refuse to create one with neither
(`requireCode`); the box-side create and `/change` make one anyway — `/change`
mints a code for a person who has none and shows it on the next screen, and a
preview with no code answers "not open yet" until one is set. Change it by
typing a new one; every visitor who entered the old one is asked again (the
cookie carries a fingerprint of the code). A code is saved only once the
request has passed every check, so a refused create never logs out the
previews that exist.

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

## Moving a preview, and its right name

An address is chosen at creation, from a name typed in a hurry or from the old
site's domain, and that domain can itself be wrong: the store "Центр СОМ"
(Tsentr SOM) lives at center-com.ru because the Cyrillic letters were typed as
look-alike Latin ones, and its preview was born `center-com-3`.
`POST /api/previews/<address>/move` (`src/lib/previews/move.ts`, owner only,
`{ to, name? }`) moves the preview and its name together:

1. Everything that can refuse comes first: the new address is free on disk,
   the new name is free in the database.
2. The new address is attached. If that fails nothing else has changed.
3. The folder is renamed and the project row follows it (folder, slug,
   address, name, and the project's name everywhere it is shown) in one
   transaction. If the row cannot move, the folder moves back.
4. The widget's origins become the new address, and the old address is
   detached rather than left answering for a project that moved.

From Actions: `previews.yml` mode `move` (address, to, name). Mode `ask` (name =
the project, changes = the change) then tells the builder what to write, as
Send in the session box does.

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
   SSRF-guarded fetch). It reads the pages a visitor meets — navigation and
   header first, footer last, one page per section before the second of any —
   and leaves out accounts, baskets and the small print (privacy, terms,
   company details): on 2026-10-17 a shop's tour had been the login page, the
   policy and the bank details. Site-wide checks (links that lead nowhere, one
   title on many pages, pages that say almost nothing) join the per-page ones.
   The report is cached by the normalized address, so the build that follows
   finds it instead of reading the site again inside the request.
2. Loki says it as a conversation (`src/lib/site-consult/advice.ts`, rules,
   no model): what it read, the one thing to do first, what already works,
   then two one-tap questions (`CONSULT_QUESTIONS`) whose answers become brief
   lines from config, never browser text.
3. The build brief carries the page tour, the kept fixes and the answers, plus
   the preview rules — and says a preview is a first impression, not a
   migration: the homepage and the pages a visitor uses, at the live site's
   own paths, with the catalogue's main sections shown rather than migrated.
   It asks for `improvements.json` (one entry per change naming the live page
   and the new file, plus the engineer's account under the pull-request
   walkthrough's keys), never a freehand `improvements.html`.
4. The folder is born with `.loki/source.json` (the live site and the pages
   read), and Loki photographs those pages at once — the "before", while it
   still is one. "Watch it work" shows the link, the code (one is created if
   the operator has none), the **Before and after** link and the engineer's
   account, with a ready-to-paste message for the client.
5. The tour (`/_loki/before-after` on the preview, behind its code) shows each
   change as the live page and the new page photographed side by side on a
   phone-sized screen, the text the build wrote about it, what was not brought
   over, the questions for the owner, and the account. Pictures of the new
   pages are taken by Loki opening its own preview with the access cookie
   (`x-loki-picture: 1` tells the route to leave the widget out of the shot)
   and are keyed by the page's content, so a rebuilt page gets a new picture.
   Without `improvements.json` the tour still shows every live page the
   consultation read next to the file at the same path; without a browser on
   the server each picture collapses to a link.
6. A server with no preview folder falls back to the repository path.

The same path can be run from Actions without a browser: **Previews →
Run workflow → mode `website`** with the live address, the fixes and the
answers (`scripts/hetzner/preview-create-on-box.sh website …`, as the operator,
against the deployed app), and later **mode `check`** with the address opens
the preview as its owner (`preview-check-on-box.sh`: the cookie is minted on
the box and never printed) and reports the site, the tour, its rows and
whether the first pictures come back. That is how the flow is dogfooded end
to end.

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
- One name for one site, everywhere: the address, the project and — when it
  graduates — the repository are the same word (`centersom.orangecat.ch` →
  project `centersom` → `bitbaum/centersom`). Fix a wrong name by moving the
  preview BEFORE it graduates, never by graduating under the old one. The
  owner found `center-com`, `center-com-2` and `xhiva-art-refresh-<id>`
  beside `centersom` and `xhiva` (2026-10-19): the old build was retired
  offline (`apps.conf` status `archived`, which a full sync no longer
  regenerates) and its repository archived.
- The code is checked on every request, pages and files alike.
- Agents building a preview never push and never add a remote. Every dispatch
  to a preview folder says so (`src/lib/previews/delivery-note.ts`, "Where
  this goes"), and the box contract repeats it — the contract's "invisible
  until you push" is for repositories, and an agent that followed it here
  reported a live change as undelivered (2026-10-18).
- Nothing on a preview is invented. Missing things are shown as "coming soon".
- A preview's project is client work from the moment it exists, so it stays
  off every public list until the person agrees to be shown
  (`docs/architecture/client-work-consent.md`).
- A preview is built to a design standard, not only to correctness, and its
  builder looks at every page before it says done: screenshots at 390 and
  1440 px with the box's headless Chromium, judged against the standard
  (`src/config/preview-brief.ts`). Center SOM passed every correctness rule
  and its owner still called it cramped: text ran to the screen's edge and the
  headline was a five-line search-engine title (2026-10-18).
- A screenshot sent about a preview, from the Loki chat or the session box,
  reaches its builder as the image itself (the runner writes it to a file the
  agent opens), never only as a vision model's description of it.
