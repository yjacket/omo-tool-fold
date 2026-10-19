/**
 * Pure projection pass: drop two kinds of transcript notices while the TUI is collapsed
 * (Ctrl+O expands). Nothing here touches the transcript container or stored entries.
 *
 * Both notices are custom session entries rendered by CustomEntryComponent:
 * - Kibitzer recall nudges: "omo-kibitzer:nudged"
 * - Goal cache-warm wait/wake: "goal-cache-warmup"
 *
 * Prompt-cache MISS notices are plain themed text with no customType, so they never match.
 */

const HIDDEN_CUSTOM_TYPES = new Set(["omo-kibitzer:nudged", "goal-cache-warmup"]);

type CustomCarrier = {
	message?: { role?: unknown; customType?: unknown };
	entry?: { type?: unknown; customType?: unknown };
	customEntry?: { type?: unknown; customType?: unknown };
	setExpanded?: unknown;
	_expanded?: unknown;
	state?: { expanded?: unknown };
};

function customTypeOf(child: unknown): string | undefined {
	if (!child || typeof child !== "object") return undefined;
	const carrier = child as CustomCarrier;
	// Only TUI notice cards expose this; anything else is left alone.
	if (typeof carrier.setExpanded !== "function") return undefined;
	const message = carrier.message;
	if (message && typeof message === "object" && message.role === "custom" && typeof message.customType === "string") {
		return message.customType;
	}
	const entry = carrier.customEntry ?? carrier.entry;
	if (entry && typeof entry === "object" && entry.type === "custom" && typeof entry.customType === "string") {
		return entry.customType;
	}
	return undefined;
}

/** Undefined when the card's collapsed state cannot be read, in which case it stays visible. */
function isCollapsed(child: unknown): boolean | undefined {
	if (!child || typeof child !== "object") return undefined;
	const carrier = child as CustomCarrier;
	if (typeof carrier._expanded === "boolean") return !carrier._expanded;
	if (carrier.state && typeof carrier.state.expanded === "boolean") return !carrier.state.expanded;
	return undefined;
}

/** True only for a whitelisted notice that is currently drawn collapsed. */
export function shouldHideNotice(child: unknown): boolean {
	try {
		const customType = customTypeOf(child);
		if (customType === undefined || !HIDDEN_CUSTOM_TYPES.has(customType)) return false;
		return isCollapsed(child) === true;
	} catch {
		return false; // Unexpected shape: keep the original rendering.
	}
}

/** Removes collapsed hidden notices; returns `projected` by identity when nothing is hidden. */
export function hideCollapsedNotices(projected: readonly unknown[]): readonly unknown[] {
	try {
		const visible = projected.filter((child) => !shouldHideNotice(child));
		return visible.length === projected.length ? projected : visible;
	} catch {
		return projected;
	}
}
