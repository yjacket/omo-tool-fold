// senpi has no public API for changing how another tool is drawn, so this wraps
// AgentSession.prototype.getToolDefinition, which the TUI uses to look up tool renderers.
// Every step feature-detects and falls back to the original renderer: if an update changes
// these internals, the extension turns itself off instead of breaking the TUI.
// The prototype hook is installed once per process and always dispatches to the most recently
// loaded copy of this file, so editing it and reloading takes effect without restarting omo.

const HOOK = Symbol.for("omo.tool-fold.hook.v2");
const IMPL = Symbol.for("omo.tool-fold.impl.v2");
const WRAPPED = Symbol.for("omo.tool-fold.wrapped.v2");
const OWN = Symbol.for("omo.tool-fold.component");
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
]);
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
type Impl = {
	planFor(name: string): ToolPlan | undefined;
	component(fold: NonNullable<Fold>, paddingX: number): Component;
};

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

function firstLine(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	for (const raw of value.split("\n")) {
		const text = raw.trim();
		if (text) return text;
	}
	return undefined;
}

function isExpanded(options: RenderOptions, context: RenderContext | undefined): boolean {
	return options?.expanded === true || context?.expanded === true;
}

function shortPath(path: string, cwd: unknown): string {
	if (typeof cwd !== "string" || cwd.length === 0) return path;
	const normalize = (value: string) => value.replaceAll("\\", "/").replace(/\/+$/, "");
	const base = normalize(cwd);
	const target = normalize(path);
	return target.toLowerCase().startsWith(`${base.toLowerCase()}/`) ? target.slice(base.length + 1) : path;
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

const evalPlan: ToolPlan = {
	renderCall([args, theme, context]) {
		const request = args as Record<string, unknown> | undefined;
		const ctx = context as RenderContext | undefined;
		if (ctx?.expanded || ctx?.isError) return undefined;
		if (request?.action !== undefined && request.action !== "run") return undefined;
		if (ctx?.hasResult) return { empty: true };
		const what = firstLine(request?.summary) ?? firstLine(request?.code);
		if (!what) return undefined;
		return { line: `${title(theme as Theme, "eval")} ${paint(theme as Theme, "muted", String(request?.language ?? ""))} ${what}` };
	},
	renderResult([result, options, theme, context]) {
		const res = result as ToolResult;
		const ctx = context as RenderContext | undefined;
		if (isExpanded(options as RenderOptions, ctx) || res?.isError || ctx?.isError) return undefined;
		const details = res?.details;
		if (!details || "action" in details || details.isError) return undefined;
		const cells = Array.isArray(details.cells) ? (details.cells as Record<string, unknown>[]) : [];
		const cell = cells[0];
		if (!cell || cells.some((c) => c?.status !== "complete" && !LIVE_EVAL_STATES.has(String(c?.status)))) return undefined;
		const what =
			firstLine(cell.summary) ?? firstLine(details.summary) ?? firstLine(ctx?.args?.summary) ?? firstLine(cell.code);
		if (!what) return undefined;
		const done = cells.every((c) => c.status === "complete");
		const state = done ? paint(theme as Theme, "success", "✓") : paint(theme as Theme, "muted", String(cell.status));
		const language = String(cell.language ?? details.language ?? "");
		return { line: `${title(theme as Theme, "eval")} ${paint(theme as Theme, "muted", language)} ${state} ${what}` };
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
		if (isExpanded(options as RenderOptions, ctx) || res?.isError || ctx?.isError) return undefined;
		const path = editPath(ctx?.args);
		if (!path) return undefined;
		const counts = diffCounts(res?.details?.diff);
		const suffix = counts ? paint(theme as Theme, "muted", ` (+${counts.added}/-${counts.removed})`) : "";
		return { line: `${title(theme as Theme, "edit")} ${paint(theme as Theme, "accent", shortPath(path, ctx?.cwd))}${suffix}` };
	},
};

const todoPlan: ToolPlan = {
	renderResult([result, options, , context]) {
		const res = result as ToolResult;
		const ctx = context as RenderContext | undefined;
		if (isExpanded(options as RenderOptions, ctx) || res?.isError || ctx?.isError) return undefined;
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
			if (isExpanded(opts, ctx) || res?.isError || ctx?.isError) return undefined;
			return { line: compactLine(name, ctx?.args, theme as Theme, ctx?.cwd, opts?.isPartial === true) };
		},
	};
}

const PLANS: Record<string, ToolPlan> = { eval: evalPlan, edit: editPlan, todo: todoPlan };

function planFor(name: string): ToolPlan | undefined {
	if (Object.hasOwn(PLANS, name)) return PLANS[name];
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

function createImpl(TruncatedText: LineComponentClass): Impl {
	return {
		planFor,
		component(fold, paddingX) {
			const component: Component = "empty" in fold ? { render: () => [], invalidate() {} } : new TruncatedText(fold.line, paddingX, 0);
			(component as unknown as Record<PropertyKey, unknown>)[OWN] = true;
			return component;
		},
	};
}

type ExtensionApi = {
	on?: (
		event: string,
		handler: (event: { reason?: string } | undefined, ctx: { ui?: { notify?: (msg: string, level: string) => void } }) => void,
	) => void;
};

export default async function toolFold(pi: ExtensionApi): Promise<void> {
	let problem: string | undefined;
	let impl: Impl | undefined;
	try {
		const tui = (await import("@earendil-works/pi-tui")) as Record<string, unknown>;
		const TruncatedText = tui.TruncatedText as LineComponentClass | undefined;
		const senpi = (await import("@code-yeongyu/senpi")) as Record<string, unknown>;
		const proto = (senpi.AgentSession as { prototype?: Record<PropertyKey, unknown> } | undefined)?.prototype;
		const original = proto?.getToolDefinition;
		if (typeof TruncatedText !== "function") problem = "TruncatedText not found";
		else if (!proto || typeof original !== "function") problem = "AgentSession.getToolDefinition not found";
		else {
			impl = createImpl(TruncatedText);
			shared[IMPL] = impl;
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
	} catch (error) {
		problem = error instanceof Error ? error.message : String(error);
	}
	if (problem !== undefined) shared[IMPL] = undefined;
	if (typeof pi?.on !== "function") return;
	pi.on("session_shutdown", (event) => {
		if (event?.reason === "reload" && impl !== undefined && shared[IMPL] === impl) shared[IMPL] = undefined;
	});
	if (problem === undefined) return;
	let notified = false;
	pi.on("session_start", (_event, ctx) => {
		if (notified) return;
		notified = true;
		ctx?.ui?.notify?.(`tool-fold 꺼짐 (${problem}). 도구 표시는 원래대로 보입니다.`, "warning");
	});
}
