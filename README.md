# omo-tool-fold

English | [한국어](README.ko.md)

An OMO (senpi) extension that folds each tool call into a single line while tool output is collapsed. That's the TUI default, and Ctrl+O toggles it. Each line names the tool and what it did, so a long session reads like a log instead of a wall of boxes. Press Ctrl+O to expand, and every tool shows its original full output again. Finished hidden thinking leaves no `Thought:` line, and two or more eligible tool calls in a row (eval, edit, todo, terminal controls, thread receipts, ...) read as one short block. Questions, images, errors and native-only tools stay visible as their own cards. The repo also ships `grok-day-focus`, a light theme that tints your own messages blue and makes tool boxes almost white.

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

Consecutive folded calls share one block. An all-eval run keeps the short form; a mixed run counts each tool:

```
• Ran 3 evals
  └ js ✓ 저장소 상태 확인
    js ✓ 스킬 읽기
    py ✓ 데이터 분석

• Ran 4 tools · eval 1 · edit 2 · write 1
  └ eval js ✓ 설정 확인
    edit extension/tool-fold.ts (+12/-3)
    edit README.md (+4/-1)
    write notes/plan.md
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
- **todo:** when a todo call stands alone, only the title line is drawn, for example `todo done: A 확인`. The same title is used inside a block. The full list is still there through `/todo` and the todo widget under the input box.
- **These 27 tools** fold to `<tool> <verb> <target>`: web_search, webfetch, write, memory, look_at, powershell, bash_output, tool_search, task, task_output, task_send, task_cancel, team_create, team_delete, task_create, task_get, task_list, task_update, create_goal, update_goal, get_goal, lsp_diagnostics, lsp_goto_definition, lsp_find_references, lsp_symbols, lsp_prepare_rename, lsp_rename.
- **bash, glob and six MCP tools** also fold: `bash`, `glob`, `mcp__ast_grep_rewrite`, `mcp__ast_grep_scan`, `mcp__ast_grep_search`, `mcp_context7_query-docs`, `mcp_context7_resolve-library-id`, `mcp_grep_app_searchGitHub`. `bash` shares the shell line with `powershell`; an MCP line keeps its native preview text.
  - Verb is the `op`, `action` or `command` argument when it's one short token.
  - Target is the first non-empty line of the first present argument among `task_summary`, `description`, `summary`, `query`, `url`, `objective`, `goal`, `prompt`, `message`, `command`, `file_path`, `path`, `filePath`, `pattern`, `name`, `task_id`, `to`, `bash_id`, `status`, `reason`. Paths are shown relative to cwd.

**Projection-only members (22 names).** These get no renderer override: a lone card stays exactly as its owner draws it. In a run of two or more, the run lists computed summary lines, and expanding shows the original cards. They are kill_bash, monitor, schedule_wakeup, schedule_prompt, workflow, workpool, thread_create, thread_list, thread_read, thread_send, thread_interrupt, thread_handoff, thread_rename, thread_set_model, thread_set_reasoning, thread_bind, thread_unbind, thread_rebind, thread_bindings, thread_report, thread_outbox, thread_outbox_ack. Admission is shape-checked: `monitor` only for a registration with no action (its card supplies only renderCall); thread tools only for an ok result; rearm, human-input, question/answer, error and unknown shapes stay native.

**Native-preserved (18 names).** bash_input, bash_resize, read, grep, find, ls, request_user_input, ask_user_question, generate_image, read_video, show_html_page, computer, omo_browser_bridge, $web_search, onboarding_session_history, onboarding_understand, onboarding_memory_apply, thread_answer. Senpi's exploration grouping owns read/grep/find/ls, decision cards must be seen, and media or unsupported shapes keep their native renderer. Inactive MCP stubs (call slot only) stay native too.

That is the finite scope: of the 79 names in the observed catalog, 61 are conditionally eligible (39 renderer-backed plus 22 projection-only) and 18 stay native. A tool added by a future OMO update is never folded blindly, and no name is admitted by wildcard or prefix.

Any error result (`result.isError`, `details.isError`, or the render context's `isError`) shows the original full output. Non-text content such as images, failed or cancelled states, partial apply_patch results and unknown required shapes also stay native. A failed, cancelled or unknown task status (`task_output` `details.snapshot.status`) also keeps the original output.

## Finished thinking

- Hidden thinking that has finished leaves no line at all. No `Thought: 1ms`, no extra blank line.
- While thinking is still running, the live `Thinking...` label stays.
- Ctrl+T (show thinking) shows the label and the full body as before.
- You can't click a single thinking line to open it anymore, because the line is gone. Use Ctrl+T.

## Consecutive folded calls

- Every eligible tool above can join a block while its collapsed presentation is this extension's one line. That includes todo and the 22 projection-only names; projection-only cards are only summarized inside a run of two or more. Failed calls, apply_patch with failed hunks, cancelled and unknown-status evals end the block and keep their full box. Eval peek, stop and list calls, questions, answers, media and native-only tools also end the block.
- Assistant steps that hold only hidden thinking don't break the block.
- A tool that stays native (read, grep, find, ls, ask_user_question, media, MCP stubs, ...) breaks it.
- A returned background-shell receipt (details.background plus bash_id) is labeled `background <id>`; it means the job was launched, not that it finished.
- Ctrl+O, or a click on the header, shows the original boxes under the header. Do it again to fold them back; this behavior is unchanged.
- While any member is still running, or its receipt reports work that has not finished (any member whose state is not `complete`), the header shows a spinner and reads `Running N evals` (or `Running N tools · ...`), even in an otherwise fully settled session. Examples include an armed monitor, a scheduled wakeup, a queued or in-flight scheduled prompt, a queued workflow send or a workflow run that has not completed, a queued, open or closing workpool, and a steered, started, queued or queued_offline thread delivery. Finished acknowledgements read `Ran`, for example a stopped wakeup or a cancelled scheduled prompt that was not in flight. That member's line shows its state word, for example `py running 데이터 분석` or `monitor armed <id> ...`. A background shell launch row records that the job was launched, not that it finished, and does not by itself keep the header `Running`.
- The list has no line cap.

## Hidden notices

While tool output is collapsed, two transcript notices are hidden entirely:

- Kibitzer recall nudges (`✦ Kibitzer !` / `✦ <random opener> — <memory path>`).
- Goal cache-warm notices (`⚡ Cache-warm wait …` / `⚡ Cache-warm wake …`).

Ctrl+O shows them again unchanged. Prompt-cache MISS notices and every other notice stay visible. Hiding changes only the drawn projection; stored entries and `chatContainer.children` keep everything.

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

Additional seams drive the newer features. Each one is feature-detected on its own:

- `AssistantMessageComponent.prototype.reconcileRenderDescriptors` hides finished thinking lines.
- `InteractiveMode.prototype.createToolExecutionComponent` reaches the transcript container's `project()`, which filters hidden notices and groups eligible tool runs. Both change only the drawn projection. They never touch `chatContainer.children` or stored results.
- `InteractiveMode.prototype.setToolsExpanded` resets the non-owning display's history window after Ctrl+O. Long expanded output must not leave compact summaries outside the visible range when folded again. This applies equally to Claude and Codex; source cards and stored messages stay intact.

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
