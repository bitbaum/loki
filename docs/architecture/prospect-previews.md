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

## Rules that must not drift

- A preview never gets a GitHub repository or a public domain before the
  person says yes.
- The code is checked on every request, pages and files alike.
- Agents building a preview never push and never add a remote.
- Nothing on a preview is invented. Missing things are shown as "coming soon".
