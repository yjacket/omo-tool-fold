# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`extension/tool-fold.ts` is a Senpi/OMO extension that folds selected tool output to one descriptive line in the TUI; Ctrl+O shows original output. `themes/grok-day-focus.json` is an optional theme that highlights user messages and lightens tool boxes. README.md is the user-facing spec.

## Commands

```sh
bun test
bun test -t "<name substring>"
sh install.sh   |   .\install.ps1
```

The package requires Bun >= 1.4. Tests use `bun:test` mock.module fakes and import a fresh module with a `?case=` query. They do not use a live OMO session. Tests must not use sleeps.

## Architecture

- `evalPlan`, `editPlan`, and `todoPlan` define special collapsed render behavior for those tools. `compactPlan` creates the shared compact renderer for names in `COMPACT_TOOLS`.
- `describe` selects a short verb and first useful target, making paths relative to cwd where possible. `planFor` selects a special plan or the explicit compact-tool plan.
- `dispatchSlot` runs a fold plan and falls back to the original renderer. `wrapDefinition` wraps eligible `renderCall` and `renderResult` slots returned by `getToolDefinition`.
- `createImpl` builds the implementation and `TruncatedText` components. The default extension dynamically imports and feature-detects `AgentSession` from `@code-yeongyu/senpi` and `TruncatedText` from `@earendil-works/pi-tui`.
- `HOOK`, `IMPL`, `WRAPPED`, and `OWN` are `Symbol.for` coordination markers. The prototype hook installs once per process and dispatches through the replaceable global implementation; reload clears that implementation.

## Invariants

- Never break the TUI: errors, unexpected data, and render failures must fall back to the original renderer.
- Never mutate stored tool results. Before calling an original renderer, remove this extension's component from `context.lastComponent`.
- Feature-detect every Senpi/TUI internal. If an internal is missing, leave rendering original and show one session-start warning.
- Keep the folding list an explicit allowlist. Leave `read`, `grep`, `find`, `ls`, and `ask_user_question` untouched; do not blindly fold future tools.
- Preserve the v2 symbols unless intentionally layering a new hook over copies already loaded in running processes.

## Testing

`bun test` runs the fake-module suite. Each test imports a fresh copy with the `?case=` query; mocks model the renderer behavior under test. Cover fallback behavior for errors, expanded output, missing internals, reload, and unexpected data. Do not add sleeps.

## Live TUI check

Run `omo --no-session` in a pseudo-terminal at 150 columns. Ask the agent for exactly one call each: todo init, web_search, eval with a summary, write, edit, todo done. Confirm each collapsed call shows one line. Send raw byte `0x0f` (Ctrl+O) to show original full output, then send it again to collapse. Confirm no `TypeError` or `detachAll` text appears. Harness screen views strip colors; inspect raw PTY bytes for user-message background `48;2;214;228;255` and tool-box background `48;2;247;248;249`.

## After an OMO update

Re-run the live check. To inspect tool renderer availability, load a throwaway extension with `omo -e` that wraps `AgentSession.prototype.getAllTools` and logs, for each tool, `typeof getToolDefinition(name).renderCall`, `typeof getToolDefinition(name).renderResult`, and `renderShell`.
