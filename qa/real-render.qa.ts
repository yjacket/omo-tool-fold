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
const EVIDENCE = join(import.meta.dir, "..", ".omo", "evidence", "fold-thinking-eval-group");

const senpi: Mod = await import(`${SENPI}/index.js`);
const tui: Mod = await import(`${PI_TUI}/index.js`);
const { ExplorationTranscriptContainer } = await import(`${SENPI}/modes/interactive/components/exploration-transcript-container.js`);
const themeModule: Mod = await import(`${SENPI}/modes/interactive/theme/theme.js`);
senpi.initTheme("light");
// interactive-mode.js exposes ctx.ui.theme as this live proxy.
const liveTheme = themeModule.theme;

const defs: Record<string, unknown> = {
	eval: {
		renderCall(args: { summary?: string }) {
			return new tui.Text(`EVAL-CALL ${args.summary}`, 0, 0);
		},
		renderResult(result: { details?: { cells?: { status?: string }[] } }) {
			return new tui.Text(`EVAL-FULL-OUTPUT ${JSON.stringify(result.details?.cells?.[0]?.status)}`, 0, 0);
		},
	},
};
senpi.AgentSession.prototype.getToolDefinition = (name: string) => defs[name];
mock.module("@code-yeongyu/senpi", () => senpi);
mock.module("@earendil-works/pi-tui", () => tui);

type Handler = (event: unknown, ctx: unknown) => void;
type Harness = { im: Mod; notices: string[]; fire(event: string, payload: unknown): void };

/** A fresh extension copy (replacing the global implementation) plus a fresh stub InteractiveMode. */
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
	const im = Object.create(senpi.InteractiveMode.prototype);
	// Own data properties: some of these names are accessors on the prototype.
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
	};
	for (const [key, value] of Object.entries(fields)) {
		Object.defineProperty(im, key, { value, writable: true, configurable: true, enumerable: true });
	}
	return { im, notices, fire };
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

function render(h: Harness): { ansi: string[]; plain: string[] } {
	const ansi: string[] = h.im.chatContainer.render(150);
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
	expect(h.notices.filter((notice) => notice.includes("eval 묶음")).length).toBe(1);
});
