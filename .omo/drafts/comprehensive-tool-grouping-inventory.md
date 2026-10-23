# Comprehensive tool grouping inventory

Status: source-grounded decisions with advisory integration; awaiting independent plan review.
Runtime: Senpi 2026.10.21-3; OMO 5.1.44. Active catalog captured 2026-10-23 via tool_schema().

## Denominator and decision rule

- Exactly 79 active-catalog names; 31 currently have a fold plan, of which 30 can produce group lines and todo cannot.
- Explicit conditional eligible set: 61; native-preserved set: 18. There are 30 new tool names plus todo's newly supported membership. Of the eligible names, 39 have renderer-backed fold plans (including todo) and 22 use projection-only admission. Every name remains conditional on state and content.
- Exposure is not visibility: eval-only inner calls are not separate transcript cards. Do not parse nested eval output into new members. Eligibility applies only when a genuine top-level classic ToolExecutionComponent exists.
- Unknown future names, unsupported presentations and dynamic catalog additions remain native; no wildcard enrollment.
- One successful invocation contributes one ordered line. A group remains a non-owning projection of two or more eligible source cards.

## Source key

All R paths below are relative to C:/Users/yjack/.omo/agent/runtime/bb7a5bb46b656c02-7e186e28b781 unless stated otherwise.

| Key | Source |
| --- | --- |
| L1 | extension/tool-fold.ts:25-78,165-316,349-413; test/tool-fold.test.ts:252-297; archived grouping-research-local.md |
| R1 | dist/core/tools/index.js:18-45; dist/core/tools/renderers/index.js:24-46; dist/core/tools/glob.js:1-12; dist/modes/interactive/components/exploration-call.js:29-40; shell renderers/bash.js:100-135 |
| R2 | dist/core/extensions/builtin/terminal/shared.js:4-9; terminal/extension.js:112-118; terminal/tools/monitor.js:84-145; bash-output.js:36-70; exact inputs in grouping-candidate-schemas.md |
| R3 | dist/core/extensions/builtin/todotools/tools/todo.js:208-289; local todoPlan at extension/tool-fold.ts:264-270 |
| R4 | dist/core/extensions/builtin/loop/tools.js:147-154; schedule/tool.js:136-143; exact active schemas in grouping-candidate-schemas.md |
| R5 | C:/Users/yjack/.bun/install/global/node_modules/omo-ai/plugin/extensions/omo-task.js:2; archived grouping-research-runtime.md lists registration source paths; current tool_schema input records in grouping-candidate-schemas.md |
| R6 | C:/Users/yjack/.bun/install/global/node_modules/omo-ai/plugin/extensions/omo-member.js:2; 17 exact active names in grouping-active-catalog.md and current input schemas in grouping-candidate-schemas.md |
| R7 | dist/core/extensions/builtin/mcp/expose/register.js:12-15; tier-b.js:25-89,145-173; deferred stubs can return inactive guidance without top-level isError |
| R8 | dist/core/extensions/builtin/ask-user/family.js:4-5, tool.js:326-327; imagegen/tool.js:71-80; video-in/index.js:47-50; html-render/tool.js:40; websearch/index.js:78-98; plugin omo.js:2 and archived runtime report |
| R9 | C:/Users/yjack/.bun/install/global/node_modules/omo-ai/plugin/extensions/omo.js:2; archived runtime report and current catalog; onboarding consent/history flow kept native |

## Every observed tool

| # | Exact tool name | Decision | Reason or required summary target | Source |
| --- | --- | --- | --- | --- |
| 1 | `read` | Keep native | Native exploration ownership | R1 |
| 2 | `bash` | Add conditional | description or first command line; background handle when returned | R1 |
| 3 | `powershell` | Retain conditional | Existing fold line; add common state/media guards | R1 |
| 4 | `edit` | Retain conditional | Existing fold line; add common state/media guards | R1 |
| 5 | `write` | Retain conditional | Existing fold line; add common state/media guards | R1 |
| 6 | `grep` | Keep native | Native exploration ownership | R1 |
| 7 | `find` | Keep native | Native exploration ownership | R1 |
| 8 | `glob` | Add conditional | pattern + path | R1 |
| 9 | `ls` | Keep native | Native exploration ownership | R1 |
| 10 | `apply_patch` | Retain conditional | Existing fold line; add common state/media guards | L1 |
| 11 | `request_user_input` | Keep native | Interactive question and answer chip | R8 |
| 12 | `ask_user_question` | Keep native | Interactive question and answer chip | R8 |
| 13 | `generate_image` | Keep native | Primary image deliverable | R8 |
| 14 | `todo` | Add membership | args.op before result; authoritative details.op/phases after result | R3 |
| 15 | `bash_output` | Retain conditional | Existing fold line; add common state/media guards | R2 |
| 16 | `bash_input` | Keep native | Partial key acceptance is prose-only; preserve full native receipt | R2 |
| 17 | `bash_resize` | Keep native | Resize no-op is prose-only; preserve full native receipt | R2 |
| 18 | `kill_bash` | Add conditional | bash_id or all | R2 |
| 19 | `monitor` | Add conditional | registration only: details.monitor=true + handle; rearm stays native | R2 |
| 20 | `web_search` | Retain conditional | Existing fold line; add common state/media guards | L1 |
| 21 | `$web_search` | Keep native | Provider-native arbitrary echo contract | R8 |
| 22 | `webfetch` | Retain conditional | Existing fold line; add common state/media guards | L1 |
| 23 | `read_video` | Keep native | Primary video attachment | R8 |
| 24 | `look_at` | Retain conditional | Existing fold line; add common state/media guards | L1 |
| 25 | `create_goal` | Retain conditional | Existing fold line; add common state/media guards | L1 |
| 26 | `update_goal` | Retain conditional | Existing fold line; add common state/media guards | L1 |
| 27 | `get_goal` | Retain conditional | Existing fold line; add common state/media guards | L1 |
| 28 | `schedule_wakeup` | Add conditional | effective result action/delay + clamped/noop state + reason | R4 |
| 29 | `schedule_prompt` | Add conditional | effective timing + runnerAvailable/inFlight state + id/prompt | R4 |
| 30 | `show_html_page` | Keep native | Primary rendered page deliverable | R8 |
| 31 | `tool_search` | Retain conditional | Existing fold line; add common state/media guards | L1 |
| 32 | `mcp__ast_grep_rewrite` | Add conditional | pattern + first paths entry; rewrite/apply distinction; preserve details.preview; full two-slot definition only | R7 |
| 33 | `mcp__ast_grep_scan` | Add conditional | ruleFile or first paths entry; apply flag; preserve details.preview; full two-slot definition only | R7 |
| 34 | `mcp__ast_grep_search` | Add conditional | pattern + first paths entry; rewrite/apply distinction; preserve details.preview; full two-slot definition only | R7 |
| 35 | `mcp_context7_query-docs` | Add conditional | libraryId + query; preserve details.preview; full two-slot definition only | R7 |
| 36 | `mcp_context7_resolve-library-id` | Add conditional | libraryName + query; preserve details.preview; full two-slot definition only | R7 |
| 37 | `mcp_grep_app_searchGitHub` | Add conditional | query + repo/path; preserve details.preview; full two-slot definition only | R7 |
| 38 | `eval` | Retain conditional | Existing fold line; add common state/media guards | L1 |
| 39 | `onboarding_session_history` | Keep native | Onboarding/session-history surface | R9 |
| 40 | `onboarding_understand` | Keep native | Consent-bearing onboarding surface | R9 |
| 41 | `onboarding_memory_apply` | Keep native | Onboarding selected-fact application surface | R9 |
| 42 | `lsp_diagnostics` | Retain conditional | Existing fold line; add common state/media guards | L1 |
| 43 | `lsp_goto_definition` | Retain conditional | Existing fold line; add common state/media guards | L1 |
| 44 | `lsp_find_references` | Retain conditional | Existing fold line; add common state/media guards | L1 |
| 45 | `lsp_symbols` | Retain conditional | Existing fold line; add common state/media guards | L1 |
| 46 | `lsp_prepare_rename` | Retain conditional | Existing fold line; add common state/media guards | L1 |
| 47 | `lsp_rename` | Retain conditional | Existing fold line; add common state/media guards | L1 |
| 48 | `computer` | Keep native | Desktop interaction and screenshot surface | R8 |
| 49 | `omo_browser_bridge` | Keep native | Internal browser-control channel | R8 |
| 50 | `task` | Retain conditional | Existing fold line; add common state/media guards | R5 |
| 51 | `task_send` | Retain conditional | Existing fold line; add common state/media guards | R5 |
| 52 | `task_cancel` | Retain conditional | Existing fold line; add common state/media guards | R5 |
| 53 | `task_output` | Retain conditional | Existing fold line; add common state/media guards | R5 |
| 54 | `workflow` | Add conditional | action + run/name/node + details.kind + actual run status | R5 |
| 55 | `workpool` | Add conditional | op + name or pool_id + submitted/result item count | R5 |
| 56 | `team_create` | Retain conditional | Existing fold line; add common state/media guards | R5 |
| 57 | `team_delete` | Retain conditional | Existing fold line; add common state/media guards | R5 |
| 58 | `task_create` | Retain conditional | Existing fold line; add common state/media guards | R5 |
| 59 | `task_get` | Retain conditional | Existing fold line; add common state/media guards | R5 |
| 60 | `task_list` | Retain conditional | Existing fold line; add common state/media guards | R5 |
| 61 | `task_update` | Retain conditional | Existing fold line; add common state/media guards | R5 |
| 62 | `thread_create` | Add conditional | name or cwd; returned thread identity when present | R6 |
| 63 | `thread_list` | Add conditional | list | R6 |
| 64 | `thread_read` | Add conditional | thread | R6 |
| 65 | `thread_send` | Add conditional | thread + summary (never a reply token) | R6 |
| 66 | `thread_interrupt` | Add conditional | thread + turn_id | R6 |
| 67 | `thread_handoff` | Add conditional | thread + summary | R6 |
| 68 | `thread_rename` | Add conditional | thread + new name | R6 |
| 69 | `thread_set_model` | Add conditional | thread + provider/model | R6 |
| 70 | `thread_set_reasoning` | Add conditional | thread + level | R6 |
| 71 | `thread_bind` | Add conditional | platform + chat_id + session | R6 |
| 72 | `thread_unbind` | Add conditional | binding_id | R6 |
| 73 | `thread_rebind` | Add conditional | binding_id + session | R6 |
| 74 | `thread_bindings` | Add conditional | session or binding filter | R6 |
| 75 | `thread_report` | Add conditional | kind + binding_id; admit only milestone/report/completion before and after result | R6 |
| 76 | `thread_outbox` | Add conditional | binding_id | R6 |
| 77 | `thread_outbox_ack` | Add conditional | binding_id + cursor | R6 |
| 78 | `thread_answer` | Keep native | Human decision receipt | R6 |
| 79 | `memory` | Retain conditional | Existing fold line; add common state/media guards | L1 |

## Mandatory per-result and per-action boundaries

- Both top-level result.isError and render context isError preserve original output. The host strips top-level isError from renderResult's result argument, so the context check is mandatory.
- Preserve original output for known structured failure/cancelled/blocked states, partial apply_patch failures, malformed status, and any non-text content block. No deep scan of arbitrary prose for words such as error; inspect only documented status fields.
- Preserve original output for monitor with human_input=true or any explicit action (including rearm), thread_report unless kind is milestone/report/completion, and every thread_answer. These are human-interaction surfaces, not ordinary operation receipts.
- A returned background-launch call is not evidence its job finished. Keep the call's handle and launch/queued/running meaning visible; do not introduce a false success checkmark. Existing header Ran means returned tool invocations, not completion of child jobs.
- Expanded groups remain non-owning groups and render their original member cards. Expanded state does not itself prohibit a group; the existing expanded-header behavior stays.
- Default-rendered and call-only tools are projection-only members: never synthesize renderer slots. Native fallback previews and image semantics depend on whether a result renderer exists (tool-execution.js:214-222), so returning undefined from an added renderer is not equivalent to keeping the original definition. Admit the exact no-slot set only when its definition still has neither slot; admit monitor only with its audited call-only shape. A lone card stays native; an expanded block delegates to the same original source cards.
- The six exact MCP names use the existing wrapped path only when both original slots exist. register.js:19-47 proves individual full definitions have both slots; tier-b stubs have only a call slot and remain native. Refusals use details.error (register.js:54-65) without top-level isError; remote isError maps to a thrown ToolExecError (schema-compat.js:33-39 and register.js:68-71). Preserve both failure forms and reject unknown/error result shapes.
- Source cards with images must not become line-only group members. ToolExecutionImages is a sibling of the text renderer, so a text fold alone is not enough to protect images.
- Eval run remains supported. Eval peek/stop/list stay native and break runs; make standalone and grouped action handling consistent rather than rendering a copied cell result as if it were a fresh run.

## Non-tool families

| Family | Decision | Reason/source |
| --- | --- | --- |
| Thinking-only assistant detail between eligible cards | Bridge, unchanged | eval-run.ts:58-72; tool-fold.ts:452-456 |
| Trailing thinking-only assistant detail | Outside group, unchanged | Preserve live Thinking label |
| Collapsed omo-kibitzer:nudged and goal-cache-warmup | Hidden bridge, unchanged | hidden-notices.ts whitelist |
| Expanded whitelisted notices | Visible boundary | Original custom card expansion |
| Prompt-cache MISS and other status text | Visible boundary | Runtime ThemedText; no hiding extension |
| Native ExplorationGroup and read/grep/find/ls cards | Native boundary | Renderer identity and independent ownership |
| Project-rule custom entry | Native boundary | Only native exploration owns its call association |
| Other custom entries/messages, completion/wake notices | Native boundary | Arbitrary semantics and independent expansion |
| User/skill, assistant prose/tool/error/thinking-body, branch/compaction, BashExecutionComponent | Native boundary | Conversation or independent presentation family |
| Grok presentation | Native unchanged | It bypasses ToolExecutionRenderer and uses GrokToolRow |

## Rejected research recommendations

- Reject the suggestion to cap groups at eight lines: existing product explicitly has no line cap, and a cap would erase the requested activity trail.
- Reject wrapping read/grep/find/ls or flattening native groups.
- Reject treating glob as native-grouped: current upstream accepts only the four names above.
- Reject treating missing render slots as universally ungroupable, and reject synthesizing slots: explicitly audited projection-only admission preserves native fallback behavior exactly.
- Reject a blanket ban on bash while powershell already folds; use the same state/media-preserving shell policy for both.
- Reject the QA suggestion that successful todos must never group: it contradicts the request.
- Reject adopting extra upstream x_search/provider-native tools not present in the active catalog. Installed-only/future additions stay out of this finite denominator.
- Root verified glob spreads createFindToolDefinition, whose find.js:265 spreads findRenderers. The architecture report's claim that glob reaches getToolDefinition without its own slots is incorrect; getToolDefinition returns the stored definition, so glob can follow the existing two-slot wrapping path.

## Evidence limits

This is a planning inventory. It proves source/schema availability and current contracts, not new behavior in the TUI. Return structures not proven by a cited source are not permission to guess status fields: future implementation fixtures must use actual result envelopes and fail open when the supported shape is not recognized. Raw research reports are archived as claims; root source corrections in the draft take precedence.


## Falsification closure

- The 79-name audit passed. Source checks then excluded bash_input/bash_resize because non-error partial/no-op outcomes have no structured discriminator; the final partition is 61/18 (39 renderer-backed + 22 projection-only).
- Monitor registration is eligible only with no action and human_input not true; require details.monitor=true and a returned handle after result. Rearm/unknown action stays native because success text can mean no-op.
- Scheduled results use effective delay and clamped/noop state; prompt cancellation preserves inFlight and creation preserves runnerAvailable=false. Missing required state is native.
- MCP summaries preserve details.preview, the only successful native result presentation; expanded upstream MCP rendering is still preview-only.
- Workflow summaries state details.kind and run lifecycle; error/cancelled/failed/unknown states stay native. Thread report kinds are whitelisted before any result.
- QA closure is specified by tasks 2-7 and 10-11 in the completed plan: actual native ANSI equality, all 79 fixtures, real state envelopes, every fitting marker, light/dark xterm palettes, real SGR click and explicit zero-execute checks. Old research reports remain immutable claims, not the current specification.
