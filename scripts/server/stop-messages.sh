#!/bin/sh
set -eu

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

if pgrep -f "/native/imcore-bridge" >/dev/null 2>&1 || pgrep -x "imcore-bridge" >/dev/null 2>&1; then
	pkill -f "/native/imcore-bridge" 2>/dev/null || true
	pkill -x "imcore-bridge" 2>/dev/null || true
	echo "[bridge] imcore-bridge stopped"
else
	echo "[bridge] imcore-bridge was not running"
fi
