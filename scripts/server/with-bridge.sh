#!/bin/sh
set -eu

PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

script_dir="$(cd "$(dirname "$0")" && pwd)"
start_script="$script_dir/start-messages.sh"
stop_script="$script_dir/stop-messages.sh"

if [ "$#" -eq 0 ]; then
	echo "Usage: $0 <command> [args...]" >&2
	exit 1
fi

"$start_script"

cleaned_up=0
cleanup() {
	if [ "$cleaned_up" -eq 1 ]; then
		return
	fi
	cleaned_up=1
	"$stop_script" || true
}
trap cleanup EXIT INT TERM

"$@"
