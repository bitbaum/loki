# Security Policy

Loki is a hybrid system: the hosted app stores account, project, and product
state; a builder (the eligible cloud builder, or the Fleet Runner on the user's
machine) executes terminal, git, and agent work. Security work should preserve
that boundary.

## Supported Surface

- Production app: `https://loki.orangecat.ch` (self-hosted on the Hetzner `bitbaum` box, Caddy in front)
- Default branch: `main`
- Runtime bridge: per-user `ck_*` agent tokens
- Database: PostgreSQL through direct and pooled URLs

## Reporting

This repository is **public**. Do not open a public issue for a suspected
vulnerability — report it privately, either through GitHub's private
vulnerability reporting (Security → Report a vulnerability) or by email to
cato@orangecat.ch, with:

- affected route, component, script, or workflow
- reproduction steps
- impact and required privileges
- whether the issue affects hosted cloud, local daemon, or both

Do not include real secrets, production tokens, or personal user data in reports.

## Security Expectations

- No secrets in Git. Use `.env.example` as the public contract.
- Validate all API input with zod or explicit route guards.
- Keep shell execution behind trusted server/runtime boundaries.
- Never pass user-derived strings to `runTool` or shell commands without a
  specific parser/escaping strategy.
- Prefer per-user `ck_*` agent tokens over shared daemon tokens.
- Shared daemon tokens require explicit server-side opt-in.
- Preserve tenant scoping on every persisted runtime and project-state write.
- Treat the local daemon as powerful: it can access the user's terminal and
  filesystem through intended workflows.

## Dependency Hygiene

GitHub Actions runs a scheduled `pnpm audit --audit-level=high`. High and
critical vulnerabilities must be fixed or explicitly documented before a release.
Moderate dev-tool findings can be deferred only when they are not reachable in
production runtime paths.
