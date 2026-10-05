#!/usr/bin/env sh
# One-line install, no clone needed:
#   curl -fsSL https://raw.githubusercontent.com/yjacket/omo-tool-fold/master/install.sh | sh
# Run from a clone (sh install.sh) it copies the local files instead.
set -e

base="https://raw.githubusercontent.com/yjacket/omo-tool-fold/master"
agent="$HOME/.omo/agent"
src_dir=""
if [ -f "$0" ] && [ -f "$(dirname "$0")/extension/tool-fold.ts" ]; then
	src_dir="$(dirname "$0")"
fi
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT

install_file() {
	if [ -n "$src_dir" ]; then
		cp "$src_dir/$1" "$tmp"
	else
		curl -fsSL "$base/$1" -o "$tmp"
	fi
	mkdir -p "$(dirname "$2")"
	cp "$tmp" "$2"
	echo "installed -> $2"
}

install_file extension/tool-fold.ts "$agent/extensions/tool-fold.ts"
install_file themes/grok-day-focus.json "$agent/themes/grok-day-focus.json"
echo "Running omo sessions pick it up at their next idle point (or type /reload)."
echo 'To use the theme set "theme": "grok-day-focus" in ~/.omo/agent/settings.json.'
