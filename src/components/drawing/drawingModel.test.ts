import { describe, expect, it } from "vitest";
import {
	DEFAULT_DRAWING_SETTINGS,
	HIGHLIGHTER_WIDTH,
	isDrawingMode,
	normalizeDrawingSettings,
	STROKE_WIDTH,
} from "@/lib/drawingTools";
import {
	appendPoint,
	getArrowHead,
	isMeaningfulShape,
	type Point,
	snapAngle,
	snapSquare,
	strokeWidthFor,
} from "./drawingModel";

describe("drawing settings", () => {
	it("falls back to safe defaults", () => {
		expect(normalizeDrawingSettings(null)).toEqual(DEFAULT_DRAWING_SETTINGS);
		expect(normalizeDrawingSettings({ color: "red", size: "xl", tool: "laser" })).toEqual(
			DEFAULT_DRAWING_SETTINGS,
		);
	});

	it("always reopens ready to draw, never in Mouse mode", () => {
		expect(normalizeDrawingSettings({ tool: "cursor" }).tool).toBe("pen");
		expect(normalizeDrawingSettings({ tool: "arrow" }).tool).toBe("arrow");
		expect(isDrawingMode("cursor")).toBe(false);
		expect(isDrawingMode("text")).toBe(true);
	});

	it("keeps valid colours and sizes", () => {
		const settings = normalizeDrawingSettings({ color: "#0A84FF", size: "l" });
		expect(settings.color).toBe("#0a84ff");
		expect(settings.size).toBe("l");
	});

	it("uses wider strokes for the highlighter", () => {
		expect(strokeWidthFor({ tool: "pen", size: "m" })).toBe(STROKE_WIDTH.m);
		expect(strokeWidthFor({ tool: "highlighter", size: "m" })).toBe(HIGHLIGHTER_WIDTH.m);
	});
});

describe("drawing geometry", () => {
	const origin: Point = { x: 0, y: 0 };

	it("snaps lines to 45° steps with Shift", () => {
		const snapped = snapAngle(origin, { x: 100, y: 10 });
		expect(snapped.y).toBeCloseTo(0);
		expect(snapped.x).toBeCloseTo(Math.hypot(100, 10));
		const diagonal = snapAngle(origin, { x: 50, y: 60 });
		expect(diagonal.x).toBeCloseTo(diagonal.y);
	});

	it("makes squares with Shift, in any drag direction", () => {
		expect(snapSquare(origin, { x: 40, y: 10 })).toEqual({ x: 40, y: 40 });
		expect(snapSquare(origin, { x: -40, y: 10 })).toEqual({ x: -40, y: 40 });
	});

	it("skips pen points that barely moved", () => {
		const points: Point[] = [{ x: 0, y: 0 }];
		expect(appendPoint(points, { x: 0.5, y: 0.5 })).toBe(false);
		expect(appendPoint(points, { x: 5, y: 0 })).toBe(true);
		expect(points).toHaveLength(2);
	});

	it("drops accidental clicks but keeps pen dots and real shapes", () => {
		expect(
			isMeaningfulShape({
				kind: "line",
				color: "#fff",
				width: 4,
				from: origin,
				to: { x: 1, y: 1 },
			}),
		).toBe(false);
		expect(
			isMeaningfulShape({
				kind: "rect",
				color: "#fff",
				width: 4,
				from: origin,
				to: { x: 30, y: 20 },
			}),
		).toBe(true);
		expect(isMeaningfulShape({ kind: "pen", color: "#fff", width: 4, points: [origin] })).toBe(
			true,
		);
		expect(
			isMeaningfulShape({
				kind: "text",
				color: "#fff",
				fontSize: 20,
				at: origin,
				text: "   ",
			}),
		).toBe(false);
	});

	it("points the arrow head back along the shaft", () => {
		const [left, right] = getArrowHead(origin, { x: 100, y: 0 }, 6);
		expect(left.x).toBeLessThan(100);
		expect(right.x).toBeLessThan(100);
		expect(Math.sign(left.y)).toBe(-Math.sign(right.y));
	});
});
