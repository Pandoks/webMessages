#!/usr/bin/env bash
# webMessages — start imessage-rs + Node server in foreground
# Usage: ./start.sh [--port 8080] [--imessage-rs-port 5000]
#   Or override with env vars: PORT=8080 IMESSAGE_RS_PORT=5000 ./start.sh
# Press Ctrl+C to stop both services

set -euo pipefail

# ── Parse CLI args (override env vars) ──────────────────
while [[ $# -gt 0 ]]; do
	case "$1" in
		--port)
			[[ -n "${2:-}" ]] || { echo "error: --port requires a value"; exit 1; }
			PORT="$2"; shift 2 ;;
		--imessage-rs-port)
			[[ -n "${2:-}" ]] || { echo "error: --imessage-rs-port requires a value"; exit 1; }
			IMESSAGE_RS_PORT="$2"; shift 2 ;;
		-h|--help)
			echo "Usage: webmessages [--port PORT] [--imessage-rs-port PORT]"
			echo ""
			echo "Options:"
			echo "  --port PORT              Web UI port (default: random free port)"
			echo "  --imessage-rs-port PORT  imessage-rs API port (default: random free port)"
			echo "  -h, --help               Show this help"
			echo ""
			echo "Environment variables PORT and IMESSAGE_RS_PORT also work."
			exit 0 ;;
		*) echo "Unknown argument: $1 (try --help)"; exit 1 ;;
	esac
done

WEBMESSAGES_HOME="${WEBMESSAGES_HOME:-$HOME/.webmessages}"

# ── Colors ──────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
CYAN='\033[0;36m'
NC='\033[0m'

info()  { printf "${CYAN}[info]${NC}  %s\n" "$*"; }
ok()    { printf "${GREEN}[ok]${NC}    %s\n" "$*"; }
warn()  { printf "${YELLOW}[warn]${NC}  %s\n" "$*"; }
err()   { printf "${RED}[error]${NC} %s\n" "$*"; }

# ── Find a free port ─────────────────────────────────────
free_port() {
	python3 -c 'import socket; s=socket.socket(); s.bind(("",0)); print(s.getsockname()[1]); s.close()'
}

# ── Pre-flight checks ──────────────────────────────────
preflight() {
	local failed=0

	# macOS version
	local macos_ver
	macos_ver=$(sw_vers -productVersion)
	local major=${macos_ver%%.*}
	if [[ "$major" -lt 15 ]]; then
		err "macOS 15+ required (found $macos_ver)"
		failed=1
	else
		ok "macOS $macos_ver"
	fi

	# SIP
	if csrutil status 2>/dev/null | grep -qi "disabled"; then
		ok "SIP disabled"
	else
		warn "SIP appears enabled — imcore-bridge features (scheduled messages, pin/unpin) may not work"
	fi

	# Node.js
	if ! command -v node >/dev/null 2>&1; then
		err "Node.js not found — install Node.js 22+ from https://nodejs.org"
		failed=1
	else
		local node_major
		node_major=$(node --version | sed 's/v//' | cut -d. -f1)
		if [[ "$node_major" -lt 22 ]]; then
			err "Node.js 22+ required (found $(node --version))"
			failed=1
		else
			ok "Node.js $(node --version)"
		fi
	fi

	# Full Disk Access
	if sqlite3 "$HOME/Library/Messages/chat.db" "SELECT 1" >/dev/null 2>&1; then
		ok "Full Disk Access"
	else
		err "Cannot read ~/Library/Messages/chat.db"
		err "Grant Full Disk Access to Terminal in: System Settings > Privacy & Security > Full Disk Access"
		failed=1
	fi

	if [[ "$failed" -ne 0 ]]; then
		echo ""
		err "Pre-flight checks failed. Fix the issues above and try again."
		exit 1
	fi
}

info "Running pre-flight checks..."
preflight
echo ""

# ── Resolve config (env vars or auto-detect) ─────────────
IMESSAGE_RS_PASSWORD="${IMESSAGE_RS_PASSWORD:-$(openssl rand -hex 16)}"
IMESSAGE_RS_PORT="${IMESSAGE_RS_PORT:-$(free_port)}"
PORT="${PORT:-$(free_port)}"
IMESSAGE_RS_URL="http://127.0.0.1:${IMESSAGE_RS_PORT}"
WEBMESSAGES_BIN_DIR="$WEBMESSAGES_HOME/bin"

# ── Cleanup on exit ────────────────────────────────────
IMESSAGE_RS_PID=""
NODE_PID=""

cleanup() {
	echo ""
	info "Shutting down..."
	if [[ -n "$NODE_PID" ]] && kill -0 "$NODE_PID" 2>/dev/null; then
		kill "$NODE_PID" 2>/dev/null
		wait "$NODE_PID" 2>/dev/null || true
	fi
	if [[ -n "$IMESSAGE_RS_PID" ]] && kill -0 "$IMESSAGE_RS_PID" 2>/dev/null; then
		kill "$IMESSAGE_RS_PID" 2>/dev/null
		wait "$IMESSAGE_RS_PID" 2>/dev/null || true
	fi
	ok "Stopped."
}
trap cleanup SIGINT SIGTERM EXIT

# ── Start imessage-rs (CLI flags only, no config file) ───
IMESSAGE_RS_BIN="$WEBMESSAGES_HOME/bin/imessage-rs"
if [[ ! -x "$IMESSAGE_RS_BIN" ]]; then
	err "imessage-rs binary not found at $IMESSAGE_RS_BIN"
	exit 1
fi

info "Starting imessage-rs on port $IMESSAGE_RS_PORT..."
"$IMESSAGE_RS_BIN" \
	--password "$IMESSAGE_RS_PASSWORD" \
	--socket-port "$IMESSAGE_RS_PORT" \
	--enable-private-api true \
	--enable-findmy-private-api true \
	--webhook "http://localhost:${PORT}/api/webhook" &
IMESSAGE_RS_PID=$!

# Wait for imessage-rs to be ready
printf "${CYAN}[info]${NC}  Waiting for imessage-rs"
for i in $(seq 1 30); do
	if curl -sf "${IMESSAGE_RS_URL}/api/v1/server/info?password=${IMESSAGE_RS_PASSWORD}" >/dev/null 2>&1; then
		printf "\n"
		ok "imessage-rs ready"
		break
	fi
	if ! kill -0 "$IMESSAGE_RS_PID" 2>/dev/null; then
		printf "\n"
		err "imessage-rs exited unexpectedly"
		exit 1
	fi
	printf "."
	sleep 1
	if [[ $i -eq 30 ]]; then
		printf "\n"
		err "imessage-rs did not respond within 30 seconds"
		exit 1
	fi
done

# ── Start Node.js server ──────────────────────────────
info "Starting webMessages on port $PORT..."
cd "$WEBMESSAGES_HOME/web"
IMESSAGE_RS_URL="$IMESSAGE_RS_URL" \
IMESSAGE_RS_PASSWORD="$IMESSAGE_RS_PASSWORD" \
WEBMESSAGES_BIN_DIR="$WEBMESSAGES_BIN_DIR" \
PORT="$PORT" \
node build &
NODE_PID=$!

sleep 1
if ! kill -0 "$NODE_PID" 2>/dev/null; then
	err "Node.js server failed to start"
	exit 1
fi

echo ""
ok "webMessages is running at http://localhost:${PORT}"
info "Press Ctrl+C to stop."
echo ""

# ── Wait for either process to exit ───────────────────
while kill -0 "$IMESSAGE_RS_PID" 2>/dev/null && kill -0 "$NODE_PID" 2>/dev/null; do
	wait -n "$IMESSAGE_RS_PID" "$NODE_PID" 2>/dev/null || true
done

if ! kill -0 "$IMESSAGE_RS_PID" 2>/dev/null; then
	err "imessage-rs exited unexpectedly"
fi
if ! kill -0 "$NODE_PID" 2>/dev/null; then
	err "Node.js server exited unexpectedly"
fi
