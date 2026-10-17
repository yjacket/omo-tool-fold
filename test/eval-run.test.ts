import { describe, expect, test } from "bun:test";
import type { MemberLine, RunDeps } from "../extension/eval-run";

type Group = {
	firstCard: object;
	members?: readonly unknown[];
	lines?: readonly MemberLine[];
	cards?: readonly object[];
};

type SetMembersCall = { group: Group; members: readonly unknown[]; lines: readonly MemberLine[]; cards: readonly object[] };

const line = (language: string, what: string): MemberLine => ({ language, status: "complete", what });
const card = (language: string, what: string) => ({ line: line(language, what) });
const lineOf = (child: { line: MemberLine }): MemberLine => child.line;
const other = { other: true };

function makeDeps() {
	const groups = new Map<object, Group>();
	const calls: SetMembersCall[] = [];
	const detailChecks: unknown[] = [];
	const deps: RunDeps<Group> = {
		memberLine(child) {
			if (typeof child !== "object" || child === null) return undefined;
			const found = (child as { line?: unknown }).line;
			return found === undefined ? undefined : (found as MemberLine);
		},
		isDetail(child) {
			detailChecks.push(child);
			return typeof child === "object" && child !== null && (child as { detail?: unknown }).detail === true;
		},
		groupFor(firstCard) {
			const existing = groups.get(firstCard);
			if (existing !== undefined) return existing;
			const group: Group = { firstCard };
			groups.set(firstCard, group);
			return group;
		},
		setMembers(group, members, lines, cards) {
			calls.push({ group, members, lines, cards });
			group.members = members;
			group.lines = lines;
			group.cards = cards;
		},
	};
	return { deps, calls, detailChecks, groups };
}

async function freshModule() {
	return await import(`../extension/eval-run.ts?case=${Math.random()}`);
}

describe("groupEvalRuns", () => {
	test("case 1: two consecutive eval cards become one group with both members", async () => {
		const { groupEvalRuns } = await freshModule();
		const { deps, calls } = makeDeps();
		const e1 = card("js", "a");
		const e2 = card("py", "b");

		const out = groupEvalRuns([e1, e2], deps);

		expect(out).toHaveLength(1);
		const group = out[0] as Group;
		expect(group.firstCard).toBe(e1);
		expect(calls).toHaveLength(1);
		expect(calls[0]?.members).toEqual([e1, e2]);
		expect(calls[0]?.lines).toEqual([lineOf(e1), lineOf(e2)]);
		expect(calls[0]?.cards).toEqual([e1, e2]);
	});

	test("case 2: a trailing detail stays outside the group", async () => {
		const { groupEvalRuns } = await freshModule();
		const { deps, calls } = makeDeps();
		const e1 = card("js", "a");
		const e2 = card("py", "b");
		const d = { detail: true, id: "d" };
		const d2 = { detail: true, id: "d2" };

		const out = groupEvalRuns([e1, d, e2, d2], deps);

		expect(out).toEqual([out[0], d2]);
		expect(out[0]).toBe(calls[0]?.group);
		expect(calls[0]?.members).toEqual([e1, d, e2]);
	});

	test("case 3: one card plus a detail forms no group and returns the input reference", async () => {
		const { groupEvalRuns } = await freshModule();
		const { deps, calls } = makeDeps();
		const input = [card("js", "a"), { detail: true, id: "d" }, other];

		const out = groupEvalRuns(input, deps);

		expect(out).toBe(input);
		expect(calls).toHaveLength(0);
	});

	test("case 4: two cards split by another child form no group and return the input reference", async () => {
		const { groupEvalRuns } = await freshModule();
		const { deps, calls } = makeDeps();
		const input = [card("js", "a"), other, card("py", "b")];

		const out = groupEvalRuns(input, deps);

		expect(out).toBe(input);
		expect(calls).toHaveLength(0);
	});

	test("case 5: groups are separated by plain children and keep the interleaved detail", async () => {
		const { groupEvalRuns } = await freshModule();
		const { deps, calls } = makeDeps();
		const a = { plain: "a" };
		const e1 = card("js", "1");
		const e2 = card("js", "2");
		const b = { plain: "b" };
		const e3 = card("js", "3");
		const d = { detail: true, id: "d" };
		const e4 = card("py", "4");
		const e5 = card("py", "5");

		const out = groupEvalRuns([a, e1, e2, b, e3, d, e4, e5], deps);

		expect(out).toHaveLength(4);
		expect(out[0]).toBe(a);
		expect(out[2]).toBe(b);
		expect(calls).toHaveLength(2);
		expect(calls[0]?.members).toEqual([e1, e2]);
		expect(calls[1]?.members).toEqual([e3, d, e4, e5]);
		expect(calls[1]?.lines).toEqual([lineOf(e3), lineOf(e4), lineOf(e5)]);
		expect(calls[1]?.cards).toEqual([e3, e4, e5]);
	});

	test("case 6: the same first card yields the same group object across calls", async () => {
		const { groupEvalRuns } = await freshModule();
		const { deps, calls } = makeDeps();
		const e1 = card("js", "a");
		const e2 = card("js", "b");

		const first = groupEvalRuns([e1, e2], deps);
		const second = groupEvalRuns([e1, e2], deps);

		expect(first[0]).toBe(second[0]);
		expect(calls).toHaveLength(2);
		expect(calls[0]?.group).toBe(calls[1]?.group);
	});

	test("case 7: a leading detail never reaches isDetail and stays first", async () => {
		const { groupEvalRuns } = await freshModule();
		const { deps, calls, detailChecks } = makeDeps();
		const d = { detail: true, id: "d" };
		const e1 = card("js", "a");
		const e2 = card("js", "b");

		const out = groupEvalRuns([d, e1, e2], deps);

		expect(detailChecks).toEqual([]);
		expect(out).toHaveLength(2);
		expect(out[0]).toBe(d);
		expect(out[1]).toBe(calls[0]?.group);
		expect(calls[0]?.members).toEqual([e1, e2]);
	});

	test("case 8: null, strings and numbers pass through untouched", async () => {
		const { groupEvalRuns } = await freshModule();
		const { deps, calls, detailChecks } = makeDeps();
		const bare = [null, "s", 7];

		expect(groupEvalRuns(bare, deps)).toBe(bare);
		expect(detailChecks).toEqual([]);

		const mixed = [card("js", "a"), null, "s", card("py", "b")];
		expect(groupEvalRuns(mixed, deps)).toBe(mixed);
		expect(calls).toHaveLength(0);
	});

	test("case 9: the input array and its elements are not mutated", async () => {
		const { groupEvalRuns } = await freshModule();
		const { deps } = makeDeps();
		const e1 = card("js", "a");
		const d = { detail: true, id: "d" };
		const e2 = card("py", "b");
		const elements = [e1, d, e2];
		const before = structuredClone(elements);
		const input = Object.freeze([...elements]);

		groupEvalRuns(input, deps);

		expect([e1, d, e2]).toEqual(before);
		expect(input).toEqual(before);
	});
});
