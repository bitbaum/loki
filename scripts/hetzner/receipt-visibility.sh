#!/usr/bin/env bash
# Resolve whether a reusable self-host deploy should publish its package receipt.
# Public deployments fail closed if GitHub cannot establish visibility: a green
# deploy without the evidence needed for package promotion would be misleading.
set -euo pipefail

requested=${1:-auto}
repository=${2:-${GITHUB_REPOSITORY:-}}

case "$requested" in
  public) visibility=false ;;
  private) visibility=true ;;
  auto)
    if [[ -z "$repository" ]]; then
      echo "::error::GITHUB_REPOSITORY is required when receipt visibility is auto"
      exit 1
    fi
    visibility=$(gh api "repos/$repository" --jq '.private' 2>/dev/null || true)
    ;;
  *)
    echo "::error::receipt-visibility must be auto, public, or private"
    exit 1
    ;;
esac

if [[ "$visibility" == true ]]; then
  echo 'public=false' >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT must be set}"
  echo 'Public receipt omitted: repository is private.'
elif [[ "$visibility" == false ]]; then
  echo 'public=true' >> "${GITHUB_OUTPUT:?GITHUB_OUTPUT must be set}"
else
  echo '::error::Could not establish repository visibility; refusing a deploy without its required receipt. Set receipt-visibility explicitly in the app workflow.'
  exit 1
fi
