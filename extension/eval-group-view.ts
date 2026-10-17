/**
 * Non-owning Codex-style view over a run of consecutive eval cards. `Container`,
 * `truncateToWidth` and the theme accessor are injected, so this module depends on
 * neither senpi nor pi-tui.
 */

type BodyLine = { language: string; status: string; what: string };

type Theme = { fg?: (color: string, text: string) => string; bold?: (text: string) => string } | undefined;

type GroupMouseEvent = {
	type: string;
	button: string;
	x: number;
	y: number;
	screenX: number;
	screenY: number;
	width: number;
	height: number;
};

type ContainerInstance = {
	children: unknown[];
	render(width: number): string[];
	handleMouse?(event: GroupMouseEvent): unknown;
	bumpRenderRevision?(): void;
	childRenderRevision?(): unknown;
};

type ContainerClass<C extends ContainerInstance> = new (...args: never[]) => C;

type TruncateToWidth = (text: string, width: number) => string;

type MouseTarget = { component: unknown; originX: number; originY: number; width: number; height: number };

const FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_FRAME_MS = 80;

function readExpanded(card: unknown): boolean {
	try {
		const snapshot = (card as { presentationSnapshot?: { state?: { expanded?: unknown } } }).presentationSnapshot;
		return snapshot?.state?.expanded === true;
	} catch {
		return false;
	}
}

export function createEvalGroupClass<C extends ContainerInstance>(
	Container: ContainerClass<C>,
	truncateToWidth: TruncateToWidth,
	getTheme: () => Theme,
	onError?: (error: unknown) => void,
) {
	return class EvalGroup extends Container {
		lines: BodyLine[] = [];
		cards: object[] = [];
		bodyKey = "";
		memberSnapshot: unknown[] = [];
		/** True after a failed render: the header is absent, so mouse rows are unshifted. */
		degraded = false;

		get expanded(): boolean {
			return this.cards.some(readExpanded);
		}

		/** On any failure, render the member cards unchanged and report once. */
		reportError(error: unknown): void {
			try {
				onError?.(error);
			} catch {
				// An error reporter must not break the TUI either.
			}
		}

		/** References are replaced on each projection, never disposed by this view. */
		setMembers(members: readonly unknown[], lines: readonly BodyLine[], cards: readonly object[]): void {
			const membersChanged =
				members.length !== this.memberSnapshot.length || members.some((member, index) => member !== this.memberSnapshot[index]);
			if (membersChanged) {
				this.memberSnapshot = [...members];
				this.bumpRenderRevision?.();
			}
			this.children = [...members];
			this.lines = [...lines];
			this.cards = [...cards];
			// Card lines are cached per card revision, so unchanged text means an unchanged body.
			const bodyKey = lines.map((line) => `${line.language}\u0000${line.status}\u0000${line.what}`).join("\u0001");
			if (bodyKey !== this.bodyKey) {
				this.bodyKey = bodyKey;
				this.bumpRenderRevision?.();
			}
		}

		render(width: number): string[] {
			try {
				this.degraded = false;
				const theme = getTheme();
				const fg = (color: string, text: string) => (typeof theme?.fg === "function" ? theme.fg(color, text) : text);
				const bold = (text: string) => (typeof theme?.bold === "function" ? theme.bold(text) : text);
				const count = this.lines.length;
				const pending = this.lines.some((line) => line.status !== "complete");
				const frame = FRAMES[Math.floor(Date.now() / SPINNER_FRAME_MS) % FRAMES.length] ?? "⠋";
				const marker = pending ? fg("accent", frame) : fg("dim", "•");
				const header = `${marker} ${bold(pending ? `Running ${count} evals` : `Ran ${count} evals`)}`;
				const out = ["", truncateToWidth(header, width)];
				if (this.expanded) return [...out, ...super.render(width)];
				for (const [index, line] of this.lines.entries()) {
					const prefix = index === 0 ? fg("dim", "  └ ") : "    ";
					const state =
						line.status === "complete"
							? fg("success", "✓")
							: line.status === "call"
								? fg("muted", "…")
								: fg("muted", line.status);
					const language = line.language ? `${fg("muted", line.language)} ` : "";
					out.push(truncateToWidth(`${prefix}${language}${state} ${line.what}`, width));
				}
				return out;
			} catch (error) {
				this.degraded = true;
				this.reportError(error);
				return super.render(width);
			}
		}

		handleMouse(event: GroupMouseEvent): unknown {
			try {
				// The failed render emitted the member cards with no header row, so rows are unshifted.
				if (this.degraded) return super.handleMouse?.(event);
				if ((event.type === "press" || event.type === "click") && event.button === "left" && (event.y === 1 || !this.expanded)) {
					if (event.type === "click") {
						const next = !this.expanded;
						for (const card of this.cards) {
							(card as { setExpanded?: (expanded: boolean) => void }).setExpanded?.(next);
						}
					}
					const target: MouseTarget = {
						component: this,
						originX: event.screenX - event.x,
						originY: event.screenY - event.y,
						width: event.width,
						height: event.height,
					};
					return { handled: true, target };
				}
				if (this.expanded && event.y >= 2) {
					return super.handleMouse?.({ ...event, y: event.y - 2, height: event.height - 2 });
				}
				return undefined;
			} catch (error) {
				this.reportError(error);
				return undefined;
			}
		}

		/**
		 * Undefined means "not cacheable": a pending group animates its spinner from the clock, and a
		 * group drawn before the theme arrives must not be cached uncoloured.
		 */
		getRenderRevision(): unknown {
			try {
				if (getTheme() === undefined) return undefined;
				if (this.lines.some((line) => line.status !== "complete")) return undefined;
				return typeof this.childRenderRevision === "function" ? this.childRenderRevision() : undefined;
			} catch (error) {
				this.reportError(error);
				return undefined;
			}
		}
	};
}
