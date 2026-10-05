#!/usr/bin/env sh
set -e

script_dir="$(dirname "$0")"
extensions="$HOME/.omo/agent/extensions"
themes="$HOME/.omo/agent/themes"

mkdir -p "$extensions" "$themes"
cp "$script_dir/extension/tool-fold.ts" "$extensions/tool-fold.ts"
echo "installed -> $extensions/tool-fold.ts"
cp "$script_dir/themes/grok-day-focus.json" "$themes/grok-day-focus.json"
echo "installed -> $themes/grok-day-focus.json"
echo "Running omo sessions pick it up at their next idle point (or type /reload)."
echo 'To use the theme set "theme": "grok-day-focus" in ~/.omo/agent/settings.json.'
