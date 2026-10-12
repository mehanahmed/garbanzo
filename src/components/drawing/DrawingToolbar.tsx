import { type ReactNode, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
	DEFAULT_DRAWING_SETTINGS,
	DRAWING_COLORS,
	DRAWING_SIZES,
	DRAWING_TOOL_LABELS,
	type DrawingSize,
	type DrawingState,
	type DrawingTool,
	STROKE_WIDTH,
} from "@/lib/drawingTools";
import styles from "./Drawing.module.css";

const INITIAL_STATE: DrawingState = { ...DEFAULT_DRAWING_SETTINGS, shapeCount: 0 };

const SIZE_LABELS: Record<DrawingSize, string> = { s: "Thin", m: "Medium", l: "Thick" };

const TOOL_SHORTCUT_HINT: Partial<Record<DrawingTool, string>> = {
	cursor: "Ctrl+Shift+D switches between drawing and the mouse",
};

function Icon({ children }: { children: ReactNode }) {
	return (
		<svg
			viewBox="0 0 24 24"
			width="20"
			height="20"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.8"
			strokeLinecap="round"
			strokeLinejoin="round"
			aria-hidden
		>
			{children}
		</svg>
	);
}

const TOOL_ICONS: Record<DrawingTool, ReactNode> = {
	cursor: (
		<Icon>
			<path d="M5.5 3.5 18 10.2l-5.6 1.6-2.3 5.7z" />
		</Icon>
	),
	pen: (
		<Icon>
			<path d="M4 20l1-4.2L15.6 5.2a2 2 0 0 1 2.8 0l.4.4a2 2 0 0 1 0 2.8L8.2 19z" />
			<path d="M13.8 7l3.2 3.2" />
		</Icon>
	),
	line: (
		<Icon>
			<path d="M5 19 19 5" />
		</Icon>
	),
	arrow: (
		<Icon>
			<path d="M5 19 18 6" />
			<path d="M10 5.5h8.5V14" />
		</Icon>
	),
	rect: (
		<Icon>
			<rect x="4" y="6" width="16" height="12" rx="1.5" />
		</Icon>
	),
	highlighter: (
		<Icon>
			<path d="m9 14.5 6.8-9.2 3.4 2.6-6.8 9.2z" />
			<path d="M9 14.5 7.5 18l3.6-.7" />
			<path d="M4 21h9" strokeWidth="3" opacity="0.55" />
		</Icon>
	),
	text: (
		<Icon>
			<path d="M5 7V5h14v2" />
			<path d="M12 5v14" />
			<path d="M9 19h6" />
		</Icon>
	),
};

const TOOL_ORDER: DrawingTool[] = ["cursor", "pen", "line", "arrow", "rect", "highlighter", "text"];

export function DrawingToolbar() {
	const [state, setState] = useState<DrawingState>(INITIAL_STATE);
	const [styleOpen, setStyleOpen] = useState(false);
	const rootRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const api = window.electronAPI;
		if (!api) return;
		void api.getDrawingState?.().then((next) => next && setState(next));
		return api.onDrawingState?.((next) => setState(next));
	}, []);

	// Let the window grow and shrink with the colour panel.
	useLayoutEffect(() => {
		const root = rootRef.current;
		if (!root) return;
		const send = () => window.electronAPI?.setDrawingToolbarHeight?.(root.offsetHeight + 16);
		send();
		const observer = new ResizeObserver(send);
		observer.observe(root);
		return () => observer.disconnect();
	}, []);

	const api = window.electronAPI;
	const canUndo = state.shapeCount > 0;

	return (
		<div
			ref={rootRef}
			className={styles.toolbar}
			style={{ ["--draw-color" as string]: state.color }}
		>
			<div className={styles.grip} title="Drag to move" aria-hidden>
				<span />
				<span />
			</div>

			<div className={styles.group} role="radiogroup" aria-label="Drawing tool">
				{TOOL_ORDER.map((tool) => {
					const active = state.tool === tool;
					const hint = TOOL_SHORTCUT_HINT[tool];
					return (
						<button
							key={tool}
							type="button"
							role="radio"
							aria-checked={active}
							aria-label={DRAWING_TOOL_LABELS[tool]}
							title={
								hint
									? `${DRAWING_TOOL_LABELS[tool]}. ${hint}`
									: DRAWING_TOOL_LABELS[tool]
							}
							className={styles.toolButton}
							data-active={active || undefined}
							data-cursor={tool === "cursor" || undefined}
							onClick={() => api?.setDrawingTool?.(tool)}
						>
							{TOOL_ICONS[tool]}
						</button>
					);
				})}
			</div>

			<div className={styles.divider} />

			<button
				type="button"
				className={styles.toolButton}
				aria-expanded={styleOpen}
				aria-label="Colour and thickness"
				title="Colour and thickness"
				onClick={() => setStyleOpen((open) => !open)}
			>
				<span className={styles.swatchButton} />
			</button>

			{styleOpen && (
				<div className={styles.stylePanel}>
					<div className={styles.swatches} role="radiogroup" aria-label="Colour">
						{DRAWING_COLORS.map((color) => (
							<button
								key={color}
								type="button"
								role="radio"
								aria-checked={state.color === color}
								aria-label={`Colour ${color}`}
								className={styles.swatch}
								style={{ background: color }}
								data-active={state.color === color || undefined}
								onClick={() => api?.setDrawingStyle?.({ color })}
							/>
						))}
					</div>
					<div className={styles.sizes} role="radiogroup" aria-label="Thickness">
						{DRAWING_SIZES.map((size) => (
							<button
								key={size}
								type="button"
								role="radio"
								aria-checked={state.size === size}
								aria-label={SIZE_LABELS[size]}
								title={SIZE_LABELS[size]}
								className={styles.sizeButton}
								data-active={state.size === size || undefined}
								onClick={() => api?.setDrawingStyle?.({ size })}
							>
								<span
									className={styles.sizeDot}
									style={{
										width: STROKE_WIDTH[size] + 2,
										height: STROKE_WIDTH[size] + 2,
									}}
								/>
							</button>
						))}
					</div>
				</div>
			)}

			<button
				type="button"
				className={styles.toolButton}
				aria-label="Undo"
				title="Undo (Ctrl+Z while drawing)"
				disabled={!canUndo}
				onClick={() => api?.sendDrawingCommand?.("undo")}
			>
				<Icon>
					<path d="M9 14 4 9l5-5" />
					<path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
				</Icon>
			</button>
			<button
				type="button"
				className={styles.toolButton}
				aria-label="Clear all drawings"
				title="Clear all drawings"
				disabled={!canUndo}
				onClick={() => api?.sendDrawingCommand?.("clear")}
			>
				<Icon>
					<path d="M4 7h16" />
					<path d="M9 7V4.5h6V7" />
					<path d="M6.5 7l.9 12.2a1.5 1.5 0 0 0 1.5 1.3h6.2a1.5 1.5 0 0 0 1.5-1.3L17.5 7" />
				</Icon>
			</button>

			<div className={styles.divider} />

			<button
				type="button"
				className={styles.toolButton}
				aria-label="Close drawing tools"
				title="Close drawing tools (removes drawings)"
				onClick={() => api?.closeDrawing?.()}
			>
				<Icon>
					<path d="M6 6l12 12M18 6 6 18" />
				</Icon>
			</button>
		</div>
	);
}

export default DrawingToolbar;
