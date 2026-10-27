import { describe, expect, mock, test } from "bun:test";

class FakeTruncatedText {
	constructor(public text: string) {}
	render(width: number) {
		return [this.text.slice(0, width)];
	}
	invalidate() {}
}

class FakeContainer {
	children: unknown[] = [];
	revision = 0;
	render(width: number): string[] {
		return this.children.flatMap((child) => (child as { render(w: number): string[] }).render(width));
	}
	handleMouse() {
		return undefined;
	}
	bumpRenderRevision() {
		this.revision++;
	}
	childRenderRevision() {
		return this.revision;
	}
}

const defaultTui = {
	TruncatedText: FakeTruncatedText,
	Container: FakeContainer,
	truncateToWidth: (text: string, width: number) => text.slice(0, width),
};

type Call = { slot: string; args: unknown[] };

type HostOptions = { withMethod?: boolean; withAssistant?: boolean; withInteractive?: boolean; withProject?: boolean; withExpansion?: boolean };

function makeHost(options: HostOptions = {}) {
	const calls: Call[] = [];
	const record = (slot: string) => (...args: unknown[]) => {
		calls.push({ slot, args });
		return { original: slot };
	};
	const defs: Record<string, Record<string, unknown>> = {
		eval: { renderCall: record("eval.call"), renderResult: record("eval.result") },
		edit: { renderCall: record("edit.call"), renderResult: record("edit.result") },
		apply_patch: { renderCall: record("patch.call"), renderResult: record("patch.result") },
		todo: { renderCall: record("todo.call"), renderResult: record("todo.result") },
		read: { renderCall: record("read.call"), renderResult: record("read.result") },
		web_search: { renderCall: record("ws.call"), renderResult: record("ws.result") },
		memory: { renderCall: record("mem.call"), renderResult: record("mem.result"), renderShell: "self" },
		get_goal: { renderCall: record("goal.call"), renderResult: record("goal.result") },
		write: { renderCall: record("write.call"), renderResult: record("write.result") },
		look_at: { renderCall: record("look.call") },
		ask_user_question: { renderCall: record("ask.call"), renderResult: record("ask.result") },
	};
	class AgentSession {}
	if (options.withMethod !== false) {
		(AgentSession.prototype as Record<string, unknown>).getToolDefinition = function (name: string) {
			return defs[name];
		};
	}
	class AssistantMessageComponent {
		received: unknown;
		isStreaming = false;
		hasToolCalls = false;
		hiddenThinkingLabel = "Thinking...";
		isExplorationDetail = false;
		reconcileRenderDescriptors(descriptors: unknown) {
			this.received = descriptors;
		}
	}
	class FakeTranscript {
		children: unknown[] = [];
		display = {
			children: [] as unknown[],
			historyStart: 8,
			detachAll() {
				this.children = [];
				this.historyStart = 0;
			},
		};
		project() {
			return this.children;
		}
	}
	class NoProjectTranscript {
		children: unknown[] = [];
	}
	class InteractiveMode {
		toolOutputExpanded = false;
		chatContainer = options.withProject === false ? new NoProjectTranscript() : new FakeTranscript();
		setToolsExpanded(expanded: boolean) {
			this.toolOutputExpanded = expanded;
			return "native toggle";
		}
		createToolExecutionComponent() {
			return { created: true };
		}
	}
	if (options.withExpansion === false) {
		Object.defineProperty(InteractiveMode.prototype, "setToolsExpanded", { value: undefined });
	}
	return {
		AgentSession,
		calls,
		defs,
		AssistantMessageComponent,
		InteractiveMode,
		FakeTranscript,
		senpi: {
			AgentSession,
			AssistantMessageComponent: options.withAssistant === false ? undefined : AssistantMessageComponent,
			InteractiveMode: options.withInteractive === false ? undefined : InteractiveMode,
		},
	};
}

async function load(
	host: ReturnType<typeof makeHost>,
	tui: Record<string, unknown> = defaultTui,
	options: { throwingTheme?: boolean } = {},
) {
	mock.module("@code-yeongyu/senpi", () => host.senpi);
	mock.module("@earendil-works/pi-tui", () => tui);
	const notices: string[] = [];
	const handlers: Array<[string, (e: unknown, ctx: unknown) => void]> = [];
	const pi = { on: (event: string, handler: (e: unknown, ctx: unknown) => void) => handlers.push([event, handler]) };
	const mod = await import(`../extension/tool-fold.ts?case=${Math.random()}`);
	await mod.default(pi);
	const ui = { notify: (msg: string) => notices.push(msg) };
	if (options.throwingTheme) {
		Object.defineProperty(ui, "theme", {
			get() {
				throw new Error("theme gone");
			},
		});
	}
	const ctx = { ui };
	const fire = (event: string, payload: unknown) => {
		for (const [name, handler] of handlers) if (name === event) handler(payload, ctx);
	};
	fire("session_start", {});
	const session = new host.AgentSession() as { getToolDefinition(name: string): Record<string, (...a: unknown[]) => unknown> };
	return { session, notices, fire };
}

const IMPL = Symbol.for("omo.tool-fold.impl.v2");

const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
const okEval = { details: { cells: [{ status: "complete", language: "js", summary: "규칙 조사\n둘째 줄", code: "x" }] } };

describe("tool-fold", () => {
	test("collapsed eval result shows one line: tool + summary", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const out = session.getToolDefinition("eval").renderResult(okEval, { expanded: false }, theme, { args: {} });
		expect(out).toBeInstanceOf(FakeTruncatedText);
		expect((out as FakeTruncatedText).text).toBe("eval js ✓ 규칙 조사");
		expect(host.calls.length).toBe(0);
	});

	test("expanded (Ctrl+O) uses the original renderer", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const out = session.getToolDefinition("eval").renderResult(okEval, { expanded: true }, theme, { args: {} });
		expect(out).toEqual({ original: "eval.result" });
	});

	test("error, cancelled, and unknown future states fall back to the original", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const render = session.getToolDefinition("eval").renderResult;
		for (const status of ["error", "cancelled", "brand-new-status"]) {
			const result = { details: { cells: [{ status, language: "js", summary: "s" }] } };
			expect(render(result, {}, theme, {})).toEqual({ original: "eval.result" });
		}
		expect(render({ isError: true, details: okEval.details }, {}, theme, {})).toEqual({ original: "eval.result" });
	});

	test("a throwing plan (odd data shape) falls back to the original", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const hostile = { get details(): never { throw new Error("shape changed"); } };
		expect(session.getToolDefinition("eval").renderResult(hostile, {}, theme, {})).toEqual({ original: "eval.result" });
	});

	test("edit collapsed is one line with counts; Ctrl+O hands the original a clean lastComponent", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const edit = session.getToolDefinition("edit");
		const ctx = { cwd: "C:\\repo", args: { path: "C:\\repo\\src\\a.ts" } };
		const folded = edit.renderResult({ details: { diff: "--- a\n+++ b\n-old\n+new\n+more" } }, {}, theme, ctx);
		expect((folded as FakeTruncatedText).text).toBe("edit src/a.ts (+2/-1)");
		edit.renderResult({ details: {} }, { expanded: true }, theme, { ...ctx, expanded: true, lastComponent: folded });
		const forwarded = host.calls.at(-1)?.args[3] as { lastComponent?: unknown };
		expect(forwarded.lastComponent).toBeUndefined();
	});

	test("edit errors keep the original call and result", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const edit = session.getToolDefinition("edit");
		const ctx = { isError: true, hasResult: true, args: { path: "a.ts" } };
		expect(edit.renderCall({ path: "a.ts" }, theme, ctx)).toEqual({ original: "edit.call" });
		expect(edit.renderResult({ isError: true }, {}, theme, ctx)).toEqual({ original: "edit.result" });
	});

	test("apply_patch collapses actual preview totals for single and multiple files", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const patch = session.getToolDefinition("apply_patch");
		const ctx = { cwd: "C:/repo" };
		const file = { filePath: "C:/repo/a.ts", added: 2, removed: 1 };
		const result = { details: { preview: { files: [file], added: 2, removed: 1 } } };
		expect((patch.renderResult(result, {}, theme, ctx) as FakeTruncatedText).text).toBe("apply_patch a.ts (+2/-1)");
		const multi = { details: { preview: { files: [file, { filePath: "b.ts" }], added: 3, removed: 4 } } };
		expect((patch.renderResult(multi, {}, theme, ctx) as FakeTruncatedText).text).toBe("apply_patch 2 files (+3/-4)");
		expect((patch.renderResult(result, { isPartial: true }, theme, ctx) as FakeTruncatedText).text).toBe("apply_patch a.ts (+2/-1) …");
	});

	test("apply_patch call summarizes complete headers and hides after a folded result", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const patch = session.getToolDefinition("apply_patch");
		const args = { input: "*** Begin Patch\n*** Update File: C:/repo/a.ts\n@@\n-old\n+new\n*** Move to: b.ts\n*** Delete File: c.ts\n*** End Patch" };
		expect((patch.renderCall(args, theme, { cwd: "C:/repo" }) as FakeTruncatedText).text).toBe("apply_patch 2 files");
		expect((patch.renderCall(args, theme, { hasResult: true }) as FakeTruncatedText).render(80)).toEqual([]);
		expect(patch.renderCall({ input: "*** Begin Patch\n*** Update File:" }, theme, {})).toEqual({ original: "patch.call" });
	});

	test("apply_patch expanded, failed, partial-failed and unexpected results stay original", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const patch = session.getToolDefinition("apply_patch");
		const result = { details: { preview: { files: [{ filePath: "a.ts" }], added: 1, removed: 0 } } };
		const folded = patch.renderResult(result, {}, theme, {});
		expect(patch.renderResult(result, { expanded: true }, theme, { lastComponent: folded })).toEqual({ original: "patch.result" });
		expect((host.calls.at(-1)?.args[3] as { lastComponent?: unknown }).lastComponent).toBeUndefined();
		for (const bad of [
			{ ...result, isError: true },
			{ details: { ...result.details, result: { failures: [{ filePath: "b.ts" }] } } },
			{},
			{ details: { preview: { files: [], added: 0, removed: 0 } } },
			{ details: { preview: { files: [{ filePath: 4 }], added: 1, removed: 0 } } },
		]) {
			expect(patch.renderResult(bad, {}, theme, {})).toEqual({ original: "patch.result" });
		}
		expect(patch.renderResult(result, {}, theme, { isError: true })).toEqual({ original: "patch.result" });
	});

	test("todo collapsed keeps only its title line; expanded and errors use the original", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const todo = session.getToolDefinition("todo");
		const result = { details: { ask: { text: "긴 요청" }, phases: [1] } };
		expect((todo.renderResult(result, {}, theme, {}) as { render(w: number): string[] }).render(80)).toEqual([]);
		expect(todo.renderCall({ op: "done" }, theme, { hasResult: true })).toEqual({ original: "todo.call" });
		expect(todo.renderResult(result, { expanded: true }, theme, {})).toEqual({ original: "todo.result" });
		expect(todo.renderResult(result, {}, theme, { isError: true })).toEqual({ original: "todo.result" });
	});

	test("web_search collapses to tool + query, with a mark while partial", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const ws = session.getToolDefinition("web_search");
		const ctx = { args: { query: "bun webview\nsecond", allowed_domains: ["bun.sh"] } };
		expect((ws.renderResult({ details: {} }, {}, theme, ctx) as FakeTruncatedText).text).toBe("web_search bun webview");
		expect((ws.renderResult({ details: {} }, { isPartial: true }, theme, ctx) as FakeTruncatedText).text).toBe("web_search bun webview …");
		expect((ws.renderCall(ctx.args, theme, { hasResult: true }) as { render(w: number): string[] }).render(80)).toEqual([]);
		expect(ws.renderResult({ isError: true }, {}, theme, ctx)).toEqual({ original: "ws.result" });
		expect(ws.renderResult({ details: {} }, { expanded: true }, theme, ctx)).toEqual({ original: "ws.result" });
	});

	test("compact line picks a short verb plus the main target, path relative to cwd", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const ctx = { cwd: "C:/mem", args: { command: "insert", file_path: "C:/mem/notes/a.md", reason: "why" } };
		expect((session.getToolDefinition("memory").renderResult({}, {}, theme, ctx) as FakeTruncatedText).text).toBe("memory insert notes/a.md");
		expect((session.getToolDefinition("get_goal").renderResult({}, {}, theme, { args: {} }) as FakeTruncatedText).text).toBe("get_goal");
	});

	test("tools missing a renderer slot, and ask_user_question, stay untouched", async () => {
		const host = makeHost();
		const look = host.defs.look_at.renderCall;
		const ask = host.defs.ask_user_question.renderResult;
		const { session } = await load(host);
		expect(session.getToolDefinition("look_at").renderCall).toBe(look);
		expect(session.getToolDefinition("ask_user_question").renderResult).toBe(ask);
	});

	test("other tools are untouched", async () => {
		const host = makeHost();
		const original = host.defs.read.renderResult;
		const { session } = await load(host);
		expect(session.getToolDefinition("read").renderResult).toBe(original);
	});

	test("missing internal method: no patch, one notice, nothing throws", async () => {
		const host = makeHost({ withMethod: false });
		const { notices } = await load(host);
		expect(notices.length).toBe(1);
		expect(notices[0]).toContain("tool-fold 꺼짐");
	});

	test("missing TruncatedText: no patch, renderers stay original", async () => {
		const host = makeHost();
		const original = host.defs.eval.renderResult;
		const { session, notices } = await load(host, { TruncatedText: undefined });
		expect(session.getToolDefinition("eval").renderResult).toBe(original);
		expect(notices[0]).toContain("TruncatedText");
	});

	test("loading twice does not double-wrap", async () => {
		const host = makeHost();
		await load(host);
		const once = (host.AgentSession.prototype as Record<string, unknown>).getToolDefinition;
		await load(host);
		expect((host.AgentSession.prototype as Record<string, unknown>).getToolDefinition).toBe(once);
	});

	test("frozen definitions are returned unchanged", async () => {
		const host = makeHost();
		host.defs.eval = Object.freeze({ ...host.defs.eval });
		const { session } = await load(host);
		const def = session.getToolDefinition("eval");
		expect(def).toBe(host.defs.eval);
		expect(def.renderResult(okEval, {}, theme, {})).toEqual({ original: "eval.result" });
	});

	test("an older version's prototype mark does not block this version", async () => {
		const host = makeHost();
		(host.AgentSession.prototype as Record<PropertyKey, unknown>)[Symbol.for("omo.tool-fold.v1")] = true;
		const { session } = await load(host);
		const out = session.getToolDefinition("eval").renderResult(okEval, {}, theme, {});
		expect((out as FakeTruncatedText).text).toBe("eval js ✓ 규칙 조사");
	});

	test("a newer load takes over already-wrapped tools without a restart", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const evalDef = session.getToolDefinition("eval");
		const marker = { render: () => ["NEW"], invalidate() {} };
		const shared = globalThis as Record<PropertyKey, unknown>;
		const previous = shared[IMPL];
		shared[IMPL] = { planFor: () => ({ renderResult: () => ({ empty: true }) }), component: () => marker };
		try {
			expect(evalDef.renderResult(okEval, {}, theme, {})).toBe(marker);
		} finally {
			shared[IMPL] = previous;
		}
	});

	test("reload shutdown turns folding off; the next load turns it back on", async () => {
		const host = makeHost();
		const { session, fire } = await load(host);
		const evalDef = session.getToolDefinition("eval");
		fire("session_shutdown", { reason: "quit" });
		expect(evalDef.renderResult(okEval, {}, theme, {})).toBeInstanceOf(FakeTruncatedText);
		fire("session_shutdown", { reason: "reload" });
		expect(evalDef.renderResult(okEval, {}, theme, {})).toEqual({ original: "eval.result" });
		await load(host);
		expect(evalDef.renderResult(okEval, {}, theme, {})).toBeInstanceOf(FakeTruncatedText);
	});

	test("no theme object still renders plain text", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const out = session.getToolDefinition("eval").renderResult(okEval, {}, undefined, {});
		expect((out as FakeTruncatedText).text).toBe("eval js ✓ 규칙 조사");
	});
});

const S = { kind: "spacer", text: "" };
const L = { kind: "thinking-label", text: "Thought: 1ms", thinkingRun: 0 };

type Card = { presentationSnapshot: unknown; render(width: number): string[] };
type Grouped = { render(width: number): string[] };

function evalCard(definition: unknown, label: string, result: unknown = okEval, args: unknown = {}): Card {
	return toolCard("eval", definition, label, result, args);
}

function toolCard(
	toolName: string,
	definition: unknown,
	label: string,
	result: unknown,
	args: unknown,
	presentation = "classic",
	cwd?: string,
): Card {
	return {
		presentationSnapshot: {
			presentation,
			identity: { toolName, toolDefinition: definition, cwd },
			state: { args, result, isPartial: false, expanded: false },
		},
		render: () => [`CARD ${label}`],
	};
}

/** A fake CustomEntryComponent: the entry name plus the collapsed state Ctrl+O changes. */
class FakeNotice {
	_expanded: boolean;
	constructor(
		public entry: { type: "custom"; customType: string } | undefined,
		expanded = false,
		public message?: { role: "custom"; customType: string },
	) {
		this._expanded = expanded;
	}
	setExpanded(expanded: boolean) {
		this._expanded = expanded;
	}
	render() {
		return ["NOTICE"];
	}
}

function customEntry(customType: string, expanded = false): FakeNotice {
	return new FakeNotice({ type: "custom", customType }, expanded);
}

/** Creates an InteractiveMode whose transcript holds `cards`, and runs the real tool-card creation path once. */
function transcript(host: ReturnType<typeof makeHost>, cards: unknown[]) {
	const im = new host.InteractiveMode();
	im.chatContainer.children.push(...cards);
	const created = im.createToolExecutionComponent();
	return { im, created, project: () => (im.chatContainer as { project(): unknown[] }).project() };
}

describe("tool-fold thinking labels and eval blocks", () => {
	test("a full host loads with zero notices", async () => {
		const { notices } = await load(makeHost());
		expect(notices).toEqual([]);
	});

	test("a finished hidden thinking label reaches the original renderer as nothing", async () => {
		const host = makeHost();
		await load(host);
		const message = new host.AssistantMessageComponent();
		message.reconcileRenderDescriptors([S, L]);
		expect(message.received).toEqual([]);
	});

	test("after a reload shutdown the original receives the descriptors by reference", async () => {
		const host = makeHost();
		const { fire } = await load(host);
		fire("session_shutdown", { reason: "reload" });
		const message = new host.AssistantMessageComponent();
		const descriptors = [S, L];
		message.reconcileRenderDescriptors(descriptors);
		expect(message.received).toBe(descriptors);
	});

	test("hostile descriptors pass through to the original unchanged", async () => {
		const host = makeHost();
		await load(host);
		const hostile = new Proxy([S, L], {
			get(target, key, receiver) {
				if (typeof key === "string" && /^\d+$/.test(key)) throw new Error("shape changed");
				return Reflect.get(target, key, receiver);
			},
		});
		const message = new host.AssistantMessageComponent();
		message.reconcileRenderDescriptors(hostile);
		expect(message.received).toBe(hostile);
	});

	test("two folded eval cards project to one Ran 2 evals block", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const def = session.getToolDefinition("eval");
		const { project } = transcript(host, [evalCard(def, "a"), evalCard(def, "b")]);
		const out = project();
		expect(out.length).toBe(1);
		expect((out[0] as Grouped).render(80)).toEqual(["", "• Ran 2 evals", "  └ js ✓ 규칙 조사", "    js ✓ 규칙 조사"]);
	});

	test("folded eval, edit and write cards in a row project to one mixed block", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const cards = [
			evalCard(session.getToolDefinition("eval"), "a"),
			toolCard("edit", session.getToolDefinition("edit"), "e", { details: { diff: "+new" } }, { path: "a.ts" }),
			toolCard("write", session.getToolDefinition("write"), "w", { details: {} }, { path: "b.ts" }),
		];
		const out = transcript(host, cards).project();
		expect(out.length).toBe(1);
		expect((out[0] as Grouped).render(80)).toEqual([
			"",
			"• Ran 3 tools · eval 1 · edit 1 · write 1",
			"  └ eval js ✓ 규칙 조사",
			"    edit a.ts (+1/-0)",
			"    write b.ts",
		]);
	});

	test("a failed edit breaks the run and keeps its own card", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const edit = session.getToolDefinition("edit");
		const failed = toolCard("edit", edit, "err", { isError: true }, { path: "a.ts" });
		const ok = (label: string) => toolCard("edit", edit, label, { details: { diff: "+x" } }, { path: `${label}.ts` });
		const out = transcript(host, [ok("a"), failed, ok("b"), ok("c")]).project();
		expect(out.length).toBe(3);
		expect(out[1]).toBe(failed);
		expect((out[2] as Grouped).render(80)[1]).toBe("• Ran 2 tools · edit 2");
	});

	test("an unfolded tool (read) between folded cards breaks the run", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const read = toolCard("read", session.getToolDefinition("read"), "r", { details: {} }, { path: "a.ts" });
		const { im, project } = transcript(host, [evalCard(session.getToolDefinition("eval"), "a"), read, evalCard(session.getToolDefinition("eval"), "b")]);
		expect(project()).toBe(im.chatContainer.children);
	});

	test("projecting the same children array twice returns the same output array", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const def = session.getToolDefinition("eval");
		const { project } = transcript(host, [evalCard(def, "a"), evalCard(def, "b")]);
		expect(project()).toBe(project());
	});

	test("eval cards whose definition this extension did not wrap are not grouped", async () => {
		const host = makeHost();
		await load(host);
		const foreign = { renderCall() {}, renderResult() {} };
		const { im, project } = transcript(host, [evalCard(foreign, "a"), evalCard(foreign, "b")]);
		expect(project()).toBe(im.chatContainer.children);
	});

	test("a failed eval breaks the run and keeps its own card", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const def = session.getToolDefinition("eval");
		const first = evalCard(def, "a");
		const failed = evalCard(def, "err", { isError: true, details: okEval.details });
		const { project } = transcript(host, [first, failed, evalCard(def, "b"), evalCard(def, "c")]);
		const out = project();
		expect(out.length).toBe(3);
		expect(out[0]).toBe(first);
		expect(out[1]).toBe(failed);
		expect((out[2] as Grouped).render(80)[1]).toBe("• Ran 2 evals");
	});

	test("a peek control card between two runs breaks the run even without details.action", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const def = session.getToolDefinition("eval");
		const control = { details: { cells: [{ status: "complete", language: "js", summary: "규칙 조사" }] } };
		const peek = evalCard(def, "peek", control, { action: "peek", cell_id: "c1" });
		const { im, project } = transcript(host, [evalCard(def, "a"), peek, evalCard(def, "b")]);
		expect(project()).toBe(im.chatContainer.children);
	});

	test("a transcript without project() gives one late notice and cards are still created", async () => {
		const host = makeHost({ withProject: false });
		const { notices } = await load(host);
		const { created } = transcript(host, []);
		transcript(host, []);
		expect(created).toEqual({ created: true });
		expect(notices.length).toBe(1);
		expect(notices[0]).toContain("도구 묶음");
	});

	test("a host without InteractiveMode notices eval grouping off and still hides thinking", async () => {
		const host = makeHost({ withInteractive: false });
		const { notices } = await load(host);
		expect(notices.length).toBe(1);
		expect(notices[0]).toContain("도구 묶음");
		const message = new host.AssistantMessageComponent();
		message.reconcileRenderDescriptors([S, L]);
		expect(message.received).toEqual([]);
	});

	test("a host without AssistantMessageComponent notices thinking hiding off", async () => {
		const { notices } = await load(makeHost({ withAssistant: false }));
		expect(notices.length).toBe(1);
		expect(notices[0]).toContain("사고 줄 숨김");
	});

	test("loading twice does not double-wrap the thinking, card and projection hooks", async () => {
		const host = makeHost();
		const amc = host.AssistantMessageComponent.prototype as unknown as Record<string, unknown>;
		const imp = host.InteractiveMode.prototype as unknown as Record<string, unknown>;
		const transcriptProto = host.FakeTranscript.prototype as unknown as Record<string, unknown>;
		await load(host);
		transcript(host, []);
		const once = [amc.reconcileRenderDescriptors, imp.createToolExecutionComponent, transcriptProto.project];
		await load(host);
		transcript(host, []);
		expect(amc.reconcileRenderDescriptors).toBe(once[0]);
		expect(imp.createToolExecutionComponent).toBe(once[1]);
		expect(transcriptProto.project).toBe(once[2]);
	});

	test("a throwing theme makes the block render its member cards and gives one notice", async () => {
		const host = makeHost();
		const { session, notices } = await load(host, defaultTui, { throwingTheme: true });
		const def = session.getToolDefinition("eval");
		const { project } = transcript(host, [evalCard(def, "a"), evalCard(def, "b")]);
		const group = project()[0] as Grouped;
		expect(group.render(80)).toEqual(["CARD a", "CARD b"]);
		expect(group.render(80)).toEqual(["CARD a", "CARD b"]);
		// The notice is queued: a render pass must not notify from inside the frame.
		expect(notices).toEqual([]);
		await Promise.resolve();
		expect(notices.length).toBe(1);
		expect(notices[0]).toContain("도구 묶음");
	});

	test("with the core fold off, marked eval cards are projected unchanged", async () => {
		const host = makeHost();
		const { session } = await load(host, { TruncatedText: undefined });
		const marked = { ...session.getToolDefinition("eval") };
		(marked as Record<PropertyKey, unknown>)[Symbol.for("omo.tool-fold.wrapped.v2")] = true;
		const { im, project } = transcript(host, [evalCard(marked, "a"), evalCard(marked, "b")]);
		expect(project()).toBe(im.chatContainer.children);
	});
});

describe("grouping eligibility", () => {
	const textResult = () => ({ details: {}, content: [{ type: "text", text: "ok" }] });

	test("non-eval lines use the card cwd without changing membership order", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const write = session.getToolDefinition("write");
		const cwd = "C:/work/project";
		const first = toolCard("write", write, "a", textResult(), { path: "C:/work/project/a.ts" }, "classic", cwd);
		const second = toolCard("write", write, "b", textResult(), { path: "C:/work/project/b.ts" }, "classic", cwd);
		const out = transcript(host, [first, second]).project();
		expect(out.length).toBe(1);
		const lines = (out[0] as Grouped).render(80);
		expect(lines).toContain("  └ write a.ts");
		expect(lines).toContain("    write b.ts");
		expect(lines.indexOf("  └ write a.ts")).toBeLessThan(lines.indexOf("    write b.ts"));
		expect(lines.join("\n")).not.toContain("C:/work/project");
	});

	test("eval controls stay native in the call, result and member paths", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const def = session.getToolDefinition("eval");
		for (const action of ["peek", "stop", "list", "brand-new-action"]) {
			expect(def.renderCall({ action, summary: "s" }, theme, {})).toEqual({ original: "eval.call" });
			expect(def.renderResult(okEval, {}, theme, { args: { action } })).toEqual({ original: "eval.result" });
			const first = evalCard(def, "a");
			const control = evalCard(def, `control ${action}`, okEval, { action });
			const { project } = transcript(host, [first, control, evalCard(def, "b"), evalCard(def, "c")]);
			const out = project();
			expect(out.length).toBe(3);
			expect(out[0]).toBe(first);
			expect(out[1]).toBe(control);
		}
		expect(def.renderCall({ action: "run", summary: "s" }, theme, {})).toBeInstanceOf(FakeTruncatedText);
		expect(def.renderResult(okEval, {}, theme, { args: { action: "run" } })).toBeInstanceOf(FakeTruncatedText);
		expect(def.renderResult(okEval, {}, theme, { args: {} })).toBeInstanceOf(FakeTruncatedText);
	});

	test("cancelled, unknown, mixed and details-error eval results stay outside groups", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const def = session.getToolDefinition("eval");
		const cases: { label: string; result: unknown }[] = [
			{ label: "cancelled", result: { details: { cells: [{ status: "cancelled", language: "js", summary: "s" }] } } },
			{ label: "unknown", result: { details: { cells: [{ status: "brand-new-status", language: "js", summary: "s" }] } } },
			{
				label: "mixed",
				result: {
					details: {
						cells: [
							{ status: "complete", language: "js", summary: "s" },
							{ status: "error", language: "js", summary: "e" },
						],
					},
				},
			},
			{ label: "details-error", result: { details: { ...okEval.details, isError: true } } },
		];
		for (const { label, result } of cases) {
			const unsafe = evalCard(def, label, result);
			const { project } = transcript(host, [evalCard(def, "a"), unsafe, evalCard(def, "b"), evalCard(def, "c")]);
			const out = project();
			expect(out.length).toBe(3);
			expect(out[1]).toBe(unsafe);
			expect((out[2] as Grouped).render(80)[1]).toBe("• Ran 2 evals");
		}
		const direct = def.renderResult({ details: { ...okEval.details, isError: true } }, {}, theme, {});
		expect(direct).toEqual({ original: "eval.result" });
	});

	test("malformed and image content cards stay outside groups without mutation", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const write = session.getToolDefinition("write");
		const cwd = "C:/work/project";
		const image = { type: "image", data: "abc", mimeType: "image/png" };
		const cases: { label: string; result: { details: Record<string, unknown>; content?: unknown } }[] = [
			{ label: "image", result: { details: {}, content: [image] } },
			{ label: "non-array", result: { details: {}, content: "plain" } },
			{ label: "unknown-block", result: { details: {}, content: [{ type: "audio", data: "x" }] } },
			{ label: "malformed-text", result: { details: {}, content: [{ type: "text" }] } },
			{ label: "details-error", result: { details: { isError: true }, content: [{ type: "text", text: "x" }] } },
		];
		for (const { label, result } of cases) {
			const before = structuredClone(result);
			const unsafe = toolCard("write", write, label, result, { path: "C:/work/project/x.ts" }, "classic", cwd);
			const first = toolCard("write", write, `${label} a`, textResult(), { path: "C:/work/project/a.ts" }, "classic", cwd);
			const third = toolCard("write", write, `${label} b`, textResult(), { path: "C:/work/project/b.ts" }, "classic", cwd);
			const fourth = toolCard("write", write, `${label} c`, textResult(), { path: "C:/work/project/c.ts" }, "classic", cwd);
			const source = [first, unsafe, third, fourth];
			const sourceBefore = [...source];
			const out = transcript(host, source).project();
			expect(out.length).toBe(3);
			expect(out[1]).toBe(unsafe);
			expect(out[0]).toBe(first);
			expect(out[2]).toBeInstanceOf(FakeContainer);
			expect(source).toEqual(sourceBefore);
			expect(result).toEqual(before);
			if (label === "image") expect((result.content as unknown[])[0]).toBe(image);
		}
		expect(write.renderResult({ details: {} }, {}, theme, { isError: true })).toEqual({ original: "write.result" });
	});

	test("grok presentation and kill_bash cards never join a group", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const evalDef = session.getToolDefinition("eval");
		const grok = [
			toolCard("eval", evalDef, "grok a", okEval, {}, "grok"),
			toolCard("eval", evalDef, "grok b", okEval, {}, "grok"),
		];
		const grokOut = transcript(host, grok);
		expect(grokOut.project()).toBe(grokOut.im.chatContainer.children);

		const kill = [
			toolCard("kill_bash", {}, "grok kill a", { details: {} }, { bash_id: "b1" }, "grok"),
			toolCard("kill_bash", {}, "grok kill b", { details: {} }, { bash_id: "b2" }, "grok"),
		];
		const killOut = transcript(host, kill);
		expect(killOut.project()).toBe(killOut.im.chatContainer.children);

		const write = session.getToolDefinition("write");
		const barrier = toolCard("kill_bash", {}, "kill", { details: {} }, { bash_id: "b1" });
		const classic = transcript(host, [
			toolCard("write", write, "a", textResult(), { path: "a.ts" }),
			barrier,
			toolCard("write", write, "b", textResult(), { path: "b.ts" }),
		]);
		const out = classic.project();
		expect(out.length).toBe(3);
		expect(out[1]).toBe(barrier);
	});

	test("terminal escape and control sequences never reach grouped lines", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const write = session.getToolDefinition("write");
		const cwd = "C:/work/project";
		const cards = [
			toolCard("write", write, "a", textResult(), { path: "C:/work/project/\u001b[31ma.ts\u001b[0m" }, "classic", cwd),
			toolCard("write", write, "b", textResult(), { path: "C:/work/project/\u001b]0;pwned\u0007b.ts" }, "classic", cwd),
		];
		const out = transcript(host, cards).project();
		const rendered = (out[0] as Grouped).render(80).join("\n");
		expect(rendered).toContain("write a.ts");
		expect(rendered).toContain("write b.ts");
		expect(rendered).not.toMatch(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/);

		const ws = session.getToolDefinition("web_search");
		const query = "\u001b]0;pwned\u0007hello\u001b[2J";
		const wsOut = transcript(host, [
			toolCard("web_search", ws, "ws a", { details: {} }, { query }),
			toolCard("web_search", ws, "ws b", { details: {} }, { query }),
		]).project();
		const text = (wsOut[0] as Grouped).render(80)[2];
		expect(text).toBe("  └ web_search hello");
		expect(text).not.toMatch(/[\u001B\u0007]/);
	});
});

describe("tool-fold history window", () => {
	test("expansion resets only the non-owning display and preserves native return and source children", async () => {
		const host = makeHost();
		await load(host);
		const im = new host.InteractiveMode();
		const chat = im.chatContainer as InstanceType<typeof host.FakeTranscript>;
		const card = { render: () => ["original"], dispose: () => { throw new Error("must not dispose"); } };
		chat.children.push(card);
		chat.display.children.push(card);
		expect(im.setToolsExpanded(true)).toBe("native toggle");
		expect(chat.children).toEqual([card]);
		expect(chat.display.historyStart).toBe(0);
		expect(chat.display.children).toEqual([]);
		chat.display.historyStart = 5;
		im.setToolsExpanded(true);
		expect(chat.display.historyStart).toBe(5);
		im.setToolsExpanded(false);
		expect(chat.display.historyStart).toBe(0);
	});

	test("reload disables display reset and a fresh load reuses the same hook", async () => {
		const host = makeHost();
		const { fire } = await load(host);
		const wrapper = host.InteractiveMode.prototype.setToolsExpanded;
		const im = new host.InteractiveMode();
		const chat = im.chatContainer as InstanceType<typeof host.FakeTranscript>;
		fire("session_shutdown", { reason: "reload" });
		im.setToolsExpanded(true);
		expect(chat.display.historyStart).toBe(8);
		await load(host);
		expect(host.InteractiveMode.prototype.setToolsExpanded).toBe(wrapper);
		im.setToolsExpanded(false);
		expect(chat.display.historyStart).toBe(0);
	});

	test("a missing expansion method warns without disabling ordinary folding", async () => {
		const host = makeHost({ withExpansion: false });
		const { notices, session } = await load(host);
		expect(notices).toHaveLength(1);
		expect(notices[0]).toContain("setToolsExpanded");
		const folded = session.getToolDefinition("eval").renderResult(okEval, {}, undefined, {});
		expect(folded).toBeInstanceOf(FakeTruncatedText);
	});

	for (const failure of ["missing", "throwing", "owning"]) {
		test(`${failure} display seam preserves the native toggle and warns once`, async () => {
			const host = makeHost();
			const { notices } = await load(host);
			const im = new host.InteractiveMode();
			const chat = im.chatContainer as InstanceType<typeof host.FakeTranscript>;
			const source = chat.children;
			if (failure === "missing") Object.defineProperty(chat, "display", { value: {} });
			if (failure === "throwing") chat.display.detachAll = () => { throw new Error("changed seam"); };
			if (failure === "owning") Object.defineProperty(chat, "display", { value: chat });
			expect(im.setToolsExpanded(true)).toBe("native toggle");
			expect(im.setToolsExpanded(false)).toBe("native toggle");
			expect(chat.children).toBe(source);
			expect(notices).toHaveLength(1);
		});
	}
});

describe("collapsed notice hiding", () => {
	test("a Kibitzer nudge is hidden while collapsed and shown unchanged on Ctrl+O", async () => {
		const host = makeHost();
		await load(host);
		const nudge = customEntry("omo-kibitzer:nudged");
		const { im, project } = transcript(host, [nudge]);
		expect(project()).toEqual([]);
		expect(im.chatContainer.children).toEqual([nudge]);
		nudge.setExpanded(true);
		expect(project()).toEqual([nudge]);
		nudge.setExpanded(false);
		expect(project()).toEqual([]);
	});

	test("goal cache-warm wait and wake notices are hidden", async () => {
		const host = makeHost();
		await load(host);
		const wait = customEntry("goal-cache-warmup");
		const wake = customEntry("goal-cache-warmup");
		const { project } = transcript(host, [wait, wake]);
		expect(project()).toEqual([]);
	});

	test("cache-miss and unrelated custom notices stay visible", async () => {
		const host = makeHost();
		await load(host);
		const cacheMiss = { kind: "text", text: "Cache miss: 1234 tokens re-billed" };
		const unrelatedEntry = customEntry("some-other-notice");
		const unrelatedMessage = new FakeNotice(undefined, false, { role: "custom", customType: "omo-kibitzer:recall" });
		const { im, project } = transcript(host, [cacheMiss, unrelatedEntry, unrelatedMessage]);
		expect(project()).toBe(im.chatContainer.children);
	});

	test("a hidden notice between two folded evals does not break the block", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const def = session.getToolDefinition("eval");
		const { project } = transcript(host, [evalCard(def, "a"), customEntry("omo-kibitzer:nudged"), evalCard(def, "b")]);
		const out = project();
		expect(out.length).toBe(1);
		expect((out[0] as Grouped).render(80)).toEqual(["", "• Ran 2 evals", "  └ js ✓ 규칙 조사", "    js ✓ 규칙 조사"]);
	});

	test("missing or hostile notice fields leave the projection unchanged", async () => {
		const host = makeHost();
		await load(host);
		const missingState = { entry: { type: "custom", customType: "omo-kibitzer:nudged" }, setExpanded() {} };
		const missingEntry = { _expanded: false, setExpanded() {} };
		const hostile = {
			_expanded: false,
			setExpanded() {},
			get entry(): never {
				throw new Error("shape changed");
			},
		};
		const { im, project } = transcript(host, [missingState, missingEntry, hostile]);
		expect(project()).toBe(im.chatContainer.children);
	});
});
