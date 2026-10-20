#!/usr/bin/env bash
# install-sealed-builds.sh — what a private builder needs to run each build in
# its own container (docs/master-plan-2026-10.md, Track 4.2): rootless podman,
# gVisor's runsc where it installs, and the agent image in a shared read-only
# store. Idempotent; warn-only; re-run by every deploy. It never switches a
# tenant to sealed builds by itself — it prints READINGS, and
# scripts/hetzner/new-tenant.sh turns sealing on for a tenant only when the
# readings say the box can (`loki-sealed-builds: ready`).
#
# Why no docker group: a user in it is root on the box. Rootless podman gives
# each tenant a container of its own with nothing of root's.
#
# Usage: bash scripts/hetzner/install-sealed-builds.sh [user@host]
set -euo pipefail
. "$(dirname "$0")/_box-env.sh"   # SSOT: HETZNER_IP, BOX_ROOT, BOX_UBUNTU
HOST="${1:-$BOX_ROOT}"
RUNNER_DIR="/opt/loki/runner"

ssh -o BatchMode=yes "$HOST" "RUNNER_DIR='$RUNNER_DIR' bash -s" <<'REMOTE'
set -uo pipefail
STATE=/etc/loki/sealed-builds
mkdir -p "$(dirname "$STATE")"
ready=1
note() { echo "  $*"; }

# 1. podman, rootless. Ubuntu's own package; slirp4netns/pasta for networking.
if ! command -v podman >/dev/null 2>&1; then
  if apt-get install -y -qq podman uidmap slirp4netns fuse-overlayfs >/dev/null 2>&1; then
    note "✓ podman installed"
  else
    note "⚠ podman could not be installed (apt)"; ready=0
  fi
else
  note "✓ podman $(podman --version 2>/dev/null | awk '{print $3}')"
fi

# 2. gVisor's runsc, best effort: a user-space kernel between the agent and
#    the host, no KVM needed (the CX43 has none). Without it builds still
#    seal in a container; the unit simply asks for no runtime.
if ! command -v runsc >/dev/null 2>&1; then
  if curl -fsSL https://gvisor.dev/archive.key 2>/dev/null | gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg 2>/dev/null \
     && echo "deb [arch=amd64 signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" > /etc/apt/sources.list.d/gvisor.list \
     && apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq runsc >/dev/null 2>&1; then
    note "✓ runsc installed"
  else
    note "⚠ runsc not installed — builds seal in a plain container"
    rm -f /etc/apt/sources.list.d/gvisor.list
  fi
else
  note "✓ runsc $(runsc --version 2>/dev/null | head -1 | awk '{print $NF}')"
fi

# 3. The agent image, built by root into a shared store every tenant's
#    rootless podman reads (additionalimagestores), so no tenant pulls or
#    builds anything and the image is read-only to all of them.
STORE=/opt/loki/agent-image/store
SRC="$RUNNER_DIR/scripts/agent-image/Containerfile"
BUILD_LOG=/var/log/loki-sealed-builds.log
if command -v podman >/dev/null 2>&1 && [ -f "$SRC" ]; then
  mkdir -p "$STORE"
  stamp="$(sha256sum "$SRC" | cut -c1-12)"
  if [ "$(cat /opt/loki/agent-image/.built 2>/dev/null)" != "$stamp" ]; then
    # The build runs on a storage.conf of its OWN. The global one (written
    # below) lists $STORE as an ADDITIONAL, read-only store for every tenant;
    # a root build INTO $STORE that read it would have the store reference
    # itself. Its output is kept: 2026-10-20 the first two deploys said only
    # "did not build", and nothing on the box could say why.
    cat > /opt/loki/agent-image/storage.conf <<CONF
[storage]
driver = "overlay"
graphroot = "$STORE"
runroot = "/run/loki-agent-image"
CONF
    # --network=host for the BUILD only: Docker, also on this box, sets the
    # firewall's FORWARD policy to DROP, which strands a rootful podman bridge
    # — deploy 2623's log showed apt-get fetching no package index at all.
    # Tenants' sealed containers run rootless with user-mode networking
    # (slirp4netns/pasta), which that chain never sees.
    if CONTAINERS_STORAGE_CONF=/opt/loki/agent-image/storage.conf \
         podman build --network=host -t loki-agent:latest -f "$SRC" "$(dirname "$SRC")" >"$BUILD_LOG" 2>&1; then
      echo "$stamp" > /opt/loki/agent-image/.built
      note "✓ loki-agent image built"
    else
      note "⚠ loki-agent image did not build — the end of $BUILD_LOG:"
      tail -n 15 "$BUILD_LOG" | sed 's/^/      /'
      ready=0
    fi
  else
    note "✓ loki-agent image current"
  fi
  mkdir -p /etc/containers
  if ! grep -q "$STORE" /etc/containers/storage.conf 2>/dev/null; then
    cat > /etc/containers/storage.conf <<CONF
[storage]
driver = "overlay"
[storage.options]
additionalimagestores = ["$STORE"]
CONF
    note "✓ shared image store configured"
  fi
else
  ready=0
fi

if [ "$ready" = 1 ]; then
  { echo "ready"; command -v runsc >/dev/null 2>&1 && echo "runsc"; } > "$STATE"
  note "loki-sealed-builds: ready$(command -v runsc >/dev/null 2>&1 && echo ' (gVisor)')"
else
  echo "not-ready" > "$STATE"
  note "loki-sealed-builds: not ready — tenants keep building unsealed"
fi
REMOTE
