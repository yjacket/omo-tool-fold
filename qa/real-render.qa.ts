// Real-Senpi component harness. Not a `*.test.ts` file, so default `bun test` skips it.
// Run from the repo root: bun test ./qa/real-render.qa.ts
// It drives the installed Senpi transcript, assistant-message and tool-card classes in a plain
// bun process, with the real InteractiveMode.createToolExecutionComponent on a stub instance.
import { expect, mock, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

// The installed Senpi/TUI packages are untyped from this harness's view; `unknown` would force a
// cast at every member access and hide the seams this harness exists to drive.
// biome-ignore lint/suspicious/noExplicitAny: dynamic-import surface of the real Senpi/TUI packages.
type Mod = Record<string, any>;

function distRoot(envName: string, fallback: string): string {
	const root = process.env[envName] ?? fallback;
	if (!existsSync(join(root, "index.js"))) {
		throw new Error(`${envName}: no index.js under "${root}". Set ${envName} to the installed package's dist directory.`);
	}
	return pathToFileURL(root).href;
}

const SENPI = distRoot("SENPI_DIST", "C:/Users/yjack/.bun/install/global/node_modules/@code-yeongyu/senpi/dist");
const PI_TUI = distRoot("PI_TUI_DIST", "C:/Users/yjack/.bun/install/global/node_modules/@earendil-works/pi-tui/dist");
const EVIDENCE = process.env.EVIDENCE_DIR ?? join(import.meta.dir, "..", ".omo", "evidence", "fold-thinking-eval-group");

const senpi: Mod = await import(`${SENPI}/index.js`);
const tui: Mod = await import(`${PI_TUI}/index.js`);
const { ExplorationTranscriptContainer } = await import(`${SENPI}/modes/interactive/components/exploration-transcript-container.js`);
const { CustomEntryComponent } = await import(`${SENPI}/modes/interactive/components/custom-entry.js`);
const themeModule: Mod = await import(`${SENPI}/modes/interactive/theme/theme.js`);
senpi.initTheme("light");
// interactive-mode.js exposes ctx.ui.theme as this live proxy.
const liveTheme = themeModule.theme;

let executeCalls = 0;

const defs: Record<string, unknown> = {
	eval: {
		renderCall(args: { summary?: string }) {
			return new tui.Text(`EVAL-CALL ${args.summary}`, 0, 0);
		},
		renderResult(result: { content?: { type: string; text?: string }[]; details?: { cells?: { status?: string }[] } }) {
			const text = result.content?.find((part) => part.type === "text")?.text;
			if (text) return new tui.Text(text, 0, 0);
			return new tui.Text(`EVAL-FULL-OUTPUT ${JSON.stringify(result.details?.cells?.[0]?.status)}`, 0, 0);
		},
		execute() {
			executeCalls++;
			throw new Error("eval fixture execute must not run");
		},
	},
};

/** A synthetic definition. Renderer slots exist only when a case supplies them. */
function fixture(name: string, slots: Record<string, unknown> = {}): Mod {
	const definition: Mod = {
		...slots,
		execute() {
			executeCalls++;
			throw new Error(`${name} fixture execute must not run`);
		},
	};
	defs[name] = definition;
	return definition;
}

function twoSlot(name: string, callText: string, resultText: string): Mod {
	return fixture(name, {
		renderCall(args: unknown) {
			return new tui.Text(`${callText} ${JSON.stringify(args)}`, 0, 0);
		},
		renderResult(result: unknown) {
			return new tui.Text(`${resultText} ${JSON.stringify(result)}`, 0, 0);
		},
	});
}

function noSlot(name: string): Mod {
	return fixture(name);
}
senpi.AgentSession.prototype.getToolDefinition = (name: string) => defs[name];
mock.module("@code-yeongyu/senpi", () => senpi);
mock.module("@earendil-works/pi-tui", () => tui);

type Handler = (event: unknown, ctx: unknown) => void;
type Harness = { im: Mod; notices: string[]; fire(event: string, payload: unknown): void };

/** A stub InteractiveMode instance; it owns its data because some names are prototype accessors. */
function stubIm(): Mod {
	const im = Object.create(senpi.InteractiveMode.prototype);
	const fields: Record<string, unknown> = {
		chatContainer: new ExplorationTranscriptContainer({
			tailBudget: 60,
			warmChunkSize: 100,
			requestRender() {},
			historyMarker: (n: number) => `${n} hidden`,
		}),
		session: {
			resolveToolCallName: (n: string) => n,
			getToolDefinition: (n: string) => senpi.AgentSession.prototype.getToolDefinition.call({}, n),
		},
		settingsManager: { getShowImages: () => false, getImageWidthCells: () => 60 },
		ui: { requestRender() {} },
		sessionManager: { getCwd: () => "C:/repo" },
		chrome: undefined,
		loadedResourcesContainer: new tui.Container(),
		toolOutputExpanded: false,
		showStatus() {},
	};
	for (const [key, value] of Object.entries(fields)) {
		Object.defineProperty(im, key, { value, writable: true, configurable: true, enumerable: true });
	}
	return im;
}

async function harness(caseName: string, themeThrows = false): Promise<Harness> {
	const handlers = new Map<string, Handler[]>();
	const notices: string[] = [];
	const pi = { on: (event: string, handler: Handler) => handlers.set(event, [...(handlers.get(event) ?? []), handler]) };
	const ext = await import(`../extension/tool-fold.ts?case=${caseName}`);
	await ext.default(pi);
	let armed = false;
	const ui = {
		notify: (message: string) => notices.push(message),
		get theme() {
			if (armed) throw new Error("qa: theme unavailable");
			return liveTheme;
		},
	};
	const fire = (event: string, payload: unknown) => {
		for (const handler of handlers.get(event) ?? []) handler(payload, { ui });
	};
	fire("session_start", { reason: "startup" });
	armed = themeThrows;
	return { im: stubIm(), notices, fire };
}

const thinking = { type: "thinking", thinking: "t", startedAt: 1000, endedAt: 1001 };
let callSeq = 0;

function assistant(content: unknown[], hideThinking = true): Mod {
	const message = { role: "assistant", content, stopReason: "stop", timestamp: 1 };
	return new senpi.AssistantMessageComponent(message, hideThinking, senpi.getMarkdownTheme(), "Thinking...", 1, []);
}

function thinkingOnly(): Mod {
	return assistant([thinking, { type: "toolCall", id: `tc${++callSeq}`, name: "eval", arguments: {} }]);
}

type CardOptions = { status?: string; isError?: boolean; args?: Record<string, unknown>; partial?: boolean };

function evalCard(h: Harness, summary: string, options: CardOptions = {}): Mod {
	const args = options.args ?? { language: "js", summary, code: "1" };
	const card = h.im.createToolExecutionComponent("eval", `e${++callSeq}`, args);
	card.markExecutionStarted();
	card.setArgsComplete();
	card.updateResult(
		{
			content: [],
			isError: options.isError === true,
			details: { cells: [{ status: options.status ?? "complete", language: "js", summary }] },
		},
		options.partial === true,
	);
	return card;
}

function add(h: Harness, ...children: Mod[]): void {
	for (const child of children) h.im.chatContainer.addChild(child);
}

function render(h: Harness, width = 150): { ansi: string[]; plain: string[] } {
	const ansi: string[] = h.im.chatContainer.render(width);
	return { ansi, plain: ansi.map((line) => Bun.stripANSI(line).trimEnd()) };
}

/** Folded cards carry Senpi's one-column card padding, so whole-line card checks compare trimmed lines. */
function hasLine(lines: string[], text: string): boolean {
	return lines.some((line) => line.trim() === text);
}

function count(lines: string[], text: string): number {
	return lines.filter((line) => line.includes(text)).length;
}

function evidence(name: string, out: { ansi: string[]; plain: string[] }): void {
	mkdirSync(EVIDENCE, { recursive: true });
	writeFileSync(join(EVIDENCE, `real-render-${name}.ansi`), out.ansi.join("\n"));
	writeFileSync(join(EVIDENCE, `real-render-${name}.txt`), out.plain.join("\n"));
}

/** R1 transcript; returns the eval cards. */
function r1Transcript(h: Harness): Mod[] {
	const e1 = evalCard(h, "A 조사");
	const e2 = evalCard(h, "B 확인");
	add(h, thinkingOnly(), e1, thinkingOnly(), e2, assistant([thinking, { type: "text", text: "끝" }]));
	return [e1, e2];
}

function expectR1Collapsed(plain: string[]): void {
	expect(count(plain, "Thought:")).toBe(0);
	expect(count(plain, "Thinking...")).toBe(0);
	expect(count(plain, "Ran 2 evals")).toBe(1);
	const at = plain.findIndex((line) => line.includes("Ran 2 evals"));
	expect(plain[at + 1]).toBe("  └ js ✓ A 조사");
	expect(plain[at + 2]).toBe("    js ✓ B 확인");
	expect(count(plain, "끝")).toBeGreaterThan(0);
}

function show(label: string, plain: string[]): void {
	console.log(`--- ${label}\n${plain.filter((line) => line.length > 0).join("\n")}`);
}

/** Creates a real ToolExecutionComponent through the installed InteractiveMode method. */
function toolCard(h: Harness, name: string, args: Record<string, unknown>, result?: Mod, partial = false): Mod {
	const card = h.im.createToolExecutionComponent(name, `c${++callSeq}`, args);
	card.markExecutionStarted();
	card.setArgsComplete();
	if (result !== undefined) card.updateResult(result, partial);
	return card;
}

/** The actual TuiMainScreen renderer; each frame is one doRender pass. */
function mainScreen(h: Harness, columns = 150): { render(): { ansi: string[]; plain: string[] }; screen: Mod } {
	const terminal = { columns, rows: 45, write() {}, hideCursor() {}, showCursor() {} };
	const screen = new tui.TuiMainScreen(terminal);
	screen.addChild(h.im.chatContainer);
	return {
		screen,
		render() {
			screen.doRender();
			const ansi: string[] = screen.previousLines;
			return { ansi, plain: ansi.map((line: string) => Bun.stripANSI(line).trimEnd()) };
		},
	};
}

function groupIn(h: Harness): Mod | undefined {
	return (h.im.chatContainer.project() as Mod[]).find((child) => typeof child?.setMembers === "function");
}

function hasGroup(h: Harness): boolean {
	return groupIn(h) !== undefined;
}

type ResultSnapshot = { card: Mod; result: unknown; clone: unknown };

/** Clone each card's current result so a later render can prove projection never touched it. */
function snapshotResults(cards: readonly Mod[]): ResultSnapshot[] {
	return cards.map((card) => ({ card, result: card.result, clone: structuredClone(card.result) }));
}

/** Source children keep their identity/order and every fixture result keeps its identity and deep value. */
function expectSourceUnchanged(h: Harness, source: readonly Mod[], snapshots: readonly ResultSnapshot[]): void {
	expect(h.im.chatContainer.children).toEqual(source);
	expect(h.im.chatContainer.children.every((child: Mod, index: number) => child === source[index])).toBe(true);
	for (const { card, result, clone } of snapshots) {
		expect(card.result).toBe(result);
		expect(card.result).toEqual(clone);
	}
}

/** Every case keeps its source cards/results by identity and executes no fixture. */
function expectNoSideEffects(h: Harness, source: readonly Mod[], snapshots: readonly ResultSnapshot[]): void {
	expectSourceUnchanged(h, source, snapshots);
	expect(executeCalls).toBe(0);
}

const textResult = (text: string, details: Record<string, unknown> = {}, isError = false) => ({
	content: [{ type: "text", text }],
	isError,
	details,
});

const evalResult = (summary: string, status = "complete", isError = false) => ({
	content: [{ type: "text", text: `EVAL-RESULT ${summary}` }],
	isError,
	details: { cells: [{ status, language: "js", summary }] },
});

const okThread = (extra: Record<string, unknown> = {}) => ({
	content: [],
	details: { result: { kind: "ok", ...extra } },
});

// G8's pre-load baseline must run before the extension is imported. Importing the module installs
// the prototype hook; creating a card does not.
const g8Baseline = (() => {
	const im = stubIm();
	const definition = noSlot("thread_create");
	const lineCounts = [9, 10, 11];
	const frames = lineCounts.map((count) => {
		const card = im.createToolExecutionComponent("thread_create", `pre-g8-${count}`, { name: "G8" });
		card.markExecutionStarted();
		card.setArgsComplete();
		card.updateResult({
			content: [{ type: "text", text: Array.from({ length: count }, (_, index) => `LINE-${index + 1}`).join("\n") }],
			details: {},
		}, false);
		const ansi: string[] = card.render(80);
		return { count, ansi, plain: ansi.map((line) => Bun.stripANSI(line).trimEnd()) };
	});
	return { definition, frames };
})();

test("G1 todo mixed run folds todo titles with eval in order", async () => {
	executeCalls = 0;
	const h = await harness("g1");
	twoSlot("todo", "TODO-CALL", "TODO-NATIVE-RESULT");
	const start = toolCard(h, "todo", { op: "start", task: "계획" }, textResult("", { op: "start" }));
	const evalCardG1 = toolCard(h, "eval", { language: "js", summary: "검증" }, evalResult("검증"));
	const done = toolCard(h, "todo", { op: "done", task: "계획" }, textResult("", { op: "done" }));
	const source = [start, evalCardG1, done];
	add(h, ...source);
	const snapshots = snapshotResults(source);
	const out = render(h);
	evidence("g1-todo-mixed", out);
	show("G1", out.plain);
	expect(hasLine(out.plain, "└ todo start: 계획")).toBe(true);
	expect(count(out.plain, "todo done: 계획")).toBe(1);
	expect(count(out.plain, "todo start: 계획")).toBe(1);
	expect(count(out.plain, "Ran 3 tools · todo 2 · eval 1")).toBe(1);
	expect(out.plain.some((line) => line.includes("eval js ✓ 검증"))).toBe(true);
	expect(inOrder(out.plain, "todo start: 계획", "eval js ✓ 검증", "todo done: 계획")).toBe(true);
	expectNoSideEffects(h, source, snapshots);
});

test("G2 default control native fallback frames call partial settled failure", async () => {
	executeCalls = 0;
	const h = await harness("g2");
	noSlot("kill_bash");
	const running = toolCard(h, "eval", { language: "js", summary: "A 조사" });
	const control = toolCard(h, "kill_bash", { bash_id: "b1" });
	const source = [running, control];
	add(h, ...source);
	const screen = mainScreen(h);
	const callSnapshot = snapshotResults(source);
	const call = screen.render();
	expectSourceUnchanged(h, source, callSnapshot);
	evidence("g2-call", call);
	show("G2 call", call.plain);
	expect(count(call.plain, "Running 2 tools · eval 1 · kill_bash 1")).toBe(1);
	expect(call.plain.some((line) => line.includes("kill_bash b1"))).toBe(true);

	const partial = evalResult("A 조사");
	running.updateResult(partial, true);
	const partialSnapshot = snapshotResults(source);
	const partialFrame = screen.render();
	expectSourceUnchanged(h, source, partialSnapshot);
	evidence("g2-partial", partialFrame);
	show("G2 partial", partialFrame.plain);
	expect(count(partialFrame.plain, "Running 2 tools")).toBe(1);
	expect(partialFrame.plain.some((line) => line.includes("A 조사"))).toBe(true);
	expect(count(partialFrame.plain, "Ran 2 tools")).toBe(0);

	const settledEval = evalResult("A 조사");
	const settledControl = textResult("killed 1 session", {});
	running.updateResult(settledEval, false);
	control.updateResult(settledControl, false);
	const settledSnapshot = snapshotResults(source);
	const settled = screen.render();
	expectSourceUnchanged(h, source, settledSnapshot);
	evidence("g2-settled", settled);
	show("G2 settled", settled.plain);
	expect(count(settled.plain, "Ran 2 tools · eval 1 · kill_bash 1")).toBe(1);
	expect(settled.plain.some((line) => line.includes("kill_bash b1: killed 1 session"))).toBe(true);

	const failed = textResult("QA-KILL-ERROR", {}, true);
	control.updateResult(failed, false);
	const failedSnapshot = snapshotResults(source);
	const failure = screen.render();
	evidence("g2-failure", failure);
	show("G2 failure", failure.plain);
	expect(count(failure.plain, "Ran 2 tools")).toBe(0);
	expect(failure.plain.some((line) => line.includes("kill_bash"))).toBe(true);
	expect(failure.plain.some((line) => line.includes("QA-KILL-ERROR"))).toBe(true);
	expectNoSideEffects(h, source, failedSnapshot);
});

test("G3 thread lifecycle and background queued receipts stay distinct", async () => {
	executeCalls = 0;
	const h = await harness("g3");
	noSlot("thread_send");
	noSlot("thread_handoff");
	twoSlot("bash", "BASH-CALL", "BASH-NATIVE");
	const send = toolCard(h, "thread_send", { thread: "t1", summary: "보고" });
	const handoff = toolCard(h, "thread_handoff", { thread: "t2" });
	const background = toolCard(h, "bash", { description: "긴 작업", command: "sleep 99" });
	const source = [send, handoff, background];
	add(h, ...source);
	const screen = mainScreen(h);
	const callSnapshot = snapshotResults(source);
	const call = screen.render();
	expectSourceUnchanged(h, source, callSnapshot);
	evidence("g3-call", call);
	expect(count(call.plain, "Running 3 tools · thread_send 1 · thread_handoff 1 · bash 1")).toBe(1);

	const queued = okThread({ delivery: { kind: "queued_offline" }, thread_id: "t1" });
	const started = okThread({ delivery: { kind: "started" }, thread_id: "t2" });
	const launched = textResult("started job", { background: true, bash_id: "bg-42" });
	background.updateResult(launched, true);
	const partialSnapshot = snapshotResults(source);
	const partial = screen.render();
	expectSourceUnchanged(h, source, partialSnapshot);
	evidence("g3-partial", partial);
	expect(count(partial.plain, "Running 3 tools")).toBe(1);
	expect(partial.plain.some((line) => line.includes("background bg-42"))).toBe(true);
	send.updateResult(queued, false);
	handoff.updateResult(started, false);
	background.updateResult(launched, false);
	const settledSnapshot = snapshotResults(source);
	const settled = screen.render();
	expectSourceUnchanged(h, source, settledSnapshot);
	evidence("g3-settled", settled);
	show("G3 settled", settled.plain);
	// A queued/started delivery is a receipt, not completion, so the header stays Running.
	expect(count(settled.plain, "Running 3 tools")).toBe(1);
	expect(settled.plain.some((line) => line.includes("thread_send t1 queued_offline"))).toBe(true);
	expect(settled.plain.some((line) => line.includes("thread_handoff t2 started"))).toBe(true);
	expect(settled.plain.some((line) => line.includes("bash 긴 작업 background bg-42"))).toBe(true);
	expect(settled.plain.some((line) => line.includes("queued_offline"))).toBe(true);
	expect(settled.plain.some((line) => line.includes("started") && !line.includes("queued_offline"))).toBe(true);
	expect(source.every((card, index) => card.result === [queued, started, launched][index])).toBe(true);

	const failedThread = { content: [], details: { result: { kind: "error", error: { code: "invalid_arguments" } } } };
	send.updateResult(failedThread, false);
	const failedSnapshot = snapshotResults(source);
	const failure = screen.render();
	evidence("g3-failure", failure);
	show("G3 failure", failure.plain);
	expect(count(failure.plain, "Running 3 tools")).toBe(0);
	expect(failure.plain.some((line) => line.includes("thread_send"))).toBe(true);
	expectNoSideEffects(h, source, failedSnapshot);
});

test("G4 full MCP and shell glob rows retain previews and targets", async () => {
	executeCalls = 0;
	const h = await harness("g4");
	twoSlot("mcp__ast_grep_search", "MCP-SEARCH-CALL", "MCP-SEARCH-RESULT");
	twoSlot("mcp__ast_grep_rewrite", "MCP-REWRITE-CALL", "MCP-REWRITE-RESULT");
	twoSlot("bash", "BASH-CALL", "BASH-RESULT");
	twoSlot("glob", "GLOB-CALL", "GLOB-RESULT");
	const searchResult = textResult("search body", { server: "ast-grep", tool: "search", preview: "src/a.ts:1: match" });
	const rewriteResult = textResult("rewrite body", { server: "ast-grep", tool: "rewrite", preview: "(empty result)" });
	const shellResult = textResult("done", { background: false });
	const globResult = textResult("src/a.ts\nsrc/b.ts", {});
	const search = toolCard(h, "mcp__ast_grep_search", { pattern: "foo", paths: ["src"] }, searchResult);
	const rewrite = toolCard(h, "mcp__ast_grep_rewrite", { pattern: "foo", paths: ["src"], apply: true }, rewriteResult);
	const shell = toolCard(h, "bash", { description: "타입 검사", command: "bunx tsc" }, shellResult);
	const glob = toolCard(h, "glob", { pattern: "**/*.ts", path: "C:/repo/src" }, globResult);
	const source = [search, rewrite, shell, glob];
	add(h, ...source);
	const snapshots = snapshotResults(source);
	const out = render(h);
	evidence("g4-mcp-shell-glob", out);
	show("G4", out.plain);
	expect(count(out.plain, "Ran 4 tools")).toBe(1);
	expect(out.plain.some((line) => line.includes("mcp__ast_grep_search foo src preview") && line.includes("src/a.ts:1: match"))).toBe(true);
	expect(out.plain.some((line) => line.includes("mcp__ast_grep_rewrite foo src apply") && line.includes("(empty result)"))).toBe(true);
	expect(out.plain.some((line) => line.includes("bash 타입 검사"))).toBe(true);
	expect(out.plain.some((line) => line.includes("glob **/*.ts in src"))).toBe(true);
	expect(out.plain.some((line) => line.includes("mcp__ast_grep_search") && line.includes("preview"))).toBe(true);
	expect(out.plain.some((line) => line.includes("mcp__ast_grep_rewrite") && line.includes("apply"))).toBe(true);
	expectNoSideEffects(h, source, snapshots);
});

test("G5 widths 24 80 150 truncate Korean and sanitize controls", async () => {
	executeCalls = 0;
	const h = await harness("g5");
	twoSlot("bash", "BASH-CALL", "BASH-RESULT");
	twoSlot("glob", "GLOB-CALL", "GLOB-RESULT");
	const hostile = "한국어 \u001b[31m빨강\u001b[0m\u0007 \u001b]0;injected\u0007 마지막";
	const bash = toolCard(h, "bash", { description: hostile, command: hostile }, textResult("ok", {}));
	const glob = toolCard(h, "glob", { pattern: "**/*한국*.ts", path: "C:/repo/한국" }, textResult("ok", {}));
	const source = [bash, glob];
	add(h, ...source);
	const snapshots = snapshotResults(source);
	for (const width of [24, 80, 150]) {
		const out = render(h, width);
		evidence(`g5-width-${width}`, out);
		show(`G5 ${width}`, out.plain);
		expect(out.ansi.every((line) => tui.visibleWidth(line) <= width)).toBe(true);
		expect(out.ansi.join("\n").includes("\u0007")).toBe(false);
		expect(out.ansi.join("\n").includes("\u001b]0;")).toBe(false);
		expect(out.plain.filter((line) => line.includes("한국어")).length).toBeGreaterThan(0);
		expect(count(out.plain, "Ran 2 tools")).toBe(1);
	}
	expectNoSideEffects(h, source, snapshots);
});

test("G6 header click expands member bodies and recollapses exactly", async () => {
	executeCalls = 0;
	const h = await harness("g6");
	twoSlot("bash", "BASH-CALL", "BASH-EXPANDED-BODY");
	const evalCardG6 = evalCard(h, "A 조사");
	const bash = toolCard(h, "bash", { description: "보기", command: "ls" }, textResult("ok", {}));
	const source = [evalCardG6, bash];
	add(h, ...source);
	const snapshots = snapshotResults(source);
	const screen = mainScreen(h);
	const collapsed = screen.render();
	evidence("g6-collapsed", collapsed);
	const group = groupIn(h);
	expect(group).toBeDefined();
	const click = { type: "click", button: "left", x: 2, y: 1, screenX: 2, screenY: 10, width: 150, height: 4 };
	group?.handleMouse(click);
	expect(source.map((card) => card.expanded)).toEqual([true, true]);
	const expanded = screen.render();
	evidence("g6-expanded", expanded);
	show("G6 expanded", expanded.plain);
	expect(expanded.plain.some((line) => line.includes("BASH-EXPANDED-BODY"))).toBe(true);
	expect(count(expanded.plain, "EVAL-FULL-OUTPUT")).toBe(1);
	// The group adds only the leading spacer and its header; member bodies are the original card bytes.
	const expandedChat = render(h);
	const memberBody = expandedChat.ansi.slice(2);
	const originalCards = source.flatMap((card) => card.render(150));
	expect(memberBody).toEqual(originalCards);
	group?.handleMouse(click);
	expect(source.map((card) => card.expanded)).toEqual([false, false]);
	const recollapsed = screen.render();
	evidence("g6-recollapsed", recollapsed);
	expect(recollapsed.plain).toEqual(collapsed.plain);
	expectNoSideEffects(h, source, snapshots);
});

test("G7 errors media questions stubs takeover and Grok stay native", async () => {
	executeCalls = 0;

	const errorHarness = await harness("g7-error");
	twoSlot("mcp__ast_grep_scan", "SCAN-CALL", "SCAN-RESULT");
	twoSlot("bash", "BASH-CALL", "BASH-RESULT");
	const refused = textResult("QA-MCP-REFUSAL", { error: { code: "refused" }, server: "ast-grep", tool: "scan", preview: "preview must not win" });
	const errorEval = evalCard(errorHarness, "정상");
	const mcpError = toolCard(errorHarness, "mcp__ast_grep_scan", { ruleFile: "rule.yml", paths: ["src"] }, refused);
	const errorSource = [errorEval, mcpError];
	add(errorHarness, ...errorSource);
	const errorSnapshot = snapshotResults(errorSource);
	const errorOut = render(errorHarness);
	evidence("g7-error", errorOut);
	expect(hasGroup(errorHarness)).toBe(false);
	expect(errorOut.plain.some((line) => line.includes("QA-MCP-REFUSAL"))).toBe(true);
	expectSourceUnchanged(errorHarness, errorSource, errorSnapshot);
	const mediaHarness = await harness("g7-media");
	const mediaEval = evalCard(mediaHarness, "정상2");
	const media = toolCard(mediaHarness, "eval", { language: "js", summary: "그림" }, {
		content: [{ type: "image", data: "AAAA", mimeType: "image/png" }, { type: "text", text: "IMAGE-SIBLING" }],
		details: { cells: [{ status: "complete", language: "js", summary: "그림" }] },
	});
	const mediaSource = [mediaEval, media];
	add(mediaHarness, ...mediaSource);
	const mediaSnapshot = snapshotResults(mediaSource);
	const mediaImage = media.presentationSnapshot.state.result.content[0];
	const mediaOut = render(mediaHarness);
	evidence("g7-media", mediaOut);
	expect(hasGroup(mediaHarness)).toBe(false);
	expectSourceUnchanged(mediaHarness, mediaSource, mediaSnapshot);
	expect(media.presentationSnapshot.state.result.content[0]).toBe(mediaImage);

	const malformedHarness = await harness("g7-malformed");
	twoSlot("webfetch", "WEBFETCH-CALL", "WEBFETCH-RESULT");
	const malformedEval = evalCard(malformedHarness, "정상3");
	const malformedResult = { content: [{ type: "text" }], details: {} };
	const malformed = toolCard(malformedHarness, "webfetch", { url: "https://example.invalid" }, malformedResult);
	const malformedSource = [malformedEval, malformed];
	add(malformedHarness, ...malformedSource);
	const malformedSnapshot = snapshotResults(malformedSource);
	const malformedOut = render(malformedHarness);
	evidence("g7-malformed", malformedOut);
	expect(hasGroup(malformedHarness)).toBe(false);
	expect(malformedOut.plain.some((line) => line.includes("webfetch"))).toBe(true);
	expectSourceUnchanged(malformedHarness, malformedSource, malformedSnapshot);

	const questionHarness = await harness("g7-question");
	fixture("ask_user_question", { renderCall: () => new tui.Text("QUESTION-CALL", 0, 0) });
	const q1 = evalCard(questionHarness, "앞");
	const question = toolCard(questionHarness, "ask_user_question", { question: "진행할까요?" }, textResult("YES", {}));
	const q2 = evalCard(questionHarness, "뒤");
	const questionSource = [q1, question, q2];
	add(questionHarness, ...questionSource);
	const questionSnapshot = snapshotResults(questionSource);
	const questionOut = render(questionHarness);
	evidence("g7-question", questionOut);
	expect(hasGroup(questionHarness)).toBe(false);
	expect(questionOut.plain.some((line) => line.includes("QUESTION-CALL") || line.includes("ask_user_question"))).toBe(true);
	expectSourceUnchanged(questionHarness, questionSource, questionSnapshot);

	const stubHarness = await harness("g7-stub");
	fixture("mcp__ast_grep_scan", { renderCall: () => new tui.Text("MCP-STUB-CALL", 0, 0) });
	const s1 = evalCard(stubHarness, "전");
	const stub = toolCard(stubHarness, "mcp__ast_grep_scan", { ruleFile: "rule.yml" }, textResult("inactive guidance", {}));
	const s2 = evalCard(stubHarness, "후");
	const stubSource = [s1, stub, s2];
	add(stubHarness, ...stubSource);
	const stubSnapshot = snapshotResults(stubSource);
	const stubOut = render(stubHarness);
	evidence("g7-stub", stubOut);
	expect(hasGroup(stubHarness)).toBe(false);
	expect(stubOut.plain.some((line) => line.includes("inactive guidance"))).toBe(true);
	expectSourceUnchanged(stubHarness, stubSource, stubSnapshot);

	const takeoverHarness = await harness("g7-takeover");
	fixture("thread_create", { renderResult: () => new tui.Text("TAKEOVER-RESULT", 0, 0) });
	const t1 = evalCard(takeoverHarness, "하나");
	const takeover = toolCard(takeoverHarness, "thread_create", { name: "custom" }, okThread({ thread_id: "t9" }));
	const t2 = evalCard(takeoverHarness, "둘");
	const takeoverSource = [t1, takeover, t2];
	add(takeoverHarness, ...takeoverSource);
	const takeoverSnapshot = snapshotResults(takeoverSource);
	const takeoverOut = render(takeoverHarness);
	evidence("g7-takeover", takeoverOut);
	expect(hasGroup(takeoverHarness)).toBe(false);
	expect(takeoverOut.plain.some((line) => line.includes("TAKEOVER-RESULT"))).toBe(true);
	expectSourceUnchanged(takeoverHarness, takeoverSource, takeoverSnapshot);

	const grokHarness = await harness("g7-grok");
	grokHarness.im.chrome = { toolPresentation: "grok" };
	twoSlot("bash", "BASH-CALL", "BASH-RESULT");
	noSlot("thread_send");
	const grokBash = toolCard(grokHarness, "bash", { description: "grok", command: "ls" }, textResult("ok", {}));
	const grokThread = toolCard(grokHarness, "thread_send", { thread: "t1" }, okThread({ delivery: { kind: "started" }, thread_id: "t1" }));
	const grokSource = [grokBash, grokThread];
	add(grokHarness, ...grokSource);
	const grokSnapshot = snapshotResults(grokSource);
	const grokOut = render(grokHarness);
	evidence("g7-grok", grokOut);
	expect(hasGroup(grokHarness)).toBe(false);
	expect(grokBash.presentationSnapshot.presentation).toBe("grok");
	expect(grokThread.presentationSnapshot.presentation).toBe("grok");
	expect(grokOut.plain.some((line) => line.includes("bash"))).toBe(true);
	expect(grokOut.plain.some((line) => line.includes("thread_send"))).toBe(true);
	expectSourceUnchanged(grokHarness, grokSource, grokSnapshot);
	expectSourceUnchanged(mediaHarness, mediaSource, mediaSnapshot);
	expect(executeCalls).toBe(0);
});

test("G8 native fallback lines and reload keep absent slots and raw bytes", async () => {
	executeCalls = 0;
	const h = await harness("g8");
	expect(g8Baseline.frames.length).toBe(3);
	expect(Object.hasOwn(g8Baseline.definition, "renderCall")).toBe(false);
	expect(Object.hasOwn(g8Baseline.definition, "renderResult")).toBe(false);
	const definition = noSlot("thread_create");
	const after = g8Baseline.frames.map((frame) => {
		const card = toolCard(h, "thread_create", { name: "G8" }, {
			content: [{ type: "text", text: Array.from({ length: frame.count }, (_, index) => `LINE-${index + 1}`).join("\n") }],
			details: {},
		});
		const ansi: string[] = card.render(80);
		return { ansi, plain: ansi.map((line) => Bun.stripANSI(line).trimEnd()) };
	});
	expect(Object.hasOwn(definition, "renderCall")).toBe(false);
	expect(Object.hasOwn(definition, "renderResult")).toBe(false);
	for (const [index, frame] of g8Baseline.frames.entries()) {
		const current = after[index];
		expect(current).toBeDefined();
		if (!current) continue;
		expect(current.ansi).toEqual(frame.ansi);
		expect(current.plain).toEqual(frame.plain);
		evidence(`g8-native-${frame.count}`, { ansi: current.ansi, plain: current.plain });
	}
	const lineNine = g8Baseline.frames.find((frame) => frame.count === 9);
	const lineTen = g8Baseline.frames.find((frame) => frame.count === 10);
	const lineEleven = g8Baseline.frames.find((frame) => frame.count === 11);
	expect(lineNine?.plain.some((line) => line.includes("more lines"))).toBe(false);
	expect(lineTen?.plain.some((line) => line.includes("more lines"))).toBe(false);
	expect(lineEleven?.plain.some((line) => line.includes("more lines"))).toBe(true);

	noSlot("thread_list");
	const listA = toolCard(h, "thread_list", {}, okThread({ threads: [] }));
	const listB = toolCard(h, "thread_list", {}, okThread({ threads: [] }));
	add(h, listA, listB);
	const snapshots = snapshotResults([listA, listB]);
	const grouped = render(h);
	evidence("g8-grouped-before-reload", grouped);
	expect(count(grouped.plain, "Ran 2 tools · thread_list 2")).toBe(1);
	expectSourceUnchanged(h, [listA, listB], snapshots);
	h.fire("session_shutdown", { reason: "reload" });
	h.im.chatContainer.invalidate();
	const reloaded = render(h);
	evidence("g8-reloaded", reloaded);
	expect(hasGroup(h)).toBe(false);
	expect(reloaded.plain.some((line) => line.includes("thread_list"))).toBe(true);
	expectNoSideEffects(h, [listA, listB], snapshots);

	const proto = senpi.InteractiveMode.prototype;
	const savedExpansion = proto.setToolsExpanded;
	delete proto.setToolsExpanded;
	try {
		const notices: string[] = [];
		// session_start delivers the one load-time warning for the missing expansion seam.
		const handlers: Handler[] = [];
		const pi = { on: (_event: string, handler: Handler) => handlers.push(handler) };
		const missing = await import(`../extension/tool-fold.ts?case=g8-missing-seam`);
		await missing.default(pi);
		const ui = { notify: (message: string) => notices.push(message), theme: liveTheme };
		for (const handler of handlers) handler({ reason: "startup" }, { ui });
		expect(notices.some((notice) => notice.includes("기록 표시"))).toBe(true);
	} finally {
		proto.setToolsExpanded = savedExpansion;
	}
	expect(executeCalls).toBe(0);
});

/** Positional assertion for the mixed block's first-seen order. */
function inOrder(lines: string[], ...needles: string[]): boolean {
	let at = -1;
	for (const needle of needles) {
		const found = lines.findIndex((line, index) => index > at && line.includes(needle));
		if (found < 0) return false;
		at = found;
	}
	return true;
}

test("R1 thinking labels hidden and two evals grouped", async () => {
	const h = await harness("r1");
	r1Transcript(h);
	const out = render(h);
	evidence("collapsed", out);
	show("R1", out.plain);
	expectR1Collapsed(out.plain);
});

test("R2 lone eval stays a folded card", async () => {
	const h = await harness("r2");
	add(h, assistant([{ type: "text", text: "앞" }]), evalCard(h, "C"), assistant([{ type: "text", text: "뒤" }]));
	const { plain } = render(h);
	show("R2", plain);
	expect(hasLine(plain, "eval js ✓ C")).toBe(true);
	expect(count(plain, "Ran ")).toBe(0);
});

test("R3 an error eval breaks the run and shows original output", async () => {
	const h = await harness("r3");
	add(h, evalCard(h, "ok1"), evalCard(h, "bad", { isError: true }), evalCard(h, "ok2"));
	const { plain } = render(h);
	show("R3", plain);
	expect(count(plain, "Ran ")).toBe(0);
	expect(count(plain, "EVAL-FULL-OUTPUT")).toBe(1);
});

test("R4 expanding every card shows full outputs under the header", async () => {
	const h = await harness("r4");
	r1Transcript(h);
	for (const child of h.im.chatContainer.children) child.setExpanded?.(true);
	const expanded = render(h);
	evidence("expanded", expanded);
	show("R4 expanded", expanded.plain);
	expect(count(expanded.plain, "Ran 2 evals")).toBe(1);
	expect(count(expanded.plain, "EVAL-FULL-OUTPUT")).toBe(2);
	for (const child of h.im.chatContainer.children) child.setExpanded?.(false);
	const collapsed = render(h);
	show("R4 collapsed again", collapsed.plain);
	expectR1Collapsed(collapsed.plain);
});

test("R5 clicking the group header toggles every member card", async () => {
	const h = await harness("r5");
	const cards = r1Transcript(h);
	render(h);
	const group = h.im.chatContainer.project().find((child: Mod) => typeof child?.setMembers === "function");
	expect(group).toBeDefined();
	const click = { type: "click", button: "left", x: 2, y: 1, screenX: 2, screenY: 10, width: 150, height: 4 };
	group.handleMouse(click);
	expect(cards.map((card) => card.expanded)).toEqual([true, true]);
	const open = render(h);
	show("R5 after first click", open.plain);
	expect(count(open.plain, "EVAL-FULL-OUTPUT")).toBe(2);
	group.handleMouse(click);
	expect(cards.map((card) => card.expanded)).toEqual([false, false]);
	expectR1Collapsed(render(h).plain);
});

test("R6 shown thinking keeps its label and body", async () => {
	const h = await harness("r6");
	add(h, assistant([{ ...thinking, thinking: "생각 본문" }, { type: "text", text: "답" }], false));
	const { plain } = render(h);
	show("R6", plain);
	expect(count(plain, "Thought:")).toBeGreaterThan(0);
	expect(count(plain, "생각 본문")).toBeGreaterThan(0);
});

test("R7 a streaming message keeps the live Thinking... label", async () => {
	const h = await harness("r7");
	const live = new senpi.AssistantMessageComponent(undefined, true, senpi.getMarkdownTheme(), "Thinking...", 1, []);
	live.updateContent(
		{ role: "assistant", content: [{ type: "thinking", thinking: "t", startedAt: 1000 }], stopReason: "pending", timestamp: 1 },
		true,
	);
	add(h, live);
	const { plain } = render(h);
	show("R7", plain);
	expect(count(plain, "Thinking...")).toBeGreaterThan(0);
});

test("R8 read cards keep Senpi's Explored group", async () => {
	const h = await harness("r8");
	for (const path of ["C:/repo/a.ts", "C:/repo/b.ts"]) {
		const card = h.im.createToolExecutionComponent("read", `r${++callSeq}`, { path });
		card.markExecutionStarted();
		card.setArgsComplete();
		card.updateResult({ content: [{ type: "text", text: "x" }], isError: false, details: {} });
		add(h, card);
	}
	const { plain } = render(h);
	show("R8", plain);
	expect(count(plain, "Explored")).toBeGreaterThan(0);
});

test("R9 a running eval makes a Running header", async () => {
	const h = await harness("r9");
	add(h, evalCard(h, "A 조사"), evalCard(h, "B 실행", { status: "running", partial: true }));
	const { plain } = render(h);
	show("R9", plain);
	expect(count(plain, "Running 2 evals")).toBe(1);
	expect(plain.some((line) => /\brunning\b/.test(line) && line.includes("B 실행"))).toBe(true);
});

test("R10 reload shutdown restores original rendering", async () => {
	const h = await harness("r10");
	r1Transcript(h);
	expectR1Collapsed(render(h).plain);
	h.fire("session_shutdown", { reason: "reload" });
	h.im.chatContainer.invalidate();
	const { plain } = render(h);
	show("R10", plain);
	expect(count(plain, "Thought:")).toBeGreaterThan(0);
	expect(count(plain, "Ran ")).toBe(0);
});

test("R12 a peek card between runs prevents grouping", async () => {
	const h = await harness("r12");
	const peek = evalCard(h, "A 조사", { args: { action: "peek", cell_id: "c1" } });
	add(h, evalCard(h, "A 조사"), peek, evalCard(h, "B 확인"));
	const { plain } = render(h);
	show("R12", plain);
	expect(count(plain, "Ran ")).toBe(0);
});

test("R11 a throwing theme falls back to member cards with one notice", async () => {
	const h = await harness("r11", true);
	r1Transcript(h);
	const { plain } = render(h);
	// The extension reports the fallback notice from a microtask (queueMicrotask), so flush one tick.
	await Promise.resolve();
	show("R11", plain);
	console.log(`--- R11 notices\n${h.notices.join("\n")}`);
	expect(hasLine(plain, "eval js ✓ A 조사")).toBe(true);
	expect(hasLine(plain, "eval js ✓ B 확인")).toBe(true);
	expect(count(plain, "Ran ")).toBe(0);
	expect(count(plain, "[render error")).toBe(0);
	expect(h.notices.filter((notice) => notice.includes("도구 묶음")).length).toBe(1);
});

for (const provider of ["claude", "codex"]) {
	test(`long ${provider} history restores every compact card after Ctrl+O twice`, async () => {
		const h = await harness(`history-${provider}`);
		const savedHistory = process.env.PI_TUI_HISTORY_LINES;
		process.env.PI_TUI_HISTORY_LINES = "100";
		tui.resetMainScreenHistoryLines();
		const terminal = { columns: 150, rows: 45, write() {}, hideCursor() {}, showCursor() {} };
		const screen = new tui.TuiMainScreen(terminal);
		screen.addChild(h.im.chatContainer);
		const frame = () => {
			screen.doRender();
			const ansi: string[] = screen.previousLines;
			return { ansi, plain: ansi.map((line) => Bun.stripANSI(line).trimEnd()) };
		};
		try {
			for (let n = 0; n < 8; n++) {
				const summary = `HISTORY-${provider}-${n}`;
				const card = evalCard(h, summary);
				card.updateResult({
					content: [{ type: "text", text: Array.from({ length: 150 }, (_, row) => `FULL-${n}-${row}`).join("\n") }],
					details: { cells: [{ status: "complete", language: "js", summary }] },
				});
				// Nonempty Claude reasoning and empty Codex reasoning both retain the same tool cards.
				add(h, assistant([{ ...thinking, thinking: provider === "codex" ? "" : "reasoning" }]), card);
				if (n % 2 === 0) {
					add(h, new CustomEntryComponent(
						{ type: "custom", customType: "omo-kibitzer:nudged", data: {} },
						() => new tui.Text("QA-HIDDEN-NOTICE", 0, 0),
					));
				}
				if (n % 2 === 1) add(h, assistant([{ type: "text", text: `BREAK-${n}` }]));
			}
			const error = evalCard(h, "error", { isError: true });
			error.updateResult({ isError: true, content: [{ type: "text", text: "QA-ERROR-MUST-STAY" }] });
			add(h, error, assistant([{ type: "text", text: "QA-LATEST-RESPONSE" }]));
			const source = [...h.im.chatContainer.children];
			const collapsed = frame();
			evidence(`${provider}-history-before`, collapsed);
			h.im.toggleToolOutputExpansion();
			const expanded = frame();
			evidence(`${provider}-history-expanded`, expanded);
			expect(expanded.plain.some((line) => line.includes("FULL-7-149"))).toBe(true);
			h.im.toggleToolOutputExpansion();
			const recollapsed = frame();
			evidence(`${provider}-history-after`, recollapsed);
			console.log(`${provider} history rows ${collapsed.plain.length} -> ${expanded.plain.length} -> ${recollapsed.plain.length}`);
			expect(recollapsed.plain).toEqual(collapsed.plain);
			expect(recollapsed.plain.some((line) => line.includes("QA-ERROR-MUST-STAY"))).toBe(true);
			expect(h.im.chatContainer.children).toEqual(source);
			expect(h.notices).toEqual([]);
		} finally {
			h.im.chatContainer.dispose();
			if (savedHistory === undefined) delete process.env.PI_TUI_HISTORY_LINES;
			else process.env.PI_TUI_HISTORY_LINES = savedHistory;
			tui.resetMainScreenHistoryLines();
		}
	});
}
