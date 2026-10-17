import { describe, expect, test } from "bun:test";
import { hideFinishedThinking, type RenderDescriptor } from "../extension/thinking-label.ts";

const S = (): RenderDescriptor => ({ kind: "spacer", text: "" });
const L = (run: number, text: string): RenderDescriptor => ({ kind: "thinking-label", text, thinkingRun: run });
const M = (run: number): RenderDescriptor => ({ kind: "thinking-md", text: "body", thinkingRun: run });
const T = (text = "text"): RenderDescriptor => ({ kind: "text-md", text });
const E: RenderDescriptor = { kind: "error-text", text: "boom" };
const P: RenderDescriptor = { kind: "provider-native-summary", text: "s" };
const P2: RenderDescriptor = { kind: "provider-native-body", text: "b" };

const IDLE = { isStreaming: false, hasToolCalls: false, hiddenLabel: "Thinking..." };
const STREAMING = { isStreaming: true, hasToolCalls: false, hiddenLabel: "Thinking..." };

describe("hideFinishedThinking", () => {
	test("a finished hidden label leaves no line at all", () => {
		expect(hideFinishedThinking([S(), L(0, "Thought: 1ms")], IDLE)).toEqual([]);
	});

	test("the label's own spacer goes with it and other descriptors stay the same objects", () => {
		const input = [S(), L(0, "Thought: 1ms"), S(), T()];
		expect(hideFinishedThinking(input, IDLE)).toEqual([input[0], input[3]]);
	});

	test("a live Thinking... label as the last visible element is returned by reference", () => {
		const input = [S(), L(0, "\x1b[3mThinking...\x1b[0m")];
		expect(hideFinishedThinking(input, STREAMING)).toBe(input);
	});

	test("a live message whose label already reads back a duration removes the label", () => {
		const input = [S(), L(0, "Thought: 2s"), S(), T()];
		expect(hideFinishedThinking(input, STREAMING)).toEqual([input[0], input[3]]);
	});

	test("a live Thinking... label is removed when the message has tool calls", () => {
		expect(hideFinishedThinking([S(), L(0, "Thinking...")], { ...STREAMING, hasToolCalls: true })).toEqual([]);
	});

	test("shown thinking (label plus body) is left untouched by reference", () => {
		const input = [S(), L(0, "Thought: 1ms"), M(0), S(), T()];
		expect(hideFinishedThinking(input, IDLE)).toBe(input);
	});

	test("two hidden runs between text descriptors each lose their label and spacer", () => {
		const input = [S(), L(0, "Thought: 1ms"), S(), T("one"), L(1, "Thought: 4ms"), S(), T("two")];
		expect(hideFinishedThinking(input, IDLE)).toEqual([input[0], input[3], input[6]]);
	});

	test("a finished label before an error keeps only the first spacer", () => {
		const input = [S(), L(0, "Thought: 1ms"), S(), E];
		expect(hideFinishedThinking(input, IDLE)).toEqual([input[0], E]);
	});

	test("provider-native descriptors keep their place after a removed label", () => {
		const input = [S(), L(0, "Thought: 1ms"), P, P2];
		expect(hideFinishedThinking(input, IDLE)).toEqual([input[0], P, P2]);
	});

	test("malformed input is returned unchanged by reference", () => {
		const withNull = [S(), null] as unknown as RenderDescriptor[];
		const noKind = [{ text: "x" }] as unknown as RenderDescriptor[];
		expect(hideFinishedThinking(null as unknown as RenderDescriptor[], IDLE)).toBe(null);
		expect(hideFinishedThinking(withNull, IDLE)).toBe(withNull);
		expect(hideFinishedThinking(noKind, IDLE)).toBe(noKind);
	});

	test("the input array is deep-equal before and after a removal", () => {
		const input = [S(), L(0, "Thought: 1ms"), S(), T()];
		const before = structuredClone(input);
		hideFinishedThinking(input, IDLE);
		expect(input).toEqual(before);
	});

	test("an empty hiddenLabel while streaming removes the label", () => {
		expect(hideFinishedThinking([S(), L(0, "Thinking...")], { ...STREAMING, hiddenLabel: "" })).toEqual([]);
	});

	test("a live-looking label that is not the last visible element is removed", () => {
		const input = [S(), L(0, "Thinking..."), T()];
		expect(hideFinishedThinking(input, STREAMING)).toEqual([input[0], input[2]]);
	});
});
