# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`extension/tool-fold.ts` is a Senpi/OMO extension that folds selected tool output to one descriptive line in the TUI; Ctrl+O shows original output. It also hides finished hidden-thinking labels, hides Kibitzer nudges and goal cache-warm notices while collapsed, and groups consecutive folded evals into one `Ran N evals` block. `themes/grok-day-focus.json` is an optional theme that highlights user messages and lightens tool boxes. README.md is the user-facing spec.

## Commands

```sh
bun test
bun test -t "<name substring>"
omo install <path-to-this-clone>   # loads the working tree; /reload picks up edits
```

It ships as an omo package: `package.json` `pi` names `extension/tool-fold.ts` and the `themes/` folder, and users install it with `omo install git:github.com/yjacket/omo-tool-fold`.

The package requires Bun >= 1.4. Tests use `bun:test` mock.module fakes and import a fresh module with a `?case=` query. They do not use a live OMO session. Tests must not use sleeps.

## Architecture

- `evalPlan`, `editPlan`, and `todoPlan` define special collapsed render behavior for those tools. `compactPlan` creates the shared compact renderer for names in `COMPACT_TOOLS`.
- `describe` selects a short verb and first useful target, making paths relative to cwd where possible. `planFor` selects a special plan or the explicit compact-tool plan.
- `dispatchSlot` runs a fold plan and falls back to the original renderer. `wrapDefinition` wraps eligible `renderCall` and `renderResult` slots returned by `getToolDefinition`.
- `createImpl` builds the implementation and `TruncatedText` components. The default extension dynamically imports and feature-detects `AgentSession` from `@code-yeongyu/senpi` and `TruncatedText` from `@earendil-works/pi-tui`.
- `HOOK`, `IMPL`, `WRAPPED`, and `OWN` are `Symbol.for` coordination markers. The prototype hook installs once per process and dispatches through the replaceable global implementation; reload clears that implementation.
- `extension/thinking-label.ts` exports `hideFinishedThinking`, a pure filter that drops finished hidden `thinking-label` descriptors and their spacers but keeps the live `Thinking...` label and shown thinking.
- `extension/eval-run.ts` exports `groupEvalRuns`, a pure pass over the projected transcript that replaces runs of 2+ folded tool cards (eval, edit, apply_patch, write and the other compact tools; thinking-only details between them) by one group. Non-eval members carry their own fold line, computed by `foldedLine` in `tool-fold.ts` through the same plan the card uses.
- `extension/hidden-notices.ts` exports `shouldHideNotice` (a predicate) and `hideCollapsedNotices` (a filter over the projected array), with no Senpi/pi-tui imports. It whitelists `omo-kibitzer:nudged` and `goal-cache-warmup` custom entries/messages, reads the card's `_expanded` (fallback `state.expanded`), and returns the input array by identity when nothing is hidden. `groupEvals` in `tool-fold.ts` filters before grouping, so a hidden notice between two folded cards does not break the block.
- `extension/eval-group-view.ts` exports `createEvalGroupClass`, the block component: header, body lines, expand state taken from member cards, mouse handling and render revision.
- `tool-fold.ts` wires them. `Symbol.for("omo.tool-fold.thinking-hook.v1")` marks the wrap of `AssistantMessageComponent.prototype.reconcileRenderDescriptors`. `Symbol.for("omo.tool-fold.group-hook.v1")` marks the wrap of `InteractiveMode.prototype.createToolExecutionComponent`, which installs the projection hook `Symbol.for("omo.tool-fold.project-hook.v1")` on the transcript container's `project()`. All three dispatch through `IMPL`. Missing seams turn off only their part, with one load-time `tool-fold 일부 꺼짐 (...)` notice, plus at most one late notice if the transcript `project()` or the block rendering fails later.

## Invariants

- Never break the TUI: errors, unexpected data, and render failures must fall back to the original renderer.
- Never mutate stored tool results. Before calling an original renderer, remove this extension's component from `context.lastComponent`.
- Feature-detect every Senpi/TUI internal. If an internal is missing, leave rendering original and show one session-start warning.
- Keep the folding list an explicit allowlist. Leave `read`, `grep`, `find`, `ls`, and `ask_user_question` untouched; do not blindly fold future tools.
- Group only cards this extension folds to a line (any plan except todo). Never place an unfolded, failed or partially failed card in a block. An eval-only block keeps the `Ran N evals` header; a mixed one reads `Ran N tools · <tool> <count> · ...`.
- Never touch `chatContainer.children`. Grouping and notice hiding live only in the projected array.
- Hide only the two whitelisted notice types, only while their card is collapsed. Prompt-cache MISS notices and every other notice stay visible. Missing or unreadable state keeps the original, and any error returns the projected array unchanged.
- Keep trailing thinking-only messages outside the block, so the live `Thinking...` label stays visible.
- Preserve the v2 symbols unless intentionally layering a new hook over copies already loaded in running processes.

## Testing

`bun test` runs the fake-module suite. Each test imports a fresh copy with the `?case=` query; mocks model the renderer behavior under test. Cover fallback behavior for errors, expanded output, missing internals, reload, and unexpected data. Do not add sleeps.

## Live TUI check

Don't start real `omo` with the user's agent dir. Use two isolated checks instead.

Real components: `bun test ./qa/real-render.qa.ts` drives the installed Senpi classes in a plain bun process. The file is deliberately not named `*.test.ts`, so plain `bun test` skips it.

Isolated replay (`bun qa/live-replay.mjs`): run the senpi engine bundle CLI (`dist/bundle/cli.js`) in a 150x45 PTY. Point every env name from `brandEnvNames("CODING_AGENT_DIR")` at a temp agent dir. Resume a copied session file, and load the working tree with `-e extension/tool-fold.ts` plus a QA eval tool (the temp settings disable the bundled `codemode` built-in, which otherwise owns `eval`). Never type a prompt. Send raw byte `0x0f` (Ctrl+O) to show original output, then again to collapse. Confirm the `Ran N evals` block, no `Thought:` line, and no `TypeError` or `detachAll` text. Harness screen views strip colors; inspect raw PTY bytes for user-message background `48;2;214;228;255` and tool-box background `48;2;247;248;249`.

Env overrides: both scripts take `SENPI_DIST` (senpi dist root), the component harness also takes `PI_TUI_DIST`, and the replay takes `QA_ROOT` (scratch dir); the replay writes and resumes a synthetic session by default, and `QA_SESSION` (session .jsonl) makes it replay a copy of a real one instead.

Installing and reloading in real sessions is the user's call.

## After an OMO update

Re-run the live check. To inspect tool renderer availability, load a throwaway extension with `omo -e` that wraps `AgentSession.prototype.getAllTools` and logs, for each tool, `typeof getToolDefinition(name).renderCall`, `typeof getToolDefinition(name).renderResult`, and `renderShell`.
