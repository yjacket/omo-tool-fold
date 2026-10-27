// allow: SIZE_OK - the task owns this one replay file; its PTY, frame, browser and
// cleanup lifecycle must stay in one process and cannot be split into new files here.
// Run with Bun >= 1.4. No prompts, installed-extension changes, or user sessions.
// SENPI_DIST, QA_ROOT (scratch parent), EVIDENCE_DIR, QA_NO_FOLD=1,
// QA_BROWSER_PATH, QA_BROWSER_SKILL, QA_XTERM_ROOT are optional overrides.
// QA_SCENARIO=comprehensive-grouping, QA_COLS=80|150, QA_ROWS=45 and
// QA_THEME=dark|<absolute grok-day-focus.json> select the deterministic matrix.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== "--provider" || !["claude", "codex"].includes(args[1])) {
  throw new Error("Usage: bun qa/history-window-replay.mjs --provider claude|codex");
}
const provider = args[1];
const REPO = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const RUNTIME_ROOT = join(homedir(), ".omo/agent/runtime");

// The planning-time runtime directory was removed. Resolve the newest installed
// runtime that actually ships the engine, unless SENPI_DIST explicitly selects one.
function defaultDist() {
  if (!existsSync(RUNTIME_ROOT)) return join(RUNTIME_ROOT, "missing/dist");
  const candidates = readdirSync(RUNTIME_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(RUNTIME_ROOT, entry.name, "dist"))
    .filter((dist) => existsSync(join(dist, "bundle/cli.js")))
    .map((dist) => ({ dist, modified: Bun.file(join(dist, "bundle/cli.js")).lastModified }))
    .sort((left, right) => right.modified - left.modified);
  return candidates[0]?.dist ?? join(RUNTIME_ROOT, "missing/dist");
}
const DIST = resolve(process.env.SENPI_DIST ?? defaultDist());
const CLI = join(DIST, "bundle/cli.js");
if (!existsSync(CLI)) throw new Error(`Missing engine: ${CLI}; set SENPI_DIST`);
const PI_TUI_DIST = process.env.PI_TUI_DIST;
const comprehensive = process.env.QA_SCENARIO === "comprehensive-grouping";
if (process.env.QA_SCENARIO && !comprehensive) throw new Error(`Unknown QA_SCENARIO: ${process.env.QA_SCENARIO}`);

function dimension(name, fallback, allowed) {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  if (!/^\d+$/.test(raw) || !allowed.includes(Number(raw))) {
    throw new Error(`${name}=${raw} is invalid; expected ${allowed.join("|")}`);
  }
  return Number(raw);
}
const COLS = comprehensive ? dimension("QA_COLS", 150, [80, 150]) : 150;
const ROWS = comprehensive ? dimension("QA_ROWS", 45, [45]) : 45;
const themeArg = comprehensive ? (process.env.QA_THEME ?? "dark") : "grok-day";
if (comprehensive && themeArg !== "dark" && !existsSync(resolve(themeArg))) throw new Error(`QA_THEME file not found: ${themeArg}`);
const lightRun = comprehensive && themeArg !== "dark";

const scratchParent = resolve(process.env.QA_ROOT ?? tmpdir());
const EVIDENCE = resolve(process.env.EVIDENCE_DIR ?? join(REPO, ".omo/evidence/history-window", `${provider}${process.env.QA_NO_FOLD === "1" ? "-baseline" : ""}`));
// Refuse a stale comprehensive destination before creating scratch or writing anything.
if (comprehensive && existsSync(EVIDENCE)) {
  const entries = readdirSync(EVIDENCE);
  if (entries.length > 0) throw new Error(`EVIDENCE_DIR is not empty: ${EVIDENCE}; use a fresh attempt suffix`);
}
if (EVIDENCE === scratchParent || EVIDENCE.startsWith(`${resolve(scratchParent)}/`) || EVIDENCE.startsWith(`${resolve(scratchParent)}\\`)) {
  throw new Error("EVIDENCE_DIR must be outside QA_ROOT scratch");
}
mkdirSync(scratchParent, { recursive: true });
// Always own a unique child, even when QA_ROOT points to a shared scratch parent.
const RUN_TMP = mkdtempSync(join(scratchParent, "history-window-"));
if (EVIDENCE === RUN_TMP || EVIDENCE.startsWith(`${RUN_TMP}/`) || EVIDENCE.startsWith(`${RUN_TMP}\\`)) {
  rmSync(RUN_TMP, { recursive: true, force: true });
  throw new Error("EVIDENCE_DIR must be outside this run's temporary directory");
}
mkdirSync(EVIDENCE, { recursive: true });
process.env.RUN_TMP = RUN_TMP;
process.env.TMPDIR = RUN_TMP;
process.env.TMP = RUN_TMP;
process.env.TEMP = RUN_TMP;
process.env.NODE_COMPILE_CACHE = join(RUN_TMP, "node-cache");
process.env.BUN_RUNTIME_TRANSPILER_CACHE_PATH = join(RUN_TMP, "bun-cache");
const TIMEOUT = 90000;
const AGENT = join(RUN_TMP, "agent");
const SESSION = join(RUN_TMP, "sessions/replay.jsonl");
const QA_TOOL = join(RUN_TMP, "qa-tools.ts");
const PROVENANCE = join(RUN_TMP, "definition-provenance.json");
const DEFINITIONS = join(RUN_TMP, "definition-shapes.json");
const EXECUTE_COUNTER = join(RUN_TMP, "execute-calls.log");
const MOUSE_LOG = join(RUN_TMP, "mouse-events.jsonl");
// ConPTY re-serializes output and coalesces OSC titles, so a marker's byte offset does not
// bound its frame. The extension records each committed frame here before writing the marker.
const FRAME_LOG = join(RUN_TMP, "frames.jsonl");
const noFold = process.env.QA_NO_FOLD === "1";
const children = new Set();
const cleanup = [];
const report = { provider, noFold, scenario: comprehensive ? "comprehensive-grouping" : "history-window", dimensions: { cols: COLS, rows: ROWS }, historyLines: comprehensive ? 5000 : 100,
  runtime: { dist: DIST, cli: CLI, piTuiDist: PI_TUI_DIST ?? null, version: null }, theme: themeArg, runTmp: RUN_TMP, evidence: EVIDENCE, actions: [], captures: {}, cleanup };
let browser;
let server;
let page;
let stream = Buffer.alloc(0);
let failure;
let frameSeq = 0;

function fixture() {
  const t0 = Date.parse("2026-10-23T00:00:00Z");
  const entries = [];
  let parentId = null;
  const add = (fields) => {
    const id = (entries.length + 1).toString(16).padStart(8, "0");
    entries.push({ ...fields, id, parentId, timestamp: new Date(t0 + entries.length * 1000).toISOString() });
    parentId = id;
  };
  const at = () => t0 + entries.length * 1000;
  const model = provider === "claude"
    ? { api: "claude-sdk-oauth", provider: "anthropic-subscription", model: "claude-opus-5-5" }
    : { api: "openai-codex-responses", provider: "chatgpt-subscription", model: "gpt-6.1-sol" };
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const assistant = (content, stopReason = "stop") => add({ type: "message", message: { role: "assistant", ...model, content, stopReason, usage, timestamp: at() } });
  const thinking = (n) => ({
    type: "thinking",
    thinking: provider === "claude" ? `QA_THINKING_${n}` : "",
    thinkingSignature: provider === "claude" ? "qa-signature" : JSON.stringify({
      id: `rs_qa_${n}`, type: "reasoning", summary: [{ type: "summary_text", text: `QA_SIGNED_SUMMARY_${n}` }],
    }),
    startedAt: at(), endedAt: at() + 1,
  });
  const turn = (n, isError = false) => {
    const id = provider === "claude" ? `toolu_qa_${n}` : `call_qa_${n}|fc_qa_${n}`;
    const summary = isError ? "QA_ERROR_CALL" : `QA_STEP_${n}`;
    assistant([thinking(n), { type: "toolCall", id, name: "eval", arguments: { language: "js", summary, code: `/* ${summary} */` } }], "toolUse");
    const text = isError ? "QA_ERROR_VISIBLE: deterministic synthetic failure" :
      Array.from({ length: 75 }, (_, line) => `QA_LONG_${n}_${String(line + 1).padStart(3, "0")} ${"successful output ".repeat(5)}`).join("\n");
    add({ type: "message", message: { role: "toolResult", toolCallId: id, toolName: "eval", content: [{ type: "text", text }], isError, timestamp: at(),
      details: { language: "js", summary, cells: [{ index: 0, status: isError ? "error" : "complete", language: "js", summary }] } } });
  };
  add({ type: "model_change", provider: model.provider, modelId: model.model });
  add({ type: "thinking_level_change", thinkingLevel: "low" });
  add({ type: "message", message: { role: "user", content: [{ type: "text", text: "QA_HISTORY_BEGIN" }], timestamp: at() } });
  turn(1);
  turn(2);
  assistant([{ type: "text", text: "QA_GROUP_BREAK_A" }]);
  add({ type: "custom", customType: "omo-kibitzer:nudged", data: { version: 1, nudges: [{ path: "qa/synthetic", hint: "QA_NOTICE_EXPANDED" }], via: "prompt" } });
  turn(3);
  turn(4);
  assistant([{ type: "text", text: "QA_GROUP_BREAK_B" }]);
  turn(5);
  turn(6, true);
  assistant([{ type: "text", text: "QA_HISTORY_END" }]);
  return `${[{ type: "session", version: 3, id: "00000000-0000-7000-8000-000000000b01", timestamp: new Date(t0).toISOString(), cwd: REPO }, ...entries]
    .map((entry) => JSON.stringify(entry)).join("\n")}\n`;
}

const NATIVE_TWO_SLOT = ["todo", "edit", "apply_patch", "powershell", "glob", "read", "grep", "find", "ls", "ask_user_question", "request_user_input"];
const NATIVE_NO_SLOT = ["bash", "kill_bash", "schedule_wakeup", "schedule_prompt", "bash_input", "bash_resize", "generate_image", "show_html_page"];
const NATIVE_CALL_ONLY = ["monitor"];
const NATIVE_FIXTURES = [...NATIVE_TWO_SLOT, ...NATIVE_NO_SLOT, ...NATIVE_CALL_ONLY];
const SYNTHETIC_NAMES = ["eval", "workflow", "workpool", "thread_send", "thread_report", "thread_answer", "mcp_context7_query-docs", "mcp_grep_app_searchGitHub"];
const FIXTURE_TOOLS = [...NATIVE_FIXTURES, ...SYNTHETIC_NAMES];

const TAIL_HEADER = "Ran 2 tools · eval 1 · kill_bash 1";
const TAIL_BODY_MARKERS = ["QA_TAIL_EVAL_BODY", "QA_TAIL_KILL_DETAIL"];
const TAIL_MEMBERS = 2;
const SPINNER = /[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏]/g;
const PNG_1PX = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

// Grouped source arguments carry Korean text and terminal escapes. The extension must strip the
// OSC title and CSI color, keep the surrounding text, and fit wide characters in the row.
const INJECT_OSC = "\u001b]0;QA_INJECT\u0007";
const INJECT_CSI = "\u001b[38;5;201m";
const MIXED_SUMMARY = `QA_EVAL_MIXED_SUMMARY 데이터 분석 요약 ${INJECT_OSC}${INJECT_CSI}QA_CSI_TEXT\u001b[0m`;
const MONITOR_DESCRIPTION = `QA_MONITOR 로그 감시 ${INJECT_CSI}한글 설명이 좁은 터미널 폭을 넘도록 길게 이어지는 문장입니다 QA_MONITOR_TAIL\u001b[0m`;
const KOREAN_MARKERS = ["eval js ✓ QA_EVAL_MIXED_SUMMARY 데이터 분석 요약 QA_CSI_TEXT", "monitor armed mon_qa · QA_MONITOR 로그 감시", "QA_TODO_ALPHA 한글 작업 정리"];
const RENDER_DEADLINE_MS = 10000;

const comprehensiveScenes = [
  { name: "todo-mixed", markers: ["QA_ORIGINAL_COLLAPSED", "QA_TODO_ALPHA", "QA_TODO_BETA", "edit package.json", "QA_PATCH_MAIN", "QA_GLOB_MAIN"], foldMarkers: ["Ran 3 tools · eval 1 · todo 1 · edit 1", KOREAN_MARKERS[0], "todo init (1 phase, 2 tasks)", "edit package.json (+1/-1)", "QA_PATCH_MAIN", "glob qa/**/*.ts in src"] },
  // Grouped rows, not native text: a native rendering of any eligible card fails the scene.
  // The full header exceeds 80 columns, so only its fitting prefix is required.
  { name: "native-defaults", markers: ["QA_KILL_RECEIPT", "QA_MONITOR_ARMED", "QA_WAKE_CLAMPED", "QA_SCHEDULE_NO_RUNNER", "QA_WORKFLOW_RUNNING", "QA_WORKPOOL_OPEN"], foldMarkers: ["Running 6 tools · kill_bash 1 · monitor 1 · schedule_wakeup 1", "kill_bash bash_qa_old: QA_KILL_RECEIPT killed=1", KOREAN_MARKERS[1], "schedule_wakeup scheduled 60s clamped: QA_WAKE_CLAMPED", "schedule_prompt no-runner create 1 pending job", "workflow snapshot QA_WORKFLOW_RUNNING snapshot running", "workpool inspect QA_WORKPOOL_OPEN open · 1 item (queued 1)"] },
  { name: "mcp", markers: ["QA_MCP_PREVIEW_MAIN", "QA_MCP_STUB_INACTIVE"], foldMarkers: ["QA_MCP_QUERY_MAIN · QA_MCP_PREVIEW_MAIN", "QA_MCP_STUB_INACTIVE"] },
  { name: "semantic-failures", markers: ["QA_SEMANTIC_WORKFLOW_ERROR", "QA_SEMANTIC_WORKPOOL_CANCELLED", "QA_SEMANTIC_THREAD_QUESTION", "QA_SEMANTIC_THREAD_ERROR", "QA_NATIVE_BASH_INPUT", "QA_NATIVE_BASH_RESIZE"], foldMarkers: ["QA_SEMANTIC_WORKFLOW_ERROR", "QA_SEMANTIC_WORKPOOL_CANCELLED", "QA_SEMANTIC_THREAD_QUESTION", "QA_SEMANTIC_THREAD_ERROR", "QA_NATIVE_BASH_INPUT", "QA_NATIVE_BASH_RESIZE"] },
  { name: "decisions-media", markers: ["QA_DECISION_ANSWER", "QA_MEDIA_IMAGE", "QA_NATIVE_HTML"], foldMarkers: ["QA_DECISION_ANSWER", "QA_MEDIA_IMAGE", "QA_NATIVE_HTML"] },
  { name: "receipts", markers: ["QA_BACKGROUND_RECEIPT", "QA_FOREGROUND_EXIT_0", "QA_THREAD_STARTED", "QA_QUEUED_OFFLINE", "QA_HUMAN_BOUNDARY", "QA_IN_FLIGHT"], foldMarkers: ["QA_BACKGROUND_RECEIPT", "QA_FOREGROUND_EXIT_0", "thread_send thr_qa_live started", "thread_send thr_qa_queue queued_offline · 스레드 요약 전달", "QA_HUMAN_BOUNDARY", "schedule_prompt in-flight cancel job_qa", "schedule_prompt list 1 pending job"] },
  { name: "native-exploration", markers: ["Explored", "Read a.ts", "Search QA_GREP_PATTERN in src", "List src"], foldMarkers: ["Explored", "Read a.ts", "Search QA_GREP_PATTERN in src"] },
  // The last scene keeps one mixed renderer-backed/projection-only group inside the final
  // viewport: the main-screen TUI cannot scroll scrollback (a wheel report yields the mouse).
  { name: "mixed-tail", markers: ["QA_TAIL_EVAL_SUMMARY", "QA_TAIL_KILL_RECEIPT"], foldMarkers: [TAIL_HEADER, "QA_TAIL_EVAL_SUMMARY", "kill_bash bash_qa_tail: QA_TAIL_KILL_RECEIPT"] },
];
const UNSAFE_MARKERS = ["QA_SEMANTIC_WORKFLOW_ERROR", "QA_SEMANTIC_WORKPOOL_CANCELLED", "QA_SEMANTIC_THREAD_QUESTION", "QA_SEMANTIC_THREAD_ERROR",
  "QA_DECISION_ANSWER", "QA_MEDIA_IMAGE", "QA_MCP_STUB_INACTIVE", "Explored", "Read a.ts", "Search QA_GREP_PATTERN in src"];
const ALL_MARKERS = comprehensiveScenes.flatMap((scene) => scene.markers);

function comprehensiveFixture() {
  const t0 = Date.parse("2026-10-23T00:00:00Z");
  const entries = [];
  let parentId = null;
  let toolCount = 0;
  const add = (fields) => {
    const id = (entries.length + 1).toString(16).padStart(8, "0");
    entries.push({ ...fields, id, parentId, timestamp: new Date(t0 + entries.length * 1000).toISOString() });
    parentId = id;
  };
  const at = () => t0 + entries.length * 1000;
  const model = provider === "claude"
    ? { api: "claude-sdk-oauth", provider: "anthropic-subscription", model: "claude-opus-5-5" }
    : { api: "openai-codex-responses", provider: "chatgpt-subscription", model: "gpt-6.1-sol" };
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } };
  const assistant = (content, stopReason = "stop") => add({ type: "message", message: { role: "assistant", ...model, content, stopReason, usage, timestamp: at() } });
  const thinking = (n) => ({
    type: "thinking",
    thinking: provider === "claude" ? `QA_THINKING_${n}` : "",
    thinkingSignature: provider === "claude" ? "qa-signature" : JSON.stringify({
      id: `rs_qa_${n}`, type: "reasoning", summary: [{ type: "summary_text", text: `QA_SIGNED_SUMMARY_${n}` }],
    }),
    startedAt: at(), endedAt: at() + 1,
  });
  const tool = (name, toolArgs, text, details, options = {}) => {
    toolCount += 1;
    const id = provider === "claude" ? `toolu_qa_${toolCount}` : `call_qa_${toolCount}|fc_qa_${toolCount}`;
    assistant([thinking(toolCount), { type: "toolCall", id, name, arguments: toolArgs }], "toolUse");
    const content = options.image
      ? [{ type: "text", text }, { type: "image", data: PNG_1PX, mimeType: "image/png" }]
      : [{ type: "text", text }];
    add({ type: "message", message: { role: "toolResult", toolCallId: id, toolName: name, content, isError: options.isError === true,
      timestamp: at(), ...(details === undefined ? {} : { details }) } });
  };
  add({ type: "model_change", provider: model.provider, modelId: model.model });
  add({ type: "thinking_level_change", thinkingLevel: "low" });
  add({ type: "message", message: { role: "user", content: [{ type: "text", text: "QA_COMPREHENSIVE_BEGIN" }], timestamp: at() } });

  tool("eval", { language: "js", summary: MIXED_SUMMARY, code: "/* QA_EVAL_MIXED */" }, "QA_EVAL_MIXED_OUTPUT",
    { language: "js", summary: MIXED_SUMMARY, cells: [{ index: 0, status: "complete", language: "js", summary: MIXED_SUMMARY }] });
  tool("todo", { op: "init", list: [{ phase: "QA_PHASE_ALPHA", items: ["QA_TODO_ALPHA 한글 작업 정리", "QA_TODO_BETA"] }] }, "QA_TODO_INIT_OUTPUT",
    { op: "init", storage: "session", phases: [{ name: "QA_PHASE_ALPHA", tasks: [
      { content: "QA_TODO_ALPHA 한글 작업 정리", status: "in_progress" }, { content: "QA_TODO_BETA", status: "pending" }] }] });
  tool("edit", { path: "package.json", edits: [{ oldText: '"version": "0.1.0"', newText: '"version": "0.1.1"' }] }, "QA_EDIT_MAIN",
    { diff: '--- a/package.json\n+++ b/package.json\n@@\n-"version": "0.1.0"\n+"version": "0.1.1"', firstChangedLine: 3 });
  tool("apply_patch", { patch: "*** Begin Patch\n*** Update File: a.ts\n@@\n-old\n+new\n*** End Patch" }, "QA_PATCH_MAIN", { files: [{ path: "a.ts", additions: 1, deletions: 1 }] });
  tool("glob", { pattern: "qa/**/*.ts", path: "src" }, "QA_GLOB_MAIN", { pattern: "qa/**/*.ts", path: "src", matches: ["src/qa/a.ts"] });
  assistant([{ type: "text", text: "QA_BREAK_1" }]);

  tool("kill_bash", { bash_id: "bash_qa_old" }, "QA_KILL_RECEIPT killed=1", { bash_id: "bash_qa_old", killed: 1 });
  tool("monitor", { description: MONITOR_DESCRIPTION }, "QA_MONITOR_ARMED", { monitor: true, monitor_id: "mon_qa", bash_id: "bash_qa" });
  // Eligible envelopes follow the installed runtime (loop/tools.js, schedule/tool.js) and the
  // plan's structured result contract, so the real engine admits them into the group.
  tool("schedule_wakeup", { delaySeconds: 1, reason: "QA_WAKE_CLAMPED", prompt: "QA_WAKE_PROMPT" }, "QA_WAKE_CLAMPED delay=60 clamped",
    { ok: true, action: "scheduled", loopId: "loop_qa", wakeupId: "wake_qa", requestedDelaySeconds: 1, delaySeconds: 60, clamped: true,
      dueAt: "2026-10-23T00:01:00.000Z", reason: "QA_WAKE_CLAMPED", prompt: "QA_WAKE_PROMPT", noop: false, noopStreak: 0 });
  tool("schedule_prompt", { action: "create", prompt: "QA_SCHEDULE", delaySeconds: 600 }, "QA_SCHEDULE_NO_RUNNER",
    { action: "create", jobs: [{ state: "pending", job: { id: "job_qa", prompt: "QA_SCHEDULE" } }], runnerAvailable: false });
  tool("workflow", { action: "snapshot", run_id: "wf_qa_main" }, "QA_WORKFLOW_RUNNING", { kind: "snapshot", run_id: "wf_qa_main", snapshot: {
    name: "QA_WORKFLOW_RUNNING", status: "running", counts: { total: 2, completed: 1, failed: 0, cancelled: 0, skipped: 0 },
    nodes: [{ id: "plan", state: "completed" }, { id: "build", state: "running" }] } });
  tool("workpool", { op: "inspect", pool_id: "pool_qa" }, "QA_WORKPOOL_OPEN",
    { pool_id: "pool_qa", name: "QA_WORKPOOL_OPEN", status: "open", items: [{ item_id: "wi_qa_1", status: "queued" }] });
  assistant([{ type: "text", text: "QA_BREAK_2" }]);

  tool("mcp_context7_query-docs", { libraryId: "/qa/lib", query: "QA_MCP_QUERY_MAIN" }, "QA_MCP_PREVIEW_MAIN",
    { server: "context7", tool: "query-docs", preview: "QA_MCP_PREVIEW_MAIN" });
  tool("mcp_grep_app_searchGitHub", { query: "QA_STUB_QUERY" }, "QA_MCP_STUB_INACTIVE: server not configured", undefined);
  assistant([{ type: "text", text: "QA_BREAK_3" }]);

  tool("workflow", { action: "snapshot", run_id: "wf_qa_error" }, "QA_SEMANTIC_WORKFLOW_ERROR", { kind: "error", error: { code: "QA_WORKFLOW_FAILED" } });
  tool("workpool", { op: "inspect", pool_id: "pool_qa_bad" }, "QA_SEMANTIC_WORKPOOL_CANCELLED", { pool_id: "pool_qa_bad", name: "QA_POOL_BAD", status: "cancelled", items: [] });
  tool("thread_report", { kind: "question", binding_id: "bind_qa" }, "QA_SEMANTIC_THREAD_QUESTION", { result: { kind: "ok", binding_id: "bind_qa", report_kind: "question" } });
  tool("thread_send", { thread_id: "thr_qa_bad", message: "QA" }, "QA_SEMANTIC_THREAD_ERROR", { result: { kind: "error", error: { code: "invalid_arguments" } } });
  tool("bash_input", { bash_id: "bash_qa", input: "x" }, "QA_NATIVE_BASH_INPUT ignored-key", undefined);
  tool("bash_resize", { bash_id: "bash_qa", cols: 80, rows: 20 }, "QA_NATIVE_BASH_RESIZE pipe-noop", undefined);
  assistant([{ type: "text", text: "QA_BREAK_4" }]);

  tool("ask_user_question", { questions: [{ question: "QA_DECISION_QUESTION", options: [{ label: "QA" }] }] }, "QA_DECISION_ANSWER",
    { answers: [{ question: "QA_DECISION_QUESTION", answer: "QA_DECISION_ANSWER" }] });
  tool("generate_image", { prompt: "QA_MEDIA_IMAGE_TITLE" }, "QA_MEDIA_IMAGE", undefined, { image: true });
  tool("show_html_page", { html: "<h1>QA_NATIVE_HTML</h1>" }, "QA_NATIVE_HTML", undefined);
  assistant([{ type: "text", text: "QA_BREAK_5" }]);

  tool("bash", { command: "echo QA_BACKGROUND_RECEIPT", description: "백그라운드 작업 시작", run_in_background: true }, "QA_BACKGROUND_RECEIPT bash_qa_bg",
    { background: true, bash_id: "bash_qa_bg" });
  tool("bash", { command: "echo QA_FOREGROUND_EXIT_0" }, "QA_FOREGROUND_EXIT_0", { exitCode: 0 });
  // The installed bash definition has no renderer slots, so bash stays native here; this eligible
  // receipt gives the queued_offline send its group neighbour.
  tool("thread_send", { thread_id: "thr_qa_live", message: "QA_THREAD_STARTED" }, "QA_THREAD_STARTED",
    { result: { kind: "ok", thread_id: "thr_qa_live", delivery: { kind: "started" } } });
  tool("thread_send", { thread_id: "thr_qa_queue", message: "QA_QUEUED_OFFLINE", summary: "스레드 요약 전달" }, "QA_QUEUED_OFFLINE",
    { result: { kind: "ok", thread_id: "thr_qa_queue", delivery: { kind: "queued_offline" } } });
  tool("monitor", { human_input: true }, "QA_HUMAN_BOUNDARY", { monitor: true, monitor_id: "mon_human", bash_id: "bash_human" });
  tool("schedule_prompt", { action: "cancel", id: "job_qa" }, "QA_IN_FLIGHT",
    { action: "cancel", jobs: [{ state: "pending", job: { id: "job_qa", prompt: "QA_SCHEDULE" } }], inFlight: true });
  // A lone projection-only card stays native, so the in-flight cancel needs an eligible neighbour.
  tool("schedule_prompt", { action: "list" }, "QA_SCHEDULE_LIST",
    { action: "list", jobs: [{ state: "pending", job: { id: "job_qa_next", prompt: "QA_SCHEDULE_NEXT" } }] });
  assistant([{ type: "text", text: "QA_BREAK_6" }]);

  tool("read", { path: "src/a.ts" }, "QA_READ_FILE", undefined);
  tool("grep", { pattern: "QA_GREP_PATTERN", path: "src" }, "QA_GREP_RESULT", undefined);
  tool("find", { pattern: "*.ts", path: "src" }, "QA_FIND_RESULT", undefined);
  tool("ls", { path: "src" }, "QA_LS_RESULT", undefined);
  assistant([{ type: "text", text: "QA_BREAK_7" }]);

  tool("eval", { language: "js", summary: "QA_TAIL_EVAL_SUMMARY", code: "/* QA_TAIL_EVAL */" }, "QA_TAIL_EVAL_BODY",
    { language: "js", summary: "QA_TAIL_EVAL_SUMMARY", cells: [{ index: 0, status: "complete", language: "js", summary: "QA_TAIL_EVAL_SUMMARY" }] });
  tool("kill_bash", { bash_id: "bash_qa_tail" }, "QA_TAIL_KILL_RECEIPT\nQA_TAIL_KILL_DETAIL", { bash_id: "bash_qa_tail", killed: 1 });
  assistant([{ type: "text", text: "QA_COMPREHENSIVE_END" }]);
  return {
    text: `${[{ type: "session", version: 3, id: "00000000-0000-7000-8000-000000000b03", timestamp: new Date(t0).toISOString(), cwd: REPO }, ...entries]
      .map((entry) => JSON.stringify(entry)).join("\n")}\n`,
    toolCount,
  };
}

// Observes, but never changes, the history window or projection. A private OSC marker
// follows the engine's synchronous terminal writes for the exact frame under test.
function qaExtension() {
  const synthetic = comprehensive ? `
  const recordExecute = () => appendFileSync(${JSON.stringify(EXECUTE_COUNTER)}, "execute\\n");
  const throwExecute = () => { recordExecute(); throw new Error("QA_MUST_NOT_EXECUTE"); };
  const preview = (result) => {
    const text = (result?.content ?? []).filter((entry) => entry.type === "text" && typeof entry.text === "string").map((entry) => entry.text).join("\\n");
    return result?.details?.preview ?? text ?? "";
  };
  const noSlot = (name, extra = {}) => ({ name, label: name, description: "Synthetic replay only; never executed.",
    parameters: { type: "object", properties: {}, additionalProperties: true }, qaProvenance: "synthetic",
    async execute() { throwExecute(); }, ...extra });
  const definitions = {
    eval: { name: "eval", label: "eval", description: "Synthetic replay only; never executed.",
      parameters: { type: "object", properties: {}, additionalProperties: true }, qaProvenance: "synthetic",
      async execute() { throwExecute(); },
      renderCall(toolArgs) { return new Text(String(toolArgs?.summary ?? "QA_CALL"), 0, 0); },
      renderResult(result, renderOptions, _theme, context) {
        const text = (result.content ?? []).filter((entry) => entry.type === "text").map((entry) => entry.text).join("\\n");
        if (context?.isError || result.isError || renderOptions.expanded) return new Text(text, 0, 0);
        return new Text("QA_ORIGINAL_COLLAPSED", 0, 0);
      } },
    workflow: noSlot("workflow"),
    workpool: noSlot("workpool"),
    thread_send: noSlot("thread_send"),
    thread_report: noSlot("thread_report"),
    thread_answer: noSlot("thread_answer"),
    "mcp_context7_query-docs": { name: "mcp_context7_query-docs", label: "context7", description: "Synthetic preview-only MCP.",
      parameters: { type: "object", properties: {}, additionalProperties: true }, qaProvenance: "synthetic",
      async execute() { throwExecute(); },
      renderCall(toolArgs) { return new Text("QA_MCP_CALL " + String(toolArgs?.query ?? ""), 0, 0); },
      renderResult(result) { return new Text(String(preview(result) || "QA_MCP_PREVIEW"), 0, 0); } },
    "mcp_grep_app_searchGitHub": { name: "mcp_grep_app_searchGitHub", label: "grep.app", description: "Synthetic inactive MCP stub.",
      parameters: { type: "object", properties: {}, additionalProperties: true }, qaProvenance: "synthetic",
      async execute() { throwExecute(); },
      renderCall(toolArgs) { return new Text("QA_MCP_STUB_CALL " + String(toolArgs?.query ?? ""), 0, 0); } },
  };
` : "";
  const setup = comprehensive ? `
  const native = ${JSON.stringify(NATIVE_FIXTURES)};
  const synthetic = ${JSON.stringify(SYNTHETIC_NAMES)};
  const failures = [];
  const installSessionStart = (pi) => pi.on("session_start", async () => {
    const tools = await pi.getAllTools();
    const existing = new Set(tools.map((tool) => tool.name));
    for (const name of native) if (!existing.has(name)) failures.push("missing native " + name);
    const sources = {};
    for (const name of synthetic) {
      if (existing.has(name)) {
        if (name === "eval") failures.push("collision synthetic " + name);
        else sources[name] = "builtin";
        continue;
      }
      pi.registerTool(definitions[name]);
      sources[name] = "synthetic";
    }
    writeFileSync(${JSON.stringify(PROVENANCE)}, JSON.stringify({ failures, sources, existing: [...existing] }, null, 2));
  });
  const collectDefinitions = (mode) => {
    const observed = {};
    for (const name of [...native, ...synthetic]) {
      let definition;
      try { definition = mode.session.getToolDefinition(name); } catch (error) { observed[name] = { error: String(error) }; continue; }
      if (!definition) { observed[name] = { found: false }; continue; }
      const provenance = definition.qaProvenance ?? (synthetic.includes(name) && !native.includes(name) ? "synthetic" : "builtin");
      observed[name] = { found: true, provenance, renderCall: typeof definition.renderCall, renderResult: typeof definition.renderResult, renderShell: definition.renderShell ?? null };
    }
    writeFileSync(${JSON.stringify(DEFINITIONS)}, JSON.stringify(observed, null, 2));
  };
` : "";
  return `
import { appendFileSync, writeFileSync } from "node:fs";
import { Text, TuiMainScreen } from "@earendil-works/pi-tui";
import { InteractiveMode } from "@code-yeongyu/senpi";
import { noticeEntryRenderer } from ${JSON.stringify(pathToFileURL(join(DIST, "core/extensions/notice/index.js")).href)};
let pending;
let mode;
let seq = 0;
let mouseInputs = 0;
const tags = [];
// Source cards whose own expansion state is on: the member-state proof for mouse toggles.
const expandedCards = () => {
  let count = 0;
  for (const child of mode?.chatContainer?.children ?? []) {
    try { if (child?.presentationSnapshot?.state?.expanded === true) count += 1; } catch {}
  }
  return count;
};
${synthetic}
${comprehensive ? `// The committed frame and the rows the terminal shows, mapped exactly like resolveFrameLine.
const recordFrame = (screen, state, tagged) => {
  const lines = screen.previousLines ?? [];
  const rows = screen.terminal.rows;
  const anchor = screen.anchor ?? { kind: "unknown" };
  const visible = [];
  for (let row = 1; row <= rows; row += 1) {
    const line = anchor.kind === "viewport" || anchor.kind === "unknown"
      ? (screen.previousViewportTop ?? 0) + row - 1
      : row - 1 - (anchor.frameTopScreenRow ?? 0);
    visible.push(line >= 0 && line < lines.length ? lines[line] : "");
  }
  const mouseReady = anchor.kind !== "unknown" && anchor.epoch === screen.placementEpoch && anchor.rows === rows && anchor.columns === screen.terminal.columns;
  appendFileSync(${JSON.stringify(FRAME_LOG)}, JSON.stringify({ ...state, tagged, phase: tagged ? pending : null, anchorKind: anchor.kind, mouseReady,
    viewportTop: screen.previousViewportTop ?? 0, visible, lines }) + "\\n");
};
` : ""}const initial = InteractiveMode.prototype.renderInitialMessages;
const expand = InteractiveMode.prototype.setToolsExpanded;
const render = TuiMainScreen.prototype.doRender;
const handleMouse = TuiMainScreen.prototype.handleMouseInput;
if (![initial, expand, render].every((fn) => typeof fn === "function")) throw new Error("QA_RENDER_SEAM_MISSING");
${setup}
InteractiveMode.prototype.renderInitialMessages = function (...args) {
  const result = initial.apply(this, args);
  mode = this;
  pending = "initial";
  ${comprehensive ? "collectDefinitions(this);" : ""}
  this.ui.requestRender();
  return result;
};
InteractiveMode.prototype.setToolsExpanded = function (expanded) {
  const changed = expanded !== this.toolOutputExpanded;
  const result = expand.call(this, expanded);
  if (changed) {
    mode = this;
    pending = expanded ? "expanded" : "recollapsed";
    this.ui.requestRender();
  }
  return result;
};
TuiMainScreen.prototype.doRender = function (...args) {
  const result = render.apply(this, args);
  seq += 1;
  const state = { phase: pending ?? null, seq, expanded: mode?.toolOutputExpanded,
    historyStart: mode?.chatContainer?.display?.historyStart, children: mode?.chatContainer?.children?.length, expandedCards: expandedCards(),
    visibleFrom: mode?.chatContainer?.display?.visibleFrom, hydrationFloor: mode?.chatContainer?.display?.hydrationFloor };
  ${comprehensive ? "if (mode?.renderer === this) recordFrame(this, state, Boolean(pending)); if (pending && mode?.renderer === this) tags.push({ phase: pending, state });" : ""}
  // ConPTY keeps only the last title of a paint, so every title repeats all tags so far.
  const encoded = Buffer.from(JSON.stringify(${comprehensive ? "{ ...state, tags }" : "state"})).toString("base64");
  this.terminal.write("\\x1b]0;QA_FRAME;" + seq + ";" + encoded + "\\x07");
  if (pending && mode?.renderer === this) {
    this.terminal.write("\\x1b]0;QA_HISTORY;" + pending + ";" + encoded + "\\x07");
    pending = undefined;
  }
  return result;
};
${comprehensive ? `if (typeof handleMouse === "function") {
  TuiMainScreen.prototype.handleMouseInput = function (data) {
    const before = seq;
    const result = handleMouse.call(this, data);
    if (typeof data === "string" && data.startsWith("\\x1b[<")) {
      // Tag the first frame committed after this SGR report, so the harness awaits that
      // exact frame instead of any later or earlier one.
      mouseInputs += 1;
      pending = "mouse" + mouseInputs;
      appendFileSync(${JSON.stringify(MOUSE_LOG)}, JSON.stringify({ input: mouseInputs, data: JSON.stringify(data), before, after: seq }) + "\\n");
      this.requestRender();
    }
    return result;
  };
}` : ""}
export default function (pi) {
  pi.registerEntryRenderer("omo-kibitzer:nudged", noticeEntryRenderer(() => ({
    glyph: "*", title: "QA_NOTICE_EXPANDED", tone: "accent", why: "QA_NOTICE_EXPANDED",
    extra: [{ text: "QA_NOTICE_DETAIL", tone: "dim" }],
  })));
  ${comprehensive ? `installSessionStart(pi);` : `pi.registerTool({
    name: "eval", label: "eval", description: "Synthetic replay only; never executed.",
    parameters: { type: "object", properties: {}, additionalProperties: true },
    async execute() { appendFileSync(${JSON.stringify(EXECUTE_COUNTER)}, "execute\\n"); throw new Error("QA_MUST_NOT_EXECUTE"); },
    renderCall(args) { return new Text(String(args?.summary ?? "QA_CALL"), 0, 0); },
    renderResult(result, options, _theme, context) {
      const text = result.content.filter((c) => c.type === "text").map((c) => c.text).join("\\n");
      if (context?.isError || result.isError || options.expanded) return new Text(text, 0, 0);
      return new Text("QA_ORIGINAL_COLLAPSED", 0, 0);
    },
  });`}
}
`;
}

async function kill(child, label) {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) {
    if (process.platform === "win32") {
      const killer = Bun.spawn(["taskkill", "/PID", String(child.pid), "/T", "/F"], { stdout: "pipe", stderr: "pipe" });
      const code = await killer.exited;
      cleanup.push({ action: "taskkill", label, pid: child.pid, exitCode: code });
    } else child.kill("SIGKILL");
  }
  await child.exited;
  cleanup.push({ action: "reaped", label, pid: child.pid, exitCode: child.exitCode, signalCode: child.signalCode });
  children.delete(child);
}

// Register before spawning or sending a key. Only an exact marker after the byte
// boundary satisfies a capture; ordinary status prose cannot satisfy the waiter.
const listeners = new Set();
function emit() {
  for (const listener of [...listeners]) listener();
}
function waitFrame(phase, from) {
  return new Promise((resolveFrame, reject) => {
    const timer = setTimeout(() => finish(new Error(`No QA ${phase} frame after byte ${from}`)), TIMEOUT);
    const finish = (error, value) => {
      clearTimeout(timer);
      listeners.delete(check);
      error ? reject(error) : resolveFrame(value);
    };
    const check = () => {
      const tail = stream.subarray(from).toString("latin1");
      const match = new RegExp(`\\x1b\\]0;QA_HISTORY;${phase};([A-Za-z0-9+/=]+)\\x07`).exec(tail);
      if (match) return finish(undefined, { start: from + match.index, end: from + match.index + match[0].length, state: JSON.parse(Buffer.from(match[1], "base64").toString()) });
      // A coalesced title still carries the tag; phase names are unique within a run.
      const frames = /\x1b\]0;QA_FRAME;\d+;([A-Za-z0-9+/=]+)\x07/g;
      let frame;
      while ((frame = frames.exec(tail))) {
        const tag = JSON.parse(Buffer.from(frame[1], "base64").toString()).tags?.find((entry) => entry.phase === phase);
        if (tag) return finish(undefined, { start: from + frame.index, end: from + frame.index + frame[0].length, state: tag.state });
      }
    };
    listeners.add(check);
    check();
  });
}
// The display paints the tail first and hydrates older history over later self-scheduled
// frames; a capture is the first frame after its tag whose hydration reached the floor.
const hydrated = (state) => typeof state.visibleFrom === "number" && state.visibleFrom === state.hydrationFloor;
async function settledFrame(phase, from) {
  const tagged = await waitFrame(phase, from);
  if (hydrated(tagged.state)) return { ...tagged, tagSeq: tagged.state.seq };
  return new Promise((resolveFrame, reject) => {
    const timer = setTimeout(() => finish(new Error(`No hydrated QA ${phase} frame after seq ${tagged.state.seq}`)), TIMEOUT);
    const finish = (error, value) => {
      clearTimeout(timer);
      listeners.delete(check);
      error ? reject(error) : resolveFrame(value);
    };
    const check = () => {
      const tail = stream.subarray(tagged.start).toString("latin1");
      const frames = /\x1b\]0;QA_FRAME;(\d+);([A-Za-z0-9+/=]+)\x07/g;
      let frame;
      while ((frame = frames.exec(tail))) {
        const { tags: _tags, ...state } = JSON.parse(Buffer.from(frame[2], "base64").toString());
        if (state.seq > tagged.state.seq && hydrated(state)) {
          return finish(undefined, { start: tagged.start + frame.index, end: tagged.start + frame.index + frame[0].length, state, tagSeq: tagged.state.seq });
        }
      }
    };
    listeners.add(check);
    check();
  });
}
function sanitizeScreen(text) {
  return text.split("\n").map((line) => line.replace(/\s+$/, "")).filter((line) => line.length > 0).join("\n");
}

async function xtermAssets() {
  const installed = [
    process.env.QA_XTERM_ROOT,
    join(REPO, "node_modules/@xterm/xterm"),
    join(dirname(DIST), "node_modules/@xterm/xterm"),
  ].filter(Boolean).find((path) => existsSync(join(path, "lib/xterm.js")));
  if (installed) return installed;
  const cache = join(RUN_TMP, "xterm");
  mkdirSync(cache);
  writeFileSync(join(cache, "package.json"), '{"name":"history-window-qa-assets","private":true}');
  const install = Bun.spawn([process.execPath, "add", "--exact", "@xterm/xterm@5.5.0"], { cwd: cache, env: { ...process.env, BUN_INSTALL_CACHE_DIR: join(RUN_TMP, "package-cache") }, stdout: "pipe", stderr: "pipe" });
  children.add(install);
  const [code, stdout, stderr] = await Promise.all([install.exited, new Response(install.stdout).text(), new Response(install.stderr).text()]);
  children.delete(install);
  report.xtermInstall = { exitCode: code, stdout, stderr };
  if (code !== 0) throw new Error(`Isolated xterm install exited ${code}: ${stderr}`);
  return join(cache, "node_modules/@xterm/xterm");
}

const PALETTES = {
  light: { background: "#ffffff", foreground: "#1f2328" },
  dark: { background: "#1f1f1f", foreground: "#e6edf3" },
};
function paletteFor(theme) {
  if (!comprehensive) return PALETTES.light;
  return theme === "dark" ? PALETTES.dark : PALETTES.light;
}

async function ensureBrowser() {
  if (page) return;
  const palette = paletteFor(themeArg);
  const assets = await xtermAssets();
  const [js, css] = await Promise.all([Bun.file(join(assets, "lib/xterm.js")).text(), Bun.file(join(assets, "css/xterm.css")).text()]);
  const html = `<!doctype html><meta charset="utf-8"><style>${css}body{margin:0;background:${palette.background}}</style>
<div id="terminal"></div><script>${js.replace(/<\/script/gi, "<\\/script")}</script><script>
const palette = ${JSON.stringify(palette)};
const cols = ${COLS}, rows = ${ROWS};
const RENDER_DEADLINE = ${RENDER_DEADLINE_MS};
// Subscribe to xterm's render event, then trigger the change and a full refresh; the promise
// settles only after xterm painted the current viewport rows, or rejects at the deadline.
const rendered = (term, trigger) => new Promise((resolve, reject) => {
  let sub;
  const timer = setTimeout(() => { sub.dispose(); reject(new Error("xterm render not observed within " + RENDER_DEADLINE + "ms")); }, RENDER_DEADLINE);
  sub = term.onRender(() => { clearTimeout(timer); sub.dispose(); resolve(); });
  trigger();
  term.refresh(0, term.rows - 1);
});
const viewText = (b) => Array.from({length:rows},(_,i)=>b.getLine(b.viewportY+i)?.translateToString(true)??"").join("\\n");
window.show = async (base64) => {
  try {
    window.term?.dispose();
    const el = document.getElementById("terminal"); el.innerHTML = "";
    const term = window.term = new Terminal({cols,rows,fontSize:13,fontFamily:"Consolas,monospace",scrollback:100000,theme:palette});
    term.open(el);
    await new Promise(resolve => term.write(Uint8Array.from(atob(base64), c => c.charCodeAt(0)), resolve));
    await rendered(term, () => {});
    const b = term.buffer.active;
    return {viewport:viewText(b),
      scrollback:Array.from({length:b.length},(_,i)=>b.getLine(i)?.translateToString(true)??"").join("\\n"),baseY:b.baseY,viewportY:b.viewportY, length:b.length};
  } catch (error) { return { error: String(error) }; }
};
window.findLine = (needle) => {
  const b = window.term.buffer.active;
  for (let i = 0; i < b.length; i += 1) if ((b.getLine(i)?.translateToString(true) ?? "").includes(needle)) return i;
  return -1;
};
// The rows xterm's DOM renderer last painted: the text the next screenshot shows.
window.painted = () => Array.from(document.querySelectorAll(".xterm-rows > div"), (row) => row.textContent.replace(/\\u00a0/g, " ").replace(/\\s+$/, "")).join("\\n");
// Put the scene's topmost marker row two rows below the viewport top and await that render.
// Blank rows are appended first when the scene sits in the frame's last screen.
window.scene = async (needles) => {
  try {
    const term = window.term, b = term.buffer.active;
    const indexes = needles.map((needle) => window.findLine(needle)).filter((index) => index >= 0);
    if (indexes.length === 0) return { index: -1, viewport: "" };
    const index = Math.min(...indexes);
    const top = Math.max(0, index - 2);
    const pad = top - b.baseY;
    if (pad > 0) await new Promise(resolve => term.write("\\x1b[" + rows + ";1H" + "\\r\\n".repeat(pad), resolve));
    await rendered(term, () => term.scrollToLine(top));
    return { index, top, viewportY: b.viewportY, baseY: b.baseY, viewport: viewText(b) };
  } catch (error) { return { error: String(error) }; }
};
</script>`;
  writeFileSync(join(EVIDENCE, "xterm.html"), html);
  server = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response(html, { headers: { "content-type": "text/html; charset=utf-8" } }) });
  const skill = process.env.QA_BROWSER_SKILL ?? join(homedir(), ".bun/install/global/node_modules/omo-ai/plugin/skills/browser");
  const { loadOmowright } = await import(pathToFileURL(join(skill, "scripts/omowright.mjs")).href);
  const { omowright } = await loadOmowright();
  const chrome = [process.env.QA_BROWSER_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"]
    .filter(Boolean).find(existsSync);
  if (!chrome) throw new Error("Set QA_BROWSER_PATH to a Chromium executable; raw captures are retained");
  const profile = join(RUN_TMP, "browser-profile");
  const launch = [chrome, "--headless=new", "--no-first-run", "--no-default-browser-check", "--disable-gpu",
    "--remote-debugging-port=0", `--user-data-dir=${profile}`, "--window-size=1500,950", "about:blank"];
  let chromeProc;
  const endpoint = new Promise((resolveEndpoint, reject) => {
    const timer = setTimeout(() => reject(new Error("Chrome CDP endpoint timeout")), TIMEOUT);
    chromeProc = Bun.spawn(launch, { env: process.env, stdout: "ignore", stderr: "pipe" });
    children.add(chromeProc);
    (async () => {
      let text = "";
      for await (const chunk of chromeProc.stderr) {
        text += Buffer.from(chunk).toString();
        const match = /DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//.exec(text);
        if (match) { clearTimeout(timer); resolveEndpoint(`http://127.0.0.1:${match[1]}`); }
      }
      clearTimeout(timer);
      reject(new Error(`Chrome exited before CDP endpoint: ${text}`));
    })().catch(reject);
  });
  report.browser = { command: launch, transport: "socket", palette };
  browser = await omowright.connect(await endpoint);
  const targets = await browser.listTargets();
  const target = targets.find((item) => item.type === "page");
  if (!target) throw new Error("Owned Chrome has no page target");
  page = await browser.attachPage(target.targetId ?? target.id);
  await page.goto(`http://127.0.0.1:${server.port}/`, { waitUntil: "load" });
}

const CURSOR_MARKER = "\x1b_pi:c\x07";
const committed = new Map();
function frameRecords() {
  return existsSync(FRAME_LOG) ? readFileSync(FRAME_LOG, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
}
function frameRecord(seq) {
  const record = frameRecords().find((entry) => entry.seq === seq);
  if (!record) throw new Error(`QA committed frame record seq ${seq} missing`);
  return record;
}
function latestRecord() {
  const records = frameRecords();
  if (records.length === 0) throw new Error("QA committed frame log is empty");
  return records[records.length - 1];
}
const plainLine = (line) => Bun.stripANSI(line.replaceAll(CURSOR_MARKER, "")).replace(/\s+$/, "");
// The visible rows of a committed frame, as the TUI maps terminal rows to frame lines.
const visibleText = (record) => record.visible.map(plainLine).join("\n");
// Attach a tagged frame's committed text to its capture; the full frame is the scrollback.
function commit(phase, capture) {
  const record = frameRecord(capture.state.seq);
  if (!hydrated(record)) throw new Error(`QA ${phase} frame seq ${capture.state.seq} is not hydrated`);
  committed.set(phase, record);
  capture.viewport = visibleText(record);
  capture.frame = { seq: record.seq, tagSeq: capture.tagSeq, viewportTop: record.viewportTop, lines: record.lines.length, anchorKind: record.anchorKind, mouseReady: record.mouseReady };
  return capture;
}
// The committed frame up to the viewport bottom, so xterm scrollback holds every line above it.
// Rows past the frame end stay blank, as on the terminal after a block shrinks.
const frameBytes = (record) => Buffer.from(Array.from({ length: record.viewportTop + ROWS }, (_, index) => (record.lines[index] ?? "").replaceAll(CURSOR_MARKER, ""))
  .join("\r\n"), "utf8").toString("base64");

// window.show and window.scene report a missed render deadline as { error }, never a stale view.
async function inPage(expression) {
  const value = await page.evaluate(expression);
  if (value?.error) throw new Error(`QA xterm ${expression.slice(0, 40)}: ${value.error}`);
  return value;
}
const sha256 = (bytes) => new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

async function renderCaptures(palette = paletteFor(themeArg)) {
  await ensureBrowser();
  for (const [phase, capture] of Object.entries(report.captures)) {
    if (comprehensive) {
      // The PNG and text show the committed frame's visible rows; the frame text is every line it holds.
      const screen = await inPage(`window.show(${JSON.stringify(frameBytes(committed.get(phase)))})`);
      capture.scrollback = committed.get(phase).lines.map(plainLine).join("\n");
      writeFileSync(join(EVIDENCE, `${phase}.txt`), capture.viewport);
      writeFileSync(join(EVIDENCE, `${phase}-frame.txt`), capture.scrollback);
      writeFileSync(join(EVIDENCE, `${phase}.png`), await page.screenshot());
      capture.screen = { baseY: screen.baseY, viewportY: screen.viewportY };
      capture.sentinels = Object.fromEntries(["QA_COMPREHENSIVE_BEGIN", "QA_COMPREHENSIVE_END", ...ALL_MARKERS].map((needle) => [needle, capture.scrollback.includes(needle)]));
      capture.palette = palette;
      continue;
    }
    const base64 = stream.subarray(0, capture.end).toString("base64");
    const screen = await inPage(`window.show(${JSON.stringify(base64)})`);
    writeFileSync(join(EVIDENCE, `${phase}.txt`), screen.viewport);
    writeFileSync(join(EVIDENCE, `${phase}-scrollback.txt`), screen.scrollback);
    writeFileSync(join(EVIDENCE, `${phase}.png`), await page.screenshot());
    capture.screen = { baseY: screen.baseY, viewportY: screen.viewportY };
    const needles = comprehensive
      ? ["QA_COMPREHENSIVE_BEGIN", "QA_COMPREHENSIVE_END", ...ALL_MARKERS]
      : ["QA_HISTORY_BEGIN", "QA_HISTORY_END", "QA_ERROR_VISIBLE", "QA_NOTICE_EXPANDED", "QA_LONG_5_075"];
    capture.sentinels = Object.fromEntries(needles.map((needle) => [needle, screen.scrollback.includes(needle)]));
    capture.viewport = screen.viewport;
    capture.scrollback = screen.scrollback;
    capture.palette = palette;
  }
}

async function sceneCaptures() {
  if (!comprehensive || !report.captures.recollapsed) return;
  // ConPTY re-serializes output on its own schedule, so only the closed stream is a complete
  // terminal; it is kept as evidence of the state after the header round trip.
  const terminal = await inPage(`window.show(${JSON.stringify(stream.toString("base64"))})`);
  report.finalTerminal = { baseY: terminal.baseY, viewportY: terminal.viewportY, length: terminal.length };
  writeFileSync(join(EVIDENCE, "final-scrollback.txt"), terminal.scrollback);
  writeFileSync(join(EVIDENCE, "final.txt"), terminal.viewport);
  writeFileSync(join(EVIDENCE, "final.png"), await page.screenshot());
  // Scenes come from the hydrated recollapsed frame, which holds the whole collapsed transcript.
  const final = report.captures.recollapsed;
  mkdirSync(join(EVIDENCE, "scenes"), { recursive: true });
  const lines = final.scrollback.split("\n");
  report.scenes = [];
  for (const scene of comprehensiveScenes) {
    const index = lines.findIndex((line) => scene.markers.some((marker) => line.includes(marker)));
    const slice = index < 0 ? "" : lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 12)).join("\n");
    writeFileSync(join(EVIDENCE, "scenes", `${scene.name}.txt`), slice);
    // Each scene starts from a fresh recollapsed frame; the screenshot follows the observed render.
    const expected = noFold ? scene.markers : scene.foldMarkers;
    await inPage(`window.show(${JSON.stringify(frameBytes(committed.get("recollapsed")))})`);
    const view = await inPage(`window.scene(${JSON.stringify(expected)})`);
    const painted = await page.evaluate("window.painted()");
    const png = await page.screenshot();
    writeFileSync(join(EVIDENCE, "scenes", `${scene.name}.png`), png);
    writeFileSync(join(EVIDENCE, "scenes", `${scene.name}-viewport.txt`), view.viewport);
    writeFileSync(join(EVIDENCE, "scenes", `${scene.name}-painted.txt`), painted);
    report.scenes.push({ name: scene.name, markers: scene.markers, found: scene.markers.filter((marker) => final.scrollback.includes(marker)),
      missing: scene.markers.filter((marker) => !final.scrollback.includes(marker)), scrollback: slice,
      view: { index: view.index, top: view.top, viewportY: view.viewportY, baseY: view.baseY },
      viewportMissing: expected.filter((marker) => !view.viewport.includes(marker)), paintedMissing: expected.filter((marker) => !painted.includes(marker)), pngSha256: sha256(png) });
  }
}

try {
  mkdirSync(AGENT, { recursive: true });
  mkdirSync(dirname(SESSION), { recursive: true });
  const theme = comprehensive ? themeArg : "grok-day";
  let themeName = theme;
  const settings = { theme: themeName, packages: [], hideThinkingBlock: true, disabledBuiltinExtensions: ["codemode"], showCacheMissNotices: false,
    ...(comprehensive ? { terminal: { mouse: "always" } } : {}) };
  if (lightRun) {
    const source = resolve(themeArg);
    const themeJson = JSON.parse(readFileSync(source, "utf8"));
    themeName = typeof themeJson.name === "string" && themeJson.name.length > 0 ? themeJson.name : basename(source, ".json");
    mkdirSync(join(AGENT, "themes"), { recursive: true });
    writeFileSync(join(AGENT, "themes", `${themeName}.json`), JSON.stringify(themeJson, null, 2));
    settings.theme = themeName;
  }
  writeFileSync(join(AGENT, "settings.json"), JSON.stringify(settings));
  const sessionFixture = comprehensive ? comprehensiveFixture() : { text: fixture(), toolCount: 0 };
  writeFileSync(SESSION, sessionFixture.text);
  writeFileSync(join(EVIDENCE, "synthetic-session.jsonl"), sessionFixture.text);
  writeFileSync(QA_TOOL, qaExtension());
  writeFileSync(join(EVIDENCE, "qa-tools.ts"), qaExtension());
  const { brandEnvNames } = await import(pathToFileURL(join(DIST, "core/brand.js")).href);
  const home = join(RUN_TMP, "home");
  const isolated = Object.fromEntries([
    ["HOME", home], ["USERPROFILE", home],
    ["APPDATA", join(RUN_TMP, "appdata")], ["LOCALAPPDATA", join(RUN_TMP, "localappdata")],
    ...[...brandEnvNames("CODING_AGENT_DIR"), "OMO_CODING_AGENT_DIR", "SENPI_CODING_AGENT_DIR", "PI_CODING_AGENT_DIR"].map((name) => [name, AGENT]),
  ]);
  // The owned scratch itself lives below the OS temp directory; forbid the user's
  // real profile roots instead of rejecting that owned temp subtree.
  const realRoots = [join(homedir(), ".omo"), join(homedir(), ".bun"), join(homedir(), ".claude"), process.env.APPDATA]
    .filter(Boolean).map((path) => resolve(path).toLowerCase());
  const exactProfiles = [homedir(), process.env.USERPROFILE, process.env.APPDATA, process.env.LOCALAPPDATA]
    .filter(Boolean).map((path) => resolve(path).toLowerCase());
  const ownedRoot = resolve(RUN_TMP).toLowerCase();
  for (const [name, value] of Object.entries(isolated)) {
    const normalized = resolve(value).toLowerCase();
    const escapes = !(normalized === ownedRoot || normalized.startsWith(`${ownedRoot}\\`));
    const realProfile = exactProfiles.includes(normalized) || realRoots.some((path) => normalized === path || normalized.startsWith(`${path}\\`));
    if (escapes || realProfile) throw new Error(`Isolated ${name}=${value} escapes scratch ${RUN_TMP}`);
  }
  report.isolatedEnv = isolated;
  console.log(JSON.stringify({ isolatedEnv: isolated, runTmp: RUN_TMP, evidence: EVIDENCE, dimensions: { cols: COLS, rows: ROWS }, theme: settings.theme }, null, 2));
  const env = { ...process.env, ...isolated, PI_TUI_HISTORY_LINES: comprehensive ? "5000" : "100", TERM: "xterm-256color", COLORTERM: "truecolor",
    ...(comprehensive && process.env.QA_DISABLE_MOUSE_TRACKING !== "1" ? { WT_SESSION: "qa-owned" } : {}) };
  if (comprehensive && process.env.QA_DISABLE_MOUSE_TRACKING === "1") delete env.WT_SESSION;
  const command = [process.execPath, CLI, "--session", SESSION, "--no-extensions", "--no-skills", "--no-prompt-templates", "--no-context-files", "--no-approve", "--offline",
    ...(!noFold ? ["-e", join(REPO, "extension/tool-fold.ts")] : []), "-e", QA_TOOL];
  report.engine = { command, cwd: RUN_TMP, isolatedEnv: isolated, tempEnv: Object.fromEntries(["RUN_TMP", "TMPDIR", "TMP", "TEMP", "NODE_COMPILE_CACHE", "BUN_RUNTIME_TRANSPILER_CACHE_PATH"].map((key) => [key, env[key]])) };
  const initial = comprehensive ? settledFrame("initial", 0) : waitFrame("initial", 0);
  const engine = Bun.spawn(command, { cwd: RUN_TMP, env, terminal: { cols: COLS, rows: ROWS,
    data(_terminal, bytes) {
      stream = Buffer.concat([stream, Buffer.from(bytes)]);
      emit();
    },
  } });
  children.add(engine);
  report.engine.pid = engine.pid;
  report.captures.initial = await initial;
  if (comprehensive) {
    commit("initial", report.captures.initial);
    const raw = stream.toString("latin1");
    const mouseReady = raw.includes("[?1006h") && (raw.includes("[?1000h") || raw.includes("[?1002h"));
    report.mouseMode = { sgr: raw.includes("[?1006h"), tracking1000: raw.includes("[?1000h"), tracking1002: raw.includes("[?1002h"), ready: mouseReady };
    if (!mouseReady) throw new Error("QA mouse mode missing: expected ?1006h and ?1000h or ?1002h");
  }
  for (const phase of ["expanded", "recollapsed"]) {
    const from = stream.length;
    const frame = comprehensive ? settledFrame(phase, from) : waitFrame(phase, from);
    report.actions.push({ action: "write", bytesHex: "0f", phase, fromByte: from, cols: COLS, rows: ROWS });
    engine.terminal.write("\x0f");
    report.captures[phase] = await frame;
    if (comprehensive) commit(phase, report.captures[phase]);
  }
  if (comprehensive) {
    // The QA extension tags the first frame committed after each SGR report as mouse<N>,
    // so each click awaits exactly the frame that shows its effect.
    let mouseInputs = 0;
    const click = async (row, purpose) => {
      mouseInputs += 2;
      const phase = `mouse${mouseInputs}`;
      const from = stream.length;
      const frame = settledFrame(phase, from);
      report.actions.push({ action: "mouse-sgr", purpose, phase, row, col: 3, fromByte: from, sequence: `ESC[<0;3;${row}M ESC[<0;3;${row}m` });
      engine.terminal.write(`\x1b[<0;3;${row}M\x1b[<0;3;${row}m`);
      return frame;
    };
    const rowsOf = (record) => record.visible.map(plainLine);
    const masked = (record) => sanitizeScreen(visibleText(record).replace(SPINNER, "*"));
    const maskedFrame = (record) => record.lines.map((line) => plainLine(line).replace(SPINNER, "*")).join("\n");
    // Rows owned by any group block: its spacer, header and member lines up to the next blank row.
    const groupRows = (rows) => {
      const owned = new Set();
      rows.forEach((line, index) => {
        if (!/(Ran|Running) \d+ (tools|evals)/.test(line)) return;
        owned.add(index - 1);
        for (let next = index; next < rows.length && (next === index || rows[next].trim().length > 0); next += 1) owned.add(next);
      });
      return owned;
    };
    // The viewport keeps the rows the expansion scrolled off, so the restored screen is the
    // pre-click screen moved up by that many rows, with blank rows below the footer.
    const alignedRestore = (before, after) => {
      const beforeRows = before.visible.map((line) => plainLine(line).replace(SPINNER, "*"));
      const afterRows = after.visible.map((line) => plainLine(line).replace(SPINNER, "*"));
      let used = afterRows.length;
      while (used > 0 && afterRows[used - 1] === "") used -= 1;
      const offset = afterRows.length - used;
      return { restoredOffset: offset, restoredAlignedEqual: afterRows.slice(0, used).join("\n") === beforeRows.slice(offset).join("\n") };
    };
    const requireMouse = (record, frameName) => {
      if (!record.mouseReady || !hydrated(record)) throw new Error(`QA mouse anchor not ready (${record.anchorKind}) in ${frameName} frame seq ${record.seq}`);
    };
    const preRecord = latestRecord();
    requireMouse(preRecord, "recollapsed");
    writeFileSync(join(EVIDENCE, "mouse-pre.txt"), visibleText(preRecord));
    report.mouseProof = { preSeq: preRecord.seq, preExpandedCards: preRecord.expandedCards };
    if (!noFold) {
      const headerIndex = rowsOf(preRecord).findIndex((line) => line.includes(TAIL_HEADER));
      if (headerIndex < 0) throw new Error(`QA mixed-group header row not found in recollapsed frame seq ${preRecord.seq}`);
      const expanded = commit("mouse-expanded", await click(headerIndex + 1, "header expand"));
      report.captures["mouse-expanded"] = expanded;
      const expandedRecord = committed.get("mouse-expanded");
      requireMouse(expandedRecord, "mouse-expanded");
      const expandedIndex = rowsOf(expandedRecord).findIndex((line) => line.includes(TAIL_HEADER));
      if (expandedIndex < 0) throw new Error(`QA mixed-group header row not found in mouse-expanded frame seq ${expandedRecord.seq}`);
      const restored = commit("mouse-recollapsed", await click(expandedIndex + 1, "header collapse"));
      report.captures["mouse-recollapsed"] = restored;
      Object.assign(report.mouseProof, {
        headerRow: headerIndex + 1, expandedHeaderRow: expandedIndex + 1,
        expandedCards: expanded.state.expandedCards, restoredCards: restored.state.expandedCards,
        bodyVisibleBefore: TAIL_BODY_MARKERS.filter((marker) => visibleText(preRecord).includes(marker)),
        bodyVisibleExpanded: TAIL_BODY_MARKERS.filter((marker) => expanded.viewport.includes(marker)),
        // The main-screen viewport cannot scroll back after the block shrinks, so the restored
        // screen proof is the committed frame plus the collapsed block on the visible rows.
        restoredFrameEqual: maskedFrame(preRecord) === maskedFrame(committed.get("mouse-recollapsed")),
        restoredVisibleEqual: masked(preRecord) === masked(committed.get("mouse-recollapsed")),
        ...alignedRestore(preRecord, committed.get("mouse-recollapsed")),
        restoredCollapsedVisible: restored.viewport.includes(TAIL_HEADER) && restored.viewport.includes("QA_TAIL_EVAL_SUMMARY") &&
          restored.viewport.includes("kill_bash bash_qa_tail: QA_TAIL_KILL_RECEIPT") && TAIL_BODY_MARKERS.every((marker) => !restored.viewport.includes(marker)),
      });
    }
    const beforeRecord = latestRecord();
    const beforeName = noFold ? "recollapsed" : "mouse-recollapsed";
    requireMouse(beforeRecord, beforeName);
    const beforeRows = rowsOf(beforeRecord);
    const owned = groupRows(beforeRows);
    const outsideIndex = beforeRows.findIndex((line, index) => line.includes("QA_COMPREHENSIVE_END") && !owned.has(index) && !line.includes("└"));
    if (outsideIndex < 0) throw new Error(`QA outside-header row (non-group QA_COMPREHENSIVE_END text) not found in ${beforeName} frame seq ${beforeRecord.seq}`);
    const outside = commit("mouse-outside", await click(outsideIndex + 1, noFold ? "native outside-header negative" : "outside-header negative"));
    report.captures["mouse-outside"] = outside;
    Object.assign(report.mouseProof, { outsideRow: outsideIndex + 1, outsideBeforeSeq: beforeRecord.seq, outsideBeforeCards: beforeRecord.expandedCards,
      outsideAfterCards: outside.state.expandedCards, outsideScreenEqual: masked(beforeRecord) === masked(committed.get("mouse-outside")) });
  }
  await kill(engine, "isolated engine");
  if (comprehensive) writeFileSync(join(EVIDENCE, "frames.jsonl"), existsSync(FRAME_LOG) ? readFileSync(FRAME_LOG) : "");
  writeFileSync(join(EVIDENCE, "raw.ansi"), stream);
  for (const [phase, capture] of Object.entries(report.captures)) {
    if (capture.end) writeFileSync(join(EVIDENCE, `${phase}.ansi`), stream.subarray(0, capture.end));
  }
  await renderCaptures();
  if (comprehensive) await sceneCaptures();
  const initialScreen = report.captures.initial.viewport ?? "";
  const finalScreen = report.captures.recollapsed.viewport ?? "";
  const finalScrollback = report.captures.recollapsed.scrollback ?? "";
  const executeCalls = existsSync(EXECUTE_COUNTER) ? readFileSync(EXECUTE_COUNTER, "utf8").split(/\r?\n/).filter(Boolean).length : 0;
  report.executeCalls = executeCalls;
  try {
    const packageJson = JSON.parse(readFileSync(join(dirname(DIST), "package.json"), "utf8"));
    report.runtime.version = packageJson.version ?? null;
  } catch {
    try {
      const packageJson = JSON.parse(readFileSync(join(DIST, "package.json"), "utf8"));
      report.runtime.version = packageJson.version ?? null;
    } catch { report.runtime.version = "unreported"; }
  }
  if (comprehensive) {
    let provenance = {};
    let definitions = {};
    try { provenance = JSON.parse(readFileSync(PROVENANCE, "utf8")); } catch {}
    try { definitions = JSON.parse(readFileSync(DEFINITIONS, "utf8")); } catch {}
    const mouseEvents = existsSync(MOUSE_LOG) ? readFileSync(MOUSE_LOG, "utf8").split(/\r?\n/).filter(Boolean).map((line) => JSON.parse(line)) : [];
    const expectedShapes = {
      two: NATIVE_TWO_SLOT, no: NATIVE_NO_SLOT, call: NATIVE_CALL_ONLY,
      syntheticNoSlot: ["workflow", "workpool", "thread_send", "thread_report", "thread_answer"],
    };
    const shapeFailures = [];
    for (const name of expectedShapes.two) {
      const shape = definitions[name];
      if (!shape?.found || shape.renderCall !== "function" || shape.renderResult !== "function") shapeFailures.push(`${name}: expected two renderer slots`);
    }
    for (const name of [...expectedShapes.no, ...expectedShapes.syntheticNoSlot]) {
      const shape = definitions[name];
      if (!shape?.found || shape.renderCall === "function" || shape.renderResult === "function") shapeFailures.push(`${name}: expected no renderer slots`);
    }
    for (const name of expectedShapes.call) {
      const shape = definitions[name];
      if (!shape?.found || shape.renderCall !== "function" || shape.renderResult === "function") shapeFailures.push(`${name}: expected call-only slot`);
    }
    if (!definitions["mcp_context7_query-docs"] || definitions["mcp_context7_query-docs"].renderCall !== "function" || definitions["mcp_context7_query-docs"].renderResult !== "function") shapeFailures.push("mcp_context7_query-docs: expected two synthetic slots");
    if (!definitions["mcp_grep_app_searchGitHub"] || definitions["mcp_grep_app_searchGitHub"].renderCall !== "function" || definitions["mcp_grep_app_searchGitHub"].renderResult === "function") shapeFailures.push("mcp_grep_app_searchGitHub: expected call-only stub");
    for (const name of NATIVE_FIXTURES) if (!definitions[name]?.found) shapeFailures.push(`${name}: missing native definition`);
    for (const name of SYNTHETIC_NAMES) if (!definitions[name]?.found || definitions[name].provenance !== "synthetic") shapeFailures.push(`${name}: missing synthetic provenance`);
    const missingMarkers = ALL_MARKERS.filter((marker) => !finalScrollback.includes(marker));
    const sceneResults = comprehensiveScenes.map((scene) => {
      const expected = noFold ? scene.markers : scene.foldMarkers;
      return {
        name: scene.name,
        markers: scene.markers,
        foldMarkers: scene.foldMarkers,
        found: expected.filter((marker) => finalScrollback.includes(marker)),
        missing: expected.filter((marker) => !finalScrollback.includes(marker)),
      };
    });
    const foldSceneMissing = sceneResults.flatMap((scene) => scene.missing);
    report.definitions = definitions;
    report.provenance = provenance;
    report.mouseEvents = mouseEvents;
    report.fixture = { expectedToolCards: sessionFixture.toolCount, nativeNames: NATIVE_FIXTURES, syntheticNames: SYNTHETIC_NAMES };
    report.sceneAssertions = sceneResults;
    // Cell widths of every committed frame line, measured on the visible text like a terminal.
    const overflows = [...committed].flatMap(([phase, record]) => record.lines.map((line, index) => ({ phase, index, width: Bun.stringWidth(plainLine(line)) }))
      .filter((entry) => entry.width > COLS));
    const maxWidths = Object.fromEntries([...committed].map(([phase, record]) => [phase, Math.max(0, ...record.lines.map((line) => Bun.stringWidth(plainLine(line))))]));
    const collapsedRaw = ["initial", "recollapsed"].map((phase) => [phase, committed.get(phase).lines.join("\n")]);
    const leaks = collapsedRaw.flatMap(([phase, raw]) => [INJECT_OSC, "QA_INJECT", INJECT_CSI].filter((needle) => raw.includes(needle)).map((needle) => ({ phase, needle: JSON.stringify(needle) })));
    const sceneHashes = (report.scenes ?? []).map((scene) => scene.pngSha256);
    const recollapsedPng = sha256(readFileSync(join(EVIDENCE, "recollapsed.png")));
    report.assertions = [
      { name: "initial body visible", ok: initialScreen.includes("QA_COMPREHENSIVE") },
      { name: "expanded full history rendered", ok: report.captures.expanded.state.historyStart === 0 && report.captures.expanded.state.expandedCards === sessionFixture.toolCount &&
        report.captures.expanded.scrollback.includes("QA_EVAL_MIXED_OUTPUT") },
      { name: "expanded content visible", ok: report.captures.expanded.scrollback.includes("QA_COMPREHENSIVE_END") },
      { name: "recollapsed body visible", ok: finalScreen.includes("QA_COMPREHENSIVE_END") },
      { name: noFold ? "native scene markers after recollapse" : "grouped scene markers after recollapse",
        ok: noFold ? missingMarkers.length === 0 : foldSceneMissing.length === 0,
        missing: noFold ? missingMarkers : foldSceneMissing },
      { name: "unsafe cards outside compact runs", ok: UNSAFE_MARKERS.every((marker) => finalScrollback.includes(marker)) },
      { name: "definition provenance and slots", ok: shapeFailures.length === 0 && (provenance.failures ?? []).length === 0, failures: [...(provenance.failures ?? []), ...shapeFailures] },
      { name: "synthetic fixtures never execute", ok: executeCalls === 0 && !stream.toString().includes("QA_MUST_NOT_EXECUTE"), executeCalls },
      { name: "fixture tool-card count", ok: sessionFixture.toolCount === 35, actual: sessionFixture.toolCount },
      { name: "mouse mode enabled", ok: report.mouseMode?.ready === true },
      { name: "outside-header click is a no-op", ok: report.mouseProof.outsideScreenEqual === true && mouseEvents.length > 0 &&
        report.mouseProof.outsideAfterCards === report.mouseProof.outsideBeforeCards, proof: report.mouseProof },
      { name: "no runtime renderer failure", ok: !/QA_RENDER_SEAM_MISSING|Failed to load extension|TypeError:|detachAll|\[render error/.test(Bun.stripANSI(stream.toString())) },
      { name: "runtime version recorded", ok: typeof report.runtime.version === "string" && report.runtime.version.length > 0 },
      { name: "captures complete", ok: ["initial", "expanded", "recollapsed", "mouse-outside", ...(noFold ? [] : ["mouse-expanded", "mouse-recollapsed"])].every((phase) => existsSync(join(EVIDENCE, `${phase}.png`))) },
      { name: "scene PNGs show their own markers", ok: report.scenes?.length === comprehensiveScenes.length && report.scenes.every((scene) => scene.view.index >= 0 && scene.viewportMissing.length === 0 && scene.paintedMissing.length === 0),
        scenes: report.scenes?.map((scene) => ({ name: scene.name, top: scene.view.top, missing: scene.viewportMissing, paintedMissing: scene.paintedMissing })) },
      { name: "scene PNGs are distinct renders", ok: sceneHashes.length === comprehensiveScenes.length && new Set(sceneHashes).size === sceneHashes.length && !sceneHashes.includes(recollapsedPng),
        recollapsedPng, scenes: report.scenes?.map((scene) => ({ name: scene.name, sha256: scene.pngSha256 })) },
      { name: "no committed frame line exceeds QA_COLS cells", ok: overflows.length === 0, cols: COLS, maxWidths, overflows: overflows.slice(0, 20) },
    ];
    if (!noFold) {
      report.assertions.push(
        { name: "Korean source text visible in initial and recollapsed frames", ok: ["initial", "recollapsed"].every((phase) => KOREAN_MARKERS.every((marker) => report.captures[phase].scrollback.includes(marker))),
          markers: KOREAN_MARKERS, missing: ["initial", "recollapsed"].flatMap((phase) => KOREAN_MARKERS.filter((marker) => !report.captures[phase].scrollback.includes(marker)).map((marker) => `${phase}: ${marker}`)) },
        { name: "injected escapes absent from collapsed frames", ok: leaks.length === 0, leaks },
      );
    }
    if (!noFold) {
      const proof = report.mouseProof;
      report.assertions.push(
        { name: "header click expands every member", ok: proof.preExpandedCards === 0 && proof.expandedCards === TAIL_MEMBERS &&
          proof.bodyVisibleBefore.length === 0 && proof.bodyVisibleExpanded.length === TAIL_BODY_MARKERS.length, proof },
        { name: "second header click restores the pre-click screen", ok: proof.restoredFrameEqual === true && proof.restoredAlignedEqual === true && proof.restoredCollapsedVisible === true &&
          proof.restoredOffset === proof.headerRow - proof.expandedHeaderRow &&
          proof.restoredCards === proof.preExpandedCards, proof },
      );
    }
  } else {
    report.assertions = [
      { name: "initial body and error visible", ok: initialScreen.includes("QA_HISTORY_END") && initialScreen.includes("QA_ERROR_VISIBLE") },
      { name: "expanded history overflow", ok: report.captures.expanded.state.historyStart > 0 },
      { name: "expanded multiline content visible", ok: report.captures.expanded.viewport.includes("QA_LONG_") },
      { name: "recollapsed body and error visible", ok: finalScreen.includes("QA_HISTORY_END") && finalScreen.includes("QA_ERROR_VISIBLE") },
      { name: "recollapsed long output hidden", ok: !finalScreen.includes("QA_LONG_") },
      { name: "no runtime renderer failure", ok: !/QA_RENDER_SEAM_MISSING|Failed to load extension|TypeError:|detachAll|\[render error/.test(Bun.stripANSI(stream.toString())) },
    ];
    if (!noFold) report.assertions.push({ name: "recollapsed compact summaries restored", ok: finalScreen.includes("QA_STEP_1") && finalScreen.includes("QA_STEP_5") });
    report.assertions.push(
      { name: "synthetic eval never executes", ok: executeCalls === 0 && !stream.toString().includes("QA_MUST_NOT_EXECUTE"), executeCalls },
      { name: "runtime version recorded", ok: typeof report.runtime.version === "string" && report.runtime.version.length > 0 },
    );
  }
  if (report.assertions.some((assertion) => !assertion.ok)) throw new Error("Replay assertions failed; inspect report.json and PNG captures");
} catch (error) {
  failure = error;
  report.error = error.stack ?? String(error);
} finally {
  if (browser) {
    try { await browser.close(); cleanup.push({ action: "browser connection closed" }); }
    catch (error) { cleanup.push({ action: "browser close failed", error: String(error) }); }
  }
  if (server) { server.stop(true); cleanup.push({ action: "capture server stopped" }); }
  for (const child of [...children]) {
    try { await kill(child, "owned child"); }
    catch (error) { cleanup.push({ action: "process cleanup failed", pid: child.pid, error: String(error) }); failure ??= error; }
  }
  writeFileSync(join(EVIDENCE, "raw.ansi"), stream);
  try {
    rmSync(RUN_TMP, { recursive: true, force: true });
    cleanup.push({ action: "temporary directory removed", path: RUN_TMP, remains: existsSync(RUN_TMP) });
  } catch (error) {
    cleanup.push({ action: "temporary directory removal failed", path: RUN_TMP, error: String(error) });
    failure ??= error;
  }
  report.liveResources = children.size;
  report.cleanupReceipt = { path: RUN_TMP, removed: !existsSync(RUN_TMP), liveResources: children.size };
  writeFileSync(join(EVIDENCE, "report.json"), JSON.stringify(report, null, 2));
  writeFileSync(join(EVIDENCE, "cleanup.json"), JSON.stringify(report.cleanupReceipt, null, 2));
}
console.log(JSON.stringify({ provider, noFold, scenario: report.scenario, evidence: EVIDENCE, assertions: report.assertions, executeCalls: report.executeCalls, cleanup, error: report.error }, null, 2));
if (failure) process.exitCode = 1;
