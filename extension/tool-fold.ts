// senpi has no public API for changing how another tool is drawn, so this wraps
// AgentSession.prototype.getToolDefinition, which the TUI uses to look up tool renderers.
// Every step feature-detects and falls back to the original renderer: if an update changes
// these internals, the extension turns itself off instead of breaking the TUI.
// The prototype hook is installed once per process and always dispatches to the most recently
// loaded copy of this file, so editing it and reloading takes effect without restarting omo.
// Two more seams hide finished thinking labels and group consecutive folded evals; each is
// feature-detected on its own and dispatches through the same replaceable implementation.

import { createEvalGroupClass } from "./eval-group-view";
import { groupEvalRuns, type MemberLine } from "./eval-run";
import { hideFinishedThinking, type RenderDescriptor } from "./thinking-label";

const HOOK = Symbol.for("omo.tool-fold.hook.v2");
const IMPL = Symbol.for("omo.tool-fold.impl.v2");
const WRAPPED = Symbol.for("omo.tool-fold.wrapped.v2");
const OWN = Symbol.for("omo.tool-fold.component");
const THINKING_HOOK = Symbol.for("omo.tool-fold.thinking-hook.v1");
const GROUP_HOOK = Symbol.for("omo.tool-fold.group-hook.v1");
const PROJECT_HOOK = Symbol.for("omo.tool-fold.project-hook.v1");
const GROUP_PART = "eval 묶음";
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
type Ui = { notify?: (msg: string, level: string) => void; readonly theme?: Theme };
type Impl = {
	planFor(name: string): ToolPlan | undefined;
	component(fold: NonNullable<Fold>, paddingX: number): Component;
	// Optional: a copy of an older version (or a test double) may provide only the core members.
	thinking?(descriptors: unknown, owner: unknown): unknown;
	groupEvals?(projected: unknown): unknown;
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

/** The eval card's folded facts once a result exists; undefined means the original card is shown. */
function evalResultLine(result: unknown, args: unknown): MemberLine | undefined {
	const res = result as ToolResult;
	if (res?.isError) return undefined;
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
	if (request?.action !== undefined && request.action !== "run") return undefined;
	const what = firstLine(request?.summary) ?? firstLine(request?.code);
	if (!what) return undefined;
	return { language: String(request?.language ?? ""), status: "call", what };
}

const evalPlan: ToolPlan = {
	renderCall([args, theme, context]) {
		const request = args as Record<string, unknown> | undefined;
		const ctx = context as RenderContext | undefined;
		if (ctx?.expanded || ctx?.isError) return undefined;
		if (request?.action !== undefined && request.action !== "run") return undefined;
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
		if (isExpanded(options as RenderOptions, ctx) || res?.isError || ctx?.isError) return undefined;
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
		if (isExpanded(opts, ctx) || res?.isError || ctx?.isError) return undefined;
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

const PLANS: Record<string, ToolPlan> = { eval: evalPlan, edit: editPlan, apply_patch: patchPlan, todo: todoPlan };

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
type GroupView = { setMembers(members: readonly unknown[], lines: readonly MemberLine[], cards: readonly object[]): void };
type GroupBase = new () => { children: unknown[]; render(width: number): string[] };
type CardSnapshot = {
	presentation?: unknown;
	identity?: { toolName?: unknown; toolDefinition?: Record<PropertyKey, unknown> };
	state?: { args?: unknown; result?: unknown };
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

/** A card joins an eval block only when its collapsed render is this extension's one-liner. */
function snapshotLine(snapshot: CardSnapshot | undefined): MemberLine | undefined {
	if (snapshot?.presentation !== "classic" || snapshot.identity?.toolName !== "eval") return undefined;
	if (snapshot.identity.toolDefinition?.[WRAPPED] !== true) return undefined;
	const state = snapshot.state;
	// peek/stop/list control results copy the run's details (no details.action), so only args tell them apart.
	const action = (state?.args as { action?: unknown } | undefined)?.action;
	if (action !== undefined && action !== "run") return undefined;
	return state?.result ? evalResultLine(state.result, state.args) : evalCallLine(state?.args);
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
			const line = snapshotLine(card.presentationSnapshot);
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
			// With the core fold off, a WRAPPED mark left by an older copy still matches cards this
			// copy renders unfolded, so grouping must not run at all.
			if (!TruncatedText) return projected;
			if (!Array.isArray(projected)) return projected;
			const known = projections.get(projected);
			if (known) return known;
			const View = groupClass();
			if (!View) return projected;
			const grouped = groupEvalRuns<GroupView>(projected, {
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
			projections.set(projected, grouped);
			return grouped;
		},
		setUi(next) {
			ui = next;
			if (pendingWarning !== undefined) notifyOnce(pendingWarning);
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
		for (const part of [installThinkingHook(senpi), installGroupHook(senpi, tui)]) if (part) parts.push(part);
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
