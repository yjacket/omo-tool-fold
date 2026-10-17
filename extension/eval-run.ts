/**
 * Pure projection pass: fold consecutive eval cards into one group element.
 *
 * Unlike Senpi's own grouping pass, trailing detail children stay OUTSIDE the group so a live
 * "Thinking..." label keeps rendering below the block. Cards and details between them become
 * the group's members, in original order.
 */

export type MemberLine = { language: string; status: string; what: string };

export type RunDeps<G extends object> = {
	memberLine(child: unknown): MemberLine | undefined;
	isDetail(child: unknown): boolean;
	groupFor(firstCard: object): G;
	setMembers(group: G, members: readonly unknown[], lines: readonly MemberLine[], cards: readonly object[]): void;
};

type Run = {
	cards: object[];
	lines: MemberLine[];
	members: unknown[];
	tail: unknown[];
};

export function groupEvalRuns<G extends object>(projected: readonly unknown[], deps: RunDeps<G>): readonly unknown[] {
	const out: unknown[] = [];
	let run: Run | undefined;
	let grouped = false;

	const close = (): void => {
		const current = run;
		if (current === undefined) return;
		run = undefined;
		const first = current.cards[0];
		if (current.cards.length >= 2 && first !== undefined) {
			grouped = true;
			const group = deps.groupFor(first);
			deps.setMembers(group, current.members, current.lines, current.cards);
			out.push(group);
			for (const element of current.tail) out.push(element);
			return;
		}
		for (const element of current.members) out.push(element);
		for (const element of current.tail) out.push(element);
	};

	for (const child of projected) {
		let card: object | undefined;
		let line: MemberLine | undefined;
		if (child !== null && typeof child === "object") {
			line = deps.memberLine(child);
			if (line !== undefined) card = child;
		}
		if (card !== undefined && line !== undefined) {
			if (run === undefined) {
				run = { cards: [card], lines: [line], members: [card], tail: [] };
			} else {
				for (const element of run.tail) run.members.push(element);
				run.tail = [];
				run.members.push(card);
				run.cards.push(card);
				run.lines.push(line);
			}
			continue;
		}
		if (run !== undefined && deps.isDetail(child)) {
			run.tail.push(child);
			continue;
		}
		close();
		out.push(child);
	}
	close();

	return grouped ? out : projected;
}
