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

type HostOptions = { withMethod?: boolean; withAssistant?: boolean; withInteractive?: boolean; withProject?: boolean };

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
		project() {
			return this.children;
		}
	}
	class NoProjectTranscript {
		children: unknown[] = [];
	}
	class InteractiveMode {
		chatContainer = options.withProject === false ? new NoProjectTranscript() : new FakeTranscript();
		createToolExecutionComponent() {
			return { created: true };
		}
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

function toolCard(toolName: string, definition: unknown, label: string, result: unknown, args: unknown): Card {
	return {
		presentationSnapshot: {
			presentation: "classic",
			identity: { toolName, toolDefinition: definition },
			state: { args, result, isPartial: false, expanded: false },
		},
		render: () => [`CARD ${label}`],
	};
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
