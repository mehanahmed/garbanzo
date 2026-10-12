/**
 * Screen drawing (annotate while recording). Shared by the Electron main
 * process, the drawing layer and the toolbar, so it must not import from
 * either side.
 */

export const DRAWING_SETTINGS_KEY = "recordly.drawing.settings";

export type DrawingTool = "cursor" | "pen" | "line" | "arrow" | "rect" | "highlighter" | "text";

export const DRAWING_TOOLS: readonly DrawingTool[] = [
	"cursor",
	"pen",
	"line",
	"arrow",
	"rect",
	"highlighter",
	"text",
];

export const DRAWING_TOOL_LABELS: Record<DrawingTool, string> = {
	cursor: "Mouse (click through)",
	pen: "Pen",
	line: "Line",
	arrow: "Arrow",
	rect: "Rectangle",
	highlighter: "Highlighter",
	text: "Text",
};

/** Bright, high-contrast colours that read well over any app. */
export const DRAWING_COLORS = [
	"#ff3b30",
	"#ff9f0a",
	"#ffd60a",
	"#30d158",
	"#0a84ff",
	"#bf5af2",
	"#ffffff",
	"#1c1c1e",
] as const;

export type DrawingSize = "s" | "m" | "l";
export const DRAWING_SIZES: readonly DrawingSize[] = ["s", "m", "l"];
/** Stroke width in CSS pixels for each size. */
export const STROKE_WIDTH: Record<DrawingSize, number> = { s: 3, m: 6, l: 10 };
export const HIGHLIGHTER_WIDTH: Record<DrawingSize, number> = { s: 14, m: 24, l: 36 };
export const TEXT_SIZE: Record<DrawingSize, number> = { s: 22, m: 32, l: 48 };

export interface DrawingSettings {
	tool: DrawingTool;
	color: string;
	size: DrawingSize;
}

export const DEFAULT_DRAWING_SETTINGS: DrawingSettings = {
	tool: "pen",
	color: DRAWING_COLORS[0],
	size: "m",
};

/** Runtime state the main process relays between the toolbar and the drawing layer. */
export interface DrawingState extends DrawingSettings {
	/** Number of shapes on screen (drives the Undo / Clear buttons). */
	shapeCount: number;
}

export function isDrawingTool(value: unknown): value is DrawingTool {
	return typeof value === "string" && (DRAWING_TOOLS as readonly string[]).includes(value);
}

export function normalizeDrawingSettings(raw: unknown): DrawingSettings {
	const value = (raw && typeof raw === "object" ? raw : {}) as Partial<DrawingSettings>;
	const color =
		typeof value.color === "string" && /^#[0-9a-f]{6}$/i.test(value.color)
			? value.color.toLowerCase()
			: DEFAULT_DRAWING_SETTINGS.color;
	return {
		// Always reopen ready to draw; "cursor" is a temporary state.
		tool: isDrawingTool(value.tool) && value.tool !== "cursor" ? value.tool : "pen",
		color,
		size: value.size === "s" || value.size === "l" ? value.size : "m",
	};
}

export function isDrawingMode(tool: DrawingTool): boolean {
	return tool !== "cursor";
}
