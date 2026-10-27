// senpi has no public API for changing how another tool is drawn, so this wraps
// AgentSession.prototype.getToolDefinition, which the TUI uses to look up tool renderers.
// Every step feature-detects and falls back to the original renderer: if an update changes
// these internals, the extension turns itself off instead of breaking the TUI.
// The prototype hook is installed once per process and always dispatches to the most recently
// loaded copy of this file, so editing it and reloading takes effect without restarting omo.
// Additional seams hide finished thinking labels, group folded evals and reset expansion history; each is
// feature-detected on its own and dispatches through the same replaceable implementation.

import { createEvalGroupClass } from "./eval-group-view";
import { groupEvalRuns, type MemberLine } from "./eval-run";
import { hideCollapsedNotices } from "./hidden-notices";
import { hideFinishedThinking, type RenderDescriptor } from "./thinking-label";

const HOOK = Symbol.for("omo.tool-fold.hook.v2");
const IMPL = Symbol.for("omo.tool-fold.impl.v2");
const WRAPPED = Symbol.for("omo.tool-fold.wrapped.v2");
const PROJECTED = Symbol.for("omo.tool-fold.projection.v1");
const OWN = Symbol.for("omo.tool-fold.component");
const THINKING_HOOK = Symbol.for("omo.tool-fold.thinking-hook.v1");
const GROUP_HOOK = Symbol.for("omo.tool-fold.group-hook.v1");
const PROJECT_HOOK = Symbol.for("omo.tool-fold.project-hook.v1");
const EXPANSION_HOOK = Symbol.for("omo.tool-fold.expansion-hook.v1");
const GROUP_PART = "도구 묶음";
const LIVE_EVAL_STATES = new Set(["pending", "queued", "running", "detached"]);
const COMPACT_TOOLS = new Set([
	"web_search",
	"webfetch",
	"write",
	"memory",
	"look_at",
	"powershell",
	"bash_output",
	"tool_search",
	"task",
	"task_output",
	"task_send",
	"task_cancel",
	"team_create",
	"team_delete",
	"task_create",
	"task_get",
	"task_list",
	"task_update",
	"create_goal",
	"update_goal",
	"get_goal",
	"lsp_diagnostics",
	"lsp_goto_definition",
	"lsp_find_references",
	"lsp_symbols",
	"lsp_prepare_rename",
	"lsp_rename",
	"bash",
	"glob",
	"mcp__ast_grep_rewrite",
	"mcp__ast_grep_scan",
	"mcp__ast_grep_search",
	"mcp_context7_query-docs",
	"mcp_context7_resolve-library-id",
	"mcp_grep_app_searchGitHub",
]);
/** Exact MCP names: only two-slot full definitions are wrapped; inactive stubs stay native. */
const MCP_TOOLS = new Set([
	"mcp__ast_grep_rewrite",
	"mcp__ast_grep_scan",
	"mcp__ast_grep_search",
	"mcp_context7_query-docs",
	"mcp_context7_resolve-library-id",
	"mcp_grep_app_searchGitHub",
]);
/** Ordinary thread receipts: summarized inside a run, never given renderer slots. */
const THREAD_TOOLS = new Set([
	"thread_create",
	"thread_list",
	"thread_read",
	"thread_send",
	"thread_interrupt",
	"thread_handoff",
	"thread_rename",
	"thread_set_model",
	"thread_set_reasoning",
	"thread_bind",
	"thread_unbind",
	"thread_rebind",
	"thread_bindings",
	"thread_report",
	"thread_outbox",
	"thread_outbox_ack",
]);
const THREAD_DELIVERIES = new Set(["steered", "started", "queued", "queued_offline"]);
const THREAD_REPORT_KINDS = new Set(["milestone", "report", "completion"]);

/** Audited default-rendered controls: summarized only inside a run, never given renderer slots. */
const PROJECTION_TOOLS = new Set([
	"kill_bash",
	"monitor",
	"schedule_wakeup",
	"schedule_prompt",
	"workflow",
	"workpool",
	"thread_create",
	"thread_list",
	"thread_read",
	"thread_send",
	"thread_interrupt",
	"thread_handoff",
	"thread_rename",
	"thread_set_model",
	"thread_set_reasoning",
	"thread_bind",
	"thread_unbind",
	"thread_rebind",
	"thread_bindings",
	"thread_report",
	"thread_outbox",
	"thread_outbox_ack",
]);
const WORKFLOW_ACTIONS = new Set(["start", "attach", "snapshot", "wait", "cancel", "retry", "send", "amend"]);
const WORKFLOW_KINDS = new Set(["started", "attached", "snapshot", "waited", "detached", "cancelled", "retried", "sent", "amended"]);
const RUN_STATUSES = new Set(["pending", "running", "paused", "completed"]);
/** Installed task statuses that are not failures: error, cancelled, interrupted and lost are not here. */
const TASK_CLEAR_STATUSES = new Set(["pending", "running", "paused", "completed"]);
const BAD_NODE_STATES = new Set(["failed", "cancelled", "skipped"]);
const POOL_OPS = new Set(["create", "push", "close", "inspect", "cancel", "yield"]);
const POOL_STATUSES = new Set(["open", "closing", "cancelled"]);
const VERB_KEYS = ["op", "action", "command"];
const OBJECT_KEYS = [
	"task_summary",
	"description",
	"summary",
	"query",
	"url",
	"objective",
	"goal",
	"prompt",
	"message",
	"command",
	"file_path",
	"path",
	"filePath",
	"pattern",
	"name",
	"task_id",
	"to",
	"bash_id",
	"status",
	"reason",
];
const PATH_KEYS = new Set(["file_path", "path", "filePath"]);
const SLOTS = [
	["renderCall", 2],
	["renderResult", 3],
] as const;

type Slot = (typeof SLOTS)[number][0];
type Theme = { fg?: (color: string, text: string) => string; bold?: (text: string) => string } | undefined;
type RenderContext = {
	expanded?: boolean;
	isError?: boolean;
	hasResult?: boolean;
	lastComponent?: unknown;
	cwd?: string;
	args?: Record<string, unknown>;
};
type RenderOptions = { expanded?: boolean; isPartial?: boolean } | undefined;
type ToolResult = { isError?: boolean; details?: Record<string, unknown> } | undefined;
type Component = { render(width: number): string[]; invalidate(): void };
type Fold = { line: string } | { empty: true } | undefined;
type SlotPlan = (callArgs: unknown[]) => Fold;
type ToolPlan = Partial<Record<Slot, SlotPlan>>;
type Ui = { notify?: (msg: string, level: string) => void; readonly theme?: Theme };
type Impl = {
	planFor(name: string): ToolPlan | undefined;
	component(fold: NonNullable<Fold>, paddingX: number): Component;
	// Optional: a copy of an older version (or a test double) may provide only the core members.
	thinking?(descriptors: unknown, owner: unknown): unknown;
	groupEvals?(projected: unknown): unknown;
	resetHistory?(owner: unknown): void;
	setUi?(ui: Ui | undefined): void;
	warn?(part: string, reason: string): void;
};
type FullImpl = Required<Impl>;

const shared = globalThis as Record<PropertyKey, unknown>;

function currentImpl(): Impl | undefined {
	return shared[IMPL] as Impl | undefined;
}

function paint(theme: Theme, color: string, text: string): string {
	return typeof theme?.fg === "function" ? theme.fg(color, text) : text;
}

function title(theme: Theme, name: string): string {
	const strong = typeof theme?.bold === "function" ? theme.bold(name) : name;
	return paint(theme, "toolTitle", strong);
}

const ESC = String.fromCharCode(0x1b);
const BEL = String.fromCharCode(0x07);
const C1_CSI = String.fromCharCode(0x9b);
const OSC_SEQUENCE = new RegExp(`${ESC}\\][\\s\\S]*?(?:${BEL}|${ESC}\\\\|$)`, "g");
const CSI_SEQUENCE = new RegExp(`${ESC}\\[[0-?]*[ -/]*[@-~]`, "g");
const C1_CSI_SEQUENCE = new RegExp(`${C1_CSI}[0-?]*[ -/]*[@-~]`, "g");
const ESC_SEQUENCE = new RegExp(`${ESC}[@-_]`, "g");
const CONTROL_SEQUENCE = new RegExp("[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f-\\u009f]", "g");

function terminalSafe(value: string): string {
	return value
		.replace(OSC_SEQUENCE, "")
		.replace(CSI_SEQUENCE, "")
		.replace(C1_CSI_SEQUENCE, "")
		.replace(ESC_SEQUENCE, "")
		.replace(CONTROL_SEQUENCE, "");
}

function firstLine(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	for (const raw of value.split("\n")) {
		const text = terminalSafe(raw).trim();
		if (text) return text;
	}
	return undefined;
}

function isExpanded(options: RenderOptions, context: RenderContext | undefined): boolean {
	return options?.expanded === true || context?.expanded === true;
}

function shortPath(path: string, cwd: unknown): string {
	if (typeof cwd !== "string" || cwd.length === 0) return terminalSafe(path);
	const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "");
	const base = normalize(cwd);
	const target = normalize(path);
	const short = target.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? target.slice(base.length + 1) : path;
	return terminalSafe(short);
}

function editPath(args: unknown): string | undefined {
	const record = args as Record<string, unknown> | undefined;
	const path = record?.path ?? record?.file_path;
	return typeof path === "string" && path.length > 0 ? path : undefined;
}

function diffCounts(diff: unknown): { added: number; removed: number } | undefined {
	if (typeof diff !== "string") return undefined;
	let added = 0;
	let removed = 0;
	for (const row of diff.split("\n")) {
		if (row.startsWith("+++") || row.startsWith("---")) continue;
		if (row.startsWith("+")) added++;
		else if (row.startsWith("-")) removed++;
	}
	return { added, removed };
}

function evalActionEligible(args: unknown): boolean {
	const action = (args as { action?: unknown } | undefined)?.action;
	return action === undefined || action === "run";
}

/** The eval card's folded facts once a result exists; undefined means the original card is shown. */
function evalResultLine(result: unknown, args: unknown): MemberLine | undefined {
	const res = result as ToolResult;
	if (res?.isError || !evalActionEligible(args)) return undefined;
	const details = res?.details;
	if (!details || "action" in details || details.isError) return undefined;
	const cells = Array.isArray(details.cells) ? (details.cells as Record<string, unknown>[]) : [];
	const cell = cells[0];
	if (!cell || cells.some((c) => c?.status !== "complete" && !LIVE_EVAL_STATES.has(String(c?.status)))) return undefined;
	const request = args as Record<string, unknown> | undefined;
	const what = firstLine(cell.summary) ?? firstLine(details.summary) ?? firstLine(request?.summary) ?? firstLine(cell.code);
	if (!what) return undefined;
	const status = cells.every((c) => c.status === "complete") ? "complete" : String(cell.status);
	return { language: String(cell.language ?? details.language ?? ""), status, what };
}

/** The eval card's folded facts before a result exists. */
function evalCallLine(args: unknown): MemberLine | undefined {
	const request = args as Record<string, unknown> | undefined;
	if (!evalActionEligible(request)) return undefined;
	const what = firstLine(request?.summary) ?? firstLine(request?.code);
	if (!what) return undefined;
	return { language: String(request?.language ?? ""), status: "call", what };
}

const evalPlan: ToolPlan = {
	renderCall([args, theme, context]) {
		const request = args as Record<string, unknown> | undefined;
		const ctx = context as RenderContext | undefined;
		if (ctx?.expanded || ctx?.isError) return undefined;
		if (!evalActionEligible(request)) return undefined;
		if (ctx?.hasResult) return { empty: true };
		const line = evalCallLine(request);
		if (!line) return undefined;
		return { line: `${title(theme as Theme, "eval")} ${paint(theme as Theme, "muted", line.language)} ${line.what}` };
	},
	renderResult([result, options, theme, context]) {
		const ctx = context as RenderContext | undefined;
		if (isExpanded(options as RenderOptions, ctx) || ctx?.isError) return undefined;
		const line = evalResultLine(result, ctx?.args);
		if (!line) return undefined;
		const state =
			line.status === "complete" ? paint(theme as Theme, "success", "✓") : paint(theme as Theme, "muted", line.status);
		return { line: `${title(theme as Theme, "eval")} ${paint(theme as Theme, "muted", line.language)} ${state} ${line.what}` };
	},
};

const editPlan: ToolPlan = {
	renderCall([args, theme, context]) {
		const ctx = context as RenderContext | undefined;
		if (ctx?.expanded || ctx?.isError) return undefined;
		const path = editPath(args);
		if (!path) return undefined;
		if (ctx?.hasResult) return { empty: true };
		return { line: `${title(theme as Theme, "edit")} ${paint(theme as Theme, "accent", shortPath(path, ctx?.cwd))}` };
	},
	renderResult([result, options, theme, context]) {
		const res = result as ToolResult;
		const ctx = context as RenderContext | undefined;
		if (isExpanded(options as RenderOptions, ctx) || res?.isError || res?.details?.isError === true || ctx?.isError) return undefined;
		const path = editPath(ctx?.args);
		if (!path) return undefined;
		const counts = diffCounts(res?.details?.diff);
		const suffix = counts ? paint(theme as Theme, "muted", ` (+${counts.added}/-${counts.removed})`) : "";
		return { line: `${title(theme as Theme, "edit")} ${paint(theme as Theme, "accent", shortPath(path, ctx?.cwd))}${suffix}` };
	},
};

const patchPlan: ToolPlan = {
	renderCall([args, theme, context]) {
		const ctx = context as RenderContext | undefined;
		if (ctx?.expanded || ctx?.isError) return undefined;
		const input = (args as Record<string, unknown> | undefined)?.input;
		if (typeof input !== "string" || !input.trimEnd().endsWith("*** End Patch")) return undefined;
		const paths = [...input.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)\r?$/gm)].map((match) => match[1].trim());
		if (paths.length === 0) return undefined;
		if (ctx?.hasResult) return { empty: true };
		const target = paths.length === 1 ? shortPath(paths[0], ctx?.cwd) : `${paths.length} files`;
		return { line: `${title(theme as Theme, "apply_patch")} ${paint(theme as Theme, "accent", target)}` };
	},
	renderResult([result, options, theme, context]) {
		const res = result as ToolResult;
		const ctx = context as RenderContext | undefined;
		const opts = options as RenderOptions;
		if (isExpanded(opts, ctx) || res?.isError || res?.details?.isError === true || ctx?.isError) return undefined;
		const details = res?.details;
		const patchResult = details?.result as { failures?: unknown[] } | undefined;
		if (patchResult?.failures?.length) return undefined;
		const preview = details?.preview as { files?: { filePath?: unknown }[]; added?: unknown; removed?: unknown } | undefined;
		if (!Array.isArray(preview?.files) || preview.files.length === 0) return undefined;
		if (preview.files.some((file) => typeof file?.filePath !== "string" || !file.filePath)) return undefined;
		if (!Number.isInteger(preview.added) || !Number.isInteger(preview.removed)) return undefined;
		const target = preview.files.length === 1 ? shortPath(String(preview.files[0].filePath), ctx?.cwd) : `${preview.files.length} files`;
		const suffix = paint(theme as Theme, "muted", ` (+${preview.added}/-${preview.removed})${opts?.isPartial ? " …" : ""}`);
		return { line: `${title(theme as Theme, "apply_patch")} ${paint(theme as Theme, "accent", target)}${suffix}` };
	},
};

const TODO_OPS = new Set(["init", "start", "done", "rm", "drop", "append", "view"]);

/** Native titles and projection rows sanitize text: strip escapes, flatten lines, collapse spaces. */
function plainText(value: string): string {
	let flat = "";
	for (const char of terminalSafe(value).replace(/[\r\n]+/g, " ")) {
		const code = char.codePointAt(0) ?? 0;
		flat += code < 0x20 || (code >= 0x7f && code <= 0x9f) ? " " : char;
	}
	return flat.replace(/\s+/g, " ").trim();
}

function todoCountLabel(count: number, singular: string): string {
	return `${count} ${singular}${count === 1 ? "" : "s"}`;
}

function todoPhases(phases: unknown): { phases: number; tasks: number } | undefined {
	if (!Array.isArray(phases)) return undefined;
	let tasks = 0;
	for (const phase of phases) {
		const items = (phase as { tasks?: unknown } | undefined)?.tasks;
		if (!Array.isArray(items)) return undefined;
		tasks += items.length;
	}
	return { phases: phases.length, tasks };
}

function todoCallCounts(record: Record<string, unknown>): { phases: number; tasks: number } | undefined {
	if (record.list) {
		if (!Array.isArray(record.list)) return undefined;
		let tasks = 0;
		for (const phase of record.list) {
			const items = (phase as { items?: unknown } | undefined)?.items;
			if (!Array.isArray(items)) return undefined;
			tasks += items.length;
		}
		return { phases: record.list.length, tasks };
	}
	if (record.items) {
		if (!Array.isArray(record.items)) return undefined;
		return { phases: record.items.length > 0 ? 1 : 0, tasks: record.items.length };
	}
	return { phases: 0, tasks: 0 };
}

/** Native title target order is task, then phase; a present non-string is malformed. */
function todoTarget(record: Record<string, unknown>): { text?: string; malformed?: true } {
	for (const key of ["task", "phase"]) {
		const value = record[key];
		if (value === undefined || value === null) continue;
		if (typeof value !== "string") return { malformed: true };
		return { text: plainText(value) };
	}
	return {};
}

/**
 * The title the native todo card shows. Args before a result; details.op is authoritative after
 * normalization. Undefined keeps the native card, including an unknown explicit op.
 */
function todoTitle(args: unknown, details: unknown, hasResult: boolean): string | undefined {
	const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
	const resultDetails = details && typeof details === "object" ? (details as Record<string, unknown>) : undefined;
	const op = hasResult ? resultDetails?.op : record.op;
	if (op === undefined) return hasResult ? undefined : "todo";
	if (typeof op !== "string" || !TODO_OPS.has(op)) return undefined;
	switch (op) {
		case "init": {
			const counts = hasResult ? todoPhases(resultDetails?.phases) : todoCallCounts(record);
			if (!counts) return undefined;
			return `todo init (${todoCountLabel(counts.phases, "phase")}, ${todoCountLabel(counts.tasks, "task")})`;
		}
		case "append": {
			const phase = record.phase;
			if (phase !== undefined && phase !== null && typeof phase !== "string") return undefined;
			const items = record.items;
			if (items !== undefined && items !== null && !Array.isArray(items)) return undefined;
			const count = Array.isArray(items) ? items.length : 0;
			const name = typeof phase === "string" ? plainText(phase) : "";
			return `todo append: ${name || "(missing phase)"} (${todoCountLabel(count, "item")})`;
		}
		case "start":
		case "done":
		case "drop": {
			const target = todoTarget(record);
			if (target.malformed) return undefined;
			return `todo ${op}: ${target.text || "(missing target)"}`;
		}
		case "rm": {
			const target = todoTarget(record);
			if (target.malformed) return undefined;
			return `todo rm: ${target.text || "all"}`;
		}
		case "view":
			return "todo view";
	}
}

type ProjectionLine = { text: string; status: string };

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | undefined {
	const text = typeof value === "string" ? plainText(value) : "";
	return text.length > 0 ? text : undefined;
}

function resultTextLine(result: unknown): string | undefined {
	if (!isRecord(result) || !Array.isArray(result.content)) return undefined;
	for (const block of result.content) {
		if (isRecord(block) && typeof block.text === "string") {
			const line = firstLine(block.text);
			if (line) return line;
		}
	}
	return undefined;
}

/** Only a real definition shape admits the projection path; no slot is ever synthesized. */
function projectionAdmissible(name: string, definition: Record<PropertyKey, unknown>): boolean {
	const hasCall = Object.hasOwn(definition, "renderCall");
	const hasResult = Object.hasOwn(definition, "renderResult");
	if (name === "monitor") return hasCall && typeof definition.renderCall === "function" && !hasResult;
	return !hasCall && !hasResult;
}

function killBashLine(args: unknown, result: unknown): ProjectionLine | undefined {
	const request = isRecord(args) ? args : {};
	const all = request.all === true;
	const id = nonEmptyString(request.bash_id);
	if (!all && !id) return undefined;
	const target = all ? "all" : id;
	if (!result) return { text: `kill_bash ${target}`, status: "call" };
	const receipt = resultTextLine(result);
	if (!receipt) return undefined;
	return { text: `kill_bash ${target}: ${plainText(receipt)}`, status: "complete" };
}

function monitorLine(args: unknown, result: unknown): ProjectionLine | undefined {
	const request = isRecord(args) ? args : {};
	if (request.action !== undefined || request.human_input === true) return undefined;
	const target = nonEmptyString(request.description) ?? nonEmptyString(request.command) ?? nonEmptyString(request.path) ?? nonEmptyString(request.target);
	if (!target) return undefined;
	if (!result) return { text: `monitor ${target}`, status: "call" };
	const details = isRecord(result) ? result.details : undefined;
	if (!isRecord(details) || details.monitor !== true) return undefined;
	const id = nonEmptyString(details.monitor_id) ?? nonEmptyString(details.bash_id);
	if (!id) return undefined;
	return { text: `monitor armed ${id} · ${target}`, status: "armed" };
}

function scheduleWakeupLine(args: unknown, result: unknown): ProjectionLine | undefined {
	const request = isRecord(args) ? args : {};
	if (!result) {
		if (request.stop === true) {
			const reason = nonEmptyString(request.reason);
			return reason ? { text: `schedule_wakeup stop: ${reason}`, status: "call" } : undefined;
		}
		const delay = request.delaySeconds;
		if (!Number.isInteger(delay) || (delay as number) < 0) return undefined;
		const noop = request.noop === true ? " noop" : "";
		return { text: `schedule_wakeup schedule ${String(delay)}s${noop}`, status: "call" };
	}
	const details = isRecord(result) ? result.details : undefined;
	if (!isRecord(details)) return undefined;
	const reason = nonEmptyString(details.reason);
	if (!reason) return undefined;
	if (details.action === "scheduled") {
		const delay = details.delaySeconds;
		if (!Number.isInteger(delay) || (delay as number) < 0) return undefined;
		const clamped = details.clamped === true ? " clamped" : "";
		const noop = details.noop === true ? " noop" : "";
		return { text: `schedule_wakeup scheduled ${String(delay)}s${clamped}${noop}: ${reason}`, status: "scheduled" };
	}
	if (details.action === "stopped") {
		const ignored = details.ignoredFields;
		if (ignored !== undefined && (!Array.isArray(ignored) || ignored.some((field) => typeof field !== "string"))) return undefined;
		const suffix = Array.isArray(ignored) && ignored.length > 0 ? ` ignored ${ignored.join(", ")}` : "";
		return { text: `schedule_wakeup stopped: ${reason}${suffix}`, status: "stopped" };
	}
	return undefined;
}

function countLabel(entries: readonly string[]): string | undefined {
	if (entries.length === 0) return undefined;
	const counts = new Map<string, number>();
	for (const entry of entries) counts.set(entry, (counts.get(entry) ?? 0) + 1);
	return [...counts].map(([state, n]) => `${state} ${n}`).join(" · ");
}

function schedulePromptLine(args: unknown, result: unknown): ProjectionLine | undefined {
	const request = isRecord(args) ? args : {};
	const action = request.action;
	if (action !== "create" && action !== "list" && action !== "cancel") return undefined;
	if (!result) return { text: `schedule_prompt ${action}`, status: "call" };
	const details = isRecord(result) ? result.details : undefined;
	if (!isRecord(details) || details.action !== action || !Array.isArray(details.jobs)) return undefined;
	const jobs = details.jobs;
	if (jobs.some((job) => !isRecord(job))) return undefined;
	const states = countLabel(jobs.flatMap((job) => (isRecord(job) && typeof job.state === "string" ? [plainText(job.state)] : [])));
	const jobCount = jobs.length;
	if (action === "cancel") {
		if (typeof details.inFlight !== "boolean") return undefined;
		const first = jobs[0] as Record<string, unknown> | undefined;
		const job = isRecord(first?.job) ? first.job : undefined;
		const id = nonEmptyString(request.id) ?? nonEmptyString(job?.id);
		if (!id) return undefined;
		const prefix = details.inFlight ? "in-flight " : "";
		return { text: `schedule_prompt ${prefix}cancel ${id}`, status: details.inFlight ? "in-flight" : "complete" };
	}
	const first = jobs[0] as Record<string, unknown> | undefined;
	const onlyState = typeof first?.state === "string" ? plainText(first.state) : undefined;
	const noun = `${onlyState && jobs.length === 1 ? `${onlyState} ` : ""}job${jobCount === 1 ? "" : "s"}`;
	const stateText = jobs.length === 1 ? "" : states ? ` · ${states}` : "";
	if (action === "list") return { text: `schedule_prompt list ${jobCount} ${noun}${stateText}`, status: "complete" };
	if (typeof details.runnerAvailable !== "boolean") return undefined;
	const job = isRecord(first?.job) ? first.job : undefined;
	const due = nonEmptyString(job?.dueAt);
	const prefix = details.runnerAvailable ? "" : "no-runner ";
	return {
		text: `schedule_prompt ${prefix}create ${jobCount} ${noun}${stateText}${due ? ` due ${due}` : ""}`,
		status: onlyState ?? "queued",
	};
}

function workflowNodeState(node: unknown): string | undefined {
	if (!isRecord(node)) return undefined;
	const state = node.state ?? node.status;
	return typeof state === "string" ? state : undefined;
}

function workflowSnapshot(details: Record<string, unknown>, kind: string): { snapshot: Record<string, unknown>; status: string } | undefined {
	const waited = kind === "waited";
	const result = isRecord(details.result) ? details.result : undefined;
	const snapshot = waited ? (isRecord(result?.snapshot) ? result.snapshot : undefined) : isRecord(details.snapshot) ? details.snapshot : undefined;
	const reported = waited ? result?.status : snapshot?.status;
	if (!snapshot || typeof reported !== "string" || !RUN_STATUSES.has(reported)) return undefined;
	if (typeof snapshot.status !== "string" || !RUN_STATUSES.has(snapshot.status)) return undefined;
	const counts = snapshot.counts;
	if (!isRecord(counts)) return undefined;
	for (const key of ["failed", "cancelled", "skipped"]) if (counts[key] !== 0) return undefined;
	const nodes = snapshot.nodes;
	if (!Array.isArray(nodes)) return undefined;
	for (const node of nodes) {
		if (!isRecord(node) || typeof node.id !== "string") return undefined;
		const state = workflowNodeState(node);
		if (!state || BAD_NODE_STATES.has(state)) return undefined;
	}
	return { snapshot, status: reported };
}

function workflowLine(args: unknown, result: unknown): ProjectionLine | undefined {
	const request = isRecord(args) ? args : {};
	const action = typeof request.action === "string" && WORKFLOW_ACTIONS.has(request.action) ? request.action : undefined;
	if (!action) return undefined;
	const nodeId = nonEmptyString(request.node_id);
	if (!result) {
		const definition = isRecord(request.definition) ? request.definition : undefined;
		const target = action === "start" ? nonEmptyString(definition?.name) : nonEmptyString(request.run_id);
		if (!target) return undefined;
		if (action === "send" && !nodeId) return undefined;
		return { text: `workflow ${action} ${target}${nodeId ? ` node ${nodeId}` : ""}`, status: "call" };
	}
	const details = isRecord(result) ? result.details : undefined;
	if (!isRecord(details) || typeof details.kind !== "string" || !WORKFLOW_KINDS.has(details.kind)) return undefined;
	const warnings = details.warnings;
	if (warnings !== undefined && (!Array.isArray(warnings) || warnings.length > 0)) return undefined;
	if (details.kind === "sent") {
		const run = nonEmptyString(details.run_id) ?? nonEmptyString(request.run_id);
		const delivery = nonEmptyString(details.delivery);
		const node = nodeId ?? nonEmptyString(details.node_id);
		if (!run || !delivery) return undefined;
		return {
			text: `workflow ${action} ${run} sent${node ? ` node ${node}` : ""} delivery ${delivery}`,
			status: delivery === "queued" ? "queued" : "complete",
		};
	}
	const lifecycle = workflowSnapshot(details, details.kind);
	if (!lifecycle) return undefined;
	const definition = isRecord(request.definition) ? request.definition : undefined;
	const target =
		nonEmptyString(definition?.name) ??
		nonEmptyString(lifecycle.snapshot.name);
	const run = nonEmptyString(details.run_id) ?? nonEmptyString(request.run_id) ?? nonEmptyString(lifecycle.snapshot.runId);
	const shown = target ?? run;
	if (!shown) return undefined;
	const node = nodeId ?? nonEmptyString(details.node_id);
	return {
		text: `workflow ${action} ${shown} ${details.kind} ${lifecycle.status}${node ? ` node ${node}` : ""}`,
		status: lifecycle.status === "completed" ? "complete" : lifecycle.status,
	};
}

function poolItemStates(items: readonly unknown[]): string | undefined {
	const states: string[] = [];
	for (const item of items) {
		if (!isRecord(item) || item.error !== undefined) return undefined;
		const status = item.status;
		if (typeof status !== "string" || status === "error" || status === "cancelled") return undefined;
		states.push(plainText(status));
	}
	return countLabel(states);
}

function workpoolLine(args: unknown, result: unknown): ProjectionLine | undefined {
	const request = isRecord(args) ? args : {};
	const op = request.op;
	if (typeof op !== "string" || !POOL_OPS.has(op)) return undefined;
	if (!result) {
		if (op === "create") {
			const name = nonEmptyString(request.name);
			return name ? { text: `workpool create ${name}`, status: "call" } : undefined;
		}
		if (op === "push") {
			const pool = nonEmptyString(request.pool_id);
			if (!pool || !Array.isArray(request.items)) return undefined;
			return { text: `workpool push ${pool} · ${request.items.length} item${request.items.length === 1 ? "" : "s"}`, status: "call" };
		}
		if (op === "yield") {
			if (!Array.isArray(request.results)) return undefined;
			return { text: `workpool yield ${request.results.length} result${request.results.length === 1 ? "" : "s"}`, status: "call" };
		}
		const pool = nonEmptyString(request.pool_id);
		return pool ? { text: `workpool ${op} ${pool}`, status: "call" } : undefined;
	}
	const details = isRecord(result) ? result.details : undefined;
	if (!isRecord(details)) return undefined;
	if (op === "push") {
		const pool = nonEmptyString(details.pool_id);
		if (!pool || !Array.isArray(details.item_ids)) return undefined;
		return { text: `workpool push ${pool} · ${details.item_ids.length} item${details.item_ids.length === 1 ? "" : "s"}`, status: "queued" };
	}
	if (op === "yield") {
		if (details.error !== undefined || !Array.isArray(details.results)) return undefined;
		const results = details.results;
		for (const entry of results) {
			if (!isRecord(entry) || entry.error !== undefined) return undefined;
			if (entry.status === "refused" || entry.status === "error") return undefined;
		}
		return { text: `workpool yield ${results.length} result${results.length === 1 ? "" : "s"}`, status: "complete" };
	}
	const pool = nonEmptyString(details.pool_id);
	if (!pool || typeof details.status !== "string" || !POOL_STATUSES.has(details.status) || details.status === "cancelled") return undefined;
	if (!Array.isArray(details.items)) return undefined;
	const states = poolItemStates(details.items);
	if (details.items.length > 0 && !states) return undefined;
	const name = nonEmptyString(details.name) ?? pool;
	const itemNoun = `${details.items.length} item${details.items.length === 1 ? "" : "s"}`;
	const stateText = states ? ` (${states})` : "";
	return {
		text: `workpool ${op} ${name} ${details.status} · ${itemNoun}${stateText}`,
		status: details.status,
	};
}

/** An ordinary receipt requires a settled ok result, a complete source and no error note. */
function threadPayload(result: unknown): { payload?: Record<string, unknown>; pending: boolean } | undefined {
	if (!result) return { pending: true };
	const details = isRecord(result) ? result.details : undefined;
	if (!isRecord(details) || !isRecord(details.result)) return undefined;
	const payload = details.result;
	if (payload.kind !== "ok") return undefined;
	if (payload.source_incomplete === true || details.source_incomplete === true) return undefined;
	const note = payload.error_note ?? details.error_note;
	if (note !== undefined && note !== null && note !== "") return undefined;
	return { payload, pending: false };
}

function threadAddress(request: Record<string, unknown>, payload: Record<string, unknown> | undefined): string | undefined {
	return (
		nonEmptyString(request.thread) ??
		nonEmptyString(request.thread_id) ??
		nonEmptyString(payload?.thread_id)
	);
}

function bindingAddress(request: Record<string, unknown>, payload: Record<string, unknown> | undefined): string | undefined {
	const binding = isRecord(payload?.binding) ? payload.binding : undefined;
	return (
		nonEmptyString(request.binding_id) ??
		nonEmptyString(payload?.binding_id) ??
		nonEmptyString(binding?.binding_id)
	);
}

function threadDelivery(payload: Record<string, unknown> | undefined): string | undefined {
	const delivery = isRecord(payload?.delivery) ? payload.delivery : undefined;
	const kind = nonEmptyString(delivery?.kind);
	return kind !== undefined && THREAD_DELIVERIES.has(kind) ? kind : undefined;
}

/** Replies from the plan's exact result fields; reply tokens are never read. */
function threadLine(tool: string, args: unknown, result: unknown): ProjectionLine | undefined {
	const request = isRecord(args) ? args : {};
	const state = threadPayload(result);
	if (!state) return undefined;
	const payload = state.payload;
	const status = state.pending ? "call" : "complete";
	switch (tool) {
		case "thread_create": {
			const name = nonEmptyString(request.name);
			const thread = isRecord(payload?.thread) ? payload.thread : undefined;
			const id = nonEmptyString(payload?.thread_id) ?? nonEmptyString(thread?.thread_id);
			if (!name && !id) return undefined;
			const head = name ?? id;
			return { text: `thread_create ${head}${name && id ? ` · ${id}` : ""}`, status };
		}
		case "thread_list": {
			const scope = request.all_scope === true ? " all" : "";
			if (!payload) return { text: `thread_list${scope}`, status };
			const threads = payload.threads;
			if (!Array.isArray(threads)) return undefined;
			return { text: `thread_list ${threads.length} thread${threads.length === 1 ? "" : "s"}`, status };
		}
		case "thread_read": {
			const target = threadAddress(request, payload);
			return target ? { text: `thread_read ${target}`, status } : undefined;
		}
		case "thread_send":
		case "thread_handoff": {
			const target = threadAddress(request, payload);
			if (!target) return undefined;
			const summary = nonEmptyString(request.summary) ?? nonEmptyString(payload?.summary);
			if (!payload) return { text: `${tool} ${target}${summary ? ` · ${summary}` : ""}`, status };
			const delivery = threadDelivery(payload);
			if (!delivery) return undefined;
			return { text: `${tool} ${target} ${delivery}${summary ? ` · ${summary}` : ""}`, status: delivery };
		}
		case "thread_interrupt": {
			const target = threadAddress(request, payload);
			if (!target) return undefined;
			const turn = nonEmptyString(request.turn_id) ?? nonEmptyString(payload?.turn_id);
			return { text: `thread_interrupt ${target}${turn ? ` turn ${turn}` : ""}`, status };
		}
		case "thread_rename": {
			const target = threadAddress(request, payload);
			const name = nonEmptyString(request.name) ?? nonEmptyString(payload?.name);
			return target && name ? { text: `thread_rename ${target} to ${name}`, status } : undefined;
		}
		case "thread_set_model": {
			const target = threadAddress(request, payload);
			const model = nonEmptyString(request.model) ?? nonEmptyString(payload?.model);
			const provider = nonEmptyString(request.provider) ?? nonEmptyString(payload?.provider);
			if (!target || !model) return undefined;
			return { text: `thread_set_model ${target} ${provider ? `${provider}/` : ""}${model}`, status };
		}
		case "thread_set_reasoning": {
			const target = threadAddress(request, payload);
			const level = nonEmptyString(request.level) ?? nonEmptyString(payload?.level);
			return target && level ? { text: `thread_set_reasoning ${target} ${level}`, status } : undefined;
		}
		case "thread_bind": {
			const binding = bindingAddress(request, payload);
			const platform = nonEmptyString(request.platform);
			const chat = nonEmptyString(request.chat_id);
			const target = platform && chat ? `${platform}/${chat}` : binding;
			if (!target) return undefined;
			const suffix = binding && binding !== target ? ` · ${binding}` : "";
			return { text: `thread_bind ${target}${suffix}`, status };
		}
		case "thread_unbind": {
			const binding = bindingAddress(request, payload);
			return binding ? { text: `thread_unbind ${binding}`, status } : undefined;
		}
		case "thread_rebind": {
			const binding = bindingAddress(request, payload);
			const session = nonEmptyString(request.session) ?? nonEmptyString(payload?.session_durable_id);
			return binding && session ? { text: `thread_rebind ${binding} to ${session}`, status } : undefined;
		}
		case "thread_bindings": {
			const session = nonEmptyString(request.session);
			const platform = nonEmptyString(request.platform);
			const chat = nonEmptyString(request.chat_id);
			const bindingStatus = nonEmptyString(request.status);
			const filter = session
				? ` session ${session}`
				: platform && chat
					? ` ${platform}/${chat}`
					: bindingStatus
						? ` status ${bindingStatus}`
						: "";
			if (!payload) return { text: `thread_bindings${filter}`, status };
			const bindings = payload.bindings;
			if (!Array.isArray(bindings)) return undefined;
			return {
				text: `thread_bindings ${bindings.length} binding${bindings.length === 1 ? "" : "s"}${filter ? ` ·${filter}` : ""}`,
				status,
			};
		}
		case "thread_report": {
			const kind = payload
				? nonEmptyString(payload.report_kind) ?? nonEmptyString(request.kind)
				: nonEmptyString(request.kind);
			if (!kind || !THREAD_REPORT_KINDS.has(kind)) return undefined;
			const binding = bindingAddress(request, payload);
			return { text: `thread_report ${kind}${binding ? ` ${binding}` : ""}`, status };
		}
		case "thread_outbox": {
			const binding = bindingAddress(request, payload);
			return binding ? { text: `thread_outbox ${binding}`, status } : undefined;
		}
		case "thread_outbox_ack": {
			const binding = bindingAddress(request, payload);
			const cursor = request.cursor ?? payload?.cursor;
			if (!binding || !Number.isInteger(cursor)) return undefined;
			return { text: `thread_outbox_ack ${binding} · cursor ${String(cursor)}`, status };
		}
		default:
			return undefined;
	}
}

function projectionLine(tool: string, args: unknown, result: unknown): ProjectionLine | undefined {
	if (THREAD_TOOLS.has(tool)) return threadLine(tool, args, result);
	switch (tool) {
		case "kill_bash":
			return killBashLine(args, result);
		case "monitor":
			return monitorLine(args, result);
		case "schedule_wakeup":
			return scheduleWakeupLine(args, result);
		case "schedule_prompt":
			return schedulePromptLine(args, result);
		case "workflow":
			return workflowLine(args, result);
		case "workpool":
			return workpoolLine(args, result);
		default:
			return undefined;
	}
}

const todoPlan: ToolPlan = {
	renderResult([result, options, , context]) {
		const res = result as ToolResult;
		const ctx = context as RenderContext | undefined;
		if (isExpanded(options as RenderOptions, ctx) || res?.isError || res?.details?.isError === true || ctx?.isError) return undefined;
		return { empty: true };
	},
};

function describe(args: unknown, cwd: unknown): string {
	const record = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
	const verbKey = VERB_KEYS.find((key) => typeof record[key] === "string" && /^[\w-]{1,24}$/.test(record[key] as string));
	let object: string | undefined;
	for (const key of OBJECT_KEYS) {
		if (key === verbKey) continue;
		const text = firstLine(record[key]);
		if (text) {
			object = PATH_KEYS.has(key) ? shortPath(text, cwd) : text;
			break;
		}
	}
	return [verbKey ? (record[verbKey] as string) : undefined, object].filter(Boolean).join(" ");
}

function compactLine(name: string, args: unknown, theme: Theme, cwd: unknown, partial: boolean): string {
	const what = describe(args, cwd);
	const head = what ? `${title(theme, name)} ${what}` : title(theme, name);
	return partial ? `${head}${paint(theme, "muted", " …")}` : head;
}

/** Shell rows name the description or the first command line, never an inferred exit. */
function shellText(name: string, args: unknown, theme: Theme, details?: Record<string, unknown>): string | undefined {
	const request = isRecord(args) ? args : {};
	const what = nonEmptyString(request.description) ?? firstLine(request.command);
	if (!what) return undefined;
	const head = `${title(theme, name)} ${what}`;
	const handle = details?.background === true ? nonEmptyString(details.bash_id) : undefined;
	return handle ? `${head} ${paint(theme, "muted", "background")} ${handle}` : head;
}

function shellPlan(name: string): ToolPlan {
	return {
		renderCall([args, theme, context]) {
			const ctx = context as RenderContext | undefined;
			if (ctx?.expanded || ctx?.isError) return undefined;
			if (ctx?.hasResult) return { empty: true };
			const line = shellText(name, args, theme as Theme);
			return line ? { line } : undefined;
		},
		renderResult([result, options, theme, context]) {
			const res = result as ToolResult;
			const ctx = context as RenderContext | undefined;
			if (isExpanded(options as RenderOptions, ctx) || res?.isError || res?.details?.isError === true || ctx?.isError) return undefined;
			const line = shellText(name, ctx?.args, theme as Theme, res?.details);
			return line ? { line } : undefined;
		},
	};
}

/** Glob shares find's two native slots; its row keeps the audited pattern and search path. */
function globText(args: unknown, theme: Theme, cwd: unknown): string | undefined {
	const request = isRecord(args) ? args : {};
	const pattern = nonEmptyString(request.pattern);
	if (!pattern) return undefined;
	const path = nonEmptyString(request.path) ?? ".";
	return `${title(theme, "glob")} ${pattern} ${paint(theme, "muted", "in")} ${shortPath(path, cwd)}`;
}

const globPlan: ToolPlan = {
	renderCall([args, theme, context]) {
		const ctx = context as RenderContext | undefined;
		if (ctx?.expanded || ctx?.isError) return undefined;
		if (ctx?.hasResult) return { empty: true };
		const line = globText(args, theme as Theme, ctx?.cwd);
		return line ? { line } : undefined;
	},
	renderResult([result, options, theme, context]) {
		const res = result as ToolResult;
		const ctx = context as RenderContext | undefined;
		if (isExpanded(options as RenderOptions, ctx) || res?.isError || res?.details?.isError === true || ctx?.isError) return undefined;
		const line = globText(ctx?.args, theme as Theme, ctx?.cwd);
		return line ? { line } : undefined;
	},
};

function firstPathEntry(value: unknown): string | undefined {
	return Array.isArray(value) ? nonEmptyString(value[0]) : undefined;
}

/** The meaningful arguments of a full MCP tool, plus ast-grep's apply/preview state. */
function mcpTarget(name: string, args: unknown): { target: string; state?: string } | undefined {
	const request = isRecord(args) ? args : {};
	const apply = request.apply === true ? "apply" : "preview";
	switch (name) {
		case "mcp__ast_grep_rewrite":
		case "mcp__ast_grep_search": {
			const pattern = nonEmptyString(request.pattern);
			if (!pattern) return undefined;
			const path = firstPathEntry(request.paths);
			return { target: `${pattern}${path ? ` ${path}` : ""}`, state: apply };
		}
		case "mcp__ast_grep_scan": {
			const rule = nonEmptyString(request.ruleFile) ?? firstPathEntry(request.paths);
			return rule ? { target: rule, state: apply } : undefined;
		}
		case "mcp_context7_query-docs": {
			const library = nonEmptyString(request.libraryId);
			const query = nonEmptyString(request.query);
			return library && query ? { target: `${library} ${query}` } : undefined;
		}
		case "mcp_context7_resolve-library-id": {
			const library = nonEmptyString(request.libraryName);
			const query = nonEmptyString(request.query);
			return library && query ? { target: `${library} ${query}` } : undefined;
		}
		case "mcp_grep_app_searchGitHub": {
			const query = nonEmptyString(request.query);
			if (!query) return undefined;
			const where = nonEmptyString(request.repo) ?? nonEmptyString(request.path);
			return { target: `${query}${where ? ` ${where}` : ""}` };
		}
		default:
			return undefined;
	}
}

function mcpText(name: string, args: unknown, theme: Theme, preview?: string): string | undefined {
	const target = mcpTarget(name, args);
	if (!target) return undefined;
	const state = target.state ? ` ${paint(theme, "muted", target.state)}` : "";
	const head = `${title(theme, name)} ${target.target}${state}`;
	return preview === undefined ? head : `${head} ${paint(theme, "muted", "·")} ${plainText(preview)}`;
}

function mcpPlan(name: string): ToolPlan {
	return {
		renderCall([args, theme, context]) {
			const ctx = context as RenderContext | undefined;
			if (ctx?.expanded || ctx?.isError) return undefined;
			if (ctx?.hasResult) return { empty: true };
			const line = mcpText(name, args, theme as Theme);
			return line ? { line } : undefined;
		},
		renderResult([result, options, theme, context]) {
			const res = result as ToolResult;
			const ctx = context as RenderContext | undefined;
			if (isExpanded(options as RenderOptions, ctx) || res?.isError || ctx?.isError || !textOnlyContent(result)) return undefined;
			const details = res?.details;
			// A refusal carries both details.error and a preview; reject it before reading the preview.
			if (!isRecord(details) || details.error !== undefined || details.isError === true) return undefined;
			if (!nonEmptyString(details.server) || !nonEmptyString(details.tool) || typeof details.preview !== "string") return undefined;
			const line = mcpText(name, ctx?.args, theme as Theme, details.preview);
			return line ? { line } : undefined;
		},
	};
}

function compactPlan(name: string): ToolPlan {
	return {
		renderCall([args, theme, context]) {
			const ctx = context as RenderContext | undefined;
			if (ctx?.expanded || ctx?.isError) return undefined;
			if (ctx?.hasResult) return { empty: true };
			return { line: compactLine(name, args, theme as Theme, ctx?.cwd, false) };
		},
		renderResult([result, options, theme, context]) {
			const res = result as ToolResult;
			const ctx = context as RenderContext | undefined;
			const opts = options as RenderOptions;
			if (isExpanded(opts, ctx) || resultFailed(res) || ctx?.isError) return undefined;
			return { line: compactLine(name, ctx?.args, theme as Theme, ctx?.cwd, opts?.isPartial === true) };
		},
	};
}

const PLANS: Record<string, ToolPlan> = { eval: evalPlan, edit: editPlan, apply_patch: patchPlan, todo: todoPlan };

function planFor(name: string): ToolPlan | undefined {
	if (Object.hasOwn(PLANS, name)) return PLANS[name];
	if (name === "bash" || name === "powershell") return shellPlan(name);
	if (name === "glob") return globPlan;
	if (MCP_TOOLS.has(name)) return mcpPlan(name);
	return COMPACT_TOOLS.has(name) ? compactPlan(name) : undefined;
}

function isOwn(value: unknown): boolean {
	return !!value && typeof value === "object" && (value as Record<PropertyKey, unknown>)[OWN] === true;
}

function dispatchSlot(
	original: (...args: unknown[]) => unknown,
	name: string,
	slot: Slot,
	contextIndex: number,
	paddingX: number,
) {
	return function folded(this: unknown, ...callArgs: unknown[]): unknown {
		let component: Component | undefined;
		try {
			const impl = currentImpl();
			const fold = impl?.planFor(name)?.[slot]?.(callArgs);
			component = fold && impl ? impl.component(fold, paddingX) : undefined;
		} catch {
			component = undefined;
		}
		if (component) return component;
		const forwarded = [...callArgs];
		const context = forwarded[contextIndex] as RenderContext | undefined;
		if (context && typeof context === "object" && isOwn(context.lastComponent)) {
			forwarded[contextIndex] = { ...context, lastComponent: undefined };
		}
		return original.apply(this, forwarded);
	};
}

function wrapDefinition(definition: unknown, name: unknown): void {
	if (typeof name !== "string" || !definition || typeof definition !== "object") return;
	const target = definition as Record<PropertyKey, unknown>;
	if (PROJECTION_TOOLS.has(name)) {
		if (target[WRAPPED] || target[PROJECTED]) return;
		if (!projectionAdmissible(name, target)) return;
		target[PROJECTED] = true;
		return;
	}
	const plan = currentImpl()?.planFor(name);
	if (!plan || target[WRAPPED]) return;
	if (SLOTS.some(([slot]) => plan[slot] && typeof target[slot] !== "function")) return;
	const paddingX = target.renderShell === "self" ? 1 : 0;
	for (const [slot, contextIndex] of SLOTS) {
		const original = target[slot];
		if (typeof original === "function") {
			target[slot] = dispatchSlot(original as (...args: unknown[]) => unknown, name, slot, contextIndex, paddingX);
		}
	}
	target[WRAPPED] = true;
}

type LineComponentClass = new (text: string, paddingX?: number, paddingY?: number) => Component;
type GroupView = { setMembers(members: readonly unknown[], lines: readonly MemberLine[], cards: readonly object[]): void };
type GroupBase = new () => { children: unknown[]; render(width: number): string[] };
type CardSnapshot = {
	presentation?: unknown;
	identity?: { toolName?: unknown; toolDefinition?: Record<PropertyKey, unknown>; cwd?: unknown };
	state?: { args?: unknown; result?: unknown; isPartial?: unknown };
};
type ImplDeps = {
	/** Undefined when the core folding is off: plans are then disabled and only the new seams act. */
	TruncatedText: LineComponentClass | undefined;
	AssistantMessageComponent: unknown;
	Container: unknown;
	truncateToWidth: unknown;
};

function partialNotice(parts: string): string {
	return `tool-fold 일부 꺼짐 (${parts}). 그 부분은 원래대로 보입니다.`;
}

/** A task snapshot status is a structured failure unless it is a known active/complete state. */
function taskStatusUnsafe(result: unknown): boolean {
	const details = (result as ToolResult | undefined)?.details;
	if (!isRecord(details) || !isRecord(details.snapshot) || !Object.hasOwn(details.snapshot, "status")) return false;
	const status = details.snapshot.status;
	return typeof status !== "string" || !TASK_CLEAR_STATUSES.has(status);
}

/**
 * A card joins a block only when its collapsed render is this extension's one-liner: eval keeps
 * its own parts, every other folded tool (edit, apply_patch, write, ...) contributes its fold line.
 */
function resultFailed(result: unknown): boolean {
	const res = result as ToolResult;
	return !!res && typeof res === "object" && (!!res.isError || res.details?.isError === true || taskStatusUnsafe(res));
}

/** Missing content stays compatible; present content must be an array made only of text blocks. */
function textOnlyContent(result: unknown): boolean {
	if (!result || typeof result !== "object" || !("content" in result)) return true;
	const content = (result as { content?: unknown }).content;
	if (content === undefined) return true;
	if (!Array.isArray(content)) return false;
	return content.every((block) => {
		if (!block || typeof block !== "object") return false;
		const part = block as { type?: unknown; text?: unknown };
		return part.type === "text" && typeof part.text === "string";
	});
}

function snapshotLine(snapshot: CardSnapshot | undefined, getTheme: () => Theme): MemberLine | undefined {
	if (snapshot?.presentation !== "classic") return undefined;
	const tool = snapshot.identity?.toolName;
	if (typeof tool !== "string") return undefined;
	const definition = snapshot.identity?.toolDefinition;
	const projection =
		PROJECTION_TOOLS.has(tool) &&
		definition !== undefined &&
		definition[PROJECTED] === true &&
		projectionAdmissible(tool, definition);
	if (definition?.[WRAPPED] !== true && !projection) return undefined;
	const state = snapshot.state;
	if (state?.result) {
		if (resultFailed(state.result) || !textOnlyContent(state.result)) return undefined;
	}
	if (tool !== "eval") return foldedLine(tool, state, getTheme(), snapshot.identity?.cwd);
	// peek/stop/list control results copy the run's details (no details.action), so only args tell them apart.
	if (!evalActionEligible(state?.args)) return undefined;
	return state?.result ? evalResultLine(state.result, state.args) : evalCallLine(state?.args);
}

/** The non-eval card's one-line fold, exactly as its collapsed card draws it; undefined keeps the card out. */
function foldedLine(tool: string, state: CardSnapshot["state"], theme: Theme, cwd: unknown): MemberLine | undefined {
	const result = state?.result;
	if (PROJECTION_TOOLS.has(tool)) {
		const line = projectionLine(tool, state?.args, result);
		if (!line) return undefined;
		return { language: "", status: line.status, what: "", tool, text: line.text };
	}
	if (tool === "todo") {
		const text = todoTitle(state?.args, (result as ToolResult)?.details, Boolean(result));
		if (!text) return undefined;
		const status = !result ? "call" : state?.isPartial === true ? "running" : "complete";
		return { language: "", status, what: "", tool, text };
	}
	const plan = planFor(tool);
	if (!plan) return undefined;
	const context: RenderContext = {
		args: state?.args as Record<string, unknown> | undefined,
		cwd: cwd ?? process.cwd(),
		isError: resultFailed(result),
	};
	const partial = state?.isPartial === true;
	const fold = result
		? plan.renderResult?.([result, { expanded: false, isPartial: partial }, theme, context])
		: plan.renderCall?.([state?.args, theme, context]);
	if (!fold || !("line" in fold)) return undefined;
	const status = !result ? "call" : partial ? "running" : "complete";
	return { language: "", status, what: "", tool, text: fold.line };
}

function createImpl(deps: ImplDeps): FullImpl {
	const { TruncatedText, AssistantMessageComponent, Container, truncateToWidth } = deps;
	let ui: Ui | undefined;
	let warned = false;
	let pendingWarning: string | undefined;
	let GroupClass: (new () => GroupView) | undefined;
	const lineCache = new WeakMap<object, { revision: number; line: MemberLine | undefined }>();
	const projections = new WeakMap<object, readonly unknown[]>();
	const groups = new WeakMap<object, GroupView>();

	const notifyOnce = (message: string): void => {
		if (warned) return;
		const current = ui;
		if (typeof current?.notify !== "function") {
			pendingWarning = message;
			return;
		}
		warned = true;
		pendingWarning = undefined;
		current.notify(message, "warning");
	};
	const warn = (part: string, reason: string): void => notifyOnce(partialNotice(`${part}: ${reason}`));

	const memberLine = (child: unknown): MemberLine | undefined => {
		try {
			const card = child as { presentationSnapshot?: CardSnapshot; getRenderRevision?: () => unknown };
			const revision = typeof card.getRenderRevision === "function" ? card.getRenderRevision() : undefined;
			const cached = lineCache.get(card);
			if (typeof revision === "number" && cached?.revision === revision) return cached.line;
			const line = snapshotLine(card.presentationSnapshot, () => ui?.theme);
			if (typeof revision === "number") lineCache.set(card, { revision, line });
			return line;
		} catch {
			return undefined; // An unreadable card keeps its original rendering outside any block.
		}
	};
	const isDetail = (child: unknown): boolean =>
		typeof AssistantMessageComponent === "function" &&
		child instanceof AssistantMessageComponent &&
		(child as { isExplorationDetail?: unknown }).isExplorationDetail === true;
	const groupClass = (): (new () => GroupView) | undefined => {
		if (GroupClass === undefined && typeof Container === "function" && typeof truncateToWidth === "function") {
			GroupClass = createEvalGroupClass(
				Container as GroupBase,
				truncateToWidth as (text: string, width: number) => string,
				() => ui?.theme,
				// Render errors surface during a frame; notifying from inside it would add a chat child mid-pass.
				(error) =>
					queueMicrotask(() => {
						try {
							warn(GROUP_PART, `render failed: ${error instanceof Error ? error.message : String(error)}`);
						} catch {
							// A failing notifier must not become an uncaught error in the host.
						}
					}),
			);
		}
		return GroupClass;
	};

	return {
		planFor: TruncatedText ? planFor : () => undefined,
		component(fold, paddingX) {
			if (!TruncatedText) throw new Error("TruncatedText not found");
			const component: Component = "empty" in fold ? { render: () => [], invalidate() {} } : new TruncatedText(fold.line, paddingX, 0);
			(component as unknown as Record<PropertyKey, unknown>)[OWN] = true;
			return component;
		},
		thinking(descriptors, owner) {
			const state = owner as { isStreaming?: unknown; hasToolCalls?: unknown; hiddenThinkingLabel?: unknown } | undefined;
			return hideFinishedThinking(descriptors as readonly RenderDescriptor[], {
				isStreaming: state?.isStreaming === true,
				hasToolCalls: state?.hasToolCalls === true,
				hiddenLabel: typeof state?.hiddenThinkingLabel === "string" ? state.hiddenThinkingLabel : "",
			});
		},
		groupEvals(projected) {
			if (!Array.isArray(projected)) return projected;
			const visible = hideCollapsedNotices(projected);
			// With the core fold off, a WRAPPED mark left by an older copy still matches cards this
			// copy renders unfolded, so grouping must not run at all. Hiding notices still applies.
			if (!TruncatedText) return visible;
			// The raw array's cached projection is valid only while no notice was hidden: Ctrl+O
			// changes the filtered array without changing the raw one.
			const known = visible === projected ? projections.get(projected) : undefined;
			if (known) return known;
			const View = groupClass();
			if (!View) return visible;
			const grouped = groupEvalRuns<GroupView>(visible, {
				memberLine,
				isDetail,
				groupFor(firstCard) {
					const existing = groups.get(firstCard);
					if (existing) return existing;
					const created = new View();
					groups.set(firstCard, created);
					return created;
				},
				setMembers: (group, members, lines, cards) => group.setMembers(members, lines, cards),
			});
			if (visible === projected) projections.set(projected, grouped);
			return grouped;
		},
		setUi(next) {
			ui = next;
			if (pendingWarning !== undefined) notifyOnce(pendingWarning);
		},
		resetHistory(owner) {
			try {
				const chat = (owner as { chatContainer?: { display?: unknown } } | undefined)?.chatContainer;
				const display = chat?.display as { detachAll?: () => void } | undefined;
				if (!display || display === chat || typeof display.detachAll !== "function") {
					warn("기록 표시", "transcript display.detachAll() not found");
					return;
				}
				// The projection is non-owning. Detach resets history/hydration without disposing
				// cards; ExplorationTranscriptContainer.render assigns the fresh projection again.
				display.detachAll();
			} catch {
				warn("기록 표시", "transcript display reset failed");
			}
		},
		warn,
	};
}

type Prototype = Record<PropertyKey, unknown>;

function prototypeOf(value: unknown): Prototype | undefined {
	return (value as { prototype?: Prototype } | undefined)?.prototype;
}

/** Hides finished thinking labels; returns the notice part when the seam is missing. */
function installThinkingHook(senpi: Record<string, unknown>): string | undefined {
	const proto = prototypeOf(senpi.AssistantMessageComponent);
	const original = proto?.reconcileRenderDescriptors;
	if (!proto || typeof original !== "function") {
		return "사고 줄 숨김: AssistantMessageComponent.reconcileRenderDescriptors not found";
	}
	if (proto[THINKING_HOOK]) return undefined;
	proto.reconcileRenderDescriptors = function (this: unknown, descriptors: unknown, ...rest: unknown[]) {
		let next = descriptors;
		try {
			next = currentImpl()?.thinking?.(descriptors, this) ?? descriptors;
		} catch {
			next = descriptors; // Unexpected data: draw the descriptors exactly as Senpi built them.
		}
		return original.call(this, next, ...rest);
	};
	proto[THINKING_HOOK] = true;
	return undefined;
}

/** Wraps the transcript container's projection, which is reachable only from a live InteractiveMode. */
function installProjection(container: unknown): void {
	if (!container || typeof container !== "object") return;
	const proto = Object.getPrototypeOf(container) as Prototype | null;
	if (proto === null || proto === Object.prototype) {
		currentImpl()?.warn?.(GROUP_PART, "transcript project() not found");
		return;
	}
	if (proto[PROJECT_HOOK]) return;
	const original = proto.project;
	if (typeof original !== "function") {
		proto[PROJECT_HOOK] = "missing";
		currentImpl()?.warn?.(GROUP_PART, "transcript project() not found");
		return;
	}
	proto.project = function (this: unknown, ...args: unknown[]) {
		const projected = original.apply(this, args);
		try {
			return currentImpl()?.groupEvals?.(projected) ?? projected;
		} catch {
			return projected; // Unexpected data: draw Senpi's own projection.
		}
	};
	proto[PROJECT_HOOK] = true;
}

/** Groups consecutive folded evals; returns the notice part when a seam is missing. */
function installGroupHook(senpi: Record<string, unknown>, tui: Record<string, unknown>): string | undefined {
	const proto = prototypeOf(senpi.InteractiveMode);
	const original = proto?.createToolExecutionComponent;
	if (!proto || typeof original !== "function") return `${GROUP_PART}: InteractiveMode.createToolExecutionComponent not found`;
	if (typeof tui.Container !== "function" || typeof tui.truncateToWidth !== "function") {
		return `${GROUP_PART}: pi-tui Container/truncateToWidth not found`;
	}
	if (proto[GROUP_HOOK]) return undefined;
	proto.createToolExecutionComponent = function (this: unknown, ...args: unknown[]) {
		try {
			installProjection((this as { chatContainer?: unknown } | undefined)?.chatContainer);
		} catch {
			// The projection stays original; creating the card must never fail because of grouping.
		}
		return original.apply(this, args);
	};
	proto[GROUP_HOOK] = true;
	return undefined;
}

/** Expansion changes both row heights and projection indices; the kept history window is stale. */
function installExpansionHook(senpi: Record<string, unknown>): string | undefined {
	const proto = prototypeOf(senpi.InteractiveMode);
	const original = proto?.setToolsExpanded;
	if (!proto || typeof original !== "function") return "기록 표시: InteractiveMode.setToolsExpanded not found";
	if (proto[EXPANSION_HOOK]) return undefined;
	proto.setToolsExpanded = function (this: unknown, ...args: unknown[]) {
		const before = (this as { toolOutputExpanded?: unknown } | undefined)?.toolOutputExpanded;
		const result = original.apply(this, args);
		try {
			const after = (this as { toolOutputExpanded?: unknown } | undefined)?.toolOutputExpanded;
			if (typeof before === "boolean" && typeof after === "boolean" && before !== after) {
				currentImpl()?.resetHistory?.(this);
			}
		} catch {
			// A changed internal or failing notifier must not break the native toggle.
		}
		return result;
	};
	proto[EXPANSION_HOOK] = true;
	return undefined;
}

type ExtensionApi = {
	on?: (
		event: string,
		handler: (event: { reason?: string } | undefined, ctx: { ui?: Ui } | undefined) => void,
	) => void;
};

export default async function toolFold(pi: ExtensionApi): Promise<void> {
	let problem: string | undefined;
	let impl: FullImpl | undefined;
	const parts: string[] = [];
	try {
		const tui = (await import("@earendil-works/pi-tui")) as Record<string, unknown>;
		const TruncatedText = tui.TruncatedText as LineComponentClass | undefined;
		const senpi = (await import("@code-yeongyu/senpi")) as Record<string, unknown>;
		const proto = (senpi.AgentSession as { prototype?: Record<PropertyKey, unknown> } | undefined)?.prototype;
		const original = proto?.getToolDefinition;
		if (typeof TruncatedText !== "function") problem = "TruncatedText not found";
		else if (!proto || typeof original !== "function") problem = "AgentSession.getToolDefinition not found";
		impl = createImpl({
			TruncatedText: problem === undefined ? TruncatedText : undefined,
			AssistantMessageComponent: senpi.AssistantMessageComponent,
			Container: tui.Container,
			truncateToWidth: tui.truncateToWidth,
		});
		shared[IMPL] = impl;
		if (problem === undefined && proto) {
			if (!proto[HOOK]) {
				proto.getToolDefinition = function (this: unknown, ...args: unknown[]) {
					const definition = (original as (...a: unknown[]) => unknown).apply(this, args);
					try {
						wrapDefinition(definition, args[0]);
					} catch {
						return definition;
					}
					return definition;
				};
				proto[HOOK] = true;
			}
		}
		for (const part of [installThinkingHook(senpi), installGroupHook(senpi, tui), installExpansionHook(senpi)]) if (part) parts.push(part);
	} catch (error) {
		problem = error instanceof Error ? error.message : String(error);
		impl = undefined;
	}
	if (impl === undefined) shared[IMPL] = undefined;
	if (typeof pi?.on !== "function") return;
	pi.on("session_shutdown", (event) => {
		if (event?.reason === "reload" && impl !== undefined && shared[IMPL] === impl) shared[IMPL] = undefined;
	});
	let notified = false;
	pi.on("session_start", (_event, ctx) => {
		impl?.setUi(ctx?.ui);
		if (notified) return;
		const message =
			problem !== undefined
				? `tool-fold 꺼짐 (${problem}). 도구 표시는 원래대로 보입니다.`
				: parts.length > 0
					? partialNotice(parts.join("; "))
					: undefined;
		if (message === undefined) return;
		notified = true;
		ctx?.ui?.notify?.(message, "warning");
	});
}
