#!/usr/bin/env bash
# tunnel-ollama.sh — start a Cloudflare quick tunnel to the local Ollama proxy
# and push the URL to Railway
#
# The tunnel points at ollama-proxy.mjs (port 11435), NOT at Ollama itself
# (11434). Ollama has no auth, so exposing it directly would publish
# /api/pull and /api/delete to anyone holding the URL. The proxy allows only
# the two routes the game calls and requires ROMANCE_PROXY_KEY.
#
# Usage:
#   ./tunnel-ollama.sh          # start proxy + tunnel, update Railway, stay in foreground
#   ./tunnel-ollama.sh --no-railway   # start proxy + tunnel only, skip Railway update

set -euo pipefail

cd "$(dirname "$0")"

OLLAMA_PORT="${OLLAMA_PORT:-11434}"
PROXY_PORT="${PROXY_PORT:-11435}"
# BSD mktemp needs the X's at the END of the template — a suffix after them
# makes it create the literal filename instead of substituting
LOG=$(mktemp /tmp/cf_tunnel.XXXXXX)
PROXY_LOG=$(mktemp /tmp/ollama_proxy.XXXXXX)
NO_RAILWAY=false

for arg in "$@"; do
  [[ "$arg" == "--no-railway" ]] && NO_RAILWAY=true
done

# The shared secret, from the environment or .env. Both this machine and the
# Railway deploy need the same value or every request comes back 401.
if [[ -z "${ROMANCE_PROXY_KEY:-}" && -f .env ]]; then
  ROMANCE_PROXY_KEY=$(sed -nE 's/^[[:space:]]*ROMANCE_PROXY_KEY[[:space:]]*=[[:space:]]*(.*)$/\1/p' .env | head -1)
fi
if [[ -z "${ROMANCE_PROXY_KEY:-}" ]]; then
  echo "ERROR: ROMANCE_PROXY_KEY is not set (checked the environment and .env)."
  echo "Generate one with:  openssl rand -hex 32"
  exit 1
fi
export ROMANCE_PROXY_KEY

# Ollama itself has to be up — the proxy only forwards.
if ! curl -s -o /dev/null --max-time 3 "http://127.0.0.1:${OLLAMA_PORT}/v1/models"; then
  echo "ERROR: Ollama is not answering on 127.0.0.1:${OLLAMA_PORT}. Start it first."
  exit 1
fi

# Start the proxy unless something is already listening on its port.
PROXY_PID=""
if curl -s -o /dev/null --max-time 2 "http://127.0.0.1:${PROXY_PORT}/v1/models"; then
  echo "Proxy already listening on ${PROXY_PORT} — reusing it."
else
  echo "Starting Ollama proxy → 127.0.0.1:${PROXY_PORT} ..."
  PROXY_PORT="$PROXY_PORT" OLLAMA_PORT="$OLLAMA_PORT" node ollama-proxy.mjs >"$PROXY_LOG" 2>&1 &
  PROXY_PID=$!
  sleep 1
  if ! kill -0 "$PROXY_PID" 2>/dev/null; then
    echo "ERROR: proxy died on startup. Log:"
    tail -5 "$PROXY_LOG"
    exit 1
  fi
fi

# Kill any existing cloudflared tunnel to the proxy
existing=$(pgrep -f "cloudflared tunnel --url http://.*:${PROXY_PORT}" 2>/dev/null || true)
if [[ -n "$existing" ]]; then
  echo "Stopping existing tunnel (PID $existing)..."
  kill "$existing" 2>/dev/null || true
  sleep 1
fi

echo "Starting Cloudflare tunnel → http://127.0.0.1:${PROXY_PORT} ..."
cloudflared tunnel --url "http://127.0.0.1:${PROXY_PORT}" --no-autoupdate >"$LOG" 2>&1 &
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
# Re-resolve on every attempt: a brand-new quick tunnel hostname often isn't
# in DNS yet on the first try, and resolving once up front meant an empty
# EDGE_IP stuck for all 10 attempts, failing a tunnel that was actually fine.
TUNNEL_HOST="${TUNNEL_URL#https://}"
echo "Verifying Ollama reachable through tunnel..."
for i in $(seq 1 10); do
  EDGE_IP=$(dig @1.1.1.1 +short +time=3 "$TUNNEL_HOST" 2>/dev/null | grep -E '^[0-9.]+$' | head -1 || true)
  # The proxy 401s without the key, so the probe has to carry it too.
  if [[ -n "$EDGE_IP" ]]; then
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -H "X-Romance-Key: ${ROMANCE_PROXY_KEY}" --resolve "${TUNNEL_HOST}:443:${EDGE_IP}" "${TUNNEL_URL}/v1/models" 2>/dev/null || true)
  else
    status=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 -H "X-Romance-Key: ${ROMANCE_PROXY_KEY}" "${TUNNEL_URL}/v1/models" 2>/dev/null || true)
  fi
  if [[ "${status:-000}" == "200" ]]; then
    echo "  OK${EDGE_IP:+ (edge IP ${EDGE_IP} pinned via 1.1.1.1)}"
    break
  fi
  if [[ "${status:-000}" == "401" ]]; then
    echo "  FAILED: proxy rejected the key. Local ROMANCE_PROXY_KEY and the running proxy disagree."
    break
  fi
  if [[ $i -eq 10 ]]; then
    echo "  FAILED (HTTP ${status:-000} after 10 attempts)."
    echo "  If this box can't resolve trycloudflare.com the tunnel may still be fine —"
    echo "  Railway resolves independently. Check the Railway logs before assuming it's broken."
  fi
  sleep 3
done

# Update Railway
if [[ "$NO_RAILWAY" == false ]]; then
  if command -v railway &>/dev/null; then
    echo "Updating Railway OLLAMA_URL and ROMANCE_PROXY_KEY..."
    railway variables --set "OLLAMA_URL=${TUNNEL_URL}/v1/chat/completions" --set "ROMANCE_PROXY_KEY=${ROMANCE_PROXY_KEY}"
    echo "Railway updated."
  else
    echo "railway CLI not found — set these manually:"
    echo "  OLLAMA_URL=${TUNNEL_URL}/v1/chat/completions"
    echo "  ROMANCE_PROXY_KEY=${ROMANCE_PROXY_KEY}"
  fi
else
  echo "Skipping Railway update (--no-railway)."
  echo "OLLAMA_URL=${TUNNEL_URL}/v1/chat/completions"
fi

echo ""
echo "Tunnel running (PID $CF_PID). Ctrl-C to stop."
echo "Tunnel log: $LOG"
[[ -n "$PROXY_PID" ]] && echo "Proxy log:  $PROXY_LOG (PID $PROXY_PID)"

# Keep script alive so the tunnel stays up; clean exit on Ctrl-C.
# Take the proxy down with it, but only if we were the ones who started it.
cleanup() {
  echo 'Stopping tunnel...'
  kill "$CF_PID" 2>/dev/null || true
  [[ -n "$PROXY_PID" ]] && kill "$PROXY_PID" 2>/dev/null || true
  exit 0
}
trap cleanup INT TERM
wait "$CF_PID"
