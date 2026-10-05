import { describe, expect, mock, test } from "bun:test";

class FakeTruncatedText {
	constructor(public text: string) {}
	render(width: number) {
		return [this.text.slice(0, width)];
	}
	invalidate() {}
}

type Call = { slot: string; args: unknown[] };

function makeHost(options: { withMethod?: boolean } = {}) {
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
		look_at: { renderCall: record("look.call") },
		ask_user_question: { renderCall: record("ask.call"), renderResult: record("ask.result") },
	};
	class AgentSession {}
	if (options.withMethod !== false) {
		(AgentSession.prototype as Record<string, unknown>).getToolDefinition = function (name: string) {
			return defs[name];
		};
	}
	return { AgentSession, calls, defs };
}

async function load(host: ReturnType<typeof makeHost>, tui: Record<string, unknown> = { TruncatedText: FakeTruncatedText }) {
	mock.module("@code-yeongyu/senpi", () => ({ AgentSession: host.AgentSession }));
	mock.module("@earendil-works/pi-tui", () => tui);
	const notices: string[] = [];
	const handlers: Array<[string, (e: unknown, ctx: unknown) => void]> = [];
	const pi = { on: (event: string, handler: (e: unknown, ctx: unknown) => void) => handlers.push([event, handler]) };
	const mod = await import(`../extension/tool-fold.ts?case=${Math.random()}`);
	await mod.default(pi);
	const ctx = { ui: { notify: (msg: string) => notices.push(msg) } };
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
