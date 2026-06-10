#!/usr/bin/env bash
# tunnel-ollama.sh — start a Cloudflare quick tunnel to local Ollama and push the URL to Railway
#
# Usage:
#   ./tunnel-ollama.sh          # start tunnel, update Railway, keep running in foreground
#   ./tunnel-ollama.sh --no-railway   # start tunnel only, skip Railway update

set -euo pipefail

OLLAMA_PORT="${OLLAMA_PORT:-11434}"
# BSD mktemp needs the X's at the END of the template — a suffix after them
# makes it create the literal filename instead of substituting
LOG=$(mktemp /tmp/cf_tunnel.XXXXXX)
NO_RAILWAY=false

for arg in "$@"; do
  [[ "$arg" == "--no-railway" ]] && NO_RAILWAY=true
done

# Kill any existing cloudflared tunnel to Ollama
existing=$(pgrep -f "cloudflared tunnel --url http://.*:${OLLAMA_PORT}" 2>/dev/null || true)
if [[ -n "$existing" ]]; then
  echo "Stopping existing tunnel (PID $existing)..."
  kill "$existing" 2>/dev/null || true
  sleep 1
fi

echo "Starting Cloudflare tunnel → http://127.0.0.1:${OLLAMA_PORT} ..."
cloudflared tunnel --url "http://127.0.0.1:${OLLAMA_PORT}" --no-autoupdate >"$LOG" 2>&1 &
CF_PID=$!

# Wait for the tunnel URL to appear in the log.
# sed, not grep: the system grep may be ugrep, which has come up empty
# reading this log while cloudflared is still writing to it.
TUNNEL_URL=""
for i in $(seq 1 30); do
  TUNNEL_URL=$(sed -nE 's#.*(https://[a-z0-9-]+\.trycloudflare\.com).*#\1#p' "$LOG" 2>/dev/null | head -1 || true)
  [[ -n "$TUNNEL_URL" ]] && break
  if ! kill -0 "$CF_PID" 2>/dev/null; then
    echo "ERROR: cloudflared died during startup. Last log lines:"
    tail -5 "$LOG"
    exit 1
  fi
  sleep 1
done

if [[ -z "$TUNNEL_URL" ]]; then
  # Tunnel may be perfectly healthy — never kill it just because we
  # couldn't parse the URL. Leave it running and point at the log.
  echo "ERROR: Could not extract tunnel URL after 30s, but cloudflared is still running (PID $CF_PID)."
  echo "Find the URL manually: grep trycloudflare $LOG"
  exit 1
fi

echo "Tunnel live: $TUNNEL_URL"

# Verify it actually reaches Ollama. Local DNS blackholes trycloudflare.com
# on this LAN (blocklist), so resolve the edge IP via public DNS and pin it —
# Railway resolves from its own datacenter, so local NXDOMAIN doesn't matter.
TUNNEL_HOST="${TUNNEL_URL#https://}"
EDGE_IP=$(dig @1.1.1.1 +short +time=3 "$TUNNEL_HOST" 2>/dev/null | head -1 || true)
echo -n "Verifying Ollama reachable through tunnel${EDGE_IP:+ (edge IP ${EDGE_IP} pinned via 1.1.1.1)}... "
for i in $(seq 1 10); do
  if [[ -n "$EDGE_IP" ]]; then
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 --resolve "${TUNNEL_HOST}:443:${EDGE_IP}" "${TUNNEL_URL}/v1/models" 2>/dev/null || true)
  else
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "${TUNNEL_URL}/v1/models" 2>/dev/null || true)
  fi
  if [[ "${status:-000}" == "200" ]]; then
    echo "OK"
    break
  fi
  if [[ $i -eq 10 ]]; then
    echo "FAILED (HTTP ${status:-000} after 10 attempts). Tunnel may need more time."
  fi
  sleep 3
done

# Update Railway
if [[ "$NO_RAILWAY" == false ]]; then
  if command -v railway &>/dev/null; then
    echo "Updating Railway OLLAMA_URL..."
    railway variables --set "OLLAMA_URL=${TUNNEL_URL}/v1/chat/completions"
    echo "Railway updated."
  else
    echo "railway CLI not found — set OLLAMA_URL manually: ${TUNNEL_URL}/v1/chat/completions"
  fi
else
  echo "Skipping Railway update (--no-railway)."
  echo "OLLAMA_URL=${TUNNEL_URL}/v1/chat/completions"
fi

echo ""
echo "Tunnel running (PID $CF_PID). Ctrl-C to stop."
echo "Log: $LOG"

# Keep script alive so the tunnel stays up; clean exit on Ctrl-C
trap "echo 'Stopping tunnel...'; kill $CF_PID 2>/dev/null; exit 0" INT TERM
wait "$CF_PID"
