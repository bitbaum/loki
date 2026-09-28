#!/usr/bin/env bash
# Teach the chat agent to SEE: screenshots, photos and videos sent on Telegram.
#
# WHY THIS EXISTS. The Telegram agent is OpenClaw on bitbaum, and OpenClaw
# already has inbound media understanding — an attachment is described by a
# vision model before the chat model reads the turn. But it ran on defaults,
# and the defaults are wrong for how George uses it:
#
#   - every description is cut at 500 characters. A screenshot of a chat, an
#     error or a settings page loses most of its text, so "look at this and do
#     something" became "look at a summary of this and guess";
#   - one attachment per message, so a Telegram album of screenshots was read
#     as its first picture;
#   - video is only described if some video-capable key happens to be found,
#     with a 500-char, "Describe the video." prompt — nothing to argue with
#     when he asks whether a clip is nonsense.
#
# The block lives in this repo (media-understanding.json) so it is versioned
# and reviewable, and this script is the only way it reaches the box — the same
# rule as install-loki-skill.sh, for the same reason: config that exists only
# on the box drifts without anyone seeing it.
#
# ONLY image and video are written. `tools.media.audio` is left exactly as it
# is: voice notes already transcribe, and overwriting a working STT chain to
# make this file tidier would trade a feature for symmetry.
#
# Model: Gemini (provider `google`, its default model — so an OpenClaw upgrade
# moves it forward without an edit here). It is the provider OpenClaw ranks
# first for video, and it hears the audio track, so a video's speech arrives
# as a transcript alongside what is on screen. Needs GEMINI_API_KEY (or
# GOOGLE_API_KEY) where the gateway reads env: ~/.openclaw/.env or
# ~/.config/openclaw/gateway.env for the openclaw user. A free key is at
# https://aistudio.google.com/apikey.
#
# LIMIT THIS DOES NOT LIFT: Telegram's cloud Bot API will not hand a bot a file
# over 20 MB, so longer videos arrive as "file is too big". Lifting it means a
# self-hosted Bot API server (channels.telegram.apiRoot) — a separate change.
#
# Usage: bash scripts/openclaw/install-media-understanding.sh [user@host]
set -euo pipefail
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

HOST="${1:-ubuntu@167.233.22.31}"
SRC="scripts/openclaw/media-understanding.json"
STAGE="/tmp/openclaw-media-$$"

[ -f "$SRC" ] || { echo "✗ $SRC missing"; exit 1; }
IMAGE_JSON=$(node -e 'process.stdout.write(JSON.stringify(require(process.argv[1]).image))' "$PWD/$SRC")
VIDEO_JSON=$(node -e 'process.stdout.write(JSON.stringify(require(process.argv[1]).video))' "$PWD/$SRC")

# Every remote step runs as the openclaw user with a login shell: that is the
# user whose ~/.openclaw the gateway reads, and whose PATH has the CLI. The
# runtime dir is set so `gateway restart` can reach the user's systemd.
as_openclaw() {
  ssh "$HOST" "sudo -iu openclaw env XDG_RUNTIME_DIR=/run/user/\$(id -u openclaw) bash -lc $(printf '%q' "$1")"
}

echo "→ checking the gateway can reach Gemini"
# Checked BEFORE writing anything. Without a key the config is accepted, the
# gateway restarts cleanly, and every picture is silently not described — the
# failure this file exists to end. So no key means no install.
if ! as_openclaw 'grep -qsE "^(export )?(GEMINI_API_KEY|GOOGLE_API_KEY)=.+" ~/.openclaw/.env ~/.config/openclaw/gateway.env'; then
  echo "✗ no GEMINI_API_KEY / GOOGLE_API_KEY for the openclaw user on $HOST."
  echo "  Add one line to /home/openclaw/.openclaw/.env:"
  echo "    GEMINI_API_KEY=<key from https://aistudio.google.com/apikey>"
  echo "  then re-run this script."
  exit 1
fi
echo "  a Google key is configured"

echo "→ writing tools.media.image and tools.media.video"
# `config set` backs the file up, validates against the installed OpenClaw's
# own schema and refuses a bad value — so a key this version does not know
# fails here, not at the next gateway start.
as_openclaw "openclaw config set tools.media.image $(printf '%q' "$IMAGE_JSON") --strict-json --merge"
as_openclaw "openclaw config set tools.media.video $(printf '%q' "$VIDEO_JSON") --strict-json --merge"
as_openclaw "openclaw config validate" \
  || { echo "✗ openclaw.json no longer validates — restore it from openclaw.json.bak before the gateway restarts"; exit 1; }

echo "→ restarting the gateway"
as_openclaw "openclaw gateway restart"
sleep 5
as_openclaw "openclaw gateway status" >/dev/null \
  || { echo "✗ the gateway did not come back — check: sudo -iu openclaw openclaw gateway status"; exit 1; }
echo "  gateway is up"

echo "→ proving it sees"
# The check that matters: run the real describe path as the real user and
# require an answer about a picture whose content we know. A config that is
# present but never answers is exactly the state this replaces.
ssh "$HOST" "rm -rf $STAGE && mkdir -p $STAGE && chmod 755 $STAGE"
ssh "$HOST" "python3 - $STAGE/red.png" <<'PY'
import struct, sys, zlib
w = h = 64
raw = b"".join(b"\x00" + b"\xff\x00\x00" * w for _ in range(h))
def chunk(t, d):
    return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
png = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0)) \
    + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")
open(sys.argv[1], "wb").write(png)
PY
image_out=$(as_openclaw "openclaw infer image describe --file $STAGE/red.png" 2>&1 || true)
if printf '%s' "$image_out" | grep -qi "red"; then
  echo "  image: described a red test square as red"
else
  ssh "$HOST" "rm -rf $STAGE"
  echo "✗ image understanding did not answer. Output:"
  printf '%s\n' "$image_out" | tail -5 | sed 's/^/    /'
  exit 1
fi

# Video needs ffmpeg on the box only to MAKE the test clip. Without it the
# video path is configured but unproven — said out loud, never passed quietly.
if ssh "$HOST" "command -v ffmpeg >/dev/null"; then
  ssh "$HOST" "ffmpeg -loglevel error -f lavfi -i color=c=blue:s=160x120:d=2 -pix_fmt yuv420p $STAGE/blue.mp4 && chmod 644 $STAGE/blue.mp4"
  video_out=$(as_openclaw "openclaw infer video describe --file $STAGE/blue.mp4" 2>&1 || true)
  if printf '%s' "$video_out" | grep -qi "blue"; then
    echo "  video: described a blue test clip as blue"
  else
    ssh "$HOST" "rm -rf $STAGE"
    echo "✗ video understanding did not answer. Output:"
    printf '%s\n' "$video_out" | tail -5 | sed 's/^/    /'
    exit 1
  fi
else
  echo "  ⚠ video: configured but NOT proven — no ffmpeg on $HOST to make a test clip."
  echo "    Send the bot a short video and check it describes it."
fi
ssh "$HOST" "rm -rf $STAGE"

echo "✓ the Telegram agent now reads screenshots, photos and videos (≤20 MB) on $HOST"
