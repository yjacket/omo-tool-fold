# omo-tool-fold

English | [한국어](README.ko.md)

An OMO (senpi) extension that folds each tool call into a single line while tool output is collapsed. That's the TUI default, and Ctrl+O toggles it. Each line names the tool and what it did, so a long session reads like a log instead of a wall of boxes. Press Ctrl+O to expand, and every tool shows its original full output again. Finished hidden thinking leaves no `Thought:` line, and two or more evals in a row read as one short block. The repo also ships `grok-day-focus`, a light theme that tints your own messages blue and makes tool boxes almost white.

## What you see

```
eval js ✓ Read config files and list extension folder
edit extension/tool-fold.ts (+12/-3)
apply_patch 2 files (+15/-4)
todo done: A 확인
web_search bun webview screenshot
write .omo/drafts/fold-b.txt
memory insert notes/a.md
```

A still-running eval cell shows its state word (for example `running`) in place of `✓`. Other folded tools get ` …` appended while they run.

Consecutive evals share one block:

```
eval js ✓ Read config files and list extension folder

• Ran 3 evals
  └ js ✓ 저장소 상태 확인
    js ✓ 스킬 읽기
    py ✓ 데이터 분석
```

A lone eval with no eval next to it stays one line, as in the first line above.

## Install

```sh
omo install git:github.com/yjacket/omo-tool-fold
```

omo clones the repository into `~/.omo/agent/git/github.com/yjacket/omo-tool-fold` and adds it to `packages` in `~/.omo/agent/settings.json`. Type `/reload` in running sessions.

**Update:** `omo update --extensions` (every installed package) or `omo update git:github.com/yjacket/omo-tool-fold`, then `/reload`.

The theme `grok-day-focus` comes with the package. To use it, set this in `~/.omo/agent/settings.json`:

```json
"theme": "grok-day-focus"
```

If you installed with the old copy scripts, delete `~/.omo/agent/extensions/tool-fold.ts` and `~/.omo/agent/themes/grok-day-focus.json`, or they load next to the package.

**Uninstall:** `omo remove git:github.com/yjacket/omo-tool-fold`, then `/reload` or restart omo. The reload clears the extension's dispatch target, so originals render again. This path is covered by the tests but hasn't been checked live. If you set the theme, change it back to `"grok-day"`.

## Which tools fold and which don't

- **eval:** `eval js ✓ <first line of the cell summary>`. Error, cancelled, or unknown-status cells keep the original full box.
- **edit:** `edit <path relative to cwd> (+added/-removed)`.
- **apply_patch:** `apply_patch <path relative to cwd or N files> (+added/-removed)`. Counts come from the applied preview; partial failures and missing preview data keep the original output.
- **todo:** only the title line, for example `todo done: A 확인`. The full list is still there through `/todo` and the todo widget under the input box.
- **These 27 tools** fold to `<tool> <verb> <target>`: web_search, webfetch, write, memory, look_at, powershell, bash_output, tool_search, task, task_output, task_send, task_cancel, team_create, team_delete, task_create, task_get, task_list, task_update, create_goal, update_goal, get_goal, lsp_diagnostics, lsp_goto_definition, lsp_find_references, lsp_symbols, lsp_prepare_rename, lsp_rename.
  - Verb is the `op`, `action` or `command` argument when it's one short token.
  - Target is the first non-empty line of the first present argument among `task_summary`, `description`, `summary`, `query`, `url`, `objective`, `goal`, `prompt`, `message`, `command`, `file_path`, `path`, `filePath`, `pattern`, `name`, `task_id`, `to`, `bash_id`, `status`, `reason`. Paths are shown relative to cwd.

Left alone on purpose:

- **read, grep, find, ls.** Senpi already groups consecutive calls into one exploration line, and that grouping checks the renderer's identity. Wrapping them would break it.
- **ask_user_question.** It's a question card, meant to be seen.
- **Tools without renderCall or renderResult.** They're already short.
- **Every tool not listed above.** A tool added by a future OMO update is never folded blindly.

Any error result (`result.isError` or the render context's `isError`) shows the original full output.

## Finished thinking

- Hidden thinking that has finished leaves no line at all. No `Thought: 1ms`, no extra blank line.
- While thinking is still running, the live `Thinking...` label stays.
- Ctrl+T (show thinking) shows the label and the full body as before.
- You can't click a single thinking line to open it anymore, because the line is gone. Use Ctrl+T.

## Consecutive eval calls

- Only evals that already fold to one line join a block. Failed, cancelled and unknown-status evals end the block and keep their full box. peek, stop and list calls also end the block.
- Assistant steps that hold only hidden thinking don't break the block.
- Any other tool breaks it.
- Ctrl+O, or a click on the header, shows the original boxes under the header. Do it again to fold them back.
- While any member is still running, the header shows a spinner and reads `Running N evals`. That member's line shows its state word, for example `py running 데이터 분석`.
- The list has no line cap.

## Theme

`grok-day-focus` is a copy of senpi's built-in `grok-day` with four values changed:

| Token | grok-day | grok-day-focus | Effect |
|---|---|---|---|
| `userMessageBg` | `#e8e8e8` | `#d6e4ff` | your messages get a blue tint |
| `toolPendingBg` | `#e8e8f0` | `#f7f8f9` | almost white |
| `toolSuccessBg` | `#e8f0e8` | `#f7f8f9` | almost white |
| `customMessageBg` | `#ede7f6` | `#f7f8f9` | notice boxes almost white |

`toolErrorBg` is unchanged, so error boxes stay red. To revert, set `"theme": "grok-day"` in `~/.omo/agent/settings.json`.

## How it works and safety

Senpi has no public API for changing how another extension's tool is drawn. So this extension wraps `AgentSession.prototype.getToolDefinition`, the lookup the TUI uses to find tool renderers, imported from `@code-yeongyu/senpi`. It draws its one line with `TruncatedText` from `@earendil-works/pi-tui`. Both are internals, imported dynamically and feature-detected.

Two more seams drive the newer features. Each one is feature-detected on its own:

- `AssistantMessageComponent.prototype.reconcileRenderDescriptors` hides finished thinking lines.
- `InteractiveMode.prototype.createToolExecutionComponent` reaches the transcript container's `project()`, which groups evals. Grouping changes only the drawn projection. It never touches `chatContainer.children` or stored results.

Fail-safe behavior:

- If either internal is missing after an update, the extension does nothing and shows one warning at session start: `tool-fold 꺼짐 (<reason>). 도구 표시는 원래대로 보입니다.`
- If only a newer seam is missing, just that part turns off, with one warning: `tool-fold 일부 꺼짐 (<부분>: <이유>). 그 부분은 원래대로 보입니다.`
- Every render call is wrapped. An exception or unexpected data falls back to the original renderer.
- It never mutates the stored tool result. Folding is display only.
- Before calling an original renderer it removes its own one-line component from `context.lastComponent`. Edit's original `renderResult` calls `lastComponent.detachAll()` and would otherwise crash on Ctrl+O.
- Tools with `renderShell: "self"` (edit, memory) get a 1-column left padding so lines align.

Updates without restart: the prototype hook installs once per process (`Symbol.for("omo.tool-fold.hook.v2")`) and always dispatches to `globalThis[Symbol.for("omo.tool-fold.impl.v2")]`, which each load of the file replaces. On `session_shutdown` with reason `reload`, it clears its own impl. Senpi hot-reloads when a file in the global extensions folder changes, at the session's next idle point (busy sessions wait), and `/reload` forces it. Checked live: an omo process running an older copy switched to the new one after the file was replaced, and the existing transcript re-rendered folded.

## Limitations and tested versions

- It depends on senpi internals. An OMO update may turn it off, in which case you'll see the warning above and the normal display.
- The thinking and eval-group seams are Senpi internals too. A change there turns off only that part.
- A senpi theme file must define every required color token. If an OMO update adds one, `grok-day-focus` may stop loading. It's expected to be skipped rather than crash, but that's not verified. To fix it, copy the new `grok-day.json` from the installed senpi and re-apply the four values.

Tested with OMO binary 5.1.12 (npm `omo-ai` 5.1.17, `@code-yeongyu/senpi` 2026.10.8) on Windows 11, Bun 1.4.2.

Thinking hiding and eval blocks were tested with `@code-yeongyu/senpi` 2026.10.13 (npm `omo-ai` 5.1.33) on Windows 11, Bun 1.4.2. That check used real Senpi components and an isolated replay, not the user's live sessions.

## Development

```sh
bun test
```

This runs renderer tests against fake senpi and pi-tui modules (`bun:test` `mock.module`). Each test imports a fresh copy of the extension through a `?case=<random>` query. The suite doesn't use a live omo session. Live TUI checks are described in [CLAUDE.md](CLAUDE.md).

## License

MIT. See [LICENSE](LICENSE).
