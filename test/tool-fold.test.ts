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

/** C0 controls, DEL and C1 controls must never reach a rendered group line. */
function hasControlCharacters(text: string): boolean {
	for (const character of text) {
		const code = character.codePointAt(0) ?? 0;
		if (code === 0x09 || code === 0x0a || code === 0x0d) continue;
		if (code < 0x20 || (code >= 0x7f && code <= 0x9f)) return true;
	}
	return false;
}

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

	test("task status failures and unknown states stay native while active and completed statuses group", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const def = session.getToolDefinition("eval");
		host.defs.task_output = { renderCall: () => ({}), renderResult: () => ({}) };
		const task = session.getToolDefinition("task_output");
		const taskResult = (status: string) => ({
			details: { snapshot: { status } },
			content: [{ type: "text", text: "received" }],
		});
		for (const status of ["failed", "blocked", "cancelled", "lost", "error", "interrupted", "brand-new-status"]) {
			const unsafe = toolCard("task_output", task, status, taskResult(status), { task_id: "t1" });
			const out = transcript(host, [evalCard(def, `a-${status}`), unsafe, evalCard(def, `b-${status}`)]).project();
			expect(out.length).toBe(3);
			expect(out[1]).toBe(unsafe);
		}
		const grouped = transcript(host, [
			evalCard(def, "a"),
			toolCard("task_output", task, "running", taskResult("running"), { task_id: "t1" }),
			toolCard("task_output", task, "completed", taskResult("completed"), { task_id: "t2" }),
			evalCard(def, "b"),
		]).project();
		expect(grouped.length).toBe(1);
		expect((grouped[0] as Grouped).render(80).join("\n")).toContain("task_output");
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

		host.defs.kill_bash = { execute: mock(() => undefined) };
		const killDef = session.getToolDefinition("kill_bash");
		const kill = [
			toolCard("kill_bash", killDef, "grok kill a", textResult(), { bash_id: "b1" }, "grok"),
			toolCard("kill_bash", killDef, "grok kill b", textResult(), { bash_id: "b2" }, "grok"),
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
		expect(hasControlCharacters(rendered)).toBe(false);

		const ws = session.getToolDefinition("web_search");
		const query = "\u001b]0;pwned\u0007hello\u001b[2J";
		const wsOut = transcript(host, [
			toolCard("web_search", ws, "ws a", { details: {} }, { query }),
			toolCard("web_search", ws, "ws b", { details: {} }, { query }),
		]).project();
		const text = (wsOut[0] as Grouped).render(80)[2];
		expect(text).toBe("  └ web_search hello");
		expect(hasControlCharacters(text)).toBe(false);
	});
});

describe("todo grouping", () => {
	const phases = [
		{ name: "Setup", tasks: [{ content: "Write tests", status: "completed" }, { content: "Ship it", status: "pending" }] },
		{ name: "Review", tasks: [{ content: "Read diff", status: "pending" }] },
	];
	const todoResult = (op: string, value: unknown = phases) => ({
		details: { op, phases: value },
		content: [{ type: "text", text: "original checklist\nbody" }],
	});

	test("eval, todo done and eval form one ordered mixed block", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const evalDef = session.getToolDefinition("eval");
		const todo = session.getToolDefinition("todo");
		const done = toolCard("todo", todo, "done", todoResult("done"), { op: "done", task: "Ship it" });
		const out = transcript(host, [evalCard(evalDef, "a"), done, evalCard(evalDef, "b")]).project();
		expect(out.length).toBe(1);
		expect((out[0] as Grouped).render(80)).toEqual([
			"",
			"• Ran 3 tools · eval 2 · todo 1",
			"  └ eval js ✓ 규칙 조사",
			"    todo done: Ship it",
			"    eval js ✓ 규칙 조사",
		]);
	});

	test("two consecutive todos form one block with native titles", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const todo = session.getToolDefinition("todo");
		const init = toolCard("todo", todo, "init", todoResult("init"), { op: "init", list: phases });
		const append = toolCard("todo", todo, "append", todoResult("append"), {
			op: "append",
			phase: "Build",
			items: ["one", "two"],
		});
		const out = transcript(host, [init, append]).project();
		expect(out.length).toBe(1);
		expect((out[0] as Grouped).render(80)).toEqual([
			"",
			"• Ran 2 tools · todo 2",
			"  └ todo init (2 phases, 3 tasks)",
			"    todo append: Build (2 items)",
		]);
	});

	test("init counts its phased list and flat items before a result", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const todo = session.getToolDefinition("todo");
		const phased = toolCard("todo", todo, "phased", undefined, {
			op: "init",
			list: [{ phase: "Setup", items: ["a", "b"] }, { phase: "Review", items: ["c"] }],
		});
		const flat = toolCard("todo", todo, "flat", undefined, { op: "init", items: ["only"] });
		const lines = (transcript(host, [phased, flat]).project()[0] as Grouped).render(80);
		expect(lines).toContain("  └ todo init (2 phases, 3 tasks)");
		expect(lines).toContain("    todo init (1 phase, 1 task)");
		expect(lines[1]).toContain("Running 2 tools · todo 2");
	});

	test("init totals come from details.phases and details.op wins after a result", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const todo = session.getToolDefinition("todo");
		const onePhase = [{ name: "Only", tasks: [{ content: "a", status: "pending" }, { content: "b", status: "pending" }] }];
		const counted = toolCard("todo", todo, "init", todoResult("init", onePhase), { op: "init", list: phases });
		const normalized = toolCard("todo", todo, "view", todoResult("view"), { op: "done", task: "Ignored" });
		const lines = (transcript(host, [counted, normalized]).project()[0] as Grouped).render(80);
		expect(lines).toContain("  └ todo init (1 phase, 2 tasks)");
		expect(lines).toContain("    todo view");
		expect(lines.join("\n")).not.toContain("todo done");
	});

	test("append, rm, phase and missing-target forms mirror native titles", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const todo = session.getToolDefinition("todo");
		const cards = [
			toolCard("todo", todo, "append", undefined, { op: "append", phase: "Build", items: ["a", "b"] }),
			toolCard("todo", todo, "rm-task", undefined, { op: "rm", task: "Old task" }),
			toolCard("todo", todo, "rm-all", undefined, { op: "rm" }),
			toolCard("todo", todo, "rm-phase", undefined, { op: "rm", phase: "Setup" }),
			toolCard("todo", todo, "start", undefined, { op: "start", task: "Ship it" }),
			toolCard("todo", todo, "drop", undefined, { op: "drop", phase: "Setup" }),
			toolCard("todo", todo, "done", undefined, { op: "done" }),
		];
		const lines = (transcript(host, cards).project()[0] as Grouped).render(80);
		expect(lines).toContain("  └ todo append: Build (2 items)");
		expect(lines).toContain("    todo rm: Old task");
		expect(lines).toContain("    todo rm: all");
		expect(lines).toContain("    todo rm: Setup");
		expect(lines).toContain("    todo start: Ship it");
		expect(lines).toContain("    todo drop: Setup");
		expect(lines).toContain("    todo done: (missing target)");
	});

	test("failed todo, unknown op and malformed targets stay native", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const evalDef = session.getToolDefinition("eval");
		const todo = session.getToolDefinition("todo");
		const cases: { label: string; result: unknown; args: unknown }[] = [
			{ label: "failed", result: { isError: true, ...todoResult("done") }, args: { op: "done", task: "Ship it" } },
			{
				label: "details-error",
				result: { details: { op: "done", phases, isError: true } },
				args: { op: "done", task: "Ship it" },
			},
			{ label: "unknown-call", result: undefined, args: { op: "brand-new-op" } },
			{ label: "unknown-result", result: todoResult("brand-new-op"), args: { op: "done", task: "Ship it" } },
			{ label: "missing-result-op", result: { details: { phases } }, args: { op: "done", task: "Ship it" } },
			{ label: "malformed-target", result: todoResult("done"), args: { op: "done", task: 42 } },
			{ label: "malformed-phases", result: todoResult("init", "nope"), args: { op: "init", list: phases } },
		];
		for (const { label, result, args } of cases) {
			const unsafe = toolCard("todo", todo, label, result, args);
			const out = transcript(host, [evalCard(evalDef, "a"), unsafe, evalCard(evalDef, "b"), evalCard(evalDef, "c")]).project();
			expect(out.length).toBe(3);
			expect(out[1]).toBe(unsafe);
			expect((out[2] as Grouped).render(80)[1]).toBe("• Ran 2 evals");
		}
	});

	test("expanding a todo group shows the original checklist card, not the generated title", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const evalDef = session.getToolDefinition("eval");
		const todo = session.getToolDefinition("todo");
		const result = todoResult("done");
		expect(todo.renderResult(result, { expanded: true }, theme, {})).toEqual({ original: "todo.result" });
		const card = toolCard("todo", todo, "done", result, { op: "done", task: "Ship it" });
		(card.presentationSnapshot as { state: { expanded: boolean } }).state.expanded = true;
		const out = transcript(host, [evalCard(evalDef, "a"), card, evalCard(evalDef, "b")]).project();
		const lines = (out[0] as Grouped).render(80);
		expect(lines.slice(2)).toEqual(["CARD a", "CARD done", "CARD b"]);
		expect(lines.join("\n")).not.toContain("todo done: Ship it");
	});

	test("todo target text drops terminal escapes and collapses newlines", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const todo = session.getToolDefinition("todo");
		const cards = [
			toolCard("todo", todo, "escape", undefined, { op: "done", task: "\u001b[31mShip\u001b[0m\u001b]0;pwned\u0007 it" }),
			toolCard("todo", todo, "lines", undefined, { op: "start", task: "line one\nline two" }),
		];
		const lines = (transcript(host, cards).project()[0] as Grouped).render(80);
		expect(lines).toContain("  └ todo done: Ship it");
		expect(lines).toContain("    todo start: line one line two");
		const rendered = lines.join("\n");
		expect(rendered).not.toContain("\u001b");
		expect(rendered).not.toContain("\u0007");
		expect(rendered).not.toContain("\u0000");
	});
});

describe("default control grouping", () => {
	type ControlDef = {
		execute: ReturnType<typeof mock>;
		renderCall?: (...args: unknown[]) => unknown;
		renderResult?: (...args: unknown[]) => unknown;
	};
	const textResult = (text: string) => ({ content: [{ type: "text", text }] });
	const detailsResult = (details: Record<string, unknown>) => ({ details, content: [{ type: "text", text: "received" }] });
	const poolId = `wp_${"a".repeat(32)}`;
	const install = (host: ReturnType<typeof makeHost>, name: string, definition: ControlDef) => {
		host.defs[name] = definition;
		return definition;
	};
	const controlDefs = (host: ReturnType<typeof makeHost>) => {
		const monitorCall = (...args: unknown[]) => ({ original: "monitor.call", args });
		return {
			kill_bash: install(host, "kill_bash", { execute: mock(() => undefined) }),
			monitor: install(host, "monitor", { renderCall: monitorCall, execute: mock(() => undefined) }),
			schedule_wakeup: install(host, "schedule_wakeup", { execute: mock(() => undefined) }),
			schedule_prompt: install(host, "schedule_prompt", { execute: mock(() => undefined) }),
			workflow: install(host, "workflow", { execute: mock(() => undefined) }),
			workpool: install(host, "workpool", { execute: mock(() => undefined) }),
			monitorCall,
		};
	};
	const workflowSnapshot = (overrides: Record<string, unknown> = {}) => ({
		kind: "snapshot",
		run_id: "run_1",
		snapshot: {
			status: "running",
			counts: { total: 2, completed: 1, failed: 0, cancelled: 0, skipped: 0 },
			nodes: [
				{ id: "a", state: "completed" },
				{ id: "b", state: "running" },
			],
			...overrides,
		},
	});

	test("each valid projection control joins a run with its target and installs no slots", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const defs = controlDefs(host);
		const evalDef = session.getToolDefinition("eval");
		const before = {
			kill: session.getToolDefinition("kill_bash"),
			monitor: session.getToolDefinition("monitor"),
			wake: session.getToolDefinition("schedule_wakeup"),
			prompt: session.getToolDefinition("schedule_prompt"),
			workflow: session.getToolDefinition("workflow"),
			workpool: session.getToolDefinition("workpool"),
		};
		for (const [name, def] of Object.entries(before)) {
			const slots = def as Record<string, unknown>;
			expect("renderResult" in slots).toBe(false);
			if (name === "monitor") expect(slots.renderCall).toBe(defs.monitorCall);
			else expect("renderCall" in slots).toBe(false);
		}
		for (const def of Object.values(defs)) if (typeof def === "object" && "execute" in def) def.execute.mockClear();

		const cards = [
			evalCard(evalDef, "a"),
			toolCard("kill_bash", before.kill, "kill", textResult("Killed b1."), { bash_id: "b1" }),
			toolCard(
				"monitor",
				before.monitor,
				"monitor",
				detailsResult({ monitor: true, monitor_id: "mon_1", bash_id: "bash_1" }),
				{ description: "deploy log" },
			),
			toolCard(
				"schedule_wakeup",
				before.wake,
				"wake",
				detailsResult({ action: "scheduled", delaySeconds: 60, clamped: true, reason: "check deploy" }),
				{ delaySeconds: 1, reason: "check deploy" },
			),
			toolCard(
				"schedule_prompt",
				before.prompt,
				"prompt",
				detailsResult({
					action: "create",
					jobs: [{ state: "pending", job: { id: "sch_1", dueAt: "2026-10-27T18:00:00Z" } }],
					runnerAvailable: false,
				}),
				{ action: "create", prompt: "later" },
			),
			toolCard("workflow", before.workflow, "flow", detailsResult(workflowSnapshot()), { action: "snapshot", run_id: "run_1" }),
			toolCard(
				"workpool",
				before.workpool,
				"pool",
				detailsResult({ pool_id: poolId, name: "build", status: "closing", items: [{ item_id: "wi_1", status: "queued" }] }),
				{ op: "inspect", pool_id: poolId },
			),
			evalCard(evalDef, "b"),
		];
		const out = transcript(host, cards).project();
		expect(out.length).toBe(1);
		const lines = (out[0] as Grouped).render(80);
		const joined = lines.join("\n");
		expect(joined).toContain("kill_bash b1: Killed b1.");
		expect(joined).toContain("monitor armed mon_1 · deploy log");
		expect(joined).toContain("schedule_wakeup scheduled 60s clamped: check deploy");
		expect(joined).toContain("schedule_prompt no-runner create 1 pending job");
		expect(joined).toContain("workflow snapshot run_1 snapshot running");
		expect(joined).toContain(`workpool inspect build closing · 1 item`);
		expect(joined).not.toContain("1s");
		for (const name of ["kill_bash", "monitor", "schedule_wakeup", "schedule_prompt", "workflow", "workpool"] as const) {
			defs[name].execute.mockClear();
		}
		expect(host.calls.length).toBe(0);
		for (const name of ["kill_bash", "monitor", "schedule_wakeup", "schedule_prompt", "workflow", "workpool"] as const) {
			expect(defs[name].execute.mock.calls.length).toBe(0);
		}
	});

	test("a stopped wakeup receipt settles while a scheduled one stays running", async () => {
		const host = makeHost();
		const { session } = await load(host);
		install(host, "schedule_wakeup", { execute: mock(() => undefined) });
		const wake = session.getToolDefinition("schedule_wakeup");
		const evalDef = session.getToolDefinition("eval");
		const stopped = toolCard(
			"schedule_wakeup",
			wake,
			"stopped",
			detailsResult({ action: "stopped", reason: "deploy finished" }),
			{ stop: true, reason: "deploy finished" },
		);
		const stoppedLines = (transcript(host, [evalCard(evalDef, "a"), stopped]).project()[0] as Grouped).render(80);
		expect(stoppedLines[1]).toContain("Ran 2 tools");
		expect(stoppedLines.join("\n")).toContain("schedule_wakeup stopped: deploy finished");

		const scheduled = toolCard(
			"schedule_wakeup",
			wake,
			"scheduled",
			detailsResult({ action: "scheduled", delaySeconds: 60, reason: "check deploy" }),
			{ delaySeconds: 60, reason: "check deploy" },
		);
		const scheduledLines = (transcript(host, [evalCard(evalDef, "b"), scheduled]).project()[0] as Grouped).render(80);
		expect(scheduledLines[1]).toContain("Running 2 tools");
	});

	test("a lone projection card stays the same object with its native view", async () => {
		const host = makeHost();
		const { session } = await load(host);
		install(host, "kill_bash", { execute: mock(() => undefined) });
		const def = session.getToolDefinition("kill_bash");
		const card = toolCard("kill_bash", def, "only", textResult("Killed b1."), { bash_id: "b1" });
		const { im, project } = transcript(host, [card]);
		const out = project();
		expect(out).toBe(im.chatContainer.children);
		expect(out[0]).toBe(card);
	});

	test("armed, queued and closing labels stay distinguishable from complete", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const defs = controlDefs(host);
		const monitor = session.getToolDefinition("monitor");
		const prompt = session.getToolDefinition("schedule_prompt");
		const pool = session.getToolDefinition("workpool");
		const flow = session.getToolDefinition("workflow");
		const cards = [
			toolCard("monitor", monitor, "m", detailsResult({ monitor: true, monitor_id: "mon_2" }), { description: "watch" }),
			toolCard(
				"schedule_prompt",
				prompt,
				"p",
				detailsResult({ action: "create", jobs: [{ state: "pending", job: { id: "sch_2" } }], runnerAvailable: true }),
				{ action: "create" },
			),
			toolCard(
				"workpool",
				pool,
				"w",
				detailsResult({ pool_id: poolId, status: "closing", items: [{ item_id: "wi_2", status: "queued" }] }),
				{ op: "close", pool_id: poolId },
			),
			toolCard("workflow", flow, "f", detailsResult(workflowSnapshot()), { action: "snapshot", run_id: "run_1" }),
		];
		const joined = (transcript(host, cards).project()[0] as Grouped).render(80).join("\n");
		expect(joined).toContain("monitor armed mon_2");
		expect(joined).toContain("1 pending job");
		expect(joined).toContain("closing");
		expect(joined).toContain("workflow snapshot run_1 snapshot running");
		expect(joined).not.toContain("complete");
		for (const def of Object.values(defs)) if (typeof def === "object" && "execute" in def) def.execute.mockClear();
	});

	test("schedule_prompt cancel flags in-flight delivery", async () => {
		const host = makeHost();
		const { session } = await load(host);
		install(host, "schedule_prompt", { execute: mock(() => undefined) });
		const def = session.getToolDefinition("schedule_prompt");
		const card = toolCard(
			"schedule_prompt",
			def,
			"cancel",
			detailsResult({ action: "cancel", jobs: [{ state: "pending", job: { id: "sch_3" } }], inFlight: true }),
			{ action: "cancel", id: "sch_3" },
		);
		const other = toolCard("schedule_prompt", def, "cancel2", detailsResult({ action: "cancel", jobs: [], inFlight: false }), { action: "cancel", id: "sch_4" });
		const joined = (transcript(host, [card, other]).project()[0] as Grouped).render(80).join("\n");
		expect(joined).toContain("schedule_prompt in-flight cancel sch_3");
		expect(joined).toContain("schedule_prompt cancel sch_4");
	});

	test("custom result renderers, missing and malformed controls stay native", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const evalDef = session.getToolDefinition("eval");
		const ownCall = (...args: unknown[]) => ({ original: "kill.call", args });
		const ownResult = (...args: unknown[]) => ({ original: "kill.result", args });
		install(host, "kill_bash", { renderCall: ownCall, renderResult: ownResult, execute: mock(() => undefined) });
		const custom = session.getToolDefinition("kill_bash");
		expect(custom.renderCall).toBe(ownCall);
		expect(custom.renderResult).toBe(ownResult);

		install(host, "monitor", { renderCall: () => ({}), execute: mock(() => undefined) });
		const monitor = session.getToolDefinition("monitor");
		install(host, "schedule_wakeup", { execute: mock(() => undefined) });
		const wake = session.getToolDefinition("schedule_wakeup");
		install(host, "schedule_prompt", { execute: mock(() => undefined) });
		const prompt = session.getToolDefinition("schedule_prompt");
		install(host, "workflow", { execute: mock(() => undefined) });
		const flow = session.getToolDefinition("workflow");
		install(host, "workpool", { execute: mock(() => undefined) });
		const pool = session.getToolDefinition("workpool");

		const cases: { label: string; tool: string; definition: unknown; args: unknown; result: unknown }[] = [
			{ label: "custom", tool: "kill_bash", definition: custom, args: { bash_id: "b1" }, result: textResult("Killed b1.") },
			{ label: "missing", tool: "kill_bash", definition: undefined, args: { bash_id: "b1" }, result: textResult("Killed b1.") },
			{ label: "human", tool: "monitor", definition: monitor, args: { human_input: true, description: "chat" }, result: detailsResult({ monitor: true, monitor_id: "mon_1" }) },
			{ label: "human-pending", tool: "monitor", definition: monitor, args: { human_input: true, description: "chat" }, result: undefined },
			{ label: "rearm", tool: "monitor", definition: monitor, args: { action: "rearm", bash_id: "mon_1", description: "watch" }, result: detailsResult({ monitor: true, monitor_id: "mon_1" }) },
			{ label: "unknown-action", tool: "monitor", definition: monitor, args: { action: "brand-new", description: "watch" }, result: detailsResult({ monitor: true, monitor_id: "mon_1" }) },
			{ label: "monitor-shape", tool: "monitor", definition: monitor, args: { description: "chat" }, result: detailsResult({ monitor: true }) },
			{ label: "wake-unknown", tool: "schedule_wakeup", definition: wake, args: { reason: "x" }, result: detailsResult({ action: "brand-new", reason: "x" }) },
			{ label: "prompt-shape", tool: "schedule_prompt", definition: prompt, args: { action: "create" }, result: detailsResult({ action: "create", jobs: [] }) },
			{ label: "workflow-error", tool: "workflow", definition: flow, args: { action: "snapshot", run_id: "run_1" }, result: detailsResult({ kind: "error", error: { code: "run_not_found" } }) },
			{
				label: "workflow-child-failed",
				tool: "workflow",
				definition: flow,
				args: { action: "snapshot", run_id: "run_1" },
				result: detailsResult(workflowSnapshot({ counts: { total: 2, completed: 1, failed: 1, cancelled: 0, skipped: 0 } })),
			},
			{
				label: "workflow-warnings",
				tool: "workflow",
				definition: flow,
				args: { action: "snapshot", run_id: "run_1" },
				result: detailsResult({ ...workflowSnapshot(), warnings: ["node a retried"] }),
			},
			{
				label: "workflow-run-failed",
				tool: "workflow",
				definition: flow,
				args: { action: "wait", run_id: "run_1" },
				result: detailsResult({
					...workflowSnapshot(),
					kind: "waited",
					result: { status: "failed", snapshot: { ...workflowSnapshot().snapshot } },
				}),
			},
			{
				label: "workflow-run-cancelled",
				tool: "workflow",
				definition: flow,
				args: { action: "wait", run_id: "run_1" },
				result: detailsResult({
					...workflowSnapshot(),
					kind: "waited",
					result: { status: "cancelled", snapshot: { ...workflowSnapshot().snapshot } },
				}),
			},
			{ label: "pool-item-error", tool: "workpool", definition: pool, args: { op: "inspect", pool_id: poolId }, result: detailsResult({ pool_id: poolId, status: "open", items: [{ item_id: "wi_1", status: "completed", error: { code: "x" } }] }) },
			{ label: "pool-refused", tool: "workpool", definition: pool, args: { op: "yield", results: [] }, result: detailsResult({ pool_id: poolId, results: [{ key: "k", status: "refused" }] }) },
			{ label: "pool-unknown", tool: "workpool", definition: pool, args: { op: "brand-new" }, result: detailsResult({ pool_id: poolId }) },
			{ label: "media", tool: "kill_bash", definition: session.getToolDefinition("kill_bash"), args: { bash_id: "b1" }, result: { content: [{ type: "image", data: "x", mimeType: "image/png" }] } },
		];
		for (const { label, tool, definition, args, result } of cases) {
			const unsafe = toolCard(tool, definition, label, result, args);
			const out = transcript(host, [evalCard(evalDef, `a-${label}`), unsafe, evalCard(evalDef, `b-${label}`), evalCard(evalDef, `c-${label}`)]).project();
			expect(out.length).toBe(3);
			expect(out[1]).toBe(unsafe);
			expect((out[2] as Grouped).render(80)[1]).toBe("• Ran 2 evals");
		}
	});

	test("start and detached receipts keep their live lifecycle", async () => {
		const host = makeHost();
		const { session } = await load(host);
		install(host, "workflow", { execute: mock(() => undefined) });
		const def = session.getToolDefinition("workflow");
		const snapshot = {
			status: "running",
			counts: { total: 1, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
			nodes: [{ id: "a", state: "running" }],
		};
		const cards = [
			toolCard("workflow", def, "start", detailsResult({ kind: "started", run_id: "run_1", snapshot, warnings: [] }), { action: "start", definition: { name: "build" } }),
			toolCard("workflow", def, "detach", detailsResult({ kind: "detached", run_id: "run_1", snapshot }), { action: "wait", run_id: "run_1" }),
		];
		const lines = (transcript(host, cards).project()[0] as Grouped).render(80);
		const joined = lines.join("\n");
		expect(joined).toContain("workflow start build started running");
		expect(joined).toContain("workflow wait run_1 detached running");
		expect(joined).toContain("Running 2 tools");
		expect(joined).not.toContain("Ran 2");
		expect(joined).not.toContain("complete");
	});

	test("control ids and workflow names drop terminal escapes and flatten lines", async () => {
		const host = makeHost();
		const { session } = await load(host);
		install(host, "kill_bash", { execute: mock(() => undefined) });
		install(host, "workflow", { execute: mock(() => undefined) });
		const kill = session.getToolDefinition("kill_bash");
		const flow = session.getToolDefinition("workflow");
		const snapshot = {
			status: "running",
			runId: "run_1",
			name: "run",
			counts: { total: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
			nodes: [],
		};
		const cards = [
			toolCard("kill_bash", kill, "kill", textResult("Killed b1."), { bash_id: "b1\u001b[31m\u0007" }),
			toolCard(
				"workflow",
				flow,
				"flow",
				detailsResult({ kind: "started", run_id: "run_1", snapshot, warnings: [] }),
				{ action: "start", definition: { name: "build\u001b]0;pwned\u0007 name\nsecond" } },
			),
		];
		const rendered = (transcript(host, cards).project()[0] as Grouped).render(80).join("\n");
		expect(rendered).toContain("kill_bash b1: Killed b1.");
		expect(rendered).toContain("workflow start build name second started running");
		expect(hasControlCharacters(rendered)).toBe(false);
	});

	test("a definition that gains a result renderer leaves the projection path", async () => {
		const host = makeHost();
		const { session } = await load(host);
		install(host, "workflow", { execute: mock(() => undefined) });
		const def = session.getToolDefinition("workflow");
		const snapshot = {
			status: "running",
			counts: { total: 0, completed: 0, failed: 0, cancelled: 0, skipped: 0 },
			nodes: [],
		};
		const card = toolCard("workflow", def, "flow", detailsResult({ kind: "snapshot", run_id: "run_1", snapshot }), { action: "snapshot", run_id: "run_1" });
		const { im, project } = transcript(host, [card]);
		expect(project()).toBe(im.chatContainer.children);
		(def as Record<string, unknown>).renderResult = () => ({ original: "late.result" });
		const first = toolCard("workflow", def, "first", detailsResult({ kind: "snapshot", run_id: "run_1", snapshot }), { action: "snapshot", run_id: "run_1" });
		const second = toolCard("workflow", def, "second", detailsResult({ kind: "snapshot", run_id: "run_1", snapshot }), { action: "snapshot", run_id: "run_1" });
		const late = transcript(host, [first, second]);
		expect(late.project()).toBe(late.im.chatContainer.children);
	});

	test("bash_input ignored keys and bash_resize no-op remain native", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const input = install(host, "bash_input", { execute: mock(() => undefined) });
		const resize = install(host, "bash_resize", { execute: mock(() => undefined) });
		const inputDef = session.getToolDefinition("bash_input");
		const resizeDef = session.getToolDefinition("bash_resize");
		const cards = [
			toolCard("bash_input", inputDef, "input", { details: {}, isError: false }, { bash_id: "b1", input: "x", keys: ["nope"] }),
			toolCard("bash_resize", resizeDef, "resize", { details: {}, isError: false }, { bash_id: "b1", cols: 80, rows: 40 }),
		];
		const { im, project } = transcript(host, cards);
		expect(project()).toBe(im.chatContainer.children);
		expect(input.execute.mock.calls.length).toBe(0);
		expect(resize.execute.mock.calls.length).toBe(0);
	});
});

describe("thread grouping", () => {
	type ThreadFixture = {
		name: string;
		args: Record<string, unknown>;
		payload: Record<string, unknown>;
		callText: string;
		resultText: string;
	};
	const fixtures: ThreadFixture[] = [
		{
			name: "thread_create",
			args: { name: "worker" },
			payload: { thread_id: "thr_1", thread: { thread_id: "thr_1", name: "worker" } },
			callText: "thread_create worker",
			resultText: "thread_create worker · thr_1",
		},
		{
			name: "thread_list",
			args: {},
			payload: { threads: [{ thread_id: "thr_1" }, { thread_id: "thr_2" }] },
			callText: "thread_list",
			resultText: "thread_list 2 threads",
		},
		{
			name: "thread_read",
			args: { thread: "thr_1" },
			payload: { thread_id: "thr_1" },
			callText: "thread_read thr_1",
			resultText: "thread_read thr_1",
		},
		{
			name: "thread_send",
			args: { thread: "thr_1", message: "go", summary: "deploy" },
			payload: { thread_id: "thr_1", delivery: { kind: "queued_offline" } },
			callText: "thread_send thr_1 · deploy",
			resultText: "thread_send thr_1 queued_offline · deploy",
		},
		{
			name: "thread_interrupt",
			args: { thread: "thr_1", turn_id: "turn_7" },
			payload: { thread_id: "thr_1", interrupted: true },
			callText: "thread_interrupt thr_1 turn turn_7",
			resultText: "thread_interrupt thr_1 turn turn_7",
		},
		{
			name: "thread_handoff",
			args: { thread: "thr_2", message: "continue", summary: "resume" },
			payload: { thread_id: "thr_2", delivery: { kind: "started" } },
			callText: "thread_handoff thr_2 · resume",
			resultText: "thread_handoff thr_2 started · resume",
		},
		{
			name: "thread_rename",
			args: { thread: "thr_1", name: "renamed" },
			payload: { thread_id: "thr_1", name: "renamed" },
			callText: "thread_rename thr_1 to renamed",
			resultText: "thread_rename thr_1 to renamed",
		},
		{
			name: "thread_set_model",
			args: { thread: "thr_1", provider: "anthropic", model: "claude" },
			payload: { thread_id: "thr_1", provider: "anthropic", model: "claude" },
			callText: "thread_set_model thr_1 anthropic/claude",
			resultText: "thread_set_model thr_1 anthropic/claude",
		},
		{
			name: "thread_set_reasoning",
			args: { thread: "thr_1", level: "high" },
			payload: { thread_id: "thr_1", level: "high" },
			callText: "thread_set_reasoning thr_1 high",
			resultText: "thread_set_reasoning thr_1 high",
		},
		{
			name: "thread_bind",
			args: { platform: "discord", account_id: "acct", chat_id: "chat_1" },
			payload: { binding_id: "bind_1" },
			callText: "thread_bind discord/chat_1",
			resultText: "thread_bind discord/chat_1 · bind_1",
		},
		{
			name: "thread_unbind",
			args: { binding_id: "bind_1", expected_revision: 1 },
			payload: { binding_id: "bind_1" },
			callText: "thread_unbind bind_1",
			resultText: "thread_unbind bind_1",
		},
		{
			name: "thread_rebind",
			args: { binding_id: "bind_1", expected_revision: 1, session: "thr_2" },
			payload: { binding_id: "bind_1", session_durable_id: "thr_2" },
			callText: "thread_rebind bind_1 to thr_2",
			resultText: "thread_rebind bind_1 to thr_2",
		},
		{
			name: "thread_bindings",
			args: { session: "thr_1" },
			payload: { bindings: [{ binding_id: "bind_1" }] },
			callText: "thread_bindings session thr_1",
			resultText: "thread_bindings 1 binding · session thr_1",
		},
		{
			name: "thread_report",
			args: { kind: "milestone", binding_id: "bind_1", text: "50%" },
			payload: { binding_id: "bind_1", report_kind: "milestone" },
			callText: "thread_report milestone bind_1",
			resultText: "thread_report milestone bind_1",
		},
		{
			name: "thread_outbox",
			args: { binding_id: "bind_1" },
			payload: { binding_id: "bind_1", items: [] },
			callText: "thread_outbox bind_1",
			resultText: "thread_outbox bind_1",
		},
		{
			name: "thread_outbox_ack",
			args: { binding_id: "bind_1", cursor: 4 },
			payload: { binding_id: "bind_1", cursor: 4 },
			callText: "thread_outbox_ack bind_1 · cursor 4",
			resultText: "thread_outbox_ack bind_1 · cursor 4",
		},
	];
	const receipt = (payload: Record<string, unknown>) => ({
		details: { result: { kind: "ok", ...payload } },
		content: [{ type: "text", text: "original thread receipt" }],
	});
	const installThreads = (host: ReturnType<typeof makeHost>) => {
		const defs: Record<string, { execute: ReturnType<typeof mock> }> = {};
		for (const { name } of fixtures) {
			const definition = { execute: mock(() => undefined) };
			host.defs[name] = definition;
			defs[name] = definition;
		}
		return defs;
	};

	test("all sixteen eligible thread receipts join ordered groups and thread_answer never does", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const defs = installThreads(host);
		host.defs.thread_answer = { execute: mock(() => undefined) };
		const definitions: Record<string, Record<string, unknown>> = {};
		for (const { name } of fixtures) {
			const def = session.getToolDefinition(name) as Record<string, unknown>;
			definitions[name] = def;
			expect(Object.hasOwn(def, "renderCall")).toBe(false);
			expect(Object.hasOwn(def, "renderResult")).toBe(false);
		}
		const cards = fixtures.map(({ name, args, payload }) => toolCard(name, definitions[name], name, receipt(payload), args));
		const answer = toolCard(
			"thread_answer",
			session.getToolDefinition("thread_answer"),
			"answer",
			receipt({ binding_id: "bind_1", cursor: 5, reply_token: "rt_secret" }),
			{ binding_id: "bind_1", reply_token: "rt_secret", answer: "yes" },
		);
		const tail = fixtures.slice(0, 2).map(({ name, args, payload }) =>
			toolCard(name, definitions[name], `${name}-tail`, receipt(payload), args),
		);
		const out = transcript(host, [...cards, answer, ...tail]).project();
		expect(out.length).toBe(3);
		const first = (out[0] as Grouped).render(80);
		expect(first[1]).toContain("Running 16 tools");
		expect(first.slice(2).map((line) => line.trim())).toEqual(
			fixtures.map(({ resultText }, index) => `${index === 0 ? "└ " : ""}${resultText}`),
		);
		expect(out[1]).toBe(answer);
		expect((out[2] as Grouped).render(80)[1]).toContain("Ran 2 tools");
		for (const def of Object.values(defs)) expect(def.execute.mock.calls.length).toBe(0);
	});

	test("pending thread calls identify their target and later settle in the same order", async () => {
		const host = makeHost();
		const { session } = await load(host);
		installThreads(host);
		const pending = fixtures.map(({ name, args }) =>
			toolCard(name, session.getToolDefinition(name), `${name}-pending`, undefined, args),
		);
		const lines = (transcript(host, pending).project()[0] as Grouped).render(80);
		expect(lines[1]).toContain("Running 16 tools");
		expect(lines.slice(2).map((line) => line.trim())).toEqual(
			fixtures.map(({ callText }, index) => `${index === 0 ? "└ " : ""}${callText}`),
		);
	});

	test("queued_offline stays a delivery label, never delivered", async () => {
		const host = makeHost();
		const { session } = await load(host);
		installThreads(host);
		const def = session.getToolDefinition("thread_send");
		const cards = ["queued_offline", "started", "steered", "queued"].map((kind) =>
			toolCard("thread_send", def, kind, receipt({ thread_id: "thr_1", delivery: { kind } }), { thread: "thr_1", message: "go" }),
		);
		const rendered = (transcript(host, cards).project()[0] as Grouped).render(80).join("\n");
		expect(rendered).toContain("thread_send thr_1 queued_offline");
		expect(rendered).toContain("thread_send thr_1 started");
		expect(rendered).toContain("thread_send thr_1 steered");
		expect(rendered).toContain("thread_send thr_1 queued");
		expect(rendered).not.toContain("delivered");
	});

	test("error, incomplete and decision receipts stay native", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const evalDef = session.getToolDefinition("eval");
		installThreads(host);
		host.defs.thread_answer = { execute: mock(() => undefined) };
		const send = session.getToolDefinition("thread_send");
		const report = session.getToolDefinition("thread_report");
		const cases: { label: string; tool: string; definition: unknown; args: unknown; result: unknown }[] = [
			{
				label: "error",
				tool: "thread_read",
				definition: session.getToolDefinition("thread_read"),
				args: { thread: "thr_1" },
				result: { details: { result: { kind: "error", error: { code: "invalid_arguments" } } } },
			},
			{
				label: "unknown-kind",
				tool: "thread_read",
				definition: session.getToolDefinition("thread_read"),
				args: { thread: "thr_1" },
				result: { details: { result: { kind: "brand-new" } } },
			},
			{
				label: "missing-kind",
				tool: "thread_read",
				definition: session.getToolDefinition("thread_read"),
				args: { thread: "thr_1" },
				result: { details: { result: { thread_id: "thr_1" } } },
			},
			{
				label: "source-incomplete",
				tool: "thread_read",
				definition: session.getToolDefinition("thread_read"),
				args: { thread: "thr_1" },
				result: receipt({ thread_id: "thr_1", source_incomplete: true }),
			},
			{
				label: "error-note",
				tool: "thread_read",
				definition: session.getToolDefinition("thread_read"),
				args: { thread: "thr_1" },
				result: receipt({ thread_id: "thr_1", error_note: "host moved" }),
			},
			{
				label: "unknown-delivery",
				tool: "thread_send",
				definition: send,
				args: { thread: "thr_1", message: "x" },
				result: receipt({ thread_id: "thr_1", delivery: { kind: "teleported" } }),
			},
			{
				label: "missing-delivery",
				tool: "thread_handoff",
				definition: session.getToolDefinition("thread_handoff"),
				args: { thread: "thr_2", message: "x" },
				result: receipt({ thread_id: "thr_2" }),
			},
			{
				label: "question-pending",
				tool: "thread_report",
				definition: report,
				args: { kind: "question", binding_id: "bind_1", text: "choose" },
				result: undefined,
			},
			{
				label: "question-settled",
				tool: "thread_report",
				definition: report,
				args: { kind: "question", binding_id: "bind_1", text: "choose" },
				result: receipt({ binding_id: "bind_1", report_kind: "question", reply_token: "rt_secret" }),
			},
			{
				label: "missing-report-kind",
				tool: "thread_report",
				definition: report,
				args: { binding_id: "bind_1", text: "choose" },
				result: receipt({ binding_id: "bind_1" }),
			},
			{
				label: "unknown-report-kind",
				tool: "thread_report",
				definition: report,
				args: { kind: "brand-new", binding_id: "bind_1", text: "choose" },
				result: receipt({ binding_id: "bind_1" }),
			},
			{
				label: "answer-pending",
				tool: "thread_answer",
				definition: session.getToolDefinition("thread_answer"),
				args: { binding_id: "bind_1", reply_token: "rt_secret", answer: "yes" },
				result: undefined,
			},
			{
				label: "answer-settled",
				tool: "thread_answer",
				definition: session.getToolDefinition("thread_answer"),
				args: { binding_id: "bind_1", reply_token: "rt_secret", answer: "yes" },
				result: receipt({ binding_id: "bind_1", cursor: 5 }),
			},
		];
		for (const { label, tool, definition, args, result } of cases) {
			const unsafe = toolCard(tool, definition, label, result, args);
			const out = transcript(host, [evalCard(evalDef, `a-${label}`), unsafe, evalCard(evalDef, `b-${label}`), evalCard(evalDef, `c-${label}`)]).project();
			expect(out.length).toBe(3);
			expect(out[1]).toBe(unsafe);
			expect((out[2] as Grouped).render(80)[1]).toBe("• Ran 2 evals");
		}
	});

	test("thread rows never expose reply tokens or raw terminal controls", async () => {
		const host = makeHost();
		const { session } = await load(host);
		installThreads(host);
		const def = session.getToolDefinition("thread_send");
		const cards = [
			toolCard(
				"thread_send",
				def,
				"escape",
				receipt({ thread_id: "thr_1", delivery: { kind: "queued_offline" }, reply_token: "rt_secret" }),
				{ thread: "thr_1\u001b[31m", message: "\u001b]0;pwned\u0007body", summary: "line one\nline two\u0007" },
			),
			toolCard(
				"thread_send",
				def,
				"clean",
				receipt({ thread_id: "thr_2", delivery: { kind: "started" } }),
				{ thread: "thr_2", message: "go" },
			),
		];
		const rendered = (transcript(host, cards).project()[0] as Grouped).render(80).join("\n");
		expect(rendered).toContain("thread_send thr_1 queued_offline · line one line two");
		expect(rendered).not.toContain("rt_secret");
		for (const line of rendered.split("\n")) expect(line).not.toMatch(/\p{Cc}/u);
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

describe("audited renderer grouping", () => {
	type Shape = "two" | "none" | "call";
	type CatalogRow = { name: string; expected: "eligible" | "native"; shape: Shape; args?: Record<string, unknown>; line?: string; cwd?: string };

	/** Independent catalog snapshot: every one of the 79 observed names and its disposition. */
	const CATALOG: readonly CatalogRow[] = [
		{ name: "read", expected: "native", shape: "two" },
		{ name: "bash", expected: "eligible", shape: "two", args: { command: "echo hi" }, line: "bash echo hi" },
		{ name: "powershell", expected: "eligible", shape: "two", args: { command: "Get-Date" }, line: "powershell Get-Date" },
		{ name: "edit", expected: "eligible", shape: "two", args: { path: "a.ts" }, line: "edit a.ts" },
		{ name: "write", expected: "eligible", shape: "two", args: {}, line: "write" },
		{ name: "grep", expected: "native", shape: "two" },
		{ name: "find", expected: "native", shape: "two" },
		{ name: "glob", expected: "eligible", shape: "two", args: { pattern: "**/*.ts", path: "C:/work/project/src" }, line: "glob **/*.ts in src", cwd: "C:/work/project" },
		{ name: "ls", expected: "native", shape: "two" },
		{ name: "apply_patch", expected: "eligible", shape: "two", args: { input: "*** Begin Patch\n*** Update File: a.ts\n@@\n*** End Patch" }, line: "apply_patch a.ts" },
		{ name: "request_user_input", expected: "native", shape: "two" },
		{ name: "ask_user_question", expected: "native", shape: "two" },
		{ name: "generate_image", expected: "native", shape: "two" },
		{ name: "todo", expected: "eligible", shape: "two", args: { op: "view" }, line: "todo view" },
		{ name: "bash_output", expected: "eligible", shape: "two", args: {}, line: "bash_output" },
		{ name: "bash_input", expected: "native", shape: "none" },
		{ name: "bash_resize", expected: "native", shape: "none" },
		{ name: "kill_bash", expected: "eligible", shape: "none", args: { bash_id: "b1" }, line: "kill_bash b1" },
		{ name: "monitor", expected: "eligible", shape: "call", args: { description: "watch build" }, line: "monitor watch build" },
		{ name: "web_search", expected: "eligible", shape: "two", args: {}, line: "web_search" },
		{ name: "$web_search", expected: "native", shape: "two" },
		{ name: "webfetch", expected: "eligible", shape: "two", args: {}, line: "webfetch" },
		{ name: "read_video", expected: "native", shape: "two" },
		{ name: "look_at", expected: "eligible", shape: "two", args: {}, line: "look_at" },
		{ name: "create_goal", expected: "eligible", shape: "two", args: {}, line: "create_goal" },
		{ name: "update_goal", expected: "eligible", shape: "two", args: {}, line: "update_goal" },
		{ name: "get_goal", expected: "eligible", shape: "two", args: {}, line: "get_goal" },
		{ name: "schedule_wakeup", expected: "eligible", shape: "none", args: { delaySeconds: 60 }, line: "schedule_wakeup schedule 60s" },
		{ name: "schedule_prompt", expected: "eligible", shape: "none", args: { action: "list" }, line: "schedule_prompt list" },
		{ name: "show_html_page", expected: "native", shape: "two" },
		{ name: "tool_search", expected: "eligible", shape: "two", args: {}, line: "tool_search" },
		{ name: "mcp__ast_grep_rewrite", expected: "eligible", shape: "two", args: { pattern: "foo", paths: ["src/a.ts"], apply: true }, line: "mcp__ast_grep_rewrite foo src/a.ts apply" },
		{ name: "mcp__ast_grep_scan", expected: "eligible", shape: "two", args: { ruleFile: "rule.yml", paths: ["src"] }, line: "mcp__ast_grep_scan rule.yml preview" },
		{ name: "mcp__ast_grep_search", expected: "eligible", shape: "two", args: { pattern: "bar", paths: ["src/b.ts"] }, line: "mcp__ast_grep_search bar src/b.ts preview" },
		{ name: "mcp_context7_query-docs", expected: "eligible", shape: "two", args: { libraryId: "/bun/bun", query: "fetch" }, line: "mcp_context7_query-docs /bun/bun fetch" },
		{ name: "mcp_context7_resolve-library-id", expected: "eligible", shape: "two", args: { libraryName: "bun", query: "hono" }, line: "mcp_context7_resolve-library-id bun hono" },
		{ name: "mcp_grep_app_searchGitHub", expected: "eligible", shape: "two", args: { query: "useState", repo: "facebook/react" }, line: "mcp_grep_app_searchGitHub useState facebook/react" },
		{ name: "eval", expected: "eligible", shape: "two", args: { summary: "matrix" } },
		{ name: "onboarding_session_history", expected: "native", shape: "none" },
		{ name: "onboarding_understand", expected: "native", shape: "none" },
		{ name: "onboarding_memory_apply", expected: "native", shape: "none" },
		{ name: "lsp_diagnostics", expected: "eligible", shape: "two", args: {}, line: "lsp_diagnostics" },
		{ name: "lsp_goto_definition", expected: "eligible", shape: "two", args: {}, line: "lsp_goto_definition" },
		{ name: "lsp_find_references", expected: "eligible", shape: "two", args: {}, line: "lsp_find_references" },
		{ name: "lsp_symbols", expected: "eligible", shape: "two", args: {}, line: "lsp_symbols" },
		{ name: "lsp_prepare_rename", expected: "eligible", shape: "two", args: {}, line: "lsp_prepare_rename" },
		{ name: "lsp_rename", expected: "eligible", shape: "two", args: {}, line: "lsp_rename" },
		{ name: "computer", expected: "native", shape: "two" },
		{ name: "omo_browser_bridge", expected: "native", shape: "two" },
		{ name: "task", expected: "eligible", shape: "two", args: {}, line: "task" },
		{ name: "task_send", expected: "eligible", shape: "two", args: {}, line: "task_send" },
		{ name: "task_cancel", expected: "eligible", shape: "two", args: {}, line: "task_cancel" },
		{ name: "task_output", expected: "eligible", shape: "two", args: {}, line: "task_output" },
		{ name: "workflow", expected: "eligible", shape: "none", args: { action: "start", definition: { name: "build" } }, line: "workflow start build" },
		{ name: "workpool", expected: "eligible", shape: "none", args: { op: "create", name: "pool" }, line: "workpool create pool" },
		{ name: "team_create", expected: "eligible", shape: "two", args: {}, line: "team_create" },
		{ name: "team_delete", expected: "eligible", shape: "two", args: {}, line: "team_delete" },
		{ name: "task_create", expected: "eligible", shape: "two", args: {}, line: "task_create" },
		{ name: "task_get", expected: "eligible", shape: "two", args: {}, line: "task_get" },
		{ name: "task_list", expected: "eligible", shape: "two", args: {}, line: "task_list" },
		{ name: "task_update", expected: "eligible", shape: "two", args: {}, line: "task_update" },
		{ name: "thread_create", expected: "eligible", shape: "none", args: { name: "thr_1" }, line: "thread_create thr_1" },
		{ name: "thread_list", expected: "eligible", shape: "none", args: {}, line: "thread_list" },
		{ name: "thread_read", expected: "eligible", shape: "none", args: { thread: "thr_1" }, line: "thread_read thr_1" },
		{ name: "thread_send", expected: "eligible", shape: "none", args: { thread: "thr_1", summary: "s" }, line: "thread_send thr_1 · s" },
		{ name: "thread_interrupt", expected: "eligible", shape: "none", args: { thread: "thr_1", turn_id: "turn_7" }, line: "thread_interrupt thr_1 turn turn_7" },
		{ name: "thread_handoff", expected: "eligible", shape: "none", args: { thread: "thr_1", summary: "s" }, line: "thread_handoff thr_1 · s" },
		{ name: "thread_rename", expected: "eligible", shape: "none", args: { thread: "thr_1", name: "new" }, line: "thread_rename thr_1 to new" },
		{ name: "thread_set_model", expected: "eligible", shape: "none", args: { thread: "thr_1", provider: "anthropic", model: "claude" }, line: "thread_set_model thr_1 anthropic/claude" },
		{ name: "thread_set_reasoning", expected: "eligible", shape: "none", args: { thread: "thr_1", level: "high" }, line: "thread_set_reasoning thr_1 high" },
		{ name: "thread_bind", expected: "eligible", shape: "none", args: { platform: "discord", chat_id: "chat_1" }, line: "thread_bind discord/chat_1" },
		{ name: "thread_unbind", expected: "eligible", shape: "none", args: { binding_id: "b1" }, line: "thread_unbind b1" },
		{ name: "thread_rebind", expected: "eligible", shape: "none", args: { binding_id: "b1", session: "thr_2" }, line: "thread_rebind b1 to thr_2" },
		{ name: "thread_bindings", expected: "eligible", shape: "none", args: {}, line: "thread_bindings" },
		{ name: "thread_report", expected: "eligible", shape: "none", args: { kind: "milestone", binding_id: "b1" }, line: "thread_report milestone b1" },
		{ name: "thread_outbox", expected: "eligible", shape: "none", args: { binding_id: "b1" }, line: "thread_outbox b1" },
		{ name: "thread_outbox_ack", expected: "eligible", shape: "none", args: { binding_id: "b1", cursor: 4 }, line: "thread_outbox_ack b1 · cursor 4" },
		{ name: "thread_answer", expected: "native", shape: "none" },
		{ name: "memory", expected: "eligible", shape: "two", args: {}, line: "memory" },
	];

	const catalogDef = (shape: Shape): Record<string, unknown> => {
		if (shape === "two") return { renderCall() {}, renderResult() {} };
		if (shape === "call") return { renderCall() {} };
		return {};
	};

	function installMocks(host: ReturnType<typeof makeHost>, names: readonly string[]) {
		const calls: string[] = [];
		for (const name of names) {
			host.defs[name] = {
				renderCall: () => {
					calls.push(`${name}.call`);
					return { original: `${name}.call` };
				},
				renderResult: () => {
					calls.push(`${name}.result`);
					return { original: `${name}.result` };
				},
				execute: mock(() => undefined),
			};
		}
		return calls;
	}

	test("bash, glob and full MCP cards join with their audited summaries", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const names = [
			"bash",
			"glob",
			"mcp__ast_grep_search",
			"mcp__ast_grep_rewrite",
			"mcp_context7_query-docs",
			"mcp_grep_app_searchGitHub",
		];
		const original = installMocks(host, names);
		const defs = Object.fromEntries(names.map((name) => [name, session.getToolDefinition(name)]));
		const cwd = "C:/work/project";
		const textResult = (text: string) => ({ content: [{ type: "text", text }] });
		const mcpResult = (preview: string) => ({
			details: { server: "srv", tool: "tool", preview },
			content: [{ type: "text", text: "raw" }],
		});

		expect((defs.bash.renderCall({ command: "npm test" }, theme, {}) as FakeTruncatedText).text).toBe("bash npm test");
		expect((defs.glob.renderCall({ pattern: "*.ts" }, theme, { cwd }) as FakeTruncatedText).text).toBe("glob *.ts in .");

		const cards = [
			evalCard(session.getToolDefinition("eval"), "lead"),
			toolCard("bash", defs.bash, "bash", { ...textResult("launched"), details: { bash_id: "b_1", background: true } }, { description: "build", command: "npm run build" }, "classic", cwd),
			toolCard("glob", defs.glob, "glob", textResult("src/a.ts"), { pattern: "**/*.ts", path: "C:/work/project/src" }, "classic", cwd),
			toolCard("mcp__ast_grep_search", defs.mcp__ast_grep_search, "search", mcpResult("src/a.ts:1: foo"), { pattern: "foo", paths: ["src/a.ts"], apply: false }),
			toolCard("mcp__ast_grep_rewrite", defs.mcp__ast_grep_rewrite, "rewrite", mcpResult("2 replacements"), { pattern: "foo", paths: ["src/a.ts"], apply: true }),
			toolCard("mcp_context7_query-docs", defs["mcp_context7_query-docs"], "docs", mcpResult("(empty result)"), { libraryId: "/bun/bun", query: "fetch" }),
			toolCard("mcp_grep_app_searchGitHub", defs.mcp_grep_app_searchGitHub, "github", mcpResult("react/React:1"), { query: "useState", repo: "facebook/react" }),
		];
		const out = transcript(host, cards).project();
		expect(out.length).toBe(1);
		const lines = (out[0] as Grouped).render(240);
		expect(lines[1]).toBe("• Ran 7 tools · eval 1 · bash 1 · glob 1 · mcp__ast_grep_search 1 · mcp__ast_grep_rewrite 1 · mcp_context7_query-docs 1 · mcp_grep_app_searchGitHub 1");
		expect(lines.slice(3)).toEqual([
			"    bash build background b_1",
			"    glob **/*.ts in src",
			"    mcp__ast_grep_search foo src/a.ts preview · src/a.ts:1: foo",
			"    mcp__ast_grep_rewrite foo src/a.ts apply · 2 replacements",
			"    mcp_context7_query-docs /bun/bun fetch · (empty result)",
			"    mcp_grep_app_searchGitHub useState facebook/react · react/React:1",
		]);
		expect(original).toEqual([]);
	});

	test("a background handle is a receipt, not an inferred completion", async () => {
		const host = makeHost();
		const { session } = await load(host);
		installMocks(host, ["bash"]);
		const bash = session.getToolDefinition("bash");
		const result = (details: Record<string, unknown>) => ({ details, content: [{ type: "text", text: "running" }] });
		for (const details of [{ bash_id: "b_1" }, { background: true }]) {
			const line = (bash.renderResult(result(details), {}, theme, { args: { command: "sleep 99" } }) as FakeTruncatedText).text;
			expect(line).toBe("bash sleep 99");
		}
		const background = bash.renderResult(result({ bash_id: "b_1", background: true }), {}, theme, { args: { command: "sleep 99" } });
		expect((background as FakeTruncatedText).text).toBe("bash sleep 99 background b_1");
		expect((background as FakeTruncatedText).text).not.toContain("✓");
	});

	test("MCP stubs, refusals, images, missing metadata and unknown names stay native", async () => {
		const host = makeHost();
		const { session } = await load(host);
		const stubCall = () => ({ original: "stub.call" });
		host.defs["mcp_context7_query-docs"] = { renderCall: stubCall };
		const stub = session.getToolDefinition("mcp_context7_query-docs");
		expect(stub.renderCall).toBe(stubCall);

		const fullNames = ["mcp__ast_grep_search"];
		installMocks(host, fullNames);
		const full = session.getToolDefinition("mcp__ast_grep_search");
		const args = { pattern: "foo", paths: ["src/a.ts"] };
		const image = { type: "image", data: "abc", mimeType: "image/png" };
		const cases: { label: string; result: unknown; tool: string; definition: unknown; mode: "member" | "native" }[] = [
			{ label: "stub", result: { content: [{ type: "text", text: "not active" }] }, tool: "mcp_context7_query-docs", definition: stub, mode: "native" },
			{ label: "refusal", result: { details: { error: { kind: "refused" }, preview: "refused", server: "srv", tool: "search" }, content: [{ type: "text", text: "x" }] }, tool: "mcp__ast_grep_search", definition: full, mode: "member" },
			{ label: "image", result: { details: { server: "srv", tool: "search", preview: "[image]" }, content: [image] }, tool: "mcp__ast_grep_search", definition: full, mode: "member" },
			{ label: "missing-metadata", result: { details: { preview: "x" }, content: [{ type: "text", text: "x" }] }, tool: "mcp__ast_grep_search", definition: full, mode: "member" },
			{ label: "non-string-preview", result: { details: { server: "srv", tool: "search", preview: 4 }, content: [{ type: "text", text: "x" }] }, tool: "mcp__ast_grep_search", definition: full, mode: "member" },
			{ label: "renderer-error", result: { isError: true, details: { server: "srv", tool: "search", preview: "x" } }, tool: "mcp__ast_grep_search", definition: full, mode: "member" },
		];
		const evalDef = session.getToolDefinition("eval");
		for (const { label, result, tool, definition, mode } of cases) {
			const unsafe = toolCard(tool, definition, label, result, args);
			const out = transcript(host, [evalCard(evalDef, `${label} a`), unsafe, evalCard(evalDef, `${label} b`), evalCard(evalDef, `${label} c`)]).project();
			expect(out.length).toBe(3);
			expect(out[1]).toBe(unsafe);
			if (mode === "member") {
				expect(full.renderResult(result, {}, theme, { args })).toEqual({ original: "mcp__ast_grep_search.result" });
			}
		}

		const unknownName = "novel_future_tool";
		host.defs[unknownName] = { renderCall() {}, renderResult() {} };
		const unknown = toolCard(unknownName, session.getToolDefinition(unknownName), "unknown", { details: {} }, {});
		const unknownOut = transcript(host, [evalCard(evalDef, "u a"), unknown, evalCard(evalDef, "u b"), evalCard(evalDef, "u c")]).project();
		expect(unknownOut.length).toBe(3);
		expect(unknownOut[1]).toBe(unknown);

		host.defs.$web_search = { renderCall() {}, renderResult() {} };
		const record = { details: { arbitrary: { echo: true } }, content: [{ type: "text", text: "provider echo" }] };
		const before = structuredClone(record);
		const echo = toolCard("$web_search", session.getToolDefinition("$web_search"), "echo", record, { query: "x" });
		const echoOut = transcript(host, [evalCard(evalDef, "w a"), echo, evalCard(evalDef, "w b"), evalCard(evalDef, "w c")]).project();
		expect(echoOut.length).toBe(3);
		expect(echoOut[1]).toBe(echo);
		expect(record).toEqual(before);
	});

	test("shell and MCP summary text cannot inject terminal controls", async () => {
		const host = makeHost();
		const { session } = await load(host);
		installMocks(host, ["bash", "mcp_grep_app_searchGitHub"]);
		const bash = session.getToolDefinition("bash");
		const search = session.getToolDefinition("mcp_grep_app_searchGitHub");
		const command = "\u001b[31mrm -rf\u001b[0m\u001b]0;pwned\u0007\nsecond line";
		const preview = "\u001b]0;pwned\u0007hello\nworld\u001b[2J";
		const cards = [
			toolCard("bash", bash, "bash", { details: {}, content: [{ type: "text", text: "done" }] }, { command }),
			toolCard("mcp_grep_app_searchGitHub", search, "search", { details: { server: "srv", tool: "github", preview }, content: [{ type: "text", text: "x" }] }, { query: "useState" }),
		];
		const rendered = (transcript(host, cards).project()[0] as Grouped).render(240);
		expect(rendered).toContain("  └ bash rm -rf");
		expect(rendered).toContain("    mcp_grep_app_searchGitHub useState · hello world");
		for (const line of rendered) expect(line).not.toMatch(/\p{Cc}/u);
	});

	test("the 79-name catalog matrix accounts for every observed tool", async () => {
		expect(CATALOG).toHaveLength(79);
		expect(new Set(CATALOG.map((row) => row.name)).size).toBe(79);
		expect(CATALOG.filter((row) => row.expected === "eligible")).toHaveLength(61);
		expect(CATALOG.filter((row) => row.expected === "native")).toHaveLength(18);

		const host = makeHost();
		const { session } = await load(host);
		for (const row of CATALOG) host.defs[row.name] = catalogDef(row.shape);
		const evalDef = session.getToolDefinition("eval");
		const matrix: { name: string; expected: string; actual: string }[] = [];
		for (const row of CATALOG) {
			const definition = session.getToolDefinition(row.name);
			const card = toolCard(row.name, definition, row.name, undefined, row.args ?? {}, "classic", row.cwd);
			const out = transcript(host, [evalCard(evalDef, "lead"), card]).project();
			const actual = out.length === 1 ? "eligible" : "native";
			matrix.push({ name: row.name, expected: row.expected, actual });
			expect(actual, row.name).toBe(row.expected);
			if (actual === "eligible" && row.line !== undefined) {
				expect((out[0] as Grouped).render(240)[3], row.name).toBe(`    ${row.line}`);
			}
		}
		expect(matrix.every((row) => row.expected === row.actual)).toBe(true);

		const unknownName = "novel_future_tool";
		host.defs[unknownName] = catalogDef("two");
		const unknown = toolCard(unknownName, session.getToolDefinition(unknownName), "unknown", undefined, {});
		const unknownOut = transcript(host, [evalCard(evalDef, "u a"), unknown]).project();
		expect(unknownOut.length).toBe(2);
		expect(unknownOut[1]).toBe(unknown);
	});
});
