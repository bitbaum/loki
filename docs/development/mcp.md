# Loki as an MCP server

---
created_date: 2026-09-28
last_modified_date: 2026-09-28
last_modified_summary: First version — remote MCP endpoint, OrangeCat OAuth, six tools.
---

AI apps can message Loki directly and have it act: claude.ai and ChatGPT
connectors, Claude Code, Cursor, anything that speaks the Model Context
Protocol over HTTP. They reach Loki at one URL:

```
https://loki.orangecat.ch/api/mcp
```

The resource URL, the scopes, which tool needs which scope and the protocol
revisions are SSOT in `src/config/mcp.ts`. This page explains them; it does not
restate the values a second time where the code can be read instead.

## Connecting

**claude.ai** — Settings → Connectors → *Add custom connector* → paste
`https://loki.orangecat.ch/api/mcp`. Claude discovers OrangeCat, you sign in
there and approve the scopes, and Loki appears in the tools menu.

**ChatGPT** — Settings → Apps & Connectors → Advanced → enable *Developer
mode*, then *Create* a connector with the same URL and OAuth authentication.

**Claude Code** — with an agent token from Loki → Settings → Agent → Agent
Tokens:

```bash
claude mcp add --transport http loki https://loki.orangecat.ch/api/mcp \
  --header "Authorization: Bearer ck_…"
```

**Cursor** — `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "loki": {
      "url": "https://loki.orangecat.ch/api/mcp",
      "headers": { "Authorization": "Bearer ck_…" }
    }
  }
}
```

Leave the header out and Cursor runs the same OAuth sign-in as the connector UIs.

## How authentication works

OrangeCat is the authorization server; Loki is only a resource server. Loki
never shows a sign-in page of its own to an MCP client and never stores a
client registration.

1. The client POSTs `initialize` with no token. Loki answers **401** with
   `WWW-Authenticate: Bearer resource_metadata="https://loki.orangecat.ch/.well-known/oauth-protected-resource", scope="loki.chat loki.act"`.
2. The client reads that document (RFC 9728, also served at
   `/.well-known/oauth-protected-resource/api/mcp`), which names OrangeCat as
   the authorization server, and runs OAuth there with
   `resource=https://loki.orangecat.ch/api/mcp` (RFC 8707).
3. OrangeCat issues an RS256 JWT: `iss` = OrangeCat, `aud` = the Loki resource
   URL, `sub` = the person's OrangeCat actor, `scope` = what they approved.
4. Loki verifies it against `${issuer}/oauth/jwks.json` (cached ten minutes,
   refetched once when a new `kid` appears), checks issuer, **audience** and
   expiry, and maps `sub` to the Loki user carrying that actor id.

The audience check is the one that must never loosen. OrangeCat mints tokens
for other clients too, all validly signed; only `aud` says a token was meant
for Loki. A token whose audience is a client id is refused.

A `Bearer ck_…` agent token skips OAuth and carries both scopes — the same
access the token already gives the Telegram skill and the Fleet Runner.

A valid OrangeCat token for someone who has never used Loki still connects,
and every tool answers with the one step that fixes it: sign in to Loki once
with OrangeCat at `https://loki.orangecat.ch/sign-in`. That sign-in is what
writes the actor id onto a Loki user.

A missing or invalid token is a 401 with the challenge above, plus
`error="invalid_token"` when a token was presented. If OrangeCat's keys cannot
be fetched the answer is 503, not 401 — the caller's token is not the problem,
and a 401 would send the client back through OAuth for nothing.

## Scopes and tools

| Tool | Scope | What it does |
|------|-------|--------------|
| `ask_loki` | `loki.chat` | Ask Loki anything about the owner's projects, fleet, people, commitments, schedule. `conversation_id` keeps a thread. |
| `loki_pending_approvals` | `loki.chat` | What is waiting in the approval queue. |
| `loki_projects` | `loki.chat` | Registered projects with a one-line status — the names `loki_dispatch` accepts. |
| `loki_dispatch` | `loki.act` | Send a coding task to a project's agent. The outcome arrives later as a notification. |
| `loki_book` | `loki.act` | Propose a calendar event through the approval queue; reports `auto-approved` or `awaiting-approval` truthfully. |
| `loki_decide` | `loki.act` | Approve or reject one queued action. Approving executes it. |

A tool called without its scope answers with an MCP tool error naming the
scope, so the model can tell the person what to re-grant.

`loki.chat` is enforced inside the conversation too: `ask_loki` for a
chat-only grant runs Loki's tool loop without its propose tools and skips the
OpenClaw gateway fallback, whose own skills act with the operator's token. A
chat-only app can read; it cannot get Loki to act by asking it to.

## The security boundary

A connected app can do exactly what its tools allow, and no more — but it can
do all of that. Specifically:

- **Act tools go through the approval queue, exactly like the Telegram skill.**
  `loki_book` enqueues through the same producer as `/api/actions/propose`;
  `loki_dispatch` calls the same `injectPrompt` as `/api/inject`;
  `loki_decide` calls the same `decideAction` as `/api/actions/[id]/decision`.
  Standing approvals the owner set apply here as they do there.
- **`loki_decide` is the owner's approval.** An app holding `loki.act` can
  approve a queued action, which executes it. That is the same power the
  Telegram skill has, granted to whichever app the owner approved on
  OrangeCat's consent screen. Rejections record a `via: "mcp"` audit entry with
  the OAuth client id.
- **Agent tokens are full access.** Treat a `ck_…` pasted into an MCP config
  like a password; revoke it in Settings → Agent when a machine is retired.
- **The demo account cannot use MCP** — the route denies it
  (`DEMO_HANDLER_ENFORCED` in `src/config/demo.ts`).
- **Model turns are rationed** by the same per-user AI budget as the web chat;
  a refusal comes back as the sentence Loki would show in the app.

## Protocol notes

Streamable HTTP, stateless: every `POST` is answered with one
`application/json` body, no `Mcp-Session-Id` is issued, and `GET`/`DELETE`
return 405. Supported revisions: see `MCP_PROTOCOL_VERSIONS`; `initialize`
echoes the client's when supported, otherwise offers the newest. Notifications
return 202. JSON-RPC batches (older clients) are accepted up to ten messages.

Code: `src/app/api/mcp/route.ts` (thin), `src/lib/mcp/` (protocol, auth, JWT,
tools, services), `scripts/test/mcp-server.ts` (the pure suite).
