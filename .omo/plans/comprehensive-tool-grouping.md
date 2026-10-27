# comprehensive-tool-grouping - Work Plan

## TL;DR (For humans)
<!-- Fill this LAST, after the detailed plan below is written, so it summarizes the REAL plan. -->
<!-- Plain English for a non-engineer: NO file paths, NO todo numbers, NO wave/agent/tool names. -->

**Who this is for and what changes for them:** 긴 OMO 실행 기록을 읽고 작업을 감독하는 개발자를 위한 변경입니다. todo와 일반 제어 도구가 연속 기록 안에서 한 줄씩 이어지고, 질문·오류·이미지 결과는 눈앞에 남습니다.

**What you'll get:** 관측한 79개 도구를 모두 분류한 정책, 조건부 묶기 61개와 원래 표시 보존 18개, 원문 복원과 실제 터미널 회귀 검증을 포함한 구현입니다.

**Why this approach:** 도구마다 새 표시기를 억지로 붙이지 않고, 기본 표시가 있는 도구는 연속 묶음에서만 요약합니다. 혼자 있을 때와 펼쳤을 때의 원문 미리보기·이미지 동작을 보존할 수 있습니다.

**What it will NOT do:** 사용자 질문과 답변, 오류, 이미지 결과를 숨기지 않습니다. 알 수 없는 미래 도구를 자동으로 접거나, 실제 사용자 세션을 설치·재시작하지 않습니다.

**Effort:** Large
<!-- Effort is exactly ONE band, never hours/days. Quick = single edit, minutes of agent work; Short = one focused change, a few files; Medium = multi-file feature in one session; Large = several waves, one long session; XL = multi-session or architectural work. A written duration is rewritten to a band. -->
**Risk:** Medium - 표시 변경이 원문 복원·실행 상태·긴 기록의 복구와 맞물리므로 실제 터미널 검증이 필요합니다.
**Decisions to sanity-check:** 기본 표시 도구는 혼자 있으면 원래 카드이고, 연속 묶음 안에서만 한 줄이 됩니다. 줄 수 제한은 추가하지 않습니다.

Your next move: 이 계획의 고정밀 검토가 끝나면 별도 실행 단계에서 구현합니다. 계획 작성 승인은 이미 받았으며 추가 승인 질문은 없습니다.

---

> TL;DR (machine): Large / Medium risk / 11 quick implementation-and-QA tasks, 4 final verification tasks, 61 conditional eligible tools, 18 native-preserved tools.

## Scope
### Affected user and ideal state
<!-- From the draft ledger: who this touches and how they use the result, then one IS row per property with its reason, then one GAP row per difference with its reason. Every todo below closes a GAP row; ## Success criteria proves every IS row. -->
**Affected user:** Developers reading and supervising OMO TUI sessions, maintainers updating this extension, and agents/programs consuming the unchanged session records.

| Row | Statement | Reason |
| --- | --- | --- |
| IS-1 | A developer scanning long sessions sees one ordered, meaningful line per eligible call in every consecutive run of 2+. | Remove arbitrary tool-name boundaries, not the activity trail. |
| IS-2 | A supervising developer can distinguish an invocation returning from a background job finishing. | A launch or queued receipt must not look like successful job completion. |
| IS-3 | Errors, partial failures, cancelled or unknown states remain visible outside compact runs. | Intervention must not be concealed by a success-looking group. |
| IS-4 | Questions, human answers, visual deliverables and meaningful notices keep their native surfaces. | These carry decisions or results, not interchangeable log noise. |
| IS-5 | Ctrl+O and header clicks show original cards; recollapse restores every fitting summary for Claude and Codex. | Compression must remain reversible without losing history. |
| IS-6 | Native exploration, renderer overrides, unsupported tools and Grok presentation retain their owner's behavior. | Broader grouping must not steal another component's rendering contract. |
| IS-7 | CJK, narrow/wide terminals, live updates and both light/dark themes remain readable. | Correct strings alone do not prove a usable terminal. |
| IS-8 | Reload, missing seams, malformed data and renderer failures preserve source cards and stored results. | Runtime updates must not break the terminal or session history. |
| IS-9 | Maintainers have deterministic, isolated and reproducible proof for every property. | Earlier mocks missed the real history-window regression. |
| GAP-1 | Todo's title-only card always splits a run. | Its existing plan returns an empty result, not a member line. |
| GAP-2 | 22 audited default/call-only controls cannot join. | The current admission check requires WRAPPED, although native cards can be summarized without changing their renderers. |
| GAP-3 | Bash and glob are omitted. | Bash shares powershell's renderer; glob is not one of the native exploration quartet. |
| GAP-4 | Six known MCP full definitions are excluded with their stubs. | Full definitions have both slots; inactive stubs have only renderCall and must remain native. |
| GAP-5 | Control targets are missing and grouped paths use process cwd. | A group line can lose the run/thread identity or differ from its source card. |
| GAP-6 | Some errors are data without top-level isError. | Thread, workflow, workpool and MCP each have verified structured failure paths. |
| GAP-7 | A line-only group can conceal image-bearing source cards. | Images are siblings of the text renderer. |
| GAP-8 | A broad name-only rule would group human-input operations and eval controls. | Eligibility depends on arguments before a result exists. |
| GAP-9 | Adding absent renderer slots changes native fallback clipping and image mode. | Native behavior tests renderer presence, not just its return value. |
| GAP-10 | Existing grouping tests cover only a small sample of supported tools. | Most existing compact names and all new families lack positive/negative membership proof. |
| GAP-11 | Real narrow CJK and PTY mouse routing lack evidence. | Existing width tests use ASCII/slice and clicks call components directly. |
| GAP-12 | Generic replay overwrites historic captures and has weaker readiness gates. | New evidence must use the stronger isolated history harness and unique paths. |
| GAP-13 | Current docs describe exclusions/invariants that will change. | Maintainers need the distinction between folded cards and projection-only summaries. |
| GAP-14 | Documented tested versions predate the installed runtime. | New receipts must identify the actual runtime rather than reuse old counts. |

The developer currently scans interleaved eval/tool groups and separate todo boxes. After this work, ordinary eligible calls form mixed runs, while native decisions and result surfaces remain visible. Agents and session readers continue consuming the same stored messages; maintainers get explicit finite admission rules.

### Must have

1. One finite, explicit supported universe: all 79 names observed in `.omo/drafts/grouping-active-catalog.md` receive a disposition. Exactly 61 names are conditionally eligible, 18 stay native. This is capability coverage, not a claim that eval-only inner calls produce top-level cards.
2. Renderer-backed set (39 names):
   - Special plans: `eval`, `edit`, `apply_patch`, `todo`.
   - Existing compact names: `web_search`, `webfetch`, `write`, `memory`, `look_at`, `powershell`, `bash_output`, `tool_search`, `task`, `task_output`, `task_send`, `task_cancel`, `team_create`, `team_delete`, `task_create`, `task_get`, `task_list`, `task_update`, `create_goal`, `update_goal`, `get_goal`, `lsp_diagnostics`, `lsp_goto_definition`, `lsp_find_references`, `lsp_symbols`, `lsp_prepare_rename`, `lsp_rename`.
   - New two-slot names: `bash`, `glob`, `mcp__ast_grep_rewrite`, `mcp__ast_grep_scan`, `mcp__ast_grep_search`, `mcp_context7_query-docs`, `mcp_context7_resolve-library-id`, `mcp_grep_app_searchGitHub`.
3. Projection-only set (22 names): `kill_bash`, `monitor`, `schedule_wakeup`, `schedule_prompt`, `workflow`, `workpool`, `thread_create`, `thread_list`, `thread_read`, `thread_send`, `thread_interrupt`, `thread_handoff`, `thread_rename`, `thread_set_model`, `thread_set_reasoning`, `thread_bind`, `thread_unbind`, `thread_rebind`, `thread_bindings`, `thread_report`, `thread_outbox`, `thread_outbox_ack`.
   - Do not install renderer slots for these names. A single card remains native; a run displays computed summaries; expansion renders the same source cards.
   - Require an object tool definition with neither renderer slot. The only explicit call-only exception is `monitor`: its call slot must be a function and its result slot absent.
   - If a future or third-party definition adds a result renderer, do not admit it through this path. Do not silently switch it to wrapping.
4. Native-preserved set (18 names): `bash_input`, `bash_resize`, `read`, `grep`, `find`, `ls`, `request_user_input`, `ask_user_question`, `generate_image`, `read_video`, `show_html_page`, `computer`, `omo_browser_bridge`, `$web_search`, `onboarding_session_history`, `onboarding_understand`, `onboarding_memory_apply`, `thread_answer`.
5. State and content contract:
   - Presentation must be `classic`. Unknown/Grok presentation stays native. Source identity and the existing projection-only ownership model stay intact.
   - Reject error results from both raw `result.isError` and render-context `isError`; native renderResult receives only content/details, so the context check cannot be dropped.
   - For grouping, any present non-array content or any non-text content block rejects the member. Missing content on existing test/minimal snapshots is not alone proof of a failure; keep current compatible shapes. Preserve the original source card's image child and identity. Do not hide its call title by adding a new media fallback slot.
   - Preserve existing eval error/cancelled/unknown-cell and apply_patch partial-failure guards. Check eval `args.action` consistently for call/result/member paths: only absent action or `run` is eligible; `peek`, `stop`, `list` and unknown actions stay native.
   - `monitor(human_input: true)` is a boundary from the pending call onward.
   - `monitor` is otherwise eligible only when action is absent. Rearm and unknown explicit actions stay native: their non-error result can be a no-op. A settled registration requires details.monitor=true and monitor_id/bash_id.
   - `thread_report` is eligible only for `kind: milestone|report|completion`. Missing/unknown kind and `question` remain native. `thread_answer` always remains native.
   - Do not scan arbitrary prose or recursively guess failures from arbitrary fields. Use the exact structured paths below; malformed or unknown required family shapes remain native.
6. Structured result contract:

| Family | Recognized state / rejection | Summary requirement |
| --- | --- | --- |
| Existing ordinary compact tools | Preserve current shapes; reject `details.isError === true` in addition to top-level/context error. For task status output, reject `details.snapshot.status` failed/blocked/cancelled/lost when present. | No new success checkmark for non-eval calls. |
| `workflow` | `details.kind` error is native. Recognized kinds: started, attached, snapshot, waited, detached, cancelled, retried, sent, amended. For snapshot-bearing results read `details.snapshot`; for waited read `details.result.snapshot` and `details.result.status`. Failed/cancelled/unknown run status, nonzero failed/cancelled/skipped counts, failed/cancelled/skipped nodes, or nonempty warnings remain native. Pending/running/paused/completed states are not interchangeable. Sent receipts may use their documented delivery/outcome without a run snapshot. | Show action, run ID/name and reported lifecycle status. A returned start/detached receipt does not mean the run finished. |
| `workpool` | Tool errors remain native. create/inspect/close/cancel return a pool record with status open/closing/cancelled and items; push returns pool_id/item_ids; worker yield returns receipts. Cancelled pool, any item status error/cancelled, item.error, refused yield, or submitted yield error is native. Unknown operation or required shape remains native. | Show op, pool ID/name and known item count; retain open/closing/queued meaning. |
| Eligible `thread_*` | Require `details.result.kind === "ok"`; kind error, missing/unknown kind stays native. Incomplete transcript (`source_incomplete`) or an error_note remains native. An ok send/handoff may have delivery.kind steered/started/queued/queued_offline; retain that label. | Identify target before optional summary. Do not expose reply tokens in compact text. |
| Six exact MCP names | Existing two-slot wrapper requirement remains. Stubs and one-slot definitions are untouched. Reject any `details.error` BEFORE reading preview: refusals carry both. Remote MCP isError is converted into an execution error upstream. Require known full-tool metadata (`details.server`, `details.tool`, string `details.preview`) for settled success; malformed shapes stay native. | Keep tool name, meaningful query/pattern/path, rewrite/apply distinction AND the actual native details.preview string, including "(empty result)". Its original renderer ignores expanded, so never discard that result preview. No MCP wildcard. |
| `bash` / `powershell` | Error and media rules apply. PTY details.background plus details.bash_id identify a launch/detach receipt. Do not infer successful exit from a returned handle. | Description or first command line; append background and its handle when present. |

`bash_input` and `bash_resize` deliberately stay native even on non-error results: unknown keys can be ignored and pipe-backend resize can be a no-op, with no structured discriminator. Do not parse their prose or add an upstream runtime change merely to include them.

For schedules, settled state overrides requested arguments. `schedule_wakeup` uses details.action scheduled/stopped, actual delaySeconds, clamped/noop and ignoredFields; `schedule_prompt` uses details.action, jobs, runnerAvailable and inFlight. Preserve unusual state with an early visible marker (clamped, no-runner, in-flight); an unrecognized required result shape stays native.

7. Target text is safe terminal text: strip terminal escape/control sequences before applying theme styling. Reuse the existing first-line/path helpers where possible; do not pass raw user command/thread/message escapes into projection-only rows.
8. Preserve existing header semantics, first-seen tool counts, no line cap, singleton behavior, thinking bridges, two hidden notice types, and expanded-group rendering. Expanded cards may remain in an expanded non-owning group; expansion itself is not an eligibility error.

### Exact new summary fields

| Tool/family | Required content |
| --- | --- |
| todo | Mirror native title forms: init `(N phases, M tasks)`; append `phase (N items)`; start/done/drop `task or phase`; rm `target or all`; view; missing op uses effective details.op after normalization or bare todo before result. Unknown op remains native. |
| glob | pattern and search path, relative to the card cwd |
| bash_input | Native-preserved: partial key acceptance is reported only in prose. |
| bash_resize | Native-preserved: pipe-backend no-op is reported only in prose. |
| kill_bash | bash_id or all plus the first native receipt line, preserving the actual killed count without parsing prose for success. |
| monitor | Only absent action (registration) is eligible; rearm or unknown action stays native before/after result. Require settled details.monitor=true plus monitor_id/bash_id; show armed, never completed. |
| schedule_wakeup | Use details.action, actual details.delaySeconds and reason; prefix clamped when true and retain noop. Stopped/ignoredFields use the effective result, never the requested delay. |
| schedule_prompt | Use effective details.action/jobs timing. Prefix in-flight on cancel when details.inFlight is true; prefix no-runner on create when runnerAvailable is false. Missing required state stays native. |
| workflow | action, definition.name or run_id, node_id when present, reported lifecycle |
| workpool | op, name/pool_id and known input/result item count |
| thread_create/list/read | name/cwd or returned thread ID; list; target thread |
| thread_send/handoff | target thread, optional summary, delivery label |
| thread_interrupt/rename/set_model/set_reasoning | target plus turn_id/new name/provider-model/level respectively |
| thread_bind/unbind/rebind/bindings | platform/chat/session or binding_id, new session/filter as relevant |
| thread_report/outbox/outbox_ack | non-question kind plus binding_id; binding_id; binding_id plus cursor |
| ast-grep MCP search/rewrite | pattern and first paths entry; apply=true must differ from preview; retain details.preview on result |
| ast-grep MCP scan | ruleFile or first paths entry and apply state plus details.preview on result |
| context7 MCP | libraryId/libraryName and query plus details.preview on result |
| grep.app MCP | query and supplied repo/path plus details.preview on result |

Use plain labels for unsupported optional details; do not invent counts/IDs/status. Missing required identifying input yields native output rather than a misleading empty line.

### Must NOT have (guardrails, anti-slop, scope boundaries)

- No wildcard or prefix enrollment, native ExplorationGroup flattening, read/grep/find/ls wrapper, extra notice hiding, line cap, settings UI, new dependency or native runtime patch.
- No parsing nested eval output into source cards. No mutation/disposal of stored results, source children, private history indices or external tool execution state.
- No synthesized absent renderer slots. Keep existing symbol versions, renderer fallback, lastComponent cleanup and expansion-history reset.
- Do not execute a shell job, send a thread message, ask a human, access an MCP server, create a real workpool, or generate media to test rendering. Use synthetic results with real Senpi components and an isolated PTY replay.
- Do not install/reload in live user sessions or write the real ~/.omo settings. Do not overwrite historical evidence, clear shared caches, or delete resources not created by the executing task.
- Do not fix unrelated upstream errors, redesign header wording, refactor the projection algorithm, or add abstractions merely to split work across agents.

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: TDD within each production task using existing bun:test files; update stale behavior tests only. Tests and implementation share an owner. Pure documentation gets QA by read, never wording-pinning tests.
- Evidence root for this feature: `.omo/evidence/comprehensive-grouping/`. Each provider/width/theme run has its own child directory; historical `.omo/evidence/history-window/` and `.omo/evidence/fold-thinking-eval-group/` remain untouched.
- Run relevant named tests after their change, requiring at least one matching test and zero failures. After final integration, run `bun test` once successfully and `bun test ./qa/real-render.qa.ts` once successfully. A changed input, failure or identified concern is the only reason to rerun.
- Baseline is a clean source tree at the planning snapshot. Read actual tests before changes. Existing failing tests are findings, not tests to weaken.
- Read the programming, bun-1-4, git-master, omo-tui-extension-qa and visual-qa skills in the execution session; browser skill applies when driving xterm through the owned browser.
- LSP: run `lsp_diagnostics` on each changed TypeScript file before test/build. This planning session's symbol request returned Method not found, but file diagnostics worked; do not treat the former as proof diagnostics are unavailable.

### Isolated environment and literal QA invocation

All commands run from the executing checkout. Create a fresh owned root in that run, not the planning run's already-cleaned directory:

```powershell
$run = Join-Path ([IO.Path]::GetTempPath()) ("tool-fold-grouping-" + [Guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $run | Out-Null
$env:TMPDIR=$run; $env:TEMP=$run; $env:TMP=$run
$env:NODE_COMPILE_CACHE=Join-Path $run "node-cache"
$env:BUN_RUNTIME_TRANSPILER_CACHE_PATH=Join-Path $run "bun-cache"
$env:SENPI_DIST="C:/Users/yjack/.omo/agent/runtime/bb7a5bb46b656c02-7e186e28b781/dist"
$env:PI_TUI_DIST="C:/Users/yjack/.omo/agent/runtime/bb7a5bb46b656c02-7e186e28b781/node_modules/@earendil-works/pi-tui/dist"
$env:QA_ROOT=$run
Remove-Item Env:QA_NO_FOLD -ErrorAction SilentlyContinue
```

The harness must set and print every engine child HOME/USERPROFILE/APPDATA/LOCALAPPDATA and brand CODING_AGENT_DIR under its owned scratch path before spawn; assert none points at the user's actual home. Resolve installed runtime/browser packages by explicit paths without changing shared settings. The run root and each browser/process/server it creates get a cleanup todo at creation.

The enhanced history harness retains its existing `--provider claude|codex` CLI and default history behavior. Add only these test controls:
- `QA_SCENARIO=comprehensive-grouping` selects the new deterministic fixture/scenario set.
- `QA_COLS=80|150`, `QA_ROWS=45`, `QA_THEME=dark|<absolute grok-day-focus.json>` select the capture matrix.
- For the custom light theme, copy the repository JSON into the isolated agent's themes directory and set its theme name, not an absolute file path in settings. Use builtin `dark` for dark; legacy history continues to use `grok-day`.
- `EVIDENCE_DIR` continues to select a distinct persistent directory outside scratch.
- In the new comprehensive scenario, refuse a nonempty evidence destination before writing. Each retry uses a fresh attempt suffix. Preserve legacy history defaults, but every command in this plan passes a fresh explicit EVIDENCE_DIR. The component harness likewise receives an explicit new EVIDENCE_DIR.
- `QA_NO_FOLD=1` remains a separate baseline, never a substituted success proof.

For each provider p in claude/codex, each width w in 80/150, and each theme t in light/dark, run the following concrete substitution (eight commands total):

```powershell
$env:QA_SCENARIO="comprehensive-grouping"
$env:QA_COLS="80"; $env:QA_ROWS="45"
$env:QA_THEME=(Resolve-Path "themes/grok-day-focus.json").Path
$env:EVIDENCE_DIR=(Join-Path (Get-Location) ".omo/evidence/comprehensive-grouping/claude-80-light")
bun qa/history-window-replay.mjs --provider claude
```

The other seven invocations replace provider with codex, cols with 150, and/or theme with `dark`; directory names must match p-w-t exactly. Each invocation must exit 0 and produce a report with every scenario assertion true, zero execute calls, initial/expanded/recollapsed and mouse captures, runtime version, action log, ANSI, xterm text/PNG and cleanup receipts. Inspect every PNG, not just report booleans.

Run the original long-history regression for each provider separately after unsetting QA_NO_FOLD/QA_SCENARIO/QA_COLS/QA_ROWS/QA_THEME, with EVIDENCE_DIR `.../history-claude` and `.../history-codex`. Preserve the existing `historyStart: 0 -> positive -> 0`, exact compact-line restoration and source-child identity assertions.

### Deterministic scenario mechanics

- Use the actual TuiMainScreen frame hook already in the history harness. Arm a bounded event promise before each action, then trigger it. No sleep, stability polling, repeated snapshots or arbitrary delay is an assertion.
- Ctrl+O is byte `0x0f`, twice. For mouse QA, find the visible mixed-group header row in the captured terminal text and send SGR left press and release at column 3 of that row: `ESC[<0;3;<row>M`, then `ESC[<0;3;<row>m`. Require native mouse dispatch to toggle all member cards, then toggle back. Component-level handleMouse calls are supporting tests, not this proof.
- Live transitions are proved in G2/G3 of the real-component harness, not invented through the settled-session PTY replay. Use real ToolExecutionComponent.markExecutionStarted(), setArgsComplete(), updateResult(result, true/false) and the actual TuiMainScreen renderer; capture each call-only/partial/settled/failure frame and assert Running/Ran/native-error transitions. These methods are present at runtime tool-execution.js:78-108. No execute body or model prompt runs. The PTY matrix uses settled fixtures with reported background/queued states and proves their visible distinction plus actual input/expansion routing.
- Use a small embedded image content fixture. In a terminal without inline-image support, compare its native image fallback/title to the no-fold baseline and prove it is not absorbed into a line-only group; do not claim unsupported image pixels were rendered.
- Include shell escape/control characters and Korean text in source arguments. Use actual Bun/pi-tui visible width and xterm screenshots, not JavaScript string length or a fake slice.
- Configure xterm's ambient background/foreground for the selected light or dark run; never render a dark terminal onto the old fixed white palette. Capture ANSI color tokens and inspect the matching PNG, including CJK at both widths.
- For each deterministic scene, declare its complete expected summary/unsafe-card marker set from the fixture. Assert every fitting marker after recollapse, not only QA_STEP_1 and QA_STEP_5. Include a mixed renderer-backed/projection-only group and error/image/notice boundaries. Compare initial and recollapsed visible source ranges and retain scrollback captures when the scene spans more than one viewport.
- Add an outside-header SGR click negative: locate a non-group safe text row from that frame, click it, and assert member expansion states are unchanged.
- Before any mouse action, require raw PTY output to contain SGR mouse enable `?1006h` and a tracking mode `?1000h` or `?1002h`. Missing mouse mode is a failed scenario, not a skipped test.
- Track `executeCalls` explicitly, assert it is zero, assert raw output never contains QA_MUST_NOT_EXECUTE and assert source tool-card count matches the synthetic tool/result fixture. A swallowed execute exception must not pass unnoticed.

### Definition provenance for the isolated replay

The synthetic session supplies args/results, not replacement implementations for native tools. Record each fixture's definition source and slot shape in the report. The fixture must include the following representative names; the all-79 matrix remains in unit/real-component coverage.

| Fixture names | Definition source | Required shape |
| --- | --- | --- |
| todo, edit, apply_patch, bash, powershell, glob, read, grep, find, ls | Real isolated-engine builtins | Existing native slots and renderer identities; never register QA replacements |
| kill_bash, monitor, schedule_wakeup, schedule_prompt, bash_input, bash_resize | Real isolated-engine builtins | Actual no-slot/call-only shape; input/resize remain native |
| ask_user_question or request_user_input for the provider | Real isolated-engine builtin | Native question/answer presentation; replay a settled answer without opening a live question |
| eval | QA definition, bundled codemode disabled as in the existing harness | Existing two-slot synthetic eval renderer; execute throws and increments executeCalls |
| workflow, workpool, thread_send, thread_report, thread_answer | QA definitions only when absent from the builtin registry | No slots, exact documented result envelopes; execute throws and increments executeCalls |
| mcp_context7_query-docs | QA full-tool definition only when absent | Two-slot preview-only contract matching installed register.js, not an actual MCP connection |
| mcp_grep_app_searchGitHub | QA inactive-stub definition only when absent | Call-only and non-error inactive text; never promoted or executed |

Use the bound `session_start` handler to call `pi.getAllTools()` before adding synthetic definitions; do not call it at extension module load, when loader.js:188 still binds notInitialized. Reject any collision with a synthetic name, then use dynamic `pi.registerTool` (loader.js:343-360 refreshes tools post-bind). Startup initializes extensions before renderInitialMessages (interactive-mode.js:1246-1250). In the existing renderInitialMessages QA hook, before delegating, require every native fixture name to resolve via `mode.session.getToolDefinition`, check synthetic provenance markers/slot shape and record the source table. Missing definition, wrong native/synthetic provenance or any collision must fail, never skip or silently substitute a fake.

For local offline source confirmation of plugin result envelopes, use `tool.grep` on installed `plugin/extensions/omo-task.js` and `omo-member.js` for the exact discriminants (`queued_offline`, `source_incomplete`, `kind:"ok"`, workpool error/cancelled states); retain bounded matching excerpts with the installed version. Use the pinned official source references to interpret minified matches, not to claim they are local files.

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

Use quick for every implementation/QA unit below. The work has one shared production file, so pretend parallelism would cause conflicts. Keep production tasks 1 -> 2 -> 3 -> 4 -> 5 serialized. The PTY harness track (7) can build against native/no-fold fixtures concurrently; the new real-component expectations (6) and docs (8) start after task 5. This is a deliberate exception to the template's width heuristic: shared-file correctness takes priority.

Mass-ulw phases:
1. Implementation run: nodes 1-9 defined together. Production chain 1->2->3->4->5; node 7 is an independent harness track; node 6 depends on 5 and node 8 depends on 5 and 7. Node 9 depends on all eight and consumes their commits/receipts for integrated validation.
2. Real-surface run: nodes 10 and 11 independently consume node 9's green integration receipt and the committed harness, with disjoint provider evidence/scratch roots. Both include original-history and the four width/theme captures.
3. Final verification run: F1-F4 consume all receipts. Do not rerun a clean scenario merely for ceremony; verify its actual artifact and current tree identity. F3 is the lead's inspection of the real surface and captured actions.

All nodes write bounded evidence receipts to `.omo/evidence/comprehensive-grouping/task-N.md` as their last act; dependent nodes read those exact files and reject a missing receipt. Every task owns only the listed paths. No unspecified-low node. No team is needed because parallel file scopes are disjoint; commits on the integration branch remain serialized by the lead.

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | none | 2 | 7 |
| 2 | 1 | 3 | 7 |
| 3 | 2 | 4 | 7 |
| 4 | 3 | 5 | 7 |
| 5 | 4 | 6,8,9 | 7 |
| 6 | 5 | 9 | 7,8 |
| 7 | none; frozen plan contract | 8,9 | 1-6 |
| 8 | 5,7 | 9 | 6 |
| 9 | 1,2,3,4,5,6,7,8 | 10,11 | none |
| 10 | 9 | F1,F2,F3,F4 | 11 |
| 11 | 9 | F1,F2,F3,F4 | 10 |

## Todos
> Implementation + Test = ONE todo. Never separate.
<!-- APPEND TASK BATCHES BELOW THIS LINE WITH edit/apply_patch - never rewrite the headers above. -->
- [x] 1. Preserve state, media and card-context boundaries
  - Recommended task executor category: quick - one existing eligibility/render path and its neighboring tests.
  - Scope: `extension/tool-fold.ts`, `test/tool-fold.test.ts`. Read first; no other production files.
  - What to do: pass snapshot.identity.cwd into non-eval line construction; make eval run/control argument handling consistent in result and member paths; reject grouping on non-text/malformed content; preserve top-level/context and documented semantic error results. Keep media source-card rendering/title intact rather than adding a result-slot fallback that loses its call.
  - Must NOT do: change group ownership, history reset, notice whitelist, symbols, counts or line caps; recursively search text for failure words.
  - Closes: GAP-5, GAP-6, GAP-7, GAP-8.
  - Parallelization: run 1; depends on none; blocks 2; parallel with 7.
  - References: `extension/tool-fold.ts:165-211,273-310,323-413,492-540`; `test/tool-fold.test.ts:235-297,399-597`; runtime `tool-execution-renderer.js:115-175`, `tool-execution.js:225-233`; `.omo/drafts/grouping-advice-contracts.md`; structured result table in this plan.
  - Acceptance criteria: `lsp_diagnostics` has no new error; `bun test test/tool-fold.test.ts -t "grouping eligibility"` runs matching tests and passes; existing named eval/error cases still pass.
  - QA scenarios: Q1+ create two successful text cards with identity.cwd `C:/work/project` and path `C:/work/project/a.ts` while process cwd differs; assert ordered membership and `a.ts`. Q1- interleave peek without details.action, cancelled/unknown eval, details.isError, a mixed complete/error cell list, and an image-bearing result; assert each unsafe card stays outside groups, original result content/image identity remains, and no source array/result mutation occurs. Add presentation="grok" for one renderer-backed and one projection-only name and require grouped=false. Include ANSI/control text input with no terminal-control leakage.
  - Evidence: `.omo/evidence/comprehensive-grouping/task-1.md`, named test output and before/after source identity assertions.
  - Commit: Y, after green checks - `tool-fold: preserve state and card context in grouping`.

- [x] 2. Join every valid todo operation without replacing its renderer
  - Recommended task executor category: quick - one native-title formatter and one membership branch.
  - Scope: `extension/tool-fold.ts`, `test/tool-fold.test.ts`.
  - What to do: add a pure todo member-line formatter that mirrors the installed native title forms specified above. Keep todoPlan's standalone renderer behavior and empty result unchanged. Use args.op before a result; after a result, details.op is authoritative and init totals come from details.phases. Missing op before result is bare todo; unknown explicit op is native. Preserve pending state and original expanded checklist.
  - Closes: GAP-1, GAP-10.
  - Parallelization: run 1; depends on 1; blocks 3; parallel with 7.
  - References: runtime `todotools/tools/todo.js:37-73,255-287`; `extension/tool-fold.ts:264-270,389-413`; `test/tool-fold.test.ts:252-262`; `extension/eval-run.ts:29-79`.
  - Acceptance criteria: `bun test test/tool-fold.test.ts -t "todo grouping"` passes matching cases for init/start/done/drop/rm/append/view and normalized/missing op; existing standalone todo test remains valid.
  - QA scenarios: Q2+ two todos form one mixed-tool block; eval/done/eval forms `Ran 3 tools` with eval 2 and todo 1, ordered task text. Init counts both phased list and flat items; append/rm/phase forms mirror native semantics. Q2- failed todo, unknown op and a malformed required target stay native; expand reveals the original checklist, not the generated title repeated in place of it.
  - Evidence: `.omo/evidence/comprehensive-grouping/task-2.md`.
  - Commit: Y - `tool-fold: include todo titles in consecutive tool groups`.

- [x] 3. Admit audited terminal, schedule and workflow controls by projection
  - Recommended task executor category: quick - six explicit names, known result predicates and no renderer mutation.
  - Scope: `extension/tool-fold.ts`, `test/tool-fold.test.ts`.
  - What to do: add a finite projection-only set and admission branch for kill_bash/monitor/schedule_wakeup/schedule_prompt/workflow/workpool. Definitions with no slots qualify; monitor alone accepts the audited call-only shape. Keep default and call-only renderer identities exactly unchanged. Produce the exact target/lifecycle summaries above using safe text. Apply human_input, workflow warnings/errors/node states and workpool error/receipt guards. Keep unknown required shapes native.
  - Closes: GAP-2, GAP-5, GAP-6, GAP-8, GAP-9, GAP-10.
  - Parallelization: run 1; depends on 2; blocks 4; parallel with 7.
  - References: `extension/tool-fold.ts:365-413,441-518`; runtime `tool-execution.js:214-222`, `tool-execution-fallback-preview.js:1-20`, terminal `monitor.js:84-145`; current schemas in `.omo/drafts/grouping-candidate-schemas.md`; pinned OMO v5.1.44 `components/task/dag-tool-contract.ts:64-95,120-139`, `packages/senpi-task/src/tools/workpool.ts:17-22,38-60,83-91`, `workpool/types.ts:30-67`, `workpool/engine.ts` create/inspect/push/close/cancel returns.
  - Acceptance criteria: `bun test test/tool-fold.test.ts -t "default control grouping"` passes; compare own renderer properties before/after getToolDefinition and require equality/absence; no execute function is invoked.
  - QA scenarios: Q3+ each of six valid definitions joins an eval/default-control run and preserves its target; a lone card stays the same object/native view; background/queued/closing labels remain distinguishable from complete. A requested wakeup of 1 second with details.delaySeconds=60/clamped=true must show 60 and clamped; a scheduled cancel with inFlight=true must show in-flight; runnerAvailable=false must show no-runner. Q3- a newly supplied custom result renderer, missing definition, human-input/rearm monitor, workflow details.kind error, failed child count despite running parent, pool item.error, refused yield, unknown shape and media all remain native. bash_input ignored-key and bash_resize no-op fixtures remain native regardless of isError=false. Assert renderer slot identity/absence equality here; actual 9/10/11-line fallback equality belongs to G8, not the fake-module suite.
  - Evidence: `.omo/evidence/comprehensive-grouping/task-3.md`.
  - Commit: Y - `tool-fold: group audited controls without replacing native renderers`.

- [x] 4. Admit ordinary thread receipts while preserving human decisions
  - Recommended task executor category: quick - sixteen explicit names sharing one documented result union.
  - Scope: `extension/tool-fold.ts`, `test/tool-fold.test.ts`.
  - What to do: extend the projection-only set with the sixteen eligible thread names above. Require no renderer slots and details.result.kind ok after result; retain kind error/unknown/missing, source_incomplete and error_note. Format each target from the exact field table. Preserve queued_offline versus started/steered deliveries. Exclude thread_answer and question/missing/unknown thread_report kinds from the pending call onward.
  - Closes: GAP-2, GAP-5, GAP-6, GAP-8, GAP-10.
  - Parallelization: run 1; depends on 3; blocks 5; parallel with 7.
  - References: `.omo/drafts/grouping-candidate-schemas.md`; pinned OMO v5.1.44 `packages/omo-senpi/src/components/thread/tools/internals.ts:14-21`, `thread/contracts/results.ts` ThreadToolResult/ThreadDelivery/ThreadReadResult/ThreadReportResult; `extension/tool-fold.ts` projection-only branch from task 3.
  - Acceptance criteria: `bun test test/tool-fold.test.ts -t "thread grouping"` passes a table of all sixteen eligible names and the excluded answer; `execute` spies remain zero.
  - QA scenarios: Q4+ synthetic ok receipts for all sixteen names form ordered groups with thread/binding identity; send/handoff labels preserve queued_offline. Q4- a non-isError `{details:{result:{kind:"error",error:{code:"invalid_arguments"}}}}` remains an original card; question/answer receipts and unknown kinds stay visible before and after result; source_incomplete and error_note are not summarized away. No real messages, bindings, answers or external writes.
  - Evidence: `.omo/evidence/comprehensive-grouping/task-4.md`.
  - Commit: Y - `tool-fold: group ordinary thread receipts and retain decision cards`.

- [x] 5. Add audited native and full-MCP folds and complete the tool matrix
  - Recommended task executor category: quick - explicit allowlist additions and table-driven tests using existing wrappers.
  - Scope: `extension/tool-fold.ts`, `test/tool-fold.test.ts`.
  - What to do: add bash/glob and the six exact MCP names to the renderer-backed path; keep the two-slot requirement. Add only the summary selectors needed by the field table. Preserve bash/powershell background IDs, MCP details.error refusals and remote errors. Use one independent fixture table covering all 61 eligible names and all 18 preserved names; do not derive the expected set from the production allowlist.
  - Closes: GAP-3, GAP-4, GAP-5, GAP-6, GAP-10.
  - Parallelization: run 1; depends on 4; blocks 6,8,9; parallel with 7.
  - References: runtime `core/tools/find.js:265`, `glob.js:1-12`, `renderers/index.js:24-46`, `terminal/tools/bash.js:290-350`; MCP `expose/register.js:19-78`, `schema-compat.js:33-39`, `tier-b.js:145-173`; `extension/tool-fold.ts:25-78,273-316,349-362`; `.omo/drafts/comprehensive-tool-grouping-inventory.md`.
  - Acceptance criteria: `bun test test/tool-fold.test.ts -t "audited renderer grouping"` passes every fixture and a novel unknown name; native read/grep/find/ls renderer identities are unchanged. All old compact tools still contribute their original meaningful line.
  - QA scenarios: Q5+ successful bash/glob/full-MCP cards join with correct command/query/path, write-preview distinction and the native result preview (including "(empty result)"); the 79-row fixture matrix accounts for every name. Q5- call-only MCP stub returns non-error inactive guidance and remains native; full MCP details.error refusal, image result, missing metadata, original renderer error and an unknown future name are not grouped. A server `$web_search` arbitrary-record echo remains untouched.
  - Evidence: `.omo/evidence/comprehensive-grouping/task-5.md`, machine-readable 79-name coverage results.
  - Commit: Y - `tool-fold: fold audited shell glob and full MCP tools`.

- [x] 6. Prove the policy with real Senpi rendering components
  - Recommended task executor category: quick - focused additions to the existing real-component harness.
  - Scope: `qa/real-render.qa.ts`; do not edit production code or unit-test files.
  - What to do: extend the installed-class harness with synthetic tool definitions/results for renderer-backed and projection-only families. Use the exact no-slot/call-only/two-slot shapes, real native fallback, actual truncateToWidth/visible-width behavior, and throw if any fixture execute is called. Add G1-G8 cases; preserve R1-R12 and both history tests.
  - Closes: GAP-9, GAP-10, GAP-11, GAP-14.
  - Parallelization: run 1; depends on 5; blocks 9; parallel with 7,8.
  - References: `qa/real-render.qa.ts:23-148,178-374`; runtime `tool-execution-renderer.js:134-181`, `tool-execution.js:214-233`; `test/eval-group-view.test.ts:120-151`.
  - Acceptance criteria: `bun test ./qa/real-render.qa.ts -t "^G[1-8] "` runs all eight named cases and passes using the installed runtime.
  - QA scenarios: Q6+ G1 todo mixed run, G2 default controls/native fallback with call-only -> partial -> settled/failure frames, G3 thread lifecycle and background/queued receipt distinctions, G4 full MCP and shell/glob, G5 actual 24/80/150-cell CJK width and sanitized controls, G6 header expansion/click and re-collapse. Q6- G7 errors/media/questions/stubs/custom-renderer takeover plus actual Grok ToolExecutionComponents for one renderer-backed and one projection-only name (grouped=false), G8 exact 9/10/11-line fallback equality and reload/missing-seam behavior. For G8 render a settled no-slot definition before extension load, then after load: require own slots still absent and lone-card raw ANSI byte-identical. Compare expanded group member-body ANSI to the original cards with only the known group-header rows excluded. Capture unmodified source children/results and zero executions for every case. Keep both original history fixtures green.
  - Evidence: `.omo/evidence/comprehensive-grouping/components/` ANSI/text and `.omo/evidence/comprehensive-grouping/task-6.md`.
  - Commit: Y - `tool-fold: verify comprehensive groups with real Senpi components`.

- [x] 7. Extend the isolated replay with deterministic grouping scenarios
  - Recommended task executor category: quick - one existing QA harness, controlled test-only inputs and fixture operations.
  - Scope: `qa/history-window-replay.mjs`; do not edit `qa/live-replay.mjs` or historical captures.
  - What to do: retain default history behavior and add the documented QA_SCENARIO/QA_COLS/QA_ROWS/QA_THEME controls. Add deterministic settled fixture scenes for todo/mixed tools, native defaults, MCP full/stub, semantic failures, decisions/media, background/queued receipts and native exploration. Follow the definition-source table and collision checks. Add frame-subscribed SGR mouse actions, per-scene captures and assertions, version/provenance and cleanup receipts. Run the nonempty-evidence guard before existing mkdir/write calls; an existing empty directory is allowed. Preserve raw ANSI and xterm screenshots. Fixtures execute nothing.
  - Closes: GAP-9, GAP-10, GAP-11, GAP-12, GAP-14.
  - Parallelization: run 1; depends on none; blocks 8,9; parallel with 1-6.
  - References: `qa/history-window-replay.mjs:1-45,49-195,318-352`; `.omo/drafts/grouping-research-qa.md` (discard its rejected todo-exclusion suggestion); `CLAUDE.md` isolated QA contract; exact invocation/mechanics sections above.
  - Acceptance criteria: `bun build qa/history-window-replay.mjs --target=bun --packages=external --outdir "$run/qa-build"` exits 0; a native `QA_NO_FOLD=1` run of the new fixture executes no tools, captures all required states and cleans its own resources. This validates the harness, not the new grouping behavior; tasks 10/11 supply feature proof.
  - QA scenarios: Q7+ set `$env:QA_NO_FOLD="1"; $env:QA_SCENARIO="comprehensive-grouping"; $env:EVIDENCE_DIR=(Join-Path (Get-Location) ".omo/evidence/comprehensive-grouping/harness-native")` and run `bun qa/history-window-replay.mjs --provider claude`; require every native baseline assertion and cleanup receipt. Q7- set `$env:QA_COLS="0"` and run the same command; require nonzero exit before engine spawn and no leftover scratch. Restore QA_COLS and unset QA_NO_FOLD afterward. Frame deadlines must fail visibly with teardown, never turn into a success fallback.
  - Evidence: `.omo/evidence/comprehensive-grouping/harness-native/` and `task-7.md`.
  - Commit: Y - `tool-fold: add deterministic mixed-tool replay coverage`.

- [x] 8. Document the finite policy and native-preserving behavior
  - Recommended task executor category: quick - bounded documentation updates using the completed implementation contract.
  - Scope: `README.md`, `README.ko.md`, `CLAUDE.md`.
  - What to do: distinguish standalone folds from projection-only members, include todo and new families, document the 61/18 finite scope, native decisions/media/stubs, background receipt meaning, no line cap and unchanged Ctrl+O behavior. Update engineering invariants that currently require WRAPPED for every member. Describe isolated new QA commands and future catalog-diff audit. Keep historical tested-version paragraphs historical; new receipts carry actual versions, and do not relabel old runs.
  - Closes: GAP-13, GAP-14.
  - Parallelization: run 1; depends on 5,7; blocks 9; parallel with 6.
  - References: current `README.md:58-100,118-159`, Korean mirror; `CLAUDE.md` Architecture/Invariants/Live TUI check; final 79-row inventory and this plan.
  - Acceptance criteria: read both languages side by side; every stated inclusion, exclusion and command matches the implemented constants/QA parser. No prose tests. Do not change install instructions or unrelated theme behavior.
  - QA scenarios: Q8+ manually trace each documented family to an implemented admission path and each new command to the harness parser. Q8- check that examples never show a question/image/error in a compact block, never promise every possible future tool, and never claim a background job completed from its launch receipt.
  - Evidence: `.omo/evidence/comprehensive-grouping/task-8.md` with a claim-to-source checklist.
  - Commit: Y - `tool-fold: document comprehensive and projection-only grouping`.

- [x] 9. Integrate once and run the complete code-level regression checks
  - Recommended task executor category: quick - deterministic integration gate, not new design.
  - Scope: read task 1-8 commits/receipts and final source; write only the integration evidence receipt unless an in-scope failure requires returning work to its owner.
  - What to do: verify disjoint changes were integrated in dependency order, inspect the full diff, run diagnostics, full unit suite and complete real-component suite. Verify no skip/only/xfail/sleep was introduced, no unexpected file was changed and the default history scenario still parses unchanged.
  - Closes: GAP-10, GAP-14.
  - Parallelization: run 1 final gate; depends on 1-8; blocks 10,11.
  - References: all producer receipts; `package.json` scripts; `test/*.test.ts`; `qa/real-render.qa.ts`; no new external test framework.
  - Acceptance criteria: `bun test` exits 0 in a single reliable run; set `$env:EVIDENCE_DIR=(Join-Path (Get-Location) ".omo/evidence/comprehensive-grouping/components")` before `bun test ./qa/real-render.qa.ts`, which must exit 0; changed TypeScript diagnostics have no errors. Record actual counts rather than historical 74/82/88 figures. Use a fresh suffixed component directory if one already exists and record its exact path in task-9.md so final verifiers do not read task 6's older capture.
  - QA scenarios: Q9+ capture both commands, current tree/runtime and zero-failure summaries. Q9- inspect representative semantic-error/media/decision/native-fallback assertions and confirm they would fail if the gate was removed; do not modify tests merely to make a failure disappear. Preserve pre-existing failures as findings.
  - Evidence: `.omo/evidence/comprehensive-grouping/task-9.md`, unit/component output and source/diff audit.
  - Commit: N - evidence-only gate; each producer commit must already be independently buildable and tested.

- [x] 10. Capture Claude-shaped real-TUI proof across widths and themes
  - Recommended task executor category: quick - execute the fixed replay matrix and inspect its real surface.
  - Scope: task-owned processes/browser/scratch and `.omo/evidence/comprehensive-grouping/claude-*`, `history-claude`; no source edits.
  - What to do: execute all four documented Claude width/theme invocations plus the unmodified original-history scenario. Inspect every captured xterm PNG and action trace. Each scenario includes Ctrl+O twice, a real PTY header click twice, settled background/queued state distinctions, errors/decisions/media and native/default fallback. Real-component G2/G3 evidence owns the live transition proof.
  - Closes: GAP-7, GAP-9, GAP-10, GAP-11, GAP-12, GAP-14.
  - Parallelization: run 2; depends on 9; parallel with 11; blocks all final verifiers.
  - References: task-9.md, task 7's committed harness, the literal QA matrix and deterministic mechanics above, existing history-window regression receipt.
  - Acceptance criteria: every invocation exits 0, every report assertion is true, no tool execute is called, widths do not overflow, every fitting compact row/error/latest response returns, and no process/server/profile/scratch remains.
  - QA scenarios: Q10+ Claude 80-light, 80-dark, 150-light, 150-dark each show ordered summaries and exact Ctrl+O/mouse restoration. Q10- semantic-error/partial-failure, question/answer, media, inactive-stub and renderer-takeover fixture cards remain visible; original-history run retains historyStart restoration and original source identities.
  - Evidence: the five named directories, all ANSI/text/PNG/actions/report/cleanup files and `task-10.md`.
  - Commit: N - evidence only; fix any feature failure in its smallest owning production task before recapturing affected cases.

- [x] 11. Capture Codex-shaped real-TUI proof and complete resource teardown
  - Recommended task executor category: quick - independent provider fixture and disjoint evidence paths.
  - Scope: task-owned processes/browser/scratch and `.omo/evidence/comprehensive-grouping/codex-*`, `history-codex`; no source edits.
  - What to do: run the four Codex width/theme invocations and original-history scenario; inspect every xterm PNG. Use empty Codex reasoning exactly as existing history fixture does, not a renamed Claude fixture. After all owned child processes exit, remove only this run's recorded scratch/cache/profile paths.
  - Closes: GAP-7, GAP-9, GAP-10, GAP-11, GAP-12, GAP-14.
  - Parallelization: run 2; depends on 9; parallel with 10; blocks all final verifiers.
  - References: same sources as task 10, plus `qa/real-render.qa.ts:319-374` Codex empty-reasoning case and history harness provider selection.
  - Acceptance criteria: the same binary predicates as task 10, plus a read-back process audit and absence checks for every recorded owned root. Never glob-delete shared Temp or browser cache directories.
  - QA scenarios: Q11+ Codex 80-light, 80-dark, 150-light, 150-dark preserve ordering, narrow CJK and re-collapse. Q11- all unsafe fixture cards stay native; original-history regression restores compact rows and final response; a scoped process query finds zero owned live processes and fs.stat on removed roots reports absence.
  - Evidence: the five named directories, all ANSI/text/PNG/actions/report/cleanup files and `task-11.md`.
  - Commit: N - evidence only; retain all receipts outside deleted scratch.

- [x] 12. Settle a stopped wakeup receipt as finished (follow-up from review-qa-2.md)
  - Recommended task executor category: quick - one status value and its test.
  - Scope: `extension/tool-fold.ts`, `test/tool-fold.test.ts`.
  - What to do: a settled schedule_wakeup with details.action "stopped" is a terminal acknowledgement; give its member line status "complete" (row text keeps "stopped") so a group of finished receipts reads "Ran", consistent with schedule_prompt cancel without in-flight. A scheduled wakeup stays non-complete.
  - Closes: IS-2 regression found by review-qa-2.md (a stopped wakeup kept the group header Running indefinitely).
  - Acceptance criteria: a test proves [eval, schedule_wakeup stopped] reads "Ran 2 tools" while [eval, schedule_wakeup scheduled] still reads "Running 2 tools"; reverting the status makes it fail; `bun test` exits 0; lsp_diagnostics clean.
  - Commit: Y - `tool-fold: settle stopped wakeup receipts as finished`.

- [x] 13. Use exact documented result envelopes in the replay fixture (follow-up: invalid proof found by root after task 10/11)
  - Recommended task executor category: unspecified-high - the PTY harness needed two live repairs; envelopes must match product admission and the installed runtime.
  - Scope: `qa/history-window-replay.mjs` only; evidence under `.omo/evidence/comprehensive-grouping/`.
  - What to do: the fixture gives schedule_wakeup no details.reason, schedule_prompt no args.action and jobs without {state, job}, schedule_prompt cancel job_id instead of id, workflow snapshots without counts/nodes, and workpool records nested under details.pool. Those eligible receipts therefore render native in the real engine, and the PTY never proves that they group. Rewrite every eligible fixture envelope to the installed runtime / plan-documented shape. Intentionally unsafe fixtures stay as they are.
  - Acceptance criteria: in every comprehensive run, the native-defaults scene shows one Running group holding kill_bash, monitor, schedule_wakeup (60s clamped), schedule_prompt (no-runner), workflow (running) and workpool (open), and the receipts scene shows eligible queued_offline / in-flight receipts inside a group while the human_input monitor stays a native boundary. All 8 matrix runs and both history runs exit 0 with every assertion true, and an independent reviewer confirms.
  - Commit: Y - `tool-fold: use documented result envelopes in the grouping replay fixture`.

- [x] 14. Document that a slotless runtime bash stays native (follow-up: PLAN CONFLICT found by fix-13)
  - Recommended task executor category: quick - one sentence in three docs.
  - Scope: `README.md`, `README.ko.md`, `CLAUDE.md`.
  - What to do: the installed runtime's terminal `bash` definition (builtin/terminal/tools/bash.js, exposed to models through eval) has neither renderCall nor renderResult. Per the no-synthesized-slots guardrail, its top-level cards therefore stay native, while powershell, glob and the other renderer-backed names keep two slots and fold. State that bash folds only when its definition has both renderer slots. Change nothing else.
  - Acceptance criteria: both READMEs and CLAUDE.md say the same thing, the claim traces to the report's definition table and the runtime source, and an independent reviewer confirms.
  - Commit: Y - `tool-fold: note that slotless runtime bash cards stay native`.

- [x] 15. Strip interior CR/TAB from renderer-backed rows (follow-up: F2 should-fix S1)
  - Recommended task executor category: quick - one helper and its tests.
  - Scope: `extension/tool-fold.ts`, `test/tool-fold.test.ts`.
  - What to do: `firstLine` applies terminalSafe per line, but CONTROL_SEQUENCE skips \r and \t. Compact rows (describe), the shell command line and the eval summary can therefore carry an interior CR, which moves the cursor to column 0 and overwrites the row, or a TAB, which counts as one cell but expands up to 8 and can overflow 80 columns. Replace interior CR/TAB with a space in the selected line, and pass schedule_wakeup ignoredFields through plainText. This completes Must-have 7 and IS-7.
  - Acceptance criteria: tests prove that `build\rOK` and `a\tb` become single-space-separated text in a compact row, a powershell row and an eval summary, and that ignoredFields control text is stripped; reverting the change fails them; `bun test` and `bun test ./qa/real-render.qa.ts` exit 0; lsp_diagnostics clean; an independent reviewer confirms.
  - Commit: Y - `tool-fold: replace interior CR and TAB in folded rows`.

## Final verification wave
> Runs after ALL todos. ALL must APPROVE. The user preapproved this planning scope and requested no repeated approval questions; report the verified outcome without a new confirmation gate. Any new destructive/external action remains outside scope.
- [x] F1. Plan compliance audit
  - Recommended task executor category: quick - mechanical finite inventory and receipt audit.
  - References: final plan, 79-name fixture result, task-1.md through task-11.md and final diff.
  - Acceptance criteria: all 61 conditional names and 18 preserved names are accounted for; every task is green or has a fixed/rechecked failure; no outside-scope change.
  - QA scenarios: QF1+ compare actual fixture rows against the independent catalog and plan. QF1- remove one row in a memory-only validation copy and require the inventory audit to reject it.
  - Evidence: `.omo/evidence/comprehensive-grouping/f1.md`.
  - Commit: N.
- [x] F2. Code quality review
  - Recommended task executor category: deep-high - correctness depends on cross-renderer ownership and failure invariants rather than one test; this is the single non-quick final review.
  - References: final diff, native rendering/preview contracts, production state predicates, test mocks and integration receipt.
  - Acceptance criteria: no source/result mutation, synthesized renderer slot, unknown-tool enrollment, private-index write, suppressed failure, timing-luck test or stale wrapper component; no blocker affecting an IS row.
  - QA scenarios: QF2+ review all new eligibility branches against exact native shapes and result discriminants. QF2- trace media, no-slot 11-line fallback, MCP refusal and semantic thread/workflow errors to their actual rejection paths; reject any unsupported inference.
  - Evidence: `.omo/evidence/comprehensive-grouping/f2.md`.
  - Commit: N; blockers return to their owning task.
- [x] F3. Real manual QA
  - Recommended task executor category: quick - fixed evidence inspection; the lead owns the surface check.
  - References: task-10.md/task-11.md, every xterm PNG/ANSI/action/report and original-history receipt.
  - Acceptance criteria: the lead actually opens every scenario capture; no blank/clipped/overlapping/misframed screen, hidden decision/image/error, missing fitting row or unverified mouse path. Runtime/tree identity and cleanup receipts match.
  - QA scenarios: QF3+ inspect all eight matrix runs and two original-history runs. QF3- compare unsafe-card/title/image cases against native baseline and inspect recollapsed frames for lost early rows; an incomplete artifact or uninspected frame is FAIL, not a note.
  - Evidence: `.omo/evidence/comprehensive-grouping/f3.md`, per-capture PASS/FAIL.
  - Commit: N; rerun only invalidated evidence.
- [x] F4. Ideal-state fidelity
  - Recommended task executor category: quick - explicit one-to-one traceability gate.
  - References: the Success criteria table below and all final receipts.
  - Acceptance criteria: all nine IS rows have observed proof and every GAP has a delivering task; no percentage claim without the complete table.
  - QA scenarios: QF4+ mark each IS row PASS only with its exact scenario artifacts. QF4- deliberately blank one evidence link in a memory-only copy and require the gate to fail. Any real shortfall becomes a concrete in-scope task with a new proof, never an exception.
  - Evidence: `.omo/evidence/comprehensive-grouping/f4.md`.
  - Commit: N.

## Commit strategy

Follow the existing `tool-fold: <imperative>` history. Read `git log --oneline -20` and touched-path history before each commit. Commit one verified increment with only its owned files; serialize Git writes even when disjoint workers run concurrently. Task 7 may commit its native-validated harness before production completes because the new scenario is opt-in and existing default behavior remains green. Task 6 waits for production behavior before committing its positive cases. No push, install, reload, PR or live-session update is part of this plan.

Fixes discovered by integrated/real-surface checks belong to the smallest affected owner and are reverified before their own commit. Do not amend, reset, force-push or modify unrelated user work. Evidence-only tasks do not force ignored screenshots into Git; their durable receipts identify the exact source tree.

## Success criteria
> One row per IS row. The plan is complete only when every IS row has a delivering todo and a proving QA scenario; F4 checks the delivered behavior against these rows 1:1, and a shortfall becomes new `- [ ] N.` rows, never a note.
| IS | Delivering todo(s) | Proving QA scenario | Evidence |
| --- | --- | --- | --- |
| IS-1 | 2,3,4,5 | Q2+, Q3+, Q4+, Q5+, Q10+, Q11+ | task-2..5.md; all eight matrix runs |
| IS-2 | 3,4,5,6 | Q3+, Q4+, Q5+, Q6+ G2/G3 live frames; settled receipt distinctions in Q10+/Q11+ | task-3..6.md; actual TuiMainScreen state captures and matrix receipts |
| IS-3 | 1,3,4,5 | Q1-, Q3-, Q4-, Q5-, Q10-, Q11- | task-1,3,4,5.md; unsafe-card scenes |
| IS-4 | 1,3,4,5,6 | Q1-, Q3-, Q4-, Q5-, Q6- | native/media/decision scenes and task-6.md |
| IS-5 | 2,3,6,10,11 | Q2-, Q3-, Q6+, Q10+, Q11+ | components; initial/expanded/recollapsed/mouse captures; history-claude/codex |
| IS-6 | 1,3,5,6 | Q1- Grok snapshots, Q3-, Q5-, Q6- G7 actual Grok cards | renderer-identity, native exploration, explicit Grok and takeover cases |
| IS-7 | 6,7,10,11 | Q6+ G2/G3 live frames and G5 widths, Q7+, Q10+, Q11+ | actual TuiMainScreen state captures; 24-cell component proof; 80/150 light/dark matrix |
| IS-8 | 1,3,5,6,9 | Q1-, Q3-, Q5-, Q6-, Q9- | source-identity, reload, missing-seam and fallback assertions |
| IS-9 | 7,8,9,10,11 | Q7+/-, Q8+/-, Q9+, Q10-, Q11-, QF1-QF4 | all task/final receipts and owned-resource cleanup |

### Gap closure ledger

| Gap | Delivering tasks |
| --- | --- |
| GAP-1 | 2 |
| GAP-2 | 3,4 |
| GAP-3 | 5 |
| GAP-4 | 5 |
| GAP-5 | 1,3,4,5 |
| GAP-6 | 1,3,4,5 |
| GAP-7 | 1,10,11 |
| GAP-8 | 1,3,4 |
| GAP-9 | 3,6,7,10,11 |
| GAP-10 | 2,3,4,5,6,7,9,10,11 |
| GAP-11 | 6,7,10,11 |
| GAP-12 | 7,10,11 |
| GAP-13 | 8 |
| GAP-14 | 6,7,8,9,10,11 |
