# A site's own domain

Every site starts on a free address, `<slug>.orangecat.ch`. When its owner buys
a domain, that domain becomes the site's address:

- the domain is served, and so is `www.<domain>` when it points here too;
- the free address keeps working and answers with a **308** to the domain, so
  old links still arrive, and nothing a visitor sees says where the site is
  hosted;
- the project's live URL and production URL become `https://<domain>`;
- the feedback widget's origin list gains the new address (a union, never a
  replacement — the same rule `widget-token/install` follows).

The site stays a Loki project on the same box, managed the same way. Its
repository is untouched: the address is hosting, not code.

## Why it works this way

**One repository per site, hosted by us until handed over.** OrangeCat used to
serve sites itself, with their own domains, and took that out on 2026-08-27
(`orangecat/supabase/migrations/20260827130000_drop_hosted_sites_policy.sql`:
"a site is its own repository, deployed on its own… OrangeCat is not the
host"). ADR-0003 asks that every site be deliverable "with zero OrangeCat
dependency". A site that lived inside OrangeCat would need to be extracted
before it could leave; a site in its own repo only needs its `deploy.yml`
removed. So a domain is a property of where a site is served, and it is set
in the hosting register, not in any product's code.

**308, never 301.** A 301 lets the client turn a POST into a bodyless GET. That
broke evig's sign-in behind its old host on 2026-08-16.

**DNS is checked before anything changes.** Caddy requests a certificate as
soon as a host appears in a vhost. A host whose DNS points elsewhere fails the
challenge and is retried with backoff for hours — while the free address
already redirects to it. So a domain that does not resolve to the box is
refused, and the owner is shown the records to set.

## How to use it

In Loki: open the project → **Own domain** (next to the live site link) → type
the domain → **Check**. The panel shows the records to set at the registrar
and whether they are set yet. Once they are, **Connect**. To go back, the same
panel has **Go back to `<slug>.orangecat.ch`**.

The records:

| Domain           | Record                                 |
| ---------------- | -------------------------------------- |
| `evig.ch` (apex) | `A evig.ch → 167.233.22.31`            |
|                  | `CNAME www.evig.ch → evig.orangecat.ch` |
| `shop.evig.ch`   | `CNAME shop.evig.ch → evig.orangecat.ch` |

An AAAA (IPv6) record pointing anywhere but the box is refused: Let's Encrypt
would validate over IPv6 and fail.

On the box, the same thing by hand:

```bash
bash scripts/hetzner/attach-domain.sh evig evig.ch      # attach (or move to another domain)
bash scripts/hetzner/attach-domain.sh evig --detach     # back to the free address
bash scripts/hetzner/attach-domain.sh evig evig.ch --dry-run
```

Exit codes: `0` done and answering · `1` refused · `3` DNS not pointing here
(nothing changed) · `4` changed, but the certificate is still being issued.

## Where each piece lives

| Piece | File |
| ----- | ---- |
| What the `domains` field means (which host is canonical, which redirect) | `scripts/hetzner/lib.sh` → `caddy_vhost` |
| DNS check, register edit, sync | `scripts/hetzner/attach-domain.sh` |
| The rules the owner sees (records, verdict) | `src/lib/site-domain.ts` |
| Running the script, recording the URL | `src/lib/site-domain-attach.ts` |
| API | `src/app/api/projects/[id]/domain/route.ts` |
| Panel | `src/components/projects/OwnDomainButton.tsx` |
| Tests | `scripts/hetzner/test-custom-domain.sh`, `scripts/test/site-domain.ts` |

## Limits

- **Studio box only.** Like registration, the app runs the script itself only
  for accounts the shared box serves (`cloudBuilderAllowed`). Everyone else is
  shown the command.
- **Handcrafted services (ports 4001–4004) are refused.** Their Caddy blocks are
  written by hand in `/etc/caddy/Caddyfile`, and a generated block for the same
  host would fail `caddy validate` and stop every app's reload. **evig is one
  of them** (`evig|4004|…`): give it `evig.ch` by editing its block in the
  Caddyfile (add `evig.ch, www.evig.ch` to the served hosts and a
  `redir https://evig.ch{uri} 308` block for `evig.orangecat.ch,
  revampit.orangecat.ch`), or move the block into `apps.d` first, after which
  the script handles it.
- **The site's own code may still name its free address.** The site template
  bakes `metadataBase: new URL("https://<slug>.orangecat.ch")` into
  `app/layout.tsx`, and a site that signs people in with OrangeCat has its
  redirect URIs registered against the free host. After connecting a domain,
  update both: the first is a one-line change in the site's repo, the second
  is `orangecat/scripts/oauth/register-client.ts`. Until then the site works,
  but its canonical links point at the free address.
- **One own domain per site** (plus its `www.`). Connecting a second one moves
  the site; the first stops being served.
