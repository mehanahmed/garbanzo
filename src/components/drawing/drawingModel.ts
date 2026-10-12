import {
	type DrawingSettings,
	HIGHLIGHTER_WIDTH,
	STROKE_WIDTH,
	TEXT_SIZE,
} from "@/lib/drawingTools";

export type Point = { x: number; y: number };

export type Shape =
	| { kind: "pen" | "highlighter"; color: string; width: number; points: Point[] }
	| { kind: "line" | "arrow" | "rect"; color: string; width: number; from: Point; to: Point }
	| { kind: "text"; color: string; fontSize: number; at: Point; text: string };

export const TEXT_FONT_FAMILY =
	'"DM Sans", "Noto Sans Bengali", "Nirmala UI", system-ui, sans-serif';
const HIGHLIGHTER_ALPHA = 0.38;
const MIN_POINT_DISTANCE = 1.5;

export function strokeWidthFor(settings: Pick<DrawingSettings, "tool" | "size">): number {
	return settings.tool === "highlighter"
		? HIGHLIGHTER_WIDTH[settings.size]
		: STROKE_WIDTH[settings.size];
}

export function textSizeFor(settings: Pick<DrawingSettings, "size">): number {
	return TEXT_SIZE[settings.size];
}

/** Snap to 0/45/90° (Shift held) for lines and arrows. */
export function snapAngle(from: Point, to: Point): Point {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy);
	if (length === 0) return to;
	const step = Math.PI / 4;
	const angle = Math.round(Math.atan2(dy, dx) / step) * step;
	return { x: from.x + Math.cos(angle) * length, y: from.y + Math.sin(angle) * length };
}

/** Make a square (Shift held) for rectangles. */
export function snapSquare(from: Point, to: Point): Point {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const side = Math.max(Math.abs(dx), Math.abs(dy));
	return { x: from.x + Math.sign(dx || 1) * side, y: from.y + Math.sign(dy || 1) * side };
}

/** Skip points closer than ~1.5px to keep pen paths light. */
export function appendPoint(points: Point[], point: Point): boolean {
	const last = points[points.length - 1];
	if (last && Math.hypot(point.x - last.x, point.y - last.y) < MIN_POINT_DISTANCE) {
		return false;
	}
	points.push(point);
	return true;
}

/** A shape too small to be intentional (a stray click) is dropped. */
export function isMeaningfulShape(shape: Shape): boolean {
	switch (shape.kind) {
		case "pen":
		case "highlighter":
			return shape.points.length > 0;
		case "text":
			return shape.text.trim().length > 0;
		default:
			return Math.hypot(shape.to.x - shape.from.x, shape.to.y - shape.from.y) >= 4;
	}
}

export function getArrowHead(from: Point, to: Point, width: number): [Point, Point] {
	const length = Math.max(14, width * 3.4);
	const spread = Math.PI / 7;
	const angle = Math.atan2(to.y - from.y, to.x - from.x);
	return [
		{
			x: to.x - length * Math.cos(angle - spread),
			y: to.y - length * Math.sin(angle - spread),
		},
		{
			x: to.x - length * Math.cos(angle + spread),
			y: to.y - length * Math.sin(angle + spread),
		},
	];
}

function isDarkColor(hex: string): boolean {
	const value = Number.parseInt(hex.slice(1), 16);
	const r = (value >> 16) & 255;
	const g = (value >> 8) & 255;
	const b = value & 255;
	return 0.2126 * r + 0.7152 * g + 0.0722 * b < 90;
}

function tracePath(ctx: CanvasRenderingContext2D, points: Point[]) {
	ctx.beginPath();
	const [first] = points;
	ctx.moveTo(first.x, first.y);
	if (points.length === 1) {
		// A single click leaves a dot.
		ctx.lineTo(first.x + 0.01, first.y);
		return;
	}
	// Smooth through midpoints so fast strokes don't look jagged.
	for (let i = 1; i < points.length - 1; i += 1) {
		const mid = {
			x: (points[i].x + points[i + 1].x) / 2,
			y: (points[i].y + points[i + 1].y) / 2,
		};
		ctx.quadraticCurveTo(points[i].x, points[i].y, mid.x, mid.y);
	}
	const last = points[points.length - 1];
	ctx.lineTo(last.x, last.y);
}

export function renderShape(ctx: CanvasRenderingContext2D, shape: Shape): void {
	ctx.save();
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.strokeStyle = shape.color;
	ctx.fillStyle = shape.color;

	switch (shape.kind) {
		case "pen":
			ctx.lineWidth = shape.width;
			tracePath(ctx, shape.points);
			ctx.stroke();
			break;
		case "highlighter":
			ctx.globalAlpha = HIGHLIGHTER_ALPHA;
			ctx.lineWidth = shape.width;
			ctx.lineCap = "butt";
			// One path, so overlapping parts of the same stroke don't darken.
			tracePath(ctx, shape.points);
			ctx.stroke();
			break;
		case "line":
			ctx.lineWidth = shape.width;
			ctx.beginPath();
			ctx.moveTo(shape.from.x, shape.from.y);
			ctx.lineTo(shape.to.x, shape.to.y);
			ctx.stroke();
			break;
		case "arrow": {
			ctx.lineWidth = shape.width;
			const [left, right] = getArrowHead(shape.from, shape.to, shape.width);
			ctx.beginPath();
			ctx.moveTo(shape.from.x, shape.from.y);
			ctx.lineTo(shape.to.x, shape.to.y);
			ctx.stroke();
			ctx.beginPath();
			ctx.moveTo(left.x, left.y);
			ctx.lineTo(shape.to.x, shape.to.y);
			ctx.lineTo(right.x, right.y);
			ctx.closePath();
			ctx.fill();
			ctx.stroke();
			break;
		}
		case "rect": {
			ctx.lineWidth = shape.width;
			const x = Math.min(shape.from.x, shape.to.x);
			const y = Math.min(shape.from.y, shape.to.y);
			const w = Math.abs(shape.to.x - shape.from.x);
			const h = Math.abs(shape.to.y - shape.from.y);
			ctx.beginPath();
			ctx.roundRect(x, y, w, h, Math.min(6, w / 4, h / 4));
			ctx.stroke();
			break;
		}
		case "text": {
			ctx.font = `700 ${shape.fontSize}px ${TEXT_FONT_FAMILY}`;
			ctx.textBaseline = "top";
			// A soft contrasting outline keeps text readable over any app.
			ctx.lineWidth = Math.max(2, shape.fontSize * 0.09);
			ctx.strokeStyle = isDarkColor(shape.color)
				? "rgba(255,255,255,0.8)"
				: "rgba(0,0,0,0.3)";
			const lineHeight = shape.fontSize * 1.2;
			shape.text.split("\n").forEach((line, index) => {
				const y = shape.at.y + index * lineHeight;
				ctx.strokeText(line, shape.at.x, y);
				ctx.fillText(line, shape.at.x, y);
			});
			break;
		}
	}
	ctx.restore();
}

/** Prepare a canvas for crisp drawing on high-DPI screens. Returns the 2D context. */
export function sizeCanvas(canvas: HTMLCanvasElement, width: number, height: number) {
	const ratio = window.devicePixelRatio || 1;
	canvas.width = Math.round(width * ratio);
	canvas.height = Math.round(height * ratio);
	canvas.style.width = `${width}px`;
	canvas.style.height = `${height}px`;
	const ctx = canvas.getContext("2d");
	ctx?.setTransform(ratio, 0, 0, ratio, 0, 0);
	return ctx;
}
