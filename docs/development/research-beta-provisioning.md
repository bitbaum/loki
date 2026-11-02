# Analysis beta — one-time Fleet registration

The user-facing product name has **not been decided**. The existing
`bitbaum/biaslens` repository and `biaslens` host key are temporary,
internal implementation identifiers. When the chosen name/logo is supplied,
change the canonical Loki project profile and the app's
`src/lib/config/brand.ts` presentation configuration; do not destroy Git
history or rename the database as a prerequisite for shipping.

## Provisioning owner and safeguards

This work uses the existing studio script
`scripts/hetzner/register-site.sh`, which is the single owner of port
allocation, canonical apps.conf writes, Caddy and systemd configuration,
reusable deploy secret and box-owned runtime environment.

The restricted bootstrap workflow
`.github/workflows/provision-analysis-beta.yml` has a fixed target:
`bitbaum/biaslens` at `biaslens.orangecat.ch`. It runs only by manual
dispatch. It does not allow arbitrary repository/host inputs. It checks
existing registration before making changes, and calls the existing
rollback-aware deploy.

It registered biaslens on 2026-10-22. Since then biaslens has deployed itself
through its own `deploy.yml` (loki `selfhost-deploy.yml`, behind the fleet
rollout gate, where it is AccountKit's canary). Until 2026-11-02 this workflow
also ran after every green Loki CI on main. That redeployed biaslens out of
band through `scripts/hetzner/deploy.sh`, which fails without the CI runtime
files, so it failed on every main commit. Dispatch it only to re-bootstrap a
box that has lost the app.

## Acceptance

Registration and building do not establish that the AI backend works.
The public `/api/health` endpoint distinguishes the app responding from
provider keys merely being present; those keys are never echoed.

A genuine usable beta requires:

1. Successful GitHub registration workflow AND public HTTPS smoke.
2. A confirmed GROQ_API_KEY or OPENROUTER_API_KEY in
   `/opt/biaslens/shared/.env`, set with approved studio secret management.
3. A real article URL → AI result smoke test, with correct unverified labels.
4. The canonical Loki profile and Fleet map showing one product, not new
   duplicate roadmap/changelog documents.

If any of the above fails, retain the explicit blocker. Never claim the
site is served because the repository CI or Next build passed.
