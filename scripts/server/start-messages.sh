#!/bin/sh
# Start the standalone IMCore bridge helper process.
# Requires: SIP disabled + amfi_get_out_of_my_way=1 in boot-args.
set -eu

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

script_dir="$(cd "$(dirname "$0")" && pwd)"
native_dir="$(cd "$script_dir/../../native" && pwd)"
bridge="$native_dir/imcore-bridge"
entitlements="$native_dir/imcore-entitlements.plist"
source_file="$native_dir/imcore-bridge.m"

[ -f "$source_file" ] || { echo "Error: Missing source file: $source_file" >&2; exit 1; }
[ -f "$entitlements" ] || { echo "Error: Missing entitlements file: $entitlements" >&2; exit 1; }

boot_args="$(nvram boot-args 2>/dev/null | sed 's/^boot-args[[:space:]]*//')"
if ! printf '%s' "$boot_args" | grep -q 'amfi_get_out_of_my_way'; then
	recommended_boot_args="${boot_args:+$boot_args }amfi_get_out_of_my_way=1"
	cat <<EOF
Error: AMFI bypass boot arg is not set.
Run:
  sudo nvram boot-args="$recommended_boot_args"
Then reboot.
EOF
	exit 1
fi

if [ ! -f "$bridge" ] || [ "$source_file" -nt "$bridge" ]; then
	echo "[bridge] Compiling imcore-bridge..."
	clang -arch arm64e -fobjc-arc -framework Foundation -o "$bridge" "$source_file"
fi

echo "[bridge] Signing with entitlements..."
codesign --force --sign - --entitlements "$entitlements" "$bridge"

echo "[bridge] Stopping existing bridge process (if any)..."
pkill -f "$bridge" 2>/dev/null || true
pkill -f "/native/imcore-bridge" 2>/dev/null || true
pkill -x "imcore-bridge" 2>/dev/null || true

echo "[bridge] Starting imcore-bridge..."
"$bridge" &
echo "[bridge] imcore-bridge started (PID: $!)"
