// Senpi renders hidden thinking as a `thinking-label` descriptor plus the spacers around it.
// A finished run leaves the line `Thought: 1ms` behind, which the user wants gone; a run that is
// still streaming must keep its live `Thinking...` label. This module treats a hidden label as
// live when the component is streaming, has no tool calls, the label text contains the hidden
// label, and it is the last visible descriptor - the component's isStreaming flag alone does not
// decide it (that stays true for live components after a tool call). This module removes only
// finished hidden labels and the spacer each one introduced, and always falls back to the input
// array on unexpected shapes.

export type RenderDescriptor = { kind: string; text?: unknown; thinkingRun?: unknown };

export type ThinkingState = {
	isStreaming: boolean;
	hasToolCalls: boolean;
	hiddenLabel: string;
};

function isDescriptor(value: unknown): boolean {
	return typeof value === "object" && value !== null && typeof (value as { kind?: unknown }).kind === "string";
}

/**
 * Removes finished, hidden thinking labels (and the spacer they introduced) from render
 * descriptors. Returns the input array unchanged whenever the input is not a descriptor array or
 * nothing is removable. Never mutates the input; kept descriptors keep their identity.
 */
export function hideFinishedThinking<T extends RenderDescriptor>(
	descriptors: readonly T[],
	state: ThinkingState,
): readonly T[] {
	if (!Array.isArray(descriptors)) return descriptors;
	for (const descriptor of descriptors) if (!isDescriptor(descriptor)) return descriptors;

	const bodyRuns = new Set<unknown>();
	for (const descriptor of descriptors) {
		if (descriptor.kind === "thinking-md") bodyRuns.add(descriptor.thinkingRun);
	}

	let lastVisible = -1;
	for (let i = 0; i < descriptors.length; i++) {
		if (descriptors[i].kind !== "spacer") lastVisible = i;
	}

	const removed = new Set<number>();
	for (let i = 0; i < descriptors.length; i++) {
		const descriptor = descriptors[i];
		if (descriptor.kind !== "thinking-label") continue;
		if (typeof descriptor.thinkingRun !== "number") continue;
		if (bodyRuns.has(descriptor.thinkingRun)) continue;
		const live =
			state.isStreaming &&
			!state.hasToolCalls &&
			state.hiddenLabel !== "" &&
			typeof descriptor.text === "string" &&
			descriptor.text.includes(state.hiddenLabel) &&
			i === lastVisible;
		if (!live) removed.add(i);
	}
	if (removed.size === 0) return descriptors;

	const kept: T[] = [];
	for (let i = 0; i < descriptors.length; i++) {
		if (removed.has(i)) continue;
		if (descriptors[i].kind === "spacer" && removed.has(i - 1)) continue;
		kept.push(descriptors[i]);
	}

	const normalized: T[] = [];
	for (const descriptor of kept) {
		const previous = normalized[normalized.length - 1];
		if (descriptor.kind === "spacer" && previous && previous.kind === "spacer") continue;
		normalized.push(descriptor);
	}
	while (normalized.length > 0 && normalized[normalized.length - 1].kind === "spacer") normalized.pop();
	if (normalized.every((descriptor) => descriptor.kind === "spacer")) return [];
	return normalized;
}
