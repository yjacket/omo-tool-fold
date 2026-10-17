import { describe, expect, test } from "bun:test";

import { createEvalGroupClass } from "../extension/eval-group-view";

type BodyLine = { language: string; status: string; what: string };
type MouseLike = {
	type: string;
	button: string;
	x: number;
	y: number;
	screenX: number;
	screenY: number;
	width: number;
	height: number;
};
type Card = {
	setExpanded?(expanded: boolean): void;
	presentationSnapshot?: { state?: { expanded?: boolean } };
	render?(width: number): string[];
};

class FakeContainer {
	children: unknown[] = [];
	mouseEvents: MouseLike[] = [];
	revisions = 0;
	render(width: number): string[] {
		const out: string[] = [];
		for (const child of this.children) {
			out.push(...(child as { render(w: number): string[] }).render(width));
		}
		return out;
	}
	handleMouse(event: MouseLike): unknown {
		this.mouseEvents.push(event);
		return { forwarded: true };
	}
	bumpRenderRevision(): void {
		this.revisions += 1;
	}
	childRenderRevision(): number {
		return this.revisions;
	}
}

const truncateToWidth = (text: string, width: number) => text.slice(0, width);

type TestTheme = { fg?: (color: string, text: string) => string; bold?: (text: string) => string } | undefined;

function makeGroup(theme?: TestTheme, onError?: (error: unknown) => void) {
	const Group = createEvalGroupClass(FakeContainer, truncateToWidth, () => theme, onError);
	return new Group();
}

/** Builds a group with a throwing collaborator, for the render-failure fallback cases. */
function makeRawGroup(options: {
	truncateToWidth?: (text: string, width: number) => string;
	getTheme?: () => TestTheme;
	onError?: (error: unknown) => void;
} = {}) {
	const Group = createEvalGroupClass(
		FakeContainer,
		options.truncateToWidth ?? truncateToWidth,
		options.getTheme ?? (() => undefined),
		options.onError,
	);
	return new Group();
}

const cardMember = [{ render: (_width: number) => ["CARD"] }];

const jsLine: BodyLine = { language: "js", status: "complete", what: "a" };
const pyLine: BodyLine = { language: "py", status: "complete", what: "b" };
const complete: BodyLine[] = [jsLine, pyLine];

const members = [{ name: "one" }, { name: "two" }];

const mouse = (over: Partial<MouseLike> = {}): MouseLike => ({
	type: "click",
	button: "left",
	x: 0,
	y: 1,
	screenX: 0,
	screenY: 0,
	width: 80,
	height: 10,
	...over,
});

describe("eval-group-view", () => {
	test("two complete lines render one header and one body line each", () => {
		const group = makeGroup();
		group.setMembers(members, complete, []);
		expect(group.render(80)).toEqual(["", "• Ran 2 evals", "  └ js ✓ a", "    py ✓ b"]);
	});

	test("a running line shows the spinner header and disables the render revision", () => {
		const group = makeGroup();
		group.setMembers(members, [jsLine, { language: "py", status: "running", what: "b" }], []);
		const rendered = group.render(80);
		expect(rendered[1]).toMatch(/^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏] Running 2 evals$/);
		expect(rendered.join("\n")).toContain("running");
		expect(group.getRenderRevision()).toBeUndefined();
	});

	test("a call without a result yet shows an ellipsis", () => {
		const group = makeGroup();
		group.setMembers(members, [jsLine, { language: "py", status: "call", what: "b" }], []);
		const rendered = group.render(80);
		expect(rendered).toContain("    py … b");
		expect(rendered).toContain("  └ js ✓ a");
	});

	test("an expanded member card lists the original children under the header", () => {
		const group = makeGroup();
		const card: Card = { render: (width: number) => [`CARD ${width}`], presentationSnapshot: { state: { expanded: true } } };
		group.setMembers([card], complete, [card]);
		expect(group.render(80)).toEqual(["", "• Ran 2 evals", "CARD 80"]);
	});

	test("the width truncates the header and every body line", () => {
		const group = makeGroup();
		group.setMembers(members, complete, []);
		expect(group.render(8)).toEqual(["", "• Ran 2 ", "  └ js ✓", "    py ✓"]);
	});

	test("clicks on the header toggle every card, presses only mark handled, and the body forwards", () => {
		const toggles: boolean[] = [];
		const card: Card = {
			setExpanded: (expanded: boolean) => toggles.push(expanded),
			presentationSnapshot: { state: { expanded: false } },
		};
		const group = makeGroup();
		group.setMembers(members, complete, [card]);
		const clicked = group.handleMouse?.(mouse({ x: 3, y: 1, screenX: 103, screenY: 41 })) as {
			handled: boolean;
			target: { originX: number; originY: number; width: number; height: number };
		};
		expect(clicked.handled).toBe(true);
		expect({ ...clicked.target, component: undefined }).toEqual({ component: undefined, originX: 100, originY: 40, width: 80, height: 10 });
		expect(clicked.target.component).toBe(group);
		expect(toggles).toEqual([true]);
		expect(group.handleMouse?.(mouse({ type: "press" }))).toMatchObject({ handled: true });
		expect(toggles).toEqual([true]);
		expect(group.handleMouse?.(mouse({ button: "right" }))).toBeUndefined();

		const expandedCard: Card = { presentationSnapshot: { state: { expanded: true } } };
		const expandedGroup = makeGroup();
		expandedGroup.setMembers(members, complete, [expandedCard]);
		expandedGroup.handleMouse?.(mouse({ type: "press", y: 3 }));
		expect(expandedGroup.mouseEvents).toEqual([{ ...mouse({ type: "press", y: 3 }), y: 1, height: 8 }]);
	});

	test("bumps only when the members or the body text change", () => {
		const group = makeGroup();
		group.setMembers(members, complete, []);
		const afterFirst = group.revisions;
		expect(afterFirst).toBeGreaterThan(0);
		group.setMembers(members, complete, []);
		expect(group.revisions).toBe(afterFirst);
		group.setMembers(members, [jsLine, { language: "py", status: "running", what: "b" }], []);
		expect(group.revisions).toBe(afterFirst + 1);
		group.setMembers([{ name: "one" }, { name: "three" }], [jsLine, { language: "py", status: "running", what: "b" }], []);
		expect(group.revisions).toBe(afterFirst + 2);
	});

	test("the theme wraps the marker, header, prefixes and states", () => {
		const theme: TestTheme = { fg: (color, text) => `<${color}>${text}`, bold: (text) => `*${text}` };
		const group = makeGroup(theme);
		group.setMembers(members, complete, []);
		expect(group.render(80)).toEqual([
			"",
			"<dim>• *Ran 2 evals",
			"<dim>  └ <muted>js <success>✓ a",
			"    <muted>py <success>✓ b",
		]);
	});

	test("a card whose snapshot getter throws counts as collapsed", () => {
		const group = makeGroup();
		const hostile: Card = {
			get presentationSnapshot(): never {
				throw new Error("snapshot gone");
			},
		};
		group.setMembers([hostile, members[1]], complete, [hostile]);
		expect(group.expanded).toBe(false);
		expect(group.render(80)).toEqual(["", "• Ran 2 evals", "  └ js ✓ a", "    py ✓ b"]);
	});

	test("an empty language leaves no double space", () => {
		const group = makeGroup();
		group.setMembers(members, [{ language: "", status: "complete", what: "no language" }], []);
		expect(group.render(80)).toEqual(["", "• Ran 1 evals", "  └ ✓ no language"]);
	});

	test("a settled group exposes its children's render revision when a theme is available", () => {
		const group = makeGroup({ fg: (_color, text) => text });
		group.setMembers(members, complete, []);
		expect(group.getRenderRevision()).toBe(group.revisions);
		expect(group.getRenderRevision()).not.toBeUndefined();
	});

	test("a settled group without a theme is never cached", () => {
		const group = makeGroup();
		group.setMembers(members, complete, []);
		expect(group.render(80)).toEqual(["", "• Ran 2 evals", "  └ js ✓ a", "    py ✓ b"]);
		expect(group.getRenderRevision()).toBeUndefined();
	});

	test("a degraded render forwards clicks unshifted, and a later good render restores the offset", () => {
		let broken = true;
		const errors: unknown[] = [];
		const group = makeRawGroup({
			truncateToWidth: (text, width) => {
				if (broken) throw new Error("truncate gone");
				return text.slice(0, width);
			},
			getTheme: () => ({}),
			onError: (error) => errors.push(error),
		});
		const card: Card = { render: () => ["CARD"], presentationSnapshot: { state: { expanded: true } } };
		group.setMembers([card], complete, [card]);
		expect(group.render(80)).toEqual(["CARD"]);
		expect(errors.length).toBe(1);

		const click = mouse({ type: "press", y: 3 });
		expect(group.handleMouse?.(click)).toEqual({ forwarded: true });
		expect(group.mouseEvents).toEqual([click]);

		broken = false;
		expect(group.render(80)).toEqual(["", "• Ran 2 evals", "CARD"]);
		group.handleMouse?.(mouse({ type: "press", y: 3 }));
		expect(group.mouseEvents[1]).toEqual({ ...mouse({ type: "press", y: 3 }), y: 1, height: 8 });
	});

	test("a throwing truncateToWidth falls back to the member cards and reports once", () => {
		const errors: unknown[] = [];
		const group = makeRawGroup({
			truncateToWidth: () => {
				throw new Error("truncate gone");
			},
			onError: (error) => errors.push(error),
		});
		group.setMembers(cardMember, complete, []);
		expect(group.render(80)).toEqual(["CARD"]);
		expect(errors.length).toBe(1);
		expect(errors[0]).toBeInstanceOf(Error);

		const silent = makeRawGroup({
			truncateToWidth: () => {
				throw new Error("truncate gone");
			},
		});
		silent.setMembers(cardMember, complete, []);
		expect(silent.render(80)).toEqual(["CARD"]);

		const hostileReporter = makeRawGroup({
			truncateToWidth: () => {
				throw new Error("truncate gone");
			},
			onError: () => {
				throw new Error("reporter gone");
			},
		});
		hostileReporter.setMembers(cardMember, complete, []);
		expect(hostileReporter.render(80)).toEqual(["CARD"]);
	});

	test("a throwing getTheme falls back the same way", () => {
		const errors: unknown[] = [];
		const group = makeRawGroup({
			getTheme: () => {
				throw new Error("theme gone");
			},
			onError: (error) => errors.push(error),
		});
		group.setMembers(cardMember, complete, []);
		expect(group.render(80)).toEqual(["CARD"]);
		expect(errors.length).toBe(1);

		const silent = makeRawGroup({
			getTheme: () => {
				throw new Error("theme gone");
			},
		});
		silent.setMembers(cardMember, complete, []);
		expect(silent.render(80)).toEqual(["CARD"]);
		// A theme accessor that throws is as uncacheable as a missing theme.
		expect(silent.getRenderRevision()).toBeUndefined();
	});
});
